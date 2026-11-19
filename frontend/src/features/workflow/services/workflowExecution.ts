import type { WorkflowDef } from './workflowService'
import { defForNode } from '@/features/workflow/model/workflowTemplates'
import { workflowGraphProblems } from './workflowGraph'

export interface NodeOutput { [port: string]: unknown }
export interface NodeIO { label: string; inputs: Record<string, unknown>; outputs: NodeOutput; error?: string }
export interface ExecutionResult {
  nodeIO: Record<string, NodeIO>
  status: 'completed' | 'awaiting_info' | 'failed' | 'cancelled' | 'running'
  error?: string
}

const SUPPORTED = new Set(['prompt', 'refs', 'capability', 'create', 'review', 'delivery'])
const CYCLE_NODE_TYPES = new Set(['create', 'review', 'delivery'])

export function extractReworkCorrection(wf: Pick<WorkflowDef, 'nodes'>): { rework: boolean; correction: string } {
  let rework = false
  const issues: string[] = []
  for (const node of wf.nodes) {
    if (node.type !== 'review') continue
    const checks = (node.params.checks as Record<string, unknown> | undefined) ?? {}
    if (checks.rework === true && checks.done !== true) {
      rework = true
      const text = String(node.params.issues ?? node.params.notes ?? '').trim()
      if (text) issues.push(text)
    }
  }
  return { rework, correction: issues.join('\n\n') }
}

function isLatestRenderApproved(render: unknown, notes: unknown): { ok: boolean; reason?: string } {
  if (!render || typeof render !== 'object') {
    return { ok: false, reason: '等待审片通过：尚未产出有效渲染' }
  }
  const r = render as Record<string, unknown>
  if (r.state && r.state !== 'rendered' && !r.artifactPath) {
    return { ok: false, reason: '等待审片通过：当前没有可交付的渲染成片' }
  }
  if (!notes || typeof notes !== 'object') {
    return { ok: false, reason: '等待审片通过' }
  }
  const n = notes as Record<string, unknown>
  if (n.approved !== true || n.rework === true) {
    return { ok: false, reason: n.rework === true ? '等待审片通过（当前标记为需要修改）' : '等待审片通过' }
  }
  const hasRenderVersion = r.version !== undefined && r.version !== null && r.version !== ''
  const hasRenderPath = typeof r.artifactPath === 'string' && r.artifactPath.trim() !== ''
  const hasRenderRunId = typeof r.runId === 'string' && r.runId.trim() !== ''
  const hasReviewedBinding =
    (n.reviewedVersion !== undefined && n.reviewedVersion !== null && n.reviewedVersion !== '')
    || (typeof n.reviewedArtifactPath === 'string' && n.reviewedArtifactPath.trim() !== '')
    || (typeof n.reviewedRunId === 'string' && n.reviewedRunId.trim() !== '')

  if ((hasRenderVersion || hasRenderPath || hasRenderRunId) && !hasReviewedBinding) {
    return { ok: false, reason: '等待审片通过：请先针对本次渲染确认审片' }
  }
  if (n.reviewedVersion !== undefined && n.reviewedVersion !== null && n.reviewedVersion !== '' && hasRenderVersion) {
    if (Number(n.reviewedVersion) !== Number(r.version)) {
      return { ok: false, reason: '等待审片通过：已通过的审片对应旧版本渲染' }
    }
  }
  if (typeof n.reviewedArtifactPath === 'string' && n.reviewedArtifactPath.trim() !== '' && hasRenderPath) {
    if (n.reviewedArtifactPath !== r.artifactPath) {
      return { ok: false, reason: '等待审片通过：已通过的审片对应其他渲染产物' }
    }
  }
  if (typeof n.reviewedRunId === 'string' && n.reviewedRunId.trim() !== '' && hasRenderRunId) {
    if (n.reviewedRunId !== r.runId) {
      return { ok: false, reason: '等待审片通过：已通过的审片对应旧一次运行' }
    }
  }
  return { ok: true }
}

/** Deterministic port-driven executor. Work documents live on disk, not on canvas edges. */
export async function executeWorkflow(wf: Pick<WorkflowDef, 'nodes' | 'edges'>, deps: {
  resourceReferences: (nodeId: string) => unknown[]
  create: (nodeId: string, input: { prompt: string; correction?: string; references: unknown[] }) => Promise<unknown>
  saveIO: (nodeIO: Record<string, NodeIO>) => Promise<void>
  onStatus: (id: string, status: 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting_info') => void
  cancelled: () => boolean
  completedIO?: Record<string, NodeIO>
  correction?: string
}): Promise<ExecutionResult> {
  const nodeIO: Record<string, NodeIO> = structuredClone(deps.completedIO ?? {})
  const problems = workflowGraphProblems(wf.nodes, wf.edges)
  if (problems.length) return { nodeIO, status: 'failed', error: problems[0].message }
  for (const n of wf.nodes) {
    if (!SUPPORTED.has(n.type)) return { nodeIO, status: 'failed', error: `节点「${n.type}」尚无实际执行器` }
  }

  const cycle = extractReworkCorrection(wf)
  if (cycle.rework) {
    // 审片标记需要修改：清掉制作循环与交付节点旧结果，准备重跑制作循环
    for (const n of wf.nodes) {
      if (CYCLE_NODE_TYPES.has(n.type)) delete nodeIO[n.id]
    }
  }
  const effectiveCorrection = deps.correction !== undefined
    ? (deps.correction.trim() || undefined)
    : (cycle.rework && cycle.correction ? cycle.correction : undefined)

  // 交付停在「等待审片通过」时虽有输出，但并没有交付；不能当成已完成跳过，否则继续运行会显示 completed。
  const remaining = new Map(
    wf.nodes
      .filter((n) => !nodeIO[n.id] || nodeIO[n.id].error || !Object.keys(nodeIO[n.id].outputs).length
        || nodeIO[n.id].outputs.status === 'awaiting_review')
      .map((n) => [n.id, n]),
  )

  while (remaining.size) {
    if (deps.cancelled()) return { nodeIO, status: 'cancelled' }
    const node = [...remaining.values()].find((n) =>
      wf.edges.filter((e) => e.target === n.id).every((e) => nodeIO[e.source]),
    )
    if (!node) return { nodeIO, status: 'failed', error: '连接存在循环或缺少上游结果' }
    remaining.delete(node.id)
    const inputs: Record<string, unknown> = {}
    for (const e of wf.edges.filter((edge) => edge.target === node.id)) {
      const value = nodeIO[e.source]?.outputs[e.sourcePort]
      if (value === undefined) {
        return { nodeIO, status: 'failed', error: `节点「${node.type}」的输入 ${e.targetPort} 没有上游输出` }
      }
      inputs[e.targetPort] = value
    }
    const label = defForNode(node)?.label ?? node.type
    nodeIO[node.id] = { label, inputs, outputs: {} }
    deps.onStatus(node.id, 'running')
    try {
      const p = node.params
      let outputs: NodeOutput
      if (node.type === 'prompt') {
        outputs = { doc: String(p.text ?? '') }
      } else if (node.type === 'refs') {
        outputs = { refs: deps.resourceReferences(node.id) }
      } else if (node.type === 'capability') {
        outputs = { caps: deps.resourceReferences(node.id) }
      } else if (node.type === 'create') {
        const refs = [inputs.refs, inputs.caps].flatMap((v) => (Array.isArray(v) ? v : []))
        const promptText = typeof inputs.prompt === 'string' ? inputs.prompt : ''
        const result = await deps.create(node.id, {
          prompt: promptText,
          ...(effectiveCorrection ? { correction: effectiveCorrection } : {}),
          references: refs,
        }) as { state: string; reply?: string; artifactPath?: string }
        outputs = { render: result }
        if (result.state === 'failed') throw new Error(result.reply || '制作失败')
        if (result.state === 'awaiting_info') {
          nodeIO[node.id].outputs = outputs
          deps.onStatus(node.id, 'awaiting_info')
          await deps.saveIO(nodeIO)
          for (const n of remaining.values()) deps.onStatus(n.id, 'skipped')
          return { nodeIO, status: 'awaiting_info' }
        }
      } else if (node.type === 'review') {
        const checks = (p.checks as Record<string, unknown> | undefined) ?? {}
        const customChecklist = Array.isArray(p.customChecklist) ? p.customChecklist.map(String) : []
        const approved = checks.done === true && checks.rework !== true
        const rework = checks.rework === true && checks.done !== true
        outputs = {
          notes: {
            render: inputs.render,
            notes: p.issues ?? p.notes ?? '',
            answers: checks,
            customChecklist,
            approved,
            rework,
            reviewedVersion: p.reviewedVersion ?? null,
            reviewedArtifactPath: p.reviewedArtifactPath ?? null,
            reviewedRunId: p.reviewedRunId ?? null,
            reviewedVisualId: p.reviewedVisualId ?? null,
            automaticallyReviewed: false,
          },
        }
      } else {
        // delivery: 确定性交付节点，不调用 agent
        const verdict = isLatestRenderApproved(inputs.render, inputs.notes)
        if (!verdict.ok) {
          outputs = {
            render: null,
            notes: inputs.notes ?? null,
            delivered: false,
            status: 'awaiting_review',
            reason: verdict.reason ?? '等待审片通过',
          }
          nodeIO[node.id].outputs = outputs
          deps.onStatus(node.id, 'awaiting_info')
          await deps.saveIO(nodeIO)
          for (const n of remaining.values()) deps.onStatus(n.id, 'skipped')
          return { nodeIO, status: 'awaiting_info' }
        }
        outputs = {
          render: inputs.render,
          notes: inputs.notes ?? null,
          delivered: true,
          status: 'delivered',
        }
      }
      nodeIO[node.id].outputs = outputs
      deps.onStatus(node.id, 'completed')
      await deps.saveIO(nodeIO)
    } catch (error) {
      if ((error as { outcomeUnknown?: boolean }).outcomeUnknown) {
        nodeIO[node.id].error = error instanceof Error ? error.message : '结果未确认'
        await deps.saveIO(nodeIO)
        return { nodeIO, status: 'running', error: nodeIO[node.id].error }
      }
      if (deps.cancelled()) {
        nodeIO[node.id].error = '制作已取消'
        deps.onStatus(node.id, 'skipped')
        await deps.saveIO(nodeIO)
        return { nodeIO, status: 'cancelled' }
      }
      nodeIO[node.id].error = error instanceof Error ? error.message : '执行失败'
      deps.onStatus(node.id, 'failed')
      await deps.saveIO(nodeIO)
      for (const n of remaining.values()) deps.onStatus(n.id, 'skipped')
      return { nodeIO, status: 'failed', error: nodeIO[node.id].error }
    }
  }
  return { nodeIO, status: 'completed' }
}

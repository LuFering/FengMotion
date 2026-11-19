import type { AgentTask, ChangeSet, TaskEvent, TaskStatus } from '@/api/studioApi'
import { defForNode } from '@/features/workflow/model/workflowTemplates'
import type { WorkflowDef, WfArtifact, WfNodeStatus, WorkflowRun } from '@/features/workflow/model/workflowTypes'
import { uid, loadRuns, saveRuns } from '@/features/workflow/services/workflow/store'
import { evaluateGate } from '@/features/workflow/services/workflow/gate'
import { wait, json, pfArtifact, pfValidate, type DemoRunHandle } from '@/features/workflow/services/workflow/runSteps'

/* ── 单节点运行（检查器三格契约的「只运行此节点」） ──────────────────
 * 只处理目标节点本身：PF 产该节点的工作稿/请求快照；Structured 只对该
 * 产物/Gate 做一次状态评估。同样走 demo 口径，永不代确认、永不伪造渲染。 */

export function startSingleNodeRun(
  wf: WorkflowDef,
  nodeId: string,
  callbacks: {
    onEvent: (event: TaskEvent) => void
    onNodeStatus: (nodeId: string, status: WfNodeStatus) => void
  },
): DemoRunHandle {
  const runId = uid('run')
  const taskId = uid('task')
  const startedAt = new Date().toISOString()
  const node = wf.nodes.find((n) => n.id === nodeId)
  const def = node ? defForNode(node) : undefined
  const label = def?.label ?? node?.type ?? '节点'
  const task: AgentTask = {
    id: taskId,
    kind: 'modify',
    status: 'queued',
    title: `单节点${wf.path === 'structured' ? '评估' : '运行'} · ${label}`,
    createdAt: startedAt,
    mock: true,
  }
  const events: TaskEvent[] = []
  const artifacts: WfArtifact[] = []
  const nodeStatus: Record<string, WfNodeStatus> = {}
  let cancelled = false
  const emit = (kind: TaskEvent['kind'], status: TaskStatus, message: string) => {
    const event: TaskEvent = { id: uid('evt'), taskId, kind, status, message, at: new Date().toISOString(), mock: true }
    events.push(event)
    callbacks.onEvent(event)
  }
  const setStatus = (s: WfNodeStatus) => {
    nodeStatus[nodeId] = s
    callbacks.onNodeStatus(nodeId, s)
  }

  const done = (async (): Promise<WorkflowRun> => {
    let status: TaskStatus = 'completed'
    if (!node || node.type === 'lane') {
      status = 'failed'
      emit('error', 'failed', '目标节点不存在或不可运行。')
    } else if (wf.path === 'structured' && node.type === 'gate') {
      setStatus('running')
      emit('accepted', 'queued', `单点评估已接收：${label}。只评估该检查点当前状态，不代替用户确认。`)
      await wait(240)
      if (cancelled) {
        status = 'cancelled'
        setStatus('skipped')
        emit('cancelled', 'cancelled', '单点评估已取消。')
      } else {
        const ev = evaluateGate(wf, node)
        artifacts.push({
          id: uid('art'),
          nodeId: node.id,
          nodeType: 'gate',
          kind: 'gate-eval',
          title: `${label} · 单点评估`,
          filename: `gate-${ev.gate}-eval.json`,
          summary: `${ev.label}：${ev.decision === 'confirmed' ? (ev.stale ? '已确认（版本已变更，确认失效）' : '已确认') : ev.decision === 'pending' ? '待确认' : '未开始'}${ev.blocked.length ? `；阻塞 ${ev.blocked.length} 项` : ''}`,
          content: json({ gate: ev.gate, label: ev.label, decision: ev.decision, stale: ev.stale, blocked: ev.blocked, primary: ev.primaryKind, primaryStatus: ev.primaryStatus, note: '单点评估快照：反映评估时刻状态，不构成确认。' }),
          demo: true,
        })
        setStatus('completed')
        emit('complete', 'completed', `${label} 单点评估结束：状态已记录，未做任何确认。`)
      }
    } else if (wf.path === 'structured') {
      setStatus('running')
      emit('accepted', 'queued', `单点评估已接收：${label}。只清点该产物当前状态，不生成新产物。`)
      await wait(240)
      if (cancelled) {
        status = 'cancelled'
        setStatus('skipped')
        emit('cancelled', 'cancelled', '单点评估已取消。')
      } else {
        const kind = String(node.params.kind ?? '')
        const st = String(node.params.status ?? 'missing')
        artifacts.push({
          id: uid('art'),
          nodeId: node.id,
          nodeType: 'artifact',
          kind: 'artifact-eval',
          title: `${label} · 状态快照`,
          filename: `${kind || 'artifact'}-status.json`,
          summary: st === 'missing' ? `${label}：尚无产物` : `${label}：${st}${node.params.version ? ` · ${String(node.params.version)}` : ''}`,
          content: json({ kind, status: st, version: String(node.params.version ?? ''), summary: String(node.params.summary ?? ''), fixture: !!node.params.fixture, note: '单点状态快照：反映评估时刻的工作流内记录。' }),
          demo: true,
        })
        setStatus(st === 'missing' ? 'skipped' : 'completed')
        emit('complete', 'completed', `${label} 单点评估结束。`)
      }
    } else {
      const problem = pfValidate(wf, node)
      if (problem) {
        status = 'failed'
        setStatus('failed')
        emit('error', 'failed', problem)
      } else {
        setStatus('running')
        emit('accepted', 'queued', `单节点运行已接收：${label}。只运行此节点，不带动上下游（DEMO）。`)
        await wait(380)
        if (cancelled) {
          status = 'cancelled'
          setStatus('skipped')
          emit('cancelled', 'cancelled', '单节点运行已取消。')
        } else {
          const artifact = pfArtifact(node)
          artifacts.push(artifact)
          setStatus('completed')
          emit('build', 'building', `${label}：${artifact.summary}`)
          emit('complete', 'completed', '单节点运行结束：产物为该节点的工作稿/引用/请求记录快照。')
        }
      }
    }
    task.status = status
    const changes: ChangeSet | null =
      artifacts.length > 0
        ? {
            taskId,
            files: artifacts.map((a) => ({ path: `artifacts/${a.filename}`, summary: a.summary, additions: a.content.split('\n').length, deletions: 0 })),
            buildStatus: status === 'completed' ? 'passed' : 'failed',
            mock: true,
          }
        : null
    const run: WorkflowRun = {
      id: runId,
      workflowId: wf.id,
      workflowName: wf.name,
      revision: wf.revision,
      projectId: wf.projectId,
      nodeLabels: Object.fromEntries(wf.nodes.filter((n) => n.type !== 'lane').map((n) => [n.id, defForNode(n)?.label ?? n.type])),
      executionMode: wf.path === 'structured' ? 'evaluation' : 'single-demo',
      status,
      task,
      events,
      artifacts,
      changes,
      nodeStatus,
      startedAt,
      finishedAt: new Date().toISOString(),
      demo: true,
    }
    const runs = loadRuns()
    runs.push(run)
    saveRuns(runs)
    return run
  })()

  return { runId, done, cancel: () => { cancelled = true } }
}

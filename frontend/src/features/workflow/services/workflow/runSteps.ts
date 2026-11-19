import { defForNode, type WfEdgeInstance, type WfNodeInstance } from '@/features/workflow/model/workflowTemplates'
import { BUILTIN_ASSETS } from '@/features/assets/model/myAssets'
import { FX_TECHNIQUES } from '@/features/fx/model/fxTechniques'
import { REFERENCE_SEGMENTS, REFERENCE_VIDEOS } from '@/features/reference/model/referenceLibrary'
import type { WorkflowDef, WfArtifact, WorkflowRun } from '@/features/workflow/model/workflowTypes'
import { uid } from '@/features/workflow/services/workflow/store'

/* ── Demo 执行器 ─────────────────────────────────────────────────── */

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export const QUALITY_QUESTIONS = [
  '叙事是否一眼看懂',
  '镜头衔接是否顺畅',
  '声音与节奏是否支撑内容',
  '视觉高潮是否成立',
  '结尾是否有余像',
]

export function topoOrder(wf: WorkflowDef): WfNodeInstance[] | null {
  const nodes = wf.nodes.filter((n) => n.type !== 'lane')
  const ids = new Set(nodes.map((n) => n.id))
  if (ids.size !== nodes.length || wf.edges.some((e) => !ids.has(e.source) || !ids.has(e.target))) return null
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  for (const e of wf.edges) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0)
  const order: WfNodeInstance[] = []
  const rest = [...nodes]
  while (queue.length > 0) {
    const node = queue.shift()!
    order.push(node)
    rest.splice(rest.indexOf(node), 1)
    for (const e of wf.edges.filter((x) => x.source === node.id)) {
      const d = (indegree.get(e.target) ?? 1) - 1
      indegree.set(e.target, d)
      if (d === 0) {
        const next = rest.find((n) => n.id === e.target)
        if (next) queue.push(next)
      }
    }
  }
  return order.length === nodes.length ? order : null
}

export function incoming(wf: WorkflowDef, nodeId: string, port: string): WfEdgeInstance | undefined {
  return wf.edges.find((e) => e.target === nodeId && e.targetPort === port)
}

export const json = (v: unknown) => JSON.stringify(v, null, 2)

export function pfArtifact(node: WfNodeInstance): WfArtifact {
  const base = { id: uid('art'), nodeId: node.id, nodeType: node.type, demo: true }
  const p = node.params
  switch (node.type) {
    case 'prompt': {
      const data = {
        text: String(p.text ?? ''),
        audience: String(p.audience ?? ''),
        duration: String(p.duration ?? ''),
        ratio: String(p.ratio ?? '16:9'),
        source: '用户原始输入快照',
      }
      return { ...base, kind: 'prompt', title: '提示词输入 · 原始快照', filename: 'prompt.original.md', summary: data.text ? `原始提示词：${data.text.slice(0, 24)}${data.text.length > 24 ? '…' : ''}` : '原始提示词快照', content: json(data) }
    }
    case 'refs': {
      const assetIds = (p.assetIds as string[] | undefined) ?? []
      const assets = assetIds
        .map((id) => BUILTIN_ASSETS.find((a) => a.id === id))
        .filter(Boolean)
        .map((a) => ({ id: a!.id, name: a!.name, mediaType: a!.mediaType }))
      const segIds = (p.refSegmentIds as string[] | undefined) ?? []
      const segments = segIds.map((id) => {
        const seg = REFERENCE_SEGMENTS.find((s) => s.id === id)
        const film = seg ? REFERENCE_VIDEOS.find((v) => v.id === seg.videoId) : null
        return seg
          ? { segmentId: seg.id, film: film?.title ?? seg.videoId, index: seg.index + 1, observation: seg.observation, suggestion: seg.suggestion }
          : { segmentId: id, film: '（来源已失效）', index: 0, observation: '', suggestion: '' }
      })
      const data = { projectId: String(p.projectId ?? ''), assets, referenceSegments: segments }
      return { ...base, kind: 'refs', title: '参考与素材 · 引用清单', filename: 'refs.json', summary: `引用清单 · ${assets.length} 项素材 / ${segments.length} 条参考结论（只引用）`, content: json(data) }
    }
    case 'capability': {
      const ids = (p.techniqueIds as string[] | undefined) ?? []
      const items = ids
        .map((id) => FX_TECHNIQUES.find((t) => t.id === id))
        .filter(Boolean)
        .map((t) => ({ id: t!.id, name: t!.name, execType: t!.execType, execLabel: t!.execLabel, note: '检索候选，未执行' }))
      const data = { source: '能力注册表快照（本地特效技法库）', items }
      return { ...base, kind: 'capability', title: '能力检索 · 候选快照', filename: 'capability-refs.json', summary: items.length ? `能力候选 · ${items.length} 项（只检索，不执行）` : '能力候选 · 空（未选择）', content: json(data) }
    }
    case 'create': {
      const data = {
        mode: String(p.mode ?? 'sketch'),
        resolution: String(p.resolution ?? '1080p'),
        status: 'demo-request',
        note: '这是渲染请求记录：demo 未接入真实渲染，没有视频产物生成。',
      }
      return { ...base, kind: 'create', title: '创作与渲染 · 请求记录', filename: 'render-request.json', summary: `渲染请求（${data.mode} / ${data.resolution}）· 未实际渲染`, content: json(data) }
    }
    case 'review': {
      const checks = (p.checks as Record<string, boolean> | undefined) ?? {}
      const data = {
        issues: String(p.issues ?? ''),
        qualityBar: QUALITY_QUESTIONS.map((q) => ({ question: q, checkedByUser: !!checks[q] })),
        approved: !!checks.done && !checks.rework,
        rework: !!checks.rework && !checks.done,
        note: '未勾选的问题视为尚未看片确认；demo 不生成「检查通过」。',
      }
      const done = data.qualityBar.filter((x) => x.checkedByUser).length
      return { ...base, kind: 'review', title: '看片与修改 · 记录快照', filename: 'review-notes.json', summary: `看片记录 · quality-bar 已确认 ${done}/${QUALITY_QUESTIONS.length}`, content: json(data) }
    }
    case 'delivery': {
      const data = { notes: String(p.notes ?? ''), source: '确定性交付节点（演示快照）' }
      return { ...base, kind: 'delivery', title: '交付 · 记录快照', filename: 'delivery.json', summary: data.notes ? `交付记录 · ${data.notes.length} 字` : '交付 · 等待审片通过后输出', content: json(data) }
    }
    default:
      throw new Error(`未知节点类型 ${node.type}`)
  }
}

export function pfValidate(wf: WorkflowDef, node: WfNodeInstance): string | null {
  const def = defForNode(node)
  if (!def) return `已停用或未知节点 ${node.type}`
  for (const port of def.inputs.filter((x) => x.required)) {
    if (!incoming(wf, node.id, port.id)) return `${def.label}：必填输入「${port.label}」未连接`
  }
  if (node.type === 'prompt' && !String(node.params.text ?? '').trim()) return '提示词输入：提示词为空'
  return null
}

export interface DemoRunHandle {
  runId: string
  done: Promise<WorkflowRun>
  cancel: () => void
}

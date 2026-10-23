/**
 * 工作流服务层（第一期 · Mock 适配器）
 *
 * 页面只经此层读写工作流与运行记录，不在组件里直碰 localStorage。
 * 形状对齐冻结契约：运行的 task/events 复用 studioApi 的 AgentTask /
 * TaskEvent，产物变更摘要复用 ChangeSet；将来换真实适配器时页面不改。
 *
 * Demo 执行器边界（如实标注）：只做编排校验与结构化产物生成，
 * 不合成语音、不执行技法、不渲染视频。每个产物 demo: true。
 */
import type { AgentTask, ChangeSet, TaskEvent, TaskStatus } from './studioApi'
import {
  WF_NODE_DEF_MAP,
  WORKFLOW_TEMPLATES,
  type WfEdgeInstance,
  type WfNodeInstance,
} from '../data/workflowTemplates'
import { STORYBOARD } from '../data/productionData'
import { BUILTIN_ASSETS } from '../data/myAssets'
import { FX_TECHNIQUES } from '../data/fxTechniques'
import { REFERENCE_SEGMENTS, REFERENCE_VIDEOS } from '../data/referenceLibrary'

export interface WorkflowDef {
  id: string
  name: string
  description: string
  projectId: string | null
  sourceTemplateId: string | null
  templateVersion: string | null
  revision: number
  createdAt: string
  updatedAt: string
  nodes: WfNodeInstance[]
  edges: WfEdgeInstance[]
}

export interface WfArtifact {
  id: string
  nodeId: string
  nodeType: string
  kind: 'script' | 'media' | 'voiceover' | 'shotplan' | 'technique' | 'spec'
  title: string
  filename: string
  summary: string
  content: string
  demo: true
}

export type WfNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface WorkflowRun {
  id: string
  workflowId: string
  workflowName: string
  revision: number
  status: TaskStatus
  task: AgentTask
  events: TaskEvent[]
  artifacts: WfArtifact[]
  changes: ChangeSet | null
  nodeStatus: Record<string, WfNodeStatus>
  startedAt: string
  finishedAt: string | null
  demo: true
}

const WF_KEY = 'fm-workflows-v1'
const RUN_KEY = 'fm-workflow-runs-v1'

let uidCounter = 0
function uid(prefix: string): string {
  uidCounter += 1
  return `${prefix}-${Date.now().toString(36)}${uidCounter.toString(36)}`
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存储不可用时仅内存生效 */
  }
}

function seedWorkflows(): WorkflowDef[] {
  const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === 'tpl-talking-explainer')!
  const now = new Date().toISOString()
  return [
    {
      id: 'wf-token-explainer',
      name: 'Token 科普视频 · 口播流程',
      description: '由「口播科普」模板创建，对着 Token 科普视频真实工程的流程定义。',
      projectId: 'token',
      sourceTemplateId: tpl.id,
      templateVersion: tpl.version,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      nodes: structuredClone(tpl.graph!.nodes),
      edges: structuredClone(tpl.graph!.edges),
    },
  ]
}

function loadWorkflows(): WorkflowDef[] {
  const list = readJson<WorkflowDef[]>(WF_KEY, [])
  if (list.length === 0) {
    const seeded = seedWorkflows()
    writeJson(WF_KEY, seeded)
    return seeded
  }
  return list
}

function loadRuns(): WorkflowRun[] {
  return readJson<WorkflowRun[]>(RUN_KEY, [])
}

function saveRuns(runs: WorkflowRun[]) {
  writeJson(RUN_KEY, runs.slice(0, 60))
}

export const workflowService = {
  listWorkflows(): WorkflowDef[] {
    return loadWorkflows().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },

  getWorkflow(id: string): WorkflowDef | null {
    return loadWorkflows().find((w) => w.id === id) ?? null
  },

  createFromTemplate(templateId: string, name?: string): WorkflowDef | null {
    const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === templateId)
    if (!tpl || tpl.status !== 'ready' || !tpl.graph) return null
    const now = new Date().toISOString()
    const wf: WorkflowDef = {
      id: uid('wf'),
      name: name ?? `${tpl.name}流程`,
      description: `由模板「${tpl.name}」${tpl.version} 创建。`,
      projectId: templateId === 'tpl-talking-explainer' ? 'token' : null,
      sourceTemplateId: tpl.id,
      templateVersion: tpl.version,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      nodes: structuredClone(tpl.graph.nodes),
      edges: structuredClone(tpl.graph.edges),
    }
    const list = loadWorkflows()
    list.push(wf)
    writeJson(WF_KEY, list)
    return wf
  },

  createBlank(name: string): WorkflowDef {
    const now = new Date().toISOString()
    const wf: WorkflowDef = {
      id: uid('wf'),
      name,
      description: '',
      projectId: null,
      sourceTemplateId: null,
      templateVersion: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      nodes: [],
      edges: [],
    }
    const list = loadWorkflows()
    list.push(wf)
    writeJson(WF_KEY, list)
    return wf
  },

  saveWorkflow(id: string, patch: { name?: string; description?: string; nodes: WfNodeInstance[]; edges: WfEdgeInstance[] }): WorkflowDef | null {
    const list = loadWorkflows()
    const at = list.findIndex((w) => w.id === id)
    if (at < 0) return null
    const next: WorkflowDef = {
      ...list[at],
      name: patch.name ?? list[at].name,
      description: patch.description ?? list[at].description,
      nodes: patch.nodes,
      edges: patch.edges,
      revision: list[at].revision + 1,
      updatedAt: new Date().toISOString(),
    }
    list[at] = next
    writeJson(WF_KEY, list)
    return next
  },

  renameWorkflow(id: string, name: string) {
    const list = loadWorkflows()
    const wf = list.find((w) => w.id === id)
    if (!wf) return
    wf.name = name
    wf.updatedAt = new Date().toISOString()
    writeJson(WF_KEY, list)
  },

  duplicateWorkflow(id: string): WorkflowDef | null {
    const src = loadWorkflows().find((w) => w.id === id)
    if (!src) return null
    const now = new Date().toISOString()
    const copy: WorkflowDef = {
      ...structuredClone(src),
      id: uid('wf'),
      name: `${src.name} · 副本`,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    const list = loadWorkflows()
    list.push(copy)
    writeJson(WF_KEY, list)
    return copy
  },

  deleteWorkflow(id: string) {
    writeJson(WF_KEY, loadWorkflows().filter((w) => w.id !== id))
  },

  listRuns(workflowId?: string): WorkflowRun[] {
    return loadRuns()
      .filter((r) => !workflowId || r.workflowId === workflowId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  },

  getRun(id: string): WorkflowRun | null {
    return loadRuns().find((r) => r.id === id) ?? null
  },
}

/* ── Demo 执行器 ─────────────────────────────────────────────────── */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function topoOrder(wf: WorkflowDef): WfNodeInstance[] {
  const indegree = new Map<string, number>(wf.nodes.map((n) => [n.id, 0]))
  for (const e of wf.edges) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
  const queue = wf.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0)
  const order: WfNodeInstance[] = []
  const rest = [...wf.nodes]
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
  return order.length === wf.nodes.length ? order : wf.nodes
}

function incoming(wf: WorkflowDef, nodeId: string, port: string): WfEdgeInstance | undefined {
  return wf.edges.find((e) => e.target === nodeId && e.targetPort === port)
}

interface NodeOutput {
  kind: WfArtifact['kind']
  data: Record<string, unknown>
}

function buildArtifact(
  wf: WorkflowDef,
  node: WfNodeInstance,
  outputs: Map<string, NodeOutput>,
): { artifact: WfArtifact; output: NodeOutput } {
  const label = WF_NODE_DEF_MAP[node.type]?.label ?? node.type
  const base = { id: uid('art'), nodeId: node.id, nodeType: node.type, demo: true as const }
  const json = (v: unknown) => JSON.stringify(v, null, 2)

  switch (node.type) {
    case 'script': {
      const text = String(node.params.text ?? '')
      const paragraphs = text.split('\n').map((s) => s.trim()).filter(Boolean)
      const data = { title: String(node.params.title ?? '未命名脚本'), paragraphs, charCount: text.length }
      return {
        output: { kind: 'script', data },
        artifact: { ...base, kind: 'script', title: `${label} · 脚本快照`, filename: 'script-snapshot.json', summary: `脚本快照 · ${paragraphs.length} 段 · ${text.length} 字`, content: json(data) },
      }
    }
    case 'media': {
      const ids = (node.params.assetIds as string[] | undefined) ?? []
      const items = ids
        .map((id) => BUILTIN_ASSETS.find((a) => a.id === id))
        .filter(Boolean)
        .map((a) => ({ id: a!.id, name: a!.name, mediaType: a!.mediaType }))
      const data = { projectId: String(node.params.projectId ?? ''), items }
      return {
        output: { kind: 'media', data },
        artifact: { ...base, kind: 'media', title: `${label} · 引用清单`, filename: 'media-refs.json', summary: `引用清单 · ${items.length} 项真实素材（只引用，未复制文件）`, content: json(data) },
      }
    }
    case 'voiceover': {
      const scriptOut = [...outputs.values()].find((o) => o.kind === 'script')
      const paragraphs = (scriptOut?.data.paragraphs as string[] | undefined) ?? []
      const segments = paragraphs.map((text, i) => ({
        index: i + 1,
        text,
        estSeconds: Math.max(1, Math.round((text.length / 4.5) * 10) / 10),
      }))
      const data = {
        voiceLabel: String(node.params.voiceLabel ?? ''),
        rate: String(node.params.rate ?? '正常'),
        segments,
        totalEstSeconds: Math.round(segments.reduce((s, x) => s + x.estSeconds, 0) * 10) / 10,
        note: '时长按字数估算；demo 执行器不合成语音，无音频文件产生。',
      }
      return {
        output: { kind: 'voiceover', data },
        artifact: { ...base, kind: 'voiceover', title: `${label} · 配音计划`, filename: 'voiceover-plan.json', summary: `配音计划 · ${segments.length} 段 · 估算 ${data.totalEstSeconds}s（未合成音频）`, content: json(data) },
      }
    }
    case 'shotplan': {
      const refIds = (node.params.refSegmentIds as string[] | undefined) ?? []
      const references = refIds.map((id) => {
        const seg = REFERENCE_SEGMENTS.find((s) => s.id === id)
        const film = seg ? REFERENCE_VIDEOS.find((v) => v.id === seg.videoId) : null
        return seg
          ? { segmentId: seg.id, film: film?.title ?? seg.videoId, index: seg.index + 1, observation: seg.observation, suggestion: seg.suggestion }
          : { segmentId: id, film: '（来源已失效）', index: 0, observation: '', suggestion: '' }
      })
      const data = {
        baseline: 'Token 科普视频真实工程分镜（演示基线，非本次新生成）',
        note: String(node.params.note ?? ''),
        shotCount: STORYBOARD.length,
        shots: STORYBOARD.map((s) => ({ seg: s.段, timecode: s.时间码, narration: s.旁白, visual: s.画面 })),
        references,
      }
      return {
        output: { kind: 'shotplan', data },
        artifact: { ...base, kind: 'shotplan', title: `${label} · 分镜计划快照`, filename: 'shot-plan.json', summary: `分镜计划 · ${STORYBOARD.length} 段（真实工程基线）${references.length ? ` · 附 ${references.length} 条参考结论` : ''}`, content: json(data) },
      }
    }
    case 'technique': {
      const ids = (node.params.techniqueIds as string[] | undefined) ?? []
      const items = ids
        .map((id) => FX_TECHNIQUES.find((t) => t.id === id))
        .filter(Boolean)
        .map((t) => ({ id: t!.id, name: t!.name, execType: t!.execType, execLabel: t!.execLabel, note: '仅引用记录，demo 不执行该技法' }))
      const data = { items }
      return {
        output: { kind: 'technique', data },
        artifact: { ...base, kind: 'technique', title: `${label} · 技法引用清单`, filename: 'technique-refs.json', summary: items.length ? `技法引用 · ${items.length} 项（只引用，不执行）` : '技法引用 · 空（未选择技法）', content: json(data) },
      }
    }
    case 'compose': {
      const shots = [...outputs.values()].find((o) => o.kind === 'shotplan')
      const voice = [...outputs.values()].find((o) => o.kind === 'voiceover')
      const media = [...outputs.values()].find((o) => o.kind === 'media')
      const tech = [...outputs.values()].find((o) => o.kind === 'technique')
      const data = {
        projectId: String(node.params.projectId ?? 'token'),
        spec: { resolution: String(node.params.resolution ?? '1080p'), width: 1920, height: 1080, fps: 30 },
        shotCount: (shots?.data.shotCount as number | undefined) ?? 0,
        voiceSegments: ((voice?.data.segments as unknown[] | undefined) ?? []).length,
        mediaRefs: ((media?.data.items as unknown[] | undefined) ?? []).length,
        techniques: ((tech?.data.items as Array<{ name: string }> | undefined) ?? []).map((t) => t.name),
        render: '未渲染：demo 执行器只生成工程描述，不产生视频文件。',
        workflow: { id: wf.id, name: wf.name, revision: wf.revision },
      }
      return {
        output: { kind: 'spec', data },
        artifact: { ...base, kind: 'spec', title: `${label} · 工程描述`, filename: 'remotion-spec.json', summary: `工程描述 · ${data.shotCount} 段分镜 / ${data.voiceSegments} 段配音 / ${data.mediaRefs} 项素材（未渲染视频）`, content: json(data) },
      }
    }
    default:
      throw new Error(`未知节点类型 ${node.type}`)
  }
}

function validateNode(wf: WorkflowDef, node: WfNodeInstance): string | null {
  const def = WF_NODE_DEF_MAP[node.type]
  if (!def) return `未知节点类型 ${node.type}`
  for (const port of def.inputs.filter((p) => p.required)) {
    if (!incoming(wf, node.id, port.id)) return `${def.label}：必填输入「${port.label}」未连接`
  }
  if (node.type === 'script' && !String(node.params.text ?? '').trim()) return '脚本输入：脚本正文为空'
  if (node.type === 'media' && ((node.params.assetIds as string[] | undefined) ?? []).length === 0)
    return '素材引用：未选择任何素材'
  return null
}

export interface DemoRunHandle {
  runId: string
  done: Promise<WorkflowRun>
  cancel: () => void
}

export function startDemoRun(
  wf: WorkflowDef,
  callbacks: {
    onEvent: (event: TaskEvent) => void
    onNodeStatus: (nodeId: string, status: WfNodeStatus) => void
  },
): DemoRunHandle {
  const runId = uid('run')
  const taskId = uid('task')
  const startedAt = new Date().toISOString()
  const task: AgentTask = {
    id: taskId,
    kind: 'modify',
    status: 'queued',
    title: `演示运行 · ${wf.name}`,
    createdAt: startedAt,
    mock: true,
  }
  const events: TaskEvent[] = []
  const artifacts: WfArtifact[] = []
  const nodeStatus: Record<string, WfNodeStatus> = Object.fromEntries(wf.nodes.map((n) => [n.id, 'pending' as WfNodeStatus]))
  let cancelled = false

  const emit = (kind: TaskEvent['kind'], status: TaskStatus, message: string) => {
    const event: TaskEvent = { id: uid('evt'), taskId, kind, status, message, at: new Date().toISOString(), mock: true }
    events.push(event)
    callbacks.onEvent(event)
  }

  const done = (async (): Promise<WorkflowRun> => {
    let status: TaskStatus = 'completed'
    emit('accepted', 'queued', `演示执行器已接收运行请求（工作流 ${wf.name} · 修订 ${wf.revision}）。Agent 后端未连接，本次为 DEMO 运行。`)
    const outputs = new Map<string, NodeOutput>()
    const order = topoOrder(wf)
    for (const node of order) {
      if (cancelled) {
        status = 'cancelled'
        nodeStatus[node.id] = 'skipped'
        callbacks.onNodeStatus(node.id, 'skipped')
        continue
      }
      const label = WF_NODE_DEF_MAP[node.type]?.label ?? node.type
      const problem = validateNode(wf, node)
      if (problem) {
        nodeStatus[node.id] = 'failed'
        callbacks.onNodeStatus(node.id, 'failed')
        emit('error', 'failed', problem)
        status = 'failed'
        for (const rest of order.slice(order.indexOf(node) + 1)) {
          nodeStatus[rest.id] = 'skipped'
          callbacks.onNodeStatus(rest.id, 'skipped')
        }
        break
      }
      nodeStatus[node.id] = 'running'
      callbacks.onNodeStatus(node.id, 'running')
      emit('progress', 'running', `${label}：开始处理。`)
      await wait(420)
      if (cancelled) {
        nodeStatus[node.id] = 'skipped'
        callbacks.onNodeStatus(node.id, 'skipped')
        status = 'cancelled'
        continue
      }
      const { artifact, output } = buildArtifact(wf, node, outputs)
      outputs.set(node.id, output)
      artifacts.push(artifact)
      nodeStatus[node.id] = 'completed'
      callbacks.onNodeStatus(node.id, 'completed')
      emit('build', 'building', `${label}：${artifact.summary}`)
    }
    if (status === 'completed') emit('complete', 'completed', '演示运行结束：已生成结构化演示产物；未调用 AI、未合成语音、未渲染视频。')
    if (status === 'cancelled') emit('cancelled', 'cancelled', '演示运行已取消；已生成的产物保留在本次运行记录中。')
    task.status = status
    const changes: ChangeSet | null =
      artifacts.length > 0
        ? {
            taskId,
            files: artifacts.map((a) => ({
              path: `artifacts/${a.filename}`,
              summary: a.summary,
              additions: a.content.split('\n').length,
              deletions: 0,
            })),
            buildStatus: status === 'completed' ? 'passed' : 'failed',
            mock: true,
          }
        : null
    const run: WorkflowRun = {
      id: runId,
      workflowId: wf.id,
      workflowName: wf.name,
      revision: wf.revision,
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

  return {
    runId,
    done,
    cancel: () => {
      cancelled = true
    },
  }
}

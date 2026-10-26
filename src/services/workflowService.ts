/**
 * 工作流服务层（v5 重构 · Mock 适配器）
 *
 * 页面只经此层读写。形状对齐冻结契约：运行的 task/events 复用 studioApi
 * 的 AgentTask / TaskEvent，产物变更摘要复用 ChangeSet。
 *
 * v5 语义：
 * · Prompt-first 运行 = 逐节点生成工作稿/引用/请求记录的真实快照；
 *   创作与渲染只产「渲染请求记录」，绝不伪造视频。
 * · Structured 运行 = 状态评估：按阶段清点产物与 Gate，产出状态报告；
 *   Gate 的确认只能由用户在检查器里对具体产物版本做出，运行永不代确认。
 */
import type { AgentTask, ChangeSet, TaskEvent, TaskStatus } from './studioApi'
import {
  ARTIFACT_KIND_MAP,
  GATE_DEFS,
  defForNode,
  promptFirstGraph,
  structuredGraph,
  type WfEdgeInstance,
  type WfNodeInstance,
  type WfPath,
} from '../data/workflowTemplates'
import { BUILTIN_ASSETS } from '../data/myAssets'
import { FX_TECHNIQUES } from '../data/fxTechniques'
import { REFERENCE_SEGMENTS, REFERENCE_VIDEOS } from '../data/referenceLibrary'

export interface WorkflowDef {
  id: string
  name: string
  description: string
  path: WfPath
  presetId: string
  projectId: string | null
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
  kind: string
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

const WF_KEY = 'fm-workflows-v2'
const RUN_KEY = 'fm-workflow-runs-v2'

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
  const now = new Date().toISOString()
  const pf = promptFirstGraph('talking')
  const st = structuredGraph()
  const brief = st.nodes.find((n) => n.id === 'a-intent-brief')
  if (brief) {
    brief.params = {
      kind: 'intent-brief',
      status: 'draft',
      version: 'v1',
      summary: '面向 AI 初学者讲清 Token 的定义、计费与上下文（演示快照，整理自项目既有口播稿与分镜基线）',
      fixture: true,
    }
  }
  return [
    {
      id: 'wf-token-pf',
      name: 'Token 科普视频',
      description: '默认路径：从提示词直接创作。带 Token 项目的真实素材引用作基线。',
      path: 'prompt-first',
      presetId: 'talking',
      projectId: 'token',
      revision: 1,
      createdAt: now,
      updatedAt: now,
      nodes: pf.nodes,
      edges: pf.edges,
    },
    {
      id: 'wf-token-structured',
      name: 'Token 科普视频',
      description: '按需路径：阶段泳道 + Gate 检查点的演示骨架；产物状态如实为空缺起步。',
      path: 'structured',
      presetId: 'talking',
      projectId: 'token',
      revision: 1,
      createdAt: now,
      updatedAt: now,
      nodes: st.nodes,
      edges: st.edges,
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

  createFromPath(
    path: WfPath,
    presetId: string,
    name?: string,
    opts?: { projectId?: string | null; seedPrompt?: string },
  ): WorkflowDef {
    const graph = path === 'prompt-first' ? promptFirstGraph(presetId) : structuredGraph()
    /* 创作启动层带入的用户需求：PF 写进提示词节点的 text（主干第一节点），
       同时全文留在 description 里，两条路径都可追溯原始需求。 */
    const seed = opts?.seedPrompt?.trim()
    if (seed && path === 'prompt-first') {
      const promptNode = graph.nodes.find((n) => n.type === 'prompt')
      if (promptNode) promptNode.params = { ...promptNode.params, text: seed }
    }
    const now = new Date().toISOString()
    const wf: WorkflowDef = {
      id: uid('wf'),
      name: name ?? (path === 'prompt-first' ? '未命名创作' : '未命名结构化制作'),
      description: seed ?? '',
      path,
      presetId,
      projectId: opts?.projectId !== undefined ? opts.projectId : presetId === 'talking' ? 'token' : null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      nodes: graph.nodes,
      edges: graph.edges,
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
}

/* ── Gate 评估（首页与检查器共用同一口径） ─────────────────────── */

/** 每个 Gate 的主检产物：确认与阻塞都对着它算 */
export const GATE_PRIMARY_KIND: Record<string, string> = {
  ref: 'reference-decision',
  A: 'direction-samples',
  B: 'scene-layouts',
  C: 'proof-10s',
  D: 'delivery',
}

export interface GateEval {
  gate: string
  label: string
  decision: 'not-started' | 'pending' | 'confirmed'
  stale: boolean
  blocked: string[]
  primaryKind: string
  primaryStatus: string
}

export function evaluateGate(wf: WorkflowDef, gateNode: WfNodeInstance): GateEval {
  const gate = String(gateNode.params.gate ?? 'A')
  const primaryKind = GATE_PRIMARY_KIND[gate] ?? ''
  const primary = wf.nodes.find(
    (n) => n.type === 'artifact' && String(n.params.kind ?? '') === primaryKind,
  )
  const primaryStatus = primary ? String(primary.params.status ?? 'missing') : 'missing'
  const blocked: string[] = []
  if (!primary || primaryStatus === 'missing') {
    blocked.push(`尚无主检产物：${ARTIFACT_KIND_MAP[primaryKind]?.label ?? primaryKind}`)
  }
  if (gate === 'D') {
    const qc = wf.nodes.find((n) => n.type === 'artifact' && String(n.params.kind ?? '') === 'qc')
    if (!qc || String(qc.params.status ?? 'missing') === 'missing') blocked.push('尚无 QC / 版权 / 盲评记录')
  }
  let decision = (gateNode.params.decision as GateEval['decision']) ?? 'not-started'
  if (decision !== 'confirmed' && primary && primaryStatus !== 'missing' && decision === 'not-started') {
    decision = 'pending'
  }
  const confirmedFor = gateNode.params.confirmedFor as { kind: string; version: string } | undefined
  const stale =
    decision === 'confirmed' &&
    !!confirmedFor &&
    confirmedFor.kind === primaryKind &&
    String(primary?.params.version ?? '') !== confirmedFor.version
  return {
    gate,
    label: GATE_DEFS[gate]?.label ?? `Gate ${gate}`,
    decision,
    stale,
    blocked,
    primaryKind,
    primaryStatus,
  }
}

export function gateSummaryOf(wf: WorkflowDef): GateEval[] {
  return wf.nodes
    .filter((n) => n.type === 'gate')
    .map((n) => evaluateGate(wf, n))
}

/* ── Demo 执行器 ─────────────────────────────────────────────────── */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export const QUALITY_QUESTIONS = [
  '叙事是否一眼看懂',
  '镜头衔接是否顺畅',
  '声音与节奏是否支撑内容',
  '视觉高潮是否成立',
  '结尾是否有余像',
]

function topoOrder(wf: WorkflowDef): WfNodeInstance[] {
  const nodes = wf.nodes.filter((n) => n.type !== 'lane')
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
  return order.length === nodes.length ? order : nodes
}

function incoming(wf: WorkflowDef, nodeId: string, port: string): WfEdgeInstance | undefined {
  return wf.edges.find((e) => e.target === nodeId && e.targetPort === port)
}

const json = (v: unknown) => JSON.stringify(v, null, 2)

function pfArtifact(node: WfNodeInstance): WfArtifact {
  const base = { id: uid('art'), nodeId: node.id, nodeType: node.type, demo: true as const }
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
    case 'lookdev': {
      const data = { status: 'draft', summary: String(p.summary ?? ''), source: '用户工作稿快照；demo 不做 AI 视觉转译' }
      return { ...base, kind: 'lookdev', title: 'Lookdev · 工作稿快照', filename: 'lookdev.md', summary: `Lookdev 工作稿（draft）· ${data.summary.length} 字`, content: json(data) }
    }
    case 'filmplan': {
      const data = { status: 'draft', summary: String(p.summary ?? ''), source: '用户工作稿快照；demo 不生成导演方案' }
      return { ...base, kind: 'filmplan', title: 'Film-plan · 工作稿快照', filename: 'film-plan.md', summary: `Film-plan 工作稿（draft）· ${data.summary.length} 字`, content: json(data) }
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
        note: '未勾选的问题视为尚未看片确认；demo 不生成「检查通过」。',
      }
      const done = data.qualityBar.filter((x) => x.checkedByUser).length
      return { ...base, kind: 'review', title: '看片与修改 · 记录快照', filename: 'review-notes.json', summary: `看片记录 · quality-bar 已确认 ${done}/${QUALITY_QUESTIONS.length}`, content: json(data) }
    }
    case 'finishing': {
      const data = { notes: String(p.notes ?? ''), source: '用户 Finishing 记录快照；demo 不做 QC 判定' }
      return { ...base, kind: 'finishing', title: 'Finishing · 记录快照', filename: 'finishing-notes.json', summary: `Finishing 记录 · ${data.notes.length} 字`, content: json(data) }
    }
    default:
      throw new Error(`未知节点类型 ${node.type}`)
  }
}

function pfValidate(wf: WorkflowDef, node: WfNodeInstance): string | null {
  const def = defForNode(node)
  if (!def) return `未知节点 ${node.type}`
  for (const port of def.inputs.filter((x) => x.required)) {
    if (!incoming(wf, node.id, port.id)) return `${def.label}：必填输入「${port.label}」未连接`
  }
  if (node.type === 'prompt' && !String(node.params.text ?? '').trim()) return '提示词输入：提示词为空'
  if (node.type === 'lookdev' && !String(node.params.summary ?? '').trim()) return 'Lookdev：工作稿尚无内容'
  if (node.type === 'filmplan' && !String(node.params.summary ?? '').trim()) return 'Film-plan：工作稿尚无内容'
  return null
}

export interface DemoRunHandle {
  runId: string
  /** 运行一开始就建好的任务。任务面板要靠它把这次运行登记进共享记录 ——
      事件在 startDemoRun 返回前就已经开始 emit，拿不到 task 就没法先建记录。 */
  task: AgentTask
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
    title: wf.path === 'structured' ? `状态评估 · ${wf.name}` : `演示运行 · ${wf.name}`,
    createdAt: startedAt,
    mock: true,
  }
  const events: TaskEvent[] = []
  const artifacts: WfArtifact[] = []
  const nodeStatus: Record<string, WfNodeStatus> = Object.fromEntries(
    wf.nodes.filter((n) => n.type !== 'lane').map((n) => [n.id, 'pending' as WfNodeStatus]),
  )
  let cancelled = false
  const emit = (kind: TaskEvent['kind'], status: TaskStatus, message: string) => {
    const event: TaskEvent = { id: uid('evt'), taskId, kind, status, message, at: new Date().toISOString(), mock: true }
    events.push(event)
    callbacks.onEvent(event)
  }
  const setStatus = (id: string, s: WfNodeStatus) => {
    nodeStatus[id] = s
    callbacks.onNodeStatus(id, s)
  }

  const done = (async (): Promise<WorkflowRun> => {
    let status: TaskStatus = 'completed'
    if (wf.path === 'structured') {
      emit('accepted', 'queued', `演示评估已接收（${wf.name} · 修订 ${wf.revision}）。Structured 运行只做状态评估：清点产物与 Gate，不生成产物、不代替用户确认。`)
      const stageRows: Array<Record<string, unknown>> = []
      const arts = wf.nodes.filter((n) => n.type === 'artifact')
      for (const node of arts) {
        if (cancelled) break
        const kind = String(node.params.kind ?? '')
        const st = String(node.params.status ?? 'missing')
        setStatus(node.id, 'running')
        await wait(90)
        setStatus(node.id, st === 'missing' ? 'skipped' : 'completed')
        emit('progress', 'running', `${ARTIFACT_KIND_MAP[kind]?.label ?? kind}：${st === 'missing' ? '尚无产物' : `状态 ${st}${node.params.version ? ` · ${String(node.params.version)}` : ''}`}`)
        stageRows.push({ kind, status: st, version: String(node.params.version ?? ''), fixture: !!node.params.fixture })
      }
      const gateRows: Array<Record<string, unknown>> = []
      for (const g of wf.nodes.filter((n) => n.type === 'gate')) {
        if (cancelled) break
        const ev = evaluateGate(wf, g)
        setStatus(g.id, 'completed')
        gateRows.push({ gate: ev.gate, label: ev.label, decision: ev.decision, stale: ev.stale, blocked: ev.blocked, primary: ev.primaryKind })
        emit(
          'build',
          'building',
          `${ev.label}：${ev.decision === 'confirmed' ? (ev.stale ? '已确认（版本已变更，确认失效）' : '已确认') : ev.decision === 'pending' ? '待确认' : '未开始'}${ev.blocked.length ? `；阻塞：${ev.blocked.join('、')}` : ''}`,
        )
        await wait(90)
      }
      if (cancelled) {
        status = 'cancelled'
        emit('cancelled', 'cancelled', '评估已取消。')
      } else {
        const missing = stageRows.filter((r) => r.status === 'missing').length
        const report = {
          workflow: { id: wf.id, name: wf.name, revision: wf.revision, path: wf.path },
          artifacts: stageRows,
          gates: gateRows,
          note: '状态评估报告：反映本次评估时工作流内的产物与 Gate 状态；不代表任何产物被新生成或被确认。',
        }
        artifacts.push({
          id: uid('art'),
          nodeId: '',
          nodeType: 'evaluation',
          kind: 'evaluation',
          title: 'Structured · 状态评估报告',
          filename: 'v5-status-report.json',
          summary: `状态评估 · 产物 ${stageRows.length} 项（缺 ${missing}）/ Gate ${gateRows.length} 个`,
          content: json(report),
          demo: true,
        })
        emit('complete', 'completed', '状态评估结束：已生成评估报告；没有新产物被生成、没有 Gate 被代为确认。')
      }
    } else {
      emit('accepted', 'queued', `演示执行器已接收运行请求（${wf.name} · 修订 ${wf.revision}）。Prompt-first 路径无强制门；本次为 DEMO 运行。`)
      const order = topoOrder(wf)
      for (const node of order) {
        if (cancelled) {
          status = 'cancelled'
          setStatus(node.id, 'skipped')
          continue
        }
        const def = defForNode(node)
        const label = def?.label ?? node.type
        const problem = pfValidate(wf, node)
        if (problem) {
          setStatus(node.id, 'failed')
          emit('error', 'failed', problem)
          status = 'failed'
          for (const rest of order.slice(order.indexOf(node) + 1)) setStatus(rest.id, 'skipped')
          break
        }
        setStatus(node.id, 'running')
        emit('progress', 'running', `${label}：开始处理。`)
        await wait(380)
        if (cancelled) {
          setStatus(node.id, 'skipped')
          status = 'cancelled'
          continue
        }
        const artifact = pfArtifact(node)
        artifacts.push(artifact)
        setStatus(node.id, 'completed')
        emit('build', 'building', `${label}：${artifact.summary}`)
      }
      if (status === 'completed') emit('complete', 'completed', '演示运行结束：产物均为工作稿/引用/请求记录快照；未接入真实渲染，没有视频生成。')
      if (status === 'cancelled') emit('cancelled', 'cancelled', '演示运行已取消；已生成的产物保留在本次运行记录中。')
    }
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
            /* 一律 not-run：这次运行只产出工作稿/引用/请求记录快照，没有写项目文件、
               也没有跑构建。原先写 status === 'completed' ? 'passed' : 'failed' 会
               两头失真 —— 演示跑完显示「构建通过」（其实什么都没构建），而用户主动
               取消反而显示「构建失败」（把用户的选择说成失败）。 */
            buildStatus: 'not-run',
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

  return { runId, task, done, cancel: () => { cancelled = true } }
}

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

  return { runId, task, done, cancel: () => { cancelled = true } }
}

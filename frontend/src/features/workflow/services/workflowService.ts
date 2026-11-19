import { readHarnessSelection } from '@/features/harness/hooks/useHarnessSelection'
import { persistLocalDocument, flushLocalDocuments } from '@/shared/local-documents/localDocuments'
import { executeWorkflow, extractReworkCorrection, type NodeIO } from './workflowExecution'
import { workflowGraphProblems } from './workflowGraph'
import { migrateWorkflowDefinition } from './workflowMigration'
import {
  buildGraphFromSkillPreset,
  extractPresetMeta,
  formatApplyPresetSummary,
} from './workflowPresetBinding'
import { isPresetNotActiveError, type WorkflowPreset } from '@/api/skillPresets'
import { submitCreation, cancelCreationJob } from '@/features/creation/services/creationClient'
import { ensureCreationContext } from '@/features/creation/services/creationEntry'
/**
 * 工作流服务层（v5 重构 · schemaVersion 2）
 *
 * 页面只经此层读写。形状对齐冻结契约：运行的 task/events 复用 studioApi
 * 的 AgentTask / TaskEvent，产物变更摘要复用 ChangeSet。
 */
import type { AgentReference, AgentTask, ChangeSet, TaskEvent, TaskStatus } from '@/api/studioApi'
import { studioHttpApi } from '@/api'
import type { FilmCreateResult, WorkflowContextState } from '@/api/workflowContext'
import {
  ARTIFACT_KIND_MAP,
  GATE_DEFS,
  WORKFLOW_SCHEMA_VERSION,
  defForNode,
  promptFirstGraph,
  structuredGraph,
  type WfEdgeInstance,
  type WfNodeInstance,
  type WfPath,
  type WorkflowLegacyDrafts,
  type WorkflowPresetMeta,
} from '@/features/workflow/model/workflowTemplates'
import { BUILTIN_ASSETS } from '@/features/assets/model/myAssets'
import { FX_TECHNIQUES } from '@/features/fx/model/fxTechniques'
import { REFERENCE_SEGMENTS, REFERENCE_VIDEOS } from '@/features/reference/model/referenceLibrary'

export interface WorkflowDef {
  id: string
  name: string
  description: string
  path: WfPath
  presetId: string
  projectId: string | null
  revision: number
  schemaVersion?: number
  legacyDrafts?: WorkflowLegacyDrafts
  /** 若从后端启用的 skill 预设新建，保存其 presetId 与来源快照 */
  skillPresetId?: string | null
  skillPresetMeta?: WorkflowPresetMeta
  createdAt: string
  updatedAt: string
  nodes: WfNodeInstance[]
  edges: WfEdgeInstance[]
  resourceReferences?: AgentReference[]
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
  /**
   * 这个产物是真实文件还是界面快照。
   *
   * <p>以前这里写死 `true`，等于类型层面就规定了「所有产物都是假的」。
   * 「制作与渲染」节点现在会真的调 agent 改工程并渲染出片，
   * 那个产物必须能标记成 false，界面才不会把真视频说成演示快照。</p>
   */
  demo: boolean
}

export type WfNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting_info'

export interface WorkflowRun {
  id: string
  workflowId: string
  workflowName: string
  revision: number
  /** Immutable run identity; absent on legacy records. */
  projectId?: string | null
  executionMode?: 'project' | 'demo' | 'evaluation' | 'single-demo'
  nodeLabels?: Record<string, string>
  status: TaskStatus
  task: AgentTask
  events: TaskEvent[]
  artifacts: WfArtifact[]
  changes: ChangeSet | null
  nodeStatus: Record<string, WfNodeStatus>
  startedAt: string
  finishedAt: string | null
  demo: boolean
  nodeIO?: Record<string, NodeIO>
  definition?: WorkflowDef
  engineSelection?: ReturnType<typeof readHarnessSelection>
  nodeAttempts?: Record<string, number>
  /** 每个节点尝试的标准 UUID requestId，供后端 recordCorrection 幂等校验与断线重连复用 */
  nodeRequestIds?: Record<string, string>
  /** 本次运行提交过的审片返工签名，防止未再次审片时重复追加同一条 correction */
  submittedReworkSignature?: string
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

function writeJson(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); persistLocalDocument(key, value); return true }
  catch { return false }
}

function writeWorkflows(list: WorkflowDef[]) {
  const versions=readJson<Array<WorkflowDef & {definitionId:string}>>('fm-workflow-versions-v1',[])
  for(const wf of list) {
    const id=`${wf.id}@${wf.revision}`
    if(!versions.some(v=>v.id===id))versions.push({...structuredClone(wf),definitionId:wf.id,id})
  }
  if(!writeJson('fm-workflow-versions-v1',versions))throw new Error('工作流版本快照未能保存')
  if (!writeJson(WF_KEY, list)) throw new Error('工作流未能保存。浏览器存储可能已满或被禁用，请释放空间后重试。')
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
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
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
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      nodes: st.nodes,
      edges: st.edges,
    },
  ]
}

function loadRawWorkflows(): WorkflowDef[] {
  // An intentionally empty library must stay empty after deleting its last item.
  try {
    if (localStorage.getItem(WF_KEY) !== null) return readJson<WorkflowDef[]>(WF_KEY, [])
  } catch { return [] }
  const list = readJson<WorkflowDef[]>(WF_KEY, [])
  if (list.length === 0) {
    const seeded = seedWorkflows()
    writeJson(WF_KEY, seeded)
    return seeded
  }
  return list
}

function loadWorkflows(): WorkflowDef[] {
  // 读取时仅做纯函数内存迁移，不回写存储；下次保存时再写回。
  return loadRawWorkflows().map((w) => migrateWorkflowDefinition(w))
}

function loadRuns(): WorkflowRun[] {
  return readJson<WorkflowRun[]>(RUN_KEY, [])
}

function saveRuns(runs: WorkflowRun[]) {
  if(!writeJson(RUN_KEY, runs.slice(0,60)))throw new Error('运行记录未能保存，请释放存储空间后重试。')
}

export const workflowService = {
  listWorkflows(): WorkflowDef[] {
    return loadWorkflows().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },

  getWorkflow(id: string): WorkflowDef | null {
    return loadWorkflows().find((w) => w.id === id) ?? null
  },

  createEmpty(name = '未命名工作流'): WorkflowDef {
    const now = new Date().toISOString()
    const wf: WorkflowDef = { id: uid('wf'), name, description: '', path: 'prompt-first', presetId: 'general', projectId: null, revision: 1, schemaVersion: WORKFLOW_SCHEMA_VERSION, createdAt: now, updatedAt: now, nodes: [], edges: [] }
    const list = loadWorkflows()
    list.push(wf)
    writeWorkflows(list)
    return wf
  },

  createFromPath(
    path: WfPath,
    presetId: string,
    name?: string,
    opts?: { projectId?: string | null; seedPrompt?: string; resourceReferences?: AgentReference[] },
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
      resourceReferences: opts?.resourceReferences ? structuredClone(opts.resourceReferences) : undefined,
      path,
      presetId,
      projectId: opts?.projectId ?? null,
      revision: 1,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      nodes: graph.nodes,
      edges: graph.edges,
    }
    const list = loadWorkflows()
    list.push(wf)
    writeWorkflows(list)
    return wf
  },

  createFromSkillPreset(
    preset: WorkflowPreset,
    name?: string,
    opts?: { projectId?: string | null; seedPrompt?: string; resourceReferences?: AgentReference[] },
  ): WorkflowDef {
    const graph = buildGraphFromSkillPreset(preset)
    /* 只带入用户的原话，不拼接骨架：骨架里没填的项写进 prompt.original.md 就成了「用户原文」。 */
    const seed = opts?.seedPrompt?.trim()
    if (seed) {
      const promptNode = graph.nodes.find((n) => n.type === 'prompt')
      if (promptNode) promptNode.params = { ...promptNode.params, text: seed }
    }
    const meta = extractPresetMeta(preset)
    const now = new Date().toISOString()
    const wf: WorkflowDef = {
      id: uid('wf'),
      name: name?.trim() || `${meta.name}工作流`,
      description: seed ?? (preset.description || preset.mapping.description || ''),
      resourceReferences: opts?.resourceReferences ? structuredClone(opts.resourceReferences) : undefined,
      path: 'prompt-first',
      presetId: meta.slug || preset.id,
      skillPresetId: preset.id,
      skillPresetMeta: meta,
      projectId: opts?.projectId ?? null,
      revision: 1,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      nodes: graph.nodes,
      edges: graph.edges,
    }
    const list = loadWorkflows()
    list.push(wf)
    writeWorkflows(list)
    return wf
  },

  saveWorkflow(
    id: string,
    patch: {
      name?: string
      description?: string
      projectId?: string | null
      nodes: WfNodeInstance[]
      edges: WfEdgeInstance[]
      legacyDrafts?: WorkflowLegacyDrafts | null
    },
  ): WorkflowDef | null {
    const list = loadWorkflows()
    const at = list.findIndex((w) => w.id === id)
    if (at < 0) return null
    const nextLegacy = patch.legacyDrafts === undefined ? list[at].legacyDrafts : patch.legacyDrafts
    const next: WorkflowDef = {
      ...list[at],
      name: patch.name ?? list[at].name,
      description: patch.description ?? list[at].description,
      projectId: patch.projectId === undefined ? list[at].projectId : patch.projectId,
      nodes: patch.nodes,
      edges: patch.edges,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      revision: list[at].revision + 1,
      updatedAt: new Date().toISOString(),
    }
    if (nextLegacy && (nextLegacy.lookdev?.trim() || nextLegacy.filmplan?.trim())) {
      next.legacyDrafts = nextLegacy
    } else {
      delete next.legacyDrafts
    }
    list[at] = next
    writeWorkflows(list)
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
    writeWorkflows(list)
    return copy
  },

  deleteWorkflow(id: string) {
    writeWorkflows(loadWorkflows().filter((w) => w.id !== id))
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

function topoOrder(wf: WorkflowDef): WfNodeInstance[] | null {
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

function incoming(wf: WorkflowDef, nodeId: string, port: string): WfEdgeInstance | undefined {
  return wf.edges.find((e) => e.target === nodeId && e.targetPort === port)
}

const json = (v: unknown) => JSON.stringify(v, null, 2)

function pfArtifact(node: WfNodeInstance): WfArtifact {
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

function pfValidate(wf: WorkflowDef, node: WfNodeInstance): string | null {
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

/** 显式引用优先，兼容工作流节点中已保存的资源 ID；不把演示名称当真实素材。 */
export function workflowResourceReferences(wf: WorkflowDef): AgentReference[] {
  const refs: AgentReference[] = [...(wf.resourceReferences ?? [])]
  for (const node of wf.nodes) {
    if (node.type === 'refs') {
      for (const id of (node.params.assetIds as string[] | undefined) ?? []) {
        if (!refs.some((r) => r.kind === 'asset' && r.assetId === id)) refs.push({
          id: `asset:${id}`, kind: 'asset', role: 'context', assetId: id, purpose: 'unspecified', label: id,
        })
      }
      for (const id of (node.params.refSegmentIds as string[] | undefined) ?? []) {
        if (!refs.some((r) => r.kind === 'reference' && r.segmentId === id)) refs.push({
          id: `reference:${id}`, kind: 'reference', role: 'context', segmentId: id, label: id,
        })
      }
    }
    if (node.type === 'capability') for (const id of (node.params.techniqueIds as string[] | undefined) ?? []) {
      if (!refs.some((r) => r.kind === 'technique' && r.techniqueId === id)) refs.push({
        id: `technique:${id}`, kind: 'technique', role: 'context', techniqueId: id, intent: 'reference', label: id,
      })
    }
  }
  return refs
}

export function startDemoRun(
  wf: WorkflowDef,
  callbacks: {
    onEvent: (event: TaskEvent) => void
    onNodeStatus: (nodeId: string, status: WfNodeStatus) => void
    /** 当前项目；有值时 Prompt-first 运行会真实建立 workflow-v0.1.1 创作上下文 */
    projectId?: string
    /** 用户原始需求；会逐字写进 prompt.original.md */
    prompt?: string
    references?: AgentReference[]
    onCreateResult?: (result: FilmCreateResult) => void
  },
): DemoRunHandle {
  if (callbacks.projectId && wf.path !== 'structured') return startProjectGraph(wf,callbacks)
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
  let realCreationStarted = false
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
    /* 真实建立起来的上下文；null 表示没建（无项目或失败） */
    let contextInfo: WorkflowContextState | null = null
    /* 真实渲染出来的产物；null 表示这一轮没有真的出片 */
    let createdArtifact: FilmCreateResult | null = null
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
          filename: 'workflow-status-report.json',
          summary: `状态评估 · 产物 ${stageRows.length} 项（缺 ${missing}）/ Gate ${gateRows.length} 个`,
          content: json(report),
          demo: true,
        })
        emit('complete', 'completed', '状态评估结束：已生成评估报告；没有新产物被生成、没有 Gate 被代为确认。')
      }
    } else {
      emit('accepted', 'queued', `已接收运行请求（${wf.name} · 修订 ${wf.revision}）。Prompt-first 路径无强制门。`)
      const order = topoOrder(wf)
      if (!order) {
        status = 'failed'
        emit('error', 'failed', '工作流连线存在循环或无效节点，请修正后再运行。')
      }

      /* 唯一真实的一步：把用户原文落进项目目录，建立 workflow-v0.1.1 认的创作上下文。
         没有这一步，后面所有「产物快照」都建在空地基上 —— 那套流程要读
         prompt.original.md 才有创作依据。失败要如实说失败，并继续把
         其余演示节点跑完会让用户以为上下文建好了。 */
      if (status === 'failed') {
        // Validate before initializing or changing the project.
      } else if (callbacks.projectId && (callbacks.prompt ?? '').trim()) {
        emit('progress', 'running', '正在建立 workflow-v0.1.1 创作上下文（写入 prompt.original.md）…')
        try {
          const outcome = await studioHttpApi().workflowContext.init(callbacks.projectId, callbacks.prompt)
          const state = outcome.state
          contextInfo = state
          /* 三种结果必须分开说：用户需要知道自己这句话是被当成「原始需求」记下了，
             还是因为原文已存在而记成了「纠正」，或者根本重复了没变化。
             统一显示「已就绪」会让人以为每句话都成了创作依据。 */
          if (!state.initialized) {
            emit('build', 'building', '创作上下文未建立成功：没有找到 prompt.original.md。')
          } else if (outcome.result === 'RECORDED_AS_CORRECTION') {
            emit('build', 'building', `原始需求已存在，本次要求已作为「纠正」记入 corrections.md（原文未被覆盖）。`
              + `当前 ${state.files.length} 个文件，原文 ${state.promptLength} 字。`)
          } else if (outcome.result === 'UNCHANGED') {
            emit('build', 'building', `需求与已有原文一致，上下文无变化：${state.files.length} 个文件，原文 ${state.promptLength} 字。`)
          } else {
            emit('build', 'building', `创作上下文已就绪：${state.files.length} 个文件，原文 ${state.promptLength} 字。`
              + `workflow-v0.1.1 工具${state.toolAvailable ? '可用' : '未找到（请检查配置）'}。`)
          }
        } catch (error) {
          /* 上下文没建起来就不该继续假装在创作 —— 直接失败，并说明原因。 */
          status = 'failed'
          emit('error', 'failed', `建立创作上下文失败：${error instanceof Error ? error.message : String(error)}`)
        }
      } else if (!callbacks.projectId) {
        emit('progress', 'running', '未指定项目目录：跳过创作上下文写入，仅做界面流程演示。')
      } else {
        /* 有项目但没写需求：不建立上下文，并明确告诉用户缺什么。
           以前这里会用模板占位建出一个「已就绪」，用户以为存好了原文。 */
        status = 'failed'
        emit('error', 'failed', '缺少创作需求：请先在「制作要求」里写下这次想做什么，'
          + 'workflow-v0.1.1 需要 prompt.original.md 保存你的原文，而不是模板占位。')
      }

      const runnable = status === 'failed' ? [] : (order ?? [])
      for (const node of runnable) {
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
          for (const rest of runnable.slice(runnable.indexOf(node) + 1)) setStatus(rest.id, 'skipped')
          break
        }
        setStatus(node.id, 'running')

        /* 「制作与渲染」是这条路径上唯一能真的出片的节点：
           它对应 agent 改工程 + 后端渲染。其余节点（提示词、审片）
           仍是界面快照 —— 所以每个节点的日志都要分别讲清真假，
           不能笼统标成「已完成」让人以为整条链都真的跑了。 */
        if (node.type === 'create' && callbacks.projectId) {
          emit('progress', 'running', `${label}：Agent 正在读需求并修改工程…`)
          try {
            realCreationStarted = true
            const rendered = await studioHttpApi().workflowContext.create(
              callbacks.projectId,
              callbacks.prompt
                || String(wf.nodes.find((n) => n.type === 'prompt')?.params.text ?? '')
                || undefined,
              callbacks.references ?? workflowResourceReferences(wf),
            )
            callbacks.onCreateResult?.(rendered)
            /* agent 只提问、没动工程：这一轮没有产物。
               节点不能标「已完成」，否则用户以为片子做出来了；
               也不该判「失败」—— 它在正常地等用户补充信息，所以标为等待。 */
            if (rendered.state === 'awaiting_info' || !rendered.artifactPath) {
              setStatus(node.id, 'awaiting_info')
              emit('progress', 'awaiting_info',
                `${label}：等待补充信息，本轮没有渲染新片。${rendered.reply}`)
              status = 'awaiting_info'
              for (const rest of runnable.slice(runnable.indexOf(node) + 1)) setStatus(rest.id, 'skipped')
              break
            }
            createdArtifact = rendered
            const artifact: WfArtifact = {
              id: uid('art'),
              nodeId: node.id,
              nodeType: 'create',
              kind: 'render',
              title: '制作与渲染 · 真实产物',
              filename: rendered.artifactPath.split('/').pop() ?? 'film.mp4',
              summary: `真实渲染：${rendered.width}×${rendered.height} · ${rendered.durationInFrames} 帧 · 版本 v${rendered.version}`,
              content: json({
                real: true,
                artifactPath: rendered.artifactPath,
                file: studioHttpApi().artifacts.contentUrl(callbacks.projectId, rendered.artifactPath),
                version: rendered.version,
                resources: rendered.resources,
                agentReply: rendered.reply,
                agentMs: rendered.agentMs,
              }),
              demo: false,
            }
            artifacts.push(artifact)
            setStatus(node.id, 'completed')
            emit('build', 'building', `${label}：${artifact.summary}`)
            emit('progress', 'running', `Agent 说明：${rendered.reply.slice(0, 200)}`)
          } catch (error) {
            /* 真实环节失败就整条运行失败：不能因为后面还有演示节点
               就把失败咽下去 —— 用户会以为片子做出来了。 */
            const message = error instanceof Error ? error.message : String(error)
            setStatus(node.id, 'failed')
            emit('error', 'failed', `${label}失败：${message.slice(0, 300)}`)
            status = 'failed'
            for (const rest of runnable.slice(runnable.indexOf(node) + 1)) setStatus(rest.id, 'skipped')
            break
          }
          continue
        }

        if (node.type === 'delivery') {
          const rev = wf.nodes.find((n) => n.type === 'review')
          const checks = (rev?.params.checks as Record<string, unknown> | undefined) ?? {}
          const approved = checks.done === true && checks.rework !== true
          if (!approved) {
            setStatus(node.id, 'awaiting_info')
            emit('progress', 'awaiting_info', `${label}：等待审片通过后输出。`)
            status = 'awaiting_info'
            for (const rest of runnable.slice(runnable.indexOf(node) + 1)) setStatus(rest.id, 'skipped')
            break
          }
        }

        emit('progress', 'running', `${label}：开始处理（界面快照，不产出文件）。`)
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
      if (status === 'completed') emit('complete', 'completed', createdArtifact
        ? `运行结束：已产出真实视频（版本 v${createdArtifact.version}，${createdArtifact.width}×${createdArtifact.height}）。其余节点的产物为界面快照，不代表已有对应文件。`
        : contextInfo
          ? `运行结束：已建立 workflow-v0.1.1 创作上下文（${contextInfo.files.length} 个文件），但**没有真实渲染**——「制作与渲染」节点未连到项目或未执行。`
          : '运行结束：产物均为工作稿/引用/请求记录快照；未接入真实渲染，没有视频生成。')
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
            buildStatus: status === 'completed' ? 'passed' : status === 'awaiting_info' ? 'not-run' : 'failed',
            mock: true,
          }
        : null
    const run: WorkflowRun = {
      id: runId,
      workflowId: wf.id,
      workflowName: wf.name,
      revision: wf.revision,
      projectId: callbacks.projectId ?? null,
      nodeLabels: Object.fromEntries(wf.nodes.filter((n) => n.type !== 'lane').map((n) => [n.id, defForNode(n)?.label ?? n.type])),
      executionMode: wf.path === 'structured' ? 'evaluation' : callbacks.projectId ? 'project' : 'demo',
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

  // 后端创作请求尚无取消接口；离开页面不能被记录成「已经停止后端」。
  return { runId, done, cancel: () => { if (!realCreationStarted) cancelled = true } }
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


export function resumeProjectRun(run:WorkflowRun,callbacks:Parameters<typeof startDemoRun>[1]) {
  if(!run.definition || !run.projectId || !['running','awaiting_info'].includes(run.status))throw new Error('此记录没有可继续的执行快照')
  return startProjectGraph(run.definition,{...callbacks,projectId:run.projectId},run)
}

/** 只比结构（节点 ID、类型与连线），不比参数：审片结论改的是参数，保存时 revision 会变，不能用 revision 判断。 */
function graphShape(wf: Pick<WorkflowDef, 'nodes' | 'edges'>): string {
  const nodes = wf.nodes.map((n) => `${n.id}:${n.type}`).sort().join('|')
  const edges = wf.edges.map((e) => `${e.source}.${e.sourcePort}>${e.target}.${e.targetPort}`).sort().join('|')
  return `${nodes}#${edges}`
}

/**
 * 按最新审片结论继续交付。
 *
 * <p>新运行一定会重新渲染，上一轮的审片结论永远对不上新版本；普通的继续运行读的是运行开始时的快照，
 * 看不到之后的审片结论。这里只把当前工作流里审片节点的参数同步进快照，清掉审片与交付的旧结果让它们重新判断，
 * 保留 create 的结果，不重新渲染。</p>
 *
 * <p>审片结论是「需要修改」时拒绝：继续运行会沿用原来的 requestId，带上修改意见后后端会按幂等冲突拒绝。
 * 返工统一走新运行。</p>
 */
export function deliverProjectRun(run: WorkflowRun, current: WorkflowDef | null, callbacks: Parameters<typeof startDemoRun>[1]) {
  if (!run.definition || !run.projectId || run.status !== 'awaiting_info'
    || !Object.values(run.nodeIO ?? {}).some((io) => io.outputs?.status === 'awaiting_review')) {
    throw new Error('这次运行没有停在「等待审片通过」，无法继续交付')
  }
  if (!current || current.id !== run.workflowId) throw new Error('找不到这次运行对应的工作流')
  if (graphShape(current) !== graphShape(run.definition)) {
    throw new Error('工作流结构在这次运行之后改过，请重新运行')
  }
  const definition = structuredClone(run.definition)
  for (const node of definition.nodes) {
    if (node.type !== 'review') continue
    const fresh = current.nodes.find((n) => n.id === node.id)
    if (fresh) node.params = structuredClone(fresh.params)
  }
  if (extractReworkCorrection(definition).rework) {
    throw new Error('审片结论是「需要修改」，请点「运行」开始新一轮制作')
  }
  const copy = structuredClone(run)
  copy.definition = definition
  copy.nodeIO = { ...(copy.nodeIO ?? {}) }
  for (const node of definition.nodes) {
    if (node.type === 'review' || node.type === 'delivery') delete copy.nodeIO[node.id]
  }
  copy.status = 'running'
  return startProjectGraph(definition, { ...callbacks, projectId: copy.projectId! }, copy)
}

export function retryFailedProjectRun(previous:WorkflowRun,callbacks:Parameters<typeof startDemoRun>[1]){
  if(!previous.definition||!previous.projectId||previous.status!=='failed')throw new Error('此运行没有可重试的失败节点')
  const copy=structuredClone(previous)
  copy.nodeAttempts={...copy.nodeAttempts}
  for(const [id,io] of Object.entries(copy.nodeIO??{}))if(io.error){copy.nodeAttempts[id]=(copy.nodeAttempts[id]??0)+1;io.outputs={};delete io.error;}
  copy.status='running'
  return startProjectGraph(copy.definition!,{...callbacks,projectId:copy.projectId!},copy)
}

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function reworkSignatureOf(wf: WorkflowDef): string | null {
  const parts = wf.nodes
    .filter((n) => n.type === 'review')
    .map((n) => {
      const c = (n.params.checks as Record<string, unknown> | undefined) ?? {}
      if (c.rework !== true || c.done === true) return null
      return `${n.id}:${String(n.params.decidedAt ?? '')}:${String(n.params.issues ?? n.params.notes ?? '').trim()}`
    })
    .filter(Boolean)
  return parts.length ? parts.join('|') : null
}

const activeGraphRuns=new Map<string,DemoRunHandle>()
function startProjectGraph(wf:WorkflowDef,callbacks:Parameters<typeof startDemoRun>[1],resume?:WorkflowRun):DemoRunHandle {
  if(resume&&activeGraphRuns.has(resume.id))return activeGraphRuns.get(resume.id)!
  const runId=resume?.id??uid('run'),at=resume?.startedAt??new Date().toISOString()
  const fixed=structuredClone(wf)
  if(callbacks.prompt){const n=fixed.nodes.find(n=>n.type==='prompt');if(n)n.params.text=callbacks.prompt}
  if(callbacks.references){const refs=fixed.nodes.find(n=>n.type==='refs');if(refs)fixed.resourceReferences=callbacks.references}
  const cycle=extractReworkCorrection(fixed)
  const sig=reworkSignatureOf(fixed)
  const lastSubmittedSig=resume?undefined:loadRuns().find(r=>r.workflowId===wf.id&&r.submittedReworkSignature&&r.artifacts.some(a=>!a.demo))?.submittedReworkSignature
  const shouldSendCorrection=cycle.rework&&Boolean(cycle.correction)&&(resume?true:sig!==lastSubmittedSig)
  const run:WorkflowRun=resume?structuredClone(resume):{id:runId,workflowId:wf.id,workflowName:wf.name,revision:wf.revision,projectId:callbacks.projectId??null,
    executionMode:'project',nodeLabels:Object.fromEntries(wf.nodes.map(n=>[n.id,defForNode(n,{includeLegacy:true})?.label??n.type])),
    definition:fixed,engineSelection:readHarnessSelection(),nodeIO:{},nodeRequestIds:{},
    ...(shouldSendCorrection&&sig?{submittedReworkSignature:sig}:{}),
    status:'running',task:{id:runId,kind:'modify',status:'running',mock:false,title:wf.name,createdAt:at},events:[],artifacts:[],changes:null,nodeStatus:{},startedAt:at,finishedAt:null,demo:false}
  run.nodeRequestIds=run.nodeRequestIds??{}
  let cancelled=false
  let activeRequest:string|null=null
  const save=async()=>{const list=loadRuns();saveRuns([run,...list.filter(r=>r.id!==runId)]);await flushLocalDocuments()}
  const done=(async()=>{
    try{
      run.status='running';run.task.status='running';run.finishedAt=null
      await save()
      /* 先校验再动项目：图不合法（比如创作需求还是骨架原样）时，不能先把它写进 prompt.original.md。
         executeWorkflow 会再校验一次并给出失败原因。 */
      if(fixed.skillPresetId&&callbacks.projectId&&workflowGraphProblems(fixed.nodes,fixed.edges).length===0){
        const promptText=String(fixed.nodes.find(n=>n.type==='prompt')?.params.text??'').trim()
        if(promptText){
          await ensureCreationContext(callbacks.projectId,promptText,studioHttpApi().workflowContext)
        }
        const presetLabel=fixed.skillPresetMeta?.name||fixed.presetId
        let presetMessage:string
        try{
          const applied=await studioHttpApi().skillPresets.applyPresetToProject(callbacks.projectId,fixed.skillPresetId)
          presetMessage=formatApplyPresetSummary(presetLabel,applied)
        }catch(error){
          /* 视频类型归档后后端不再允许落地，但已经写进项目的指引仍然有效：给出警告、继续运行。
             其他失败（项目正在制作、网络中断）照旧中止。 */
          if(!isPresetNotActiveError(error))throw error
          const current=await studioHttpApi().skillPresets.getProjectPreset(callbacks.projectId).catch(()=>null)
          presetMessage=current?.presetId===fixed.skillPresetId
            ?`注意：视频类型「${presetLabel}」已归档，沿用项目里已有的 skill 指引继续运行。`
            :`注意：视频类型「${presetLabel}」已归档，这个项目还没有落地过它的指引，本次运行没有 skill 指引。`
        }
        const presetEvent:TaskEvent={id:uid('evt'),taskId:runId,kind:'progress',status:'running',mock:false,message:presetMessage,at:new Date().toISOString()}
        run.events.push(presetEvent);callbacks.onEvent(presetEvent)
      }
      const result=await executeWorkflow(fixed,{
        cancelled:()=>cancelled,
        completedIO:run.nodeIO,
        correction:shouldSendCorrection?cycle.correction:'',
        resourceReferences:(id)=>workflowResourceReferences({...fixed,nodes:fixed.nodes.filter(n=>n.id===id)}),
        onStatus:(id,status)=>{run.nodeStatus[id]=status;callbacks.onNodeStatus(id,status)},
        saveIO:async io=>{run.nodeIO=structuredClone(io);await save()},
        create:async(nodeId,input)=>{
          /* 每次运行都提交当前需求：后端和最近一次需求修改比较，相同不记，不同才追加到 corrections.md。
             只在未初始化时提交的话，首次运行后再改「创作需求」节点，agent 永远看不到。 */
          const context=await studioHttpApi().workflowContext.init(callbacks.projectId!,input.prompt)
          if(context.result==='RECORDED_AS_CORRECTION'){
            const event:TaskEvent={id:uid('evt'),taskId:runId,kind:'progress',status:'running',mock:false,message:'创作需求已修改，已作为纠正记入 corrections.md（原文未被覆盖）。',at:new Date().toISOString()}
            run.events.push(event);callbacks.onEvent(event)
          }
          const attemptKey=`${nodeId}:${run.nodeAttempts?.[nodeId]??0}`
          if(!run.nodeRequestIds![attemptKey]){run.nodeRequestIds![attemptKey]=newUuid();await save()}
          activeRequest=run.nodeRequestIds![attemptKey]
          const result=await submitCreation({projectId:callbacks.projectId!,requestId:activeRequest,intent:'',correction:input.correction,references:input.references as AgentReference[],selection:run.engineSelection??readHarnessSelection(),workflow:{id:fixed.id,revision:fixed.revision,nodeId,runId}},job=>{
            const event:TaskEvent={id:uid('evt'),taskId:runId,kind:'progress',status:'running',mock:false,message:`制作阶段：${job.phase}`,at:new Date().toISOString()}
            if(run.events.at(-1)?.message!==event.message){run.events.push(event);callbacks.onEvent(event)}
          })
          activeRequest=null
          callbacks.onCreateResult?.(result)
          if(result.state==='rendered'&&result.artifactPath)run.artifacts.push({id:uid('art'),nodeId,nodeType:'create',kind:'render',title:'制作与渲染',filename:result.artifactPath.split('/').pop()??'film.mp4',summary:`版本 v${result.version}`,content:JSON.stringify({...result,runId,file:studioHttpApi().artifacts.contentUrl(callbacks.projectId!,result.artifactPath)}),demo:false})
          return {...result,runId}
        },
      })
      run.nodeIO=result.nodeIO;run.status=result.status;run.task.status=result.status
      if(result.status==='awaiting_info'){
        const waitingDelivery=Object.values(result.nodeIO).find(io=>io.outputs?.status==='awaiting_review')
        if(waitingDelivery){
          const msg=String(waitingDelivery.outputs.reason||'等待审片通过')
          const e:TaskEvent={id:uid('evt'),taskId:runId,kind:'progress',status:'awaiting_info',mock:false,message:`交付：${msg}`,at:new Date().toISOString()}
          run.events.push(e);callbacks.onEvent(e)
        }
      }
      if(result.error){const e:TaskEvent={id:uid('evt'),taskId:runId,kind:'error',status:'failed',mock:false,message:result.error,at:new Date().toISOString()};run.events.push(e);callbacks.onEvent(e)}
    }catch(error){run.status='failed';run.task.status='failed';const e:TaskEvent={id:uid('evt'),taskId:runId,kind:'error',status:'failed',mock:false,message:error instanceof Error?error.message:'运行失败',at:new Date().toISOString()};run.events.push(e);callbacks.onEvent(e)}
    run.finishedAt=run.status==='running'?null:new Date().toISOString();activeGraphRuns.delete(runId);try{await save()}catch(e){callbacks.onEvent({id:uid('evt'),taskId:runId,kind:'error',status:'failed',mock:false,message:e instanceof Error?e.message:'运行记录保存未完成',at:new Date().toISOString()})}return run
  })()
  const handle={runId,done,cancel:()=>{cancelled=true;if(activeRequest)void cancelCreationJob(callbacks.projectId!,activeRequest).catch(e=>{cancelled=false;callbacks.onEvent({id:uid('evt'),taskId:runId,kind:'error',status:'failed',mock:false,message:e instanceof Error?e.message:'取消未送达，任务仍可能执行',at:new Date().toISOString()})})}}
  activeGraphRuns.set(runId,handle)
  return handle
}

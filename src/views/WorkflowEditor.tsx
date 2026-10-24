/**
 * 工作流编辑器（v5 重构）
 *
 * 骨架沿用第一期（命令条/左构建栏/画布/Inspector/执行抽屉，React Flow 仅作引擎），
 * 内容模型换成 workflow-v5：Prompt-first 自由节点图（无 Gate）、Structured
 * 阶段泳道 + 产物节点 + Gate 检查点。Gate 的确认只能由用户在检查器里对
 * 具体产物版本做出；演示运行永不代确认。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type OnConnectStartParams,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  Flag,
  LoaderCircle,
  Play,
  Plus,
  Save,
  Search,
  XCircle,
} from 'lucide-react'
import {
  ARTIFACT_KINDS,
  ARTIFACT_KIND_MAP,
  GATE_DEFS,
  PF_NODE_DEFS,
  STRUCTURED_STAGES,
  WF_PORT_COLORS,
  defForNode,
  pfDefaultParams,
  type WfEdgeInstance,
  type WfNodeDef,
  type WfPortType,
} from '../data/workflowTemplates'
import { BUILTIN_ASSETS, MEDIA_LABEL } from '../data/myAssets'
import { FX_TECHNIQUES } from '../data/fxTechniques'
import { REFERENCE_SEGMENTS, REFERENCE_VIDEOS } from '../data/referenceLibrary'
import {
  workflowService,
  startDemoRun,
  startSingleNodeRun,
  evaluateGate,
  QUALITY_QUESTIONS,
  type GateEval,
  type WorkflowDef,
  type WorkflowRun,
  type WfArtifact,
  type WfNodeStatus,
} from '../services/workflowService'
import type { TaskEvent } from '../services/studioApi'

type FmNodeData = {
  defType: string
  params: Record<string, unknown>
  status: WfNodeStatus | 'idle'
  gateEval?: GateEval | null
  laneSummary?: string
  onToggleLane?: () => void
}
type FmNode = Node<FmNodeData, 'fm' | 'lane'>

const FX_OUTBOX_KEY = 'fm-fx-usage-outbox-v1'
const REF_OUTBOX_KEY = 'fm-reference-outbox-v1'
const REF_CONSUMED_KEY = 'fm-workflow-ref-consumed-v1'

interface FxIntent {
  techniqueId: string
  techniqueName: string
  projectId: string
  projectName: string
  at: string
  status?: string
  workflowId?: string
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const ARTIFACT_STATUS_LABEL: Record<string, string> = {
  missing: '尚无产物',
  draft: 'draft',
  candidate: 'candidate',
  confirmed: 'confirmed',
}

function pfSummary(defType: string, p: Record<string, unknown>): string {
  switch (defType) {
    case 'prompt':
      return String(p.text ?? '').trim() ? `${String(p.text).trim().slice(0, 42)}…` : '尚未填写提示词'
    case 'refs': {
      const na = ((p.assetIds as string[] | undefined) ?? []).length
      const nr = ((p.refSegmentIds as string[] | undefined) ?? []).length
      return na + nr === 0 ? '未添加参考 · 可直接创作' : `${na} 项素材 · ${nr} 条参考`
    }
    case 'lookdev':
    case 'filmplan':
      return String(p.summary ?? '').trim() ? String(p.summary).trim().slice(0, 46) : '尚无内容'
    case 'capability': {
      const n = ((p.techniqueIds as string[] | undefined) ?? []).length
      return n ? `${n} 项能力候选（只检索）` : '未选择能力'
    }
    case 'create':
      return `${String(p.mode ?? 'sketch')} · ${String(p.resolution ?? '1080p')} · 未实际渲染`
    case 'review': {
      const checks = (p.checks as Record<string, boolean> | undefined) ?? {}
      const done = QUALITY_QUESTIONS.filter((q) => checks[q]).length
      return `quality-bar 已确认 ${done}/${QUALITY_QUESTIONS.length}`
    }
    case 'finishing':
      return String(p.notes ?? '').trim() ? `${String(p.notes).length} 字记录` : '尚无记录'
    default:
      return ''
  }
}

/** 动态副标题：由节点关键参数自动生成的一行规格注脚（n8n 式） */
function pfMeta(defType: string, p: Record<string, unknown>): string {
  switch (defType) {
    case 'prompt':
      return [String(p.audience ?? '').trim(), String(p.duration ?? '').trim(), String(p.ratio ?? '').trim()]
        .filter(Boolean)
        .join(' · ')
    case 'lookdev':
    case 'filmplan':
      return `工作稿 · ${String(p.status ?? 'draft')}`
    case 'create':
      return '渲染请求记录 · 未接入真实渲染'
    case 'finishing':
      return '收束与 QC 记录'
    default:
      return ''
  }
}

/** 角标式状态：浮在节点右上角的状态徽标，不整节点染色（idle/pending 不显示） */
function StatusBadge({ status }: { status: FmNodeData['status'] }) {
  if (status === 'running') return <span className="wfn-badge" data-s="running"><LoaderCircle size={10} className="wfn-spin" /></span>
  if (status === 'completed') return <span className="wfn-badge" data-s="completed"><CheckCircle2 size={10} strokeWidth={2.6} /></span>
  if (status === 'failed') return <span className="wfn-badge" data-s="failed"><XCircle size={10} strokeWidth={2.6} /></span>
  if (status === 'skipped') return <span className="wfn-badge" data-s="skipped"><Ban size={10} strokeWidth={2.6} /></span>
  return null
}

function Ports({ node }: { node: { type: string; params: Record<string, unknown> } }) {
  const def = defForNode(node)
  if (!def) return null
  return (
    <div className="wfn-ports">
      <div className="wfn-col">
        {def.inputs.map((p) => (
          <span key={p.id} className="wfn-port in">
            <Handle type="target" position={Position.Left} id={p.id} className="wfn-handle" style={{ background: WF_PORT_COLORS[p.type] }} />
            {p.label}
            {p.required && <em>*</em>}
          </span>
        ))}
      </div>
      <div className="wfn-col out">
        {def.outputs.map((p) => (
          <span key={p.id} className="wfn-port out">
            {p.label}
            <Handle type="source" position={Position.Right} id={p.id} className="wfn-handle" style={{ background: WF_PORT_COLORS[p.type] }} />
          </span>
        ))}
      </div>
    </div>
  )
}

function FmNodeView({ data, selected }: { data: FmNodeData; selected?: boolean }) {
  const pseudoNode = { type: data.defType, params: data.params }
  const def = defForNode(pseudoNode)
  if (!def) return null

  if (data.defType === 'gate') {
    const ev = data.gateEval
    const decision = ev?.stale ? 'confirmed-stale' : (ev?.decision ?? 'not-started')
    return (
      <div className="wfn is-gate" data-selected={selected || undefined} data-status={data.status} data-d={decision}>
        <StatusBadge status={data.status} />
        <div className="wfn-head">
          <Flag size={13} strokeWidth={2.2} className="wfn-flag" />
          <b>{def.label}</b>
        </div>
        <div className="wfn-gate-row">
          <span className="wfn-gate-chip" data-d={decision}>
            {decision === 'confirmed' && '已确认'}
            {decision === 'confirmed-stale' && '已确认 · 版本已变更'}
            {decision === 'pending' && '待确认'}
            {decision === 'not-started' && '未开始'}
          </span>
          {data.params.recommendation ? <span className="wfn-rec-chip">推荐方案（≠确认）</span> : null}
        </div>
        {ev && ev.blocked.length > 0 && <p className="wfn-blocked">阻塞：{ev.blocked[0]}</p>}
        <p className="wfn-target">检查目标：{def.description}</p>
        <Ports node={pseudoNode} />
      </div>
    )
  }

  if (data.defType === 'artifact') {
    const kind = ARTIFACT_KIND_MAP[String(data.params.kind ?? '')]
    const st = String(data.params.status ?? 'missing')
    return (
      <div className="wfn is-doc" data-selected={selected || undefined} data-status={data.status}>
        <StatusBadge status={data.status} />
        <div className="wfn-head">
          <span className="wfn-group">{kind ? `阶段 ${kind.stage}` : '产物'}</span>
          <b>{kind?.label ?? '产物'}</b>
        </div>
        <p className="wfn-file">{kind?.filename ?? ''}{data.params.version ? ` · ${String(data.params.version)}` : ''}{data.params.fixture ? ' · 演示快照' : ''}</p>
        <p className="wfn-summary">
          {st === 'missing' ? '尚无产物' : String(data.params.summary ?? '').trim().slice(0, 52) || '（无摘要）'}
        </p>
        <div className="wfn-gate-row">
          <span className="wfn-artifact-chip" data-s={st}>{ARTIFACT_STATUS_LABEL[st] ?? st}</span>
        </div>
        <Ports node={pseudoNode} />
      </div>
    )
  }

  const meta = pfMeta(data.defType, data.params)
  const reviewChecks = (data.params.checks as Record<string, boolean> | undefined) ?? {}
  const reviewDone = QUALITY_QUESTIONS.filter((q) => reviewChecks[q]).length
  const wide = ['create', 'review', 'lookdev', 'filmplan', 'finishing'].includes(data.defType)
  const thumbs =
    data.defType === 'refs'
      ? (((data.params.assetIds as string[] | undefined) ?? [])
          .map((id) => BUILTIN_ASSETS.find((a) => a.id === id))
          .filter((a) => a?.thumbnailPath)
          .slice(0, 4) as Array<(typeof BUILTIN_ASSETS)[number]>)
      : []
  return (
    <div className={`wfn${wide ? ' is-wide' : ''}`} data-selected={selected || undefined} data-status={data.status}>
      <StatusBadge status={data.status} />
      <div className="wfn-head">
        <span className="wfn-group">{def.group}</span>
        <b>{def.label}</b>
      </div>
      <p className="wfn-summary">{pfSummary(data.defType, data.params)}</p>
      {meta && <p className="wfn-meta">{meta}</p>}
      {data.defType === 'review' && (
        <div className="wfn-progress" role="img" aria-label={`quality-bar 已确认 ${reviewDone}/${QUALITY_QUESTIONS.length}`}>
          <i style={{ width: `${(reviewDone / QUALITY_QUESTIONS.length) * 100}%` }} />
        </div>
      )}
      {thumbs.length > 0 && (
        <div className="wfn-thumbs" aria-hidden>
          {thumbs.map((a) => (
            <img
              key={a.id}
              src={a.thumbnailPath}
              alt=""
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ))}
        </div>
      )}
      <Ports node={pseudoNode} />
    </div>
  )
}

function LaneView({ data }: { data: FmNodeData }) {
  const collapsed = !!data.params.collapsed
  return (
    <div className="wflane" data-collapsed={collapsed || undefined}>
      <div className="wflane-head">
        <b><span className="wflane-no">阶段 {String(data.params.stage)}</span> {String(data.params.label ?? '')}</b>
        <span className="wflane-q">{String(data.params.question ?? '')}</span>
        {data.laneSummary && <span className="wflane-sum">{data.laneSummary}</span>}
        <button
          type="button"
          className="wflane-toggle nodrag"
          onClick={(e) => {
            e.stopPropagation()
            data.onToggleLane?.()
          }}
          aria-expanded={!collapsed}
        >
          {collapsed ? '展开' : '折叠'}
        </button>
      </div>
    </div>
  )
}

const nodeTypes = { fm: FmNodeView, lane: LaneView }

/* 释放连线推荐菜单：候选已按端口类型过滤，选中即生成节点并自动连好 */
function ConnectMenuView(props: {
  x: number
  y: number
  portType: WfPortType
  fromSource: boolean
  candidates: Array<{ key: string; label: string; sub: string; defType: string; params: Record<string, unknown>; portId: string }>
  onPick: (cand: { key: string; label: string; sub: string; defType: string; params: Record<string, unknown>; portId: string }) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const list = props.candidates.filter((c) => !q.trim() || c.label.includes(q.trim()))
  return (
    <>
      <div className="wfe-menu-scrim" onClick={props.onClose} onContextMenu={(e) => { e.preventDefault(); props.onClose() }} />
      <div
        className="wfe-connectmenu"
        style={{ left: Math.max(8, props.x - 10), top: Math.max(8, props.y - 10) }}
        role="menu"
        aria-label="选择要连接的节点"
        onKeyDown={(e) => { if (e.key === 'Escape') props.onClose() }}
      >
        <div className="wfe-connectmenu-head">
          <span className="wfe-connectmenu-dot" style={{ background: WF_PORT_COLORS[props.portType] }} />
          {props.fromSource ? '连接到下一个节点' : '从上一个节点接入'}
          <span className="wfe-connectmenu-type">{props.portType}</span>
        </div>
        <label className="wfe-connectmenu-search">
          <Search size={12} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索节点" aria-label="搜索节点" />
        </label>
        <div className="wfe-connectmenu-list">
          {list.length === 0 && <p className="wfe-hint">没有类型兼容的节点可加。</p>}
          {list.map((c) => (
            <button key={c.key} type="button" className="wfe-connectmenu-item" onClick={() => props.onPick(c)}>
              <b>{c.label}</b>
              <span>{c.sub}</span>
            </button>
          ))}
        </div>
        <p className="wfe-connectmenu-foot">仅列类型兼容的节点 · 选中即生成并连好 · Esc 取消</p>
      </div>
    </>
  )
}

let seq = 0
const nid = () => `n-${Date.now().toString(36)}${(seq += 1).toString(36)}`

export function WorkflowEditor(props: { workflowId: string; onBack: () => void; autoRun?: boolean }) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  )
}

function toRfEdge(e: WfEdgeInstance, nodes: Array<{ id: string; type: string; params: Record<string, unknown> }>): Edge {
  const src = nodes.find((n) => n.id === e.source)
  const def = src ? defForNode(src) : undefined
  const out = def?.outputs.find((p) => p.id === e.sourcePort)
  return {
    id: e.id,
    source: e.source,
    sourceHandle: e.sourcePort,
    target: e.target,
    targetHandle: e.targetPort,
    style: { stroke: out ? WF_PORT_COLORS[out.type] : undefined, strokeWidth: 1.5 },
  }
}

function EditorInner({ workflowId, onBack, autoRun }: { workflowId: string; onBack: () => void; autoRun?: boolean }) {
  const initial = useMemo(() => workflowService.getWorkflow(workflowId), [workflowId])
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [nodes, setNodes] = useState<FmNode[]>(() => mapNodes(initial))
  const [edges, setEdges] = useState<Edge[]>(() =>
    (initial?.edges ?? []).map((e) => toRfEdge(e, initial?.nodes ?? [])),
  )
  const [dirty, setDirty] = useState(false)
  const [leftTab, setLeftTab] = useState<'nodes' | 'pending'>('nodes')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<'events' | 'outputs' | 'artifacts'>('events')
  const [running, setRunning] = useState(false)
  const [liveEvents, setLiveEvents] = useState<TaskEvent[]>([])
  const [lastRun, setLastRun] = useState<WorkflowRun | null>(() => workflowService.listRuns(workflowId)[0] ?? null)
  const [viewing, setViewing] = useState<WfArtifact | null>(null)
  const [compact, setCompact] = useState(false)
  const [pendingTick, setPendingTick] = useState(0)
  const runHandle = useRef<{ cancel: () => void } | null>(null)
  const flow = useReactFlow()
  const wrapRef = useRef<HTMLDivElement>(null)

  function mapNodes(wf: WorkflowDef | null): FmNode[] {
    if (!wf) return []
    return wf.nodes.map((n) => ({
      id: n.id,
      type: n.type === 'lane' ? 'lane' : 'fm',
      position: n.position,
      parentId: n.parentId,
      hidden: n.hidden,
      style: n.type === 'lane' ? { width: n.width ?? 1020, height: n.height ?? 148 } : undefined,
      data: { defType: n.type, params: n.params, status: 'idle' as const },
    })) as FmNode[]
  }

  const selectedNode = nodes.find((n) => n.selected && n.type === 'fm')
  const selectedEdge = edges.find((e) => e.selected)

  const fxIntents = useMemo(() => readJson<FxIntent[]>(FX_OUTBOX_KEY, []), [pendingTick])
  const refIds = useMemo(() => readJson<string[]>(REF_OUTBOX_KEY, []), [pendingTick])
  const refConsumed = useMemo(() => readJson<Record<string, string>>(REF_CONSUMED_KEY, {}), [pendingTick])

  const markDirty = useCallback(() => setDirty(true), [])

  const snapshot = useCallback((): WorkflowDef | null => {
    if (!workflow) return null
    return {
      ...workflow,
      name,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.defType,
        position: n.position,
        params: n.data.params,
        parentId: n.parentId,
        width: n.type === 'lane' ? (n.style?.width as number | undefined) ?? 1020 : undefined,
        height: n.type === 'lane' ? (n.style?.height as number | undefined) ?? 148 : undefined,
        hidden: n.hidden,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourcePort: e.sourceHandle ?? '',
        target: e.target,
        targetPort: e.targetHandle ?? '',
      })),
    }
  }, [workflow, name, nodes, edges])

  /* Gate 评估与泳道摘要注入节点数据（Gate 口径与首页一致，来自服务层 evaluateGate） */
  useEffect(() => {
    const snap = snapshot()
    if (!snap) return
    const gateEvalById = new Map<string, GateEval>()
    for (const gn of snap.nodes.filter((x) => x.type === 'gate')) {
      gateEvalById.set(gn.id, evaluateGate(snap, gn))
    }
    const gateIdByStage = new Map<number, string>()
    for (const [letter, gdef] of Object.entries(GATE_DEFS)) {
      const gn = snap.nodes.find((x) => x.type === 'gate' && String(x.params.gate ?? '') === letter)
      if (gn) gateIdByStage.set(gdef.afterStage, gn.id)
    }
    const DECISION_TXT: Record<string, string> = { confirmed: '已确认', pending: '待确认', 'not-started': '未开始' }
    setNodes((prev) => {
      let changed = false
      const next = prev.map((n) => {
        if (n.data.defType === 'gate') {
          const ev = gateEvalById.get(n.id)
          if (!ev) return n
          const prevKey = n.data.gateEval ? JSON.stringify(n.data.gateEval) : ''
          if (prevKey === JSON.stringify(ev)) return n
          changed = true
          return { ...n, data: { ...n.data, gateEval: ev } }
        }
        if (n.type === 'lane') {
          const kids = snap.nodes.filter((x) => x.parentId === n.id && x.type === 'artifact')
          const present = kids.filter((k) => String(k.params.status ?? 'missing') !== 'missing').length
          let sum = `${kids.length} 项产物 · 有 ${present} · 缺 ${kids.length - present}`
          const gid = gateIdByStage.get(Number(n.data.params.stage))
          const ev = gid ? gateEvalById.get(gid) : undefined
          if (ev) sum += ` · ${ev.label.replace(' · ', ' ')} ${ev.stale ? '已确认·已失效' : DECISION_TXT[ev.decision]}`
          if (n.data.laneSummary === sum) return n
          changed = true
          return { ...n, data: { ...n.data, laneSummary: sum } }
        }
        return n
      })
      return changed ? next : prev
    })
  }, [nodes.length, edges.length, snapshot])

  /* 泳道折叠回调注入 */
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.type !== 'lane') return n
        const toggle = () => toggleLane(n.id)
        return n.data.onToggleLane ? n : { ...n, data: { ...n.data, onToggleLane: toggle } }
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length])

  const toggleLane = useCallback(
    (laneId: string) => {
      setNodes((prev) => {
        const lane = prev.find((n) => n.id === laneId)
        if (!lane) return prev
        const collapsed = !lane.data.params.collapsed
        return prev.map((n) => {
          if (n.id === laneId) {
            return {
              ...n,
              data: { ...n.data, params: { ...n.data.params, collapsed } },
              style: { ...n.style, height: collapsed ? 44 : 148 },
            }
          }
          if (n.parentId === laneId) return { ...n, hidden: collapsed }
          return n
        })
      })
      markDirty()
    },
    [markDirty],
  )

  useEffect(() => {
    const t = setTimeout(() => flow.fitView({ padding: 0.12, maxZoom: 0.95 }), 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateParams = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, params: { ...n.data.params, ...patch } } } : n)),
      )
      markDirty()
    },
    [markDirty],
  )

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false
      const s = nodes.find((n) => n.id === c.source)
      const t = nodes.find((n) => n.id === c.target)
      if (!s || !t) return false
      const out = defForNode({ type: s.data.defType, params: s.data.params })?.outputs.find((p) => p.id === c.sourceHandle)
      const inp = defForNode({ type: t.data.defType, params: t.data.params })?.inputs.find((p) => p.id === c.targetHandle)
      return !!out && !!inp && out.type === inp.type
    },
    [nodes],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!isValidConnection(c)) return
      setEdges((prev) => {
        const kept = prev.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle))
        const srcNode = nodes.find((n) => n.id === c.source)
        const out = srcNode
          ? defForNode({ type: srcNode.data.defType, params: srcNode.data.params })?.outputs.find((p) => p.id === c.sourceHandle)
          : undefined
        return [
          ...kept,
          {
            id: nid(),
            source: c.source!,
            sourceHandle: c.sourceHandle ?? undefined,
            target: c.target!,
            targetHandle: c.targetHandle ?? undefined,
            style: { stroke: out ? WF_PORT_COLORS[out.type] : undefined, strokeWidth: 1.5 },
          } as Edge,
        ]
      })
      markDirty()
    },
    [isValidConnection, nodes, markDirty],
  )

  const addNode = useCallback(
    (defType: string, params: Record<string, unknown>, at?: { x: number; y: number }) => {
      const id = nid()
      const rect = wrapRef.current?.getBoundingClientRect()
      const center = rect
        ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 240, y: 200 }
      const jitter = (nodes.length % 5) * 26
      const node: FmNode = {
        id,
        type: 'fm',
        position: at ?? { x: center.x - 110 + jitter, y: center.y - 40 + jitter },
        data: { defType, params, status: 'idle' },
      } as FmNode
      setNodes((prev) => [...prev, node])
      markDirty()
      return id
    },
    [flow, nodes.length, markDirty],
  )

  /* ── 释放连线推荐菜单（P0-4）：拖线到空白处松手 → 按端口类型推荐下一节点 ── */
  interface PendingLink {
    nodeId: string
    handleId: string
    handleType: 'source' | 'target'
    portType: WfPortType
  }
  interface ConnectMenuState extends PendingLink {
    x: number
    y: number
    flowPos: { x: number; y: number }
  }
  const [connectMenu, setConnectMenu] = useState<ConnectMenuState | null>(null)
  const pendingLink = useRef<PendingLink | null>(null)

  const onConnectStart = useCallback(
    (_event: unknown, params: OnConnectStartParams) => {
      setConnectMenu(null)
      if (!params.nodeId || !params.handleId || !params.handleType) return
      const src = nodes.find((n) => n.id === params.nodeId)
      if (!src) return
      const def = defForNode({ type: src.data.defType, params: src.data.params })
      const port = params.handleType === 'source'
        ? def?.outputs.find((p) => p.id === params.handleId)
        : def?.inputs.find((p) => p.id === params.handleId)
      if (!port) return
      pendingLink.current = { nodeId: params.nodeId, handleId: params.handleId, handleType: params.handleType, portType: port.type }
    },
    [nodes],
  )

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const link = pendingLink.current
      pendingLink.current = null
      if (!link) return
      const target = event.target as HTMLElement | null
      if (!target || !target.classList?.contains('react-flow__pane')) return
      const pt = 'clientX' in event ? event : event.changedTouches[0]
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      setConnectMenu({
        ...link,
        x: pt.clientX - rect.left,
        y: pt.clientY - rect.top,
        flowPos: flow.screenToFlowPosition({ x: pt.clientX, y: pt.clientY }),
      })
    },
    [flow],
  )

  interface ConnectCandidate {
    key: string
    label: string
    sub: string
    defType: string
    params: Record<string, unknown>
    portId: string
  }

  const connectCandidates = useMemo<ConnectCandidate[]>(() => {
    if (!connectMenu) return []
    const out: ConnectCandidate[] = []
    const fromSource = connectMenu.handleType === 'source'
    const onCanvasKinds = new Set(
      nodes.filter((n) => n.data.defType === 'artifact').map((n) => String(n.data.params.kind ?? '')),
    )
    const onCanvasGates = new Set(
      nodes.filter((n) => n.data.defType === 'gate').map((n) => String(n.data.params.gate ?? '')),
    )
    const consider = (def: WfNodeDef, defType: string, params: Record<string, unknown>) => {
      const ports = fromSource ? def.inputs : def.outputs
      const hit = ports.find((p) => p.type === connectMenu.portType)
      if (!hit) return
      out.push({
        key: `${defType}-${String(params.kind ?? params.gate ?? hit.id)}`,
        label: def.label,
        sub: fromSource ? `接入「${hit.label}」` : `由「${hit.label}」接出`,
        defType,
        params,
        portId: hit.id,
      })
    }
    if (workflow?.path === 'structured') {
      for (const k of ARTIFACT_KINDS) {
        if (onCanvasKinds.has(k.kind)) continue
        consider(defForNode({ type: 'artifact', params: { kind: k.kind } })!, 'artifact', { kind: k.kind, status: 'missing', version: '', summary: '', fixture: false })
      }
      for (const g of Object.keys(GATE_DEFS)) {
        if (onCanvasGates.has(g)) continue
        consider(defForNode({ type: 'gate', params: { gate: g } })!, 'gate', { gate: g, decision: 'not-started', recommendation: '', validFor: [], notApproved: [], source: 'live' })
      }
    } else {
      for (const d of PF_NODE_DEFS) consider(d, d.type, pfDefaultParams(d.type))
    }
    return out
  }, [connectMenu, nodes, workflow?.path])

  const pickConnectCandidate = useCallback(
    (cand: ConnectCandidate) => {
      if (!connectMenu) return
      const pos = connectMenu.handleType === 'source'
        ? { x: connectMenu.flowPos.x + 24, y: connectMenu.flowPos.y - 46 }
        : { x: connectMenu.flowPos.x - 284, y: connectMenu.flowPos.y - 46 }
      const id = addNode(cand.defType, cand.params, pos)
      const conn: Connection = connectMenu.handleType === 'source'
        ? { source: connectMenu.nodeId, sourceHandle: connectMenu.handleId, target: id, targetHandle: cand.portId }
        : { source: id, sourceHandle: cand.portId, target: connectMenu.nodeId, targetHandle: connectMenu.handleId }
      // 新节点刚入 state，onConnect 读的 nodes 还是旧快照——直接在此拼边（端口已按类型筛过）
      setEdges((prev) => {
        const kept = prev.filter((e) => !(e.target === conn.target && e.targetHandle === conn.targetHandle))
        return [
          ...kept,
          {
            id: nid(),
            source: conn.source!,
            sourceHandle: conn.sourceHandle ?? undefined,
            target: conn.target!,
            targetHandle: conn.targetHandle ?? undefined,
            style: { stroke: WF_PORT_COLORS[connectMenu.portType], strokeWidth: 1.5 },
          } as Edge,
        ]
      })
      setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })))
      setConnectMenu(null)
      markDirty()
    },
    [connectMenu, addNode, markDirty],
  )

  const doSave = useCallback(() => {
    const snap = snapshot()
    if (!snap) return
    const saved = workflowService.saveWorkflow(snap.id, { name: snap.name, nodes: snap.nodes, edges: snap.edges })
    if (saved) {
      setWorkflow(saved)
      setDirty(false)
    }
  }, [snapshot])

  const doRun = useCallback(() => {
    const snap = snapshot()
    if (!snap || running) return
    setRunning(true)
    setLiveEvents([])
    setViewing(null)
    setDrawerOpen(true)
    setDrawerTab('events')
    setNodes((prev) => prev.map((n) => (n.type === 'fm' ? { ...n, data: { ...n.data, status: 'pending' as const } } : n)))
    const handle = startDemoRun(snap, {
      onEvent: (e) => setLiveEvents((prev) => [...prev, e]),
      onNodeStatus: (nodeId, status) =>
        setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n))),
    })
    runHandle.current = handle
    void handle.done.then((run) => {
      setLastRun(run)
      setRunning(false)
      runHandle.current = null
      if (run.status === 'completed') setDrawerTab('artifacts')
    })
  }, [snapshot, running])

  /* 创作启动层快速路径：带 autoRun 进来时，工作流载入后自动跑一次（仅一次） */
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (!autoRun || !workflow || autoRanRef.current) return
    autoRanRef.current = true
    doRun()
  }, [autoRun, workflow, doRun])

  /* 单节点运行（检查器「只运行此节点 / 评估此节点」） */
  const doRunNode = useCallback(
    (nodeId: string) => {
      const snap = snapshot()
      if (!snap || running) return
      setRunning(true)
      setLiveEvents([])
      const handle = startSingleNodeRun(snap, nodeId, {
        onEvent: (e) => setLiveEvents((prev) => [...prev, e]),
        onNodeStatus: (id, status) =>
          setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, status } } : n))),
      })
      runHandle.current = handle
      void handle.done.then((run) => {
        setLastRun(run)
        setRunning(false)
        runHandle.current = null
      })
    },
    [snapshot, running],
  )

  /* 待处理资源 */
  const addFxIntent = (intent: FxIntent) => {
    const capNode = nodes.find((n) => n.data.defType === 'capability')
    if (capNode) {
      const ids = (capNode.data.params.techniqueIds as string[] | undefined) ?? []
      if (!ids.includes(intent.techniqueId)) updateParams(capNode.id, { techniqueIds: [...ids, intent.techniqueId] })
    } else {
      const id = addNode('capability', pfDefaultParams('capability'))
      setTimeout(() => updateParams(id, { techniqueIds: [intent.techniqueId] }), 0)
    }
    const list = readJson<FxIntent[]>(FX_OUTBOX_KEY, [])
    const at = list.findIndex((x) => x.techniqueId === intent.techniqueId && x.at === intent.at)
    if (at >= 0) {
      list[at] = { ...list[at], status: 'added', workflowId }
      try { localStorage.setItem(FX_OUTBOX_KEY, JSON.stringify(list)) } catch { /* ignore */ }
    }
    setPendingTick((t) => t + 1)
  }

  const addRefSegment = (segmentId: string) => {
    if (workflow?.path === 'structured') {
      const logNode = nodes.find((n) => n.data.defType === 'artifact' && String(n.data.params.kind) === 'reference-log')
      if (!logNode) return
      const seg = REFERENCE_SEGMENTS.find((s) => s.id === segmentId)
      const film = seg ? REFERENCE_VIDEOS.find((v) => v.id === seg.videoId) : null
      const line = `引用片段：${film ? `${film.title} · 片段 ${(seg?.index ?? 0) + 1}` : segmentId}（来自参考片库意向清单）`
      const prev = String(logNode.data.params.summary ?? '')
      updateParams(logNode.id, {
        summary: prev ? `${prev}\n${line}` : line,
        status: String(logNode.data.params.status ?? 'missing') === 'missing' ? 'draft' : String(logNode.data.params.status),
      })
    } else {
      const refsNode = nodes.find((n) => n.data.defType === 'refs')
      if (!refsNode) return
      const ids = (refsNode.data.params.refSegmentIds as string[] | undefined) ?? []
      if (!ids.includes(segmentId)) updateParams(refsNode.id, { refSegmentIds: [...ids, segmentId] })
    }
    const map = readJson<Record<string, string>>(REF_CONSUMED_KEY, {})
    map[segmentId] = workflowId
    try { localStorage.setItem(REF_CONSUMED_KEY, JSON.stringify(map)) } catch { /* ignore */ }
    setPendingTick((t) => t + 1)
  }

  const downloadArtifact = (a: WfArtifact) => {
    const blob = new Blob([a.content], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = a.filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const goReview = () => {
    window.postMessage({ type: 'fm-nav', id: 'production', projectId: workflow?.projectId ?? 'token' }, '*')
  }

  if (!workflow) {
    return (
      <section className="wfe">
        <div className="wfe-cmd">
          <button type="button" className="wfe-iconbtn" onClick={onBack} aria-label="返回工作流首页"><ArrowLeft size={16} /></button>
          <b>工作流不存在或已被删除</b>
        </div>
      </section>
    )
  }

  const isStructured = workflow.path === 'structured'
  const eventsToShow = running || liveEvents.length > 0 ? liveEvents : (lastRun?.events ?? [])
  const artifactsToShow = lastRun?.artifacts ?? []
  const visibleEdges = edges.filter((e) => {
    const s = nodes.find((n) => n.id === e.source)
    const t = nodes.find((n) => n.id === e.target)
    return !s?.hidden && !t?.hidden
  })
  const targetForRefs = isStructured
    ? nodes.some((n) => n.data.defType === 'artifact' && String(n.data.params.kind) === 'reference-log')
    : nodes.some((n) => n.data.defType === 'refs')

  return (
    <section className="wfe" aria-label="工作流编辑器">
      <div className="wfe-cmd">
        <button type="button" className="wfe-iconbtn" onClick={onBack} aria-label="返回工作流首页">
          <ArrowLeft size={16} strokeWidth={2.2} />
        </button>
        <input className="wfe-name" value={name} onChange={(e) => { setName(e.target.value); markDirty() }} aria-label="工作流名称" />
        <span className="wfe-pathbadge" data-p={workflow.path}>{isStructured ? 'Structured' : 'Prompt-first'}</span>
        <span className="wfe-savestate">{dirty ? '有未保存更改' : `已保存 · 修订 ${workflow.revision}`}</span>
        <span className="wfe-demo">DEMO 执行器</span>
        <span className="wfe-spacer" />
        {running && (
          <button type="button" className="wfe-btn" onClick={() => runHandle.current?.cancel()}>
            <Ban size={13} strokeWidth={2.2} /> 取消
          </button>
        )}
        <button type="button" className="wfe-btn" onClick={doSave} disabled={!dirty}>
          <Save size={13} strokeWidth={2.2} /> 保存
        </button>
        <button type="button" className="wfe-btn is-primary" onClick={doRun} disabled={running}>
          <Play size={13} strokeWidth={2.2} /> {running ? '运行中…' : isStructured ? '评估状态' : '运行'}
        </button>
      </div>

      <div className="wfe-body">
        <aside className="wfe-left" aria-label="构建栏">
          <div className="wfe-tabs" role="tablist" aria-label="构建栏页签">
            <button type="button" role="tab" aria-selected={leftTab === 'nodes'} data-on={leftTab === 'nodes' ? '' : undefined} onClick={() => setLeftTab('nodes')}>
              节点
            </button>
            <button type="button" role="tab" aria-selected={leftTab === 'pending'} data-on={leftTab === 'pending' ? '' : undefined} onClick={() => setLeftTab('pending')}>
              待处理资源
              {(fxIntents.length + refIds.length) > 0 && <em className="num">{fxIntents.length + refIds.length}</em>}
            </button>
          </div>
          {leftTab === 'nodes' ? (
            <div className="wfe-nodelist">
              {!isStructured &&
                PF_NODE_DEFS.map((d) => (
                  <button key={d.type} type="button" className="wfe-nodeitem" onClick={() => addNode(d.type, pfDefaultParams(d.type))} title="点击添加到画布">
                    <span className="wfe-nodeitem-top"><b>{d.label}</b><Plus size={12} strokeWidth={2.4} /></span>
                    <span>{d.description}</span>
                  </button>
                ))}
              {isStructured && (
                <>
                  {STRUCTURED_STAGES.map((s) => (
                    <div key={s.index} className="wfe-stagegroup">
                      <h4>阶段 {s.index} · {s.label}</h4>
                      {ARTIFACT_KINDS.filter((k) => k.stage === s.index).map((k) => (
                        <button
                          key={k.kind}
                          type="button"
                          className="wfe-nodeitem"
                          onClick={() => addNode('artifact', { kind: k.kind, status: 'missing', version: '', summary: '', fixture: false })}
                          title="点击添加为自由节点"
                        >
                          <span className="wfe-nodeitem-top"><b>{k.label}</b><Plus size={12} strokeWidth={2.4} /></span>
                          <span>{k.filename}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                  <h4 className="wfe-stagegroup-title">检查点</h4>
                  {Object.entries(GATE_DEFS).map(([g, def]) => (
                    <button
                      key={g}
                      type="button"
                      className="wfe-nodeitem"
                      onClick={() => addNode('gate', { gate: g, decision: 'not-started', recommendation: '', validFor: [], notApproved: [], source: 'live' })}
                      title="点击添加到画布"
                    >
                      <span className="wfe-nodeitem-top"><b>{def.label}</b><Plus size={12} strokeWidth={2.4} /></span>
                      <span>{def.question}</span>
                    </button>
                  ))}
                  <p className="wfe-hint">从这里新增的产物是自由节点；阶段泳道由模板骨架提供。Gate 的确认在检查器里对具体产物版本做出，运行不会代确认。</p>
                </>
              )}
              {!isStructured && <p className="wfe-hint">Prompt-first 没有 Gate：工作稿不是审批门，中间规格未完成不阻断创作与渲染。连线按端口类型校验。</p>}
            </div>
          ) : (
            <div className="wfe-pending">
              <h3>技法意向 <em className="num">{fxIntents.length}</em></h3>
              {fxIntents.length === 0 && <p className="wfe-hint">暂无。在特效库点「用于工作流」后，意向会出现在这里。</p>}
              {fxIntents.map((it, i) => {
                const added = it.status === 'added' && it.workflowId === workflowId
                return (
                  <div key={`${it.techniqueId}-${i}`} className="wfe-pend">
                    <b>{it.techniqueName}</b>
                    <span>意向目标：{it.projectName}</span>
                    <button type="button" className="wfe-btn sm" disabled={added || isStructured} onClick={() => addFxIntent(it)}>
                      {added ? '已加入本工作流（待保存）' : isStructured ? 'Structured 中经能力映射接入（待后续）' : '加入能力检索'}
                    </button>
                  </div>
                )
              })}
              <h3>参考结论 <em className="num">{refIds.length}</em></h3>
              {refIds.length === 0 && <p className="wfe-hint">暂无。在参考片库点「用作参考」后，片段结论会出现在这里。</p>}
              {refIds.map((id) => {
                const seg = REFERENCE_SEGMENTS.find((s) => s.id === id)
                const film = seg ? REFERENCE_VIDEOS.find((v) => v.id === seg.videoId) : null
                const attached = refConsumed[id] === workflowId
                return (
                  <div key={id} className="wfe-pend">
                    <b>{film ? `${film.title} · 片段 ${(seg?.index ?? 0) + 1}` : id}</b>
                    <span>{seg?.observation ?? '来源片段不存在'}</span>
                    <button type="button" className="wfe-btn sm" disabled={attached || !targetForRefs} onClick={() => addRefSegment(id)}>
                      {attached
                        ? '已接入本工作流（待保存）'
                        : !targetForRefs
                          ? isStructured ? '画布上暂无参考记录节点' : '画布上暂无参考与素材节点'
                          : isStructured ? '记入参考记录' : '加入参考与素材'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </aside>

        <div className="wfe-canvas" ref={wrapRef} data-compact={compact || undefined}>
          <ReactFlow
            nodes={nodes}
            edges={running ? visibleEdges.map((e) => ({ ...e, animated: true })) : visibleEdges}
            nodeTypes={nodeTypes}
            onMove={(_, vp) => setCompact(vp.zoom < 0.7)}
            onNodesChange={(changes) => {
              setNodes((prev) => {
                let next = [...prev]
                for (const c of changes) {
                  if (c.type === 'position' && c.position) next = next.map((n) => (n.id === c.id ? { ...n, position: c.position!, dragging: c.dragging } : n))
                  if (c.type === 'select') next = next.map((n) => (n.id === c.id ? { ...n, selected: c.selected } : n))
                  if (c.type === 'dimensions' && c.dimensions) next = next.map((n) => (n.id === c.id ? { ...n, measured: c.dimensions } : n))
                  if (c.type === 'remove') {
                    const removed = next.find((n) => n.id === c.id)
                    next = next.filter((n) => n.id !== c.id)
                    if (removed?.type === 'lane') {
                      next = next.map((n) =>
                        n.parentId === c.id
                          ? { ...n, parentId: undefined, position: { x: n.position.x + removed.position.x, y: n.position.y + removed.position.y } }
                          : n,
                      )
                    }
                  }
                }
                return next
              })
              if (changes.some((c) => c.type === 'remove' || (c.type === 'position' && !(c as { dragging?: boolean }).dragging))) markDirty()
            }}
            onEdgesChange={(changes) => {
              setEdges((prev) => {
                let next = [...prev]
                for (const c of changes) {
                  if (c.type === 'select') next = next.map((e) => (e.id === c.id ? { ...e, selected: c.selected } : e))
                  if (c.type === 'remove') next = next.filter((e) => e.id !== c.id)
                }
                return next
              })
              if (changes.some((c) => c.type === 'remove')) markDirty()
            }}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 0.95 }}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap position="bottom-right" pannable zoomable style={{ width: 148, height: 96 }} />
          </ReactFlow>
          {connectMenu && (
            <ConnectMenuView
              x={connectMenu.x}
              y={connectMenu.y}
              portType={connectMenu.portType}
              fromSource={connectMenu.handleType === 'source'}
              candidates={connectCandidates}
              onPick={pickConnectCandidate}
              onClose={() => setConnectMenu(null)}
            />
          )}
        </div>

        <aside className="wfe-inspector" aria-label="检查器">
          {selectedNode ? (
            <Inspector
              node={selectedNode}
              workflow={snapshot()}
              onParams={(patch) => updateParams(selectedNode.id, patch)}
              inputs={edges
                .filter((e) => e.target === selectedNode.id)
                .map((e) => {
                  const src = nodes.find((n) => n.id === e.source)
                  if (!src) return null
                  const sdef = defForNode({ type: src.data.defType, params: src.data.params })
                  const art = lastRun?.artifacts.find((a) => a.nodeId === src.id)
                  const detail = art
                    ? art.summary
                    : src.data.defType === 'artifact'
                      ? String(src.data.params.status ?? 'missing') === 'missing'
                        ? '尚无产物'
                        : `${String(src.data.params.status)}${src.data.params.version ? ` · ${String(src.data.params.version)}` : ''}`
                      : src.data.defType === 'gate'
                        ? '检查点'
                        : pfSummary(src.data.defType, src.data.params)
                  return { nodeId: src.id, label: sdef?.label ?? src.data.defType, detail }
                })
                .filter((x): x is { nodeId: string; label: string; detail: string } => !!x)}
              output={lastRun?.artifacts.find((a) => a.nodeId === selectedNode.id) ?? null}
              busy={running}
              onRunNode={() => doRunNode(selectedNode.id)}
              onSelectNode={(id) => setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })))}
            />
          ) : selectedEdge ? (
            <div className="wfe-insp">
              <h3>连线</h3>
              <p className="wfe-hint">端口类型一致的连线。按 Delete 可删除。</p>
            </div>
          ) : (
            <div className="wfe-insp">
              <h3>检查器</h3>
              <p className="wfe-hint">选中节点查看并编辑；选中 Gate 查看确认范围与阻塞原因。</p>
              <dl className="wfe-kv">
                <dt>工作流</dt><dd>{workflow.name}</dd>
                <dt>路径</dt><dd>{isStructured ? 'Structured（按需）' : 'Prompt-first（默认）'}</dd>
                <dt>修订</dt><dd className="num">{workflow.revision}</dd>
                <dt>节点 / 连线</dt><dd className="num">{nodes.filter((n) => n.type === 'fm').length} / {edges.length}</dd>
                <dt>执行器</dt><dd>DEMO（Mock 适配器，本地持久化）</dd>
              </dl>
            </div>
          )}
        </aside>
      </div>

      <div className="wfe-drawer" data-open={drawerOpen || undefined}>
        <button type="button" className="wfe-drawer-head" onClick={() => setDrawerOpen((v) => !v)} aria-expanded={drawerOpen}>
          <ChevronDown size={14} className={drawerOpen ? 'wfe-chev is-open' : 'wfe-chev'} />
          {isStructured ? '评估日志' : '执行日志'}
          {lastRun && <span className="wfe-drawer-meta">最近：{lastRun.status === 'completed' ? '已完成' : lastRun.status} · {lastRun.artifacts.length} 项产物 · {new Date(lastRun.startedAt).toLocaleTimeString('zh-CN')}</span>}
          {running && <span className="wfe-drawer-meta">进行中…</span>}
        </button>
        {drawerOpen && (
          <div className="wfe-drawer-body">
            <div className="wfe-tabs sm" role="tablist" aria-label="日志视图">
              {([['events', '事件'], ['outputs', '节点输出'], ['artifacts', '产物']] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={drawerTab === id} data-on={drawerTab === id ? '' : undefined} onClick={() => setDrawerTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            {drawerTab === 'events' && (
              <ul className="wfe-events">
                {eventsToShow.length === 0 && <li className="wfe-hint">暂无事件。点击顶部「{isStructured ? '评估状态' : '运行'}」开始。</li>}
                {eventsToShow.map((e) => (
                  <li key={e.id} data-k={e.kind}>
                    <span className="num">{new Date(e.at).toLocaleTimeString('zh-CN')}</span> {e.message}
                  </li>
                ))}
              </ul>
            )}
            {drawerTab === 'outputs' && (
              <ul className="wfe-events">
                {nodes.filter((n) => n.type === 'fm').map((n) => {
                  const st = lastRun?.nodeStatus[n.id] ?? n.data.status
                  const def = defForNode({ type: n.data.defType, params: n.data.params })
                  return (
                    <li key={n.id}>
                      {def?.label}：
                      {st === 'completed' ? '已完成' : st === 'running' ? '进行中' : st === 'failed' ? '失败' : st === 'skipped' ? (isStructured ? '尚无产物/已跳过' : '已跳过') : '待处理'}
                    </li>
                  )
                })}
                {nodes.filter((n) => n.type === 'fm').length === 0 && <li className="wfe-hint">画布上还没有节点。</li>}
              </ul>
            )}
            {drawerTab === 'artifacts' && (
              <div className="wfe-artifacts">
                {viewing ? (
                  <div className="wfe-artifact-view">
                    <div className="wfe-artifact-view-head">
                      <b>{viewing.title}</b>
                      <span>{viewing.filename}</span>
                      <button type="button" className="wfe-btn sm" onClick={() => setViewing(null)}>返回产物列表</button>
                    </div>
                    <pre>{viewing.content}</pre>
                  </div>
                ) : (
                  <>
                    {artifactsToShow.length === 0 && <p className="wfe-hint">暂无产物。{isStructured ? '评估' : '运行'}完成后，产物会出现在这里。</p>}
                    {artifactsToShow.map((a) => (
                      <div key={a.id} className="wfe-artifact">
                        <div className="wfe-artifact-main">
                          <b>{a.title}</b>
                          <span>{a.summary}</span>
                        </div>
                        <button type="button" className="wfe-btn sm" onClick={() => setViewing(a)}><Eye size={12} /> 查看</button>
                        <button type="button" className="wfe-btn sm" onClick={() => downloadArtifact(a)}><Download size={12} /> 下载</button>
                        {(a.kind === 'create' || a.kind === 'evaluation') && (
                          <button type="button" className="wfe-btn sm" onClick={goReview}>去工作台</button>
                        )}
                      </div>
                    ))}
                    {artifactsToShow.some((a) => a.kind === 'create') && (
                      <p className="wfe-hint">渲染节点只产出请求记录，真实渲染未接入；「去工作台」打开对应项目的制作工作台。</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/* ── Inspector ───────────────────────────────────────────────────── */

const RUN_STATUS_TXT: Record<string, string> = {
  pending: '待处理',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
}

function InspHead(props: { kicker: string; title: string; chip?: ReactNode }) {
  return (
    <div className="wfe-insp-head">
      <span className="wfe-insp-kicker">{props.kicker}</span>
      <div className="wfe-insp-titlerow">
        <h3>{props.title}</h3>
        {props.chip}
      </div>
    </div>
  )
}

function TechDetails({ node }: { node: FmNode }) {
  const def = defForNode({ type: node.data.defType, params: node.data.params })
  if (!def) return null
  const fmt = (ports: typeof def.inputs) =>
    ports.length ? ports.map((x) => `${x.label}（${x.type}）`).join('、') : '无'
  return (
    <details className="wfe-tech">
      <summary>技术细节</summary>
      <dl className="wfe-kv">
        <dt>节点 ID</dt><dd className="num">{node.id}</dd>
        <dt>节点类型</dt>
        <dd>
          {node.data.defType}
          {node.data.defType === 'artifact' ? ` · ${String(node.data.params.kind ?? '')}` : ''}
          {node.data.defType === 'gate' ? ` · ${String(node.data.params.gate ?? '')}` : ''}
        </dd>
        <dt>输入端口</dt><dd>{fmt(def.inputs)}</dd>
        <dt>输出端口</dt><dd>{fmt(def.outputs)}</dd>
        {node.data.defType === 'gate' && (
          <>
            <dt>确认记录</dt>
            <dd>{String(node.data.params.decision ?? 'not-started')}{typeof node.data.params.confirmedAt === 'string' && node.data.params.confirmedAt ? ` · ${new Date(node.data.params.confirmedAt).toLocaleString('zh-CN')}` : ''}</dd>
          </>
        )}
      </dl>
    </details>
  )
}

/* ── 检查器三格契约（P0-2）：输入 | 参数（只运行此节点）| 输出 ── */

interface InspInputItem {
  nodeId: string
  label: string
  detail: string
}

function InspInputs({ items, onSelectNode }: { items: InspInputItem[]; onSelectNode: (id: string) => void }) {
  return (
    <div className="wfe-sect3">
      <div className="wfe-sect3-head">输入</div>
      {items.length === 0 ? (
        <p className="wfe-hint">无上游输入（起始节点）。</p>
      ) : (
        <div className="wfe-in3-list">
          {items.map((it) => (
            <button key={it.nodeId} type="button" className="wfe-in3" onClick={() => onSelectNode(it.nodeId)}>
              <b>{it.label}</b>
              <span>{it.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function InspParamsHead({ runLabel, busy, onRunNode }: { runLabel: string; busy: boolean; onRunNode: () => void }) {
  return (
    <div className="wfe-sect3-head is-row">
      参数
      <button type="button" className="wfe-btn sm is-primary" disabled={busy} onClick={onRunNode}>
        <Play size={11} strokeWidth={2.6} /> {runLabel}
      </button>
    </div>
  )
}

function InspOutput({ output, emptyText }: { output: WfArtifact | null; emptyText: string }) {
  return (
    <div className="wfe-sect3">
      <div className="wfe-sect3-head">输出 · 最近一次运行</div>
      {output ? (
        <div className="wfe-out3">
          <b>{output.title}</b>
          <span>{output.summary}</span>
          <span className="num">{output.filename} · DEMO 快照</span>
        </div>
      ) : (
        <p className="wfe-hint">{emptyText}</p>
      )}
    </div>
  )
}

function Inspector(props: {
  node: FmNode
  workflow: WorkflowDef | null
  onParams: (patch: Record<string, unknown>) => void
  inputs: InspInputItem[]
  output: WfArtifact | null
  busy: boolean
  onRunNode: () => void
  onSelectNode: (id: string) => void
}) {
  const { node, onParams } = props
  const def = defForNode({ type: node.data.defType, params: node.data.params })
  const p = node.data.params
  if (!def) return null
  const tokenAssets = BUILTIN_ASSETS.filter((a) => a.refs.some((r) => r.kind === 'project' && r.id === 'token'))

  if (node.data.defType === 'gate') {
    const ev = node.data.gateEval
    const primaryKind = ev?.primaryKind ?? ''
    const primaryLabel = ARTIFACT_KIND_MAP[primaryKind]?.label ?? primaryKind
    const primaryNode = props.workflow?.nodes.find((n) => n.type === 'artifact' && String(n.params.kind ?? '') === primaryKind)
    const primaryVersion = String(primaryNode?.params.version ?? '')
    const lines = (v: unknown) => ((v as string[] | undefined) ?? []).join('\n')
    const parseLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
    return (
      <div className="wfe-insp">
        <InspHead
          kicker="检查点 · Gate"
          title={def.label}
          chip={
            <span className="wfn-gate-chip" data-d={ev?.stale ? 'confirmed-stale' : (ev?.decision ?? 'not-started')}>
              {ev?.stale ? '已确认 · 已失效' : ev?.decision === 'confirmed' ? '已确认' : ev?.decision === 'pending' ? '待确认' : '未开始'}
            </span>
          }
        />
        <p className="wfe-hint">检查点问题：{def.description}。确认绑定具体产物与版本；推荐不等于确认。</p>
        <div className="wfe-runrow">
          <button type="button" className="wfe-btn sm is-primary" disabled={props.busy} onClick={props.onRunNode}>
            <Play size={11} strokeWidth={2.6} /> 评估此检查点
          </button>
          <span className="wfe-hint">只评估当前状态，不代替确认</span>
        </div>
        <dl className="wfe-kv">
          <dt>主检产物</dt>
          <dd>{primaryLabel}（{ev?.primaryStatus ?? 'missing'}{primaryVersion ? ` · ${primaryVersion}` : ''}）</dd>
          <dt>当前状态</dt>
          <dd>{ev?.stale ? '已确认（版本已变更，确认失效）' : ev?.decision === 'confirmed' ? '已确认' : ev?.decision === 'pending' ? '待确认' : '未开始'}</dd>
          {p.source === 'fixture' && (<><dt>数据来源</dt><dd>演示快照（fixture）</dd></>)}
        </dl>
        {ev && ev.blocked.length > 0 && (
          <div className="wfe-field"><span>阻塞原因（按当前产物实时计算）</span>
            <ul className="wfe-blocklist">
              {ev.blocked.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
        )}
        <label className="wfe-field"><span>推荐方案（系统建议，≠确认）</span>
          <textarea rows={2} value={String(p.recommendation ?? '')} onChange={(e) => onParams({ recommendation: e.target.value })} placeholder="可记录推荐方向；填写推荐不会改变确认状态" />
        </label>
        <label className="wfe-field"><span>批准范围 validFor（每行一项）</span>
          <textarea rows={2} value={lines(p.validFor)} onChange={(e) => onParams({ validFor: parseLines(e.target.value) })} />
        </label>
        <label className="wfe-field"><span>未批准 notApproved（每行一项）</span>
          <textarea rows={2} value={lines(p.notApproved)} onChange={(e) => onParams({ notApproved: parseLines(e.target.value) })} />
        </label>
        {ev?.decision === 'confirmed' && !ev.stale ? (
          <button type="button" className="wfe-btn" onClick={() => onParams({ decision: 'pending', confirmedFor: undefined, confirmedAt: undefined })}>
            撤销确认
          </button>
        ) : (
          <button
            type="button"
            className="wfe-btn is-primary"
            disabled={!primaryNode || ev?.primaryStatus === 'missing'}
            onClick={() => onParams({ decision: 'confirmed', confirmedFor: { kind: primaryKind, version: primaryVersion }, confirmedAt: new Date().toISOString() })}
          >
            确认{primaryLabel}{primaryVersion ? ` ${primaryVersion}` : ''}
          </button>
        )}
        {(!primaryNode || ev?.primaryStatus === 'missing') && <p className="wfe-hint">主检产物尚不存在或尚无产物，无法确认。</p>}
        {typeof p.confirmedAt === 'string' && p.confirmedAt && (
          <p className="wfe-hint">确认时间：{new Date(p.confirmedAt).toLocaleString('zh-CN')}（本地记录）</p>
        )}
        <InspOutput output={props.output} emptyText="尚无评估快照。点「评估此检查点」生成一次单点评估（不构成确认）。" />
        <TechDetails node={node} />
      </div>
    )
  }

  if (node.data.defType === 'artifact') {
    const kind = ARTIFACT_KIND_MAP[String(p.kind ?? '')]
    return (
      <div className="wfe-insp">
        <InspHead
          kicker={`产物 · 阶段 ${kind?.stage ?? ''} ${STRUCTURED_STAGES[kind?.stage ?? 0]?.label ?? ''}`}
          title={kind?.label ?? '产物'}
          chip={<span className="wfn-artifact-chip" data-s={String(p.status ?? 'missing')}>{ARTIFACT_STATUS_LABEL[String(p.status ?? 'missing')] ?? String(p.status ?? '')}</span>}
        />
        <p className="wfe-hint">{kind?.filename}。状态与摘要是本工作流内的真实记录，demo 不代生成。</p>
        <InspInputs items={props.inputs} onSelectNode={props.onSelectNode} />
        <div className="wfe-sect3">
        <InspParamsHead runLabel="评估此节点" busy={props.busy} onRunNode={props.onRunNode} />
        <label className="wfe-field"><span>状态</span>
          <select value={String(p.status ?? 'missing')} onChange={(e) => onParams({ status: e.target.value })}>
            <option value="missing">尚无产物</option>
            <option value="draft">draft</option>
            <option value="candidate">candidate</option>
            <option value="confirmed">confirmed</option>
          </select>
        </label>
        <label className="wfe-field"><span>版本</span>
          <input value={String(p.version ?? '')} onChange={(e) => onParams({ version: e.target.value })} placeholder="如 v1" />
        </label>
        <label className="wfe-field"><span>摘要（1–3 行）</span>
          <textarea rows={4} value={String(p.summary ?? '')} onChange={(e) => onParams({ summary: e.target.value })} />
        </label>
        <label className="wfe-check">
          <input type="checkbox" checked={!!p.fixture} onChange={(e) => onParams({ fixture: e.target.checked })} />
          <span>演示快照（fixture）</span>
        </label>
        </div>
        {props.output ? (
          <InspOutput output={props.output} emptyText="" />
        ) : (
          <div className="wfe-sect3">
            <div className="wfe-sect3-head">输出 · 当前记录</div>
            <div className="wfe-out3">
              <b>{kind?.label ?? '产物'} · {ARTIFACT_STATUS_LABEL[String(p.status ?? 'missing')] ?? String(p.status ?? '')}</b>
              <span>{String(p.status ?? 'missing') === 'missing' ? '尚无产物' : String(p.summary ?? '').trim() || '（无摘要）'}</span>
              <span className="num">{kind?.filename ?? ''}{p.version ? ` · ${String(p.version)}` : ''}</span>
            </div>
          </div>
        )}
        <TechDetails node={node} />
      </div>
    )
  }

  return (
    <div className="wfe-insp">
      <InspHead
        kicker={def.group}
        title={def.label}
        chip={node.data.status !== 'idle' ? <span className="wfe-insp-run" data-s={node.data.status}>{RUN_STATUS_TXT[node.data.status] ?? ''}</span> : undefined}
      />
      <p className="wfe-hint">{def.description}</p>
      <InspInputs items={props.inputs} onSelectNode={props.onSelectNode} />
      <div className="wfe-sect3">
      <InspParamsHead runLabel="只运行此节点" busy={props.busy} onRunNode={props.onRunNode} />

      {node.data.defType === 'prompt' && (
        <>
          <label className="wfe-field"><span>原始提示词</span>
            <textarea rows={9} value={String(p.text ?? '')} onChange={(e) => onParams({ text: e.target.value })} placeholder="直接写创作需求，不必先整理成结构化文档" />
          </label>
          <label className="wfe-field"><span>目标受众</span>
            <input value={String(p.audience ?? '')} onChange={(e) => onParams({ audience: e.target.value })} />
          </label>
          <label className="wfe-field"><span>时长 / 比例</span>
            <input value={String(p.duration ?? '')} onChange={(e) => onParams({ duration: e.target.value })} placeholder="如 约 3 分钟" />
          </label>
          <div className="wfe-seg">
            {['16:9', '9:16', '1:1'].map((r) => (
              <button key={r} type="button" data-on={p.ratio === r ? '' : undefined} aria-pressed={p.ratio === r} onClick={() => onParams({ ratio: r })}>{r}</button>
            ))}
          </div>
        </>
      )}

      {node.data.defType === 'refs' && (
        <>
          <p className="wfe-hint">项目：Token 科普视频。只引用真实素材与参考结论，不复制文件。</p>
          <div className="wfe-checks">
            {tokenAssets.map((a) => {
              const ids = (p.assetIds as string[] | undefined) ?? []
              const on = ids.includes(a.id)
              return (
                <label key={a.id} className="wfe-check">
                  <input type="checkbox" checked={on} onChange={() => onParams({ assetIds: on ? ids.filter((x) => x !== a.id) : [...ids, a.id] })} />
                  <span>{a.name}</span><em>{MEDIA_LABEL[a.mediaType]}</em>
                </label>
              )
            })}
          </div>
          {((p.refSegmentIds as string[] | undefined) ?? []).length > 0 && (
            <div className="wfe-field"><span>已接入的参考结论</span>
              <ul className="wfe-reflist">
                {((p.refSegmentIds as string[]) ?? []).map((id) => {
                  const seg = REFERENCE_SEGMENTS.find((s) => s.id === id)
                  const film = seg ? REFERENCE_VIDEOS.find((v) => v.id === seg.videoId) : null
                  return (
                    <li key={id}>
                      <span>{film ? `${film.title} · 片段 ${(seg?.index ?? 0) + 1}` : id}</span>
                      <button type="button" className="wfe-textbtn" onClick={() => onParams({ refSegmentIds: ((p.refSegmentIds as string[]) ?? []).filter((x) => x !== id) })}>移除</button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {(node.data.defType === 'lookdev' || node.data.defType === 'filmplan') && (
        <>
          <label className="wfe-field"><span>工作稿内容</span>
            <textarea rows={10} value={String(p.summary ?? '')} onChange={(e) => onParams({ summary: e.target.value })} placeholder={node.data.defType === 'lookdev' ? '视觉基调、材质、色彩、光线、动势…' : '叙事推进、镜头节奏、视听策略…'} />
          </label>
          <p className="wfe-hint">工作稿可随时迭代，不是审批门；运行只保存你的内容快照。</p>
        </>
      )}

      {node.data.defType === 'capability' && (
        <>
          <p className="wfe-hint">从能力注册表（本地特效技法库快照）勾选候选；运行只记录检索结果，不执行能力。</p>
          <div className="wfe-checks">
            {FX_TECHNIQUES.map((t) => {
              const ids = (p.techniqueIds as string[] | undefined) ?? []
              const on = ids.includes(t.id)
              return (
                <label key={t.id} className="wfe-check">
                  <input type="checkbox" checked={on} onChange={() => onParams({ techniqueIds: on ? ids.filter((x) => x !== t.id) : [...ids, t.id] })} />
                  <span>{t.name}</span><em>{t.execLabel}</em>
                </label>
              )
            })}
          </div>
        </>
      )}

      {node.data.defType === 'create' && (
        <>
          <label className="wfe-field"><span>制作模式</span>
            <select value={String(p.mode ?? 'sketch')} onChange={(e) => onParams({ mode: e.target.value })}>
              <option value="sketch">sketch · 快速试作</option>
              <option value="prototype">prototype · 原型</option>
              <option value="production">production · 正式制作</option>
            </select>
          </label>
          <label className="wfe-field"><span>目标规格</span>
            <select value={String(p.resolution ?? '1080p')} onChange={(e) => onParams({ resolution: e.target.value })}>
              <option value="1080p">1080p · 1920×1080</option>
              <option value="1440p">1440p · 2560×1440</option>
              <option value="4k">4k · 3840×2160</option>
            </select>
          </label>
          <p className="wfe-hint">运行只生成渲染请求记录；真实渲染未接入，不会产生视频文件。</p>
        </>
      )}

      {node.data.defType === 'review' && (
        <>
          <div className="wfe-field"><span>quality-bar · 看片问题（由你看片后勾选）</span>
            <div className="wfe-checks">
              {QUALITY_QUESTIONS.map((q) => {
                const checks = (p.checks as Record<string, boolean> | undefined) ?? {}
                return (
                  <label key={q} className="wfe-check">
                    <input type="checkbox" checked={!!checks[q]} onChange={() => onParams({ checks: { ...checks, [q]: !checks[q] } })} />
                    <span>{q}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <label className="wfe-field"><span>问题与修改意图</span>
            <textarea rows={6} value={String(p.issues ?? '')} onChange={(e) => onParams({ issues: e.target.value })} placeholder="对着真实预览记录：哪里不对、想怎么改" />
          </label>
        </>
      )}

      {node.data.defType === 'finishing' && (
        <label className="wfe-field"><span>Finishing 记录</span>
          <textarea rows={8} value={String(p.notes ?? '')} onChange={(e) => onParams({ notes: e.target.value })} placeholder="观众优先的收束：节奏、音画关系、细节、QC 观察" />
        </label>
      )}
      </div>
      <InspOutput output={props.output} emptyText="尚无运行产物。在上方参数区点「只运行此节点」，或用顶部「运行」跑完整条工作流。" />
      <TechDetails node={node} />
    </div>
  )
}

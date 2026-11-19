/**
 * 工作流编辑器（v5 重构）
 *
 * 骨架沿用第一期（命令条/左构建栏/画布/Inspector/执行抽屉，React Flow 仅作引擎），
 * 内容模型换成 workflow-v0.1.1：Prompt-first 自由节点图（无 Gate）、Structured
 * 阶段泳道 + 产物节点 + Gate 检查点。Gate 的确认只能由用户在检查器里对
 * 具体产物版本做出；演示运行永不代确认。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { CheckCircle, ChevronLeft, Circle, Dataflow04, DotsGrid, File01, Folder, Grid01, Clock, Maximize01, Minus, Save01, Menu01, SlashCircle01, ReverseLeft, ReverseRight } from '@untitledui/icons'
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MarkerType, useReactFlow, useNodesInitialized, type Edge, type Connection, type OnConnectStartParams } from '@xyflow/react'
import { type FmNodeData, type FmNode, NODE_COPY, pfSummary, RUN_STATUS_TXT } from '@/features/workflow/model/editorNodes'
import { NodeMark, nodeTypes, ConnectMenuView } from '@/features/workflow/components/WorkflowNodes'
import { Inspector } from '@/features/workflow/components/WorkflowInspector'
import '@xyflow/react/dist/style.css'
import '@/features/workflow/styles/skill-presets.css'
import { ARTIFACT_KINDS, GATE_DEFS, PF_NODE_DEFS, STRUCTURED_STAGES, WF_PORT_COLORS, defForNode, pfDefaultParams, type WfEdgeInstance, type WfNodeDef, type WfPortType, type WorkflowLegacyDrafts } from '@/features/workflow/model/workflowTemplates'

import { REFERENCE_SEGMENTS, REFERENCE_VIDEOS } from '@/features/reference/model/referenceLibrary'
import { workflowService, startDemoRun, startSingleNodeRun, resumeProjectRun, retryFailedProjectRun, deliverProjectRun, evaluateGate, type GateEval, type WorkflowDef, type WorkflowRun, type WfArtifact } from '@/features/workflow/services/workflowService'
import type { TaskEvent } from '@/api/studioApi'
import { WorkflowProjectPicker } from '@/features/workflow/components/WorkflowProjectPicker'
import { WorkflowDraftsPanel } from '@/features/workflow/components/WorkflowDraftsPanel'
import { hasLegacyDrafts } from '@/features/workflow/services/workflowMigration'
import { formatApplyPresetSummary } from '@/features/workflow/services/workflowPresetBinding'
import { studioHttpApi } from '@/api'
import { workflowGraphProblems, workflowArtifactMedia, workflowLayoutPositions, upgradeLegacyStructuredLayout } from '@/features/workflow/services/workflowGraph'
import { useNavigationGuard, useUnsavedEditor } from '@/shared/navigation/navigationGuardContext'
import { documentsStatus, flushLocalDocuments } from '@/shared/local-documents/localDocuments'
import { runMatchesDefinition, workflowRunLabel } from '@/features/workflow/services/workflowPresentation'

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
  const navigation = useNavigationGuard()
  const initial = useMemo(() => workflowService.getWorkflow(workflowId), [workflowId])
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [nodes, setNodes] = useState<FmNode[]>(() => mapNodes(initial))
  const [edges, setEdges] = useState<Edge[]>(() =>
    (initial?.edges ?? []).map((e) => toRfEdge(e, initial?.nodes ?? [])),
  )
  const [dirty, setDirty] = useState(false)
  const [runNotice, setRunNotice] = useState('')
  const [leftTab, setLeftTab] = useState<'outline' | 'stages' | 'nodes' | 'pending'>(initial?.path === 'structured' ? 'stages' : 'outline')
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 760)
  const [activeStage, setActiveStage] = useState<number | null>(initial?.path === 'structured' ? 0 : null)
  const [zoom, setZoom] = useState(1)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<'events' | 'outputs' | 'artifacts' | 'history'>('events')
  const [nodeQuery, setNodeQuery] = useState('')
  const [inspectorTab, setInspectorTab] = useState<'params' | 'inputs' | 'outputs'>('params')
  const [historyVersion, setHistoryVersion] = useState(0)
  const [running, setRunning] = useState(false)
  const [liveEvents, setLiveEvents] = useState<TaskEvent[]>([])
  const [lastRun, setLastRun] = useState<WorkflowRun | null>(() => workflowService.listRuns(workflowId)[0] ?? null)
  const [activeRunLabel, setActiveRunLabel] = useState('')
  const [viewing, setViewing] = useState<WfArtifact | null>(null)
  const [compact, setCompact] = useState(false)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [legacyDrafts, setLegacyDrafts] = useState<WorkflowLegacyDrafts | undefined>(() => initial?.legacyDrafts)
  const [integrityWarn, setIntegrityWarn] = useState<string | null>(null)
  const [, setPendingTick] = useState(0)
  const runHandle = useRef<{ cancel: () => void } | null>(null)
  const flow = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const initialFramed = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const focusRequest = useRef<string | null>(null)

  function mapNodes(wf: WorkflowDef | null): FmNode[] {
    if (!wf) return []
    return (wf.path === 'structured' ? upgradeLegacyStructuredLayout(wf.nodes) : wf.nodes).map((n) => ({
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
  const selectionId = selectedNode?.id
  useEffect(() => {
    setInspectorTab('params')
    if (selectionId && window.innerWidth < 1100) setPanelOpen(false)
  }, [selectionId])
  useEffect(() => {
    if (window.innerWidth < 1100 && panelOpen) return
    if (!selectionId || focusRequest.current !== selectionId) return
    const frame = requestAnimationFrame(() => {
      const node = flow.getInternalNode(selectionId)
      if (!node) return
      focusRequest.current = null
      const zoom = Math.min(1, Math.max(.8, flow.getZoom()))
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      const available = rect.width - (window.innerWidth <= 1180 ? 340 : 0)
      const centerX = node.internals.positionAbsolute.x + (node.measured.width ?? 292) / 2
      const centerY = node.internals.positionAbsolute.y + (node.measured.height ?? 220) / 2
      void flow.setViewport({ x: Math.max(160, available / 2) - centerX * zoom, y: rect.height / 2 - centerY * zoom, zoom }, { duration: 180 })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectionId, panelOpen, flow])

  const fxIntents = readJson<FxIntent[]>(FX_OUTBOX_KEY, [])
  const refIds = readJson<string[]>(REF_OUTBOX_KEY, [])
  const refConsumed = readJson<Record<string, string>>(REF_CONSUMED_KEY, {})

  const snapshot = useCallback((): WorkflowDef | null => {
    if (!workflow) return null
    return {
      ...workflow,
      name,
      legacyDrafts,
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
  }, [workflow, name, nodes, edges, legacyDrafts])

  const undoStack = useRef<WorkflowDef[]>([])
  const redoStack = useRef<WorkflowDef[]>([])
  const lastHistoryKey = useRef('')
  const markDirty = useCallback(() => {
    const previous = snapshot()
    if (previous) {
      const key = JSON.stringify([previous.name, previous.nodes, previous.edges])
      if (key !== lastHistoryKey.current) {
        undoStack.current.push(structuredClone(previous))
        if (undoStack.current.length > 60) undoStack.current.shift()
        lastHistoryKey.current = key
        redoStack.current = []
        setHistoryVersion((v) => v + 1)
      }
    }
    setDirty(true)
  }, [snapshot])
  const restoreSnapshot = useCallback((value: WorkflowDef) => {
    setWorkflow((prev) => prev ? { ...prev, projectId: value.projectId } : prev)
    setName(value.name)
    setNodes(mapNodes(value))
    setEdges(value.edges.map((edge) => toRfEdge(edge, value.nodes)))
    lastHistoryKey.current = ''
    setDirty(true)
    setHistoryVersion((v) => v + 1)
  }, [])
  const undo = useCallback(() => {
    const previous = undoStack.current.pop()
    const current = snapshot()
    if (!previous || !current) return
    redoStack.current.push(structuredClone(current))
    restoreSnapshot(previous)
  }, [snapshot, restoreSnapshot])
  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    const current = snapshot()
    if (!next || !current) return
    undoStack.current.push(structuredClone(current))
    restoreSnapshot(next)
  }, [snapshot, restoreSnapshot])
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo(); else undo()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [undo, redo])
  void historyVersion

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
              style: { ...n.style, height: collapsed ? 44 : 300 },
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
    if (!nodesInitialized || initialFramed.current) return
    initialFramed.current = true
    const shown = flow.getNodes().filter((n) => n.type !== 'lane' && (!initial || initial.path !== 'structured' || n.parentId === 'lane-0'))
    void flow.fitView({ nodes: shown.map((n) => ({ id: n.id })), padding: 0.22, minZoom: 0.2, maxZoom: 1 })
  }, [nodesInitialized, flow, initial])

  useEffect(() => {
    if (!nodesInitialized || !wrapRef.current) return
    let frame = 0
    let viewport = `${window.innerWidth}:${window.innerHeight}`
    const observer = new ResizeObserver(() => {
      const next = `${window.innerWidth}:${window.innerHeight}`
      if (next === viewport) return
      viewport = next
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        void flow.fitView({ nodes: flow.getNodes().filter((n) => n.type !== 'lane').map((n) => ({ id: n.id })), padding: 0.16, minZoom: 0.2, maxZoom: 1 })
      })
    })
    observer.observe(wrapRef.current)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [nodesInitialized, flow])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const adapt = () => { if (query.matches) setPanelOpen(false) }
    query.addEventListener('change', adapt)
    return () => query.removeEventListener('change', adapt)
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
      const reaches = (id: string, seen = new Set<string>()): boolean => {
        if (id === c.source) return true
        if (seen.has(id)) return false
        seen.add(id)
        return edges.some((edge) => edge.source === id && reaches(edge.target, seen))
      }
      if (reaches(c.target)) return false
      const out = defForNode({ type: s.data.defType, params: s.data.params })?.outputs.find((p) => p.id === c.sourceHandle)
      const inp = defForNode({ type: t.data.defType, params: t.data.params })?.inputs.find((p) => p.id === c.targetHandle)
      return !!out && !!inp && out.type === inp.type
    },
    [nodes, edges],
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
      const jitter = (nodes.length % 5) * 16
      const placement = { x: center.x - 146 + jitter, y: center.y - 70 + jitter }
      if (!at) {
        const roots = nodes.filter((n) => !n.parentId && n.type !== 'lane')
        for (let attempt = 0; attempt <= roots.length; attempt++) {
          if (!roots.some((n) => placement.x < n.position.x + (n.measured?.width ?? 292) + 30 && placement.x + 322 > n.position.x && placement.y < n.position.y + (n.measured?.height ?? 260) + 30 && placement.y + 290 > n.position.y)) break
          placement.x += 370
        }
      }
      const node: FmNode = {
        id,
        type: 'fm',
        position: at ?? placement,
        data: { defType, params, status: 'idle' },
        selected: true,
      } as FmNode
      if (!at) focusRequest.current = id
      setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), node])
      if (workflow?.path === 'structured') setActiveStage(null)
      markDirty()
      return id
    },
    [flow, nodes, markDirty, workflow?.path],
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
    if(documentsStatus().error){setRunNotice('本机记录尚有保存冲突，请先导出副本并重新核对。');return false}
    const snap = snapshot()
    if (!snap) return false
    try {
      const saved = workflowService.saveWorkflow(snap.id, {
        name: snap.name,
        projectId: snap.projectId,
        nodes: snap.nodes,
        edges: snap.edges,
        legacyDrafts: legacyDrafts ?? null,
      })
      if (!saved) { setRunNotice('工作流已不存在，无法保存。请返回工作流首页核对。'); return false }
      setWorkflow(saved)
      setLegacyDrafts(saved.legacyDrafts)
      setDirty(false)
      setRunNotice('')
      return true
    } catch (error) { setRunNotice(error instanceof Error ? error.message : '保存失败，请重试。'); return false }
  }, [snapshot, legacyDrafts])

  useEffect(() => {
    const pid = workflow?.projectId
    if (!pid) { setIntegrityWarn(null); return }
    let alive = true
    void studioHttpApi().workflowContext.state(pid)
      .then((st) => {
        if (!alive) return
        if (st.originalIntegrity === 'suspect') {
          setIntegrityWarn(st.originalIntegrityReasons?.length ? st.originalIntegrityReasons.join('；') : '检测到 prompt.original.md 疑似存在重复段落或模板标题混入（只报告不自动修改）。')
        } else {
          setIntegrityWarn(null)
        }
      })
      .catch(() => { if (alive) setIntegrityWarn(null) })
    return () => { alive = false }
  }, [workflow?.projectId])

  const clearLegacyDraftKey = useCallback((key: keyof WorkflowLegacyDrafts) => {
    setLegacyDrafts((prev) => {
      if (!prev) return undefined
      const next: WorkflowLegacyDrafts = { ...prev }
      delete next[key]
      const normalized = next.lookdev?.trim() || next.filmplan?.trim() ? next : undefined
      if (!dirty && workflow) {
        const snap = snapshot()
        if (snap) {
          try {
            const saved = workflowService.saveWorkflow(snap.id, {
              name: snap.name,
              projectId: snap.projectId,
              nodes: snap.nodes,
              edges: snap.edges,
              legacyDrafts: normalized ?? null,
            })
            if (saved) setWorkflow(saved)
          } catch { /* ignore */ }
        }
      } else {
        markDirty()
      }
      return normalized
    })
  }, [dirty, workflow, snapshot, markDirty])

  useUnsavedEditor({ name, dirty, canSave: !running, save:async()=>{if(!doSave())return false;try{await flushLocalDocuments();return true}catch(error){setDirty(true);throw error}} })

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (dirty && !running) doSave()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [doSave, dirty, running])

  const doRun = useCallback(() => {
    const snap = snapshot()
    if (!snap || running) return
    if (dirty) { setRunNotice('请先保存工作流，再运行当前版本。'); return }
    const problems = workflowGraphProblems(snap.nodes, snap.edges, { validateInputs: snap.path !== 'structured' })
    if (problems.length) {
      setRunNotice(problems[0].message)
      if (problems[0].nodeId) setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === problems[0].nodeId })))
      return
    }
    setRunNotice('')
    setRunning(true)
    setActiveRunLabel(`${snap.path === 'structured' ? '状态评估' : snap.projectId ? '项目运行' : '演示运行'} · 工作流 v${snap.revision}`)
    setLiveEvents([])
    setViewing(null)
    setDrawerOpen(true)
    setDrawerTab('events')
    setNodes((prev) => prev.map((n) => (n.type === 'fm' ? { ...n, data: { ...n.data, status: 'pending' as const } } : n)))
    const handle = startDemoRun(snap, {
      onEvent: (e) => setLiveEvents((prev) => [...prev, e]),
      onNodeStatus: (nodeId, status) =>
        setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n))),
      /* 工作流自带所属项目：编辑器里跑的时候也要真实建立创作上下文，
         否则「在工作流里创作」与「在工作台里创作」会是两种行为。
         prompt 必须一起带上 ——「创作需求」节点的文本就是用户的原始需求，
         只传 projectId 会让后端收到空需求，运行直接被拒。 */
      projectId: snap.projectId ?? undefined,
      prompt: String(snap.nodes.find((n) => n.type === 'prompt')?.params.text ?? '') || undefined,
    })
    runHandle.current = handle
    void handle.done.then((run) => {
      setLastRun(run)
      setRunning(false)
      runHandle.current = null
      if (run.status === 'completed') setDrawerTab('artifacts')
    })
  }, [snapshot, running, dirty])

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
      if (dirty) { setRunNotice('请先保存工作流，再运行当前版本。'); return }
      setRunNotice('')
      setRunning(true)
      setActiveRunLabel(`${snap.path === 'structured' ? '状态评估' : '单节点演示'} · 工作流 v${snap.revision}`)
      setLiveEvents([])
      setDrawerOpen(true)
      setDrawerTab('events')
      setViewing(null)
      setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: 'idle' as const } })))
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
    [snapshot, running, dirty],
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

  const [downloading, setDownloading] = useState(false)
  const downloadArtifact = async (a: WfArtifact) => {
    if (downloading) return
    setDownloading(true)
    try {
      const media = workflowArtifactMedia(a)
      if (!a.demo && !media) throw new Error('产物没有可读取的文件地址。')
      let blob: Blob
      if (media) {
        const response = await fetch(media)
        if (!response.ok) throw new Error(`文件读取失败（HTTP ${response.status}）`)
        blob = await response.blob()
        if (!blob.size || !blob.type.startsWith('video/')) throw new Error('文件为空或不是有效视频。')
      } else blob = new Blob([a.content], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = a.demo ? (a.filename.endsWith('.json') ? a.filename : `${a.filename}.json`) : a.filename
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 30000)
      setRunNotice(media ? '已获取产物，已发起下载。' : '已发起记录下载。')
    } catch (error) { setRunNotice(error instanceof Error ? error.message : '下载失败，请重试。') }
    finally { setDownloading(false) }
  }

  const goReview = () => {
    if (workflow?.projectId) window.postMessage({ type: 'fm-nav', id: 'production', projectId: workflow.projectId }, '*')
  }
  const resumeSavedRun = (retry=false) => {
    if(!lastRun || running || dirty)return
    setRunning(true);setActiveRunLabel(`继续项目运行 · 工作流 v${lastRun.revision}`);setLiveEvents([]);setDrawerOpen(true)
    const handle=(retry?retryFailedProjectRun:resumeProjectRun)(lastRun,{onEvent:e=>setLiveEvents(prev=>[...prev,e]),onNodeStatus:(id,status)=>setNodes(prev=>prev.map(n=>n.id===id?{...n,data:{...n.data,status}}:n))})
    runHandle.current=handle
    void handle.done.then(run=>{setLastRun(run);setRunning(false);runHandle.current=null;setDrawerTab('artifacts')})
  }

  /* 审片通过后从这里交付：读当前保存的审片结论，不重新渲染。 */
  const deliverSavedRun = () => {
    if(!lastRun || running || dirty)return
    let handle:ReturnType<typeof deliverProjectRun>
    try{
      handle=deliverProjectRun(lastRun,workflowService.getWorkflow(lastRun.workflowId),{onEvent:e=>setLiveEvents(prev=>[...prev,e]),onNodeStatus:(id,status)=>setNodes(prev=>prev.map(n=>n.id===id?{...n,data:{...n.data,status}}:n))})
    }catch(error){setRunNotice(error instanceof Error?error.message:'无法继续交付');return}
    setRunNotice('');setRunning(true);setActiveRunLabel(`按最新审片继续交付 · 工作流 v${lastRun.revision}`);setLiveEvents([]);setDrawerOpen(true)
    runHandle.current=handle
    void handle.done.then(run=>{setLastRun(run);setRunning(false);runHandle.current=null;setDrawerTab('events')})
  }
  const awaitingDelivery = lastRun?.status === 'awaiting_info' && Object.values(lastRun.nodeIO ?? {}).some((io) => io.outputs?.status === 'awaiting_review')

  const runMatches = runMatchesDefinition(lastRun, workflow, dirty)

  const latestRenderInfo = useMemo(() => {
    if (!lastRun || !runMatches) return null
    const renderArt = lastRun.artifacts.find((a) => a.kind === 'render' && !a.demo)
    if (renderArt) {
      try {
        const parsed = JSON.parse(renderArt.content) as { version?: number; artifactPath?: string; runId?: string }
        return {
          version: parsed.version ?? null,
          artifactPath: parsed.artifactPath ?? null,
          runId: parsed.runId ?? lastRun.id,
        }
      } catch {
        return { version: null, artifactPath: null, runId: lastRun.id }
      }
    }
    const createNode = nodes.find((n) => n.data.defType === 'create')
    if (createNode && lastRun.nodeStatus[createNode.id] === 'completed') {
      return { version: null, artifactPath: null, runId: lastRun.id }
    }
    return null
  }, [lastRun, runMatches, nodes])

  const { displayedNodes, visibleEdges } = useMemo(() => {
    const structured = workflow?.path === 'structured'
    const lane = activeStage === null ? undefined : nodes.find((n) => n.type === 'lane' && Number(n.data.params.stage) === activeStage)
    const gate = activeStage === null ? undefined : Object.entries(GATE_DEFS).find(([, value]) => value.afterStage === activeStage)?.[0]
    const shown = structured && activeStage !== null ? nodes.filter((n) => n.id === lane?.id || n.parentId === lane?.id || (n.data.defType === 'gate' && n.data.params.gate === gate)) : nodes
    const ids = new Set(shown.filter((n) => !n.hidden).map((n) => n.id))
    const baseEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    const reviewNode = !structured ? shown.find((n) => n.data.defType === 'review' && ids.has(n.id)) : undefined
    const createNode = !structured ? shown.find((n) => n.data.defType === 'create' && ids.has(n.id)) : undefined
    if (reviewNode && createNode) {
      const checks = (reviewNode.data.params.checks as Record<string, unknown> | undefined) ?? {}
      const reworkActive = checks.rework === true && checks.done !== true
      // 循环不存进 edges（图保持无环）：画布仅绘出虚线「返工」提示箭头
      baseEdges.push({
        id: '__rework-hint__',
        source: reviewNode.id,
        target: createNode.id,
        type: 'smoothstep',
        selectable: false,
        deletable: false,
        focusable: false,
        label: reworkActive ? '返工（下次运行重跑）' : '返工',
        style: {
          strokeDasharray: '6 4',
          stroke: reworkActive ? 'var(--warn)' : 'var(--dim)',
          strokeWidth: reworkActive ? 2 : 1.3,
          opacity: reworkActive ? 0.95 : 0.45,
        },
        labelStyle: { fill: reworkActive ? 'var(--warn)' : 'var(--dim)', fontSize: 10 },
        labelBgStyle: { fill: 'var(--surf)', fillOpacity: 0.9 },
        markerEnd: { type: MarkerType.ArrowClosed, color: reworkActive ? 'var(--warn)' : 'var(--dim)' },
      })
    }
    return { displayedNodes: shown.map((n) => {
      const status = running ? n.data.status : runMatches ? lastRun?.nodeStatus[n.id] ?? 'idle' : 'idle'
      const data = n.data.status === status ? n.data : { ...n.data, status: status as FmNodeData['status'] }
      if (n.data.defType !== 'create') return data === n.data ? n : { ...n, data }
      const renderFile = !running && runMatches ? workflowArtifactMedia(lastRun?.artifacts.find((a) => a.nodeId === n.id && !a.demo)) ?? undefined : undefined
      return { ...n, data: { ...data, renderMode: workflow?.projectId ? 'real' as const : 'demo' as const, renderFile } }
    }), visibleEdges: baseEdges }
  }, [nodes, edges, activeStage, workflow?.path, workflow?.projectId, lastRun, runMatches, running])

  if (!workflow) {
    return (
      <section className="wfe">
        <div className="wfe-cmd">
          <button type="button" className="wfe-iconbtn" onClick={onBack} aria-label="返回工作流首页"><UiIcon icon={SemIcons.back} size="md" /></button>
          <b>工作流不存在或已被删除</b>
        </div>
      </section>
    )
  }

  const isStructured = workflow.path === 'structured'
  const eventsToShow = running || liveEvents.length > 0 ? liveEvents : (lastRun?.events ?? [])
  const artifactsToShow = running ? [] : lastRun?.artifacts ?? []
  const selectedRunCaption = running ? activeRunLabel : lastRun ? `${workflowRunLabel(lastRun)} · 工作流 v${lastRun.revision} · ${RUN_STATUS_TXT[lastRun.status] ?? lastRun.status}` : ''
  const focusStage = (index: number | null) => {
    setActiveStage(index)
    setNodes((prev) => prev.map((n) => ({ ...n, selected: false })))
    window.setTimeout(() => { void flow.fitView({ nodes: flow.getNodes().filter((n) => n.type !== 'lane').map((n) => ({ id: n.id })), padding: 0.16, minZoom: 0.2, maxZoom: 1, duration: 250 }) }, 60)
  }
  const targetForRefs = isStructured
    ? nodes.some((n) => n.data.defType === 'artifact' && String(n.data.params.kind) === 'reference-log')
    : nodes.some((n) => n.data.defType === 'refs')

  return (
    <section className="wfe" aria-label="工作流编辑器" data-structured={workflow.path === 'structured' || undefined} data-stage-focused={isStructured && activeStage !== null || undefined} data-panel-open={panelOpen || undefined} data-inspecting={!!(selectedNode || selectedEdge) || undefined}>
      <div className="wfe-cmd">
        <button type="button" className="wfe-iconbtn" onClick={() => navigation.request(onBack)} aria-label="返回工作流首页">
          <UiIcon icon={SemIcons.back} size="md" />
        </button>
        <div className="wfe-titleblock"><input className="wfe-name" value={name} onChange={(e) => { setName(e.target.value); markDirty() }} aria-label="工作流名称" maxLength={120} /></div>

        <span className="wfe-revision">v{workflow.revision}</span>
        <span className="wfe-savestate">{dirty ? <UiIcon icon={Circle} size="xs" /> : <UiIcon icon={CheckCircle} size="xs" />}{dirty ? '未保存' : documentsStatus().error ? '本机保存失败' : documentsStatus().pending ? '正在保存到本机…' : '已保存'}</span>

        <span className="wfe-spacer" />
        <WorkflowProjectPicker
          projectId={workflow.projectId}
          disabled={running}
          onChange={(projectId) => {
            markDirty()
            setWorkflow((prev) => prev ? { ...prev, projectId } : prev)
            if (projectId && workflow.skillPresetId) {
              const presetLabel = workflow.skillPresetMeta?.name || workflow.presetId
              void studioHttpApi().skillPresets.applyPresetToProject(projectId, workflow.skillPresetId)
                .then((res) => setRunNotice(formatApplyPresetSummary(presetLabel, res)))
                .catch((err) => setRunNotice(`视频类型预设未能落地到项目：${err instanceof Error ? err.message : String(err)}`))
            }
          }}
        />
        <button type="button" className="wfe-btn wfe-history-toggle" onClick={() => { setDrawerOpen(true); setDrawerTab('history') }}><UiIcon icon={Clock} size="sm" /> 运行记录</button>
        {!running && lastRun?.definition && lastRun.projectId && lastRun.status === 'running' && <button type="button" className="wfe-btn" disabled={dirty} onClick={()=>resumeSavedRun()}>接回上次运行</button>}
        {!running && lastRun?.definition && lastRun.projectId && lastRun.status === 'failed' && <button type="button" className="wfe-btn" disabled={dirty} onClick={()=>resumeSavedRun(true)}>重试失败节点</button>}
        {!running && lastRun?.definition && lastRun.projectId && awaitingDelivery && <button type="button" className="wfe-btn" disabled={dirty} title={dirty ? '请先保存工作流' : '读取最新审片结论，审片通过最新渲染时输出成片；不重新渲染'} onClick={deliverSavedRun}>按最新审片继续交付</button>}
        {running && (
          <button type="button" className="wfe-btn" onClick={() => runHandle.current?.cancel()}>
            <UiIcon icon={SlashCircle01} size="sm" /> 取消
          </button>
        )}
        <button type="button" className="wfe-btn" title="保存（Ctrl / ⌘ + S）" onClick={doSave} disabled={!dirty || running}>
          <UiIcon icon={Save01} size="sm" /> 保存
        </button>
        <button type="button" className="wfe-btn is-primary" onClick={doRun} disabled={running}>
          <UiIcon icon={SemIcons.play} size="sm" /> {running ? '运行中…' : isStructured ? '演示评估' : workflow.projectId ? '开始制作' : '演示运行'}
        </button>
      </div>

      <div className="wfe-context-bar">
        <span><UiIcon icon={Dataflow04} size="xs" />{isStructured ? '分阶段评估' : '自由创作'}<i/> {nodes.filter((n) => n.type !== 'lane').length} 个节点 · {edges.length} 条连接</span>
        <span>{isStructured ? '仅评估产物与检查点，不自动制作视频' : workflow.projectId ? '制作节点可真实渲染 · 交付需审片通过最新渲染' : '未关联项目 · 运行仅演示'}</span>
        {!isStructured && (
          <button type="button" className="wfe-context-drafts" onClick={() => setDraftsOpen(true)}>
            <UiIcon icon={File01} size="sm" />
            工作稿
            {hasLegacyDrafts({ legacyDrafts }) && <em className="wfe-context-badge">待迁移</em>}
          </button>
        )}
        {workflow.projectId && <button type="button" onClick={goReview}><UiIcon icon={Folder} size="sm" />进入工作台</button>}
      </div>
      {integrityWarn && <div className="wfe-run-alert is-warn" role="alert"><span>原始需求（prompt.original.md）检测存疑：{integrityWarn}</span><button type="button" aria-label="关闭原文警告" onClick={() => setIntegrityWarn(null)}><UiIcon icon={SemIcons.close} size="sm" /></button></div>}
      {hasLegacyDrafts({ legacyDrafts }) && !isStructured && (
        <div className="wfe-legacy-banner" role="status">
          <span>旧版画布中的工作稿（视觉构想 / 导演处理）已保留到迁移草稿中，尚未写入项目文件。</span>
          <button type="button" className="wfe-btn sm is-primary" onClick={() => setDraftsOpen(true)}>查看并写入工作稿</button>
        </div>
      )}
      {runNotice && <div className="wfe-run-alert" role="alert"><span>{runNotice}</span><button type="button" aria-label="关闭运行提示" onClick={() => setRunNotice('')}><UiIcon icon={SemIcons.close} size="sm" /></button></div>}
      <div className="wfe-body">
        <aside className="wfe-left" aria-label="构建栏" hidden={!panelOpen}>
          <div className="wfe-panel-title"><span><UiIcon icon={Dataflow04} size="md" /> 构建工作流</span><button type="button" aria-label="收起侧栏" onClick={() => setPanelOpen(false)}><UiIcon icon={Menu01} size="md" /></button></div>
          <div className="wfe-tabs" role="tablist" aria-label="构建栏页签">
            {!isStructured && <button type="button" role="tab" aria-selected={leftTab === 'outline'} data-on={leftTab === 'outline' ? '' : undefined} onClick={() => setLeftTab('outline')}>流程</button>}
            {isStructured && <button type="button" role="tab" aria-selected={leftTab === 'stages'} data-on={leftTab === 'stages' ? '' : undefined} onClick={() => setLeftTab('stages')}>阶段</button>}
            <button type="button" role="tab" aria-selected={leftTab === 'nodes'} data-on={leftTab === 'nodes' ? '' : undefined} onClick={() => setLeftTab('nodes')}>
              添加节点
            </button>
            <button type="button" role="tab" aria-selected={leftTab === 'pending'} data-on={leftTab === 'pending' ? '' : undefined} onClick={() => setLeftTab('pending')}>
              资源
              {(fxIntents.length + refIds.length) > 0 && <em className="num">{fxIntents.length + refIds.length}</em>}
            </button>
          </div>
          {leftTab === 'outline' ? <div className="wfe-outline">
            <div className="wfe-outline-label">画布节点 <span>{nodes.filter((n) => n.type === 'fm').length}</span></div>
            {nodes.filter((n) => n.type === 'fm').map((n) => <button type="button" className="wfe-outline-item" key={n.id} data-selected={n.selected || undefined} onClick={() => { focusRequest.current = n.id; setNodes((prev) => prev.map((item) => ({ ...item, selected: item.id === n.id }))) }}><NodeMark type={n.data.defType}/><span><b>{NODE_COPY[n.data.defType]?.title ?? defForNode({ type: n.data.defType, params: n.data.params })?.label}</b></span><UiIcon icon={SemIcons.expand} size="xs" /></button>)}
            <button type="button" className="wfe-outline-add" onClick={() => setLeftTab('nodes')}><UiIcon icon={SemIcons.plus} size="sm" /> 添加创作环节</button>
            {/* 只显示用户自己写的说明；没有时不再用一段通用介绍填空。节点用途在「添加节点」页签里有完整说明。 */}
            {workflow.description && <div className="wfe-outline-note"><span>工作流说明</span><p>{workflow.description}</p></div>}
          </div> : leftTab === 'stages' ? (
            <div className="wfe-stage-nav">
              <div className="wfe-outline-label">制作阶段 <span>8</span></div><button type="button" className="wfe-stage-overview" data-on={activeStage === null || undefined} onClick={() => focusStage(null)}><UiIcon icon={Grid01} size="sm" /> 全流程概览</button>
              {STRUCTURED_STAGES.map((stage) => {
                const lane = nodes.find((n) => n.type === 'lane' && Number(n.data.params.stage) === stage.index)
                const children = nodes.filter((n) => n.parentId === lane?.id && n.data.defType === 'artifact')
                const present = children.filter((n) => String(n.data.params.status ?? 'missing') !== 'missing').length
                const gateEntry = Object.entries(GATE_DEFS).find(([, gate]) => gate.afterStage === stage.index)
                const gateNode = gateEntry ? nodes.find((n) => n.data.defType === 'gate' && n.data.params.gate === gateEntry[0]) : undefined
                return <button type="button" key={stage.index} className="wfe-stage-nav-item" data-active={activeStage === stage.index || undefined} onClick={() => focusStage(stage.index)}><span className="wfe-stage-index">{String(stage.index + 1).padStart(2, '0')}</span><span className="wfe-stage-copy"><b>{stage.label}</b><small>{present}/{children.length} 项产物{gateNode ? ` · ${gateNode.data.gateEval?.decision === 'confirmed' && !gateNode.data.gateEval?.stale ? '已确认' : '待确认'}` : ''}</small></span><span aria-hidden="true">↗</span></button>
              })}

            </div>
          ) : leftTab === 'nodes' ? (
            <div className="wfe-nodelist">

              <label className="wfe-library-search"><UiIcon icon={SemIcons.search} size="sm" /><input value={nodeQuery} onChange={(e) => setNodeQuery(e.target.value)} placeholder="搜索节点" aria-label="搜索节点库" /></label>
              {!isStructured && nodeQuery.trim() && !PF_NODE_DEFS.some((d) => `${d.label} ${d.description} ${NODE_COPY[d.type]?.title ?? ''}`.toLowerCase().includes(nodeQuery.trim().toLowerCase())) && <p className="wfe-search-empty">没有匹配节点，试试其他关键词。</p>}
              {!isStructured &&
                PF_NODE_DEFS.filter((d) => `${d.label} ${d.description} ${NODE_COPY[d.type]?.title ?? ''}`.toLowerCase().includes(nodeQuery.trim().toLowerCase())).map((d) => (
                  <button key={d.type} type="button" className="wfe-nodeitem" draggable onDragStart={(e) => { e.dataTransfer.setData('application/fengmotion-node', JSON.stringify({ type: d.type, params: pfDefaultParams(d.type) })); e.dataTransfer.effectAllowed = 'copy' }} onClick={() => addNode(d.type, pfDefaultParams(d.type))} title="拖到画布，或点击添加">
                    <NodeMark type={d.type}/><span className="wfe-nodeitem-copy"><b>{NODE_COPY[d.type]?.title ?? d.label}</b><small>{NODE_COPY[d.type]?.description ?? d.description}</small></span><UiIcon icon={DotsGrid} size="sm" />
                  </button>
                ))}
              {isStructured && (
                <>
                  {STRUCTURED_STAGES.map((s) => (
                    <div key={s.index} className="wfe-stagegroup">
                      <h4>阶段 {s.index} · {s.label}</h4>
                      {ARTIFACT_KINDS.filter((k) => k.stage === s.index && `${k.label} ${k.filename}`.toLowerCase().includes(nodeQuery.trim().toLowerCase())).map((k) => (
                        <button
                          key={k.kind}
                          type="button"
                          className="wfe-nodeitem" draggable
                          onDragStart={(e) => { e.dataTransfer.setData('application/fengmotion-node', JSON.stringify({ type: 'artifact', params: { kind: k.kind, status: 'missing', version: '', summary: '', fixture: false } })); e.dataTransfer.effectAllowed = 'copy' }}
                          onClick={() => addNode('artifact', { kind: k.kind, status: 'missing', version: '', summary: '', fixture: false })}
                          title="拖到画布，或点击添加为自由节点"
                        >
                          <span className="wfe-nodeitem-top"><b>{k.label}</b><UiIcon icon={SemIcons.plus} size="xs" /></span>
                          <span>{k.filename}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                  <h4 className="wfe-stagegroup-title">检查点</h4>
                  {Object.entries(GATE_DEFS).filter(([, def]) => `${def.label} ${def.question}`.toLowerCase().includes(nodeQuery.trim().toLowerCase())).map(([g, def]) => (
                    <button
                      key={g}
                      type="button"
                      className="wfe-nodeitem" draggable
                      onDragStart={(e) => { e.dataTransfer.setData('application/fengmotion-node', JSON.stringify({ type: 'gate', params: { gate: g, decision: 'not-started', recommendation: '', validFor: [], notApproved: [], source: 'live' } })); e.dataTransfer.effectAllowed = 'copy' }}
                      onClick={() => addNode('gate', { gate: g, decision: 'not-started', recommendation: '', validFor: [], notApproved: [], source: 'live' })}
                      title="点击添加到画布"
                    >
                      <span className="wfe-nodeitem-top"><b>{def.label}</b><UiIcon icon={SemIcons.plus} size="xs" /></span>
                      <span>{def.question}</span>
                    </button>
                  ))}
                  <p className="wfe-hint">从这里新增的产物是自由节点；阶段泳道由模板骨架提供。Gate 的确认在检查器里对具体产物版本做出，运行不会代确认。</p>
                </>
              )}

            </div>
          ) : (
            <div className="wfe-pending">
              <div className="wfe-resource-links">{([['knowledge', '特效库'], ['reference', '参考片库']] as const).map(([id, label]) => <button type="button" className="wfe-btn sm" key={id} onClick={() => window.postMessage({ type: 'fm-nav', id }, '*')}><UiIcon icon={Folder} size="sm" />{label}</button>)}</div>
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

        <div className="wfe-canvas" ref={wrapRef} data-compact={compact || undefined}
          onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('application/fengmotion-node')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData('application/fengmotion-node')
            if (!raw) return
            e.preventDefault()
            try {
              const value = JSON.parse(raw) as { type?: string; params?: Record<string, unknown> }
              if (!value.type || !defForNode({ type: value.type, params: value.params ?? {} })) return
              addNode(value.type!, value.params ?? pfDefaultParams(value.type!), flow.screenToFlowPosition({ x: e.clientX - 25, y: e.clientY - 25 }))
              if (window.innerWidth < 1000) setPanelOpen(false)
            } catch { setRunNotice('无法添加该节点，请从节点库重试。') }
          }}>
          <div className="wfe-canvas-toolbar" aria-label="画布工具">
            {!panelOpen && <button type="button" onClick={() => setPanelOpen(true)} title="展开侧栏" aria-label="展开工作流侧栏"><UiIcon icon={Menu01} size="md" /></button>}
            <button type="button" className="wfe-add-trigger" onClick={() => { setPanelOpen(true); setLeftTab('nodes') }}><UiIcon icon={SemIcons.plus} size="sm" /> 添加节点</button>
            <i/>
            <button type="button" onClick={undo} disabled={!undoStack.current.length} title="撤销（Ctrl+Z）" aria-label="撤销"><UiIcon icon={ReverseLeft} size="sm" /></button>
            <button type="button" onClick={redo} disabled={!redoStack.current.length} title="重做（Ctrl+Shift+Z）" aria-label="重做"><UiIcon icon={ReverseRight} size="sm" /></button>
            <i/>
            <button type="button" title="整理画布" onClick={() => {
              markDirty()
              if (isStructured) {
                setNodes((prev) => prev.map((n) => {
                  if (n.type === 'lane') return { ...n, position: { x: 0, y: Number(n.data.params.stage) * 350 }, style: { width: 1240, height: 300 } }
                  if (n.parentId) { const peers = prev.filter((p) => p.parentId === n.parentId); return { ...n, position: { x: 24 + peers.findIndex((p) => p.id === n.id) * 300, y: 64 } } }
                  if (n.data.defType === 'gate') { const stage = GATE_DEFS[String(n.data.params.gate)]?.afterStage ?? 0; return { ...n, position: { x: 944, y: stage * 350 + 64 } } }
                  return n
                }))
              } else {
                setNodes((prev) => {
                  const positions = workflowLayoutPositions(prev.map((n) => ({ id: n.id, height: n.measured?.height })), edges)
                  return prev.map((n) => ({ ...n, position: positions[n.id] }))
                })
              }
              window.setTimeout(() => { void flow.fitView({ padding: 0.16, minZoom: 0.2, maxZoom: 1 }) }, 80)
            }}><UiIcon icon={Grid01} size="sm" /> 整理</button>
          </div>
          {isStructured && activeStage !== null && <div className="wfe-stage-context"><span>阶段 {String(activeStage + 1).padStart(2, '0')} / 08</span><h2>{STRUCTURED_STAGES[activeStage].label}</h2><p>{STRUCTURED_STAGES[activeStage].question}</p><div><button type="button" aria-label="上个阶段" disabled={activeStage === 0} onClick={() => focusStage(activeStage - 1)}><UiIcon icon={ChevronLeft} size="sm" /></button><button type="button" aria-label="下个阶段" disabled={activeStage === 7} onClick={() => focusStage(activeStage + 1)}><UiIcon icon={SemIcons.expand} size="sm" /></button></div></div>}
          <div className="wfe-viewport-controls"><button type="button" onClick={() => { void flow.zoomOut({ duration: 150 }) }} aria-label="缩小"><UiIcon icon={Minus} size="sm" /></button><button type="button" onClick={() => { void flow.zoomTo(1,{duration:150}) }} title="恢复 100%">{Math.round(zoom * 100)}%</button><button type="button" onClick={() => { void flow.zoomIn({ duration: 150 }) }} aria-label="放大"><UiIcon icon={SemIcons.plus} size="sm" /></button><i/><button type="button" onClick={() => { void flow.fitView({ padding: 0.16, minZoom: 0.2, maxZoom: 1, duration: 200 }) }} title="适应画布" aria-label="适应画布"><UiIcon icon={Maximize01} size="sm" /></button></div>
          <div className="wfe-canvas-help">拖动画布平移 <span>·</span> 滚轮缩放 <span>·</span> Delete 删除</div>
          {nodes.length === 0 && <div className="wfe-empty-canvas"><UiIcon icon={Dataflow04} size="xl" /><h2>从第一个节点开始</h2><p>从左侧拖入节点，再连接输入与输出。</p><button type="button" className="wfe-btn" onClick={() => { setPanelOpen(true); setLeftTab('nodes') }}><UiIcon icon={SemIcons.plus} size="sm" />添加节点</button></div>}
          <ReactFlow
            nodes={displayedNodes}
            edges={visibleEdges}
            nodeTypes={nodeTypes}
            onNodeDragStart={() => markDirty()}
            onMove={(_, vp) => { setCompact(vp.zoom < 0.55); setZoom(Math.round(vp.zoom * 100) / 100) }}
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
              if (changes.some((c) => c.type === 'remove')) markDirty()
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
            minZoom={0.2}
            maxZoom={1.6}
            onPaneClick={() => setNodes((prev) => prev.map((n) => ({ ...n, selected: false })))}
            proOptions={{ hideAttribution: true }}
            colorMode="system"
            ariaLabelConfig={{ "node.a11yDescription.default": '拖动节点调整位置，按 Delete 删除。', "edge.a11yDescription.default": '连接节点的输入与输出。' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} bgColor="var(--canvas)" />

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

        <aside className="wfe-inspector" aria-label="检查器" hidden={!selectedNode && !selectedEdge}>
          {selectedNode ? (<>
            <div className="wfe-inspector-toolbar"><span>节点设置</span><div><button type="button" aria-label="关闭检查器" title="关闭检查器" onClick={() => setNodes((prev) => prev.map((n) => ({ ...n, selected: false })))}><UiIcon icon={SemIcons.close} size="md" /></button><button type="button" title="复制节点" aria-label="复制节点" onClick={() => { markDirty(); const id = nid(); setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), { ...selectedNode, id, selected: true, position: { x: selectedNode.position.x + 35, y: selectedNode.position.y + 35 }, data: { ...selectedNode.data, params: structuredClone(selectedNode.data.params), status: 'idle' } }]) }}><UiIcon icon={SemIcons.copy} size="sm" /></button><button type="button" title="删除节点" aria-label="删除节点" onClick={() => { markDirty(); setNodes((prev) => prev.filter((n) => n.id !== selectedNode.id)); setEdges((prev) => prev.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id)) }}><UiIcon icon={SemIcons.trash} size="sm" /></button></div></div>
            <div className="wfe-inspector-tabs" role="tablist" aria-label="节点详情">{([['params', '设置'], ['inputs', '输入'], ['outputs', '输出']] as const).map(([id, label]) => <button type="button" key={id} role="tab" aria-selected={inspectorTab === id} onClick={() => setInspectorTab(id)}>{label}</button>)}</div>
            <Inspector
              tab={inspectorTab}
              node={{ ...selectedNode, data: { ...selectedNode.data, status: running ? selectedNode.data.status : runMatches ? lastRun?.nodeStatus[selectedNode.id] ?? 'idle' : 'idle' } }}
              workflow={snapshot()}
              onParams={(patch) => updateParams(selectedNode.id, patch)}
              inputs={edges
                .filter((e) => e.target === selectedNode.id)
                .map((e) => {
                  const src = nodes.find((n) => n.id === e.source)
                  if (!src) return null
                  const sdef = defForNode({ type: src.data.defType, params: src.data.params })
                  const art = !running && runMatches ? lastRun?.artifacts.find((a) => a.nodeId === src.id) : null
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
              output={!running && runMatches ? lastRun?.artifacts.find((a) => a.nodeId === selectedNode.id) ?? null : null}
              latestRender={latestRenderInfo}
              busy={running}
              onRunNode={() => doRunNode(selectedNode.id)}
              onSelectNode={(id) => {
                const target = nodes.find((n) => n.id === id)
                if (isStructured && activeStage !== null && target) {
                  const parent = nodes.find((n) => n.id === target.parentId)
                  const gateStage = target.data.defType === 'gate' ? GATE_DEFS[String(target.data.params.gate)]?.afterStage : undefined
                  if (parent) setActiveStage(Number(parent.data.params.stage)); else if (gateStage !== undefined) setActiveStage(gateStage); else setActiveStage(null)
                }
                setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })))
              }}
            />
          </>) : selectedEdge ? (
            <div className="wfe-insp"><div className="wfe-inspector-toolbar"><span>连线设置</span><button type="button" aria-label="关闭连线检查器" onClick={() => setEdges((prev) => prev.map((e) => ({ ...e, selected: false })))}><UiIcon icon={SemIcons.close} size="md" /></button></div><h3>数据连接</h3><p className="wfe-hint">将上游节点的输出传递到下游输入。</p><button type="button" className="wfe-btn" onClick={() => { markDirty(); setEdges((prev) => prev.filter((e) => e.id !== selectedEdge.id)) }}><UiIcon icon={SemIcons.trash} size="sm" /> 删除连线</button></div>
          ) : null}
        </aside>
      </div>

      <div className="wfe-drawer" data-open={drawerOpen || undefined}>
        <button type="button" className="wfe-drawer-head" onClick={() => setDrawerOpen((v) => !v)} aria-expanded={drawerOpen}>
          <UiIcon icon={SemIcons.collapse} size="sm" className={drawerOpen ? 'wfe-chev is-open' : 'wfe-chev'} />
          {isStructured ? '评估日志' : '执行日志'}
          {selectedRunCaption && <span className="wfe-drawer-meta" title={selectedRunCaption}>{selectedRunCaption}{running ? ' · 进行中' : ` · ${lastRun?.artifacts.length ?? 0} 项产物`}</span>}
        </button>
        {drawerOpen && (
          <div className="wfe-drawer-body">
            {selectedRunCaption && <p className="wfe-run-identity">{selectedRunCaption}
              {!running && lastRun && <time dateTime={lastRun.startedAt}> · {new Date(lastRun.startedAt).toLocaleString('zh-CN')}</time>}
              {!running && lastRun && !runMatches && <span> · {dirty ? '画布有未保存的更改' : lastRun.projectId === undefined ? '旧记录未保存项目身份' : '与当前版本或项目不同'}，结果仅供历史查看。</span>}
            </p>}
            {!running && lastRun?.nodeIO && <details className="wfe-node-io"><summary>实际节点输入与输出</summary><pre>{JSON.stringify(lastRun.nodeIO,null,2)}</pre></details>}
            <div className="wfe-tabs sm" role="tablist" aria-label="日志视图">
              {([['events', '事件'], ['outputs', '节点状态'], ['artifacts', '产物'], ['history', '运行记录']] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={drawerTab === id} data-on={drawerTab === id ? '' : undefined} onClick={() => setDrawerTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            {drawerTab === 'history' && <div className="wfe-runhistory">{workflowService.listRuns(workflowId).length === 0 ? <p className="wfe-hint">尚无运行记录。</p> : workflowService.listRuns(workflowId).map((run) => <button type="button" key={run.id} disabled={running} data-selected={lastRun?.id === run.id || undefined} onClick={() => { setLastRun(run); setLiveEvents([]); setViewing(null); setDrawerTab('events') }}><b>{new Date(run.startedAt).toLocaleString('zh-CN')}</b><span>{workflowRunLabel(run)} · 工作流 v{run.revision} · {RUN_STATUS_TXT[run.status] ?? run.status} · {run.artifacts.length} 项产物</span></button>)}</div>}
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
                {(running ? nodes.filter((n) => n.type === 'fm').map((n) => [n.id, n.data.status] as const) : Object.entries(lastRun?.nodeStatus ?? {})).map(([id, st], index) => {
                  const n = nodes.find((n) => n.id === id)
                  const label = !running ? lastRun?.nodeLabels?.[id] ?? `历史节点 ${index + 1}` : n ? defForNode({ type: n.data.defType, params: n.data.params })?.label : `节点 ${index + 1}`
                  return (
                    <li key={id}>
                      {label}：
                      {RUN_STATUS_TXT[st] ?? '未运行'}
                    </li>
                  )
                })}
                {!running && !lastRun && <li className="wfe-hint">尚未选择运行记录。</li>}
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
                    {workflowArtifactMedia(viewing) && <video className="wfe-artifact-video" src={workflowArtifactMedia(viewing)!} controls preload="metadata" aria-label="真实渲染产物预览"/>}<pre>{viewing.content}</pre>
                  </div>
                ) : (
                  <>
                    {artifactsToShow.length === 0 && <p className="wfe-hint">暂无产物。{isStructured ? '评估' : '运行'}完成后，产物会出现在这里。</p>}
                    {artifactsToShow.map((a) => (
                      <div key={a.id} className="wfe-artifact">
                        <div className="wfe-artifact-main">
                          <b>{a.title}</b>
                          {/* 真实产物与界面快照必须能区分：
                              以前所有产物都标「演示」，真渲出来的视频混在里面
                              用户分不清哪个能播。 */}
                          <span data-real={!a.demo || undefined}>
                            {a.demo ? '界面快照 · 无对应文件' : '真实产物'} · {a.summary}
                          </span>
                        </div>
                        <button type="button" className="wfe-btn sm" onClick={() => setViewing(a)}><UiIcon icon={SemIcons.eye} size="xs" /> 查看</button>
                        <button type="button" className="wfe-btn sm" disabled={downloading} onClick={() => { void downloadArtifact(a) }}><UiIcon icon={SemIcons.download} size="xs" /> 下载</button>
                        {(a.kind === 'render' || a.kind === 'create' || a.kind === 'evaluation') && (
                          <button type="button" className="wfe-btn sm" onClick={() => { if (lastRun?.projectId) window.postMessage({ type:'fm-nav', id:'production', projectId:lastRun.projectId }, '*') }} disabled={!lastRun?.projectId} title={!lastRun?.projectId ? '此记录没有可确认的关联项目' : '打开这次运行所属项目'}>查看所属项目</button>
                        )}
                      </div>
                    ))}
                    {artifactsToShow.some((a) => a.kind === 'create') && (
                      <p className="wfe-hint">演示产物仅为请求记录；真实视频会单独标注。「查看所属项目」打开这次运行的项目。</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <WorkflowDraftsPanel
        open={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        projectId={workflow.projectId}
        legacyDrafts={legacyDrafts}
        onClearLegacyDraft={clearLegacyDraftKey}
      />
    </section>
  )
}

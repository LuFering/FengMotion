import type * as React from 'react'
import { useCallback, useState, useRef, useMemo } from 'react'
import type { Connection, Edge, OnConnectStartParams, ReactFlowInstance, Node } from '@xyflow/react'
import { defForNode, WF_PORT_COLORS, ARTIFACT_KINDS, GATE_DEFS, PF_NODE_DEFS, pfDefaultParams, type WfPortType, type WfNodeDef } from '@/features/workflow/model/workflowTemplates'
import { nid } from '@/features/workflow/model/editorStorage'
import type { FmNode } from '@/features/workflow/model/editorNodes'
import type { WorkflowDef } from '@/features/workflow/services/workflowService'

export interface UseGraphEditingArgs {
  edges: Edge[]
  flow: ReactFlowInstance<Node, Edge>
  focusRequest: React.RefObject<string | null>
  markDirty: () => void
  nodes: FmNode[]
  setActiveStage: React.Dispatch<React.SetStateAction<number | null>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  setNodes: React.Dispatch<React.SetStateAction<FmNode[]>>
  workflow: WorkflowDef | null
  wrapRef: React.RefObject<HTMLDivElement | null>
}

/** 工作流画布的图编辑：添加节点、改参数、按端口类型校验连线并防止成环，连线拖到空白处时按端口推荐可接节点。 */
export function useGraphEditing({ edges, flow, focusRequest, markDirty, nodes, setActiveStage, setEdges, setNodes, workflow, wrapRef }: UseGraphEditingArgs) {
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
  return { addNode, updateParams, onConnect, onConnectStart, onConnectEnd, isValidConnection, connectMenu, connectCandidates, pickConnectCandidate, setConnectMenu }
}

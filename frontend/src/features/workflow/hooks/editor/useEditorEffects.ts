import type * as React from 'react'
import { useEffect, useCallback } from 'react'
import { evaluateGate, type GateEval, type WorkflowDef } from '@/features/workflow/services/workflowService'
import { GATE_DEFS } from '@/features/workflow/model/workflowTemplates'
import type { Edge, ReactFlowInstance, Node } from '@xyflow/react'
import type { FmNode } from '@/features/workflow/model/editorNodes'

export interface UseEditorEffectsArgs {
  edges: Edge[]
  flow: ReactFlowInstance<Node, Edge>
  initial: WorkflowDef | null
  initialFramed: React.RefObject<boolean>
  markDirty: () => void
  nodes: FmNode[]
  nodesInitialized: boolean
  setNodes: React.Dispatch<React.SetStateAction<FmNode[]>>
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  snapshot: () => WorkflowDef | null
  wrapRef: React.RefObject<HTMLDivElement | null>
}

/** 工作流编辑器的画布副作用：把门禁评估与泳道摘要注入节点、提供泳道折叠，首次载入与窗口变化时适配视图，窄屏时收起侧栏。 */
export function useEditorEffects({ edges, flow, initial, initialFramed, markDirty, nodes, nodesInitialized, setNodes, setPanelOpen, snapshot, wrapRef }: UseEditorEffectsArgs) {
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
  return {  }
}

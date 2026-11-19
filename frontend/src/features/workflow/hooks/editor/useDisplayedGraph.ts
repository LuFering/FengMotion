import { useMemo } from 'react'
import { GATE_DEFS } from '@/features/workflow/model/workflowTemplates'
import { MarkerType, type Edge } from '@xyflow/react'
import type { FmNodeData, FmNode } from '@/features/workflow/model/editorNodes'
import { workflowArtifactMedia } from '@/features/workflow/services/workflowGraph'
import type { WorkflowRun, WorkflowDef } from '@/features/workflow/services/workflowService'

export interface UseDisplayedGraphArgs {
  activeStage: number | null
  edges: Edge[]
  lastRun: WorkflowRun | null
  nodes: FmNode[]
  runMatches: boolean
  running: boolean
  workflow: WorkflowDef | null
}

/**
 * 工作流画布实际显示的节点与连线：Structured 聚焦某阶段时只显示该阶段，节点状态取正在跑或与当前版本匹配的上次运行，
 * 并补画从看片指回创作的「返工」提示线（不写入图）。
 */
export function useDisplayedGraph({ activeStage, edges, lastRun, nodes, runMatches, running, workflow }: UseDisplayedGraphArgs) {
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
  return { displayedNodes, visibleEdges }
}

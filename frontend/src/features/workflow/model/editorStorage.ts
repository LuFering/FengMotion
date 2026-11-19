import { type Edge } from '@xyflow/react'
import { WF_PORT_COLORS, defForNode, type WfEdgeInstance } from '@/features/workflow/model/workflowTemplates'

export const FX_OUTBOX_KEY = 'fm-fx-usage-outbox-v1'

export const REF_OUTBOX_KEY = 'fm-reference-outbox-v1'

export const REF_CONSUMED_KEY = 'fm-workflow-ref-consumed-v1'

export interface FxIntent {
  techniqueId: string
  techniqueName: string
  projectId: string
  projectName: string
  at: string
  status?: string
  workflowId?: string
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

let seq = 0

export const nid = () => `n-${Date.now().toString(36)}${(seq += 1).toString(36)}`

export function toRfEdge(e: WfEdgeInstance, nodes: Array<{ id: string; type: string; params: Record<string, unknown> }>): Edge {
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

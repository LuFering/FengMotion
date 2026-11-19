import { ARTIFACT_KIND_MAP, GATE_DEFS, type WfNodeInstance } from '@/features/workflow/model/workflowTemplates'
import type { WorkflowDef } from '@/features/workflow/model/workflowTypes'

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

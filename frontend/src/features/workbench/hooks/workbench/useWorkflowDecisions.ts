import { useMemo } from 'react'
import { stageState } from '@/features/workbench/model/stageVisual'
import { workflowService, evaluateGate } from '@/features/workflow/services/workflowService'
import { GATE_DEFS } from '@/features/workflow/model/workflowTemplates'
import { fmtDay } from '@/shared/lib/status'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { WorkflowDef } from '@/features/workflow/model/workflowTypes'

type Decision = { wfId: string; nodeId: string; id: string; title: string; hint: string; detail: string }

export interface UseWorkflowDecisionsArgs {
  projectId: WorkbenchProps['projectId']
  runsTick: number
  workflowsSnapshot: WorkflowDef[]
}

/** 从 Workbench.tsx 的 Workbench 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useWorkflowDecisions({ projectId, runsTick, workflowsSnapshot }: UseWorkflowDecisionsArgs) {
  const decisions = useMemo(() => {
    void runsTick
    if (!projectId) return []
    const out: Decision[] = []
    workflowsSnapshot
      .filter((w) => w.projectId === projectId)
      .forEach((w) => {
        w.nodes.forEach((n) => {
          if (n.type === 'review') {
            const visual = stageState([w], workflowService.listRuns(w.id)).visuals[0]
            if (!visual || visual.stale) return
            const c = (n.params.checks ?? {}) as Record<string, boolean>
            if ((c.done || c.rework) && n.params.reviewedVisualId === visual.id) return
            out.push({
              wfId: w.id, nodeId: n.id, id: `${w.id}:${n.id}`, title: '看片与修改',
              hint: '对着预览给出结论：通过，或指出要改的地方',
              detail: '结论会写进工作流的看片节点，后续制作按它执行。',
            })
          }
          if (n.type === 'gate') {
            if (n.params.rework) return
            const ev = evaluateGate(w, n)
            if (ev.decision !== 'pending') return
            out.push({
              wfId: w.id, nodeId: n.id, id: `${w.id}:${n.id}`, title: ev.label,
              hint: ev.blocked.length ? ev.blocked.join('；') : '等待你确认',
              detail: GATE_DEFS[String(n.params.gate ?? '')]?.question ?? '确认这一层的产物是否成立。',
            })
          }
        })
      })
    return out
  }, [projectId, workflowsSnapshot, runsTick])
  /* 已确认：与待决定同一快照、同一遍历，只是过滤条件反过来——
     看片已通过 + Gate 已确认，按 decidedAt 倒序。返工不算定下来，
     不进这里（它回工作流返工）。 */
  const confirmed = useMemo(() => {
    if (!projectId) return []
    const out: { id: string; title: string; hint: string; decidedAt: string }[] = []
    workflowsSnapshot
      .filter((w) => w.projectId === projectId)
      .forEach((w) => {
        w.nodes.forEach((n) => {
          if (n.type === 'review') {
            const c = (n.params.checks ?? {}) as Record<string, boolean>
            const visual = stageState([w], workflowService.listRuns(w.id)).visuals[0]
            if (!c.done || !visual || n.params.reviewedVisualId !== visual.id) return
            const day = fmtDay(String(n.params.decidedAt ?? ''))
            out.push({ id: `${w.id}:${n.id}`, title: '看片与修改', hint: `已通过${day ? ` · ${day}` : ''}`, decidedAt: String(n.params.decidedAt ?? '') })
          }
          if (n.type === 'gate') {
            if (n.params.decision !== 'confirmed') return
            const ev = evaluateGate(w, n)
            if (ev.stale) return
            const cf = (n.params.confirmedFor ?? {}) as { kind?: string; version?: string }
            const day = fmtDay(String(n.params.decidedAt ?? ''))
            out.push({ id: `${w.id}:${n.id}`, title: ev.label, hint: `已确认${cf.version ? ` · ${cf.version}` : ''}${day ? ` · ${day}` : ''}`, decidedAt: String(n.params.decidedAt ?? '') })
          }
        })
      })
    out.sort((a, b) => (b.decidedAt || '').localeCompare(a.decidedAt || ''))
    return out
  }, [projectId, workflowsSnapshot])
  /* 监看区的问题清单见下面 monitorProblems：工作流返工 + 场景缺素材（带真实场景与时间）。
     返工项目在待决定、已确认两边都不出现，review 同时有 done + rework 时以 done 为准。 */
  /* 当前进度卡跟着「最近更新的那个工作流」走 —— 与上面两份快照同一来源，
     决定写回后快照刷新，卡片里的「看片有没有留下结论」才能跟着变。 */
  const progressWorkflow = useMemo(
    () => workflowsSnapshot.find((w) => w.projectId === projectId) ?? null,
    [projectId, workflowsSnapshot],
  )
  return { progressWorkflow, confirmed, decisions }
}

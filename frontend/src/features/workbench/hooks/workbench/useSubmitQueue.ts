import type * as React from 'react'
import { useState, useEffect } from 'react'
import { readFeedbackQueue, type PendingSubmit } from '@/features/workbench/model/workbenchSession'
import type { AgentTask, TaskRequest, ModificationConstraints, AgentReference } from '@/api/studioApi'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { WorkflowDef } from '@/features/workflow/services/workflowService'

export interface UseSubmitQueueArgs {
  chat: WorkbenchProps['chat']
  currentProjectRef: AgentReference
  defaultTarget: AgentReference
  progressWorkflow: WorkflowDef | null
  projectId: WorkbenchProps['projectId']
  references: AgentReference[]
  scope: 'project' | 'scene' | 'selection'
  scopeFromReferences: (refs: AgentReference[]) => TaskRequest['scope']
  selectedId: string
  setBottomTab: React.Dispatch<React.SetStateAction<'activity' | 'changes' | 'versions'>>
  setComparison: React.Dispatch<React.SetStateAction<[StageVisual, StageVisual] | null>>
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>
  setPreviewLocation: React.Dispatch<React.SetStateAction<{ visualId: string; timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>>
  setSelectedArtifactId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedStageVisual: (visual: StageVisual | null) => void
  stageLead: StageVisual | null
  tasks: WorkbenchProps['tasks']
}

/** 从 Workbench.tsx 的 Workbench 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useSubmitQueue({ chat, currentProjectRef, defaultTarget, progressWorkflow, projectId, references, scope, scopeFromReferences, selectedId, setBottomTab, setComparison, setEditMode, setPreviewLocation, setSelectedArtifactId, setSelectedStageVisual, stageLead, tasks }: UseSubmitQueueArgs) {
  /* 制作中插话的排队规则（演示适配器没有实时干预接口）：
     任务在跑时新发的不并行启动、不假装已干预 —— 先排队，当前任务结束（完成/失败）
     后按序启动；用户点了停止后，排队的先不动，等用户点「现在开始」或新发指令时
     再按序启动。请求在发送那一刻快照（引用与约束），排队期间改引用不影响已排的。 */
  const [pendingSubmits, setPendingSubmits] = useState<PendingSubmit[]>(() => readFeedbackQueue(projectId).items)
  const [holdQueue, setHoldQueue] = useState(() => readFeedbackQueue(projectId).hold)
  useEffect(() => {
    try { sessionStorage.setItem(`fm-feedback-queue:${projectId}`, JSON.stringify({ items: pendingSubmits.slice(-50), hold: holdQueue })) } catch { /* Queue remains available in this mounted workbench. */ }
  }, [projectId, pendingSubmits, holdQueue])
  const isLiveTask = (task: AgentTask | null | undefined) =>
    !!task && (task.status === 'queued' || task.status === 'running' || task.status === 'building')
  const buildRequest = (prompt: string, kind: TaskRequest['kind'], useConstraints: ModificationConstraints): TaskRequest => {
    const fallbackTarget = scope === 'project' ? currentProjectRef : defaultTarget
    const requestRefs = references.some((ref) => ref.role === 'target') ? references : [fallbackTarget, ...references]
    const derivedScope = scopeFromReferences(requestRefs)
    /* 范围里的场景：目标是左栏选中的内容单元时用它自己的 id —— 它来自工作流产物，
       和当前选中的渲染切片（selectedId，占位数据）不是一回事，不能互相顶替。 */
    const target = requestRefs.find((ref) => ref.role === 'target')
    const finalScope = target?.kind === 'project' ? 'project' : target?.kind === 'preview' ? 'selection' : derivedScope
    const sceneIds = finalScope === 'project'
      ? []
      : target?.kind === 'scene' ? [target.sceneId] : [selectedId]
    const finalConstraints: ModificationConstraints = finalScope === 'project'
      ? { ...useConstraints, limitToSelection: false }
      : useConstraints
    return structuredClone({
      projectId,
      workflowId: target?.kind === 'preview' ? target.source.workflowId : progressWorkflow?.id,
      workflowRevision: target?.kind === 'preview' ? (target.source.origin === 'editor' ? undefined : target.source.revision) : progressWorkflow?.revision,
      kind,
      prompt,
      scope: finalScope,
      sceneIds,
      references: requestRefs,
      constraints: finalConstraints,
      attachments: [],
    })
  }
  const startNow = (item: { prompt: string; request: TaskRequest; messageId?: string }) => {
    const id = tasks.start(item.request)
    if (item.messageId) chat.setMessageTaskId(item.messageId, id)
    else chat.addUserMessage(item.prompt, id, projectId)
    setBottomTab('activity')
    return id
  }
  const startQueued = (key: string) => {
    const item = pendingSubmits.find((p) => p.key === key && p.status === 'waiting')
    if (!item || isLiveTask(tasks.active?.task)) return
    setPendingSubmits((old) => old.filter((p) => p.key !== key))
    setHoldQueue(false)
    startNow(item)
  }
  const cancelQueued = (key: string) => {
    setPendingSubmits((old) => old.map((p) => (p.key === key ? { ...p, status: 'cancelled' } : p)))
  }
  const showPreview = (visual: StageVisual) => {
    setComparison(null); setEditMode(false); setSelectedArtifactId(null); setPreviewLocation(null)
    setSelectedStageVisual(visual.id === stageLead?.id ? null : visual)
  }
  return { showPreview, buildRequest, holdQueue, isLiveTask, pendingSubmits, setHoldQueue, setPendingSubmits, startNow, startQueued, cancelQueued }
}

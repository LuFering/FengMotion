import type * as React from 'react'
import { useState, useMemo, useEffect } from 'react'
import type { RailTab } from '@/features/workbench/model/workbenchConsole'
import { TASK_STATUS_LABEL } from '@/shared/lib/status'
import { initLibrary } from '@/features/assets/services/assetApiService'
import { editorRenderVisuals } from '@/features/scene-editor/services/sceneRender'
import { useBoundSession } from '@/features/workbench/hooks/session/useBoundSession'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { ProjectSceneState } from '@/api/taskClient'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { WorkflowDef } from '@/features/workflow/model/workflowTypes'

export interface UseStageRailArgs {
  editorExportTick: number
  projectId: WorkbenchProps['projectId']
  projectTask: ReturnType<typeof useBoundSession>['projectTask']
  remoteCreationBusy: boolean
  setCurrentSceneState: React.Dispatch<React.SetStateAction<ProjectSceneState | null>>
  setEditorPreviews: React.Dispatch<React.SetStateAction<StageVisual[]>>
  setRunsTick: React.Dispatch<React.SetStateAction<number>>
  sourceCreationBusy: boolean
  tasks: WorkbenchProps['tasks']
  workflowRunning: boolean
  workflowsSnapshot: WorkflowDef[]
}

/** 工作台左栏与画面区的基础状态：栏目页签与选中产物、「正在制作」提示、本项目工作流与运行记录重读，进入时读取当前场景与编辑器试片。 */
export function useStageRail({ editorExportTick, projectId, projectTask, remoteCreationBusy, setCurrentSceneState, setEditorPreviews, setRunsTick, sourceCreationBusy, tasks, workflowRunning, workflowsSnapshot }: UseStageRailArgs) {
  // 调试直达：?artifact=artifact-content-contract 直接打开产物只读视图。
  const initialArtifact = new URLSearchParams(window.location.search).get('artifact')
  const [railTab, setRailTab] = useState<RailTab>(initialArtifact ? 'artifacts' : 'overview')
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(initialArtifact)
  /* 「正在制作」：AI 任务此刻在哪个内容上。只认真的还在跑的状态（排队/执行/构建）——
     完成、停止、失败都不算在跑，整块随卡片一起不显示，左栏不常驻「暂无任务」。
     内容名取这次请求的目标引用：内容单元用自己的名字，整片级任务说「整片」，
     目标是渲染切片时说「当前预览画面」（那是这条片这次怎么渲的，不冒充内容）。 */
  const liveTask = useMemo(() => {
    const record = projectTask
    if (!record || !['queued', 'running', 'building'].includes(record.task.status)) return null
    const target = record.request?.references?.find((ref) => ref.role === 'target')
    const label = target?.kind === 'scene' ? target.label
      : !target || target.kind === 'project' ? '整片'
      : '当前预览画面'
    return { label, state: TASK_STATUS_LABEL[record.task.status] ?? record.task.status, taskId: record.task.id }
  }, [projectTask])

  /* 素材种子：工作台进来先把内置素材写进 IndexedDB，
     资料页和别处读的是同一份，不各读一张内存表。 */
  useEffect(() => {
    void initLibrary().catch(() => undefined)
  }, [])
  /* ── 中间区域：这次制作到底做出了什么画面 ──────────────────────
     依据《产品体验与工作流说明》§5 —— 可能是测试帧、局部试片、粗略整片，
     也可能暂时没有画面。一律从本次运行产物里读（stageVisual.ts）。
     这里**不再**拿素材库里的旧成片当预览：那是上一次制作留下的文件，
     不是这次做出来的东西，放中间会让用户以为 AI 已经交片了。 */
  const projectWorkflows = useMemo(
    () => workflowsSnapshot.filter((w) => w.projectId === projectId),
    [workflowsSnapshot, projectId],
  )
  /* 运行记录不是 React 状态：演示执行器把结果写进 localStorage，组件不会自己知道。
     所以这里显式挂一个「重读」钩子 —— 运行开始和结束各调一次。
     只依赖 workflowsSnapshot 的话，跑完画面区还停在「这次制作还没开始跑」。 */
  const rereadRuns = () => setRunsTick((n) => n + 1)
  const stageLive = Boolean(liveTask) || workflowRunning || sourceCreationBusy || remoteCreationBusy
  useEffect(() => { let active = true; void editorRenderVisuals(projectId).then(items => { if (active) setEditorPreviews(items) }).catch(() => undefined); return () => { active = false } }, [projectId, editorExportTick])
  /* 打开工作台就读一次当前场景：让「场景版本 vN」从一开始就可信，
     而不是等到用户第一次提交后才知道改动会基于哪一版。
     读失败就保持 null（界面显示不出结论），不编一个版本号出来。 */
  useEffect(() => {
    let active = true
    void tasks.currentScene(projectId).then((probe) => {
      if (active && probe.scene) setCurrentSceneState(probe.scene)
    })
    return () => { active = false }
  }, [projectId])
  return { setSelectedArtifactId, rereadRuns, projectWorkflows, stageLive, selectedArtifactId, setRailTab, railTab, liveTask }
}

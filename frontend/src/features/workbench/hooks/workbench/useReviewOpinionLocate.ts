import type * as React from 'react'
import type { ReviewOpinion } from '@/features/workbench/services/workbenchReviewService'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import { useStageTimeRange } from '@/features/workbench/components/StageTimeRange'
import { useSceneVersions } from '@/features/workbench/hooks/useSceneVersions'
import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { ProjectSceneState } from '@/api/taskClient'
import type { AgentReference } from '@/api/studioApi'

export interface UseReviewOpinionLocateArgs {
  appendWorkbenchDraftText: (extra: string) => void
  capturedPreview: React.RefObject<{ id: string; image: string } | null>
  clearTimeRange: () => void
  focusFeedback: () => void
  previewMediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>
  previewReady: boolean
  projectId: WorkbenchProps['projectId']
  range: ReturnType<typeof useStageTimeRange>
  sceneVersions: ReturnType<typeof useSceneVersions>
  sessionDraft: ReturnType<typeof useSessionDraft>
  setComparison: React.Dispatch<React.SetStateAction<[StageVisual, StageVisual] | null>>
  setCurrentSceneState: React.Dispatch<React.SetStateAction<ProjectSceneState | null>>
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPendingReviewLocate: React.Dispatch<React.SetStateAction<{ visualId: string; timeSeconds?: number; span?: { start: number; end: number }; bbox?: { x: number; y: number; w: number; h: number }; noticeText: string } | null>>
  setPreviewLocation: React.Dispatch<React.SetStateAction<{ visualId: string; timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>>
  setPreviewTime: React.Dispatch<React.SetStateAction<number>>
  setReferences: React.Dispatch<React.SetStateAction<AgentReference[]>>
  setRegionMode: React.Dispatch<React.SetStateAction<boolean>>
  setRegionRect: React.Dispatch<React.SetStateAction<{ x: number; y: number; w: number; h: number } | null>>
  setSelectedArtifactId: React.Dispatch<React.SetStateAction<string | null>>
  showPreview: (visual: StageVisual) => void
  stage: { visuals: StageVisual[]; hasRun: boolean; lastRunStatus: 'none' | 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_info'; requestOnly: boolean }
  tasks: WorkbenchProps['tasks']
  viewedPreview: StageVisual | null
}

/** 从 Workbench.tsx 的 Workbench 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useReviewOpinionLocate({ appendWorkbenchDraftText, capturedPreview, clearTimeRange, focusFeedback, previewMediaRef, previewReady, projectId, range, sceneVersions, sessionDraft, setComparison, setCurrentSceneState, setEditMode, setNotice, setPendingReviewLocate, setPreviewLocation, setPreviewTime, setReferences, setRegionMode, setRegionRect, setSelectedArtifactId, showPreview, stage, tasks, viewedPreview }: UseReviewOpinionLocateArgs) {
  const continueOpinion = (opinion: ReviewOpinion) => {
    // 1. 若本轮修改产出了新版本，核查新版本画面来源并切换供用户审视最新画面
    let afterVisual: StageVisual | undefined = undefined
    if (opinion.resultVisualId) {
      afterVisual = stage.visuals.find((v) => v.id === opinion.resultVisualId)
    } else if (typeof opinion.resultVersion === 'number') {
      const expectedOrigin = opinion.resultOrigin ?? 'scene'
      afterVisual = stage.visuals.find((v) => v.revision === opinion.resultVersion && v.origin === expectedOrigin)
      if (!afterVisual) {
        const matches = stage.visuals.filter((v) => v.revision === opinion.resultVersion)
        if (matches.length === 1 && matches[0].origin === 'scene') {
          afterVisual = matches[0]
        }
      }
    }

    if (afterVisual && viewedPreview?.id !== afterVisual.id) {
      showPreview(afterVisual)
    }

    // 2. 严格遵循边界：新版本时间轴与画面可能已变动，绝不直接套用旧目标快照或旧选区！
    // 彻底清空所有旧目标（不管是 preview、scene 还是 image 等任何 role === 'target' 的引用）
    setReferences((old) => old.filter((ref) => ref.role !== 'target'))
    clearTimeRange()
    setRegionMode(false)
    setRegionRect(null)
    setPreviewLocation(null)
    capturedPreview.current = null
    // 关键机制：与共享草稿深度绑定并持久化，标记需重新选择目标；刷新或切页后绝不丢失
    sessionDraft.updateDraft({
      targetSnapshot: null,
      continuationScopeMode: 'target_required',
    })

    // 3. 将上一轮要求带回草稿区供参考
    const next = `【基于上一轮意见继续调整】\n上一轮要求：${opinion.request.prompt}\n本轮补充意见：`
    appendWorkbenchDraftText(next)
    if (typeof opinion.resultVersion === 'number' && afterVisual) {
      setNotice(`已为你打开最新版本（v${opinion.resultVersion}）。新版时间轴与画面可能已变动，请在播放器中重新核对或圈定新目标后再提交。`)
    } else {
      setNotice('上一轮未生成新版本画面，已保留在当前画面。请核对修改目标后提出补充意见。')
    }
    focusFeedback()
  }

  const locateReviewOpinion = (opinion: ReviewOpinion) => {
    const target = opinion.request.references?.find((r) => r.role === 'target')
    if (!target) {
      setNotice('该意见未包含可定位的目标位置。')
      return
    }

    const previewTarget = target.kind === 'preview' ? target : null

    // 1. 严格核对基准版本：有 ID 严格按 ID 查，查不到直接提示画面不可用，绝不退回按版本号瞎猜！
    let targetVisual: StageVisual | undefined = undefined
    const knownId = opinion.baseVisualId || previewTarget?.source?.visualId
    if (knownId) {
      targetVisual = stage.visuals.find((v) => v.id === knownId)
      if (!targetVisual) {
        setNotice(`该意见关联的画面（${knownId}）已不可用，无法还原原版画面。未在当前版本展示旧选框。`)
        return
      }
    } else if (typeof opinion.baseVersion === 'number') {
      const expectedOrigin = opinion.baseOrigin ?? 'scene'
      targetVisual = stage.visuals.find((v) => v.revision === opinion.baseVersion && v.origin === expectedOrigin)
      if (!targetVisual) {
        const matches = stage.visuals.filter((v) => v.revision === opinion.baseVersion)
        if (matches.length === 1 && matches[0].origin === 'scene') {
          targetVisual = matches[0]
        }
      }
      if (!targetVisual) {
        setNotice(`该意见关联的基准版本（v${opinion.baseVersion}）已不可用，无法还原原版画面。未在当前版本展示旧选框。`)
        return
      }
    } else {
      setNotice('该意见历史记录未关联有效版本或画面，无法定位。')
      return
    }

    // 2. 准备定位信息
    setComparison(null)
    setEditMode(false)
    setSelectedArtifactId(null)

    const span = (typeof previewTarget?.timeSeconds === 'number' && typeof previewTarget?.endTimeSeconds === 'number')
      ? { start: previewTarget.timeSeconds, end: previewTarget.endTimeSeconds }
      : undefined

    const bbox = previewTarget?.bbox
    const noticeText = `已定位到 v${targetVisual.revision ?? opinion.baseVersion ?? '历史'} 目标位置。`

    // 3. 若已在当前画面且播放器已 ready，直接定位；否则进入待定位状态，并切换至目标画面
    if (viewedPreview?.id === targetVisual.id && previewReady) {
      if (previewMediaRef.current instanceof HTMLVideoElement && typeof previewTarget?.timeSeconds === 'number') {
        const media = previewMediaRef.current
        const targetTime = Number.isFinite(media.duration) ? Math.min(previewTarget.timeSeconds, media.duration) : previewTarget.timeSeconds
        media.currentTime = targetTime
        setPreviewTime(targetTime)
      } else if (typeof previewTarget?.timeSeconds === 'number') {
        setPreviewTime(previewTarget.timeSeconds)
      }
      if (span) range.setSpan(span)
      if (bbox) setPreviewLocation({ visualId: targetVisual.id, timeSeconds: previewTarget?.timeSeconds, bbox })
      setNotice(noticeText)
    } else {
      setPendingReviewLocate({
        visualId: targetVisual.id,
        timeSeconds: previewTarget?.timeSeconds,
        span,
        bbox,
        noticeText,
      })
      if (viewedPreview?.id !== targetVisual.id) {
        showPreview(targetVisual)
      }
    }
  }
  /**
   * 重新读取项目当前场景。
   *
   * <p>为什么提交成功后必须重读：后端在渲染成功时把新场景提交为新版本。
   * 界面若不重读，手里的 version 还是旧的，下一次提交会被 409 打回，
   * 用户会以为「刚改完就不能再改了」。</p>
   *
   * @param reason 触发原因，用于区分展示（成功 / 其它）
   */
  const refreshCurrentScene = async (reason: string) => {
    const probe = await tasks.currentScene(projectId)
    if (!probe.scene) return
    setCurrentSceneState(probe.scene)
    /* 每次场景变化都顺手刷新版本列表：用户改完立刻点开历史，
       就该看到刚产生的这一版。等打开面板才去读会慢一拍，还可能读到旧列表。 */
    void sceneVersions.refresh(true)
    if (reason === 'completed') {
      /* 成功时给一句确认，让用户知道界面上的场景确实已经换成新的了 */
      setNotice(`场景已更新到版本 ${probe.scene.version}`)
    }
  }
  return { refreshCurrentScene, locateReviewOpinion, continueOpinion }
}

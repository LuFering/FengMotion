import type * as React from 'react'
import { useEffect } from 'react'
import { useStageTimeRange } from '@/features/workbench/components/StageTimeRange'
import { useDraftText } from '@/features/workbench/hooks/workbench/useDraftText'
import { useTimelineManifest } from '@/features/workbench/hooks/workbench/useTimelineManifest'
import { useVisualSelection } from '@/features/workbench/hooks/workbench/useVisualSelection'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { AgentReference } from '@/api/studioApi'

export interface UseProblemTrackingArgs {
  capturedPreview: React.RefObject<{ id: string; image: string } | null>
  pendingPlayback: { version: number; start: number } | null
  pendingReviewLocate: { visualId: string; timeSeconds?: number; span?: { start: number; end: number }; bbox?: { x: number; y: number; w: number; h: number }; noticeText: string } | null
  previewMediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>
  previewReady: boolean
  projectId: WorkbenchProps['projectId']
  range: ReturnType<typeof useStageTimeRange>
  rangeVisual: React.RefObject<string | null>
  references: AgentReference[]
  sessionDraft: ReturnType<typeof useDraftText>['sessionDraft']
  setExpandedProblemId: React.Dispatch<React.SetStateAction<string | null>>
  setLoopSpan: React.Dispatch<React.SetStateAction<boolean>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPendingPlayback: React.Dispatch<React.SetStateAction<{ version: number; start: number } | null>>
  setPendingReviewLocate: React.Dispatch<React.SetStateAction<{ visualId: string; timeSeconds?: number; span?: { start: number; end: number }; bbox?: { x: number; y: number; w: number; h: number }; noticeText: string } | null>>
  setPreviewDuration: React.Dispatch<React.SetStateAction<number>>
  setPreviewLocation: React.Dispatch<React.SetStateAction<{ visualId: string; timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>>
  setPreviewReady: React.Dispatch<React.SetStateAction<boolean>>
  setPreviewTime: React.Dispatch<React.SetStateAction<number>>
  setReferences: React.Dispatch<React.SetStateAction<AgentReference[]>>
  setSequenceMovePending: ReturnType<typeof useTimelineManifest>['setSequenceMovePending']
  viewedPreview: ReturnType<typeof useVisualSelection>['viewedPreview']
}

/** 从 Workbench.tsx 的 Workbench 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useProblemTracking({ capturedPreview, pendingPlayback, pendingReviewLocate, previewMediaRef, previewReady, projectId, range, rangeVisual, references, sessionDraft, setExpandedProblemId, setLoopSpan, setNotice, setPendingPlayback, setPendingReviewLocate, setPreviewDuration, setPreviewLocation, setPreviewReady, setPreviewTime, setReferences, setSequenceMovePending, viewedPreview }: UseProblemTrackingArgs) {
  /* 新版本可能在播放器已经 ready 后才进入视图；不依赖 onReady 事件的触发顺序。 */
  useEffect(() => {
    if (!pendingPlayback || !previewReady || viewedPreview?.origin !== 'scene' || viewedPreview.revision !== pendingPlayback.version) return
    const media = previewMediaRef.current
    if (!(media instanceof HTMLVideoElement) || !Number.isFinite(media.duration)) return
    media.currentTime = Math.min(pendingPlayback.start, media.duration)
    setPreviewTime(media.currentTime)
    setPendingPlayback(null)
    setNotice('已定位到新版本的原修改位置，可播放并对比检查。')
  }, [pendingPlayback, previewReady, viewedPreview?.id, viewedPreview?.origin, viewedPreview?.revision])

  /* 审阅意见定位：等待目标版本的播放器真正就绪后再定位时间、选区与高亮框，彻底杜绝切版竞态与旧播放器赋值 */
  useEffect(() => {
    if (!pendingReviewLocate || !previewReady || viewedPreview?.id !== pendingReviewLocate.visualId) return
    const media = previewMediaRef.current
    if (media instanceof HTMLVideoElement && Number.isFinite(media.duration)) {
      if (typeof pendingReviewLocate.timeSeconds === 'number') {
        const targetTime = Math.min(pendingReviewLocate.timeSeconds, media.duration)
        media.currentTime = targetTime
        setPreviewTime(targetTime)
      }
    } else if (typeof pendingReviewLocate.timeSeconds === 'number') {
      setPreviewTime(pendingReviewLocate.timeSeconds)
    }
    if (pendingReviewLocate.span) {
      range.setSpan(pendingReviewLocate.span)
    }
    if (pendingReviewLocate.bbox) {
      setPreviewLocation({ visualId: pendingReviewLocate.visualId, timeSeconds: pendingReviewLocate.timeSeconds, bbox: pendingReviewLocate.bbox })
    }
    setNotice(pendingReviewLocate.noticeText)
    setPendingReviewLocate(null)
  }, [pendingReviewLocate, previewReady, viewedPreview?.id])
  useEffect(() => {
    const identity = viewedPreview ? `${projectId}:${viewedPreview.id}` : null
    if (rangeVisual.current !== identity) {
      rangeVisual.current = identity
      const isTargetPending = pendingReviewLocate && pendingReviewLocate.visualId === viewedPreview?.id
      if (!isTargetPending) {
        range.reset()
        setLoopSpan(false)
        const staleTarget = references.find((ref) => ref.role === 'target' && ref.kind === 'preview' && ref.source.visualId !== viewedPreview?.id)
        if (staleTarget) {
          setReferences((old) => old.filter((ref) => ref.id !== staleTarget.id))
          capturedPreview.current = null
          setPreviewLocation(null)
          sessionDraft.updateDraft({ targetSnapshot: null })
          setNotice('预览版本已变化，之前的画面或时间引用已移除，请重新选择修改目标。')
        }
      }
      setSequenceMovePending(null)
      setPreviewDuration(0)
      setPreviewReady(false)
    }
  }, [projectId, viewedPreview?.id, range.reset, pendingReviewLocate])
  const toggleProblem = (id: string) => setExpandedProblemId((cur) => (cur === id ? null : id))
  return { toggleProblem }
}

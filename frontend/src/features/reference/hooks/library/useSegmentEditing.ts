import type * as React from 'react'
import { updateSegment as apiUpdateSegment, deleteSegment as apiDeleteSegment, type LocalSegment, type ServerVideo } from '@/features/reference/services/referenceApiService'
import { useEffect } from 'react'

export interface UseSegmentEditingArgs {
  current: LocalSegment
  film: ServerVideo
  hasSegment: boolean
  segments: LocalSegment[]
  setEndDraft: React.Dispatch<React.SetStateAction<string>>
  setObservationDraft: React.Dispatch<React.SetStateAction<string>>
  setSegmentId: React.Dispatch<React.SetStateAction<string>>
  setSegments: React.Dispatch<React.SetStateAction<LocalSegment[]>>
  setStartDraft: React.Dispatch<React.SetStateAction<string>>
  setSuggestionDraft: React.Dispatch<React.SetStateAction<string>>
  showToast: (msg: string) => void
}

/** 从 RefLibrary.tsx 的 RefLibrary 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useSegmentEditing({ current, film, hasSegment, segments, setEndDraft, setObservationDraft, setSegmentId, setSegments, setStartDraft, setSuggestionDraft, showToast }: UseSegmentEditingArgs) {
  /**
   * 保存片段的人工改动。
   *
   * 只提交变化的那几项；失败时提示并回读服务端值，避免界面显示一个没存上的结果。
   */
  const saveSegmentEdits = async (patch: {
    observation?: string
    suggestion?: string
    startSec?: number
    endSec?: number
  }) => {
    if (!hasSegment) return
    // 时间没变就别白跑一次请求（blur 会触发，即使没改）。
    const unchanged =
      (patch.observation === undefined || patch.observation === current.observation) &&
      (patch.suggestion === undefined || patch.suggestion === current.suggestion) &&
      (patch.startSec === undefined || Math.abs(patch.startSec - current.start) < 0.05) &&
      (patch.endSec === undefined || Math.abs(patch.endSec - current.end) < 0.05)
    if (unchanged) return
    try {
      const updated = await apiUpdateSegment(current.id, patch)
      setSegments((prev) => prev.map((sg) => (sg.id === updated.id ? updated : sg)))
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败')
      // 回读真实值，别让界面留着一个没保存成功的草稿。
      setObservationDraft(current.observation)
      setSuggestionDraft(current.suggestion)
      setStartDraft(current.start.toFixed(1))
      setEndDraft(current.end.toFixed(1))
    }
  }

  /** 删除片段（不影响视频与素材）。 */
  const removeSegment = async (segmentIdToRemove: string) => {
    if (!window.confirm('删除这个片段？视频本身不受影响。')) return
    try {
      await apiDeleteSegment(segmentIdToRemove)
      const remain = segments.filter((sg) => sg.id !== segmentIdToRemove)
      setSegments(remain)
      const next = remain.find((sg) => sg.videoId === film?.id)
      setSegmentId(next?.id ?? '')
      showToast('已删除片段')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败')
    }
  }

  /* 草稿跟着当前片段走：切换片段或服务端回写后输入框要显示最新真实值，
     否则用户会看到上一条片段的内容。 */
  useEffect(() => {
    setObservationDraft(current.observation)
    setSuggestionDraft(current.suggestion)
    setStartDraft(current.start.toFixed(1))
    setEndDraft(current.end.toFixed(1))
  }, [current.id, current.observation, current.suggestion, current.start, current.end])
  return { removeSegment, saveSegmentEdits }
}

import type * as React from 'react'
import { setFavorite as apiSetFavorite, addSegment as apiAddSegment, type LocalSegment, type ServerVideo } from '@/features/reference/services/referenceApiService'
import { formatTimecode } from '@/features/reference/model/referenceLibrary'
import type { StoredLibrary } from '@/features/reference/model/refLibraryStore'

export interface UseSegmentActionsArgs {
  setSegmentId: React.Dispatch<React.SetStateAction<string>>
  setSegments: React.Dispatch<React.SetStateAction<LocalSegment[]>>
  setStored: React.Dispatch<React.SetStateAction<StoredLibrary>>
  showToast: (msg: string) => void
  stored: StoredLibrary
  videos: ServerVideo[]
}

/** 参考片段的收藏切换，以及在播放位置标记新片段。 */
export function useSegmentActions({ setSegmentId, setSegments, setStored, showToast, stored, videos }: UseSegmentActionsArgs) {
  /**
   * 收藏 / 取消收藏。
   *
   * 先乐观更新让点击即时响应，失败再回滚 —— 收藏只是个人标记，
   * 但「显示已收藏其实没存上」会让人下次找不到。
   */
  const toggleFavorite = (id: string) => {
    const next = !stored.favorites.includes(id)
    setStored((prev) => ({
      ...prev,
      favorites: next ? [id, ...prev.favorites] : prev.favorites.filter((f) => f !== id),
    }))
    void apiSetFavorite(id, next).catch(() => {
      setStored((prev) => ({
        ...prev,
        favorites: next ? prev.favorites.filter((f) => f !== id) : [id, ...prev.favorites],
      }))
      showToast('收藏失败，请稍后重试')
    })
  }

  /**
   * 在当前播放位置标记一个片段。
   *
   * 默认时长 3 秒；超出视频结尾就截到结尾。切完立刻把新片段设为当前选中，
   * 用户不必再去列表里找刚切出来的那一段。
   */
  const cutSegmentAt = async (videoId: string, atSec: number) => {
    const target = videos.find((v) => v.id === videoId)
    const totalSec = target ? target.durationMs / 1000 : 0
    const start = Math.max(0, Math.min(atSec, Math.max(0, totalSec - 0.5)))
    const end = Math.min(totalSec || start + 3, start + 3)
    if (end <= start) {
      showToast('当前位置太靠近结尾，无法切片')
      return
    }
    try {
      const created = await apiAddSegment(videoId, start, end)
      setSegments((prev) => [...prev, created].sort((a, b) => a.index - b.index))
      setSegmentId(created.id)
      showToast(`已标记片段 ${formatTimecode(start)}–${formatTimecode(end)}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '标记片段失败')
    }
  }
  return { toggleFavorite, cutSegmentAt }
}

import { useMemo } from 'react'
import type { LocalSegment, ServerVideo } from '@/features/reference/services/referenceApiService'
import type { Filters, StoredLibrary } from '@/features/reference/model/refLibraryStore'
import type { SortKey, BrowseTab } from '@/features/reference/model/refBrowse'

export interface UseBrowseListArgs {
  collId: string
  filters: Filters
  query: string
  segmentByIdMap: Map<string, LocalSegment>
  segments: LocalSegment[]
  sortKey: SortKey
  stored: StoredLibrary
  tab: BrowseTab
  videoOrder: Map<string, number>
  videos: ServerVideo[]
}

/** 从 RefLibrary.tsx 的 RefLibrary 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useBrowseList({ collId, filters, query, segmentByIdMap, segments, sortKey, stored, tab, videoOrder, videos }: UseBrowseListArgs) {
  const browseList = useMemo(() => {
    // 数据源是服务端片段，不是演示常量。
    let list: LocalSegment[] = segments.slice()
    if (tab === 'favorites') list = list.filter((s) => stored.favorites.includes(s.id))
    if (tab === 'recent') list = stored.recent.map((id) => segmentByIdMap.get(id)).filter((s): s is LocalSegment => !!s)
    if (tab === 'collections') {
      const ids = stored.memberships[collId] ?? []
      list = list.filter((s) => ids.includes(s.id))
    }
    if (filters.status !== 'all') list = list.filter((s) => s.status === filters.status)
    if (filters.cameraMove !== 'all') list = list.filter((s) => s.analysis.cameraMove.value === filters.cameraMove)
    if (filters.transition !== 'all') list = list.filter((s) => s.analysis.transition.value === filters.transition)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((s) => {
        const v = videos.find((x) => x.id === s.videoId)
        const hay = [v?.title ?? '', v?.source ?? '', ...s.tags, ...Object.values(s.analysis).map((a) => a.value)].join(' ').toLowerCase()
        return hay.includes(q)
      })
    }
    const byStatus = (s: LocalSegment) => ({ pending: 0, partial: 1, analyzed: 2 })[s.status]
    if (sortKey === 'source') list.sort((a, b) => (videoOrder.get(a.videoId) ?? 0) - (videoOrder.get(b.videoId) ?? 0) || a.start - b.start)
    if (sortKey === 'timecode') list.sort((a, b) => a.start - b.start)
    if (sortKey === 'status') list.sort((a, b) => byStatus(a) - byStatus(b))
    return list
  }, [tab, collId, filters, query, sortKey, stored, segments, videos])
  return { browseList }
}

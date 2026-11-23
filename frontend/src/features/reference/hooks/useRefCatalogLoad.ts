import type * as React from 'react'
import { useEffect } from 'react'
import { listReferenceVideos, listSegments, loadPreferences, listCollections, type LocalSegment, type ServerVideo } from '@/features/reference/services/referenceApiService'
import type { StoredLibrary } from '@/features/reference/model/refLibraryStore'

export interface UseRefCatalogLoadArgs {
  setCatalogError: React.Dispatch<React.SetStateAction<string | null>>
  setCatalogLoading: React.Dispatch<React.SetStateAction<boolean>>
  setCollId: React.Dispatch<React.SetStateAction<string>>
  /** 集合名单只来自服务端；为空时「参考集合」页签不出现 */
  setCollections: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; note: string; segmentIds: string[] }>>>
  setFilmId: React.Dispatch<React.SetStateAction<string>>
  setSegmentId: React.Dispatch<React.SetStateAction<string>>
  setSegments: React.Dispatch<React.SetStateAction<LocalSegment[]>>
  setStored: React.Dispatch<React.SetStateAction<StoredLibrary>>
  setVideos: React.Dispatch<React.SetStateAction<ServerVideo[]>>
}

/** 进入参考片库时从服务端载入目录数据并设定默认选中项，同时维护加载中与读取失败状态。 */
export function useRefCatalogLoad({ setCatalogError, setCatalogLoading, setCollId, setCollections, setFilmId, setSegmentId, setSegments, setStored, setVideos }: UseRefCatalogLoadArgs) {
  /* 首次加载：视频、片段、偏好、集合全部从服务端读。
     旧版收藏与最近浏览在 localStorage 里，这里不再迁移 —— 参考片片段是
     服务端生成的 ID，旧演示片段的 ID 在新库里不存在，硬迁移只会产生一堆
     「收藏了但查不到」的孤儿记录。 */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [vs, segs, prefs, colls] = await Promise.all([
          listReferenceVideos(),
          listSegments(),
          loadPreferences(),
          listCollections(),
        ])
        if (!alive) return
        setVideos(vs)
        setSegments(segs)
        setCollections(colls)
        setStored({
          favorites: prefs.favorites,
          recent: prefs.recent,
          memberships: Object.fromEntries(colls.map((c) => [c.id, [...c.segmentIds]])),
        })
        // 默认选中第一条视频与它的第一个片段
        const firstVideo = vs[0]
        if (firstVideo) {
          setFilmId(firstVideo.id)
          const firstSeg = segs.find((sg) => sg.videoId === firstVideo.id)
          if (firstSeg) setSegmentId(firstSeg.id)
        }
        if (colls[0]) setCollId(colls[0].id)
        setCatalogError(null)
      } catch (error) {
        if (!alive) return
        setCatalogError(error instanceof Error ? error.message : '读取参考片库失败')
      } finally {
        if (alive) setCatalogLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])
  return {  }
}

import type * as React from 'react'
import { touchRecent, type ServerVideo, type LocalSegment } from '@/features/reference/services/referenceApiService'
import { segmentsOf } from '@/features/reference/model/refBrowse'
import { useEffect } from 'react'
import type { ReferenceSegment } from '@/features/reference/model/referenceLibrary'

export interface UsePlayerNavigationArgs {
  browseOpen: boolean
  collMenuOpen: boolean
  film: ServerVideo
  filmId: string
  filmSegments: ReferenceSegment[]
  hasVideo: boolean
  mediaError: string | null
  playing: boolean
  segmentByIdMap: Map<string, LocalSegment>
  segmentIndex: number
  segments: LocalSegment[]
  setBrowseOpen: React.Dispatch<React.SetStateAction<boolean>>
  setCollMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  setFilmId: React.Dispatch<React.SetStateAction<string>>
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>
  setPos: React.Dispatch<React.SetStateAction<number>>
  setSegmentId: React.Dispatch<React.SetStateAction<string>>
  videoRef: React.RefObject<HTMLVideoElement | null>
  videos: ServerVideo[]
}

/** 参考片库的片段播放与切换：选片、选片段、前后步进、播放暂停同步与键盘操作。 */
export function usePlayerNavigation({ browseOpen, collMenuOpen, film, filmId, filmSegments, hasVideo, mediaError, playing, segmentByIdMap, segmentIndex, segments, setBrowseOpen, setCollMenuOpen, setFilmId, setPlaying, setPos, setSegmentId, videoRef, videos }: UsePlayerNavigationArgs) {
  const selectSegment = (id: string, seek = true) => {
    const seg = segmentByIdMap.get(id)
    if (!seg) return
    const nextFilm = videos.find((v) => v.id === seg.videoId)
    setPlaying(!!nextFilm?.fileUrl)
    if (seek && seg.videoId === filmId && videoRef.current) videoRef.current.currentTime = seg.start + 0.01
    if (seg.videoId !== filmId) setFilmId(seg.videoId)
    setSegmentId(id)
    if (seek) setPos(seg.start + 0.01)
    // 记一次浏览（服务端）；失败不打断用户。
    void touchRecent(id)
  }

  const selectFilm = (id: string) => {
    const first = segmentsOf(segments, id)[0]
    setPlaying(!!videos.find((v) => v.id === id)?.fileUrl)
    setFilmId(id)
    if (first) setSegmentId(first.id)
    setPos(0)
  }

  /* 只有本机真有文件（fileUrl 非空）的参考片才进可播放列表 ——
     没有文件的条目显示「仅静帧」，不假装能播。 */
  const playableFilms = videos.filter((v) => v.fileUrl && v.id !== mediaError)
  const advanceFilm = () => {
    // film 在数据到达前可能不存在（加载中会先返回上面的分支，但这里仍要防御）。
    if (playableFilms.length === 0 || !film) return
    const index = playableFilms.findIndex((v) => v.id === film.id)
    selectFilm(playableFilms[(index + 1) % playableFilms.length].id)
  }

  const stepSegment = (delta: number) => {
    const next = filmSegments[Math.min(filmSegments.length - 1, Math.max(0, segmentIndex + delta))]
    if (next) selectSegment(next.id)
  }

  /* 播放头由真实 video 的 currentTime 驱动；打开片库或离开页面时暂停解码。 */
  useEffect(() => {
    const syncPlayback = () => {
      const el = videoRef.current
      if (!el) return
      if (playing && !browseOpen && !document.hidden && hasVideo) {
        void el.play().catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setPlaying(false) })
      } else el.pause()
    }
    syncPlayback()
    document.addEventListener('visibilitychange', syncPlayback)
    return () => document.removeEventListener('visibilitychange', syncPlayback)
  }, [playing, browseOpen, hasVideo, film?.id])

  /* 键盘：空格播放/暂停、←/→ 切片段、Esc 关覆层（输入框内不劫持）。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, select, textarea')) return
      if (e.key === 'Escape') {
        if (browseOpen) setBrowseOpen(false)
        else if (collMenuOpen) setCollMenuOpen(false)
        return
      }
      if (browseOpen) return
      if (e.key === ' ' && hasVideo) {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowRight') stepSegment(1)
      else if (e.key === 'ArrowLeft') stepSegment(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return { playableFilms, advanceFilm, stepSegment, selectFilm, selectSegment }
}

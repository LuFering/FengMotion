import { useMemo } from 'react'
import { segmentsOf } from '@/features/reference/model/refBrowse'
import type { LocalSegment, ServerVideo } from '@/features/reference/services/referenceApiService'

export interface UseCurrentSegmentArgs {
  filmId: string
  mediaError: string | null
  segmentId: string
  segments: LocalSegment[]
  videos: ServerVideo[]
}

/** 从 RefLibrary.tsx 的 RefLibrary 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useCurrentSegment({ filmId, mediaError, segmentId, segments, videos }: UseCurrentSegmentArgs) {
  /* 当前视频与片段都从服务端数据里解析。
     没有数据时返回 undefined，界面按「空/加载中」处理，不假装有内容。 */
  const film = videos.find((v) => v.id === filmId) ?? videos[0]
  const hasVideo = !!film?.fileUrl && mediaError !== film.id
  const filmSegments = useMemo(() => (film ? segmentsOf(segments, film.id) : []), [segments, film])
  const segmentByIdMap = useMemo(() => new Map(segments.map((sg) => [sg.id, sg])), [segments])
  /** 按 ID 找视频；找不到返回 undefined（片段所属视频可能已被删）。 */
  const filmOf = (videoId: string) => videos.find((v) => v.id === videoId)
  /** 视频在列表里的顺序，用于「按来源」排序。 */
  const videoOrder = useMemo(
    () => new Map(videos.map((v, i) => [v.id, i])),
    [videos],
  )
  const segment = segmentByIdMap.get(segmentId) ?? filmSegments[0]

  /* 有视频但没有片段是**正常状态**（刚导入、还没标记）。
     这里给出一组安全的默认值，让播放器与分析面板都能渲染，
     而不是因为没有片段就崩溃或退回引导页。 */
  const current: LocalSegment = (segment as LocalSegment | undefined) ?? {
    // film 在空库时不存在，这里用空串兜底 —— 不能写 film.id，会直接崩。
    id: '', videoId: film?.id ?? '', index: 0, start: 0, end: 0,
    status: 'pending', tags: [], observation: '', inference: '', suggestion: '',
    analysis: {
      cameraMove: { value: '', source: null, confidence: null, evidence: '', pending: true },
      rhythm: { value: '', source: null, confidence: null, evidence: '', pending: true },
      lighting: { value: '', source: null, confidence: null, evidence: '', pending: true },
      composition: { value: '', source: null, confidence: null, evidence: '', pending: true },
      transition: { value: '', source: null, confidence: null, evidence: '', pending: true },
      reusable: { value: '', source: null, confidence: null, evidence: '', pending: true },
    },
    extraAnalysis: {},
  }
  const hasSegment = !!segment
  const segmentIndex = filmSegments.findIndex((s) => s.id === segment?.id)
  const reusable = !!segment && !segment.analysis.reusable.pending && /可借鉴|可复用/.test(segment.analysis.reusable.value)
  return { segment, film, filmSegments, hasVideo, segmentByIdMap, segmentIndex, current, hasSegment, videoOrder, reusable, filmOf }
}

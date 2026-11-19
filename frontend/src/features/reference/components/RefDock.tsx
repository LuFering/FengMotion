import type * as React from 'react'
import { Icon } from '@/features/reference/components/RefIcon'
import { formatTimecode, type ReferenceSegment } from '@/features/reference/model/referenceLibrary'
import { segmentsOf } from '@/features/reference/model/refBrowse'
import type { ServerVideo, LocalSegment } from '@/features/reference/services/referenceApiService'

export interface RefDockProps {
  advanceFilm: () => void
  cutSegmentAt: (videoId: string, atSec: number) => Promise<void>
  film: ServerVideo
  filmSegments: ReferenceSegment[]
  filmsRef: React.RefObject<HTMLDivElement | null>
  hasVideo: boolean
  playableFilms: ServerVideo[]
  playing: boolean
  pos: number
  segment: ReferenceSegment
  segments: LocalSegment[]
  selectFilm: (id: string) => void
  selectSegment: (id: string, seek?: boolean) => void
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>
  setPos: React.Dispatch<React.SetStateAction<number>>
  videoRef: React.RefObject<HTMLVideoElement | null>
  videos: ServerVideo[]
}

/** 从 RefLibrary.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function RefDock({ advanceFilm, cutSegmentAt, film, filmSegments, filmsRef, hasVideo, playableFilms, playing, pos, segment, segments, selectFilm, selectSegment, setPlaying, setPos, videoRef, videos }: RefDockProps) {
  return (
    <div className="rfc-dock">
      <div className="rfc-transport">
        <button
          type="button"
          className="rfc-play"
          onClick={() => {
            if (!playing && pos >= film.durationMs / 1000) { setPos(0); if (videoRef.current) videoRef.current.currentTime = 0 }
            setPlaying((p) => !p)
          }}
          disabled={!hasVideo}
          aria-label={hasVideo ? (playing ? '暂停' : '播放') : '暂无视频源'}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        {hasVideo && playableFilms.length > 1 && <button type="button" className="rfc-film-next" onClick={advanceFilm} aria-label="下一部参考片" title="下一部参考片"><Icon name="chevron-right" /></button>}
        {/* 标记片段：从当前播放位置切一段。这是本阶段唯一的「切片」方式 ——
            自动切分尚未接入，界面不提供假按钮。 */}
        {film && (
          <button
            type="button"
            className="rfc-film-next"
            onClick={() => void cutSegmentAt(film.id, pos)}
            aria-label="在当前播放位置标记一个片段"
            title="在当前播放位置标记一个片段"
          >
            <Icon name="plus" />
          </button>
        )}
        <span className="rfc-time num">
          {formatTimecode(pos)} / {formatTimecode(film.durationMs / 1000)}
        </span>
        <span className="rfc-transport-hint">{hasVideo ? '动态示例 · 静音连播 · 空格暂停 · ←/→ 切片段' : '仅静帧 · 暂无视频源'}</span>
        <span className="rfc-spacer" />
      </div>
      <div className="rfc-segbar" role="tablist" aria-label="片段">
        {filmSegments.map((s) => {
          const fill = pos <= s.start ? 0 : pos >= s.end ? 100 : ((pos - s.start) / (s.end - s.start)) * 100
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === segment.id}
              className={`rfc-seg${s.id === segment.id ? ' is-on' : ''}`}
              style={{ flexGrow: s.end - s.start }}
              onClick={() => selectSegment(s.id)}
            >
              <span className="rfc-seg-fill" style={{ width: `${fill}%` }} />
              <span className="rfc-seg-lb">片段 {s.index + 1}</span>
              <span className={`rfc-seg-dot st-${s.status}`} />
            </button>
          )
        })}
      </div>
      <div className="rfc-films" ref={filmsRef}>
        {videos.map((v) => {
          const ss = segmentsOf(segments, v.id)
          return (
            <button
              key={v.id}
              type="button"
              className={`rfc-film${v.id === film.id ? ' is-on' : ''}`}
              onClick={() => selectFilm(v.id)}
              aria-pressed={v.id === film.id}
            >
              {/* 缩略图来自服务端（素材抽帧）。没有缩略图时不放 <img>
                  —— 拿演示静态图路径拼接真实片段 ID 只会得到裂图。 */}
              {v.thumbnailUrl
                ? <img src={v.thumbnailUrl} alt="" loading="lazy" />
                : <span className="rfc-film-ph" aria-hidden="true"><Icon name="film" /></span>}
              <span className="rfc-film-lb">
                <span className="rfc-film-t">{v.title}</span>
                {/* 去 AI 味：分析进度已由片段条上的状态点表达，不再把“已分析 x/y”当副标题 */}
                <span className="rfc-film-m num">{ss.length} 片段</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

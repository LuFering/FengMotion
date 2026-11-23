import type * as React from 'react'
import { Icon } from '@/features/reference/components/RefIcon'
import { formatClock, type ReferenceSegment } from '@/features/reference/model/referenceLibrary'
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
  /** 跳到指定秒数（点时间轴空白处） */
  seekTo: (sec: number) => void
  segment: ReferenceSegment
  /** 当前片段在本片里的序号；没有片段时为 -1 */
  segmentIndex: number
  segments: LocalSegment[]
  selectFilm: (id: string) => void
  selectSegment: (id: string, seek?: boolean) => void
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>
  setPos: React.Dispatch<React.SetStateAction<number>>
  stepSegment: (delta: number) => void
  videoRef: React.RefObject<HTMLVideoElement | null>
  videos: ServerVideo[]
}

/**
 * 底部播放区：一行播放控制，一条真正的时间轴，一排参考片。
 *
 * 时间轴代表整条视频：片段按起止定位、宽度与时长成比例，播放头随播放移动。
 * 原先片段条是按片段数均分的，一个 4 秒片段会铺满整条，看不出它在视频里的位置。
 * 上一/下一片段从画面两侧的大圆钮移到这里 —— 那两枚在分析面板打开时会被盖住。
 */
export function RefDock({ advanceFilm, cutSegmentAt, film, filmSegments, filmsRef, hasVideo, playableFilms, playing, pos, seekTo, segment, segmentIndex, segments, selectFilm, selectSegment, setPlaying, setPos, stepSegment, videoRef, videos }: RefDockProps) {
  const total = film.durationMs / 1000
  const pct = (sec: number) => (total > 0 ? Math.min(100, Math.max(0, (sec / total) * 100)) : 0)
  const hasSeg = segmentIndex >= 0
  return (
    <div className="rfc-dock">
      <div className="rfc-transport">
        <button
          type="button"
          className="rfc-play"
          onClick={() => {
            if (!playing && pos >= total) { setPos(0); if (videoRef.current) videoRef.current.currentTime = 0 }
            setPlaying((p) => !p)
          }}
          disabled={!hasVideo}
          aria-label={hasVideo ? (playing ? '暂停' : '播放') : '暂无视频源'}
          title={hasVideo ? `${playing ? '暂停' : '播放'}（空格）` : '这条参考片没有可播放的文件'}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <span className="rfc-tbar-sep" aria-hidden="true" />
        <button type="button" className="rfc-tbtn" onClick={() => stepSegment(-1)}
                disabled={!hasSeg || segmentIndex <= 0} aria-label="上一片段" title="上一片段（←）">
          <Icon name="arrow-left" />
        </button>
        <button type="button" className="rfc-tbtn" onClick={() => stepSegment(1)}
                disabled={!hasSeg || segmentIndex >= filmSegments.length - 1} aria-label="下一片段" title="下一片段（→）">
          <Icon name="arrow-right" />
        </button>
        {/* 标记片段：从当前播放位置切一段。自动切分未接入，这是本阶段唯一的切片方式。 */}
        <button type="button" className="rfc-tbtn is-text" onClick={() => void cutSegmentAt(film.id, pos)}
                title="从当前位置标记一个 3 秒的片段，之后可在分析面板里调整起止">
          <Icon name="plus" /> 标记片段
        </button>
        {hasVideo && playableFilms.length > 1 && (
          <button type="button" className="rfc-tbtn" onClick={advanceFilm} aria-label="下一部参考片" title="下一部参考片">
            <Icon name="chevron-right" />
          </button>
        )}
        <span className="rfc-spacer" />
        <span className="rfc-time">
          {formatClock(Math.floor(pos))}<i>/</i>{formatClock(Math.round(total))}
        </span>
      </div>

      <div
        className="rfc-segbar"
        role="tablist"
        aria-label="片段时间轴"
        title="点击空白处跳到该时间"
        onClick={(e) => {
          if (e.target !== e.currentTarget || total <= 0) return
          const r = e.currentTarget.getBoundingClientRect()
          seekTo(((e.clientX - r.left) / r.width) * total)
        }}
      >
        {filmSegments.map((s) => {
          const on = s.id === segment?.id
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`rfc-seg${on ? ' is-on' : ''}`}
              style={{ left: `${pct(s.start)}%`, width: `${pct(s.end) - pct(s.start)}%` }}
              onClick={(e) => { e.stopPropagation(); selectSegment(s.id) }}
              aria-label={`片段 ${s.index + 1}，${formatClock(s.start)} 到 ${formatClock(s.end)}`}
              title={`片段 ${s.index + 1} · ${formatClock(s.start)} – ${formatClock(s.end)}`}
            >
              <span className="rfc-seg-lb"><span className="rfc-seg-word">片段 </span>{s.index + 1}</span>
              <span className={`rfc-seg-dot st-${s.status}`} />
            </button>
          )
        })}
        {total > 0 && <span className="rfc-playhead" style={{ left: `${pct(pos)}%` }} aria-hidden="true" />}
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
              {/* 缩略图来自服务端（素材抽帧）。没有时不放 <img>，避免裂图。 */}
              {v.thumbnailUrl
                ? <img src={v.thumbnailUrl} alt="" loading="lazy" />
                : <span className="rfc-film-ph" aria-hidden="true"><Icon name="film" /></span>}
              <span className="rfc-film-lb">
                <span className="rfc-film-t">{v.title}</span>
                <span className="rfc-film-m">
                  {ss.length > 0 ? `${ss.length} 个片段` : '没有片段'}
                  {v.durationMs > 0 && ` · ${formatClock(Math.round(v.durationMs / 1000))}`}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

import type * as React from 'react'
import { Icon } from '@/features/reference/components/RefIcon'
import { formatClock, type ReferenceSegment } from '@/features/reference/model/referenceLibrary'
import { segmentsOf } from '@/features/reference/model/refBrowse'
import type { ServerVideo, LocalSegment } from '@/features/reference/services/referenceApiService'
import { RefTimeline } from '@/features/reference/components/RefTimeline'

export interface RefDockProps {
  advanceFilm: () => void
  cutSegmentAt: (videoId: string, atSec: number) => Promise<void>
  film: ServerVideo
  filmSegments: ReferenceSegment[]
  filmsRef: React.RefObject<HTMLDivElement | null>
  hasVideo: boolean
  /** 播放速度 */
  rate: number
  setRate: (r: number) => void
  /** 是否循环当前片段 */
  loopSeg: boolean
  setLoopSeg: React.Dispatch<React.SetStateAction<boolean>>
  /** 拖动时间轴上当前片段的两端后保存 */
  onResize: (start: number, end: number) => Promise<void>
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
export function RefDock({ advanceFilm, cutSegmentAt, film, filmSegments, filmsRef, hasVideo, loopSeg, onResize, rate, setLoopSeg, setRate, playableFilms, playing, pos, seekTo, segment, segmentIndex, segments, selectFilm, selectSegment, setPlaying, setPos, stepSegment, videoRef, videos }: RefDockProps) {
  const total = film.durationMs / 1000
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
        {/* 循环当前片段 + 慢放：看清一个运镜往往要反复、放慢看 */}
        <button type="button" className="rfc-tbtn is-chip" aria-pressed={loopSeg} data-on={loopSeg || undefined}
                disabled={!hasSeg || !hasVideo} onClick={() => setLoopSeg((v) => !v)}
                title={loopSeg ? '停止循环当前片段' : '循环播放当前片段'}>
          <Icon name="refresh-cw" /> 循环片段
        </button>
        <div className="rfc-rate" role="radiogroup" aria-label="播放速度">
          {[1, 0.5, 0.25].map((r) => (
            <button key={r} type="button" role="radio" aria-checked={rate === r} data-on={rate === r || undefined}
                    disabled={!hasVideo} onClick={() => setRate(r)} title={`${r}× 速度`}>
              {r}×
            </button>
          ))}
        </div>
        <span className="rfc-tbar-sep" aria-hidden="true" />
        <span className="rfc-time">
          {formatClock(Math.floor(pos))}<i>/</i>{formatClock(Math.round(total))}
        </span>
      </div>

      <RefTimeline
        total={total}
        pos={pos}
        segments={filmSegments}
        currentId={segment?.id}
        onSeek={seekTo}
        onSelect={(id) => selectSegment(id)}
        onResize={onResize}
        mediaRef={videoRef}
        playing={playing && hasVideo}
      />

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

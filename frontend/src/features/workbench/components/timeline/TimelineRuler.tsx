import { Tooltip, TooltipTrigger, TooltipContent } from '@/shared/ui/tooltip'
import { UiIcon } from '@/shared/icons/UiIcon'
import { HelpCircle } from '@untitledui/icons'
import { formatTimecode } from '@/features/workbench/model/timeRange'
import { clamp, tickLabel } from '@/features/workbench/components/timeline/timelineDisplay'
import type { SequenceTrack } from '@/features/workbench/model/sequenceManifest'

export interface TimelineRulerProps {
  currentTime: number
  frameFps: number | undefined
  limit: number
  minorTicks: { time: number; mid: boolean }[]
  onSeek: (seconds: number) => void
  pct: (t: number) => number
  playheadVisible: boolean
  step: number
  ticks: number[]
  /** 指针位置 → 时间；free = 按住 Shift，不吸附到切点 */
  scrubAt: (clientX: number, free: boolean) => number
  /** 指针悬停在标尺上（null = 离开），用来浮出那一帧 */
  onHover: (clientX: number | null) => void
  tracks: SequenceTrack[]
  tracksVerified: boolean
  unavailable: boolean
}

/** 时间线的标尺行：刻度与播放头标记，点击、拖动或方向键定位播放位置；轨道未与当前版本确认时标出「参考」。 */
export function TimelineRuler({ currentTime, frameFps, limit, minorTicks, onSeek, pct, playheadVisible, step, ticks, scrubAt, onHover, tracks, tracksVerified, unavailable, note }: TimelineRulerProps & { note?: string }) {
  return (
    <div className="wb-tl-grid wb-tl-ruler-row">
      <div className="wb-tl-ruler-meta">
        <span className="wb-tl-meta-title">内容</span>
        {tracks.length > 0 && !tracksVerified && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="wb-tl-ref-badge" tabIndex={0} role="status">
                参考 <UiIcon icon={HelpCircle} size="xs" className="inline ml-0.5 opacity-70" />
              </span>
            </TooltipTrigger>
            <TooltipContent>这些轨道尚未确认与当前版本对应，可浏览和定位。</TooltipContent>
          </Tooltip>
        )}
        {note && <small className="wb-tl-note" role="status">{note}</small>}
        {frameFps && <small className="wb-tl-fps-label">{Math.round(frameFps * 100) / 100} fps</small>}
      </div>

      <div
        className="wb-tl-ruler"
        role="slider"
        tabIndex={unavailable ? -1 : 0}
        aria-label="播放位置"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(currentTime, limit)}
        aria-valuetext={formatTimecode(currentTime, true)}
        aria-disabled={unavailable}
        onPointerDown={(e) => {
          if (unavailable || e.button !== 0) return
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          onSeek(scrubAt(e.clientX, e.shiftKey))
        }}
        onPointerMove={(e) => {
          onHover(e.clientX)
          if (!unavailable && e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(scrubAt(e.clientX, e.shiftKey))
        }}
        onPointerLeave={() => onHover(null)}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onKeyDown={(e) => {
          const frame = frameFps ? 1 / frameFps : 0.1
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          onSeek(clamp(currentTime + (e.key === 'ArrowLeft' ? -frame : frame), 0, limit))
        }}
      >
        {/* 标尺次刻度（短线） */}
        {minorTicks.map((mt) => (
          <span
            key={`m-${mt.time}`}
            className="wb-tl-tick-minor"
            data-mid={mt.mid || undefined}
            style={{ left: `${pct(mt.time)}%` }}
            aria-hidden="true"
          />
        ))}
        {/* 标尺主刻度（长线 + 时码文字） */}
        {ticks.map((tick, i) => (
          <span
            key={tick}
            className="wb-tl-tick"
            data-first={i === 0 && pct(tick) < 3 || undefined}
            data-last={i === ticks.length - 1 && pct(tick) > 97 || undefined}
            style={{ left: `${pct(tick)}%` }}
          >
            {tickLabel(tick, step)}
          </span>
        ))}
        {/* 播放头顶部标记 */}
        {playheadVisible && (
          <span
            className="wb-tl-playhead-cap"
            style={{ left: `${pct(currentTime)}%` }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  )
}

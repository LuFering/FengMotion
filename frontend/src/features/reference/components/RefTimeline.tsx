import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { formatClock, type ReferenceSegment } from '@/features/reference/model/referenceLibrary'

/** 刻度步长候选（秒）：取第一个能让标签不超过 10 个的 */
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
/** 片段最短 0.3 秒 */
const MIN_LEN = 0.3

type Drag = { mode: 'scrub' } | { mode: 'start' | 'end'; start: number; end: number }

/** 直接写播放头与已播放进度的位置（不经 React 渲染） */
function paintHead(head: HTMLElement | null, played: HTMLElement | null, sec: number, total: number) {
  const p = `${total > 0 ? Math.min(100, Math.max(0, (sec / total) * 100)) : 0}%`
  if (head) head.style.left = p
  if (played) played.style.width = p
}

export interface RefTimelineProps {
  total: number
  pos: number
  segments: ReferenceSegment[]
  currentId?: string
  onSeek: (sec: number) => void
  onSelect: (id: string) => void
  /** 调整当前片段起止并保存；失败由调用方提示并回读 */
  onResize: (start: number, end: number) => Promise<void>
  /** 播放中用它逐帧读取当前时间，让播放头连续移动（timeupdate 每秒只有约 4 次） */
  mediaRef?: React.RefObject<HTMLVideoElement | null>
  playing?: boolean
}

/**
 * 影院形态的悬浮时间轴（参考片库打磨方案 §8）。
 * 平时是一条细线压在画面底部；鼠标移入或键盘聚焦时展开为带刻度的轨道（样式见 cinema.css）。
 * 交互借鉴 Vidstack TimeSlider（悬停时间气泡、拖动定位）与 VEST/Vidat（拖片段两端调整起止）。
 */
export function RefTimeline({ total, pos, segments, currentId, onSeek, onSelect, onResize, mediaRef, playing }: RefTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLSpanElement>(null)
  const playedRef = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  /* 松手到服务端回写之间，片段先停在拖到的位置，不闪回旧值 */
  const [saving, setSaving] = useState<{ start: number; end: number } | null>(null)

  const pct = (s: number) => (total > 0 ? Math.min(100, Math.max(0, (s / total) * 100)) : 0)
  const round = (s: number) => Math.round(s * 10) / 10
  const secAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return 0
    return Math.min(total, Math.max(0, ((clientX - r.left) / r.width) * total))
  }

  /* 播放头与已播放进度由这里直接写 DOM，不走 React 渲染：
     暂停 / 拖动时跟 pos；播放中用 requestAnimationFrame 逐帧读视频时间，移动才连续 */
  useLayoutEffect(() => {
    if (!playing || drag?.mode === 'scrub') paintHead(headRef.current, playedRef.current, pos, total)
  })
  useEffect(() => {
    const media = mediaRef?.current
    if (!playing || !media || drag?.mode === 'scrub') return
    let raf = 0
    const head = headRef.current
    const played = playedRef.current
    const tick = () => { paintHead(head, played, media.currentTime, total); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, total, mediaRef, drag?.mode])

  const step = STEPS.find((s) => total / s <= 10) ?? 600
  const ticks = total > 0 ? Array.from({ length: Math.floor(total / step + 1e-6) + 1 }, (_, i) => i * step) : []

  const cur = segments.find((s) => s.id === currentId)
  const range = drag && drag.mode !== 'scrub' ? drag : saving ?? (cur ? { start: cur.start, end: cur.end } : null)

  const commit = (d: Drag | null) => {
    setDrag(null)
    if (!d || d.mode === 'scrub' || !cur) return
    if (Math.abs(d.start - cur.start) < 0.05 && Math.abs(d.end - cur.end) < 0.05) return
    setSaving({ start: d.start, end: d.end })
    void onResize(d.start, d.end).finally(() => setSaving(null))
  }

  const moveEdge = (d: Drag, s: number): Drag => {
    if (d.mode === 'start') return { ...d, start: round(Math.min(Math.max(0, s), d.end - MIN_LEN)) }
    if (d.mode === 'end') return { ...d, end: round(Math.max(Math.min(total, s), d.start + MIN_LEN)) }
    return d
  }

  const onTrackDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || total <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ mode: 'scrub' })
    onSeek(secAt(e.clientX))
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = secAt(e.clientX)
    setHover(s)
    if (!drag) return
    if (drag.mode === 'scrub') onSeek(s)
    else setDrag(moveEdge(drag, s))
  }
  const onHandleDown = (edge: 'start' | 'end') => (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0 || !range) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ mode: edge, start: range.start, end: range.end })
  }
  const onHandleKey = (edge: 'start' | 'end') => (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (!range) return
    e.preventDefault()
    e.stopPropagation()
    const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1)
    const base: Drag = drag && drag.mode === edge ? drag : { mode: edge, start: range.start, end: range.end }
    setDrag(moveEdge(base, (edge === 'start' ? base.start : base.end) + delta))
  }

  const hoverSeg = hover === null ? undefined : segments.find((s) => hover >= s.start && hover < s.end)
  const hoverLabel = hover === null ? '' : `${formatClock(round(hover))}${hoverSeg ? ` · 片段 ${hoverSeg.index + 1}` : ''}`

  return (
    <div className="rfc-tl" data-active={drag ? '' : undefined}>
      <div className="rfc-tl-ruler" aria-hidden="true">
        {ticks.map((t, i) => (
          <span key={t} style={{ left: `${pct(t)}%` }} data-edge={i === 0 ? 'start' : pct(t) > 94 ? 'end' : undefined}>{formatClock(t)}</span>
        ))}
      </div>
      <div
        ref={trackRef}
        className="rfc-tl-track"
        role="group"
        aria-label="片段时间轴：按住拖动定位，拖动当前片段两端调整起止"
        data-dragging={drag ? drag.mode : undefined}
        onPointerDown={onTrackDown}
        onPointerMove={onMove}
        onPointerUp={() => commit(drag)}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => { if (!drag) setHover(null) }}
      >
        <span ref={playedRef} className="rfc-tl-played" aria-hidden="true" />
        {segments.map((s) => {
          const on = s.id === currentId
          const r = on && range ? range : s
          return (
            <button
              key={s.id}
              type="button"
              className="rfc-tl-seg"
              data-on={on || undefined}
              style={{ left: `${pct(r.start)}%`, width: `${pct(r.end) - pct(r.start)}%` }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSelect(s.id)}
              aria-pressed={on}
              aria-label={`片段 ${s.index + 1}，${formatClock(r.start)} 到 ${formatClock(r.end)}`}
            >
              <span className="rfc-tl-lb"><span className="rfc-tl-word">片段 </span>{s.index + 1}</span>
            </button>
          )
        })}
        {cur && range && (['start', 'end'] as const).map((edge) => {
          const v = edge === 'start' ? range.start : range.end
          return (
            <span
              key={edge}
              role="slider"
              tabIndex={0}
              className="rfc-tl-handle"
              data-edge={edge}
              style={{ left: `${pct(v)}%` }}
              aria-label={edge === 'start' ? '片段起点' : '片段终点'}
              aria-valuemin={0}
              aria-valuemax={Math.round(total * 10) / 10}
              aria-valuenow={v}
              aria-valuetext={formatClock(v)}
              title={`${edge === 'start' ? '起点' : '终点'} ${formatClock(v)} · 拖动或 ←/→ 调整`}
              onPointerDown={onHandleDown(edge)}
              onKeyDown={onHandleKey(edge)}
              onKeyUp={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') commit(drag) }}
              onBlur={() => { if (drag && drag.mode !== 'scrub') commit(drag) }}
            />
          )
        })}
        {hover !== null && (
          <span className="rfc-tl-hover" style={{ left: `${pct(hover)}%` }} aria-hidden="true"><em>{hoverLabel}</em></span>
        )}
        {total > 0 && <span ref={headRef} className="rfc-tl-head" aria-hidden="true" />}
      </div>
    </div>
  )
}

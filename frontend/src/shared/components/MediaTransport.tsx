import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { formatClock } from '@/shared/lib/time'
import '@/styles/media-transport.css'

export interface MediaTransportProps {
  /** 被控制的 <video> / <audio>。播放状态以元素为准，组件只监听、只下指令 */
  mediaRef: React.RefObject<HTMLMediaElement | null>
  /** 元素换了（换 src、条件渲染后才出现）时传一个会变的值，通常就是 src，播放条据此重新挂监听 */
  mediaKey?: string | number
  /** 元数据未加载前用的总时长（秒），例如列表里已知的时长；读到真实时长后以真实值为准 */
  fallbackDuration?: number
  disabled?: boolean
  className?: string
}

const MEDIA_EVENTS = ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'seeked', 'emptied'] as const

/** 直接写播放头与已播放进度（不经 React 渲染），与参考片库时间轴同一做法 */
function paint(head: HTMLElement | null, played: HTMLElement | null, sec: number, total: number) {
  const p = `${total > 0 ? Math.min(100, Math.max(0, (sec / total) * 100)) : 0}%`
  if (head) head.style.left = p
  if (played) played.style.width = p
}

/**
 * 全站共享播放条（打磨方案 §2.4）：播放、进度（悬停时间气泡、拖动定位）、时间读数、静音。
 * 替换浏览器原生 controls —— 原生控件随浏览器和主题各长各样，读数也不是 `0:04 / 0:30` 这种写法。
 * 样式取参考片库已确认的细线时间轴（styles/media-transport.css），画面上的控件三主题一致。
 *
 * 键盘：进度条可聚焦，←/→ 1 秒、Shift 加按 5 秒，Home / End 到头尾；空格由播放键本身响应。
 */
export function MediaTransport({ mediaRef, mediaKey, fallbackDuration = 0, disabled, className }: MediaTransportProps) {
  const [attached, setAttached] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [duration, setDuration] = useState(0)
  const [pos, setPos] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLSpanElement>(null)
  const playedRef = useRef<HTMLSpanElement>(null)

  const total = duration > 0 ? duration : fallbackDuration
  const off = !!disabled || !attached || total <= 0

  useEffect(() => {
    const m = mediaRef.current
    setAttached(!!m)
    if (!m) return
    const sync = () => {
      setPlaying(!m.paused && !m.ended)
      setMuted(m.muted)
      setDuration(Number.isFinite(m.duration) ? m.duration : 0)
      setPos(m.currentTime)
    }
    sync()
    for (const e of MEDIA_EVENTS) m.addEventListener(e, sync)
    return () => { for (const e of MEDIA_EVENTS) m.removeEventListener(e, sync) }
  }, [mediaRef, mediaKey])

  /* 暂停 / 拖动时跟 pos；播放中逐帧读媒体时间，播放头才连续（timeupdate 每秒只有约 4 次） */
  useLayoutEffect(() => {
    if (!playing || scrubbing) paint(headRef.current, playedRef.current, pos, total)
  })
  useEffect(() => {
    const m = mediaRef.current
    if (!m || !playing || scrubbing) return
    const head = headRef.current
    const played = playedRef.current
    let raf = 0
    const tick = () => { paint(head, played, m.currentTime, total); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mediaRef, playing, scrubbing, total])

  const clamp = (s: number) => Math.min(total, Math.max(0, s))
  const secAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return 0
    return clamp(((clientX - r.left) / r.width) * total)
  }
  const seek = (s: number) => {
    const m = mediaRef.current
    if (!m) return
    const v = clamp(s)
    m.currentTime = v
    setPos(v)
  }
  const toggle = () => {
    const m = mediaRef.current
    if (!m) return
    if (m.paused || m.ended) {
      if (m.ended) m.currentTime = 0
      /* 播放被浏览器拒绝时元素保持暂停，按钮状态随 pause 事件回到「播放」，不另提示 */
      void m.play().catch(() => {})
    } else {
      m.pause()
    }
  }
  const toggleMute = () => {
    const m = mediaRef.current
    if (m) m.muted = !m.muted
  }

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (off || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setScrubbing(true)
    seek(secAt(e.clientX))
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (off) return
    const s = secAt(e.clientX)
    setHover(s)
    if (scrubbing) seek(s)
  }
  const onUp = () => setScrubbing(false)
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const m = mediaRef.current
    if (off || !m) return
    const step = e.shiftKey ? 5 : 1
    const now = m.currentTime
    const target: Record<string, number> = { ArrowLeft: now - step, ArrowRight: now + step, Home: 0, End: total }
    if (!(e.key in target)) return
    e.preventDefault()
    seek(target[e.key])
  }

  const pct = (s: number) => `${total > 0 ? Math.min(100, Math.max(0, (s / total) * 100)) : 0}%`
  const round1 = (s: number) => Math.round(s * 10) / 10

  return (
    <div className={['fm-mt', className].filter(Boolean).join(' ')} data-disabled={off || undefined}>
      <button
        type="button"
        className="fm-mt-btn"
        onClick={toggle}
        disabled={off}
        aria-label={playing ? '暂停' : '播放'}
      >
        <UiIcon icon={playing ? SemIcons.pause : SemIcons.play} size="sm" />
      </button>
      <div
        ref={trackRef}
        className="fm-mt-track"
        role="slider"
        tabIndex={off ? -1 : 0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={round1(total)}
        aria-valuenow={round1(pos)}
        aria-valuetext={`${formatClock(pos)} / ${formatClock(total)}`}
        aria-disabled={off || undefined}
        data-active={scrubbing || undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => { if (!scrubbing) setHover(null) }}
        onKeyDown={onKey}
      >
        <span ref={playedRef} className="fm-mt-played" />
        <span ref={headRef} className="fm-mt-head" />
        {hover !== null && !off && (
          <span className="fm-mt-hover" style={{ left: pct(hover) }} aria-hidden="true">
            <em>{formatClock(hover)}</em>
          </span>
        )}
      </div>
      <span className="fm-mt-time">
        {/* 总时长不取整：与时间线读数同一写法（0:30.1），全页只有一个总时长 */}
        {formatClock(pos)}<i>/</i>{formatClock(total)}
      </span>
      <button
        type="button"
        className="fm-mt-btn"
        onClick={toggleMute}
        disabled={!!disabled || !attached}
        aria-pressed={muted}
        aria-label={muted ? '取消静音' : '静音'}
      >
        <UiIcon icon={muted ? SemIcons.mute : SemIcons.volume} size="sm" />
      </button>
    </div>
  )
}

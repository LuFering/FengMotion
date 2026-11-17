import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
/* 时间轨道图标全部用 lucide（第三轮统一）：选区起止用 |< >|，与原 phosphor CaretLine 语义一致。 */
import { Captions, ChevronFirst, Plus, ChevronLast, ChevronRight, Clapperboard, Film, HelpCircle, Image as ImageGlyph, Layers, Minus, Music2, Repeat, Scan, Shapes, Type, X as XMark } from 'lucide-react'
import { MediaIcon } from '@/components/icons/MediaIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTimecode } from '@/data/timeRange'
import { sequenceClipKey as clipKey, type SequenceEntry, type SequenceTrack } from '@/data/sequenceManifest'
import type { CapabilityResult } from '@/services/workbenchCapabilityEvaluator'
import '../styles/workbench-timeline.css'

export type WorkbenchTimelineSpan = { start: number; end: number }

export interface WorkbenchTimelineProps {
  videoUrl: string
  duration: number
  currentTime: number
  /** 工程声明的帧率；没有就不显示，也不假装能按帧微调。 */
  fps?: number
  /** 真实轨道清单；为空时只有一条成片轨。 */
  tracks?: SequenceTrack[]
  tracksVerified?: boolean
  trackStatus?: string
  span: WorkbenchTimelineSpan | null
  disabled: boolean
  looping: boolean
  maxZoom: number
  onSeek: (seconds: number) => void
  onSpanChange: (span: WorkbenchTimelineSpan | null) => void
  onSpanCommit: (span: WorkbenchTimelineSpan) => void
  onClear: () => void
  onToggleLoop: () => void
  /** 刚拖动完、等待确认的调整。它浮在轨道区内部，不占布局高度。 */
  pending?: { brief: string; label?: string } | null
  onPendingAccept?: () => void
  onPendingDrop?: () => void
  onClipAction?: (action: 'remove' | 'duplicate' | 'split', clip: SequenceEntry, track: SequenceTrack) => void
  onClipReference?: (clip: SequenceEntry, track: SequenceTrack) => void
  onSequenceMove?: (
    item: SequenceEntry,
    next: { start: number; duration: number },
    intent: 'move' | 'trim-start' | 'trim-end',
    track: SequenceTrack,
  ) => void
  onTrackAction?: (action: 'toggle-visibility' | 'toggle-muted', track: SequenceTrack) => void
  timelineOpsCapability?: CapabilityResult
  trackClipCapability?: CapabilityResult
}

type Drag = {
  pointerId: number
  kind: 'create' | 'start' | 'end'
  anchor: number
  x: number
  original: WorkbenchTimelineSpan | null
  moved: boolean
  viewStart: number
  viewWidth: number
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const round = (v: number) => Math.round(v * 1000) / 1000
const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
const tickStepFor = (visible: number) => TICK_STEPS.find((s) => visible / s <= 7) ?? 7200
const tickLabel = (seconds: number, step: number) => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (step >= 1) return `${m}:${String(Math.round(s)).padStart(2, '0')}`
  const digits = step < 0.2 ? 2 : 1
  return `${m}:${s.toFixed(digits).padStart(digits + 3, '0')}`
}

const KIND_ICON = { text: Type, image: ImageGlyph, video: Film, audio: Music2, shape: Shapes } as const
const TRACK_ICON = {
  text: Captions,
  video: Clapperboard,
  background: Layers,
  image: ImageGlyph,
  audio: Music2,
  shape: Shapes,
} as const
type TrackVisualKind = keyof typeof TRACK_ICON

const trackVisualKind = (track: SequenceTrack): TrackVisualKind => {
  const label = `${track.name} ${track.clips[0]?.kind ?? ''}`
  if (/字幕|文字|标题|caption|subtitle|text/i.test(label)) return 'text'
  if (/音频|音乐|audio|music|sound/i.test(label)) return 'audio'
  if (/背景|底图|background/i.test(track.name)) return 'background'
  if (/画面|视频|video/i.test(label)) return 'video'
  const kind = track.clips[0]?.kind
  return kind && kind in TRACK_ICON ? kind : 'background'
}

/** 真实视频缩略帧序列（统一 16:9 无边框贴合） */
function Filmstrip({ src, duration, frames = 12 }: { src: string; duration: number; frames?: number }) {
  const canvases = useRef<(HTMLCanvasElement | null)[]>([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!src || !Number.isFinite(duration) || duration <= 0) return
    setFailed(false)
    let cancelled = false
    let timer = 0
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = src
    const fail = () => { if (!cancelled) setFailed(true) }
    const capture = (index: number) => {
      if (cancelled || index >= canvases.current.length) return
      const canvas = canvases.current[index]
      try {
        canvas?.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
      } catch { fail(); return }
      seek(index + 1)
    }
    const seek = (index: number) => {
      if (cancelled || index >= canvases.current.length) return
      const at = Math.min(Math.max(0, duration - 0.04), (duration * (index + 0.5)) / canvases.current.length)
      timer = window.setTimeout(fail, 8000)
      video.onseeked = () => { window.clearTimeout(timer); capture(index) }
      try { video.currentTime = at } catch { window.clearTimeout(timer); fail() }
    }
    video.onloadedmetadata = () => seek(0)
    video.onerror = fail
    video.load()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      video.onloadedmetadata = null
      video.onseeked = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
    }
  }, [src, duration, frames])

  return (
    <div className="wb-tl-filmstrip" aria-hidden="true" title={failed ? '缩略帧暂时无法显示' : undefined}>
      {Array.from({ length: frames }, (_, i) => (
        <canvas key={i} ref={(node) => { canvases.current[i] = node }} width={160} height={90} />
      ))}
    </div>
  )
}

export function WorkbenchTimeline({
  videoUrl, duration, currentTime, fps, tracks = [], span, disabled, looping, maxZoom,
  onSeek, onSpanChange, onSpanCommit, onClear, onToggleLoop, pending, onPendingAccept, onPendingDrop, onClipReference, trackStatus, tracksVerified = false,
  timelineOpsCapability, trackClipCapability,
}: WorkbenchTimelineProps) {
  const track = useRef<HTMLDivElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  const panBar = useRef<HTMLDivElement>(null)
  const panThumbDrag = useRef<{ pointerId: number; x: number; start: number } | null>(null)
  const drag = useRef<Drag | null>(null)

  const [pickedId, setPickedId] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const [gutterWidth, setGutterWidth] = useState(144)
  const gutterDrag = useRef<{ x: number; w: number } | null>(null)

  const beginGutterDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    gutterDrag.current = { x: e.clientX, w: gutterWidth }
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
  }
  const moveGutterDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = gutterDrag.current
    if (!d) return
    const next = Math.round(Math.min(260, Math.max(110, d.w + (e.clientX - d.x))))
    setGutterWidth(next)
  }
  const endGutterDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!gutterDrag.current) return
    gutterDrag.current = null
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }

  const limit = Number.isFinite(duration) && duration > 0 ? duration : 0
  const unavailable = disabled || limit === 0 || !(timelineOpsCapability?.allowed ?? true)
  const opsDisabledReason = timelineOpsCapability && !timelineOpsCapability.allowed
    ? timelineOpsCapability.reason
    : limit === 0
      ? '正在读取媒体时长…'
      : '预览画面未就绪'
  const frameFps = fps && Number.isFinite(fps) && fps > 0 ? fps : undefined

  const [zoom, setZoom] = useState(1)
  const [start, setStart] = useState(0)

  const width = limit / clamp(zoom, 1, Math.max(1, maxZoom))
  const viewStart = clamp(start, 0, Math.max(0, limit - width))
  const viewEnd = viewStart + width
  const pct = useCallback((t: number) => (width > 0 ? ((t - viewStart) / width) * 100 : 0), [viewStart, width])
  const timeAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect()
    const ratio = rect && rect.width ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0
    return round(clamp(viewStart + ratio * width, 0, limit))
  }

  const setZoomTo = (value: number, anchor?: { time: number; ratio: number }) => {
    const next = clamp(value, 1, Math.max(1, maxZoom))
    const nextWidth = limit / next
    if (anchor) {
      const at = clamp(anchor.ratio, 0, 1)
      setStart(clamp(anchor.time - nextWidth * at, 0, Math.max(0, limit - nextWidth)))
    } else {
      const center = span ? (span.start + span.end) / 2 : clamp(currentTime, viewStart, viewEnd)
      setStart(clamp(center - nextWidth / 2, 0, Math.max(0, limit - nextWidth)))
    }
    setZoom(next)
  }

  const nextSpan = (d: Drag, time: number): WorkbenchTimelineSpan => {
    if (d.kind === 'create') return { start: Math.min(d.anchor, time), end: Math.max(d.anchor, time) }
    const old = d.original!
    const gap = Math.min(0.05, limit)
    return d.kind === 'start'
      ? { start: round(clamp(time, 0, old.end - gap)), end: old.end }
      : { start: old.start, end: round(clamp(time, old.start + gap, limit)) }
  }

  const cancelDrag = () => {
    const d = drag.current
    if (!d) return false
    drag.current = null
    onSpanChange(d.original)
    if (track.current?.hasPointerCapture(d.pointerId)) track.current.releasePointerCapture(d.pointerId)
    return true
  }

  const begin = (e: PointerEvent<HTMLDivElement>) => {
    if (unavailable || e.button !== 0 || drag.current) return
    const edge = (e.target as HTMLElement).closest<HTMLElement>('[data-edge]')?.dataset.edge
    const kind = edge === 'start' || edge === 'end' ? edge : 'create'
    if (kind !== 'create' && !span) return
    e.preventDefault()
    drag.current = { pointerId: e.pointerId, kind, anchor: timeAt(e.clientX), x: e.clientX, original: span, moved: false, viewStart, viewWidth: width }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (Math.abs(e.clientX - d.x) >= 3) d.moved = true
    if (d.moved) onSpanChange(nextSpan(d, timeAt(e.clientX)))
  }

  const finish = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const time = timeAt(e.clientX)
    if (!d.moved) {
      if (d.kind === 'create') onSeek(time)
      return
    }
    const next = nextSpan(d, time)
    if (next.end > next.start) { onSpanChange(next); onSpanCommit(next) } else onSpanChange(d.original)
  }

  const markBoundary = (edge: 'start' | 'end') => {
    const time = round(clamp(currentTime, 0, limit))
    const next = edge === 'start'
      ? { start: time, end: span && span.end > time + 0.05 ? span.end : limit }
      : { start: span && span.start < time - 0.05 ? span.start : 0, end: time }
    if (next.end - next.start >= Math.min(0.05, limit)) { onSpanChange(next); onSpanCommit(next) }
  }

  const keyHandle = (e: KeyboardEvent<HTMLButtonElement>, edge: 'start' | 'end') => {
    if (!span || unavailable) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClear(); return }
    const frame = frameFps ? 1 / frameFps : 0.1
    const stepVal = e.shiftKey ? 1 : frame
    let value = span[edge]
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      value = frameFps && !e.shiftKey ? (Math.ceil(value * frameFps - 0.001) - 1) / frameFps : value - stepVal
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      value = frameFps && !e.shiftKey ? (Math.floor(value * frameFps + 0.001) + 1) / frameFps : value + stepVal
    } else if (e.key === 'Home') value = 0
    else if (e.key === 'End') value = limit
    else return
    e.preventDefault()
    const next = nextSpan({ pointerId: 0, kind: edge, anchor: 0, x: 0, original: span, moved: true, viewStart, viewWidth: width }, value)
    onSpanChange(next)
    onSpanCommit(next)
  }

  const pickedTrack = pickedId ? tracks.find((row) => row.clips.some((clip) => clipKey(row.id, clip.id) === pickedId)) : undefined
  const picked = pickedTrack?.clips.find((clip) => clipKey(pickedTrack.id, clip.id) === pickedId) ?? null

  /* 滚轮缩放与平移 */
  useEffect(() => {
    const node = workspace.current
    if (!node) return
    const wheel = (e: WheelEvent) => {
      if (unavailable || maxZoom <= 1) return
      const rect = track.current?.getBoundingClientRect()
      if (!rect?.width || e.clientX < rect.left || e.clientX > rect.right) return
      const horizontal = e.shiftKey || (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY))
      if (horizontal) {
        if (zoom <= 1.001) return
        e.preventDefault()
        const delta = e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.width : 1
        setStart(clamp(viewStart + delta * unit * width / rect.width, 0, Math.max(0, limit - width)))
        return
      }
      const rows = node.querySelector<HTMLElement>('.wb-tl-rows')
      if (!e.ctrlKey && !e.metaKey && rows && rows.contains(e.target as Node) && rows.scrollHeight > rows.clientHeight + 1) return
      e.preventDefault()
      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)
      const next = clamp(zoom * Math.exp(-e.deltaY / 300), 1, Math.max(1, maxZoom))
      const nextWidth = limit / next
      const anchor = viewStart + ratio * width
      setStart(clamp(anchor - ratio * nextWidth, 0, Math.max(0, limit - nextWidth)))
      setZoom(next)
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => node.removeEventListener('wheel', wheel)
  }, [unavailable, maxZoom, zoom, viewStart, width, limit])

  const beginPanThumb = (e: PointerEvent<HTMLDivElement>) => {
    if (unavailable || e.button !== 0 || zoom <= 1.001) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    e.preventDefault()
    const clickedThumb = (e.target as HTMLElement).closest('.wb-tl-pan-thumb')
    const thumbWidth = e.currentTarget.querySelector('.wb-tl-pan-thumb')?.getBoundingClientRect().width ?? 0
    const travel = Math.max(1, rect.width - thumbWidth)
    const initial = clickedThumb ? viewStart : clamp((e.clientX - rect.left - thumbWidth / 2) / travel * (limit - width), 0, limit - width)
    if (!clickedThumb) setStart(initial)
    panThumbDrag.current = { pointerId: e.pointerId, x: e.clientX, start: initial }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const movePanThumb = (e: PointerEvent<HTMLDivElement>) => {
    const d = panThumbDrag.current
    const rect = panBar.current?.getBoundingClientRect()
    if (!d || d.pointerId !== e.pointerId || !rect?.width) return
    const thumbWidth = panBar.current?.querySelector('.wb-tl-pan-thumb')?.getBoundingClientRect().width ?? 0
    const travel = Math.max(1, rect.width - thumbWidth)
    setStart(clamp(d.start + (e.clientX - d.x) * Math.max(0, limit - width) / travel, 0, Math.max(0, limit - width)))
  }
  const endPanThumb = (e: PointerEvent<HTMLDivElement>) => {
    if (panThumbDrag.current?.pointerId !== e.pointerId) return
    panThumbDrag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const stepFrame = (direction: -1 | 1) => {
    if (!frameFps || unavailable) return
    const at = currentTime * frameFps
    const frame = direction < 0 ? Math.ceil(at - 0.001) - 1 : Math.floor(at + 0.001) + 1
    const next = clamp(frame / frameFps, 0, limit)
    onSeek(next)
    if (next < viewStart || next > viewEnd) setStart(clamp(next - width / 2, 0, Math.max(0, limit - width)))
  }

  /* 标尺主次刻度计算 */
  const step = tickStepFor(width)
  const ticks: number[] = []
  for (let t = Math.ceil((viewStart - 1e-8) / step) * step; t <= viewEnd + 1e-8 && ticks.length < 14; t += step) ticks.push(round(t))
  const minorSubdivisions = step >= 1 ? 5 : 4
  const minorStep = step / minorSubdivisions
  const minorTicks: { time: number; mid: boolean }[] = []
  if (width > 0 && minorStep > 0) {
    const firstMajor = Math.floor(viewStart / step) * step
    for (let m = firstMajor; m <= viewEnd + step; m += step) {
      for (let sub = 1; sub < minorSubdivisions; sub++) {
        const mt = round(m + sub * minorStep)
        if (mt > viewStart + 1e-5 && mt < viewEnd - 1e-5 && minorTicks.length < 70) {
          minorTicks.push({ time: mt, mid: sub * 2 === minorSubdivisions })
        }
      }
    }
  }

  const spanStart = span ? Math.max(viewStart, span.start) : 0
  const spanEnd = span ? Math.min(viewEnd, span.end) : 0
  const playheadVisible = currentTime >= viewStart && currentTime <= viewEnd
  const playhead = playheadVisible ? <span className="wb-tl-playhead" style={{ left: `${pct(currentTime)}%` }} aria-hidden="true" /> : null

  return (
    <section
      className="wb-tl"
      data-pending={pending ? true : undefined}
      data-gutter={gutterWidth < 125 ? 'tight' : gutterWidth < 155 ? 'narrow' : undefined}
      aria-label="时间线"
      style={{ '--wb-tl-gutter': `${gutterWidth}px` } as CSSProperties}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement | null
        if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
        if ((e.key === '=' || e.key === '+') && !unavailable) { e.preventDefault(); setZoomTo(zoom * 1.5); return }
        if ((e.key === '-' || e.key === '_') && !unavailable) { e.preventDefault(); setZoomTo(zoom / 1.5); return }
        if (e.key === '0' && !unavailable) { e.preventDefault(); setStart(0); setZoom(1); return }
        if (e.key !== 'Escape') return
        e.preventDefault()
        if (cancelDrag()) return
        if (pickedId) { setPickedId(null); return }
        if (span && !unavailable) onClear()
      }}
    >
      {/* ── 1. 顶栏工具条（高 44px） ── */}
      <div className="wb-tl-head">
        {/* 左侧：时间线标题 + 时码读数 + 逐帧 + 选区（紧密靠拢，组间留 12-16px 呼吸间距，不加额外底框） */}
        <div className="wb-tl-head-left">
          <span className="wb-tl-title">时间线</span>
          <div className="wb-tl-readout">
            <span className="wb-tl-time-current">{formatTimecode(currentTime, true)}</span>
            <span className="wb-tl-sep">/</span>
            <span className="wb-tl-total">{formatTimecode(limit, true)}</span>
          </div>

          {/* 逐帧定位：紧贴时间读数 */}
          <div className="wb-tl-frame-step" role="group" aria-label="逐帧定位">
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="wb-tl-icon" aria-label="上一帧" disabled={unavailable || !frameFps || currentTime <= 0} onClick={() => stepFrame(-1)}>
                  <MediaIcon name="chevronLeft" size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{unavailable ? opsDisabledReason : frameFps ? '上一帧' : '帧率未知'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="wb-tl-icon" aria-label="下一帧" disabled={unavailable || !frameFps || currentTime >= limit} onClick={() => stepFrame(1)}>
                  <MediaIcon name="chevronRight" size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{unavailable ? opsDisabledReason : frameFps ? '下一帧' : '帧率未知'}</TooltipContent>
            </Tooltip>
          </div>

          {/* 选区范围标记：紧接逐帧 */}
          <div className="wb-tl-range-markers" role="group" aria-label="设置选区范围">
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="wb-tl-icon" aria-label="设为选区起点" disabled={unavailable || currentTime >= limit - 0.05} onClick={() => markBoundary('start')}>
                  <ChevronFirst size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{unavailable ? opsDisabledReason : '设为选区起点 ['}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="wb-tl-icon" aria-label="设为选区终点" disabled={unavailable || currentTime <= 0.05} onClick={() => markBoundary('end')}>
                  <ChevronLast size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{unavailable ? opsDisabledReason : '设为选区终点 ]'}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* 中间：选中状态或默认操作（位置稳定，选中时展示“引用给 AI”，未选中时自然留白，不漂移浮动） */}
        <div className="wb-tl-head-center">
          {picked ? (
            <div className="wb-tl-focus-pill" role="status">
              <span className="wb-tl-focus-label">已选</span>
              <span className="wb-tl-focus-name" title={picked.name}>{picked.name}</span>
              <span className="wb-tl-focus-range">{formatTimecode(picked.start, true)}–{formatTimecode(picked.start + picked.duration, true)}</span>
              {tracksVerified && (trackClipCapability?.allowed ?? true) ? (
                <button
                  type="button"
                  className="wb-tl-action-btn primary"
                  disabled={unavailable}
                  onClick={() => pickedTrack && onClipReference?.(picked, pickedTrack)}
                >
                  引用给 AI
                </button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="wb-tl-ref-tag" tabIndex={0}>参考</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {trackClipCapability && !trackClipCapability.allowed
                      ? trackClipCapability.reason
                      : '当前轨道尚未确认与当前版本对应，仅支持时间与内容定位'}
                  </TooltipContent>
                </Tooltip>
              )}
              <button type="button" className="wb-tl-icon sm" aria-label="取消选择" onClick={() => setPickedId(null)}>
                <XMark size={14} />
              </button>
            </div>
          ) : span ? (
            <div className="wb-tl-focus-pill" role="status">
              <span className="wb-tl-focus-label">选区</span>
              <span className="wb-tl-focus-range">{formatTimecode(span.start, true)}–{formatTimecode(span.end, true)}</span>
              <button
                type="button"
                className="wb-tl-action-btn primary"
                disabled={unavailable}
                onClick={() => {
                  /* 范围已通过 onSpanCommit 提交，此处点引用直接强化反馈 */
                }}
              >
                已选定范围
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="wb-tl-icon sm"
                    data-active={looping || undefined}
                    aria-pressed={looping}
                    aria-label={looping ? '停止循环' : '循环选区'}
                    disabled={unavailable}
                    onClick={onToggleLoop}
                  >
                    <Repeat size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{looping ? '停止循环' : '循环选区'}</TooltipContent>
              </Tooltip>
              <button type="button" className="wb-tl-icon sm" aria-label="清除选区" onClick={onClear}>
                <XMark size={14} />
              </button>
            </div>
          ) : null}
        </div>

        {/* 右侧：缩放控制器 */}
        <div className="wb-tl-head-right">
          <div className="wb-tl-zoom" role="group" aria-label="缩放">
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="wb-tl-icon" aria-label="缩小时间线" disabled={unavailable || zoom <= 1.001} onClick={() => setZoomTo(zoom / 1.8)}>
                  <Minus size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{unavailable ? opsDisabledReason : '缩小'}</TooltipContent>
            </Tooltip>
            <input
              type="range"
              className="wb-tl-zoom-slider"
              aria-label="缩放比例"
              min={1}
              max={Math.max(1, maxZoom)}
              step="any"
              value={zoom}
              disabled={unavailable || maxZoom <= 1}
              onChange={(e) => setZoomTo(Number(e.target.value))}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="wb-tl-icon" aria-label="放大时间线" disabled={unavailable || zoom >= maxZoom - 0.001} onClick={() => setZoomTo(zoom * 1.8)}>
                  <Plus size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{unavailable ? opsDisabledReason : '放大'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="wb-tl-icon" aria-label="适应整片" disabled={unavailable || zoom <= 1.001} onClick={() => { setStart(0); setZoom(1) }}>
                  <Scan size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{unavailable ? opsDisabledReason : '适应整片 (重置缩放)'}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* ── 2. 待确认修改浮层（若存在，浮在顶部通知，不挤压内容） ── */}
      {pending && (
        <div className="wb-tl-pending" role="status">
          <div className="wb-tl-pending-copy">
            <strong>{pending.label ? `待交给 AI · ${pending.label}` : '待交给 AI 修改'}</strong>
            <span title={pending.brief}>{pending.brief}</span>
          </div>
          <button type="button" className="wb-tl-pending-drop" onClick={onPendingDrop}>取消</button>
          <button type="button" className="wb-tl-pending-go" onClick={onPendingAccept}>交给 AI</button>
        </div>
      )}

      {/* ── 3. 主工作区：左列轨道名栏 + 右列时间画布 ── */}
      <div className="wb-tl-workspace" ref={workspace} data-disabled={unavailable || undefined}>
        {/* 轨道名栏可调宽度分割线 */}
        <div
          className="wb-tl-gutter-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整轨道名宽度"
          aria-valuenow={gutterWidth}
          aria-valuemin={110}
          aria-valuemax={260}
          tabIndex={0}
          style={{ left: `${gutterWidth - 4}px` }}
          onPointerDown={beginGutterDrag}
          onPointerMove={moveGutterDrag}
          onPointerUp={endGutterDrag}
          onPointerCancel={endGutterDrag}
          onDoubleClick={() => setGutterWidth(144)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            e.stopPropagation()
            setGutterWidth((w) => Math.round(Math.min(260, Math.max(110, w + (e.key === 'ArrowLeft' ? -8 : 8)))))
          }}
        />

        {/* 标尺行（高 28px）：左侧“内容 参考 ⓘ”，右侧主次刻度标尺 */}
        <div className="wb-tl-grid wb-tl-ruler-row">
          <div className="wb-tl-ruler-meta">
            <span className="wb-tl-meta-title">内容</span>
            {tracks.length > 0 && !tracksVerified && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="wb-tl-ref-badge" tabIndex={0} role="status">
                    参考 <HelpCircle size={12} className="inline ml-0.5 opacity-70" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>这些轨道尚未确认与当前版本对应，可浏览和定位。</TooltipContent>
              </Tooltip>
            )}
            {frameFps && <small className="wb-tl-fps-label">{frameFps} fps</small>}
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
              onSeek(timeAt(e.clientX))
            }}
            onPointerMove={(e) => {
              if (!unavailable && e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(timeAt(e.clientX))
            }}
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

        {/* 缩略帧带（高 28px）：与标尺及轨道严格同起点、16:9 裁切展示画面，移除独立缩略帧标签 */}
        <div className="wb-tl-grid wb-tl-ruler-film">
          <div className="wb-tl-film-meta" aria-hidden="true" />
          <div className="wb-tl-lane">
            <div
              ref={track}
              className="wb-tl-track"
              onPointerDown={begin}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={cancelDrag}
              onLostPointerCapture={cancelDrag}
            >
              <div className="wb-tl-film-window">
                <div
                  className="wb-tl-film-position"
                  style={{ width: `${(limit / (width || 1)) * 100}%`, left: `${(-viewStart / (width || 1)) * 100}%` }}
                >
                  <Filmstrip key={videoUrl} src={videoUrl} duration={limit} />
                </div>
              </div>
              {/* 缩略条中的选区指示 */}
              {span && spanEnd > spanStart && (
                <div
                  className="wb-tl-range"
                  data-looping={looping || undefined}
                  style={{ left: `${pct(spanStart)}%`, width: `${pct(spanEnd) - pct(spanStart)}%` }}
                >
                  {(['start', 'end'] as const).map((edge) =>
                    span[edge] >= viewStart && span[edge] <= viewEnd ? (
                      <button
                        key={edge}
                        type="button"
                        className="wb-tl-handle"
                        data-edge={edge}
                        disabled={unavailable}
                        role="slider"
                        aria-label={edge === 'start' ? '选区开始' : '选区结束'}
                        aria-valuemin={edge === 'start' ? 0 : span.start}
                        aria-valuemax={edge === 'start' ? span.end : limit}
                        aria-valuenow={span[edge]}
                        aria-valuetext={formatTimecode(span[edge], true)}
                        onKeyDown={(e) => keyHandle(e, edge)}
                      />
                    ) : null,
                  )}
                </div>
              )}
              {playhead}
            </div>
          </div>
        </div>

        {/* ── 4. 轨道行容器（多轨时内部纵向滚动） ── */}
        <div className="wb-tl-rows" tabIndex={0} role="region" aria-label="轨道列表">
          {/* 贯穿全轨的时间选区高亮底带 */}
          {span && spanEnd > spanStart && (
            <span
              className="wb-tl-span-layer"
              style={{
                left: `calc(var(--wb-tl-gutter) + (100% - var(--wb-tl-gutter)) * ${pct(spanStart) / 100})`,
                width: `calc((100% - var(--wb-tl-gutter)) * ${(pct(spanEnd) - pct(spanStart)) / 100})`,
              }}
              aria-hidden="true"
            />
          )}

          {/* 无轨道清单状态 */}
          {tracks.length === 0 && !unavailable && (
            <div className="wb-tl-empty" role="status">
              {trackStatus || '当前版本暂无可识别的轨道'}，仍可选择时间范围
            </div>
          )}

          {/* 各轨道行（默认每轨 44px） */}
          {tracks.map((tItem) => {
            const parts = tItem.name.split(/\s*[·・]\s*/, 2)
            const trackCode = parts.length > 1 ? parts[0] : ''
            const trackName = parts.length > 1 ? parts[1] : tItem.name
            const visualKind = trackVisualKind(tItem)
            const TrackIconComp = TRACK_ICON[visualKind]
            const collapsed = collapsedIds.has(tItem.id)

            return (
              <div
                className="wb-tl-grid wb-tl-row wb-tl-row-track"
                key={tItem.id}
                data-visual={visualKind}
                data-collapsed={collapsed || undefined}
                data-active={tItem.clips.some((clip) => clipKey(tItem.id, clip.id) === pickedId) || undefined}
              >
                {/* 轨道头：折叠箭头 → 类型图标 → 轨道名称 → 次要代号 */}
                <div className="wb-tl-gutter" title={`${tItem.name} · ${tItem.clips.length} 个片段`}>
                  <button
                    type="button"
                    className="wb-tl-track-fold"
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? `展开${trackName}` : `折叠${trackName}`}
                    onClick={() => setCollapsedIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(tItem.id)) next.delete(tItem.id)
                      else next.add(tItem.id)
                      return next
                    })}
                  >
                    <ChevronRight size={12} className={`wb-tl-fold-arrow ${collapsed ? '' : 'is-expanded'}`} />
                  </button>

                  <span className="wb-tl-track-type-icon" aria-hidden="true">
                    <TrackIconComp size={14} />
                  </span>

                  <span className="wb-tl-track-name">{trackName}</span>

                  {trackCode && <span className="wb-tl-track-code">{trackCode}</span>}

                  {/* 仅在多片段轨道上提供紧凑提示 */}
                  {tItem.clips.length > 1 && (
                    <span className="wb-tl-track-count" title={`${tItem.clips.length} 个片段`}>
                      {tItem.clips.length}
                    </span>
                  )}
                </div>

                {/* 轨道槽与片段块 */}
                <div className="wb-tl-lane">
                  {collapsed ? null : tItem.clips.map((clip) => {
                    const key = clipKey(tItem.id, clip.id)
                    const shownStart = clip.start
                    const shownDuration = clip.duration
                    const left = Math.max(shownStart, viewStart)
                    const right = Math.min(shownStart + shownDuration, viewEnd)
                    if (right <= left) return null
                    const hasSpecialIcon = clip.kind === 'text' || clip.kind === 'audio'
                    const ClipIcon = KIND_ICON[clip.kind]
                    const clipWidthPct = pct(right) - pct(left)

                    return (
                      <button
                        key={clip.id}
                        type="button"
                        className="wb-tl-clip"
                        style={{ left: `${pct(left)}%`, width: `${clipWidthPct}%` }}
                        title={`${clip.name} (${formatTimecode(clip.start, true)}–${formatTimecode(clip.start + clip.duration, true)})`}
                        disabled={unavailable}
                        data-kind={clip.kind}
                        data-picked={pickedId === key || undefined}
                        aria-pressed={pickedId === key}
                        onClick={() => {
                          setPickedId(key)
                          onSeek(clip.start)
                        }}
                      >
                        {/* 优先突出 12px 内容名称，类型已在轨道头明确表达；仅在特殊素材且空间充裕时展示小图标 */}
                        {hasSpecialIcon && clipWidthPct >= 10 && (
                          <span className="wb-tl-clip-icon">
                            <ClipIcon size={12} />
                          </span>
                        )}
                        <span className="wb-tl-clip-name">{clip.name}</span>
                      </button>
                    )
                  })}
                  {playhead}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 5. 底部安静平移导航条（高 14px） ── */}
      <div
        ref={panBar}
        className="wb-tl-pan"
        role="slider"
        tabIndex={unavailable || zoom <= 1.001 ? -1 : 0}
        aria-label="平移时间线"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, limit - width)}
        aria-valuenow={viewStart}
        aria-disabled={unavailable || zoom <= 1.001}
        data-disabled={unavailable || zoom <= 1.001 || undefined}
        onPointerDown={beginPanThumb}
        onPointerMove={movePanThumb}
        onPointerUp={endPanThumb}
        onPointerCancel={endPanThumb}
        onKeyDown={(e) => {
          if (unavailable || zoom <= 1.001) return
          const delta = width * (e.shiftKey ? 0.8 : 0.1)
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setStart(clamp(viewStart - delta, 0, limit - width))
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setStart(clamp(viewStart + delta, 0, limit - width))
          else if (e.key === 'Home') setStart(0)
          else if (e.key === 'End') setStart(limit - width)
          else return
          e.preventDefault()
        }}
      >
        <span
          className="wb-tl-pan-thumb"
          style={{
            left: `calc((100% - max(16px, ${limit ? width / limit * 100 : 100}%)) * ${limit > width ? viewStart / (limit - width) : 0})`,
            width: `max(16px, ${limit ? width / limit * 100 : 100}%)`,
          }}
        />
      </div>
    </section>
  )
}

export default WorkbenchTimeline

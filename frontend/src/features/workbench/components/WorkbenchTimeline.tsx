import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
/* 时间轨道图标全部用 lucide（第三轮统一）：选区起止用 |< >|，与原 phosphor CaretLine 语义一致。 */
import { formatTimecode } from '@/features/workbench/model/timeRange'
import { sequenceClipKey as clipKey, type SequenceEntry, type SequenceTrack } from '@/features/workbench/model/sequenceManifest'
import type { CapabilityResult } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import '@/features/workbench/styles/workbench-timeline.css'
import { TimelineHead } from '@/features/workbench/components/timeline/TimelineHead'
import { clamp } from '@/features/workbench/components/timeline/timelineDisplay'
import { TimelineRows } from '@/features/workbench/components/timeline/TimelineRows'
import { TimelineRuler } from '@/features/workbench/components/timeline/TimelineRuler'
import { HoverFrame } from '@/features/workbench/components/timeline/HoverFrame'
import {
  adjacentCut, categoryOf, cutPoints, defaultCollapsed, elementsInSpan, groupTracks, prominentClipAt, searchClips, snapTo,
  type SpanElement, type TrackGroup,
} from '@/features/workbench/model/timelineGroups'

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
  /** 画面上选中的元素出现的时间段：只画一条标记，不当成修改选区 */
  marker?: { start: number; end: number; label: string } | null
  /** 点了轨道上的某个片段（定位之外的额外动作，例如实时模式下在画面里选中这个元素）；at = 想看的那一刻（秒） */
  onClipPick?: (clip: SequenceEntry, track: SequenceTrack, at?: number) => void
  /** 外部要求选中的片段（画面里选中元素时，高亮它在元素轨上的那一段）；clipKey(轨道, 片段) */
  externalPick?: string | null
  /** 轨道区标题旁的一句说明（例如「正在采集元素轨」） */
  note?: string
  /** 记住各类别抽屉收起 / 展开的键（按项目） */
  persistKey?: string
  /** 改过的元素（源码位置），轨道上打点标出 */
  changed?: ReadonlySet<string>
  onClearChanges?: () => void
  /** 把时间选区连同里面的元素交给 AI（实时模式） */
  onSpanAsk?: (prompt: string) => Promise<boolean>
  askBusy?: boolean
  /** 悬停预览画面的来源说明（实时模式下是「上次出片」） */
  previewNote?: string
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
const round = (v: number) => Math.round(v * 1000) / 1000
const NO_TRACKS: SequenceTrack[] = []
const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
/** 刻度步长：按轨道区实际宽度定刻度数（每个时码至少留 58px），窄面板上不会叠字 */
const tickStepFor = (visible: number, maxTicks = 7) => TICK_STEPS.find((s) => visible / s <= maxTicks) ?? 7200
const TICK_MIN_PX = 58
/** 轨道名栏默认宽度：放得下「图片与视频 3 轨 · 12 个」 */
const GUTTER_DEFAULT = 184
/** 拖动 / 点击离切点这么近（像素）就贴上去 */
const SNAP_PX = 6

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
  videoUrl, duration, currentTime, fps, tracks: tracksProp = NO_TRACKS, span, disabled, looping, maxZoom,
  onSeek, onSpanChange, onSpanCommit, onClear, onToggleLoop, pending, onPendingAccept, onPendingDrop, onClipReference, trackStatus, tracksVerified = false,
  timelineOpsCapability, trackClipCapability, marker, onClipPick, externalPick, note,
  persistKey, changed, onClearChanges, onSpanAsk, askBusy, previewNote,
}: WorkbenchTimelineProps) {
  const track = useRef<HTMLDivElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  const panBar = useRef<HTMLDivElement>(null)
  const panThumbDrag = useRef<{ pointerId: number; x: number; start: number } | null>(null)
  const drag = useRef<Drag | null>(null)

  const [pickedId, setPickedId] = useState<string | null>(null)
  /* 画面里选中了元素：轨道上跟着高亮它那一段（渲染期间比对，不用 effect） */
  const [externalSeen, setExternalSeen] = useState(externalPick ?? null)
  if ((externalPick ?? null) !== externalSeen) {
    setExternalSeen(externalPick ?? null)
    if (externalPick) setPickedId(externalPick)
  }
  /* 抽屉收起 / 展开：用户点过的按项目记住，没点过的按默认规则（场景展开，超过 2 条轨的收起） */
  const storeKey = persistKey ? `fm-tl-groups:${persistKey}` : null
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>(() => {
    try { return storeKey ? JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Record<string, boolean> : {} } catch { return {} }
  })
  const setCollapsedFor = (category: string, collapsed: boolean) => setGroupCollapsed((prev) => {
    const next = { ...prev, [category]: collapsed }
    try { if (storeKey) localStorage.setItem(storeKey, JSON.stringify(next)) } catch { /* 存不下就只在这次有效 */ }
    return next
  })
  const [query, setQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(-1)
  const searchInput = useRef<HTMLInputElement>(null)
  /* 悬停在标尺 / 缩略帧带上：浮出那一帧 */
  const [hover, setHover] = useState<{ time: number; ratio: number } | null>(null)
  const [gutterWidth, setGutterWidth] = useState(GUTTER_DEFAULT)
  const gutterDrag = useRef<{ x: number; w: number } | null>(null)

  const beginGutterDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    gutterDrag.current = { x: e.clientX, w: gutter }
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
  /* 没有轨道清单时只有一条成片轨（不改传进来的 tracks：后面的 useMemo 都依赖它保持不变） */
  const tracks = useMemo<SequenceTrack[]>(() => (tracksProp.length || !(limit > 0) ? tracksProp : [{ id: 'composition', name: '成片', clips: [
    { id: 'composition', name: '成片', kind: 'video', start: 0, duration: limit },
  ] }]), [tracksProp, limit])
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
  /* 切点：所有片段的起止。拖动、点击时靠近就吸上去，按住 Shift 不吸 */
  const points = useMemo(() => cutPoints(tracks, limit), [tracks, limit])
  const snapAt = (clientX: number, free: boolean) => {
    const t = timeAt(clientX)
    const px = track.current?.getBoundingClientRect().width ?? 0
    if (free || !px || !points.length) return t
    return snapTo(points, t, (SNAP_PX / px) * width)
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
    drag.current = { pointerId: e.pointerId, kind, anchor: snapAt(e.clientX, e.shiftKey), x: e.clientX, original: span, moved: false, viewStart, viewWidth: width }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e: PointerEvent<HTMLDivElement>) => {
    hoverAt(e.clientX)
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (Math.abs(e.clientX - d.x) >= 3) d.moved = true
    if (d.moved) onSpanChange(nextSpan(d, snapAt(e.clientX, e.shiftKey)))
  }

  const finish = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const time = snapAt(e.clientX, e.shiftKey)
    if (!d.moved) {
      if (d.kind === 'create') onSeek(time)
      return
    }
    const next = nextSpan(d, time)
    /* 拉出了时间选区：顶栏改显示选区（和里面的元素），不再显示之前点的片段 */
    if (next.end > next.start) { setPickedId(null); onSpanChange(next); onSpanCommit(next) } else onSpanChange(d.original)
  }

  const markBoundary = (edge: 'start' | 'end') => {
    const time = round(clamp(currentTime, 0, limit))
    const next = edge === 'start'
      ? { start: time, end: span && span.end > time + 0.05 ? span.end : limit }
      : { start: span && span.start < time - 0.05 ? span.start : 0, end: time }
    if (next.end - next.start >= Math.min(0.05, limit)) { setPickedId(null); onSpanChange(next); onSpanCommit(next) }
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

  const groups = useMemo(() => groupTracks(tracks), [tracks])
  /* 搜索：命中的片段按时间排；有命中的抽屉自动展开 */
  const hits = useMemo(() => (query.trim() ? searchClips(tracks, query) : null), [tracks, query])
  const hitKeys = useMemo(() => (hits ? new Set(hits.map((h) => clipKey(h.track.id, h.clip.id))) : null), [hits])
  const hitCats = useMemo(() => new Set(hits?.map((h) => categoryOf(h.track)) ?? []), [hits])
  const isCollapsed = (g: TrackGroup) => !hitCats.has(g.category) && (groupCollapsed[g.category] ?? defaultCollapsed(g))

  /** 视野外的时间拉进视野（放大时跳到别处用） */
  const reveal = (t: number) => {
    if (t >= viewStart && t <= viewEnd) return
    setStart(clamp(t - width * 0.2, 0, Math.max(0, limit - width)))
  }
  const pickClip = (clip: SequenceEntry, row: SequenceTrack, at?: number) => {
    setPickedId(clipKey(row.id, clip.id))
    const t = at ?? clip.start
    onSeek(t)
    reveal(t)
    onClipPick?.(clip, row, at)
  }
  /* 跳到某个片段时它所在的抽屉要打开，不然选中了也看不见 */
  const pickAndOpen = (clip: SequenceEntry, row: SequenceTrack) => {
    const g = groups.find((x) => x.tracks.includes(row))
    if (g && isCollapsed(g)) setCollapsedFor(g.category, false)
    pickClip(clip, row)
  }
  const stepSearch = (direction: -1 | 1) => {
    if (!hits?.length) return
    const next = ((searchIndex < 0 && direction < 0 ? 0 : searchIndex) + direction + hits.length) % hits.length
    setSearchIndex(next)
    pickClip(hits[next].clip, hits[next].track)
  }
  const cutPrev = adjacentCut(points, currentTime, -1)
  const cutNext = adjacentCut(points, currentTime, 1)
  const goCut = (direction: -1 | 1) => {
    const t = direction < 0 ? cutPrev : cutNext
    if (t === null || unavailable) return
    onSeek(t)
    reveal(t)
  }
  /* 改动：同一元素多段只算一处；「下一处」从播放头往后找，到头了回到开头 */
  const changedClips = (within: SequenceTrack[]) => {
    const out: { clip: SequenceEntry; track: SequenceTrack }[] = []
    if (!changed?.size) return out
    for (const row of within) for (const clip of row.clips) if (clip.src && changed.has(clip.src)) out.push({ clip, track: row })
    return out.sort((a, b) => a.clip.start - b.clip.start)
  }
  const jumpChange = (within: SequenceTrack[]) => {
    const list = changedClips(within)
    if (!list.length) return
    const hit = list.find((x) => x.clip.start > currentTime + 0.02) ?? list[0]
    pickAndOpen(hit.clip, hit.track)
  }
  const changedCount = new Set(changedClips(tracks).map((x) => x.clip.src)).size
  const spanElements = useMemo(() => (span ? elementsInSpan(tracks, span) : []), [tracks, span])
  const pickSpanElement = (el: SpanElement) => {
    for (const row of tracks) for (const clip of row.clips) {
      if (el.src ? clip.src !== el.src : clip.name !== el.name || categoryOf(row) !== el.category) continue
      if (clip.start + clip.duration <= (span?.start ?? 0) || clip.start >= (span?.end ?? limit)) continue
      const at = span ? clamp(span.start, clip.start, clip.start + clip.duration - 1e-3) : undefined
      const g = groups.find((x) => x.tracks.includes(row))
      if (g && isCollapsed(g)) setCollapsedFor(g.category, false)
      pickClip(clip, row, at)
      return
    }
  }
  /** 双击片段：把视野放大到正好看清这一段 */
  const zoomToClip = (clip: SequenceEntry) => {
    if (unavailable || maxZoom <= 1 || !(clip.duration > 0)) return
    const pad = Math.max(clip.duration * 0.15, frameFps ? 2 / frameFps : 0.05)
    const next = clamp(limit / (clip.duration + pad * 2), 1, Math.max(1, maxZoom))
    const nextWidth = limit / next
    setStart(clamp(clip.start + clip.duration / 2 - nextWidth / 2, 0, Math.max(0, limit - nextWidth)))
    setZoom(next)
  }
  const hoverAt = (clientX: number | null) => {
    const rect = track.current?.getBoundingClientRect()
    if (clientX === null || !rect?.width || !videoUrl) { setHover(null); return }
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
    setHover({ time: clamp(viewStart + ratio * width, 0, limit), ratio })
  }

  /* 时间线和轨道区宽度：刻度密度、轨道名栏封顶都按它算 */
  const root = useRef<HTMLElement>(null)
  const [laneWidth, setLaneWidth] = useState(0)
  const [rootWidth, setRootWidth] = useState(0)
  useEffect(() => {
    const lane = track.current
    const box = root.current
    if (!lane || !box || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setLaneWidth(Math.round(lane.getBoundingClientRect().width))
      setRootWidth(Math.round(box.getBoundingClientRect().width))
    })
    ro.observe(lane)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])
  /* 轨道名栏最多占时间线的 34%：窄面板上把宽度让给轨道，拖宽的设置仍然记着 */
  const gutter = rootWidth ? Math.min(gutterWidth, Math.max(96, Math.round(rootWidth * 0.34))) : gutterWidth

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
  const step = tickStepFor(width, laneWidth ? Math.max(2, Math.min(7, Math.floor(laneWidth / TICK_MIN_PX))) : 7)
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
      ref={root}
      data-gutter={gutter < 125 ? 'tight' : gutter < 155 ? 'narrow' : undefined}
      aria-label="时间线"
      style={{ '--wb-tl-gutter': `${gutter}px` } as CSSProperties}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement | null
        if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
        if ((e.key === '=' || e.key === '+') && !unavailable) { e.preventDefault(); setZoomTo(zoom * 1.5); return }
        if ((e.key === '-' || e.key === '_') && !unavailable) { e.preventDefault(); setZoomTo(zoom / 1.5); return }
        if (e.key === '0' && !unavailable) { e.preventDefault(); setStart(0); setZoom(1); return }
        if (e.key === '[' || e.key === ']') { e.preventDefault(); goCut(e.key === '[' ? -1 : 1); return }
        if ((e.key === 'i' || e.key === 'I') && !unavailable && !e.metaKey && !e.ctrlKey) { e.preventDefault(); markBoundary('start'); return }
        if ((e.key === 'o' || e.key === 'O') && !unavailable && !e.metaKey && !e.ctrlKey) { e.preventDefault(); markBoundary('end'); return }
        if (e.key === '/') { e.preventDefault(); searchInput.current?.focus(); return }
        if (e.key !== 'Escape') return
        e.preventDefault()
        if (cancelDrag()) return
        if (pickedId) { setPickedId(null); return }
        if (span && !unavailable) onClear()
      }}
    >
      {/* ── 1. 顶栏工具条（高 44px） ── */}
      <TimelineHead
        currentTime={currentTime}
        frameFps={frameFps}
        limit={limit}
        looping={looping}
        markBoundary={markBoundary}
        maxZoom={maxZoom}
        onClear={onClear}
        onClipReference={onClipReference}
        onToggleLoop={onToggleLoop}
        opsDisabledReason={opsDisabledReason}
        picked={picked}
        pickedTrack={pickedTrack}
        setPickedId={setPickedId}
        setStart={setStart}
        setZoom={setZoom}
        setZoomTo={setZoomTo}
        span={span}
        stepFrame={stepFrame}
        trackClipCapability={trackClipCapability}
        tracksVerified={tracksVerified}
        unavailable={unavailable}
        zoom={zoom}
        search={{
          query, count: hits?.length ?? 0, index: Math.max(0, searchIndex), step: stepSearch,
          setQuery: (q) => { setQuery(q); setSearchIndex(-1) },
        }}
        searchInput={searchInput}
        cut={{ prev: cutPrev, next: cutNext, go: goCut }}
        spanElements={spanElements}
        onSpanPick={pickSpanElement}
        onSpanAsk={onSpanAsk}
        askBusy={askBusy}
        changes={changedCount ? { count: changedCount, next: () => jumpChange(tracks), clear: () => onClearChanges?.() } : null}
      />

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
          aria-valuenow={gutter}
          aria-valuemin={110}
          aria-valuemax={260}
          tabIndex={0}
          style={{ left: `${gutter - 4}px` }}
          onPointerDown={beginGutterDrag}
          onPointerMove={moveGutterDrag}
          onPointerUp={endGutterDrag}
          onPointerCancel={endGutterDrag}
          onDoubleClick={() => setGutterWidth(GUTTER_DEFAULT)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            e.stopPropagation()
            setGutterWidth((w) => Math.round(Math.min(260, Math.max(110, w + (e.key === 'ArrowLeft' ? -8 : 8)))))
          }}
        />

        {/* 标尺行（高 28px）：左侧“内容 参考 ⓘ”，右侧主次刻度标尺 */}
        <TimelineRuler
          currentTime={currentTime}
          frameFps={frameFps}
          limit={limit}
          minorTicks={minorTicks}
          onSeek={onSeek}
          pct={pct}
          playheadVisible={playheadVisible}
          step={step}
          ticks={ticks}
          scrubAt={snapAt}
          onHover={hoverAt}
          tracks={tracks}
          tracksVerified={tracksVerified}
          unavailable={unavailable}
          note={note}
        />

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
              onPointerEnter={(e) => hoverAt(e.clientX)}
              onPointerLeave={() => hoverAt(null)}
            >
              <div className="wb-tl-film-window">
                <div
                  className="wb-tl-film-position"
                  style={{ width: `${(limit / (width || 1)) * 100}%`, left: `${(-viewStart / (width || 1)) * 100}%` }}
                >
                  <Filmstrip key={videoUrl} src={videoUrl} duration={limit} />
                </div>
              </div>
              {/* 选中元素出现的时间段：淡色底 + 两侧细线，元素名贴在左上 */}
              {marker && marker.end > viewStart && marker.start < viewEnd && (
                <div className="wb-tl-marker" aria-label={`${marker.label} 出现的时间段`}
                     style={{ left: `${pct(Math.max(viewStart, marker.start))}%`, width: `${pct(Math.min(viewEnd, marker.end)) - pct(Math.max(viewStart, marker.start))}%` }}>
                  <span>{marker.label}</span>
                </div>
              )}
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
        <TimelineRows
          groups={groups}
          isCollapsed={isCollapsed}
          onToggleGroup={(g) => setCollapsedFor(g.category, !isCollapsed(g))}
          fps={frameFps}
          pct={pct}
          pickedId={pickedId}
          pickedSrc={picked?.src ?? null}
          onClipActivate={(clip, row) => pickClip(clip, row)}
          onClipZoom={zoomToClip}
          onGroupPick={(g, t) => {
            const hit = prominentClipAt(g, t)
            if (!hit) { onSeek(t); return }
            const inside = t >= hit.clip.start && t < hit.clip.start + hit.clip.duration
            pickClip(hit.clip, hit.track, inside ? round(t) : undefined)
          }}
          matches={hitKeys}
          focusKey={hits && searchIndex >= 0 && hits[searchIndex] ? clipKey(hits[searchIndex].track.id, hits[searchIndex].clip.id) : null}
          changed={changed}
          onJumpChange={(g) => jumpChange(g.tracks)}
          playhead={playhead}
          span={span}
          spanEnd={spanEnd}
          spanStart={spanStart}
          trackStatus={trackStatus}
          unavailable={unavailable}
          viewEnd={viewEnd}
          viewStart={viewStart}
        />

        {hover && !unavailable && <HoverFrame src={videoUrl} time={hover.time} ratio={hover.ratio} fps={frameFps} note={previewNote} />}
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

import { useEffect, useRef, useState } from 'react'
import { GitCompareArrows, Maximize2, Pause, Play, X } from 'lucide-react'
import type { StageVisual } from '@/data/stageVisual'
import { containedMediaRect, formatMediaTime } from '@/data/previewGeometry'

/** Compare actual files at a shared time; never synthesize a before/after result. */
export function WorkbenchPreviewCompare({ left, right, initialTime, bbox, onClose, onDiscuss, onFocus, focused }: {
  left: StageVisual
  right: StageVisual
  /** 打开时对齐到的秒数：从「用户指的那一帧」打开，而不是从 0 开始 */
  initialTime?: number
  /** 用户框选的区域（归一化 0–1，相对媒体画面）：两侧画同一个框，保证看的是同一处 */
  bbox?: { x: number; y: number; w: number; h: number } | null
  onClose: () => void
  onFocus: () => void
  focused: boolean
  onDiscuss: (visual: StageVisual, seconds?: number) => void
}) {
  const videos = useRef<(HTMLVideoElement | null)[]>([null, null])
  const stills = useRef<(HTMLImageElement | null)[]>([null, null])
  const [durations, setDurations] = useState([0, 0])
  /* 缺省或 NaN 都退回原来的「从 0 开始」，调用方不必保证一定传值；
     秒数只对视频有意义 —— 图片没有可对齐的时间轴。 */
  const startAt = left.media === 'video' && typeof initialTime === 'number' && Number.isFinite(initialTime) ? Math.max(0, initialTime) : 0
  const [time, setTime] = useState(startAt)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const duration = Math.min(...durations)
  /* 共享时长要等两侧元数据都到齐才算得出来，所以对齐值可能先大于可播范围；
     到齐后钳一次，否则滑杆和「继续提意见」带上的秒数会指到素材之外。 */
  useEffect(() => { if (duration > 0) setTime((current) => Math.min(current, duration)) }, [duration])
  const pause = () => { videos.current.forEach((v) => v?.pause()); setPlaying(false) }
  const seek = (seconds: number) => { pause(); videos.current.forEach((v) => { if (v && v.readyState >= 1) v.currentTime = seconds }); setTime(seconds) }
  const play = async () => {
    if (playing) { pause(); return }
    if (time >= duration) seek(0)
    try { await Promise.all(videos.current.map((v) => v?.play())); setPlaying(true) } catch { pause(); setFailed(true) }
  }
  const tick = (media: HTMLVideoElement) => {
    if (media.currentTime >= duration) { pause(); setTime(duration); return }
    setTime(media.currentTime)
    const other = videos.current[1]
    if (other && Math.abs(other.currentTime - media.currentTime) > 0.12) other.currentTime = media.currentTime
  }
  /* 先说清「看的是哪一处」：区域框两侧画同一个，对齐值说明从哪一帧打开。
     只陈述已经发生的事，不写「已优化 / 已渲染」这类还没执行就宣称完成的话。 */
  const regionNote = bbox ? '两侧画的是同一个框选区域，用来确认比较的是同一处。' : ''
  const alignNote = startAt > 0 ? `已对齐到你指的那一帧（${formatMediaTime(startAt)}）。` : ''
  return <section className="wb-preview-compare" aria-label="真实预览同步对比">
    <header><div><GitCompareArrows size={16}/><span>同步对比</span><small>同一播放时间 · 原始文件</small></div><button type="button" className="wb-compare-focus" onClick={onFocus}><Maximize2 size={13}/>{focused ? '展开审阅' : '专注画面'}</button><button type="button" onClick={onClose} aria-label="关闭预览对比"><X size={17}/></button></header>
    <div className="wb-compare-pair">{[left, right].map((visual, index) => <figure key={`${index}:${visual.id}`}>
      <figcaption><span>{index === 0 ? 'A / 对照画面' : 'B / 本轮画面'}</span><b>{visual.name}</b><small>{visual.tierLabel} · {visual.origin==='editor'?'编辑版本':'工作流'} v{visual.revision}</small></figcaption>
      <div className="wb-compare-media">
        {visual.media === 'video' ? <video muted playsInline preload="metadata" src={visual.file} ref={(v) => { videos.current[index] = v }} onLoadedMetadata={(e) => {
          /* 打开时对齐到用户指的那一帧：readyState>=1 才设得进去（元数据没到就没有 duration）；
             initialTime 可能超过这一侧时长，按本侧自己的 duration 钳制 —— 共享时长仍取两侧较短值。 */
          const media = e.currentTarget
          const own = media.duration
          setDurations((old) => old.map((d, i) => (i === index ? (Number.isFinite(own) ? own : 0) : d)))
          if (startAt > 0 && media.readyState >= 1 && Number.isFinite(own)) media.currentTime = Math.min(startAt, own)
        }} onTimeUpdate={index === 0 ? (e) => tick(e.currentTarget) : undefined} onEnded={pause} onError={() => { pause(); setFailed(true) }}/> : <img src={visual.file} alt={`${index === 0 ? '对照' : '本轮'}：${visual.name}`} ref={(el) => { stills.current[index] = el }} onError={() => setFailed(true)}/>}
        {/* 两侧同一个 bbox 各画一次；tickSeconds 让播放/拖动时重算，框跟着真实媒体矩形走 */}
        {bbox && <CompareRegionBox media={visual.media === 'video' ? videos : stills} index={index} bbox={bbox} tickSeconds={time}/>}
      </div>
      <button type="button" onClick={() => { pause(); onDiscuss(visual, visual.media === 'video' ? time : undefined) }}>针对{index === 0 ? '对照' : '本轮'}画面继续提意见</button>
    </figure>)}</div>
    {failed ? <div className="wb-compare-error" role="alert">有画面加载或播放失败，请返回预览检查文件后重试。<button type="button" onClick={onClose}>返回预览</button></div> : left.media === 'video' && <div className="wb-compare-transport"><button type="button" onClick={() => void play()} disabled={!duration} aria-label={playing ? '暂停同步对比' : '播放同步对比'}>{playing ? <Pause size={17}/> : <Play size={17}/>}</button><time>{formatMediaTime(time)}</time><input type="range" aria-label="同步对比时间" min={0} max={duration || 0} step={0.001} value={Math.min(time, duration)} disabled={!duration} onChange={(e) => seek(Number(e.target.value))}/><time>{formatMediaTime(duration)}</time></div>}
    <p className="wb-compare-caption">{left.media === 'video' ? `同步到相同秒数，播放范围取两段视频的较短时长。${regionNote}${alignNote}不同剪辑的内容位置可能不同。` : `两张原始图片并排展示，保留各自画幅。${regionNote}`} <span>你的审阅结论与自动检查结果分别记录。</span></p>
  </section>
}

/* 两侧的区域框必须用同一套换算：先取真实媒体矩形（containedMediaRect 已排除 letterbox，
   用的是跟工作台意见引用框同一个 scale = Math.min(...) 居中裁边逻辑），再把归一化坐标乘进去。
   直接按容器百分比画，画面有黑边时框就会偏 —— 而这里要确认的正是「是不是同一处」。
   依赖 tickSeconds 是为了播放/拖动时重算位置。 */
function CompareRegionBox({ media, index, bbox: { x, y, w, h }, tickSeconds }: {
  media: React.RefObject<(HTMLVideoElement | HTMLImageElement | null)[]>; index: number; bbox: { x: number; y: number; w: number; h: number }; tickSeconds: number
}) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useEffect(() => {
    const element = media.current[index]
    const host = element?.parentElement
    if (!element || !host) return
    const measure = () => {
      const naturalWidth = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth
      const naturalHeight = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight
      const visible = containedMediaRect(element.getBoundingClientRect(), naturalWidth, naturalHeight)
      if (!visible) return
      const box = host.getBoundingClientRect()
      setRect({ left: visible.left - box.left + visible.width * x, top: visible.top - box.top + visible.height * y, width: visible.width * w, height: visible.height * h })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element); element.addEventListener('loadedmetadata', measure); element.addEventListener('load', measure); measure()
    return () => { observer.disconnect(); element.removeEventListener('loadedmetadata', measure); element.removeEventListener('load', measure) }
  }, [media, index, x, y, w, h, tickSeconds])
  /* 纯视觉：读屏由 caption 说明「两侧是同一个框选区域」，这里不重复念一遍坐标。 */
  return rect ? <div className="wb-compare-region" aria-hidden="true" style={rect}/> : null
}
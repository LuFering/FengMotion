import { useEffect, useState } from 'react'
import { MediaTransport } from '@/shared/components/MediaTransport'
import { type StageVisual } from '@/features/workbench/model/stageVisual'
import { containedMediaRect } from '@/features/workbench/model/previewGeometry'

export function StageFrame({ visual, mediaRef, onTime, onDuration, location, currentTime, onReady, onFailed, loopSpan }: { visual: StageVisual; mediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>; onTime: (time: number) => void; onDuration: (duration: number) => void; onReady: (ready: boolean) => void; onFailed?: (failed: boolean) => void; currentTime: number; loopSpan?: { start: number; end: number } | null; location?: { visualId: string; timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null }) {
  useEffect(() => {
    const media = mediaRef.current
    if (location?.visualId === visual.id && location.timeSeconds !== undefined && media instanceof HTMLVideoElement && media.readyState >= 1) {
      media.pause(); media.currentTime = Math.min(location.timeSeconds, media.duration); onTime(media.currentTime)
    }
  }, [location, visual.id, mediaRef, onTime])
  /* 循环区间拆成两个原始值：直接把对象放进依赖，父组件每次渲染给的新对象
     都会让 effect 重挂一次，播放时会反复取消、重建逐帧检查。 */
  const loopFrom = loopSpan?.start
  const loopTo = loopSpan?.end
  useEffect(() => {
    const media = mediaRef.current
    if (!(media instanceof HTMLVideoElement) || loopFrom === undefined || loopTo === undefined || loopTo <= loopFrom) return
    let frame = 0
    const tick = () => {
      if (media.paused || media.ended) return
      if (media.currentTime >= loopTo) media.currentTime = loopFrom
      frame = requestAnimationFrame(tick)
    }
    const start = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(tick) }
    const stop = () => cancelAnimationFrame(frame)
    const ended = () => { media.currentTime = loopFrom; void media.play().catch(() => undefined) }
    media.addEventListener('play', start)
    media.addEventListener('pause', stop)
    media.addEventListener('ended', ended)
    if (!media.paused) start()
    return () => { stop(); media.removeEventListener('play', start); media.removeEventListener('pause', stop); media.removeEventListener('ended', ended) }
  }, [mediaRef, visual.id, loopFrom, loopTo])
  const [failed, setFailed] = useState(false)
  const [aspectRatio, setAspectRatio] = useState(16 / 9)
  if (failed) return <div className="fw-mon-empty"><div className="fw-mon-empty-title">{visual.tierLabel}暂时无法播放</div><p className="fw-mon-empty-sub">文件可能已移动或连接中断。</p><button type="button" className="wb-media-retry" onClick={() => { setFailed(false); onFailed?.(false) }}>重新加载预览</button></div>
  return <>{visual.media === 'video' ? <div className="wb-videojs-skin wb-stage-film" style={{ '--wb-video-ratio': aspectRatio } as React.CSSProperties}>
      {/* 原 Video.js 皮肤自带整套控件（与时间线顶栏、实时播放条并存三套），换共享播放条（打磨方案 §5 第 2 条）。
          类名 wb-videojs-skin 保留：stage-card.css 靠它按视频比例定尺寸 */}
      <video ref={(el) => { mediaRef.current = el }} className="fw-stage-media" crossOrigin="anonymous" src={visual.file} playsInline onLoadedData={() => { onReady(true); onFailed?.(false) }} onTimeUpdate={(e) => { const media = e.currentTarget
        /* timeupdate 作为后台节流时的补充，播放中的短选区由逐帧检查处理。 */
        if (loopSpan && loopSpan.end > loopSpan.start && media.currentTime >= loopSpan.end) {
          media.currentTime = loopSpan.start
          onTime(loopSpan.start)
          return
        }
        onTime(media.currentTime) }} onLoadedMetadata={(e) => { const media = e.currentTarget; if (media.videoWidth && media.videoHeight) setAspectRatio(media.videoWidth / media.videoHeight); onDuration(media.duration); const seconds = location?.visualId === visual.id ? location.timeSeconds ?? 0 : 0; media.currentTime = Math.min(seconds, media.duration); onTime(media.currentTime) }} onError={() => { onReady(false); onDuration(0); setFailed(true); onFailed?.(true) }}/>
      <span className="wb-stage-label">画面预览</span>
      <MediaTransport mediaRef={mediaRef as React.RefObject<HTMLMediaElement | null>} mediaKey={visual.file} className="wb-stage-transport" />
    </div> : <img ref={(el) => { mediaRef.current = el }} className="fw-stage-media" crossOrigin="anonymous" src={visual.file} alt={visual.tierLabel} onLoad={() => { onReady(true); onFailed?.(false) }} onError={() => { onReady(false); onDuration(0); setFailed(true); onFailed?.(true) }}/>}{location?.visualId === visual.id && location.bbox && (visual.media === 'image' || location.timeSeconds === undefined || Math.abs(currentTime - location.timeSeconds) < 0.08) && <PreviewTargetHighlight mediaRef={mediaRef} bbox={location.bbox}/>}</>
}

export function PreviewTargetHighlight({ mediaRef, bbox }: { mediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>; bbox: { x: number; y: number; w: number; h: number } }) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useEffect(() => {
    const media = mediaRef.current
    const parent = media?.closest('.fw-stage-frame')
    if (!media || !parent) return
    const measure = () => {
      const naturalWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
      const naturalHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
      const visible = containedMediaRect(media.getBoundingClientRect(), naturalWidth, naturalHeight)
      const host = parent.getBoundingClientRect()
      if (visible) setRect({ left: visible.left - host.left + visible.width * bbox.x, top: visible.top - host.top + visible.height * bbox.y, width: visible.width * bbox.w, height: visible.height * bbox.h })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(media); media.addEventListener('loadedmetadata', measure); media.addEventListener('load', measure); measure()
    return () => { observer.disconnect(); media.removeEventListener('loadedmetadata', measure); media.removeEventListener('load', measure) }
  }, [mediaRef, bbox])
  return rect ? <div className="wb-reference-highlight" role="img" aria-label="本条意见引用的画面区域" style={rect}><span>意见引用区域</span></div> : null
}

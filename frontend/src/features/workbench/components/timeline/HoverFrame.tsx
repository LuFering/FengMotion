import { useEffect, useRef, useState } from 'react'
import { clipTime } from '@/features/workbench/components/timeline/timelineDisplay'

/**
 * 标尺 / 缩略帧带上悬停时浮出的那一帧：不用先点过去，就能看到那里是什么画面。
 *
 * <p>画面来自出片的视频（一个看不见的 video 元素跳到那个时间再画到画布上），
 * 实时模式下源码可能已经改过，所以标上「上次出片」，不冒充当前画面。</p>
 */
export function HoverFrame({ src, time, ratio, fps, note }: { src: string; time: number; ratio: number; fps: number | undefined; note?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const [ready, setReady] = useState(false)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    if (!src) return
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.src = src
    v.onloadeddata = () => setReady(true)
    v.onseeked = () => {
      const c = canvas.current
      try { c?.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height); setDrawn(true) } catch { /* 跨域等原因画不了就只显示时间 */ }
    }
    video.current = v
    return () => {
      v.onloadeddata = null
      v.onseeked = null
      v.removeAttribute('src')
      v.load()
      video.current = null
      setReady(false)
      setDrawn(false)
    }
  }, [src])

  /* 鼠标划得快时只跟最后一个位置：每次跳转都要解码，排队跳会越拖越慢 */
  useEffect(() => {
    const v = video.current
    if (!v || !ready) return
    const timer = window.setTimeout(() => {
      try { v.currentTime = Math.min(Math.max(0, time), Math.max(0, (v.duration || time) - 0.04)) } catch { /* noop */ }
    }, 40)
    return () => window.clearTimeout(timer)
  }, [time, ready])

  return (
    <div
      className="wb-tl-hover-frame"
      aria-hidden="true"
      style={{ left: `calc(var(--wb-tl-gutter) + (100% - var(--wb-tl-gutter)) * ${ratio})` }}
      data-edge={ratio < 0.12 ? 'start' : ratio > 0.88 ? 'end' : undefined}
    >
      <div className="wb-tl-hover-shot" data-empty={!drawn || undefined}>
        <canvas ref={canvas} width={192} height={108} />
        {note && <span className="wb-tl-hover-note">{note}</span>}
      </div>
      <span className="wb-tl-hover-time">{clipTime(time, fps)}</span>
    </div>
  )
}

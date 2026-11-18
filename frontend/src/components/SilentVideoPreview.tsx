import { useEffect, useRef, useState } from 'react'

/** 静音预览只在可见且启用时解码；离开页面或关闭预览立即暂停。 */
export function SilentVideoPreview({ src, poster, active = true, label, mountOnlyWhenActive = false, showFailure = false }: {
  src: string | null
  poster?: string
  active?: boolean
  label: string
  mountOnlyWhenActive?: boolean
  showFailure?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(false)
  const [pageVisible, setPageVisible] = useState(!document.hidden)
  const [failed, setFailed] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => { setFailed(false); setReady(false) }, [src])
  useEffect(() => { setPosterFailed(false) }, [poster])
  useEffect(() => { if (!active) setReady(false) }, [active])
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.08 })
    if (host.current) observer.observe(host.current)
    const onVisibility = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [])
  const shouldPlay = active && visible && pageVisible && !failed
  useEffect(() => {
    const el = video.current
    if (!el) return
    if (shouldPlay) void el.play().catch(() => { /* 保留海报，浏览器允许播放后可再次尝试。 */ })
    else { el.pause(); if (!active && el.readyState > 0) el.currentTime = 0 }
  }, [shouldPlay, active, src, ready])
  return <div ref={host} className="silent-media-preview">
    {poster && !posterFailed && <img src={poster} alt="" loading="lazy" draggable={false} onError={() => setPosterFailed(true)} />}
    {showFailure && ((posterFailed && (!src || failed)) || (failed && !poster)) && <span className="silent-media-error" role="status">预览加载失败</span>}
    {src && visible && pageVisible && !failed && (!mountOnlyWhenActive || active) && <video ref={video} src={src} muted loop playsInline preload="metadata"
      aria-label={label} data-ready={ready && active || undefined}
      onPlaying={() => setReady(true)} onError={() => setFailed(true)} />}
  </div>
}

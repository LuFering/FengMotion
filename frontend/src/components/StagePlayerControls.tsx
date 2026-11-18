/**
 * 画面播放器控制条 —— 替代浏览器原生 controls。
 *
 * 原生控件条的问题：它是 Chrome 自己画的，深色渐变蒙层压掉画面底部一大块，
 * 按钮间距、圆角、字体都不受项目主题控制，浅色主题下尤其突兀。
 * 这里用项目自己的令牌画一条窄控制条，只在鼠标移入画面时出现。
 *
 * 保留的行为：播放/暂停、进度拖拽、音量、全屏、时间读数 —— 和原生一致，
 * 用户不用重新学；只是外观统一到工作台里。
 */
import { useEffect, useState } from 'react'
import { UiIcon, SemIcons } from '@/components/icons/UiIcon'
import { Maximize01, VolumeMax, VolumeMin } from '@untitledui/icons'
import { containedMediaRect } from '@/data/previewGeometry'

export function StagePlayerControls({ mediaRef, duration, playing, onToggle, onTime, currentTime }: {
  mediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>
  duration: number
  playing: boolean
  onToggle: () => void
  onTime: (t: number) => void
  currentTime: number
}) {
  const [muted, setMuted] = useState(false)
  /* 视频是 object-fit: contain，实际画面比容器窄或矮，上下会留黑边。
     控制条若按容器底边定位，就会落到黑边甚至卡片白底上 —— 实测偏出 10px。
     这里量出画面真实边界，把控制条贴到「画面」的底边内侧。 */
  const [bottomInset, setBottomInset] = useState(10)
  useEffect(() => {
    const media = mediaRef.current
    const host = media?.parentElement
    if (!media || !host) return
    const measure = () => {
      const box = media.getBoundingClientRect()
      const hostBox = host.getBoundingClientRect()
      const naturalWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
      const naturalHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
      if (!naturalWidth || !naturalHeight) return
      const visible = containedMediaRect(box, naturalWidth, naturalHeight)
      if (!visible) return
      setBottomInset(Math.max(6, Math.round(hostBox.bottom - (visible.top + visible.height) + 8)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(media)
    observer.observe(host)
    return () => observer.disconnect()
    /* duration 变化时重新量：第一次执行时视频元数据往往还没到，
       videoWidth 为 0 会直接 return，之后也不会再量一次。 */
  }, [mediaRef, duration])
  const video = () => (mediaRef.current instanceof HTMLVideoElement ? mediaRef.current : null)
  const total = duration || 0
  const progress = total > 0 ? Math.min(100, (currentTime / total) * 100) : 0

  /* 音量与静音写回真实 video 元素，不只是改按钮图标 ——
     否则按钮显示「已静音」但声音还在放，用户会以为坏了。 */
  useEffect(() => {
    const v = video()
    if (!v) return
    v.muted = muted
  }, [muted])

  const seek = (clientX: number, rect: DOMRect) => {
    const v = video()
    if (!v || !total) return
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    v.currentTime = ratio * total
    onTime(v.currentTime)
  }

  return (
    <div className="wb-player" role="group" aria-label="画面播放控制" style={{ bottom: bottomInset }}>
      <button type="button" className="wb-player-btn" onClick={onToggle}
              aria-label={playing ? '暂停' : '播放'}>
        {playing ? <UiIcon icon={SemIcons.pause} size="sm" /> : <UiIcon icon={SemIcons.play} size="sm" />}
      </button>
      <span className="wb-player-time">
        {formatClock(currentTime)} / {formatClock(total)}
      </span>
      {/* 进度条：外层负责点击与拖拽命中，内层是可视轨道 ——
          直接用 input[type=range] 会在各平台画出不同的原生样式。 */}
      <div className="wb-player-bar" role="slider" tabIndex={0}
           aria-label="播放进度" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(currentTime)}
           onClick={(e) => seek(e.clientX, e.currentTarget.getBoundingClientRect())}
           onKeyDown={(e) => {
             const v = video()
             if (!v || !total) return
             if (e.key === 'ArrowRight') { v.currentTime = Math.min(total, v.currentTime + 0.2); onTime(v.currentTime); e.preventDefault() }
             if (e.key === 'ArrowLeft') { v.currentTime = Math.max(0, v.currentTime - 0.2); onTime(v.currentTime); e.preventDefault() }
           }}>
        <span className="wb-player-track"><span className="wb-player-fill" style={{ width: `${progress}%` }} /></span>
      </div>
      <button type="button" className="wb-player-btn" onClick={() => setMuted((m) => !m)}
              aria-label={muted ? '取消静音' : '静音'}>
        {muted ? <UiIcon icon={VolumeMin} size="sm" /> : <UiIcon icon={VolumeMax} size="sm" />}
      </button>
      <button type="button" className="wb-player-btn" aria-label="全屏"
              onClick={() => { const v = video(); if (v) void v.requestFullscreen?.() }}>
        <UiIcon icon={Maximize01} size="sm" />
      </button>
    </div>
  )
}

const formatClock = (seconds: number) => {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const whole = Math.floor(s)
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

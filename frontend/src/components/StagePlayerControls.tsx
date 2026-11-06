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
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react'

export function StagePlayerControls({ mediaRef, duration, playing, onToggle, onTime, currentTime }: {
  mediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>
  duration: number
  playing: boolean
  onToggle: () => void
  onTime: (t: number) => void
  currentTime: number
}) {
  const [muted, setMuted] = useState(false)
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
    <div className="wb-player" role="group" aria-label="画面播放控制">
      <button type="button" className="wb-player-btn" onClick={onToggle}
              aria-label={playing ? '暂停' : '播放'}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
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
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
      <button type="button" className="wb-player-btn" aria-label="全屏"
              onClick={() => { const v = video(); if (v) void v.requestFullscreen?.() }}>
        <Maximize size={14} />
      </button>
    </div>
  )
}

const formatClock = (seconds: number) => {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const whole = Math.floor(s)
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

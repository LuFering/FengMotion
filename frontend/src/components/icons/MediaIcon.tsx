import React from 'react'

// Vidstack 官方原生图标路径（来自 media-icons/dist/icons）
import addPath from 'media-icons/dist/icons/add.js'
import commentPath from 'media-icons/dist/icons/comment.js'
import cameraPath from 'media-icons/dist/icons/camera.js'
import downloadPath from 'media-icons/dist/icons/download.js'
import theatreModePath from 'media-icons/dist/icons/theatre-mode.js'
import theatreModeExitPath from 'media-icons/dist/icons/theatre-mode-exit.js'
import infoPath from 'media-icons/dist/icons/info.js'
import settingsPath from 'media-icons/dist/icons/settings.js'
import menuHorizontalPath from 'media-icons/dist/icons/menu-horizontal.js'
import queueListPath from 'media-icons/dist/icons/queue-list.js'
import chevronDownPath from 'media-icons/dist/icons/chevron-down.js'
import chevronLeftPath from 'media-icons/dist/icons/chevron-left.js'
import chevronRightPath from 'media-icons/dist/icons/chevron-right.js'
import xMarkPath from 'media-icons/dist/icons/x-mark.js'
import eyePath from 'media-icons/dist/icons/eye.js'
import fullscreenPath from 'media-icons/dist/icons/fullscreen.js'
import fullscreenExitPath from 'media-icons/dist/icons/fullscreen-exit.js'
import playPath from 'media-icons/dist/icons/play.js'
import pausePath from 'media-icons/dist/icons/pause.js'
import repeatPath from 'media-icons/dist/icons/repeat.js'
import replayPath from 'media-icons/dist/icons/replay.js'

// 按照 Vidstack 官方 32×32 几何与描边系统同规格补齐的专业监看图标
const compareSplitSvg = `
<path fill-rule="evenodd" clip-rule="evenodd" d="M6 6.66667C5.63181 6.66667 5.33333 6.96515 5.33333 7.33334V24.6667C5.33333 25.0349 5.63181 25.3333 5.99999 25.3333H26C26.3682 25.3333 26.6667 25.0349 26.6667 24.6667V7.33334C26.6667 6.96515 26.3682 6.66667 26 6.66667H6ZM8 9.33334H14.6667V22.6667H8V9.33334ZM17.3333 9.33334H24V22.6667H17.3333V9.33334Z" fill="currentColor"/>
`

const dashedBoxSvg = `
<rect x="5.333" y="5.333" width="21.334" height="21.334" rx="3.33" fill="none" stroke="currentColor" stroke-width="2.67" stroke-dasharray="4.2 3.2" stroke-linecap="round"/>
`

const thirdsGridSvg = `
<path fill-rule="evenodd" clip-rule="evenodd" d="M6 6.66667C5.63181 6.66667 5.33333 6.96515 5.33333 7.33334V24.6667C5.33333 25.0349 5.63181 25.3333 5.99999 25.3333H26C26.3682 25.3333 26.6667 25.0349 26.6667 24.6667V7.33334C26.6667 6.96515 26.3682 6.66667 26 6.66667H6ZM8 9.33334H24V22.6667H8V9.33334Z" fill="currentColor"/>
<line x1="13.333" y1="9.333" x2="13.333" y2="22.667" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.5 2.2"/>
<line x1="18.667" y1="9.333" x2="18.667" y2="22.667" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.5 2.2"/>
<line x1="8" y1="13.778" x2="24" y2="13.778" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.5 2.2"/>
<line x1="8" y1="18.222" x2="24" y2="18.222" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.5 2.2"/>
`

const VIDSTACK_ICONS = {
  add: addPath,
  comment: commentPath,
  camera: cameraPath,
  download: downloadPath,
  theatreMode: theatreModePath,
  theatreModeExit: theatreModeExitPath,
  info: infoPath,
  settings: settingsPath,
  menuHorizontal: menuHorizontalPath,
  queueList: queueListPath,
  chevronDown: chevronDownPath,
  chevronLeft: chevronLeftPath,
  chevronRight: chevronRightPath,
  xMark: xMarkPath,
  eye: eyePath,
  fullscreen: fullscreenPath,
  fullscreenExit: fullscreenExitPath,
  play: playPath,
  pause: pausePath,
  repeat: repeatPath,
  replay: replayPath,
  // 同规格手绘补齐
  compare: compareSplitSvg,
  dashedBox: dashedBoxSvg,
  thirdsGrid: thirdsGridSvg,
} as const

export type MediaIconName = keyof typeof VIDSTACK_ICONS

export interface MediaIconProps {
  name: MediaIconName
  size?: number
  className?: string
  style?: React.CSSProperties
}

/**
 * Vidstack 官方原生矢量 SVG 图标组件
 * 统一 32×32 viewBox，原生矢量渲染，极致锐利，严格遵循 Vidstack 播放器视觉规制。
 */
export function MediaIcon({
  name,
  size = 18,
  className,
  style,
}: MediaIconProps) {
  const innerSvg = VIDSTACK_ICONS[name] ?? VIDSTACK_ICONS.info

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      style={{
        display: 'inline-block',
        flex: 'none',
        verticalAlign: 'middle',
        ...style,
      }}
      dangerouslySetInnerHTML={{ __html: innerSvg }}
    />
  )
}

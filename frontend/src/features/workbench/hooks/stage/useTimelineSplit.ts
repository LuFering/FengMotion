import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

/** 时间线最少留这么高：顶栏 + 标尺 + 缩略帧 + 一行轨道 */
const MIN_TIMELINE = 150
/** 画面区最少留这么高：再小就看不清画面了 */
const MIN_STAGE = 200

/**
 * 画面和时间线之间的分隔条：上下拖动分配高度，按项目记住。
 *
 * <p>没拖过（height = null）时时间线按内容高度排，最多占一半不到（样式里 max-height 46%），
 * 轨道少的片子不会平白占掉画面；拖过就用拖出来的高度。双击分隔条回到自动。</p>
 */
export function useTimelineSplit(projectId: string) {
  const key = projectId ? `fm-tl-height:${projectId}` : null
  const [height, setHeightState] = useState<number | null>(() => {
    try {
      const v = key ? Number(localStorage.getItem(key)) : NaN
      return Number.isFinite(v) && v > 0 ? v : null
    } catch { return null }
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; y: number; h: number } | null>(null)

  const setHeight = useCallback((next: number | null) => {
    setHeightState(next)
    try {
      if (!key) return
      if (next === null) localStorage.removeItem(key)
      else localStorage.setItem(key, String(Math.round(next)))
    } catch { /* 存不下就只在这次有效 */ }
  }, [key])

  const clampHeight = (h: number) => {
    const total = containerRef.current?.getBoundingClientRect().height ?? 0
    const max = Math.max(MIN_TIMELINE, total - MIN_STAGE)
    return Math.round(Math.min(max, Math.max(MIN_TIMELINE, h)))
  }
  /** 当前时间线的实际高度（自动模式下量出来） */
  const currentHeight = () => containerRef.current?.querySelector<HTMLElement>('.wb-tl')?.getBoundingClientRect().height ?? MIN_TIMELINE

  const handle = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      drag.current = { pointerId: e.pointerId, y: e.clientY, h: currentHeight() }
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 合成事件没有捕获 */ }
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      const d = drag.current
      if (!d || d.pointerId !== e.pointerId) return
      /* 往上拖 = 时间线变高 */
      setHeightState(clampHeight(d.h + (d.y - e.clientY)))
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      const d = drag.current
      if (!d || d.pointerId !== e.pointerId) return
      drag.current = null
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      setHeight(clampHeight(d.h + (d.y - e.clientY)))
    },
    onPointerCancel: () => { drag.current = null },
    onDoubleClick: () => setHeight(null),
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 48 : 16
      if (e.key === 'ArrowUp') setHeight(clampHeight(currentHeight() + step))
      else if (e.key === 'ArrowDown') setHeight(clampHeight(currentHeight() - step))
      else if (e.key === 'Home' || e.key === 'Escape') setHeight(null)
      else return
      e.preventDefault()
    },
  }

  return { height, containerRef, handle }
}

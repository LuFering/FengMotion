import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { elasticPanelFeedback } from '@/components/leibox/elastic-panel-resize/ElasticPanelResizeEngine.js'

const STORAGE_KEY = 'fengmotion:workbench:chat-width'
const MIN_CHAT = 345
const MIN_CANVAS = 400
const HANDLE = 4

/** 管理工作台对话和画面的分栏；宽度保留在本机，窗口变窄时按可用空间收敛。 */
export function useWorkbenchSplit() {
  const containerRef = useRef<HTMLDivElement>(null)
  const preferredRef = useRef<number | null>(null)
  const drag = useRef<{ pointer: number; startX: number; startWidth: number; lastX: number; lastTime: number } | null>(null)
  const [feedback, setFeedback] = useState({ offset: 0, bend: 0, stretch: 0 })
  const [width, setWidth] = useState(460)
  const [bounds, setBounds] = useState({ min: MIN_CHAT, max: 720 })
  const [dragging, setDragging] = useState(false)

  const limits = useCallback(() => {
    const total = containerRef.current?.clientWidth || 0
    if (!total) return { min: MIN_CHAT, max: 720, total: 0 }
    const canvasMin = total < MIN_CHAT + MIN_CANVAS + HANDLE ? 0 : MIN_CANVAS
    const max = Math.max(0, Math.min(Math.max(720, Math.floor((total - HANDLE) / 2)), total - HANDLE - canvasMin))
    return { min: Math.min(MIN_CHAT, max), max, total }
  }, [])
  const clamp = useCallback((value: number) => {
    const { min, max } = limits()
    return Math.round(Math.max(min, Math.min(max, value)))
  }, [limits])

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY))
      if (Number.isFinite(saved) && saved > 0) preferredRef.current = saved
    } catch { /* 浏览器禁用本地存储时仍可调整本次宽度 */ }
    const update = () => {
      const next = limits()
      setBounds({ min: next.min, max: next.max })
      setWidth(clamp(preferredRef.current ?? 460))
    }
    update()
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [clamp, limits])

  const persist = useCallback((value: number) => {
    preferredRef.current = value
    setWidth(value)
    try { localStorage.setItem(STORAGE_KEY, String(value)) } catch { /* 本地存储不可用时只影响持久化 */ }
  }, [])
  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    drag.current = { pointer: event.pointerId, startX: event.clientX, startWidth: width, lastX: event.clientX, lastTime: performance.now() }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    event.preventDefault()
  }, [width])
  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const state = drag.current
    if (state && state.pointer === event.pointerId) {
      const raw = state.startWidth + event.clientX - state.startX
      const bounded = clamp(raw)
      const now = performance.now()
      const speed = (event.clientX - state.lastX) / Math.max((now - state.lastTime) / 1000, .008)
      state.lastX = event.clientX
      state.lastTime = now
      setWidth(bounded)
      setFeedback(window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? { offset: 0, bend: 0, stretch: 0 }
        : elasticPanelFeedback(raw, bounded, speed))
    }
  }, [clamp])
  const onPointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state || state.pointer !== event.pointerId) return
    drag.current = null
    setDragging(false)
    setFeedback({ offset: 0, bend: 0, stretch: 0 })
    persist(clamp(state.startWidth + event.clientX - state.startX))
  }, [clamp, persist])
  const onPointerCancel = useCallback(() => {
    if (drag.current) setWidth(clamp(drag.current.startWidth))
    drag.current = null
    setDragging(false)
    setFeedback({ offset: 0, bend: 0, stretch: 0 })
  }, [clamp])
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    let next: number
    if (event.key === 'ArrowLeft') next = width - 16
    else if (event.key === 'ArrowRight') next = width + 16
    else if (event.key === 'Home') next = bounds.min
    else if (event.key === 'End') next = bounds.max
    else if (event.key === 'Escape') next = drag.current?.startWidth ?? 460
    else return
    event.preventDefault()
    if (event.key === 'Escape' && drag.current) {
      drag.current = null
      setDragging(false)
      setFeedback({ offset: 0, bend: 0, stretch: 0 })
    }
    persist(clamp(next))
  }, [bounds, clamp, persist, width])
  const onDoubleClick = useCallback(() => persist(clamp(460)), [clamp, persist])

  return { containerRef, width, bounds, dragging, feedback, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown, onDoubleClick, reset: onDoubleClick }
}

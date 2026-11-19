import type * as React from 'react'
import { containedMediaRect } from '@/features/workbench/model/previewGeometry'
import { useEffect } from 'react'
import type { StageVisual } from '@/features/workbench/model/stageVisual'

export interface UseRegionSelectArgs {
  comparison: [StageVisual, StageVisual] | null
  panelOpen: boolean
  previewMediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>
  referenceRegion: (bbox: { x: number; y: number; w: number; h: number }) => void
  regionMode: boolean
  regionStart: React.RefObject<{ sx: number; sy: number; mx: number; my: number; pointerId: number } | null>
  setComparison: React.Dispatch<React.SetStateAction<[StageVisual, StageVisual] | null>>
  setComparisonAt: React.Dispatch<React.SetStateAction<{ timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setRegionMode: React.Dispatch<React.SetStateAction<boolean>>
  setRegionRect: React.Dispatch<React.SetStateAction<{ x: number; y: number; w: number; h: number } | null>>
  stageRef: React.RefObject<HTMLDivElement | null>
}

/** 监看区的画面框选：把拖拽换算成视频实际显示区域内的相对坐标并引用为修改目标；另统一处理 Esc 依次退出对比、框选与全屏。 */
export function useRegionSelect({ comparison, panelOpen, previewMediaRef, referenceRegion, regionMode, regionStart, setComparison, setComparisonAt, setNotice, setPanelOpen, setRegionMode, setRegionRect, stageRef }: UseRegionSelectArgs) {
  /** 实际视频显示矩形：stage 可能留白，Player 还会因 16:9 产生 letterbox。 */
  const mediaRect = () => {
    const media = previewMediaRef.current
    const box = media?.getBoundingClientRect()
    if (!box || !media) return null
    const widthNatural = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
    const heightNatural = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
    if (!widthNatural || !heightNatural) return null
    return containedMediaRect(box, widthNatural, heightNatural)
  }

  const regionPoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current?.getBoundingClientRect()
    const media = mediaRect()
    if (!stage || !media || media.width <= 0 || media.height <= 0) return null
    const sx = (e.clientX - stage.left) / stage.width
    const sy = (e.clientY - stage.top) / stage.height
    const mx = (e.clientX - media.left) / media.width
    const my = (e.clientY - media.top) / media.height
    if (mx < 0 || mx > 1 || my < 0 || my > 1) return null
    return { sx, sy, mx, my }
  }
  const startRegion = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!regionMode || e.button !== 0 || regionStart.current) return
    const p = regionPoint(e)
    if (!p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    regionStart.current = { ...p, pointerId: e.pointerId }
    setRegionRect({ x: p.sx, y: p.sy, w: 0, h: 0 })
  }
  const moveRegion = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!regionMode || !regionStart.current || regionStart.current.pointerId !== e.pointerId) return
    const start = regionStart.current
    const stage = stageRef.current?.getBoundingClientRect()
    const media = mediaRect()
    if (!stage || !media || !stage.width || !stage.height) return
    const x = Math.min(media.left + media.width, Math.max(media.left, e.clientX))
    const y = Math.min(media.top + media.height, Math.max(media.top, e.clientY))
    const sx = (x - stage.left) / stage.width
    const sy = (y - stage.top) / stage.height
    setRegionRect({ x: Math.min(start.sx, sx), y: Math.min(start.sy, sy), w: Math.abs(sx - start.sx), h: Math.abs(sy - start.sy) })
  }
  // 全局 Esc 按键统一调度：对比模式、框选模式、工作台全屏均支持 Esc 退出
  useEffect(() => {
    if (!comparison && !regionMode && panelOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 优先退出对比模式
      if (comparison) {
        setComparison(null)
        setComparisonAt(null)
        return
      }
      // 退出框选模式
      if (regionMode) {
        regionStart.current = null
        setRegionMode(false)
        setRegionRect(null)
        return
      }
      // 退出工作台全屏
      if (!panelOpen) {
        setPanelOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [comparison, regionMode, panelOpen])
  const endRegion = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = regionStart.current
    if (!regionMode || !start || start.pointerId !== e.pointerId) return
    const media = mediaRect()
    if (media) {
      const mx = Math.min(1, Math.max(0, (e.clientX - media.left) / media.width))
      const my = Math.min(1, Math.max(0, (e.clientY - media.top) / media.height))
      const box = { x: Math.min(start.mx, mx), y: Math.min(start.my, my), w: Math.abs(mx - start.mx), h: Math.abs(my - start.my) }
      if (box.w > 0.01 && box.h > 0.01) referenceRegion(box)
      else setNotice('框选范围太小，请重新拖拽选择画面区域。')
    } else setNotice('无法定位画面，请重新加载预览后再框选。')
    regionStart.current = null
    setRegionMode(false)
    setRegionRect(null)
  }
  return { startRegion, moveRegion, endRegion }
}

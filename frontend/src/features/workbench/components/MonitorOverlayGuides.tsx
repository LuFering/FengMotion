import { useEffect, useState, type RefObject } from 'react'
import { containedMediaRect } from '@/features/workbench/model/previewGeometry'
import type { OverlayGuidesState } from './WorkbenchTopBar'

interface MonitorOverlayGuidesProps {
  mediaRef: RefObject<HTMLVideoElement | HTMLImageElement | null>
  overlayGuides: OverlayGuidesState
  fps?: number
}

interface MediaRect {
  left: number
  top: number
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
}

/**
 * 监看画面辅助查看覆盖层（三分构图线、90%/80% 安全区、真实规格信息）
 * 严格按照真实媒体画面矩形（排除 letterbox/pillarbox 黑边）铺设，
 * 绝不在黑边上绘制，尺寸未就绪时不猜数值。
 */
export function MonitorOverlayGuides({
  mediaRef,
  overlayGuides,
  fps,
}: MonitorOverlayGuidesProps) {
  const [rect, setRect] = useState<MediaRect | null>(null)

  const isAnyActive =
    overlayGuides.safeArea || overlayGuides.thirds || overlayGuides.mediaFacts

  useEffect(() => {
    if (!isAnyActive) return

    const element = mediaRef.current
    if (!element) return

    const host = element.parentElement
    if (!host) return

    const measure = () => {
      const el = mediaRef.current
      if (!el) return
      const hostEl = el.parentElement
      if (!hostEl) return

      const naturalWidth =
        el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
      const naturalHeight =
        el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight

      // 尺寸尚未就绪时不猜数值，不渲染虚假辅助线
      if (!naturalWidth || !naturalHeight || naturalWidth <= 0 || naturalHeight <= 0) {
        setRect(null)
        return
      }

      const visible = containedMediaRect(
        el.getBoundingClientRect(),
        naturalWidth,
        naturalHeight,
      )
      if (!visible || visible.width <= 0 || visible.height <= 0) {
        setRect(null)
        return
      }

      const hostBox = hostEl.getBoundingClientRect()
      setRect({
        left: visible.left - hostBox.left,
        top: visible.top - hostBox.top,
        width: visible.width,
        height: visible.height,
        naturalWidth,
        naturalHeight,
      })
    }

    // 监听尺寸变化和加载事件
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(host)

    element.addEventListener('loadedmetadata', measure)
    element.addEventListener('load', measure)
    element.addEventListener('resize', measure)

    measure()

    return () => {
      observer.disconnect()
      element.removeEventListener('loadedmetadata', measure)
      element.removeEventListener('load', measure)
      element.removeEventListener('resize', measure)
    }
  }, [mediaRef, isAnyActive])

  if (!isAnyActive || !rect) {
    return null
  }

  return (
    <div
      className="fw-overlay-layer"
      style={{
        position: 'absolute',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      {/* 三分法则构图网格线 */}
      {overlayGuides.thirds && <div className="fw-overlay-thirds" />}

      {/* 广播与电影安全区：90% 动作安全区 ＋ 80% 字幕安全区 */}
      {overlayGuides.safeArea && (
        <>
          <div className="fw-overlay-safe-action" />
          <div className="fw-overlay-safe-title" />
        </>
      )}

      {/* 画面真实规格胶囊 */}
      {overlayGuides.mediaFacts && (
        <div className="fw-overlay-facts">
          <span>
            {rect.naturalWidth} × {rect.naturalHeight}
          </span>
          {typeof fps === 'number' && fps > 0 && <span>{fps} fps</span>}
        </div>
      )}
    </div>
  )
}

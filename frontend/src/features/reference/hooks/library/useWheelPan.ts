import type * as React from 'react'
import { useEffect } from 'react'

export interface UseWheelPanArgs {
  filmsRef: React.RefObject<HTMLDivElement | null>
}

/** 从 RefLibrary.tsx 的 RefLibrary 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useWheelPan({ filmsRef }: UseWheelPanArgs) {
  /* 横向片条：鼠标落在上面时，上下滚轮就左右平移。
     必须用原生监听 —— React 的 onWheel 是 passive 的，preventDefault 会被忽略，
     结果滚轮一边平移片条、一边把整页也滚了。
     用触控板横向滑动（|deltaX| > |deltaY|）时不接管，交给浏览器原生处理。 */
  useEffect(() => {
    const el = filmsRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  return {  }
}

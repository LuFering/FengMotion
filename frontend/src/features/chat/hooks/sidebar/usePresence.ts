import { useEffect, useState } from 'react'

/**
 * 给「开合」加一段退场时间：关上后先停在 closing，放完收起动画再卸载。
 *
 * <p>直接按 open 渲染的话，关上那一刻节点就没了，收起动画根本没机会播。</p>
 *
 * @param exitMs 收起动画的时长，与 CSS 里的退场动画保持一致
 * @returns 'open' 展开中 / 'closing' 正在收起 / null 已卸载
 */
export function usePresence(open: boolean, exitMs: number): 'open' | 'closing' | null {
  const [closing, setClosing] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  /* 渲染期间比对上一次的 open（React 推荐的「从 props 派生状态」写法），
     不用 effect，避免多渲染一帧「已关闭但还没开始收起」 */
  if (open !== wasOpen) {
    setWasOpen(open)
    setClosing(!open)
  }
  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => setClosing(false), exitMs)
    return () => window.clearTimeout(timer)
  }, [closing, exitMs])
  return open ? 'open' : closing ? 'closing' : null
}

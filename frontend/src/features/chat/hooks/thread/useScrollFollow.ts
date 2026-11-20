import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/* 规则照 dsh 的 useScrollFollow：离底部 25px 以内算「贴底」。 */
const FOLLOW_THRESHOLD = 25
/** 用户的滚动意图（滚轮、触摸、拖滚动条、翻页键）在这段时间内引起的滚动，才算「用户翻走了」 */
const INTENT_WINDOW_MS = 800
const READING_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

/**
 * 对话区跟随最新内容。
 *
 * <p>只看消息数据变化来滚是不够的：工具组展开、行逐条长出、代码块变长都会让页面变高，
 * 这些都不是「消息变了」。所以这里直接盯内容高度（ResizeObserver），贴底时任何增高都立刻跟到底。</p>
 *
 * <p>用户一旦用滚轮、触摸、拖动滚动条或翻页键往上翻，就停止跟随，不抢他正在看的位置；
 * 他自己滚回底部、点「回到最新」或发出新消息时恢复。程序自己的滚动不会被当成用户翻走。</p>
 *
 * @param scrollRef  滚动容器
 * @param contentRef 会变高的内容容器
 * @returns away：是否已翻离底部（显示「回到最新」）；toBottom：恢复跟随并回到底部
 */
export function useScrollFollow(scrollRef: RefObject<HTMLElement | null>, contentRef: RefObject<HTMLElement | null>) {
  const followRef = useRef(true)
  const intentAt = useRef(0)
  const [away, setAway] = useState(false)

  const setFollow = useCallback((follow: boolean) => {
    followRef.current = follow
    setAway(!follow)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const mark = () => { intentAt.current = performance.now() }
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (READING_KEYS.has(e.key)) mark()
    }
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distance <= FOLLOW_THRESHOLD) {
        if (!followRef.current) setFollow(true)
        return
      }
      if (followRef.current && performance.now() - intentAt.current < INTENT_WINDOW_MS) setFollow(false)
    }
    el.addEventListener('wheel', mark, { passive: true })
    el.addEventListener('touchstart', mark, { passive: true })
    el.addEventListener('pointerdown', mark, { passive: true })
    window.addEventListener('keydown', onKey)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('wheel', mark)
      el.removeEventListener('touchstart', mark)
      el.removeEventListener('pointerdown', mark)
      window.removeEventListener('keydown', onKey)
      el.removeEventListener('scroll', onScroll)
    }
  }, [scrollRef, setFollow])

  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (followRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollRef, contentRef])

  /** 恢复跟随并回到底部；smooth 用于用户点「回到最新」，发送新消息时直接到底 */
  const toBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    /* 点按钮本身也会记一次意图；清掉它，平滑滚动途中才不会被误判成「用户又翻走了」 */
    intentAt.current = 0
    setFollow(true)
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }, [scrollRef, setFollow])

  return { away, toBottom }
}

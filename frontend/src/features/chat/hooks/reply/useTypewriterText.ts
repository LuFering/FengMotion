import { useEffect, useRef, useState } from 'react'

/*
 * 放字速度。上游不是逐 token 到达，而是每隔几百毫秒给一批（实测一批可达 25 帧、上百字），
 * 直接渲染就是「一段一段冒出来」。这里把已收到的文字按帧逐字放出：
 * 落后越多放得越快（大约在 CATCH_UP_MS 内追平），但每秒有上下限 ——
 * 下限保证有「正在打字」的节奏，上限保证一批大块到达时也不会一下跳出一整段。
 */
const MIN_CHARS_PER_SEC = 45
const MAX_CHARS_PER_SEC = 480
const CATCH_UP_MS = 420
/** 单帧最长按这么多毫秒计：切到后台再回来时不一次补出一大段 */
const MAX_FRAME_MS = 64

/** 不把一个由两个码元组成的字符（emoji 等）切成两半显示 */
function safeEnd(text: string, end: number): number {
  if (end <= 0 || end >= text.length) return Math.max(0, Math.min(end, text.length))
  const code = text.charCodeAt(end - 1)
  return code >= 0xd800 && code <= 0xdbff ? end + 1 : end
}

/**
 * 把「已收到的文字」逐字放出来。
 *
 * <p>流式中挂载的段落从头放起：工具调用之后的新一段正文，挂载时往往已带着第一批文字，
 * 直接显示就又是「一段冒出来」。不在流式中挂载的（读回的历史消息）直接显示全部，不重放。
 * 之后目标每次变长，就从当前位置继续往后放；目标被替换变短时立即对齐，不显示越界内容。</p>
 *
 * @param target  已经收到的完整文字
 * @param animate 关闭时（减弱动效）直接显示全部
 * @param live    挂载时是否处于流式中
 * @returns visible：当前该显示的前缀；caughtUp：是否已经追平
 */
export function useTypewriterText(target: string, animate: boolean, live: boolean): { visible: string; caughtUp: boolean } {
  const [shown, setShown] = useState(() => (animate && live ? 0 : target.length))
  const shownRef = useRef(shown)
  const targetRef = useRef(target)
  const frameRef = useRef<number | null>(null)
  const lastRef = useRef(0)
  const carryRef = useRef(0)

  useEffect(() => {
    /* 帧循环每帧读最新目标：在这里更新，不在渲染期间写 ref */
    targetRef.current = target
    if (!animate || shownRef.current > target.length) {
      shownRef.current = target.length
      setShown(target.length)
      return
    }
    /* 已追平，或者帧循环正在跑（它每帧读最新目标，不需要重启） */
    if (shownRef.current >= target.length || frameRef.current !== null) return
    lastRef.current = performance.now()
    carryRef.current = 0
    const step = (now: number) => {
      const goal = targetRef.current.length
      const dt = Math.min(MAX_FRAME_MS, Math.max(0, now - lastRef.current))
      lastRef.current = now
      const backlog = goal - shownRef.current
      if (backlog <= 0) {
        frameRef.current = null
        return
      }
      const rate = Math.min(MAX_CHARS_PER_SEC, Math.max(MIN_CHARS_PER_SEC, (backlog * 1000) / CATCH_UP_MS))
      carryRef.current += (rate * dt) / 1000
      const take = Math.floor(carryRef.current)
      if (take > 0) {
        carryRef.current -= take
        shownRef.current = safeEnd(targetRef.current, Math.min(goal, shownRef.current + take))
        setShown(shownRef.current)
      }
      frameRef.current = requestAnimationFrame(step)
    }
    frameRef.current = requestAnimationFrame(step)
  }, [target, animate])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  const end = Math.min(shown, target.length)
  return { visible: target.slice(0, end), caughtUp: end >= target.length }
}

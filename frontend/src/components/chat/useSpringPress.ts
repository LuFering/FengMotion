/**
 * 按压弹簧 —— 逐行对照 LeiBox `ui/useSpringPress.ts`。
 *
 * 只对 pointerdown / pointerup 做缩放，不碰 hover：
 *   · 按下      scale 0.97，75ms，power2.out（很快压下去）
 *   · 松开/取消  scale 1，380ms，springEase(420, 24, 0.38)（弹回来带一点过冲）
 *
 * 之前输入框里的按钮完全没有按压反馈，点下去只有颜色变化，
 * 手感是"平的"。
 *
 * 注意三类释放事件都要接：pointerup 在按钮外松手、pointercancel、
 * 以及窗口失焦 —— 少接一个就会出现"按下去卡在 0.97 回不来"。
 */

import { useCallback, useEffect, useRef } from 'react'
import { PRESS_MOTION, prefersReducedMotion, springEase } from './springMotion'

export function useSpringPress<T extends HTMLElement>() {
  const local = useRef<T | null>(null)

  const ref = useCallback((node: T | null) => {
    local.current = node
  }, [])

  useEffect(() => {
    const node = local.current
    if (!node) return
    let pressed = false
    /* 用 Web Animations API 而不是 GSAP：项目没有 gsap 的类型声明，
       而 WAAPI 支持自定义 easing 函数，正好能喂我们算好的弹簧曲线。 */
    let anim: Animation | null = null

    const play = (from: number, to: number, durationMs: number, easing: string) => {
      anim?.cancel()
      anim = node.animate(
        [{ transform: `scale(${from})` }, { transform: `scale(${to})` }],
        { duration: durationMs, easing, fill: 'forwards' },
      )
    }

    const down = () => {
      if (node.matches(':disabled') || prefersReducedMotion()) return
      pressed = true
      play(1, PRESS_MOTION.downScale, PRESS_MOTION.downDuration * 1000, 'cubic-bezier(0.4, 0, 1, 1)')
    }

    const release = () => {
      if (!pressed) return
      pressed = false
      if (prefersReducedMotion()) {
        play(PRESS_MOTION.downScale, 1, 0, 'linear')
        return
      }
      /* 把弹簧函数采样成 linear() 缓动：WAAPI 只接受关键字或 linear()，
         这里取 24 个采样点，肉眼已完全平滑。 */
      const ease = springEase(PRESS_MOTION.upStiffness, PRESS_MOTION.upDamping, PRESS_MOTION.upDuration)
      /* WAAPI 的 linear() 只接受**纯数字**（0 ~ 1 之间的进度），
         带 % 会直接抛 TypeError 并把整块组件炸掉（实测）。 */
      const stops = Array.from({ length: 25 }, (_, i) => {
        const t = i / 24
        return ease(t).toFixed(4)
      }).join(', ')
      play(PRESS_MOTION.downScale, 1, PRESS_MOTION.upDuration * 1000, `linear(${stops})`)
    }

    node.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    return () => {
      node.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
      anim?.cancel()
    }
  }, [])

  return ref
}

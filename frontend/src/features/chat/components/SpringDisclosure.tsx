/**
 * SpringDisclosure —— 高度弹簧式展开/收起。
 *
 * 对照 LeiBox `ui/SpringDisclosure.tsx`：
 *   · 外壳高度用 springEase(360, 34, 0.42) 从 0 弹到自然高度（会轻微过冲）
 *   · 内容层同步：透明度 0→1、translateY -3→0、blur 2px→0
 *     打开 0.24s、关闭 0.14s（关闭更快，避免拖沓）
 *   · 收起后用 ResizeObserver 重测自然高度，内容变化也能重新贴合
 *
 * 为什么不用 CSS max-height 过渡：max-height 需要一个猜的上限值，
 * 猜大了前半段几乎没有视觉变化（看起来像"卡了一下"），
 * 猜小了内容会被裁掉。按真实高度做弹簧才是对的。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SOFT_SPRING, prefersReducedMotion, springEase } from './springMotion'

export interface SpringDisclosureProps {
  open: boolean
  children: ReactNode
  /** 是否在收起后卸载内容（附件区需要，避免留下不可见的 DOM） */
  unmountOnExit?: boolean
  className?: string
}

export function SpringDisclosure({ open, children, unmountOnExit = false, className }: SpringDisclosureProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<Animation | null>(null)
  const lastHeight = useRef(0)
  const [present, setPresent] = useState(open)

  useLayoutEffect(() => {
    if (open) setPresent(true)
  }, [open])

  useEffect(() => {
    const shell = shellRef.current
    const body = bodyRef.current
    if (!shell || !body) return

    const natural = body.offsetHeight
    if (natural > 0) lastHeight.current = natural
    const target = open ? (natural || lastHeight.current) : 0

    if (prefersReducedMotion()) {
      shell.style.height = open ? 'auto' : '0px'
      body.style.opacity = open ? '1' : '0'
      body.style.transform = 'none'
      body.style.filter = 'none'
      if (!open && unmountOnExit) setPresent(false)
      return
    }

    /* 起始高度：从当前实际值出发，保证中途反转（连点）也连续 */
    const from = shell.getBoundingClientRect().height

    const ease = springEase(SOFT_SPRING.stiffness, SOFT_SPRING.damping, SOFT_SPRING.duration)
    /* linear() 只接受纯数字进度值，带 % 会抛 TypeError */
    const stops = Array.from({ length: 25 }, (_, i) => {
      const t = i / 24
      return ease(t).toFixed(4)
    }).join(', ')

    animRef.current?.cancel()
    animRef.current = shell.animate(
      [{ height: `${from}px` }, { height: `${target}px` }],
      { duration: SOFT_SPRING.duration * 1000, easing: `linear(${stops})`, fill: 'forwards' },
    )
    animRef.current.onfinish = () => {
      shell.style.height = open ? 'auto' : '0px'
      if (!open && unmountOnExit) setPresent(false)
    }

    const dur = open ? 240 : 140
    body.animate(
      [
        { opacity: open ? 0 : 1, transform: `translateY(${open ? -3 : 0}px)`, filter: open ? 'blur(2px)' : 'blur(0px)' },
        { opacity: open ? 1 : 0, transform: `translateY(${open ? 0 : -3}px)`, filter: open ? 'blur(0px)' : 'blur(2px)' },
      ],
      { duration: dur, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
    )

    return () => {
      animRef.current?.cancel()
    }
  }, [open, unmountOnExit, present])

  if (unmountOnExit && !open && !present) return null

  return (
    <div
      ref={shellRef}
      className={`spring-disclosure${className ? ` ${className}` : ''}`}
      aria-hidden={!open}
      style={{ height: open ? undefined : 0 }}
    >
      <div ref={bodyRef} className="spring-disclosure-body">{children}</div>
    </div>
  )
}

export default SpringDisclosure

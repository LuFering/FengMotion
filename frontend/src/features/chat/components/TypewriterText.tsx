import { useState, type ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import { useTypewriterText } from '@/features/chat/hooks/reply/useTypewriterText'

/**
 * 回复正文的逐字输出外壳：流式中把已收到的文字逐字放给 children 渲染。
 *
 * <p>流式结束后先把剩下的字放完，追平了才把 `settled` 交给 children ——
 * 结束那一刻不一次性补出一大段。children 在两种状态下应返回同类型的根元素，
 * 这样切换时组件不重建、画面不闪。</p>
 *
 * @param live 这条回复是否仍在流式输出
 */
export function TypewriterText({ text, live, children }: {
  text: string
  live: boolean
  children: (visible: string, settled: boolean) => ReactNode
}) {
  const reduce = useReducedMotion() ?? false
  const [mountedLive] = useState(live)
  const { visible, caughtUp } = useTypewriterText(text, !reduce, mountedLive)
  return <>{children(visible, !live && caughtUp)}</>
}

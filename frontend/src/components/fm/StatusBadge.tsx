import type { ReactNode } from 'react'

/**
 * 状态徽标 —— 01 期 Issue ④。
 *
 * 不直接套 ui/badge：它的固定 20px 高与 variant 集合（无 info / neutral，
 * 无圆点）与本规格冲突，所以按同一套语义色自建 pill；不改 ui/* 的现有视觉。
 * tone 只表达状态，不表达品牌；底色是 tone 色的 12% 透明。
 */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export function StatusBadge({
  tone,
  children,
}: {
  tone: StatusTone
  children: ReactNode
}) {
  return (
    <span className="fm-status-badge" data-tone={tone}>
      <span className="fm-status-dot" aria-hidden="true" />
      {children}
    </span>
  )
}

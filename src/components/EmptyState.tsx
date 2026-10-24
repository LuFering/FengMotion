import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * 空状态 —— 库页「确实没有内容」与「筛选后没有匹配」的统一呈现。
 *
 * 本组件不涉及状态色（状态语义只属于 src/shell/status.ts）：
 * 颜色、字号、间距都由 .fm-state* 里引用主题变量决定，页面不再各写一套空态样式。
 *
 * 为什么 icon 可选：空态的原因不同（文件没导入 / 搜索没命中 / 集合为空），
 * 强行都配图标反而让三种情况看起来一样；需要区分时再传。
 */
export function EmptyState({ title, description, action, icon: Icon }: {
  title: string
  description?: string
  action?: ReactNode
  icon?: LucideIcon
}) {
  return (
    <div className="fm-state fm-state-empty">
      {Icon ? <Icon className="fm-state-icon" size={24} strokeWidth={1.75} aria-hidden="true" /> : null}
      <b className="fm-state-title">{title}</b>
      {description ? <p className="fm-state-desc">{description}</p> : null}
      {action ? <div className="fm-state-actions">{action}</div> : null}
    </div>
  )
}

import { statusOf, type AnyStatus } from '@/shell/status'

/**
 * 状态承载 —— 只决定「用什么形状展示」，文案与语义来自 src/shell/status.ts（唯一来源）。
 *
 * 为什么分两种承载：
 *   · dot 用于列表/工作台那种会重复出现的地方，正常态要安静，只留一个小圆点；
 *   · tag 用于需要被扫读、且不跟行内文字挤在一起的地方。
 *
 * 为什么异常态要带文字：只靠颜色表达状态，色弱用户与黑白截图都会丢信息，
 * 而「需处理 / 等你选」恰恰是最需要被看见的两态。
 *
 * 颜色全部来自 .fm-dot[data-s] / .fm-tag[data-s]，本组件不写任何色值。
 */
export function StatusBadge({ status, variant = 'dot' }: {
  status: AnyStatus
  /** dot = 工作台小圆点；tag = 胶囊标签 */
  variant?: 'dot' | 'tag'
}) {
  const { label, s } = statusOf(status)

  if (variant === 'tag') {
    return <span className="fm-tag" data-s={s}>{label}</span>
  }

  // 异常态：点 + 文字。此时文字已经说明了状态，不再重复 aria-label。
  if (status === 'failed' || status === 'waiting') {
    return (
      <span className="fm-status" data-s={s}>
        <i className="fm-dot" data-s={s} aria-hidden="true" />
        <span className="fm-status-text">{label}</span>
      </span>
    )
  }

  // 安静态：只有圆点，所以必须把语义挂到外层，供读屏和悬停读取。
  return (
    <span className="fm-status" data-s={s} role="img" aria-label={label} title={label}>
      <i className="fm-dot" data-s={s} aria-hidden="true" />
    </span>
  )
}

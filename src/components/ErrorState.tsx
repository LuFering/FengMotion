import { CircleAlert } from 'lucide-react'

/**
 * 错误状态 —— 失败时给出「发生了什么 + 下一步」。
 *
 * 本组件不涉及状态语义映射（状态语义只属于 src/shell/status.ts）：
 * 这里的红色是「失败」这一呈现结果，由主题变量 --bad 经 CSS 提供，组件不写色值。
 *
 * 为什么不自动带重试：重试动作只有调用方知道怎么重放（重新拉索引 / 重跑任务），
 * 传了 onRetry 才渲染按钮，避免出现点了没反应的假入口。
 * role="alert"：加载失败需要被读屏立刻播报，而不是等用户浏览到。
 */
export function ErrorState({ title = '加载失败', description = '请重试；若持续失败，请查看日志。', onRetry }: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <div className="fm-state fm-state-error" role="alert">
      <CircleAlert className="fm-state-icon" size={24} strokeWidth={1.75} aria-hidden="true" />
      <b className="fm-state-title">{title}</b>
      {description ? <p className="fm-state-desc">{description}</p> : null}
      {onRetry ? (
        <div className="fm-state-actions">
          <button type="button" className="fm-state-action" onClick={onRetry}>重试</button>
        </div>
      ) : null}
    </div>
  )
}

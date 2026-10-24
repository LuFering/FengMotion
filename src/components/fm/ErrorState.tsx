/**
 * 错误状态 —— 三库共用（01 期 Issue ④）。
 *
 * 只在真的失败时出现；没有重试逻辑就不要传 onRetry，按钮不会渲染，
 * 不许放一个点了没反应的假按钮。
 */
export function ErrorState({
  title = '加载失败',
  body,
  onRetry,
}: {
  title?: string
  body?: string
  onRetry?: () => void
}) {
  return (
    <div className="fm-state fm-state-error" role="alert">
      <svg className="ui-icon fm-state-icon" aria-hidden="true">
        <use href="./assets/paba-icons.svg#circle-alert" />
      </svg>
      <b className="fm-state-title">{title}</b>
      {body ? <p className="fm-state-body">{body}</p> : null}
      {onRetry ? (
        <button type="button" className="fm-state-action" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  )
}

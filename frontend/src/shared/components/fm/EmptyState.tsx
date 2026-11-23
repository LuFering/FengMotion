/**
 * 空状态 —— 三库共用（01 期 Issue ④）。
 *
 * 只负责「没有内容时怎么说」：图标、标题、说明和恢复动作（一个主动作，可再加一个去别处看的次动作）。
 * icon 是 paba 图标精灵里的名字（如 film / image / search），不是图片路径。
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  secondary,
}: {
  icon: string
  title: string
  body?: string
  action?: { label: string; onClick: () => void }
  /** 次动作，例如项目为空时「查看全部素材」 */
  secondary?: { label: string; onClick: () => void }
}) {
  return (
    <div className="fm-state fm-state-empty" role="status">
      <svg className="ui-icon fm-state-icon" aria-hidden="true">
        <use href={`./assets/paba-icons.svg#${icon}`} />
      </svg>
      <b className="fm-state-title">{title}</b>
      {body ? <p className="fm-state-body">{body}</p> : null}
      {action || secondary ? (
        <div className="fm-state-actions">
          {action ? (
            <button type="button" className="fm-state-action" onClick={action.onClick}>
              {action.label}
            </button>
          ) : null}
          {secondary ? (
            <button type="button" className="fm-state-action is-quiet" onClick={secondary.onClick}>
              {secondary.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

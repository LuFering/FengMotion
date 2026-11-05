/**
 * 加载状态 —— 三库共用（01 期 Issue ④）。
 *
 * 骨架而不是转圈：让用户先看到页面形状。rows 是骨架块数量；
 * grid 的列数由调用页用 CSS 覆盖 .fm-state-loading 的列模板控制。
 */
export function LoadingState({
  rows = 3,
  variant = 'grid',
}: {
  rows?: number
  variant?: 'grid' | 'list'
}) {
  return (
    <div
      className={`fm-state-loading fm-state-loading-${variant}`}
      role="status"
      aria-label="正在加载"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="fm-skeleton-card" aria-hidden="true">
          <span className="fm-skeleton-media" />
          <span className="fm-skeleton-lines">
            <span className="fm-skeleton-line fm-skeleton-line-wide" />
            <span className="fm-skeleton-line" />
          </span>
        </div>
      ))}
    </div>
  )
}

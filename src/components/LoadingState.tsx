/**
 * 加载状态 —— 骨架条 + 一句说明，替代各库自己写的转圈图标。
 *
 * 本组件不涉及状态语义色（状态语义只属于 src/shell/status.ts）。
 *
 * 为什么用骨架而不是 spinner：库页最终会铺成列表/表格，骨架能提前说明
 * 「这里将来是几行内容」，页面不会在加载完成时整体跳一下。
 * 动画交给 CSS（含 prefers-reduced-motion 静止处理），组件里不放定时器。
 */
export function LoadingState({ label = '正在加载…', rows = 3 }: {
  label?: string
  rows?: number
}) {
  return (
    <div className="fm-state fm-state-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="fm-skeleton" aria-hidden="true">
        {Array.from({ length: Math.max(1, rows) }).map((_, i) => <i key={i} />)}
      </div>
      <p className="fm-state-loading-label">{label}</p>
    </div>
  )
}

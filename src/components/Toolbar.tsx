import type { ReactNode } from 'react'

/**
 * 工具栏 —— 页头下面那一行（01 期 P0）。
 *
 * 左边放筛选/分组/视图切换，右边放结果计数与排序。
 * 三库现在各写一套（.mya-filterbar / .fx-filterbar / .rfl 工具条），本组件是归并目标。
 *
 * 不负责：搜索框（单独 SearchField，放 left 里）、筛选抽屉内容（各页自管）。
 */
export function Toolbar({
  left, right, children,
}: {
  /** 左侧：筛选、分组、视图切换 */
  left?: ReactNode
  /** 右侧：计数、排序 */
  right?: ReactNode
  /** 需要通栏内容（如已选条件 chips）时用 */
  children?: ReactNode
}) {
  return (
    <div className="fm-toolbar">
      <div className="fm-toolbar-row">
        {left ? <div className="fm-toolbar-left">{left}</div> : null}
        {right ? <div className="fm-toolbar-right">{right}</div> : null}
      </div>
      {children ? <div className="fm-toolbar-extra">{children}</div> : null}
    </div>
  )
}

import type { ReactNode } from 'react'

/**
 * 页头 —— 所有非全幅页面的统一顶部（01 期 P0）。
 *
 * 一行说完三件事：这是什么（标题）、有多少（元信息统计）、能干什么（右侧操作）。
 * 高度走 --fm-topbar（56px），不写死数值；颜色只用语义变量。
 *
 * 不负责：面包屑（项目内用 ProjectBar）、搜索框（用 SearchField 传进 actions）、
 *        全幅页的顶部（工作流/发布与验收/项目总览/首页/工作台都不渲染本组件）。
 */
export function PageHeader({
  title, meta, actions, id,
}: {
  title: ReactNode
  /** 元信息：数量、范围、更新时间等，一行内说完 */
  meta?: ReactNode
  /** 右侧操作区：主操作放最后 */
  actions?: ReactNode
  /** 需要被 aria-labelledby 引用时传 */
  id?: string
}) {
  return (
    <header className="fm-page-head">
      <div className="fm-page-head-main">
        <h1 className="fm-page-head-title" id={id}>{title}</h1>
        {meta ? <div className="fm-page-head-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="fm-page-head-actions">{actions}</div> : null}
    </header>
  )
}

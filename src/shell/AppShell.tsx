import type { ReactNode } from 'react'
import { SidebarNav, SidebarFooter } from '@/shell/SidebarNav'
import type { ViewId } from '@/shell/views'
import type { ThemeId } from '@/shell/SettingsDialog'

/**
 * 应用外壳 —— 侧栏 + 内容区。
 *
 * 结构对应 paba.tv 的 #app：
 *   #app
 *   ├── <aside class="hm-sidebar">   68px 图标轨（可展开 216px）
 *   └── 内容区（各 pane 由 App 按当前视图渲染）
 *
 * 为什么单独抽出来：
 *   01 期要保证「六个导航页共用一致壳」。壳的 DOM 一旦散在 App 里，
 *   每加一个视图就会再抄一遍侧栏。这里收成唯一一份。
 *
 * ⚠️ 顶部标签栏（paba 的 .tabbar）已删除 —— 它与侧栏是同一份导航，
 *    且运行时 `display: none`（死代码）。导航只有侧栏一处。
 * ⚠️ 本组件只管壳，不判断当前显示哪个 pane：视图分发仍留在 App，
 *    因为「目录 / 项目 / 工作台」共用同一个 ViewId，判断逻辑属于路由不属于壳。
 */
export function AppShell({
  view, onNavigate, theme, onOpenSettings, onThemeChange, onToggleNav, children,
}: {
  view: ViewId
  onNavigate: (id: ViewId) => void
  theme: ThemeId
  onOpenSettings: () => void
  onThemeChange: (theme: ThemeId) => void
  onToggleNav: () => void
  children: ReactNode
}) {
  return (
    <div id="app">
      <aside className="hm-sidebar" id="hm-sidebar" aria-label="主导航">
        <div className="hm-sidebar-head">
          <a className="hm-brand" href="#project" aria-label="FengMotion 项目"
             onClick={(e) => { e.preventDefault(); onNavigate('project') }}>
            <span className="hm-brand-mark">
              <img src="./assets/brand/fengmotion-mark.png" alt="" width={26} height={26} />
            </span>
            <span className="hm-brand-word app-brand-logo">
              <img src="./assets/brand/fengmotion-word.png" alt="FengMotion" style={{ height: 14, width: 'auto' }} />
            </span>
          </a>
          <button className="hm-sidebar-toggle" id="hm-sidebar-toggle" type="button"
                  aria-label="展开边栏" aria-expanded={false} onClick={onToggleNav}>
            <svg className="ui-icon hm-icon-open" aria-hidden="true"><use href="./assets/paba-icons.svg#panel-left-open" /></svg>
            <svg className="ui-icon hm-icon-close" aria-hidden="true"><use href="./assets/paba-icons.svg#panel-left-close" /></svg>
          </button>
        </div>

        <SidebarNav current={view} onNavigate={onNavigate} />

        <SidebarFooter onOpenSettings={onOpenSettings} theme={theme} onThemeChange={onThemeChange} />
      </aside>

      {children}
    </div>
  )
}

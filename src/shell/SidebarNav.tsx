import { useState, type ReactNode } from 'react'
import { NAV, LIBRARY_VIEWS, DEFAULT_EXPANDED, type NavNode, type ViewId } from '@/shell/views'

/**
 * 侧栏导航 —— 树形，一级项可点击展开/收缩。
 *
 * 与 paba 的差异：paba 是扁平的（一级项 + 一个静态标签）。
 * 这里一级项自带 chevron，点击切换子项显隐。
 *
 * 收起态（68px 图标轨）不显示 chevron 与子项 —— 与 paba 一致。
 */

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

export function SidebarNav({
  current, onNavigate, onOpenLibrary,
}: {
  current: ViewId
  onNavigate: (id: ViewId) => void
  /** 打开「更多」抽屉（三个库的入口） */
  onOpenLibrary: () => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(DEFAULT_EXPANDED))

  const toggle = (label: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })

  return (
    <nav className="hm-nav" id="hm-sidebar-nav" aria-label="主导航">
      {NAV.map((node) => {
        if (node.children) {
          return (
            <NavGroup
              key={node.label}
              node={node}
              current={current}
              open={expanded.has(node.label)}
              onToggle={() => toggle(node.label)}
              onNavigate={onNavigate}
            />
          )
        }

        /* 库入口：不是跳转，点开抽屉选具体哪个库。
           三个库当前所在的页面就在这一项上高亮。 */
        if (node.library) {
          const inLibrary = LIBRARY_VIEWS.some((v) => v.id === current)
          return (
            <button
              key={node.label}
              type="button"
              className="nav-leaf nav-library"
              aria-current={inLibrary ? 'page' : undefined}
              aria-haspopup="dialog"
              aria-label="更多：特效库、参考片库、我的素材"
              onClick={onOpenLibrary}
            >
              <Icon name={node.icon} />
              <span className="hm-nav-text">{node.label}</span>
              {/* 当前所在库的名字，让"更多"不只是个省略号 */}
              {inLibrary && (
                <span className="nav-library-cur">
                  {LIBRARY_VIEWS.find((v) => v.id === current)?.label}
                </span>
              )}
            </button>
          )
        }

        /* 占位项：还没开发。渲染成按钮，点了给提示，不跳转到空页面。 */
        if (node.placeholder) {
          return (
            <button
              key={node.label}
              type="button"
              className="nav-leaf nav-placeholder"
              data-soon="true"
              title={`${node.label}（开发中）`}
              onClick={() => window.dispatchEvent(new CustomEvent('fm-toast', { detail: `${node.label}正在开发中` }))}
            >
              <Icon name={node.icon} />
              <span className="hm-nav-text">{node.label}</span>
            </button>
          )
        }

        return (
          <a
            key={node.id}
            href={`#${node.id}`}
            className="nav-leaf"
            aria-current={current === node.id ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); onNavigate(node.id as ViewId) }}
          >
            <Icon name={node.icon} />
            <span className="hm-nav-text">{node.label}</span>
          </a>
        )
      })}
    </nav>
  )
}

/** 侧栏底部：待发送 + 设置入口（paba 的 .hm-sidebar-bottom）*/
export function SidebarFooter({
  onOpenSettings, pendingSlot,
}: {
  onOpenSettings: () => void
  /** 「待发送」入口：放在底部工具区最上面 ——
   *  它是常驻功能入口，和设置一样属于"随时要用"的一类，
   *  不该混在页面导航（首页/工作流/素材库…）里。 */
  pendingSlot?: ReactNode
}) {
  return (
    <div className="hm-sidebar-bottom">
      {pendingSlot}
      <button type="button" className="nav-parent" onClick={onOpenSettings}>
        <Icon name="settings" />
        <span className="hm-nav-text">设置</span>
      </button>
    </div>
  )
}

function NavGroup({
  node, current, open, onToggle, onNavigate,
}: {
  node: NavNode
  current: ViewId
  open: boolean
  onToggle: () => void
  onNavigate: (id: ViewId) => void
}) {
  const hasActive = node.children!.some((c) => c.id === current)

  return (
    <div className="nav-group" data-open={open || undefined}>
      <button
        type="button"
        className="nav-parent"
        aria-expanded={open}
        data-active={hasActive || undefined}
        onClick={onToggle}
      >
        <Icon name={node.icon} />
        <span className="hm-nav-text">{node.label}</span>
        <svg className="nav-chevron ui-icon" aria-hidden="true">
          <use href="./assets/paba-icons.svg#chevron-right" />
        </svg>
      </button>

      {open && (
        <div className="nav-children">
          {node.children!.map((child) => (
            <a
              key={child.id}
              href={`#${child.id}`}
              aria-current={current === child.id ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); onNavigate(child.id) }}
            >
              <Icon name={child.icon} />
              <span className="hm-nav-text">{child.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

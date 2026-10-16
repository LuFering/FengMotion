import { useState } from 'react'
import { NAV, DEFAULT_EXPANDED, type NavNode, type ViewId } from '@/shell/views'

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
      <use href={`/assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

export function SidebarNav({
  current, onNavigate,
}: {
  current: ViewId
  onNavigate: (id: ViewId) => void
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
      {NAV.map((node) =>
        node.children ? (
          <NavGroup
            key={node.label}
            node={node}
            current={current}
            open={expanded.has(node.label)}
            onToggle={() => toggle(node.label)}
            onNavigate={onNavigate}
          />
        ) : (
          <a
            key={node.id}
            href={`#${node.id}`}
            className="nav-leaf"
            aria-current={current === node.id ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); onNavigate(node.id!) }}
          >
            <Icon name={node.icon} />
            <span className="hm-nav-text">{node.label}</span>
          </a>
        ),
      )}
    </nav>
  )
}

/** 侧栏底部：设置入口（paba 的 .hm-sidebar-bottom）*/
export function SidebarFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="hm-sidebar-bottom">
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
          <use href="/assets/paba-icons.svg#chevron-right" />
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

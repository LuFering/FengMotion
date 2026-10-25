import { useState } from 'react'
import type { ThemeId } from '@/shell/settings-model'
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
      <use href={`./assets/paba-icons.svg#${name}`} />
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

const THEMES: Array<{ id: ThemeId; label: string; next: string }> = [
  { id: 'dark', label: '深色', next: '浅色' },
  { id: 'light', label: '浅色', next: '触感' },
  { id: 'tactile', label: '触感', next: '深色' },
]

function ThemeIcon({ theme }: { theme: ThemeId }) {
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />
      </svg>
    )
  }
  if (theme === 'light') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 3.8a8.2 8.2 0 0 0 0 16.4Z" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="8.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 侧栏底部：主题切换 + 设置入口（paba 的 .hm-sidebar-bottom）*/
export function SidebarFooter({
  onOpenSettings, theme, onThemeChange,
}: {
  onOpenSettings: () => void
  theme: ThemeId
  onThemeChange: (theme: ThemeId) => void
}) {
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]
  return (
    <div className="hm-sidebar-bottom">
      <button type="button" className="hm-theme-btn"
              title={`当前${current.label}主题，点击切换为${next.label}主题`}
              aria-label={`当前${current.label}主题，点击切换为${next.label}主题`}
              onClick={() => onThemeChange(next.id)}>
        <span className="hm-theme-icon-wrap" key={theme} data-theme-icon={theme}>
          <ThemeIcon theme={theme} />
        </span>
        <span className="hm-nav-text">{current.label}主题</span>
      </button>
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

/**
 * SessionRow —— 会话列表的一行。
 *
 * 结构取自 BoardUI 免费聊天模板的会话轨道（`agent-chat-history.tsx`）：
 *   · 行高 28px 上下内边距、圆角、选中态底色
 *   · 相对时间徽标在行尾
 *   · 「更多」菜单在悬停/聚焦时出现
 *
 * 与上游的差异：上游把「新建 / 重命名 / 未读 / 删除 / 导出」做在一个 260px
 * 的独立卡片里；本项目左栏已经是「项目 → 会话」两级树，会话行是树的叶子，
 * 所以只取「行」这一层的几何与交互，卡片容器由现有左栏提供。
 */

import { useState, type ReactNode } from 'react'
import { MoreHorizontal, Pin } from 'lucide-react'
import './session-row.css'

export interface SessionRowProps {
  title: string
  /** 相对时间文案（如「3 天前」）；不传就不显示 */
  time?: string
  /** 选中态 */
  active?: boolean
  pinned?: boolean
  /** 「仅本页」等标记 */
  flag?: string
  /** 正在行内改名 */
  editing?: boolean
  editValue?: string
  onEditValueChange?: (v: string) => void
  onEditCommit?: () => void
  onEditCancel?: () => void
  onSelect?: () => void
  /** 「更多」菜单内容（由调用方给，因为菜单项属于业务） */
  menu?: ReactNode
  menuOpen?: boolean
  onMenuToggle?: () => void
  /** 拖拽改归属 */
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  dataState?: string
}

export function SessionRow({
  title,
  time,
  active,
  pinned,
  flag,
  editing,
  editValue,
  onEditValueChange,
  onEditCommit,
  onEditCancel,
  onSelect,
  menu,
  menuOpen,
  onMenuToggle,
  draggable,
  onDragStart,
  dataState,
}: SessionRowProps) {
  const [hovered, setHovered] = useState(false)

  if (editing) {
    return (
      <div className="sr-row is-editing" data-active={active || undefined}>
        <input
          className="sr-edit"
          autoFocus
          value={editValue ?? ''}
          aria-label="重命名会话"
          onChange={(e) => onEditValueChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onEditCommit?.()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onEditCancel?.()
            }
          }}
          onBlur={() => onEditCommit?.()}
        />
      </div>
    )
  }

  return (
    <div
      className="sr-row"
      data-active={active || undefined}
      data-state={dataState}
      data-hovered={hovered || menuOpen || undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button type="button" className="sr-main" onClick={onSelect} title={title} aria-current={active}>
        {pinned ? <Pin size={11} className="sr-pin" aria-label="已置顶" /> : null}
        <span className="sr-title">{title}</span>
        {flag ? (
          <span className="sr-flag">{flag}</span>
        ) : time ? (
          <span className="sr-time">{time}</span>
        ) : null}
      </button>

      {menu ? (
        <div className="sr-menu-wrap">
          <button
            type="button"
            className="sr-more"
            aria-label={`${title} 的操作`}
            aria-expanded={!!menuOpen}
            onClick={(e) => {
              e.stopPropagation()
              onMenuToggle?.()
            }}
          >
            <MoreHorizontal size={13} />
          </button>
          {menuOpen ? <div className="sr-menu">{menu}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

export default SessionRow

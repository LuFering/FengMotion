import type * as React from 'react'
import '@/styles/project-tile.css'

/**
 * 项目色块：项目名首字 + 按项目名固定生成的色相。
 * 对话页左栏、对话页标题、工作台项目栏共用 —— 同一个项目在三处是同一个颜色，
 * 不同项目一眼能分开；不再用通用的胶片 / 文件夹图标。
 */
export function ProjectTile({ name, size = 'md', className }: { name: string; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const glyph = Array.from(name.trim())[0]?.toUpperCase() ?? '·'
  let hash = 0
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return (
    <span className={`project-tile${className ? ` ${className}` : ''}`} data-size={size} aria-hidden="true"
          style={{ '--tile-h': String(hash % 360) } as React.CSSProperties}>
      {glyph}
    </span>
  )
}

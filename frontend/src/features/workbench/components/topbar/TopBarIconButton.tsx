import React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

/**
 * 统一顶级纯图标按钮组件（32px 点击区域、18px 居中图标、无底色悬停轻灰、开启浅蓝）
 * 内置 Tooltip 与禁用说明，支持在有菜单展开时抑制 Tooltip 避免双层覆盖。
 */
export function TopBarIconButton({
  icon,
  label,
  tooltip,
  active,
  disabled,
  disabledReason,
  onClick,
  suppressTooltip,
  className = '',
}: {
  icon: React.ReactNode
  label: string
  tooltip?: string
  active?: boolean
  disabled?: boolean
  disabledReason?: string
  onClick?: () => void
  suppressTooltip?: boolean
  className?: string
}) {
  const tooltipText = disabled ? disabledReason || tooltip || label : tooltip || label

  const button = (
    <button
      type="button"
      className={`wb-topbar-icon-btn ${active ? 'wb-topbar-icon-btn-active' : ''} ${className}`}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      onClick={disabled ? undefined : onClick}
    >
      {icon}
    </button>
  )

  if (suppressTooltip) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span className="inline-flex cursor-not-allowed">{button}</span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  )
}

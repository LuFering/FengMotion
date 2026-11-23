import type * as React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import '@/styles/menu-select.css'

export interface MenuOption {
  value: string
  label: string
  count?: number
  disabled?: boolean
}

export interface MenuSelectProps {
  /** 按钮上的固定文字；为空时只显示当前值（排序用） */
  label: string
  value: string
  options: MenuOption[]
  onChange: (value: string) => void
  /** 「不限」对应的值：选中它时按钮不高亮、不显示值 */
  allValue?: string
  icon?: React.ReactNode
  /** 无边框的弱化样式（排序） */
  quiet?: boolean
  ariaLabel: string
  align?: 'start' | 'end'
  disabled?: boolean
  className?: string
}

/**
 * 全站单选下拉（替换原生 <select>）。由特效库原 FxMenuSelect 提出（已删除），样式见 styles/menu-select.css。
 * 用共享 DropdownMenu（radix）：Esc 关闭、方向键选择、焦点归还都由组件负责，弹出样式跟随主题。
 */
export function MenuSelect({ label, value, options, onChange, allValue, icon, quiet, ariaLabel, align = 'start', disabled, className }: MenuSelectProps) {
  const selected = options.find((o) => o.value === value)
  const active = allValue !== undefined && value !== allValue
  const showValue = allValue === undefined || active
  const cls = ['fm-menubtn', quiet && 'is-quiet', className].filter(Boolean).join(' ')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cls}
          data-on={active ? '' : undefined}
          aria-label={`${ariaLabel}：${selected?.label ?? ''}`}
        >
          {icon}
          {label && <span className="fm-menubtn-label">{label}</span>}
          {showValue && selected && (
            <span className="fm-menubtn-value" data-sep={label ? '' : undefined}>{selected.label}</span>
          )}
          <UiIcon icon={SemIcons.collapse} size="xs" className="fm-menubtn-chev" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="fm-menu w-auto min-w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} disabled={o.disabled} className="fm-menu-item">
              <span className="fm-menu-text">{o.label}</span>
              {o.count !== undefined && <span className="fm-menu-count">{o.count}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

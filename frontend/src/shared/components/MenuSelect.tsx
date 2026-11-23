import { Fragment } from 'react'
import type * as React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
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
  /** 分组名：相邻同组的选项归到一个小标题下（替代原生 <optgroup>） */
  group?: string
  /** 悬停提示（替代原生 <option title>） */
  title?: string
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
  /** 表单字段样式：占满一行、左对齐值、右侧箭头（检查器、导入审阅里的字段） */
  field?: boolean
  /** 当前值不在选项里时按钮上显示的文字 */
  placeholder?: string
  /** 按钮的悬停提示 */
  title?: string
  ariaLabel: string
  align?: 'start' | 'end'
  disabled?: boolean
  className?: string
}

/**
 * 全站单选下拉（替换原生 <select>）。由特效库原 FxMenuSelect 提出（已删除），样式见 styles/menu-select.css。
 * 用共享 DropdownMenu（radix）：Esc 关闭、方向键选择、焦点归还都由组件负责，弹出样式跟随主题。
 */
export function MenuSelect({ label, value, options, onChange, allValue, icon, quiet, field, placeholder, title, ariaLabel, align = 'start', disabled, className }: MenuSelectProps) {
  const selected = options.find((o) => o.value === value)
  const active = allValue !== undefined && value !== allValue
  const showValue = allValue === undefined || active
  const cls = ['fm-menubtn', quiet && 'is-quiet', field && 'is-field', className].filter(Boolean).join(' ')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cls}
          data-on={active ? '' : undefined}
          title={title}
          aria-label={`${ariaLabel}：${selected?.label ?? placeholder ?? ''}`}
        >
          {icon}
          {label && <span className="fm-menubtn-label">{label}</span>}
          {showValue && (selected || placeholder) && (
            <span className="fm-menubtn-value" data-sep={label ? '' : undefined} data-placeholder={selected ? undefined : ''}>
              {selected?.label ?? placeholder}
            </span>
          )}
          <UiIcon icon={SemIcons.collapse} size="xs" className="fm-menubtn-chev" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={field ? 'fm-menu fm-menu-field w-auto' : 'fm-menu w-auto min-w-44'}>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((o, i) => (
            <Fragment key={o.value}>
              {o.group && o.group !== options[i - 1]?.group && (
                <DropdownMenuLabel className="fm-menu-group">{o.group}</DropdownMenuLabel>
              )}
              <DropdownMenuRadioItem value={o.value} disabled={o.disabled} title={o.title} className="fm-menu-item">
                <span className="fm-menu-text">{o.label}</span>
                {o.count !== undefined && <span className="fm-menu-count">{o.count}</span>}
              </DropdownMenuRadioItem>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

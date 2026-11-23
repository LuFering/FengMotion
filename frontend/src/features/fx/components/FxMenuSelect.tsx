import type * as React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'

export interface FxMenuOption {
  value: string
  label: string
  count?: number
}

export interface FxMenuSelectProps {
  /** 按钮上的固定文字；为空时只显示当前值（排序用） */
  label: string
  value: string
  options: FxMenuOption[]
  onChange: (value: string) => void
  /** 「不限」对应的值：选中它时按钮不高亮、不显示值 */
  allValue?: string
  icon?: React.ReactNode
  /** 无边框的弱化样式（排序） */
  quiet?: boolean
  ariaLabel: string
  align?: 'start' | 'end'
}

/**
 * 特效库工具条的单选下拉：分类、来源、排序共用一款。
 * 用共享 DropdownMenu（radix）：Esc 关闭、方向键选择、焦点归还都由组件负责，
 * 弹出样式跟随主题，不再是系统原生下拉。见 docs/contracts/fx-library-ui.md §6。
 */
export function FxMenuSelect({ label, value, options, onChange, allValue, icon, quiet, ariaLabel, align = 'start' }: FxMenuSelectProps) {
  const selected = options.find((o) => o.value === value)
  const active = allValue !== undefined && value !== allValue
  const showValue = allValue === undefined || active
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={quiet ? 'fx-menubtn is-quiet' : 'fx-menubtn'}
          data-on={active ? '' : undefined}
          aria-label={`${ariaLabel}：${selected?.label ?? ''}`}
        >
          {icon}
          {label && <span className="fx-menubtn-label">{label}</span>}
          {showValue && selected && (
            <span className="fx-menubtn-value" data-sep={label ? '' : undefined}>{selected.label}</span>
          )}
          <UiIcon icon={SemIcons.collapse} size="xs" className="fx-menubtn-chev" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="fx-menu w-auto min-w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className="fx-menu-item">
              <span className="fx-menu-text">{o.label}</span>
              {o.count !== undefined && <span className="fx-menu-count">{o.count}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

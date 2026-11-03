import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

/**
 * Workbench segmented control: one sliding indicator, 200ms ease-out.
 * Used for 结构/产物 and 对话/任务/参数.
 */
export function SegmentedControl<T extends string>({
  value, options, onChange, ariaLabel, className,
}: {
  value: T | ''
  options: Array<SegmentedOption<T>>
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  const selectedIndex = options.findIndex((option) => option.value === value)
  return (
    <div className={cn('fm-seg', className)} role="tablist" aria-label={ariaLabel}
         style={{ '--fm-seg-index': Math.max(0, selectedIndex), '--fm-seg-count': options.length } as CSSProperties}>
      <span className="fm-seg-thumb" data-hidden={selectedIndex < 0 ? '' : undefined} aria-hidden="true" />
      {options.map((option) => (
        <button key={option.value} type="button" role="tab"
                className="fm-seg-item" aria-selected={selectedIndex >= 0 && option.value === value}
                onClick={() => onChange(option.value)}>
          {option.icon}{option.label}
        </button>
      ))}
    </div>
  )
}

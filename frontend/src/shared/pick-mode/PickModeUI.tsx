/**
 * 多选模式的两个 UI 件：入口按钮 + 底部确认条。
 * 与 usePickMode 配对使用，三库共用（素材库 / 参考片库 / 特效库）。
 *
 * 风格沿用素材库的 .mya-pickbtn / .mya-pickbar，
 * 但用独立类名 .pk-*，避免依赖素材库的样式文件顺序。
 */
import type { ReactNode } from 'react'

/** 入口按钮：进入多选模式 */
export function PickButton({
  onClick, label = '选择', icon,
}: {
  onClick: () => void
  /** 按钮文字：素材 / 片段 / 特效 */
  label?: string
  icon?: ReactNode
}) {
  return (
    <button type="button" className="pk-btn" onClick={onClick}>
      {icon ?? (
        <svg className="pk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M8 12l3 3 5-6" />
        </svg>
      )}
      选择{label}
    </button>
  )
}

/** 底部确认条：报数 / 全选 / 取消 / 确认 */
export function PickBar({
  count, total, onSelectAll, onCancel, onConfirm, noun = '项',
}: {
  count: number
  /** 当前可见条数，用于「全选当前 N 项」 */
  total: number
  onSelectAll: () => void
  onCancel: () => void
  onConfirm: () => void
  noun?: string
}) {
  return (
    <div className="pk-bar" role="region" aria-label="选择模式">
      <span className="pk-bar-n">
        {count > 0 ? `已选 ${count} ${noun}` : '点击卡片选择'}
      </span>
      <button type="button" className="pk-bar-all" onClick={onSelectAll}>
        全选当前 {total} {noun}
      </button>
      <span className="pk-bar-sep" aria-hidden="true" />
      <button type="button" className="pk-bar-cancel" onClick={onCancel}>取消</button>
      <button type="button" className="pk-bar-ok" disabled={count === 0} onClick={onConfirm}>
        <svg className="pk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M8 12l3 3 5-6" />
        </svg>
        确认加入待发送{count > 0 ? `（${count}）` : ''}
      </button>
    </div>
  )
}

/** 卡片左上角的选中框：只在多选模式里出现 */
export function PickCheck({ checked }: { checked: boolean }) {
  return (
    <span className="pk-check" data-on={checked || undefined} aria-hidden="true">
      {checked && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l4 4 10-10" />
        </svg>
      )}
    </span>
  )
}

/**
 * ContextRing —— 输入框底栏的上下文容量指示。
 *
 * 严格取自 LeiBox `ContextCapacityIndicator`：
 *   · 按钮 h-8 w-8 圆形，内部 16×16（h-4 w-4）环形进度
 *   · strokeWidth 12.5（相对 100 的 viewBox），圆头线帽
 *   · 轨道色 = 次要色 30% 混背景；进度色按三档：
 *       < 80% 次要灰 / ≥ 80% 琥珀 / ≥ 92% 红（capacityTone）
 *   · 环本身**不显示数字**，数值放 hover 卡片里
 */

import { useState } from 'react'
import './context-ring.css'

export interface ContextRingProps {
  /** 已占用 token；null 表示未知 */
  used: number | null
  /** 上下文窗口；null 表示未知 */
  window: number | null
}

/** 与大数字缩写一致：12345 → 12.3k。 */
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

export function ContextRing({ used, window: win }: ContextRingProps) {
  const [open, setOpen] = useState(false)
  /* 没有分母就不给占用率：那只能编一个数。空环 = 明确表达「还不知道」。 */
  const known = used !== null && win !== null && win > 0
  const ratio = known ? Math.max(0, Math.min(1, (used as number) / (win as number))) : 0
  const pct = Math.round(ratio * 100)

  /* 三档取色，阈值与原版 capacityTone 一致 */
  const stroke = !known ? 'var(--dim)'
    : ratio >= 0.92 ? 'var(--bad)'
    : ratio >= 0.8 ? 'var(--warn)'
    : 'var(--tx2)'

  /* 半径 15.9 + strokeWidth 12.5 的 viewBox 100 方案，与原版
     react-circular-progressbar 的描边比例对齐（环比轨道细，圆头） */
  const R = 44
  const C = 2 * Math.PI * R

  return (
    <span className="cring-wrap">
      <button
        type="button"
        className="cring-btn"
        aria-label={known ? `上下文占用 ${pct}%` : '上下文占用未知'}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <svg className="cring-svg" viewBox="0 0 100 100" aria-hidden>
          <circle
            cx="50" cy="50" r={R}
            fill="none"
            stroke="color-mix(in srgb, var(--tx2) 30%, var(--bg))"
            strokeWidth="12.5"
          />
          {known ? (
            <circle
              cx="50" cy="50" r={R}
              fill="none"
              stroke={stroke}
              strokeWidth="12.5"
              strokeLinecap="round"
              strokeDasharray={`${C * ratio} ${C}`}
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dasharray 300ms' }}
            />
          ) : null}
        </svg>
      </button>

      {open ? (
        <span className="cring-pop" role="tooltip">
          <span className="cring-pop-row">
            <span className="cring-pop-title">预计下一次请求</span>
            <span className="cring-pop-pct">{known ? `${pct}%` : '—'}</span>
          </span>
          <span className="cring-pop-sub">
            {known ? `${fmt(used as number)} / ${fmt(win as number)}` : '这一轮还没上报用量'}
          </span>
        </span>
      ) : null}
    </span>
  )
}

export default ContextRing

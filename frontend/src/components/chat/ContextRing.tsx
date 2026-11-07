/**
 * ContextRing —— 输入框底栏的上下文容量指示。
 *
 * 形态取自 LeiBox「Agent 对话输入框」的 ContextCapacityIndicator：
 *   · 一圈环形进度，中心是百分比数字
 *   · 低于 80% 用次要灰，80–92% 转琥珀，≥92% 转红
 *     （原版 capacityTone 的三档阈值）
 *   · 悬停显示已用 / 窗口 的具体 token 数
 *
 * 这是原版底栏左侧第一个元素。之前本项目只在消息流里放了一条 Bar，
 * 输入框旁边看不到「这轮还剩多少上下文」，发长对话时容易一头撞上压缩。
 */

import './context-ring.css'

export interface ContextRingProps {
  /** 已占用 token；null 表示未知 */
  used: number | null
  /** 上下文窗口；null 表示未知 */
  window: number | null
}

/** 按占用比例分档取色（阈值与原版一致）。 */
function toneOf(ratio: number): string {
  if (ratio >= 0.92) return 'var(--bad)'
  if (ratio >= 0.8) return 'var(--warn)'
  return 'var(--dim)'
}

/** 大数字缩写：12345 → 12.3k。 */
function short(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

export function ContextRing({ used, window }: ContextRingProps) {
  /* 没有分母就不画占用率：那只能编一个数出来。
     未知时显示一个空环，明确表达「还不知道」。 */
  const known = used !== null && window !== null && window > 0
  const ratio = known ? Math.max(0, Math.min(1, (used as number) / (window as number))) : 0
  const pct = Math.round(ratio * 100)
  const stroke = toneOf(ratio)
  const r = 8
  const c = 2 * Math.PI * r

  return (
    <span
      className="cring"
      title={known
        ? `上下文占用 ${used} / ${window} tokens（${pct}%）`
        : '上下文占用未知：这一轮还没上报用量'}
      aria-label={known ? `上下文占用 ${pct}%` : '上下文占用未知'}
    >
      <svg className="cring-svg" viewBox="0 0 20 20" aria-hidden>
        {/* 底环：始终画满，让「空环」也能被看见 */}
        <circle cx="10" cy="10" r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
        {known ? (
          <circle
            cx="10"
            cy="10"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${c * ratio} ${c}`}
            transform="rotate(-90 10 10)"
          />
        ) : null}
      </svg>
      {known ? <span className="cring-pct num">{short(used as number)}</span> : null}
    </span>
  )
}

export default ContextRing

/**
 * ThinkingIndicator —— 「AI 正在想」的状态。
 *
 * 第 4 项：用 ThinkingOrbs（MIT 真源码，已在项目里）。
 *
 * 状态映射（不是随便挑一个好看的）：
 *   · 正在生成正文       → `working`（粒子沿轨道运行）
 *   · 正在检索/工具调用   → `searching`（扫描线掠过点阵）
 *   · 正在规划/推理       → `solving`（色带错位后归位）
 *   · 正在连接模型        → `connecting`（星座自己接线）
 *   · 排队等待            → `breathing`（正面环缓慢形变）
 *
 * 尺寸只用 20（内联文字尺度）与 32（紧凑）—— ThinkingOrbs 的 size
 * 是三个手工调过的值，不是任意缩放。这里不用 64：
 * 64 是头像尺度，放进消息流会把一行文字顶成两行。
 */

import { ThinkingOrb, type OrbState } from './thinking-orbs'
import './thinking-indicator.css'

export type ThinkingPhase = 'working' | 'searching' | 'solving' | 'connecting' | 'breathing'

const PHASE_LABEL: Record<ThinkingPhase, string> = {
  working: '正在生成',
  searching: '正在检索',
  solving: '正在推理',
  connecting: '正在连接',
  breathing: '排队等待',
}

export function ThinkingIndicator({
  phase = 'working',
  label,
  /** 计时秒数；不传就不显示 */
  elapsed,
  size = 20,
  className,
}: {
  phase?: ThinkingPhase
  /** 覆盖默认文案 */
  label?: string
  elapsed?: number
  size?: 20 | 32
  className?: string
}) {
  const text = label ?? PHASE_LABEL[phase]
  return (
    <div className={`ti${className ? ` ${className}` : ''}`} role="status">
      <ThinkingOrb state={phase as OrbState} size={size} />
      <span className="ti-label">{text}</span>
      {elapsed !== undefined ? <span className="ti-elapsed">{formatElapsed(elapsed)}</span> : null}
    </div>
  )
}

/** 秒 → "0:07" / "1:23"。超过 99 分钟就不再涨，避免出现无意义的四位数 */
function formatElapsed(sec: number) {
  const total = Math.min(Math.max(0, Math.floor(sec)), 99 * 60 + 59)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default ThinkingIndicator

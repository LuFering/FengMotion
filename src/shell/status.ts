import type { UnitStatus } from '@/data/productionData'

/**
 * 状态呈现的唯一来源（工作台语言）。
 *
 * 语义分工（各司其职不混用）：
 *   acc   蓝   = 进行中
 *   warn  琥珀 = 等待用户决定（不是失败）
 *   ok    绿   = 完成
 *   bad   红   = 失败
 *
 * ⚠️ 这里只给「语义键」`s`，不给颜色类名 ——
 *    颜色由 .fm-dot[data-s] / .fm-tag[data-s] 决定（见 fm-components.css），
 *    组件里不许自己写颜色。上一版这里是 shadcn 的 Badge variant，已随
 *    旧设计系统一起废弃：工作台不再有 Badge，只有点 / 标签两种承载。
 *
 * 呈现规则（不许只靠颜色）：
 *   正常态（done）→ 安静的小圆点；
 *   异常态 → 圆点 + 文字标签，一眼看见。
 */
export type AnyStatus = UnitStatus | 'passed' | 'pending'

export type StatusKey = 'done' | 'running' | 'waiting' | 'failed' | 'idle'

export interface StatusStyle {
  label: string
  /** 状态键，交给 .fm-dot[data-s] / .fm-tag[data-s] */
  s: StatusKey
}

const MAP: Record<AnyStatus, StatusStyle> = {
  done:      { label: '定稿',       s: 'done' },
  passed:    { label: '已通过',     s: 'done' },
  running:   { label: '进行中',     s: 'running' },
  waiting:   { label: '等你选',     s: 'waiting' },
  failed:    { label: '需处理',     s: 'failed' },
  idle:      { label: '待做',       s: 'idle' },
  pending:   { label: '未开始',     s: 'idle' },
  /** 有合成文件但未列入 PROGRESS.md —— 既不是待做，也不该算完成。 */
  untracked: { label: '未列入进度', s: 'idle' },
}

export const statusOf = (s: AnyStatus): StatusStyle => MAP[s]

/** 时长格式化：3.9s / 2:32.0 */
export const fmtDuration = (sec: number) =>
  sec >= 60
    ? `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`
    : `${sec.toFixed(1)}s`

import { sessionTimeLabel } from '@/features/chat/model/sessionDisplay'

/** 诊断类型的兜底文案（后端一般会给 detail）。 */
export const DIAGNOSTIC_LABEL: Record<string, string> = {
  compaction: '上下文已压缩，早期对话被摘要替代',
  'max-tokens': '本回合达到 token 上限，回复可能不完整',
  retry: '模型调用失败，正在重试',
  interrupted: '本轮被中断',
}

/* 相对时间（对齐 dsh time.ago：刚刚 / N分钟 / N小时 / N天 / N个月 / N年） */
/**
 * 会话列表的时间 —— 与工作台侧栏**共用同一套规则**（`sessionTimeLabel`）。
 *
 * <p>原先这里自己算相对时间（「6天前」），侧栏用 `toLocaleTimeString`（「17:29」），
 * 同一个时间在两处长得不一样；更糟的是侧栏那种写法让六天前和今天无法区分。
 * 现在两处都调共享实现，今天给相对时间、跨天给「昨天 / 9月3日」。</p>
 */
export const fmtAgo = (t: number): string => sessionTimeLabel(t)

/* 绝对时间（对齐 dsh date.ymd / hover.created 的「创建于」） */
export function fmtWhen(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

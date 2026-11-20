import { useEffect, useState } from 'react'
import { RunningDivider, ThinkingIndicator } from '@/features/chat/components'
import { shortArgs } from '@/features/chat/components/toolDisplay'

export interface AgentPhase { phase: string; label?: string; callId?: string; arguments?: string; isError?: boolean }

/**
 * 一轮回复运行期间常驻在对话最底部的状态行：此刻在做什么，加上已用时长。
 *
 * <p>照 dsh 的 RunningStatus：只要这一轮还在跑，它就是最后一行，跟着内容往下走；
 * 正文开始输出后也不消失（以前只在「还没有正文」时显示，正文一出来就不知道它还在不在干活）。
 * 阶段取后端透传的真实状态，不按时长猜。整轮结束才撤掉。</p>
 *
 * @param startedAt 这一轮开始的时间（毫秒）；没有就不显示计时
 * @param hasText   这一轮是否已经开始输出正文
 */
export function LiveRunStatus({ phase, startedAt, hasText, afterUser, label: override }: {
  phase: AgentPhase | null
  startedAt: number | null
  hasText: boolean
  afterUser: boolean
  /** 调用方知道更具体的阶段时（例如工作台的「正在渲染视频画面」）直接给文案 */
  label?: string
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  const detail = phase?.arguments ? shortArgs(phase.arguments) : ''
  const label = override ?? (phase?.phase === 'tool'
    ? phase.isError
      ? `工具失败：${phase.label ?? '工具调用'}`
      : `正在调用 ${phase.label ?? '工具'}${detail ? ` · ${detail.length > 40 ? `${detail.slice(0, 40)}…` : detail}` : ''}`
    : phase?.phase === 'thinking'
      ? '正在思考'
      : hasText ? '正在生成回复' : '正在处理')

  return (
    <div className="cv3-live-status">
      {/* dsh 只在「上一块不是用户消息」时画这条 0.5px 分隔线：紧跟用户发言时气泡本身就够分隔 */}
      {afterUser ? null : <RunningDivider />}
      {/* 状态与当前阶段一一对应（thinking / tool / 回复），不是随便挑一个好看的动画 */}
      <ThinkingIndicator
        phase={phase?.phase === 'thinking' ? 'solving' : phase?.phase === 'tool' ? 'searching' : 'working'}
        label={label}
        elapsed={startedAt ? Math.max(0, now - startedAt) / 1000 : undefined}
      />
    </div>
  )
}

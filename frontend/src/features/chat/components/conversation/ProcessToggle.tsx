import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import type { ProcessSummary } from '@/features/chat/model/processSummary'

/**
 * 一轮结束后执行过程收成的这一行：「已完成 · 思考 2 段 · 调用工具 9 次」，点开回看全部过程。
 *
 * <p>只写真实计数，不写用时：历史消息里没有这一轮的起止时间，拿消息时间去减会得到一个假数字。</p>
 */
export function ProcessToggle({ summary, open, onToggle }: { summary: ProcessSummary; open: boolean; onToggle: () => void }) {
  const parts = [
    summary.thoughts > 0 ? `思考 ${summary.thoughts} 段` : null,
    summary.tools > 0 ? `调用工具 ${summary.tools} 次` : null,
  ].filter(Boolean)
  return (
    <button type="button" className="cv3-process-toggle" aria-expanded={open} onClick={onToggle}>
      <span className="cv3-process-title">已完成</span>
      <span className="cv3-process-meta">{parts.join(' · ')}</span>
      {summary.failed > 0 ? <span className="cv3-process-failed">{summary.failed} 次失败</span> : null}
      <UiIcon icon={SemIcons.collapse} size="sm" className={`cv3-process-caret${open ? ' is-open' : ''}`} aria-hidden />
    </button>
  )
}

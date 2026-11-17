/**
 * 侧栏的「本轮过程」折叠摘要。
 *
 * <p>为什么侧栏需要它：完整对话区有思考与工具调用的过程区，
 * 而工作台侧栏只显示 AI 正文 —— 用户在**最关心「AI 到底改了什么」的地方**
 * 反而看不到执行过程。</p>
 *
 * <p>但侧栏窄，不能照搬对话区那套完整任务列表。这里只做三件事：
 * 一行摘要（「执行了 3 步 · bash 2 次」）+ 展开看细节 + 状态可区分。
 * 默认收起。</p>
 *
 * <p><strong>只显示消息里真实携带的数据</strong>：不按消息长度猜步骤数，
 * 不根据「有没有新版本」倒推做过什么。没有 {@code executedTools} 就整个不渲染。
 * 这些数据随消息从服务端读回（`useSessions.toViewMessage`），
 * 所以刷新、切页、切换会话后仍在。</p>
 */
import { useState } from 'react'
import { ChevronDown, CircleAlert } from 'lucide-react'
import { summarizeTools, toolLabel, firstLine, toolStepState, TOOL_STATE_LABEL, type ProcessToolCall } from './processSummary'

export type { ProcessToolCall }

export interface ProcessSummaryProps {
  /** 消息自带的过程记录；为空则整个组件不渲染 */
  tools?: ProcessToolCall[]
  /** 本轮是否仍在执行（决定用现在时还是完成时） */
  running?: boolean
}

export function ProcessSummary({ tools, running = false }: ProcessSummaryProps) {
  const [open, setOpen] = useState(false)

  /* 没有真实过程数据就不渲染 —— 空壳比没有更糟：
     用户会以为「这轮什么都没做」，而实际是数据没到。 */
  if (!tools || tools.length === 0) return null

  const failed = tools.filter((t) => t.isError).length
  const total = tools.length
  const summary = summarizeTools(tools)

  return (
    <div className="wb-process" data-running={running || undefined}>
      <button
        type="button"
        className="wb-process-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? '收起执行过程' : '展开执行过程'}
      >
        {/* 状态不能只靠颜色：执行中用「执行中」，结束时用「执行了」，
            失败数量用文字写出来，不靠红点。 */}
        <span className="wb-process-state">
          {running ? '正在执行' : `执行了 ${total} 步`}
        </span>
        <span className="wb-process-detail">{summary}</span>
        {failed > 0 && (
          <span className="wb-process-failed">
            <CircleAlert size={12} /> {failed} 步失败
          </span>
        )}
        <ChevronDown size={12} className={`wb-process-caret${open ? ' is-open' : ''}`} />
      </button>

      {open && (
        <ol className="wb-process-steps">
          {tools.map((t, i) => (
            <li key={t.callId ?? `${t.name}-${i}`} data-error={t.isError || undefined}>
              <span className="wb-process-tool">{toolLabel(t.name)}</span>
              {/* 参数只取第一行、截断：侧栏是速览，完整内容在完整对话区看 */}
              {t.arguments ? (
                <span className="wb-process-args num">{firstLine(t.arguments)}</span>
              ) : null}
              {/* 状态用文字，不用图标猜。
                  ⚠️ 缺失 done 时显示「状态未知」而不是「完成」：
                  后端只在收到结果事件时才回填 done，缺失意味着不知道结果。 */}
              <span className="wb-process-step-state" data-state={toolStepState(t, running)}>
                {TOOL_STATE_LABEL[toolStepState(t, running)]}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}


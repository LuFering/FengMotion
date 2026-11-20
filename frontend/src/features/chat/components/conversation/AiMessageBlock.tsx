import { useState } from 'react'
import { clearRoundOutcome, type RoundOutcome } from '@/features/chat/model/roundOutcomes'
import { splitAssistantTurn } from '@/features/chat/model/assistantTurn'
import { ThinkingIcon } from '@/features/chat/components/ToolIcons'
import { TaskList, AnswerBody, MarkdownText, AnswerActions, MessageActions } from '@/features/chat/components'
import { ProcessToggle } from '@/features/chat/components/conversation/ProcessToggle'
import { processSummary } from '@/features/chat/model/processSummary'
import { AssistantTurnContent } from '@/features/chat/components/AssistantTurnContent'
import { TypewriterText } from '@/features/chat/components/TypewriterText'
import { isSearchTool, WebSearchTrace } from '@/features/chat/components/WebSearchTrace'
import { toolCallsToTasks, toolCallsRevealed } from '@/features/chat/components/toolDisplay'
import { splitQuestionForms } from '@/features/chat/model/questionForm'
import { QuestionFormCard } from '@/features/chat/components/QuestionFormCard'
import { collectFileChanges } from '@/features/chat/model/fileChangesModel'
import { FileChanges } from '@/features/chat/components/FileChanges'
import { Deliverables } from '@/features/chat/components/Deliverables'
import { Notice } from '@/features/chat/components/conversation/Notice'
import type { Session } from '@/features/chat/hooks/useSessions'
import type { ChatMessage } from '@/features/chat/hooks/useChat'
import type { ConversationProps } from '@/features/chat/Conversation'

export interface AiMessageBlockProps {
  activeThread: Session | null
  getRoundOutcome: (userMessageId: string | undefined) => RoundOutcome | null
  m: ChatMessage
  messages: ChatMessage[]
  pending: boolean
  props: ConversationProps
  replySaveRetry: { sessionId: string; userMessageId: string; reply: string; localId: string } | null
  retryLastRound: () => void
  retrySaveReply: () => Promise<void>
  send: (text: string) => void
}

/** 对话线程里的一条 AI 回复：过程区（思考、工具调用）、正文与提问表单、失败提示、操作条，以及文件改动和交付产物。 */
export function AiMessageBlock({ activeThread, getRoundOutcome, m, messages, pending, props, replySaveRetry, retryLastRound, retrySaveReply, send }: AiMessageBlockProps) {
  /* 执行过程（思考、工具调用）在跑的时候展开，一轮结束后收成一行，点开可回看。
     中途失败的轮次保持展开：要看清卡在哪一步。用户手动开合过就以手动为准。 */
  const [processManual, setProcessManual] = useState<boolean | null>(null)
  const process = processSummary(m)
  const processOpen = processManual ?? (m.streaming === true || Boolean(m.failed))
  const hideProcess = process !== null && !processOpen
  return (
    <div className="cv3-ai-block" data-streaming={m.streaming || undefined}
         data-last={m.id === messages[messages.length - 1]?.id || undefined}>
      {process && m.streaming !== true && (
        <ProcessToggle summary={process} open={processOpen} onToggle={() => setProcessManual(!processOpen)} />
      )}
      {/* 「本轮未改动工程」按**轮次**显示：用这条回复的 taskId
          （= 触发它的用户消息 id）查共享 store。
          与工作台侧栏读同一份数据，取不到就不显示。 */}
      {(() => {
        const outcome = getRoundOutcome(m.taskId)
        if (!outcome) return null
        return (
          <Notice onDismiss={() => clearRoundOutcome(activeThread?.projectId, props.activeSessionId, outcome.userMessageId)}>
            本轮没有改动工程，也没有生成新版本
          </Notice>
        )
      })()}
      {/* ══ 过程区（turn-process）═══════════════════════════
          顺序照 dsh 的 ChatView：思考 → 工具调用 → 运行指示。
          这三块回答的是「它怎么做到的」，正文回答「结论是什么」，
          所以必须在正文之前、且视觉上更弱。 */}

      {/* 过程区按两类分开呈现：
          · 网页搜索 → WebSearchTrace（来源轨迹，它内部只认搜索类工具）
          · 其余工具 → TaskList（任务列表：一次任务 = 一个工具的多步调用）
          两者混在一张清单里会互相稀释 —— 搜索回答「查了什么来源」，
          任务列表回答「执行了哪几类动作」。 */}
      {(() => {
        /* 过程日志：思考与工具调用合成一张任务列表 —— 这正是
           BoardUI 任务列表的用法（一条日志里既有「正在思考」也有
           「执行了什么」）。搜索类不进来，它有自己的轨迹。 */
        /* 有分段时思考按阶段放回正文之间（见下方 AssistantTurnContent），这里不再整块重复。
           旧消息没有分段，仍在这里整块显示。 */
        const staged = splitAssistantTurn(m.text, m.executedTools ?? [], m.thinkingSegments ?? [])
          .some((block) => block.kind === 'reasoning')
        const tasks = [
          /* 思考用全文而不是 truncate：推理已经落库，界面却只显示
             开头 72 字，等于把存下来的内容又丢掉一次。多行排版见
             task-list.css 的 .tl-step--multiline。 */
          ...(m.thinking && !staged ? [{ title: '思考', icon: ThinkingIcon, steps: [{ label: m.thinking, multiline: true }] }] : []),
        ]
        if (tasks.length === 0 || hideProcess) return null
        return (
          <TaskList
            tasks={tasks}
            revealed={m.thinking ? 2 : 0}
            run={false}
            working={false}
          />
        )
      })()}
      {/* 演示适配器的工具摘要：同样用任务列表，保持两处一致 */}
      {!hideProcess && m.toolCalls && m.toolCalls.length > 0 && (
        <TaskList
          tasks={[{ title: '工具调用', steps: m.toolCalls.map((t) => ({ label: `${t.label}：${t.detail}` })) }]}
          revealed={1 + m.toolCalls.length}
          run={false}
          working={false}
        />
      )}

      {/* 正文：Markdown + 代码高亮。
          之前是手写 renderRich，只认 **加粗**、反引号、`1. ` 编号，
          表格/多级列表/代码块全都走样 —— 那等于把结构信息丢了。

          正文里还可能夹着 `<question-form>` 表单（模型提问的唯一方式，
          见 components/chat/questionForm.ts 的说明）。只在**流式结束后**
          解析：流到一半时 JSON 还没闭合，提前解析会得到半张表。 */}
      <AssistantTurnContent text={m.text} tools={m.executedTools} reasoning={m.thinkingSegments} hideProcess={hideProcess}
        /* 与整块思考、工具组用同一个 TaskList：同一条回复里的过程块长得一样 */
        renderReasoning={(text, last) => <TaskList
          tasks={[{ title: '思考', runningTitle: m.streaming === true && last ? '正在思考' : undefined,
            icon: ThinkingIcon, steps: [{ label: text, multiline: true }] }]}
          revealed={2} run={false} working={false} />}
        renderTools={(calls) => {
          const tools = calls.filter(call => !isSearchTool(call.name))
          return <>
            <WebSearchTrace calls={calls} live={m.streaming === true} revealed={calls.filter(call => isSearchTool(call.name)).length} />
            {tools.length > 0 && <TaskList tasks={toolCallsToTasks(tools, m.streaming === true)}
              revealed={toolCallsRevealed(tools)} run={false} working={false} />}
          </>
        }}
        renderText={(text) => <AnswerBody>
          <TypewriterText text={text} live={m.streaming === true}>{(visible, settled) => {
            /* 逐字输出期间只渲染已放出的前缀；放完且流式结束后才走完整渲染（含提问表单）。 */
            if (!settled) return <MarkdownText text={visible} streaming />
            const segs = splitQuestionForms(text)
            /* 没有表单就走原路径，不为「可能有」付额外渲染成本 */
            if (segs.length === 1 && segs[0].kind === 'text') {
              return <MarkdownText text={segs[0].text} />
            }
            return segs.map((seg, i) =>
              seg.kind === 'text'
                ? (seg.text.trim() ? <MarkdownText key={i} text={seg.text} /> : null)
                : (
                  <QuestionFormCard
                    key={i}
                    form={seg.form}
                    interactive={!pending && m.id === messages[messages.length - 1]?.id}
                    onSubmit={(msg) => {
                      /* 答案走普通用户消息 —— 这是绕开 dsh 工具应答通道的关键。
                         直接调 send 而不是 submit：send 收文本参数，
                         submit 是从输入框草稿里取的，这里不该污染草稿。 */
                      void send(msg)
                    }}
                  />
                ),
            )
          }}</TypewriterText>
        </AnswerBody>}
      />

      {/* 失败 / 演示标记：必须可见，不能只靠别处说明 */}
      {m.failed ? (
        <Notice tone="error" detail={m.failed}
          action={replySaveRetry && replySaveRetry.localId === m.id ? { label: '重试补存', onClick: () => void retrySaveReply() } : undefined}>
          这条回复没有完成{m.failed.length <= 40 ? `：${m.failed}` : ''}
        </Notice>
      ) : null}
      {m.demo && !m.streaming && !m.failed ? (
        <Notice role="note">演示回复，未连接 Agent</Notice>
      ) : null}

      {m.changes && m.changes.length > 0 && (
        <div className="cv3-changes">
          <b className="cv3-changes-title">新建的东西</b>
          <table>
            <thead><tr><th>名字</th><th>类型</th></tr></thead>
            <tbody>
              {m.changes.map((c, i) => (
                <tr key={i}><td><code>{c.file}</code></td><td>{c.change}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* 回答之后的收尾，顺序照 dsh：先「改了什么」，再「交付了什么」，最后是操作条。 */}
      {(() => {
        const fc = collectFileChanges(m.executedTools)
        return fc.length > 0 && !m.streaming ? <FileChanges changes={fc} /> : null
      })()}
      {m.deliverables && m.deliverables.length > 0 && (
        <Deliverables
          files={m.deliverables}
          onOpenWorkbench={props.openProject !== null ? () => props.onOpenWorkbench(props.activeSessionId) : undefined}
        />
      )}
      {/* 操作条：复制、朗读、重试与时间，右侧是这一轮的用量（悬停看明细）。
          最后一条回复常显，其余悬停时出现。 */}
      {!m.streaming && m.text ? (
        <AnswerActions>
          <MessageActions
            text={m.text}
            at={m.at}
            onRetry={m.failed ? () => retryLastRound() : undefined}
            extra={usageBadge(m.usage)}
          />
        </AnswerActions>
      ) : null}
    </div>
  )
}

/** 1234 → 1.2k；用于用量这种只需要量级的数字 */
function compactTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n)
}

/** 这一轮的用量：只显示上游真的报了的数；没有就不占位 */
function usageBadge(usage: ChatMessage['usage']) {
  if (!usage) return null
  const input = usage.inputTokens
  const output = usage.outputTokens
  const total = usage.totalTokens ?? (input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined)
  if (total === undefined || total <= 0) return null
  const detail = [
    input !== undefined ? `输入 ${input.toLocaleString()}` : null,
    output !== undefined ? `输出 ${output.toLocaleString()}` : null,
    usage.cacheReadTokens ? `缓存命中 ${usage.cacheReadTokens.toLocaleString()}` : null,
  ].filter(Boolean).join(' · ')
  return <span className="cv3-usage-badge num" title={detail || undefined}>用量 {compactTokens(total)} tok</span>
}

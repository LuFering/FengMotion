import { useEffect, useRef } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { MessageSquare01, Square } from '@untitledui/icons'
import { LiveRunStatus } from '@/features/chat/components/conversation/LiveRunStatus'
import { useScrollFollow } from '@/features/chat/hooks/thread/useScrollFollow'
import { WorkbenchAiContent } from '@/features/workbench/components/rightpanel/WorkbenchAiContent'
import { CreationProgress } from '@/features/chat/components/CreationProgress'
import { EyeTracker } from '@/features/workbench/components/EyeTracker'
import { ChatMessage } from '@/features/chat/components'
import { ContextMeter, type Kind } from '@/features/chat/components/bencho/ContextMeter'
import { TASK_STATUS_LABEL } from '@/shared/lib/status'
import { RequestSnapshot } from '@/features/workbench/components/WorkbenchReview'
import type { TaskRecord } from '@/features/creation/hooks/useAgentTasks'
import type { AgentTask, TaskEvent, TaskRequest } from '@/api/studioApi'
import type { Session } from '@/features/chat/model/sessionMapping'
import type { ChatMessage as ThreadMessage } from '@/features/chat/hooks/useChat'

export interface RightPanelThreadProps {
  activeDone: boolean
  activeLive: boolean
  activeRecord: TaskRecord | null
  activeTask: AgentTask | null
  cancelTask: (id: string) => void
  currentSession: Session | null | undefined
  executionPhase: string
  getRoundOutcome: ((userMessageId: string | undefined) => { reply: string; userMessageId: string; requestId?: string } | null) | undefined
  isSessionLoading: boolean | undefined
  latestEvent: TaskEvent | undefined
  messages: ThreadMessage[]
  onCancelQueued: (key: string) => void
  onClearRoundOutcome: ((userMessageId: string) => void) | undefined
  onOpenTask: () => void
  onResumeRequest: (request: TaskRequest) => void
  onRetryMessages: ((sessionId: string) => void) | undefined
  onRetrySaveAllReplies: (() => void) | undefined
  onRetrySaveReply: ((item?: any) => void) | undefined
  onStartQueued: (key: string) => void
  pending: { key: string; messageId: string; prompt: string; status: 'waiting' | 'cancelled' }[]
  projectId: string
  realModifyBusy: boolean
  records: TaskRecord[]
  unsavedReplies: { userMessageId: string; reply: string; sessionId: string; requestId?: string }[]
  workbenchMeterKinds: Kind[]
  workbenchMeterWindow: number
}

/**
 * 工作台右栏的消息线程：历史加载中/失败/空会话三种状态，用户与 AI 消息及排队请求，
 * 以及本轮结论、执行进度、回复补存、上下文占用和任务结果等随消息流出现的提示。
 */
export function RightPanelThread({ activeDone, activeLive, activeRecord, activeTask, cancelTask, currentSession, executionPhase, getRoundOutcome, isSessionLoading, latestEvent, messages, onCancelQueued, onClearRoundOutcome, onOpenTask, onResumeRequest, onRetryMessages, onRetrySaveAllReplies, onRetrySaveReply, onStartQueued, pending, projectId, realModifyBusy, records, unsavedReplies, workbenchMeterKinds, workbenchMeterWindow }: RightPanelThreadProps) {
  /* 跟随最新内容与「回到最新」：规则与对话页同一套（useScrollFollow） */
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const { away, toBottom } = useScrollFollow(scrollRef, contentRef)
  const last = messages[messages.length - 1]
  const replying = last?.role === 'ai' && last.streaming === true
  const running = realModifyBusy || replying
  useEffect(() => {
    if (running) toBottom()
  }, [running, toBottom])
  const lastUserAt = [...messages].reverse().find((x) => x.role === 'user')?.at ?? null
  const runLabel = realModifyBusy
    ? executionPhase === 'analyzing'
      ? '正在分析需求并修改工程源码'
      : executionPhase === 'rendering'
        ? '源码已改完，正在渲染视频画面'
        : '正在执行修改'
    : undefined

  return (
    <div className="fw-scroll open-workbench-thread" ref={scrollRef}>
      <div className="open-workbench-messages" ref={contentRef}>
        {/* 消息：AI 不用气泡，用户用 --soft 底（fm-components §9） */}
        {/* 历史读取中状态 */}
        {currentSession && currentSession.origin === 'server' && (isSessionLoading || (!currentSession.messagesLoaded && !currentSession.messagesError)) ? (
          <div className="wb-chat-status flex flex-col items-center justify-center text-center py-12 px-4 select-none">
            <UiIcon icon={SemIcons.loading} size="lg" className="animate-spin text-[var(--tx3)] mb-2" />
            <div className="text-xs text-[var(--tx2)]">正在加载对话历史…</div>
          </div>
        ) : currentSession && currentSession.origin === 'server' && currentSession.messagesError ? (
          /* 历史读取失败状态（带重试按钮，区分于空会话） */
          <div className="wb-chat-status flex flex-col items-center justify-center text-center py-10 px-4 select-none">
            <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500/10 text-red-400 mb-2 border border-red-500/20">
              <UiIcon icon={SemIcons.error} size="md" />
            </div>
            <div className="text-xs text-red-400 font-medium mb-1">历史消息读取失败</div>
            <div className="text-[11px] text-[var(--tx3)] max-w-[220px] mb-3 leading-relaxed">
              {currentSession.messagesError}
            </div>
            <button
              type="button"
              onClick={() => onRetryMessages?.(currentSession.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[var(--hole)] border border-[var(--line)] text-[var(--tx)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
            >
              <UiIcon icon={SemIcons.refresh} size="xs" /> 重新加载
            </button>
          </div>
        ) : messages.length === 0 ? (
          /* 真实空会话引导 */
          <div className="wb-chat-empty flex flex-col items-center justify-center text-center py-12 px-4 select-none">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--hole)] text-[var(--tx3)] mb-3">
              <UiIcon icon={MessageSquare01} size="md" />
            </div>
            <div className="text-sm font-medium text-[var(--tx)] mb-1">
              {currentSession ? '当前对话暂无消息' : '本工程暂无对话记录'}
            </div>
            <div className="text-xs text-[var(--tx2)] max-w-[220px] mx-auto leading-relaxed">
              {currentSession
                ? '写下修改意见或问题。'
                : '发送第一条要求后会为本工程开启对话。'}
            </div>
          </div>
        ) : (
          messages.map((m) => {
          return m.role === 'user'
            ? (
              <div key={m.id}>
                {/* 用户消息走与对话界面同一个 ChatMessage（同一个语义在两处长成
                    两个样，用户会以为是两种不同的东西）。 */}
                <ChatMessage role="user" text={m.text} at={m.at} />
                {m.references && m.references.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5 ml-1 mb-2">
                    {m.references.map((r, rIdx) => (
                      <span key={r.id || rIdx} className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-[var(--hole)] border border-[var(--line)] text-[var(--tx2)] select-none">
                        {r.label || r.kind}
                      </span>
                    ))}
                  </div>
                )}
                <RequestSnapshot request={records.find((r) => r.task.id === m.taskId)?.request}/>
                {pending.filter((p) => p.messageId === m.id).map((p) => (
                  p.status === 'waiting' ? (
                    <div key={p.key} className="wb-queue-note">
                      <span>等待处理 · 当前任务结束后处理</span>
                      <button type="button" disabled={activeLive} onClick={() => onStartQueued(p.key)}>现在开始</button>
                      <button type="button" onClick={() => onCancelQueued(p.key)}>取消</button>
                    </div>
                  ) : (
                    <div key={p.key} className="wb-queue-note"><span>已取消等待</span></div>
                  )
                ))}
              </div>
            )
            : (
              <div key={m.id} className="wb-ai-bubble-group">
                {/* 过程摘要：只在该消息真的带 executedTools 时出现。
                    侧栏窄，默认收起，展开看每步；状态用文字区分。
                    数据随消息从服务端读回，刷新/切页后仍在。 */}
                <ChatMessage
                  role="ai"
                  text={m.text}
                  at={m.at}
                  streaming={m.streaming}
                  failed={m.failed}
                  demo={m.demo}
                  avatar={<EyeTracker size={20} shape="Ball" eyeScale={1.7} within=".fw-scroll" extendToViewportOrigin />}
                  content={<WorkbenchAiContent m={m} />}
                />
                {/* 「本轮未改动工程」按**轮次**显示：用这条回复的 taskId
                    （= 触发它的用户消息 id）去查该轮结果。
                    取不到就不显示 —— 绝不按「最近一条」猜。
                    同一会话多轮都有结论时，各自显示各自的。 */}
                {(() => {
                  if (!getRoundOutcome) return null
                  const outcome = getRoundOutcome(m.taskId)
                  if (!outcome) return null
                  return (
                    <div className="wb-ai-attached-note mt-2 ml-7 flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-xs text-[var(--tx2)] shadow-sm" role="status">
                      <span className="truncate">本轮未改动工程 · 没有新版本{outcome.reply && !messages.some((message) => message.role === 'ai' && message.text === outcome.reply) ? ` · ${outcome.reply.slice(0, 100)}` : ''}</span>
                      <button
                        type="button"
                        onClick={() => onClearRoundOutcome?.(outcome.userMessageId)}
                        aria-label="关闭"
                        className="shrink-0 p-1 rounded hover:bg-[var(--hover)] text-[var(--tx3)] hover:text-[var(--tx)] transition-colors"
                      >
                        <UiIcon icon={SemIcons.close} size="xs" />
                      </button>
                    </div>
                  )
                })()}
              </div>
            )
        }))}

        {/* 兜底：本轮还没有 AI 回复（创作回复尚未落库）时也要能显示结论。
            按「该轮对应的用户消息是否在当前会话里」判断，
            不跨会话沿用 —— 切到别的会话时自然查不到。 */}
        {(() => {
          if (!getRoundOutcome) return null
          if (messages.some((m) => m.role === 'ai')) return null
          const lastUser = [...messages].reverse().find((m) => m.role === 'user')
          if (!lastUser) return null
          const outcome = getRoundOutcome(lastUser.id)
          if (!outcome) return null
          return (
            <div className="wb-ai-attached-note mt-2 flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-xs text-[var(--tx2)] shadow-sm" role="status">
              <span className="truncate">本轮未改动工程 · 没有新版本</span>
              <button
                type="button"
                onClick={() => onClearRoundOutcome?.(outcome.userMessageId)}
                aria-label="关闭"
                className="shrink-0 p-1 rounded hover:bg-[var(--hover)] text-[var(--tx3)] hover:text-[var(--tx)] transition-colors"
              >
                <UiIcon icon={SemIcons.close} size="xs" />
              </button>
            </div>
          )
        })()}

        {/* 约束 3：真实执行状态展示，按后端真实阶段（analyzing / rendering）展示，不模拟虚构进度 */}
        {/* 约束 1：多条回复补存提示，以服务端任务记录为依据，支持逐条与一键批量保存 */}
        {unsavedReplies && unsavedReplies.length > 0 && (
          <div className="wb-unsaved-reply-alert mt-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex flex-col gap-2 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <UiIcon icon={SemIcons.error} size="sm" className="text-amber-400 shrink-0" />
                <span>
                  {unsavedReplies.length === 1
                    ? '创作已完成，但本轮回复尚未成功同步到服务端会话'
                    : `创作已完成，有 ${unsavedReplies.length} 条回复尚未成功同步到服务端会话`}
                </span>
              </div>
              {unsavedReplies.length > 1 && onRetrySaveAllReplies && (
                <button
                  type="button"
                  onClick={() => onRetrySaveAllReplies()}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/25 hover:bg-amber-500/35 text-amber-200 text-xs font-medium cursor-pointer"
                >
                  全部补存
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
              {unsavedReplies.map((item) => (
                <div key={item.userMessageId} className="flex items-center justify-between gap-2 p-1.5 rounded bg-amber-500/5 border border-amber-500/10">
                  <span className="truncate text-amber-200/90 text-[11px] max-w-[200px]" title={item.reply}>
                    {item.reply.slice(0, 36)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRetrySaveReply?.(item)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] font-medium shrink-0 cursor-pointer"
                  >
                    <UiIcon icon={SemIcons.refresh} size="xs" /> 补存
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 上下文占用卡：这一栏的圆环在输入框里已被关掉，读数改贴在这里 ——
            它和上面的回复是同一轮的收尾信息，放在消息下方比塞进 32px 的圆钮里好读。 */}
        {workbenchMeterKinds.length > 0 && workbenchMeterWindow > 0 && (
          <div className="cv3-ctxmeter wb-ctxmeter">
            <ContextMeter kinds={workbenchMeterKinds} windowK={Math.round(workbenchMeterWindow / 1000)} style="Bar" />
          </div>
        )}

        {/* 执行项只插在消息流里，不另开大卡片：进行中只露最新一条关键事件，
            演示身份挂在项上（不是只靠底部的离线行）。 */}
        {activeTask && activeLive && (
          <div className="wb-chat-block">
            <div className="wb-chat-task">
              <UiIcon icon={SemIcons.loading} className="size-3 animate-spin" />
              <b className="truncate">{activeRecord?.request
                ? `正在演示记录 ${activeRecord.request.references?.find((r) => r.role === 'target')?.label ?? '整片'}`
                : activeTask.title}</b>
              <span className="wb-insp-tag">演示</span>
              <span className="wb-insp-tag">{TASK_STATUS_LABEL[activeTask.status] ?? activeTask.status}</span>
            </div>
            {latestEvent && <div className="wb-chat-event">{latestEvent.message}</div>}
            <div className="flex gap-1.5">
              <button className="wb-btn-ghost" type="button" onClick={onOpenTask}>查看执行</button>
              <button className="wb-btn-ghost" type="button" onClick={() => cancelTask(activeTask.id)}>
                <UiIcon icon={Square} className="size-3" />停止
              </button>
            </div>
          </div>
        )}

        {/* 任务结果卡。
            演示任务不产预览、不改文件，所以只报结束；
            真实任务会产出 mp4，文案必须说清这一点 —— 否则用户看到
            「没有生成新预览」而左侧明明有一个能播的视频（真机截图确认过）。 */}
        {activeTask && activeDone && (
          <div className="wb-chat-block">
            <div className="wb-chat-task">
              <span className="fm-dot" data-s={activeTask.status === 'completed' ? 'done' : activeTask.status === 'failed' ? 'failed' : 'idle'} />
              <b className="truncate">
                {activeTask.status === 'completed'
                  ? (activeTask.mock ? '演示任务已完成' : '渲染已完成')
                  : activeTask.status === 'failed' ? '任务失败' : '任务已停止'}
              </b>
              {activeTask.mock && <span className="wb-insp-tag">演示</span>}
            </div>
            <div className="wb-chat-event">
              {activeTask.status === 'completed'
                ? (activeTask.mock
                    ? '没有生成新预览，也没有文件变更。'
                    : '已产出视频，可在「产物」页播放。')
                : latestEvent?.message ?? '没有执行详情。'}
            </div>
            <button className="wb-btn-ghost" type="button" onClick={onOpenTask}>查看执行</button>
            {(activeTask.status === 'failed' || activeTask.status === 'cancelled') && activeRecord?.request && <button className="wb-btn-ghost" type="button" onClick={() => onResumeRequest(activeRecord.request!)}><UiIcon icon={SemIcons.back} size="xs" />带回对话继续编辑</button>}
          </div>
        )}

        <CreationProgress projectId={projectId} sessionId={currentSession?.id} />
        {/* 这一轮在跑就常驻在最底部：此刻在做什么，加已用时长（从发出这条消息算起） */}
        {running && (
          <LiveRunStatus
            phase={null}
            startedAt={lastUserAt}
            hasText={Boolean(last?.role === 'ai' && last.text)}
            afterUser={last?.role === 'user'}
            label={runLabel}
          />
        )}
      </div>
      {away ? (
        <button type="button" className="cv3-to-bottom wb-to-bottom" aria-label="回到最新" title="回到最新" onClick={() => toBottom('smooth')}>
          <UiIcon icon={SemIcons.collapse} size="md" />
        </button>
      ) : null}
    </div>
  )
}

import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { ArrowUpRight, ChevronLeft, Clock, MessageSquare01, Square } from '@untitledui/icons'
import { useHarnessSelection, setHarnessSelection } from '@/features/harness/hooks/useHarnessSelection'
import { useEffect, useMemo, useRef, useState } from 'react'
import { chatStreamManager, useSessionStream } from '@/features/chat/services/chatStreamManager'
import { ProcessSummary } from '@/features/chat/components/ProcessSummary'
import { AssistantTurnContent } from '@/features/chat/components/AssistantTurnContent'
import { MarkdownText } from '@/features/chat/components/MarkdownText'
import { CreationProgress } from '@/features/chat/components/CreationProgress'
import { EyeTracker } from '@/features/workbench/components/EyeTracker'
import { useHarnesses, modelsOf, matchHarness } from '@/features/harness/hooks/useHarnesses'
import { type TaskRecord } from '@/features/creation/hooks/useAgentTasks'
import type { AgentReference, AgentTask, ModificationConstraints, TaskRequest } from '@/api/studioApi'
import { type StageVisual } from '@/features/workbench/model/stageVisual'
import { versionSeriesOf, type ProjectVersionInfo } from '@/features/workbench/model/versionIdentity'
import type { ChatState } from '@/features/chat/hooks/useChat'
import { ChatMessage } from '@/features/chat/components'
import { ContextMeter, type Kind } from '@/features/chat/components/bencho/ContextMeter'
import { LeiBoxComposer } from '@/features/chat/components/LeiBoxComposer'
import { TargetSummaryPill } from '@/features/chat/components/TargetSummaryPill'
import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import { TASK_STATUS_LABEL } from '@/shared/lib/status'
import type { ViewId } from '@/shared/navigation/views'
import { SegmentedControl } from '@/shared/ui/segmented-control'
import { Switch } from '@/shared/ui/switch'
import { RequestSnapshot } from '@/features/workbench/components/WorkbenchReview'
import { HARNESSES } from '@/features/harness/model/harnesses'
import type { Session } from '@/features/chat/hooks/useSessions'
import { type TimeSpan } from '@/features/workbench/model/timeRange'
import { type SideTab, quickActions, CONSTRAINT_LABELS, type ConstraintKey } from '@/features/workbench/model/workbenchConsole'

/**
 * 真实修改路径**实际会执行**的约束。
 *
 * <p>其余约束后端第一版没有实现，真实请求根本不发它们。
 * 界面因此必须禁用这些开关 —— 让用户勾选一个不会生效的条件，
 * 比根本没有这个开关更糟：他会拿一个没被保证的结果去用。</p>
 *
 * <p>这里与后端 `TaskRequestGuard`/`Constraints.unenforced()` 的判断保持一致，
 * 改后端支持范围时这里也要改。</p>
 */
export const REAL_MODIFY_SUPPORTED_CONSTRAINTS = new Set<ConstraintKey>(['limitToSelection'])

/* ── 右栏：对话 / 修改设置 ──────────────────────────────────── */
/* 注：scopeShort 曾是输入框占位文案的一部分，官方输入框的占位文案由它自己给，
   这个参数已无消费方，不再从 props 解构。 */
/**
 * 「本轮未改动工程」这条结论是否属于**当前这条 AI 回复**。
 *
 * <p>判据是消息身份，不是顺序：找到该回复之前最近的一条用户消息，
 * 它必须与结论记录的 `userMessageId` 一致。</p>
 *
 * <p>拿不到 `userMessageId`（例如从服务端状态恢复、后端未回显）时返回 false ——
 * **明确降级**：宁可不显示，也不把结论贴到可能错误的轮次上。
 * 这正是此前「上一轮结果贴到下一轮」的根因。</p>
 */
export function RightPanel({ projectId, target, preview, projectVersionNumber, projectVersionAuthoritative, projectVersion, chat, sideTab, setSideTab, focusChatKey, scope,
  onOpenTask, onBackFromTask,
  constraints, setConstraints, activeTask, cancelTask, records, onSubmit, onQuickAction,
  pending, onStartQueued, onCancelQueued,
  onNavigate, references, onRemoveReference,
  onLocateReference, onToggleReferenceRole, onClearReferences, onScopeChange, onOpenResourcePicker,
  onOpenReview, keepNotes, onResumeRequest,
  sourceMode, realModifyBusy, realModifyError, onClearRealModifyError,
  adjustPendingConfirm, canConfirmWholeProject, onConfirmWholeProject,
  executionPhase = '', unsavedReplies = [], onRetrySaveReply, onRetrySaveAllReplies,
  getRoundOutcome, onClearRoundOutcome,
  currentSession,
  engineeringBusy = false,
  onNotice,
  onRetryMessages, isSessionLoading,
  rangeSpan, onCompareVersions: _onCompareVersions, onShowPreview: _onShowPreview, onClearRange, onResetScope,
  onRestoreVersion, onViewLead, sessionDraft }:
  { projectId: string; target: AgentReference; preview: StageVisual | null; stageLead?: StageVisual | null; projectVersionNumber?: number | null; projectVersionAuthoritative?: boolean; projectVersion?: ProjectVersionInfo; chat: ChatState; sideTab: SideTab; setSideTab: (v: SideTab) => void; focusChatKey: number
    scope: 'project'|'scene'|'selection'
    scopeShort: string
    onOpenTask: () => void
    onBackFromTask: () => void
    constraints: ModificationConstraints
    setConstraints: React.Dispatch<React.SetStateAction<ModificationConstraints>>
    activeTask: AgentTask | null; cancelTask: (id: string) => void; records: TaskRecord[]
    onSubmit: (p: string) => Promise<boolean>; onQuickAction: (a: (typeof quickActions)[number]) => void
    pending: Array<{ key: string; messageId: string; prompt: string; status: 'waiting' | 'cancelled' }>
    onStartQueued: (key: string) => void; onCancelQueued: (key: string) => void
    onNavigate: (v: ViewId) => void
    references: AgentReference[]; onRemoveReference: (id: string) => void
    onLocateReference: (ref: AgentReference) => void; onToggleReferenceRole: (id: string) => void
    onClearReferences: () => void; onScopeChange: (next: 'project'|'scene'|'selection') => void
    onOpenResourcePicker: () => void
    onOpenReview: (tab: any) => void; keepNotes: string; onResumeRequest: (request: TaskRequest) => void
    realModifyBusy: boolean
    executionPhase?: string
    unsavedReplies?: Array<{ userMessageId: string; reply: string; sessionId: string; requestId?: string }>
    onRetrySaveReply?: (item?: any) => void
    onRetrySaveAllReplies?: () => void
    sourceMode: boolean
    realModifyError: string
    onClearRealModifyError: () => void
    adjustPendingConfirm?: boolean
    canConfirmWholeProject?: boolean
    onConfirmWholeProject?: () => void
    /** 按用户消息 id 取该轮结论；取不到返回 null（不猜） */
    getRoundOutcome?: (userMessageId: string | undefined) => { reply: string; userMessageId: string; requestId?: string } | null
    /** 用户关闭某轮结论 */
    onClearRoundOutcome?: (userMessageId: string) => void
    onClearAwaitingInfo?: () => void
    currentSession?: Session | null
    /** 工程侧是否正在跑真实任务（改工程 / 渲染 / 工作流）。这类任务不能用会话流停止。 */
    engineeringBusy?: boolean
    /** 显示一条提示（停止失败等需要用户知道的实情） */
    onNotice?: (message: string) => void
    onRetryMessages?: (sessionId: string) => void
    isSessionLoading?: boolean
    rangeSpan?: TimeSpan | null
    onCompareVersions?: (before: StageVisual, after: StageVisual) => void
    onShowPreview?: (visual: StageVisual) => void
    onClearRange?: () => void
    onResetScope?: () => void
    onRestoreVersion?: (version: number) => void
    onViewLead?: () => void
    sessionDraft: ReturnType<typeof useSessionDraft>
    }) {
  /* ── 输入框里的引擎 / 模型 / 推理强度 ──
     与对话界面同一套派生逻辑：模型列表以**后端目录**为准
     （`/api/harnesses/{id}/models`），本地 harness.models 只是产品侧写的名字，
     与 DSH 实际路由的模型对不上。 */
  const probe = useHarnesses()
  const engineSelection = useHarnessSelection()
  const harnessId = engineSelection.harness
  const setHarnessId = (harness: string) => setHarnessSelection({ harness, model: undefined, reasoningEffort: undefined })
  const model = engineSelection.model ?? ''
  const setModel = (model: string) => setHarnessSelection({ model })
  const workbenchEffort = engineSelection.reasoningEffort ?? null
  const setWorkbenchEffort = (level: string) => setHarnessSelection({ reasoningEffort: level })
  const selectedHarness = matchHarness(probe.harnesses, harnessId)
  const composerHarnesses = useMemo(() => probe.harnesses.map((h) => ({
    id: h.id,
    name: HARNESSES.find((item) => item.id === (h.id === 'dsh-sdk' ? 'deepseek' : h.id))?.name ?? h.name,
    iconUrl: HARNESSES.find((item) => item.id === (h.id === 'dsh-sdk' ? 'deepseek' : h.id))?.icon ?? './assets/brand/deepseek.svg',
    available: h.status === 'available',
    models: (probe.modelsByHarness[h.id] ?? []).map((m) => ({ id: m.id, name: m.label || m.id, reasoningEfforts: m.reasoningEfforts })),
  })), [probe.harnesses, probe.modelsByHarness, probe.access])
  const backendModels = modelsOf(probe, selectedHarness?.id ?? harnessId).models
  const effectiveModel =
    backendModels.length === 0 || backendModels.some((m) => m.id === model)
      ? model
      : (backendModels.find((m) => m.default) ?? backendModels[0]).id
  void effectiveModel
  void workbenchEffort

  /* 草稿只在提交成功后清空：失败时保留输入，用户改一个字就能重发，
     而不用把整段要求重写一遍。onSubmit 返回是否成功。 */

  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  /* 问题/场景带入对话时聚焦输入框：只在切到对话后触发，不抢其他视图的焦点。 */
  useEffect(() => {
    if (sideTab === 'chat' && focusChatKey > 0) inputRef.current?.focus()
  }, [focusChatKey, sideTab])
  const activeRecord = activeTask ? records.find((r) => r.task.id === activeTask.id) ?? null : null
  const activeLive = !!activeTask && (activeTask.status === 'queued' || activeTask.status === 'running' || activeTask.status === 'building')
  const activeDone = !!activeTask && (activeTask.status === 'completed' || activeTask.status === 'failed' || activeTask.status === 'cancelled')
  const latestEvent = activeRecord?.events.at(-1)

  /**
   * 两条独立的执行通道，必须分开判断，否则停止按钮会「能点但停不了」。
   *
   * <p>工作台里同时存在两类正在跑的事：</p>
   * <ul>
   *   <li><strong>会话回复流</strong>：纯提问（query 意图）走这条，能停；</li>
   *   <li><strong>工程任务</strong>：真实改工程 / 渲染 / 工作流，走后端任务通道，
   *       只能用任务面板的取消，会话流停止对它无效。</li>
   * </ul>
   *
   * <p>之前把两者揉成一个 busy 传给输入框，于是工程任务运行时也会出现停止键，
   * 用户点了却什么都没停 —— 按钮在说谎。现在只在「确实能停」时给停止键。</p>
   */
  const sessionStream = useSessionStream(currentSession?.id)
  /**
   * 回复流是否真的在跑。
   *
   * <p>必须排除「工程任务正在跑」的情形：工程修改会先写用户消息、
   * 再交给后端任务通道，此时 chatStreamManager 里可能仍留着上一条
   * 纯提问流的状态（它由 onStopped / notify 清理，时序上可能滞后），
   * 于是停止键会在工程任务期间出现 —— 而它根本停不了那个任务。</p>
   */
  const replyStreamActive = sessionStream.phase === 'streaming' && !engineeringBusy

  /**
   * 停止请求是否还在等后端答复。
   *
   * <p>轮次核对能防止「迟到的停止响应误伤新流」，但更省事的是不给这个机会：
   * 停止结果没确定之前，输入框继续保持忙碌、停止键仍可再点（重试），
   * 用户就没法在这一瞬发出下一轮。管理器内部对在途请求做了去重，
   * 连点也只会打一次 /stop。</p>
   */
  const [stopping, setStopping] = useState(false)

  /**
   * 确认停止后的清理。
   *
   * <p>与对话区同因：后端一确认停止，管理器就断开连接，
   * SSE 的 onStopped 很可能不再到达，半截回复会留在侧栏。
   * 这里读管理器登记的「哪一轮被确认停止」，读一次即删，与事件路径去重。</p>
   */
  const handledStoppedRef = useRef<string | null>(null)
  useEffect(() => {
    const sid = currentSession?.id
    if (!sid) return
    if (sessionStream.phase !== 'stopped') { handledStoppedRef.current = null; return }
    if (handledStoppedRef.current === sid) return
    handledStoppedRef.current = sid
    const confirmed = chatStreamManager.takeConfirmedStop(sid)
    if (!confirmed) return
    if (confirmed.aiMessageId) chat.removeMessage(confirmed.aiMessageId)
    onNotice?.('已停止生成。你的消息已保存，这条回复没有保存。')
  }, [sessionStream.phase, currentSession?.id, chat, onNotice])
  const messages = useMemo(() => {
    if (!currentSession) {
      // 当前工程尚无已建会话：严格隔离，绝不混入全局或其它工程消息
      return []
    }
    const sessionMsgs = currentSession.messages.filter((m) => m.id !== 'intro')
    // 严格白名单：必须明确带上当前会话 id 和当前项目 id，杜绝同项目不同会话串味
    const pendingLocal = chat.messages.filter(
      (m) =>
        m.id !== 'intro' &&
        m.projectId === projectId &&
        m.sessionId === currentSession.id &&
        !sessionMsgs.some((x) => x.id === m.id),
    )
    const combined = [...sessionMsgs]
    for (const m of pendingLocal) {
      if (!combined.some((x) => x.id === m.id)) {
        combined.push(m)
      }
    }
    return combined.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  }, [currentSession, chat.messages, projectId])

  /**
   * 左栏的上下文构成卡。
   *
   * <p>与对话界面同一口径：取**最后一条带 usage 的 AI 消息**（落库事实，刷新后仍在），
   * 五档相加等于实测 prompt 大小。窗口优先用这条消息记下的值；续接老会话时
   * DSH 不发那一帧，退回模型目录里的同名字段。</p>
   *
   * <p>没有真实分档就不画 —— 画一个分母未知的进度条比不画更容易让人以为读数坏了。</p>
   */
  const lastWorkbenchUsage = [...messages].reverse().find((m) => m.role === 'ai' && m.usage)?.usage
  const workbenchMeterKinds: Kind[] = lastWorkbenchUsage?.breakdown
    ? [
        { id: 'sys', name: 'System', k: lastWorkbenchUsage.breakdown.systemTokens / 1000 },
        { id: 'tools', name: 'Tools', k: ((lastWorkbenchUsage.toolsTokens ?? 0) + lastWorkbenchUsage.breakdown.resultsTokens) / 1000 },
        { id: 'files', name: 'Files', k: lastWorkbenchUsage.breakdown.filesTokens / 1000 },
        { id: 'chat', name: 'Chat', k: lastWorkbenchUsage.breakdown.chatTokens / 1000 },
        { id: 'mem', name: 'Memory', k: lastWorkbenchUsage.breakdown.memoryTokens / 1000 },
      ]
    : []
  const workbenchMeterWindow =
    lastWorkbenchUsage?.contextWindow ?? backendModels.find((m) => m.id === effectiveModel)?.contextWindow ?? 0

  return (
    <aside className="fw-panel" aria-label="AI 对话">
      {/* 标题与页签栏已上移到底座（ConsoleChrome）：三个面板共用同一条页签，
          否则切到「场景版本」时整条页签会跟着旧面板一起消失。 */}

      {sideTab === 'scene' ? (<div className="fw-scroll wb-target-facts"><span className="wb-target-kicker">修改目标</span><h3>{target.label}</h3><p>{target.kind === 'project' ? '本次意见作用于整个项目；选中具体预览或内容后，可以缩小修改范围。' : '意见会连同当前目标一起发送。查看发送记录可核对当时的范围。'}</p>{preview && <dl><dt>预览类型</dt><dd>{preview.tierLabel}</dd><dt>{preview.origin === 'editor' ? '编辑版本' : '工作流版本'}</dt><dd>v{preview.revision}</dd><dt>预览生成于</dt><dd>{new Date(preview.createdAt).toLocaleString('zh-CN')}</dd></dl>}<button type="button" className="wb-btn-ghost" onClick={() => setSideTab('chat')}><UiIcon icon={MessageSquare01} size="sm" /> 对这个目标提意见</button></div>
      ) : sideTab === 'chat' ? (
        <>
          <div className="fw-scroll open-workbench-thread">
            <div className="open-workbench-messages">
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
                        content={<AssistantTurnContent text={m.text} tools={m.executedTools}
                          renderText={text => <MarkdownText text={text} />}
                          renderTools={tools => <ProcessSummary tools={tools} running={m.streaming === true} />} />}
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
              {realModifyBusy && (
                <div className="wb-real-execution-status flex items-center gap-2.5 px-3 py-2 mt-2 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-xs text-[var(--tx2)] shadow-sm animate-pulse">
                  <UiIcon icon={SemIcons.loading} size="sm" className="animate-spin text-blue-400 shrink-0" />
                  <span>
                    {executionPhase === 'analyzing'
                      ? '正在由 AI 分析需求并修改工程源码…'
                      : executionPhase === 'rendering'
                      ? '工程源码已修改完毕，正在渲染视频画面…'
                      : '创作执行中，正在处理…'}
                  </span>
                </div>
              )}

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
            </div>
          </div>

          <div className="fw-compose">
            {/* 只在**同一条版本序列**内才提示「历史」。
                原先 `preview.revision !== stageLead.revision` 跨来源比较：
                看着场景 v4、而列表首项是试片 v2 时也会报「正在查看历史 v4」，
                完全是假警告。跨序列时这里不提示 —— 那不是「旧版本」，
                只是另一个来源的画面。 */}
            {/* 可信度要传下来：后端版本读不到时，只能说「有更新的已知画面」，
                不能说「修改将基于最新工程 vN」—— 那个数字没被确认过。 */}
            {preview && versionSeriesOf(preview) === 'scene'
              && typeof preview.revision === 'number'
              && typeof projectVersionNumber === 'number'
              && preview.revision < projectVersionNumber && (
              <div className="mb-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs flex items-center justify-between text-amber-300">
                <span className="flex items-center gap-1.5 text-[11px] truncate">
                  <UiIcon icon={Clock} size="xs" className="text-amber-400 shrink-0" />
                  <span className="truncate">
                    {projectVersionAuthoritative
                      ? `正在查看历史 v${preview.revision}（修改将基于最新工程 v${projectVersionNumber}）`
                      : `正在查看 v${preview.revision}，已知有更新的画面 v${projectVersionNumber}（工程版本未能确认）`}
                  </span>
                </span>
                <div className="flex items-center gap-2 shrink-0 text-[11px]">
                  <button
                    type="button"
                    className="text-amber-400 hover:text-white underline cursor-pointer"
                    onClick={() => onRestoreVersion?.(preview.revision)}
                    title="将工程代码恢复到此版本并作为修改基准"
                  >
                    恢复至此版
                  </button>
                  <button
                    type="button"
                    className="text-[var(--tx2)] hover:text-white cursor-pointer"
                    onClick={() => onViewLead?.()}
                    title="切回最新版本画面"
                  >
                    回到最新版
                  </button>
                </div>
              </div>
            )}
            <div className="wb-compose-context">
            <TargetSummaryPill
              version={preview ? preview.revision : null}
              /* 版本来源必须一起传：跨序列比大小会报假「历史」 */
              versionSeries={preview ? versionSeriesOf(preview) : null}
              /* 工程版本**只在可信时**传数字；不可信时传标记，让胶囊降级措辞，
                 而不是拿「已知画面最高」去断言「已推进至 vN」。 */
              stageLeadVersion={projectVersion?.authoritative ? projectVersionNumber : null}
              versionUnconfirmed={!projectVersion?.authoritative}
              scope={scope}
              targetSnapshot={sessionDraft.draft.targetSnapshot}
              draftIntent={sessionDraft.draft.intentAction}
              continuationScopeMode={sessionDraft.draft.continuationScopeMode}
              hasProject={Boolean(projectId)}
              rangeSpan={rangeSpan}
              references={references}
              onClearRange={onClearRange}
              onResetScope={onResetScope}
              onRestoreVersion={onRestoreVersion}
              onViewLead={onViewLead}
              onIntentChange={(intent) => {
                /* 意图必须独立落盘：没有显式目标时 targetSnapshot 是 null，
                   只写进去等于什么都没存，用户点了「关于此提问」发出去仍会改工程。 */
                sessionDraft.updateDraft({
                  intentAction: intent,
                  ...(sessionDraft.draft.targetSnapshot
                    ? { targetSnapshot: { ...sessionDraft.draft.targetSnapshot, intentAction: intent } }
                    : {}),
                })
              }}
              onRemoveTarget={() => {
                sessionDraft.updateDraft({ targetSnapshot: null })
                onClearRange?.()
                onResetScope?.()
              }}
            />
            <ReferenceChips references={references} onRemoveReference={onRemoveReference} onLocateReference={onLocateReference} onToggleReferenceRole={onToggleReferenceRole} onClearReferences={onClearReferences} onOpenResourcePicker={onOpenResourcePicker} />
            </div>
            {keepNotes && <button type="button" className="wb-keep-summary" onClick={() => onOpenReview('brief')} title={keepNotes}>始终保留：{keepNotes}</button>}
            {adjustPendingConfirm && (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 my-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-500">
                <span>上一轮目标已清除，请选定新目标；或</span>
                <button
                  type="button"
                  className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 font-medium text-[11px] text-amber-500 transition-colors"
                  onClick={onConfirmWholeProject}
                >
                  确认整片修改
                </button>
              </div>
            )}
            <LeiBoxComposer
              harnesses={composerHarnesses}
              harness={selectedHarness?.id}
              onHarnessChange={setHarnessId}
              selectedModel={backendModels.length ? effectiveModel : undefined}
              onModelChange={setModel}
              onThinkingChange={setWorkbenchEffort}
              selectedEffort={workbenchEffort}
              modelTrigger="square"
              showContextRing={false}
              busy={engineeringBusy || replyStreamActive || stopping}
              /* 只有会话回复流在跑时才给停止键：工程任务停不了，给了就是骗点击。
                 官方只看 busy 画停止键，所以能否停止要单独告诉包装层（canStop）。
                 工程任务的取消入口在下方任务面板，不在输入框。 */
              canStop={replyStreamActive}
              stopping={stopping}
              onStop={() => {
                const sid = currentSession?.id
                if (!sid) return
                /* 停止必须打到后端：只断本地 SSE 的话，后端进程会继续跑完并落库。
                   失败时如实说明「已停止等待，但后端可能仍在执行」，不谎报停掉。 */
                setStopping(true)
                void chatStreamManager.stop(sid).then((outcome) => {
                  setStopping(false)
                  /* 按后端真实答复分开说，绝不把「没停到」说成「已停止」。
                     supersededRound：后端停掉了，但那条回复已经不在了
                     （刚跑完或已换新一轮），本地没有需要收尾的东西。 */
                  if (outcome.supersededRound) {
                    onNotice?.('这次停止针对的回复已经结束了；如果还有新的回复在生成，请再点一次停止。')
                  } else if (outcome.status === 'not_running') {
                    onNotice?.('这次没有停止到正在运行的回复；回复可能继续，也可能已经结束。请以会话历史里的最新回复为准。')
                  } else if (outcome.status === 'failed') {
                    onNotice?.(`停止请求没有送达（${(outcome.error ?? '').slice(0, 60)}）。回复可能继续，请再点一次停止或查看执行记录。`)
                  }
                })
              }}
              draft={sessionDraft.draft.text}
              onDraftChange={(text) => sessionDraft.updateDraft({ text })}
              onFlush={(text) => sessionDraft.flushText(text)}
              onSubmit={(payload) => {
                const v = payload.text.trim()
                if (!v) return
                /* 提交成功后清空：失败时保留输入，用户改一个字就能重发。 */
                void onSubmit(v).then((ok) => {
                  if (ok) {
                    chat.setDraft('')
                    sessionDraft.clearDraft()
                  }
                })
              }}
            />
            {realModifyError ? (
              <div className="wb-compose-error flex items-center justify-between gap-2">
                <span className="flex-1">{realModifyError}</span>
                {(adjustPendingConfirm || canConfirmWholeProject) && (
                  <button
                    type="button"
                    className="px-2 py-0.5 text-xs rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-medium whitespace-nowrap"
                    onClick={onConfirmWholeProject}
                  >
                    确认整片修改
                  </button>
                )}
                <button type="button" onClick={onClearRealModifyError} title="关闭"><UiIcon icon={SemIcons.close} className="size-3" /></button>
              </div>
            ) : null}
            {activeLive && <div className="fw-compose-note">排队记录</div>}
          </div>
        </>
      ) : sideTab === 'task' ? (
        <TaskPanel activeTask={activeTask} records={records} cancelTask={cancelTask}
                   scope={scope} constraints={constraints}
                   onResumeRequest={onResumeRequest} onBack={onBackFromTask} />
      ) : (
        <div className="fw-scroll">
          <div className="flex flex-col gap-3 p-3.5">
            <div className="flex items-center gap-2">
              <button className="wb-btn-ghost wb-insp-back" type="button" onClick={() => setSideTab('chat')}>
                <UiIcon icon={ChevronLeft} className="size-3" />返回对话
              </button>
              <span className="fw-panel-title">修改设置</span>
            </div>
            <div className="fw-scene-hd">修改作用范围</div>
            <SegmentedControl value={scope} onChange={onScopeChange}
                              ariaLabel="修改作用范围"
                              className="fw-scope-seg"
                              options={[
                                ...(preview ? [{ value: 'selection' as const, label: '当前预览' }] : []),
                                { value: 'project', label: '整个项目' },
                              ]} />

            <div className="wb-sep" />
            <button type="button" className="wb-desk-secondary" onClick={() => onOpenReview('brief')}>编辑特别保留要求 <UiIcon icon={ArrowUpRight} size="xs" /></button><div className="fw-scene-hd">保留条件</div>
            {CONSTRAINT_LABELS.map(([key, label]) => {
              /* 真实修改暂不执行这些约束：禁用而不是让人勾上然后静默忽略。
                 勾了却不生效，用户会以为改动受到了保护。 */
              const supported = sourceMode || REAL_MODIFY_SUPPORTED_CONSTRAINTS.has(key)
              return (
                <div key={key} className="fw-constraint-row" data-unsupported={!supported || undefined}
                     title={supported ? undefined : '当前仅支持修改文字与颜色，该保留条件暂不生效'}>
                  <span>{label}</span>
                  <Switch checked={constraints[key]} disabled={!supported}
                          aria-label={label}
                          onCheckedChange={(checked) => setConstraints((c) => ({ ...c, [key]: checked }))} />
                </div>
              )
            })}
            <div className="wb-constraint-note">
              当前只支持「不修改其他场景」；其余保留条件暂不生效，已禁用。
            </div>

            <div className="wb-sep" />
            <div className="fw-scene-hd">快捷操作</div>
            <div className="grid grid-cols-3 gap-1.5">
              {quickActions.filter((a) => !['undo', 'redo', 'compare', 'assets', 'camera', 'captions'].includes(a.id)).map((a) => (
                <button key={a.id} type="button" onClick={() => onQuickAction(a)}
                        className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-md border border-line bg-hole p-1 text-center text-[10px] text-dim transition-colors hover:border-acc/60 hover:text-fg">
                  <a.icon className="size-3.5" />{a.label}
                </button>
              ))}
            </div>

            <div className="wb-sep" />
            <div className="fw-scene-hd">预览来源</div>
            <div className="rounded-md border border-line bg-hole p-2.5 text-[10.5px] leading-relaxed text-dim">
              {preview ? `${preview.tierLabel} · ${preview.name} · ${preview.origin === 'editor' ? '编辑版本' : '工作流'} v${preview.revision}` : '当前项目还没有生成可查看的预览。'}
            </div>
            <button className="mini h-7 justify-start text-[11px]" type="button" onClick={() => onNavigate('render')}>
              <UiIcon icon={ArrowUpRight} className="size-3" />打开渲染与交付
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}

/* ── 右栏：场景检查器（次级视图）────────────────────────────
   场景是编辑对象，AI 只是它的一个动作。这里把「改哪一场、这一场是什么、
   当前参数/约束/引用/执行状态」放在一处；默认右栏是对话。 */
export function ReferenceChips({ references, onRemoveReference, onLocateReference,
  onToggleReferenceRole, onClearReferences, onOpenResourcePicker }:
  { references: AgentReference[]
    onRemoveReference: (id: string) => void; onLocateReference: (ref: AgentReference) => void
    onToggleReferenceRole: (id: string) => void; onClearReferences: () => void
    onOpenResourcePicker: () => void }) {
  /* 三库引用单独标出来：它们决定 agent 会去读哪个文件、哪一段，
     和「当前目标/上下文」这类画面位置引用不是一回事。 */
  const libraryKinds = new Set(['asset', 'reference', 'technique'])
  return (
    <div className="fw-ref-chips">
      <button className="fw-ref-clear fw-ref-add" type="button" onClick={onOpenResourcePicker} title="从素材库 / 参考片库 / 特效库选择"><UiIcon icon={SemIcons.plus} size="sm" aria-hidden="true" />引用资源</button>
      {/* 未引用时不铺「当前目标：整个项目」这类默认文字 —— 它只是在描述
          输入框占位符已经说过的同一件事，空着反而更清楚。
          「+ 引用资源」按钮保留：那是挂素材/参考片/特效的唯一入口。 */}
      {references.length === 0
        ? null
        : references.map((ref) => (
          <span key={ref.id} className="fw-ref-chip" data-role={ref.role}>
            <button className="fw-ref-role" type="button" title={ref.kind === 'preview' && !ref.source.workflowId && ref.source.origin !== 'editor' ? '参考资料仅作为上下文' : '切换目标/上下文'} disabled={ref.kind === 'preview' && (ref.endTimeSeconds !== undefined || (!ref.source.workflowId && ref.source.origin !== 'editor'))}
                    onClick={() => onToggleReferenceRole(ref.id)}>{ref.role === 'target' ? '目标' : '上下文'}</button>
            <button className="fw-ref-label" type="button" title="定位到引用"
                    onClick={() => {
                      /* 三库资源没有「画面位置」可定位：点了只给一句说明，
                         不要假装跳转成功。 */
                      if (libraryKinds.has(ref.kind)) return
                      onLocateReference(ref)
                    }}>{ref.label}</button>
            <button type="button" title="移除引用" onClick={() => onRemoveReference(ref.id)}>×</button>
          </span>
        ))}
      {references.length > 0 && <button className="fw-ref-clear" type="button" onClick={onClearReferences}>清空</button>}
    </div>
  )
}

/* ── 右栏：当前任务 ─────────────────────────────────────────── */
export function TaskPanel({ activeTask, records, cancelTask, scope, constraints, onBack, onResumeRequest }:
  { activeTask: AgentTask | null; records: TaskRecord[]; cancelTask: (id: string) => void
    scope: 'project'|'scene'|'selection'; constraints: ModificationConstraints
    onBack: () => void; onResumeRequest: (request: TaskRequest) => void }) {
  const record = activeTask ? records.find((r) => r.task.id === activeTask.id) : null
  /* 作用范围只说「当前场景」：原来拼的是 `场景 · s01`，又把数据层 id 露出来了。 */
  const recordedConstraints = record?.request?.constraints ?? constraints
  const recordedScope = record?.request?.scope ?? scope
  const scopeLabel = recordedScope === 'project' ? '整个项目' : recordedScope === 'scene' ? '当前场景' : '所选范围'
  return (
    <div className="fw-scroll">
      <div className="flex flex-col gap-3 p-3.5">
        <button className="wb-btn-ghost wb-insp-back" type="button" onClick={onBack}>
          <UiIcon icon={ChevronLeft} className="size-3" />返回
        </button>
        <div className="fw-scene-hd">当前任务</div>
        {activeTask ? (
          <div className="fw-task-card">
            <div className="flex items-center gap-2">
              {(activeTask.status === 'queued' || activeTask.status === 'running' || activeTask.status === 'building')
                ? <UiIcon icon={SemIcons.loading} className="size-3 animate-spin text-acc" />
                : <span className="fm-dot" data-s={activeTask.status === 'completed' ? 'done' : activeTask.status === 'failed' ? 'failed' : 'idle'} />}
              <b>{activeTask.title}</b>
              <span className="fw-count ml-auto">{TASK_STATUS_LABEL[activeTask.status] ?? activeTask.status}</span>
            </div>
            {record?.events.slice(-5).map((e) => (
              <div key={e.id} className="mt-1.5 text-[10.5px] text-dim">· {e.message}</div>
            ))}
            {(activeTask.status === 'queued' || activeTask.status === 'running' || activeTask.status === 'building') && (
              <button className="mini mt-2 h-6 px-2 text-[10.5px]" type="button" onClick={() => cancelTask(activeTask.id)}>
                <UiIcon icon={Square} className="size-2.5" />停止任务
              </button>
            )}
          </div>
        ) : (
          <div className="fw-tray-empty">没有正在执行的任务。</div>
        )}
        <div className="wb-sep" />
        <RequestSnapshot request={record?.request}/>
        {record?.request && activeTask && ['failed', 'cancelled'].includes(activeTask.status) && <button type="button" className="wb-btn-ghost" onClick={() => onResumeRequest(record.request!)}><UiIcon icon={SemIcons.back} size="xs" />带回对话继续编辑</button>}
        <div className="fw-scene-hd">发送时的作用范围</div>
        <div className="fw-chips"><span className="fw-chip">{scopeLabel}</span></div>
        <div className="fw-scene-hd">保留条件</div>
        {record?.modify ? (
          /* 真实修改：如实说「本次没有提交保留条件」。
             不能拿界面当前的约束顶替 —— 那是用户此刻的勾选状态，
             不是这次任务实际发送的内容，展示出来等于编一份没发生的请求。 */
          <div className="wb-insp-kv"><span>本次未提交保留约束</span><b>不保留</b></div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {CONSTRAINT_LABELS.map(([key, label]) => (
              <span key={key} className="wb-insp-kv"><span>{label}</span><b>{recordedConstraints[key] ? '保留' : '不保留'}</b></span>
            ))}
          </div>
        )}
        {record?.modify && (
          <>
            <div className="fw-scene-hd">本次实际提交</div>
            <div className="flex flex-col gap-1.5">
              <span className="wb-insp-kv"><span>基于场景版本</span><b>v{record.modify.baseVersion}</b></span>
              <span className="wb-insp-kv"><span>目标场景</span><b>{record.modify.sceneIds.length > 0 ? record.modify.sceneIds.join('、') : '整片'}</b></span>
            </div>
            <div className="wb-constraint-note">
              当前只支持修改文字或颜色，暂不支持参考定位与保留约束。
            </div>
          </>
        )}
        <div className="wb-sep" />
        <div className="text-[10.5px] leading-relaxed text-dim">
          任务 ≠ 质量验收。完成只代表这次执行结束，是否接受还要看变更与验证。
        </div>
      </div>
    </div>
  )
}

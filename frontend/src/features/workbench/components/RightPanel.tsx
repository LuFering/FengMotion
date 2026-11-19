import { useEffect, useRef } from 'react'
import { chatStreamManager } from '@/features/chat/services/chatStreamManager'
/* 下面几个子组件的引入顺序决定它们样式的注入顺序，与拆分前保持一致，不要调换。 */
import { RightPanelThread } from '@/features/workbench/components/rightpanel/RightPanelThread'
import { LeiBoxComposer } from '@/features/chat/components/LeiBoxComposer'
import { ComposeContextBar } from '@/features/workbench/components/rightpanel/ComposeContextBar'
import { HistoryVersionNotice } from '@/features/workbench/components/rightpanel/HistoryVersionNotice'
import { ComposeErrorBar } from '@/features/workbench/components/rightpanel/ComposeErrorBar'
import { ModifySettingsPanel } from '@/features/workbench/components/rightpanel/ModifySettingsPanel'
import { TaskPanel } from '@/features/workbench/components/rightpanel/TaskPanel'
import { SceneTargetFacts } from '@/features/workbench/components/rightpanel/SceneTargetFacts'
import { type TaskRecord } from '@/features/creation/hooks/useAgentTasks'
import type { AgentReference, AgentTask, ModificationConstraints, TaskRequest } from '@/api/studioApi'
import { type StageVisual } from '@/features/workbench/model/stageVisual'
import { versionSeriesOf, type ProjectVersionInfo } from '@/features/workbench/model/versionIdentity'
import type { ChatState } from '@/features/chat/hooks/useChat'
import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import type { ViewId } from '@/shared/navigation/views'
import type { Session } from '@/features/chat/hooks/useSessions'
import { type TimeSpan } from '@/features/workbench/model/timeRange'
import { type SideTab, quickActions } from '@/features/workbench/model/workbenchConsole'
import { useThreadMessages } from '@/features/workbench/hooks/rightpanel/useThreadMessages'
import { useReplyStop } from '@/features/workbench/hooks/rightpanel/useReplyStop'
import { useComposerEngine } from '@/features/workbench/hooks/rightpanel/useComposerEngine'

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
  const { backendModels, effectiveModel, composerHarnesses, selectedHarness, setHarnessId, setModel, setWorkbenchEffort, workbenchEffort } = useComposerEngine()

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
  const { replyStreamActive, stopping, setStopping } = useReplyStop({ chat, currentSession, engineeringBusy, onNotice })
  const { messages, workbenchMeterKinds, workbenchMeterWindow } = useThreadMessages({ backendModels, chat, currentSession, effectiveModel, projectId })

  return (
    <aside className="fw-panel" aria-label="AI 对话">
      {/* 标题与页签栏已上移到底座（ConsoleChrome）：三个面板共用同一条页签，
          否则切到「场景版本」时整条页签会跟着旧面板一起消失。 */}

      {sideTab === 'scene' ? (<SceneTargetFacts preview={preview} setSideTab={setSideTab} target={target} />
      ) : sideTab === 'chat' ? (
        <>
          <RightPanelThread
            activeDone={activeDone}
            activeLive={activeLive}
            activeRecord={activeRecord}
            activeTask={activeTask}
            cancelTask={cancelTask}
            currentSession={currentSession}
            executionPhase={executionPhase}
            getRoundOutcome={getRoundOutcome}
            isSessionLoading={isSessionLoading}
            latestEvent={latestEvent}
            messages={messages}
            onCancelQueued={onCancelQueued}
            onClearRoundOutcome={onClearRoundOutcome}
            onOpenTask={onOpenTask}
            onResumeRequest={onResumeRequest}
            onRetryMessages={onRetryMessages}
            onRetrySaveAllReplies={onRetrySaveAllReplies}
            onRetrySaveReply={onRetrySaveReply}
            onStartQueued={onStartQueued}
            pending={pending}
            projectId={projectId}
            realModifyBusy={realModifyBusy}
            records={records}
            unsavedReplies={unsavedReplies}
            workbenchMeterKinds={workbenchMeterKinds}
            workbenchMeterWindow={workbenchMeterWindow}
          />

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
              <HistoryVersionNotice onRestoreVersion={onRestoreVersion} onViewLead={onViewLead} preview={preview} projectVersionAuthoritative={projectVersionAuthoritative} projectVersionNumber={projectVersionNumber} />
            )}
            <ComposeContextBar
              onClearRange={onClearRange}
              onClearReferences={onClearReferences}
              onLocateReference={onLocateReference}
              onOpenResourcePicker={onOpenResourcePicker}
              onRemoveReference={onRemoveReference}
              onResetScope={onResetScope}
              onRestoreVersion={onRestoreVersion}
              onToggleReferenceRole={onToggleReferenceRole}
              onViewLead={onViewLead}
              preview={preview}
              projectId={projectId}
              projectVersion={projectVersion}
              projectVersionNumber={projectVersionNumber}
              rangeSpan={rangeSpan}
              references={references}
              scope={scope}
              sessionDraft={sessionDraft}
            />
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
              <ComposeErrorBar adjustPendingConfirm={adjustPendingConfirm} canConfirmWholeProject={canConfirmWholeProject} onClearRealModifyError={onClearRealModifyError} onConfirmWholeProject={onConfirmWholeProject} realModifyError={realModifyError} />
            ) : null}
            {activeLive && <div className="fw-compose-note">排队记录</div>}
          </div>
        </>
      ) : sideTab === 'task' ? (
        <TaskPanel activeTask={activeTask} records={records} cancelTask={cancelTask}
                   scope={scope} constraints={constraints}
                   onResumeRequest={onResumeRequest} onBack={onBackFromTask} />
      ) : (
        <ModifySettingsPanel
          constraints={constraints}
          onNavigate={onNavigate}
          onOpenReview={onOpenReview}
          onQuickAction={onQuickAction}
          onScopeChange={onScopeChange}
          preview={preview}
          scope={scope}
          setConstraints={setConstraints}
          setSideTab={setSideTab}
          sourceMode={sourceMode}
        />
      )}
    </aside>
  )
}

import type * as React from 'react'
import { ChecklistDrawer } from '@/features/chat/components/bencho/Checklist'
import { TargetSummaryPill } from '@/features/chat/components/TargetSummaryPill'
import { ComposerAttachments } from '@/features/chat/components/ComposerAttachments'
import { PURPOSE_LABEL, type AssetPurpose } from '@/features/assets/hooks/usePendingAssets'
import { LeiBoxComposer, type ContextUsageSnapshot } from '@/features/chat/components/LeiBoxComposer'
import { noteDraftInput, type SessionDraft } from '@/features/chat/hooks/useDraftStore'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import type { Session } from '@/features/chat/hooks/useSessions'
import type { ComposerAttachment } from '@/features/chat/model/composerAttachment'
import type { HarnessModel, HarnessDescriptor } from '@/api/harnesses'
import type { ChatMessage } from '@/features/chat/hooks/useChat'
import type { ConversationProps } from '@/features/chat/Conversation'

export interface ConversationComposerSeatProps {
  activeIsServer: boolean
  activeThread: Session | null
  addFiles: (files: File[], forced?: 'file' | 'image' | 'video', done?: () => void) => void
  attachments: ComposerAttachment[]
  backendModels: HarnessModel[]
  composerContextUsage: ContextUsageSnapshot | null
  composerHarnesses: { id: string; name: string; iconUrl: string; available: boolean; models: { id: string; name: string; reasoningEfforts: string[] | undefined }[] }[]
  composerMeterPanel: React.JSX.Element | null
  composerPromptTokens: number | null
  effectiveModel: string
  fileRef: React.RefObject<HTMLInputElement | null>
  imageRef: React.RefObject<HTMLInputElement | null>
  messages: ChatMessage[]
  onPickFiles: (e: React.ChangeEvent<HTMLInputElement>) => void
  pending: boolean
  projectPending: boolean
  props: ConversationProps
  selectedHarness: HarnessDescriptor | undefined
  sendError: string | null
  sessionDraft: { draft: SessionDraft; updateDraft: (updater: Partial<SessionDraft> | ((prev: SessionDraft) => Partial<SessionDraft>)) => SessionDraft; flushText: (text: string) => void; clearDraft: () => void; key: string }
  setAttachments: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
  setHarnessId: (harness: string) => void
  setModel: (model: string) => void
  setSendError: React.Dispatch<React.SetStateAction<string | null>>
  setThinking: (reasoningEffort: string) => void
  stageLeadVersion: number | null
  stopping: boolean
  streamStopRef: React.RefObject<(() => void) | null>
  submit: (text?: string) => void
  submitting: boolean
  /** 浮在输入席上缘的内容（「回到最新」圆钮）：跟着输入席的实际高度走，不会压到目标条 */
  overlay?: React.ReactNode
}

/** 对话页底部的输入区：任务清单抽屉、发送目标胶囊、附件条、输入框与发送失败提示。 */
export function ConversationComposerSeat({ activeIsServer, activeThread, addFiles, attachments, backendModels, composerContextUsage, composerHarnesses, composerMeterPanel, composerPromptTokens, effectiveModel, fileRef, imageRef, messages, onPickFiles, pending, projectPending, props, selectedHarness, sendError, sessionDraft, setAttachments, setHarnessId, setModel, setSendError, setThinking, stageLeadVersion, stopping, streamStopRef, submit, submitting, overlay }: ConversationComposerSeatProps) {
  return (
    <div className="cv3-seat">
      {overlay}
      {/* 输入框：几何取自 BoardUI 免费聊天模板（52px 胶囊 / 36px 圆钮 /
          10px 间距），加载态是环绕光带。
          引擎与模型选择器沿用对话界面原来那一套（composerModelPicker），
          不换实现 —— 第 10 项要的就是「用对话界面的」。
          ⚠️ 必须包在 .cv3-compose 里：那个类带着左右 32px 内边距与
          「与消息列同宽并居中」的约束。原先是 .cv3-card 提供宽度，
          换成新组件后如果直接挂到 .cv3-seat 上，输入框会横跨整个主区
          （实测 1044px vs 消息列 680px），跟上面的对话完全不对齐。 */}
      {/* 任务清单抽屉：停靠在输入框上方，与输入框同宽。
          数据取「最后一条有 todos 的 AI 消息」—— todo_write 是整表替换，
          最后一份就是当前状态。 */}
      {(() => {
        const lastTodos = [...messages].reverse().find((m) => m.todos && m.todos.length > 0)?.todos
        if (!lastTodos) return null
        return (
          <div className="cv3-todo-dock">
            <ChecklistDrawer items={lastTodos} defaultOpen={!pending} />
          </div>
        )
      })()}
      <div className="cv3-compose">
      {/* 居中盒：宽度约束与正文列 .cv3-col 同源（见 conversation.css 的 --cv-compose-w），
          否则输入框会比正文宽出一截，看上去被「拉长」且左右对不齐。 */}
      <div className="lbx-compose-box">
      {/* 始终显示：用户在看到输入框时就该知道这句话发出去会走哪条路。
          显示内容由 resolveSendPlan 决定，与真实发送是同一个判定 ——
          不再「有目标才显示」，也不再让组件默认值把普通对话画成修改工程。 */}
      {(
        <TargetSummaryPill
          layoutMode="normal"
          targetSnapshot={sessionDraft.draft.targetSnapshot}
          draftIntent={sessionDraft.draft.intentAction}
          continuationScopeMode={sessionDraft.draft.continuationScopeMode}
          hasProject={Boolean(activeThread?.projectId)}
          isServerSession={Boolean(activeIsServer)}
          /* 目标版本来源：胶囊据此决定是否可与工程版本比较 */
          versionSeries={
            sessionDraft.draft.targetSnapshot?.version !== undefined
              && sessionDraft.draft.targetSnapshot?.version !== null
              ? 'scene'
              : null
          }
          /* 工程版本读不到时传 null + unconfirmed，让胶囊降级措辞 */
          stageLeadVersion={stageLeadVersion}
          versionUnconfirmed={stageLeadVersion === null}
          onIntentChange={(intent) => {
            /* 与工作台同一套写入：意图既进目标快照，也独立存一份，
               免得某天这里的目标被清空后意图跟着丢失。 */
            sessionDraft.updateDraft({
              intentAction: intent,
              ...(sessionDraft.draft.targetSnapshot
                ? { targetSnapshot: { ...sessionDraft.draft.targetSnapshot, intentAction: intent } }
                : {}),
            })
          }}
          onRemoveTarget={() => sessionDraft.updateDraft({ targetSnapshot: null })}
          onViewLead={() => {
            if (activeThread?.projectId) {
              props.onOpenWorkbench(props.activeSessionId)
            }
          }}
        />
      )}
      {/* 继续调整却没选目标：同一套提示条，两个出路并排 —— 去工作台圈定，或确认整片改 */}
      {sessionDraft.draft.continuationScopeMode === 'target_required' && !sessionDraft.draft.targetSnapshot && (
        <div className="cv3-notice cv3-scope-note" data-tone="warn" role="status">
          <UiIcon icon={SemIcons.warning} size="sm" className="cv3-notice-icon" />
          <span className="cv3-notice-text">还没选要改的画面或时间段</span>
          {activeThread?.projectId && (
            <button type="button" className="cv3-notice-btn" onClick={() => props.onOpenWorkbench(props.activeSessionId)}>
              去工作台选
            </button>
          )}
          <button type="button" className="cv3-notice-btn"
                  onClick={() => { sessionDraft.updateDraft({ continuationScopeMode: 'whole_confirmed' }); setSendError(null) }}>
            整片修改
          </button>
        </div>
      )}
      {/* 输入框整体使用 LeiBox 官方「Agent 对话输入框」原版实现：
          内部是官方打包产物（自带 React / GSAP / 图标与全部动效），
          不再保留任何自研元素。
          contextUsage 是官方圆圈（以及它自带的「上下文组成」面板）的数据源：
          传进去圆圈才显示真实百分比，而不是恒定的 0%。 */}
      <ComposerAttachments
        items={attachments.map((item) => ({
          name: item.name,
          kind: item.kind === 'image' ? 'image' : 'file',
          src: item.previewUrl,
          progress: item.progress,
          error: item.uploadError,
          note: item.note,
          caption: item.purpose && item.purpose !== 'unspecified' ? PURPOSE_LABEL[item.purpose as AssetPurpose] : item.kind === 'video' ? '视频' : undefined,
        }))}
        onRemove={(index) => setAttachments((old) => {
          const item = old[index]
          if (item?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
          return old.filter((_, i) => i !== index)
        })}
      />
      <LeiBoxComposer
        harnesses={composerHarnesses}
        harness={selectedHarness?.id}
        onHarnessChange={setHarnessId}
        selectedModel={backendModels.length ? effectiveModel : undefined}
        onModelChange={setModel}
        onThinkingChange={setThinking}
        busy={pending || stopping || submitting || projectPending}
        /* 对话区的 busy 只表示回复流，能停就是能停。
           停止结果未回时仍保留停止键：用户可以再点一次重试。 */
        canStop={pending}
        stopping={stopping}
        onStop={() => streamStopRef.current?.()}
        contextUsage={composerContextUsage}
        contextUsageFallbackTokens={composerPromptTokens ?? undefined}
        contextPanel={composerMeterPanel}
        draft={sessionDraft.draft.text}
        onDraftChange={(text) => sessionDraft.updateDraft({ text })}
        onFlush={(text) => sessionDraft.flushText(text)}
        /* 用户真实输入时作废「刚发送」标记：
           否则他主动重新输入同一句话会被当成迟来回调而存不进草稿。 */
        onUserInput={() => noteDraftInput(activeThread?.projectId, props.activeSessionId)}
        onSubmit={(payload) => {
          if (payload.text.trim()) submit(payload.text)
        }}
      />
      {/* 发送失败提示：官方组件只负责输入与提交，
          发送结果（网络/校验失败）仍由本页判断并显示。 */}
      {sendError ? (
        <p className="cv3-compose-note" role="alert" data-error="">
          <UiIcon icon={SemIcons.error} size="sm" />
          <span>{sendError}</span>
          <button type="button" className="cv3-compose-note-x" aria-label="关闭" onClick={() => setSendError(null)}>
            <UiIcon icon={SemIcons.close} size="xs" />
          </button>
        </p>
      ) : null}
      </div>
      </div>
      {/* 隐藏的文件选择器（对齐 dsh 的 file input：多选） */}
      <input ref={fileRef} type="file" multiple hidden onChange={onPickFiles} />
      <input ref={imageRef} type="file" accept="image/*" multiple hidden
             onChange={(e) => addFiles(Array.from(e.target.files ?? []), 'image', () => { if (imageRef.current) imageRef.current.value = '' })} />
    </div>
  )
}

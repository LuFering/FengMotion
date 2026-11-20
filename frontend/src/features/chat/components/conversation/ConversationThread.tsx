import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Button } from '@/shared/ui/button'
import { ChatMessage as ChatBubble } from '@/features/chat/components'
import { LiveRunStatus } from '@/features/chat/components/conversation/LiveRunStatus'
import { type RoundOutcome } from '@/features/chat/model/roundOutcomes'
import { CreationProgress } from '@/features/chat/components/CreationProgress'
import { Minimize01, SlashCircle01 } from '@untitledui/icons'
import { DIAGNOSTIC_LABEL } from '@/features/chat/model/conversationFormat'
import type { Session } from '@/features/chat/hooks/useSessions'
import type { ChatMessage } from '@/features/chat/hooks/useChat'
import type { ConversationProps } from '@/features/chat/Conversation'
import type { SessionDraft } from '@/features/chat/hooks/useDraftStore'
import { AiMessageBlock } from '@/features/chat/components/conversation/AiMessageBlock'
import { Notice } from '@/features/chat/components/conversation/Notice'

export interface ConversationThreadProps {
  activeIsServer: boolean
  activeMessagesLoaded: boolean
  activeThread: Session | null
  agentPhase: { phase: string; label?: string; callId?: string; arguments?: string; isError?: boolean } | null
  entryNote: { sessionId: string | null; text: string } | null
  getRoundOutcome: (userMessageId: string | undefined) => RoundOutcome | null
  messages: ChatMessage[]
  pending: boolean
  pendingStartedAt: number | null
  projectPending: boolean
  props: ConversationProps
  replyNote: string | null
  replySaveRetry: { sessionId: string; userMessageId: string; reply: string; localId: string } | null
  retryLastRound: () => void
  retryMessages: () => void
  retrySaveReply: () => Promise<void>
  retrySync: () => void
  send: (text: string) => void
  sessionDraft: { draft: SessionDraft; updateDraft: (updater: Partial<SessionDraft> | ((prev: SessionDraft) => Partial<SessionDraft>)) => SessionDraft; flushText: (text: string) => void; clearDraft: () => void; key: string }
  setEntryNote: React.Dispatch<React.SetStateAction<{ sessionId: string | null; text: string } | null>>
  setReplyNote: React.Dispatch<React.SetStateAction<string | null>>
  startCreationFromEmpty: () => Promise<void>
  startServerReply: (mode?: { attach?: boolean; rerun?: boolean }) => void
  unfinishedReply: boolean
  userMessages: ChatMessage[]
}

/** 对话页的消息线程：历史读取与同步状态、空会话入口、消息列表、回复中的思考态，以及诊断、上下文占用和用量。 */
export function ConversationThread({ activeIsServer, activeMessagesLoaded, activeThread, agentPhase, entryNote, getRoundOutcome, messages, pending, pendingStartedAt, projectPending, props, replyNote, replySaveRetry, retryLastRound, retryMessages, retrySaveReply, retrySync, send, sessionDraft, setEntryNote, setReplyNote, startCreationFromEmpty, startServerReply, unfinishedReply, userMessages }: ConversationThreadProps) {
  return (
    <div className="cv3-col">
      {/* 服务端会话：历史、发送与 Agent 回复都已接上。
         这里只说明「消息会持久化」这一件用户关心的事实 ——
         之前那句「Agent 回复尚未接入」在接入之后成了错误信息，
         会让人以为发了也没回答（真机截图确认过）。 */}

      {/* 历史读取：加载中 / 失败（可重试）。失败时不清空已读到的部分，
          但必须说明「不是完整历史」—— 空会话与没读到是两件事。 */}
      {activeIsServer && !activeMessagesLoaded && !activeThread?.messagesError && (
        <Notice tone="loading">正在读取历史消息…</Notice>
      )}
      {activeIsServer && activeThread?.messagesError && (
        <Notice tone="warn" detail={activeThread.messagesError} action={{ label: '重试', onClick: retryMessages }}>
          历史消息没读全，下面只是已读到的部分
        </Notice>
      )}
      {/* 首条需求没存进服务端：内容是用户刚写的，必须原样留在界面上并说明没存。
          不说的话，读回历史后这条会消失，看起来就像「刚写的话丢了」。 */}
      {activeIsServer && activeThread?.unsavedFirst && (
        <Notice tone="error" detail={activeThread.unsavedFirst.error}>
          第一条需求没存进服务端，只留在本页，可复制后重新发送
        </Notice>
      )}
      {/* 详情读取失败：标题/时间/计数仍来自列表，只是可能不是最新 —— 明说，并给重试 */}
      {activeIsServer && activeThread?.syncError && (
        <Notice tone="warn" detail={activeThread.syncError} action={{ label: '重试', onClick: retrySync }}>
          会话详情没刷新到，显示的可能不是最新
        </Notice>
      )}
      {userMessages.length === 0 && !activeIsServer && sessionDraft.draft.intentAction !== 'query' && (
        <div className="cv3-start-empty">
          <h2>把想法做成视频</h2>
          <div>
            <Button disabled={projectPending || props.projectsLoading} onClick={() => void startCreationFromEmpty()}>{projectPending ? '正在准备项目…' : props.openProject ? '在当前项目开始制作' : '新建项目开始制作'}</Button>
            <Button variant="ghost" disabled={projectPending} onClick={() => { sessionDraft.updateDraft({ intentAction: 'query' }); setEntryNote({ sessionId: props.activeSessionId, text: '先在本页梳理想法，不制作视频；对话刷新后不保留。' }) }}>先聊想法</Button>
          </div>
        </div>
      )}
      {entryNote?.sessionId === props.activeSessionId && userMessages.length === 0 && <Notice>{entryNote.text}</Notice>}
      {/* 本页草稿：明确「不在服务端」。服务端会话已在上面说明，不重复。 */}
      {activeThread?.origin === 'local' && (
        <Notice tone="warn" role="note" detail={activeThread.localNote}>
          {activeThread.projectId
            ? '这条对话还没保存到服务端，这里的回复只用来梳理需求，不会执行'
            : '这条对话不属于任何项目，只存在本页，刷新后不保留'}
        </Notice>
      )}

      {messages.map((m) => m.role === 'user' ? (
        <ChatBubble
          key={m.id}
          role="user"
          text={m.text}
          at={m.at}
          attachments={m.attachments?.map((a) => ({
            name: a.name,
            kind: a.mimeType?.startsWith('image/') ? 'image' as const : 'file' as const,
            sizeBytes: a.sizeBytes,
          }))}
        />
      ) : (
        <AiMessageBlock key={m.id}
          activeThread={activeThread}
          getRoundOutcome={getRoundOutcome}
          m={m}
          messages={messages}
          pending={pending}
          props={props}
          replySaveRetry={replySaveRetry}
          retryLastRound={retryLastRound}
          retrySaveReply={retrySaveReply}
          send={send}
        />
      ))}

      <CreationProgress projectId={activeThread?.projectId} sessionId={props.activeSessionId} />

      {/* 运行中的状态行：整轮在跑就常驻在最底部，正文出来后也不撤（见 LiveRunStatus） */}
      {pending && (
        <LiveRunStatus
          phase={agentPhase}
          startedAt={pendingStartedAt}
          hasText={Boolean(messages[messages.length - 1]?.role === 'ai' && messages[messages.length - 1]?.text)}
          afterUser={messages[messages.length - 1]?.role === 'user'}
        />
      )}
      {/* 工具调用历史：一轮里可能调十几次工具，只显示「当前一个」等于没有记录。
          这里用 TaskList —— 它是 BoardUI 任务列表的 1:1 移植（第 6、7 项），
          按「任务 → 步骤」组织，比一串 <details> 更像「它到底做了什么」。
          revealed 传真实推进单元数：内部计时器完全关掉，
          显示进度等于真实到达的工具调用数，不编造。

          注意这里**不能加 `pending &&`**：真机验收时发现，回复一结束整个列表
          就连同 usage 一起消失，用户再也回看不到「刚才跑了什么」。
          工具调用是这一轮回复的组成部分，属于历史而不是瞬时状态。

          另一个真机发现：一旦消息挂上了 `executedTools`（落库后读回的历史记录），
          这里必须让位 —— 否则同一次调用会在消息块内外各画一遍，界面上出现
          两条「bash 完成」。两者是同一份数据的前后两个阶段，只能显示一个。 */}
      {/* token 用量：回答「这一轮花了多少」。只显示上游真的报了的桶，
          没报的不占位 —— 显示「输入 0」会让人以为完全没消耗。
          缓存命中单独标出：它含在总计里，单看总计容易高估成本。
          同样不能加 `pending &&`：用量是这一轮的结算，结束后才最该看见。 */}
      {/* 过程诊断：压缩 / token 上限 / 重试。
          只在真发生过时出现；不带正文，不看也不影响阅读，
          但它解释「为什么这次答复不对劲」，藏起来等于没有。 */}
      {(() => {
        const last = [...messages].reverse().find((x) => x.role === 'ai')
        const diags = last?.diagnostics
        if (!diags || diags.length === 0) return null
        return (
          <p className="cv3-diagnostic">
            {diags.map((d, i) => (
              <span key={`${d.kind}-${i}`} data-kind={d.kind}>
                {d.kind === 'max-tokens' ? <UiIcon icon={SemIcons.warning} size="xs" />
                  : d.kind === 'compaction' ? <UiIcon icon={Minimize01} size="xs" />
                  : d.kind === 'retry' ? <UiIcon icon={SemIcons.refresh} size="xs" />
                  : <UiIcon icon={SlashCircle01} size="xs" />}
                {d.detail ?? DIAGNOSTIC_LABEL[d.kind]}
              </span>
            ))}
          </p>
        )
      })()}
      {/* 上下文占用只在输入框的圆环里看（悬停展开分档）；这一轮的用量在回复操作条右侧。
          消息底部不再单独铺一条占用条和一行用量文字。 */}
      {/* 服务端回复的如实说明：能力缺口（Agent 未接入）不是「回复失败」，
          所以用中性说明而不是红色失败块 —— 重试也不会好，别让人白等。 */}
      {replyNote && (
        <Notice role="note"
          action={unfinishedReply && !pending ? { label: '重新执行', onClick: () => { setReplyNote(null); startServerReply({ rerun: true }) } } : undefined}>
          {replyNote}
        </Notice>
      )}
    </div>
  )
}

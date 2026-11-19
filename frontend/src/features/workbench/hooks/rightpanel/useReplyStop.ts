import type * as React from 'react'
import { useSessionStream, chatStreamManager } from '@/features/chat/services/chatStreamManager'
import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '@/features/chat/hooks/useChat'
import type { ChatStreamStatus, ChatReasoningSegment } from '@/api/types/stream'
import type { ChatMessageToolCall } from '@/api/types/chat'
import type { Session } from '@/features/chat/hooks/useSessions'

export interface UseReplyStopArgs {
  chat: { messages: ChatMessage[]; draft: string; setDraft: React.Dispatch<React.SetStateAction<string>>; addUserMessage: (text: string, taskId?: string, projectId?: string, sessionId?: string) => string; setMessageTaskId: (messageId: string, taskId: string) => void; addAiMessage: (m: { text: string; thinking?: string; toolCalls?: { label: string; detail: string }[]; plan?: string[]; changes?: { file: string; change: string }[] }) => void; appendMessage: (m: ChatMessage) => void; clearChat: () => void; replaceMessages: (next: ChatMessage[]) => void; startAiMessage: (options?: { demo?: boolean; projectId?: string; sessionId?: string }) => string; appendAiText: (messageId: string, delta: string, replaceFrom?: number) => void; appendAiReasoning: (messageId: string, delta: string, position?: { textOffset: number; order: number }) => void; setAiTodos: (messageId: string, todos: { content: string; status: 'pending' | 'in_progress' | 'completed' }[]) => void; recordToolCall: (messageId: string, status: ChatStreamStatus) => void; addAiDiagnostic: (messageId: string, kind: 'compaction' | 'max-tokens' | 'retry' | 'interrupted', detail?: string) => void; finishAiMessage: (messageId: string, text: string, executedTools?: ChatMessageToolCall[], reasoning?: string, todos?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[], deliverables?: { path: string; description?: string }[], reasoningSegments?: ChatReasoningSegment[]) => void; failAiMessage: (messageId: string, note: string) => void; removeMessage: (messageId: string) => void }
  currentSession: Session | null | undefined
  engineeringBusy: boolean
  onNotice: ((message: string) => void) | undefined
}

/** 从 RightPanel.tsx 的 RightPanel 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useReplyStop({ chat, currentSession, engineeringBusy, onNotice }: UseReplyStopArgs) {
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
  return { replyStreamActive, stopping, setStopping }
}

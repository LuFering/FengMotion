import type * as React from 'react'
import { useMemo } from 'react'
import type { Kind } from '@/features/chat/components/bencho/ContextMeter'
import type { HarnessModel } from '@/api/harnesses'
import type { ChatMessage } from '@/features/chat/hooks/useChat'
import type { ChatStreamStatus, ChatReasoningSegment } from '@/api/types/stream'
import type { ChatMessageToolCall } from '@/api/types/chat'
import type { Session } from '@/features/chat/hooks/useSessions'

export interface UseThreadMessagesArgs {
  backendModels: HarnessModel[]
  chat: { messages: ChatMessage[]; draft: string; setDraft: React.Dispatch<React.SetStateAction<string>>; addUserMessage: (text: string, taskId?: string, projectId?: string, sessionId?: string) => string; setMessageTaskId: (messageId: string, taskId: string) => void; addAiMessage: (m: { text: string; thinking?: string; toolCalls?: { label: string; detail: string }[]; plan?: string[]; changes?: { file: string; change: string }[] }) => void; appendMessage: (m: ChatMessage) => void; clearChat: () => void; replaceMessages: (next: ChatMessage[]) => void; startAiMessage: (options?: { demo?: boolean; projectId?: string; sessionId?: string }) => string; appendAiText: (messageId: string, delta: string, replaceFrom?: number) => void; appendAiReasoning: (messageId: string, delta: string, position?: { textOffset: number; order: number }) => void; setAiTodos: (messageId: string, todos: { content: string; status: 'pending' | 'in_progress' | 'completed' }[]) => void; recordToolCall: (messageId: string, status: ChatStreamStatus) => void; addAiDiagnostic: (messageId: string, kind: 'compaction' | 'max-tokens' | 'retry' | 'interrupted', detail?: string) => void; finishAiMessage: (messageId: string, text: string, executedTools?: ChatMessageToolCall[], reasoning?: string, todos?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[], deliverables?: { path: string; description?: string }[], reasoningSegments?: ChatReasoningSegment[]) => void; failAiMessage: (messageId: string, note: string) => void; removeMessage: (messageId: string) => void }
  currentSession: Session | null | undefined
  effectiveModel: string
  projectId: string
}

/** 从 RightPanel.tsx 的 RightPanel 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useThreadMessages({ backendModels, chat, currentSession, effectiveModel, projectId }: UseThreadMessagesArgs) {
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
  return { messages, workbenchMeterKinds, workbenchMeterWindow }
}

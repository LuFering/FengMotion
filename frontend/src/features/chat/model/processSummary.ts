import type { ChatMessage } from '@/features/chat/hooks/useChat'

export interface ProcessSummary {
  thoughts: number
  tools: number
  failed: number
}

/** 这条回复有没有可收起的执行过程（思考、工具调用）；没有就返回 null。 */
export function processSummary(m: ChatMessage): ProcessSummary | null {
  const thoughts = m.thinkingSegments?.filter((s) => s.text.trim()).length || (m.thinking ? 1 : 0)
  const calls = m.executedTools ?? []
  const tools = calls.length || (m.toolCalls?.length ?? 0)
  if (thoughts === 0 && tools === 0) return null
  return { thoughts, tools, failed: calls.filter((c) => c.isError).length }
}

/**
 * 消息区里「哪些内容属于本轮回复」的判定。
 *
 * <p>单独抽出来的原因：停止生成会把这一轮的 AI 消息从列表里撤掉，
 * 但界面上的思考、工具调用、上下文条、token 用量是**独立 state**，
 * 不会跟着消失。它们各自的取值逻辑若写成「从末尾往前找第一条符合条件的消息」，
 * 撤销之后就会**越过本轮用户消息、取到上一轮的数据** ——
 * 真机表现是「点了停止，正文没了，上一轮的思考还挂着」。
 *
 * <p>这类越界只在「末尾那条 AI 回复被删掉」时才暴露，靠肉眼验收很难稳定复现，
 * 所以抽成纯函数直接测。</p>
 */
import type { ChatMessage } from '@/shell/useChat'

/** Background replies may finish after navigation. Only show this session's
 * messages; legacy unscoped messages are accepted solely for local chats. */
export function messagesForSession(messages: ChatMessage[], sessionId: string | null, isServer: boolean): ChatMessage[] {
  return messages.filter((message) => message.id !== 'intro'
    && (message.sessionId ? message.sessionId === sessionId : !isServer))
}

/** 一轮的边界：最后一条用户消息之后，到列表末尾。 */
export function currentRoundMessages(messages: ChatMessage[]): ChatMessage[] {
  let lastUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIndex = i; break }
  }
  return messages.slice(lastUserIndex + 1)
}

/**
 * 本轮推理的最终文本（用于「思考」任务）。
 *
 * <p>只在本轮范围内找 —— 越过用户消息往前找会把上一轮的推理显示成本轮的。</p>
 */
export function lastRoundThinking(messages: ChatMessage[]): string {
  const round = currentRoundMessages(messages)
  for (let i = round.length - 1; i >= 0; i--) {
    const m = round[i]
    if (m.role === 'ai' && m.thinking) return m.thinking
  }
  return ''
}

/**
 * 上下文占用条要不要画。
 *
 * <p>它画在消息列表末尾、每条回复的收尾处，属于**当前这条回复**。
 * 停止生成撤销了这条回复后，末尾变成用户消息；此时若仍按
 * 「最后一条带 usage 的 AI 消息」取值，卡片会退回上一轮的读数，
 * 挂在一条已经没有回复的消息下面。</p>
 */
export function shouldShowMessageMeter(input: {
  messages: ChatMessage[]
  hasBreakdown: boolean
  window: number
  promptTokens: number | null
}): boolean {
  const { messages, hasBreakdown, window, promptTokens } = input
  if (messages[messages.length - 1]?.role !== 'ai') return false
  return hasBreakdown && window > 0 && promptTokens !== null && promptTokens > 0
}

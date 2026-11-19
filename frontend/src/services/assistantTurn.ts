import type { ChatMessageToolCall, ChatReasoningSegment, ChatStreamStatus } from '../types/contracts'

export function applyTextDelta(text: string, delta: string, replaceFrom?: number): string {
  return replaceFrom === undefined ? text + delta : text.slice(0, replaceFrom) + delta
}

export function updateTurnTools(calls: ChatMessageToolCall[], status: ChatStreamStatus): ChatMessageToolCall[] {
  if (status.phase !== 'tool') return calls
  if (status.name !== undefined || status.arguments !== undefined || status.textOffset !== undefined) {
    if (status.callId && calls.some(call => call.callId === status.callId)) return calls
    return [...calls, { name: status.name || status.label || '工具',
      ...(status.callId ? { callId: status.callId } : {}),
      ...(status.arguments !== undefined ? { arguments: status.arguments } : {}),
      ...(status.textOffset !== undefined ? { textOffset: status.textOffset } : {}),
      ...(status.order !== undefined ? { order: status.order } : {}) }]
  }
  if (!status.callId) return calls
  return calls.map(call => call.callId === status.callId ? { ...call, done: true, ...(status.isError ? { isError: true } : {}) } : call)
}

export type AssistantTurnBlock =
  | { kind: 'text'; text: string; offset: number }
  | { kind: 'tools'; calls: ChatMessageToolCall[]; offset: number }
  | { kind: 'reasoning'; text: string; offset: number }

/** 追加一段思考增量：同一 order 并进上一段，否则另起一段。不改原数组。 */
export function appendReasoningSegment(segments: ChatReasoningSegment[], delta: string, position: { textOffset: number; order: number }): ChatReasoningSegment[] {
  const last = segments.at(-1)
  if (last && last.order === position.order) return [...segments.slice(0, -1), { ...last, text: last.text + delta }]
  return [...segments, { textOffset: position.textOffset, order: position.order, text: delta }]
}

const validOffset = (offset: number | undefined, max: number) =>
  offset !== undefined && Number.isSafeInteger(offset) && offset >= 0 && offset <= max

/**
 * 把一轮回复拆成依次出现的块：思考 → 正文 → 工具 → 思考 → 正文 → 工具……
 *
 * 位置相同的思考与工具靠 `order` 分先后（这一步的思考与上一步的工具落在同一个正文位置）。
 * 数据不完整时不猜顺序：工具没有合法位置就全部放在最前；思考段缺位置或缺 order 就不分段，
 * 返回的块里不含 reasoning，调用方据此退回整块显示思考。
 */
export function splitAssistantTurn(text: string, calls: ChatMessageToolCall[], segments: ChatReasoningSegment[] = []): AssistantTurnBlock[] {
  let previous = 0
  const ordered = calls.every(call => {
    if (!validOffset(call.textOffset, text.length) || call.textOffset! < previous) return false
    previous = call.textOffset!
    return true
  })
  const staged = ordered && segments.length > 0
    && segments.every(segment => validOffset(segment.textOffset, text.length) && Number.isSafeInteger(segment.order))
    && calls.every(call => call.order !== undefined && Number.isSafeInteger(call.order))
  type Event = { offset: number; order: number; call?: ChatMessageToolCall; reasoning?: string }
  const events: Event[] = calls.map((call, index) => ({ offset: ordered ? call.textOffset! : 0, order: staged ? call.order! : index, call }))
  if (staged) {
    for (const segment of segments) if (segment.text.trim()) events.push({ offset: segment.textOffset, order: segment.order, reasoning: segment.text })
    events.sort((a, b) => a.offset - b.offset || a.order - b.order)
  }
  const blocks: AssistantTurnBlock[] = []
  let cursor = 0
  for (const event of events) {
    if (event.offset > cursor) blocks.push({ kind: 'text', text: text.slice(cursor, event.offset), offset: cursor })
    cursor = Math.max(cursor, event.offset)
    if (event.reasoning !== undefined) {
      blocks.push({ kind: 'reasoning', text: event.reasoning, offset: event.offset })
      continue
    }
    const last = blocks.at(-1)
    if (last?.kind === 'tools' && last.offset === event.offset) last.calls.push(event.call!)
    else blocks.push({ kind: 'tools', calls: [event.call!], offset: event.offset })
  }
  if (cursor < text.length) blocks.push({ kind: 'text', text: text.slice(cursor), offset: cursor })
  return blocks
}

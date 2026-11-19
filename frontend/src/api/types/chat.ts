/** API 契约 · 对话。纯类型，规则见 api/contracts.ts 文件头。 */
import type { DemoFlag, Id, IsoDateTime } from './common'
import type { AgentReference, ModificationConstraints, TaskAttachment } from './task'
import type { ChatReasoningSegment, ChatStreamTodoItem, ContextBreakdown } from './stream'

/* ============================ 对话 ============================ */

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatSession {
  id: Id
  projectId: Id
  title: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  messageCount: number
  demo?: DemoFlag
}

/**
 * 一次工具调用的记录（随助手消息一起返回）。
 *
 * 与流式 `status` 帧的 `callId`/`name`/`arguments`/`isError` 对应，
 * 区别是它已经结束并落了库：用户切走会话再回来，仍能查到这条回复当时跑了什么。
 */
export interface ChatMessageToolCall {
  callId?: string
  name: string
  textOffset?: number
  /** 与思考段共用的先后序号：同一正文位置上靠它分先后。旧记录没有。 */
  order?: number
  /** 参数原文；后端已按 4000 字符截断。 */
  arguments?: string
  /** 是否已经结束（有结果帧）。 */
  done?: boolean
  /** 仅失败时出现。 */
  isError?: boolean
}

export interface ChatMessage {
  id: Id
  sessionId: Id
  role: ChatRole
  text: string
  /** 该条消息触发的任务；只是对话时不出现。 */
  taskId?: Id
  references?: AgentReference[]
  attachments?: TaskAttachment[]
  /** 这条助手回复执行过的工具调用；没有调用时不出现。 */
  toolCalls?: ChatMessageToolCall[]
  /** 这条助手回复的思考过程正文；没有思考时不出现。
      与 toolCalls 同理：思考也是回复的一部分，切走会话再回来要能重新看到。 */
  reasoning?: string
  /** 思考按阶段的分段；旧消息或没有思考时不出现，此时界面退回整块显示 reasoning。 */
  reasoningSegments?: ChatReasoningSegment[]
  /** 模型排的任务清单；没有清单时不出现。切走会话再回来要能回看。 */
  todos?: ChatStreamTodoItem[]
  /** 这条回复的 token 用量；没有记录时不出现。
      带上它，刷新后上下文占用条仍在，而不是只在「刚发完这一轮」时可见。 */
  usage?: ChatMessageUsage
  /** 这条回复交付的文件；没有交付时不出现。
      带上它，刷新后产物卡片仍在（否则 completed 重读历史会把它冲掉）。 */
  deliverables?: { path: string; description?: string }[]
  createdAt: IsoDateTime
  demo?: DemoFlag
}

/**
 * 一条助手回复的 token 用量（落库形态）。
 *
 * 与流式 `ChatStreamUsage` 的区别：这里多了 `promptTokens`（最后一次请求的
 * prompt 大小 —— 上下文占用的分子）和 `toolsTokens` / `contextWindow`
 * （工具 schema 估算与窗口容量），都是从同一条 dsh 请求里记下来的。
 */
export interface ChatMessageUsage {
  /** 本轮各次调用累加的未缓存输入。 */
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  /** 上游给出的总计（含缓存命中）。 */
  totalTokens?: number
  /** 最后一次请求的 prompt 大小（不含输出）—— 上下文占用用它。 */
  promptTokens?: number
  /** 本次请求工具 schema 的估算 token。 */
  toolsTokens?: number
  /** 当时的上下文窗口容量；适配器没上报时不出现。 */
  contextWindow?: number
  /** 上下文分档快照；旧后端不产时保持 undefined。 */
  breakdown?: ContextBreakdown
}

export interface ChatSessionCreateRequest {
  projectId: Id
  title?: string
}

export interface ChatMessageCreateRequest {
  text: string
  references?: AgentReference[]
  attachments?: TaskAttachment[]
  /** 直接下达的修改约束；不传 = 用默认值。 */
  constraints?: ModificationConstraints
}

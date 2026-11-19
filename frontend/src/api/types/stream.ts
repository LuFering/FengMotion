/** API 契约 · 流式协议。纯类型，规则见 api/contracts.ts 文件头。 */
import type { ApiErrorDetail, Id } from './common'
import type { AgentTask, TaskEvent, TaskStatus } from './task'
import type { ChatMessage } from './chat'

/* ============================ 流式协议 ============================ */

export interface TaskStreamSnapshot {
  type: 'snapshot'
  task: AgentTask
  /** 已发生的事件（用于重连补齐，最多最近 200 条）。 */
  events: TaskEvent[]
}

export interface TaskStreamEvent {
  type: 'event'
  event: TaskEvent
}

export interface TaskStreamEnd {
  type: 'end'
  status: TaskStatus
}

export interface StreamError {
  type: 'error'
  error: ApiErrorDetail
}

export type TaskStreamMessage = TaskStreamSnapshot | TaskStreamEvent | TaskStreamEnd | StreamError

export interface ChatStreamDelta {
  type: 'delta'
  messageId: Id
  delta: string
  replaceFrom?: number
}

/**
 * 推理增量帧。
 *
 * <p>与 {@link ChatStreamDelta} 分开：那个进正文（会被渲染、复制、朗读），
 * 这个进折叠的「思考过程」块。混在一个通道里，任一处漏判就会把推理混进答案。</p>
 */
export interface ChatStreamReasoning {
  type: 'reasoning'
  messageId: Id
  delta: string
  /** 发生时正文的长度（UTF-16）；按阶段排正文时才有。 */
  textOffset?: number
  /** 与工具调用共用的先后序号。 */
  order?: number
}

/**
 * 一段思考：排在正文 `textOffset` 处，同一位置上按 `order` 与工具调用分先后。
 * DSH 每一步是「思考 → 正文 → 工具」，这一步的思考与上一步的工具在同一个正文位置。
 */
export interface ChatReasoningSegment {
  textOffset: number
  order: number
  text: string
}

/**
 * 对话一轮改动了工程后的自动渲染进度。
 *
 * 在 `completed` 之后、`end` 之前到达：`rendering` 表示开始渲染，随后是 `rendered`（带版本号）、
 * `failed` 或 `skipped`（改了源码但没有可渲染的入口，或项目正忙）。源码没变时不发。
 */
export interface ChatStreamRender {
  type: 'render'
  state: 'rendering' | 'rendered' | 'failed' | 'skipped'
  version?: number
  artifactPath?: string
  message?: string
}

export interface ChatStreamCompleted {
  type: 'completed'
  message: ChatMessage
}

export interface ChatStreamTask {
  type: 'task'
  messageId: Id
  taskId: Id
}

export interface ChatStreamEnd {
  type: 'end'
}

/**
 * 对话回复的阶段进度帧。
 *
 * 为什么需要它：DSH 走 SDK 通道拿不到 token 级增量（`harness集成与接口清单.md` §1.1
 * 已实测），文本只在提交点整段到达。所以界面能显示的「进度」只有阶段，
 * 不是逐字。没有这一帧的话，用户从发消息到看到回复之间是一段没有任何反馈的空白
 * （实测可达 7.5 秒以上），看起来像卡死。
 *
 * `phase` 取值按后端清单 §1.7：
 *   · `thinking` —— Agent 正在推理/生成
 *   · `tool`     —— 正在调用工具（带 `name` 与人类可读的 `label`）
 *   · `done`     —— 本回合完成
 *
 * 注意：**它不携带正文**。正文只由 `completed` 帧给，不能把 status 当回复。
 */
export interface ChatStreamStatus {
  type: 'status'
  phase: 'thinking' | 'tool' | 'done'
  textOffset?: number
  order?: number
  /** 仅 `phase === 'tool'` 时出现：工具名（如 `bash`）。 */
  name?: string
  /** 仅 `phase === 'tool'` 时出现：给人看的一句话说明。 */
  label?: string
  /**
   * 仅 `phase === 'tool'` 时出现：本次工具调用的 ID。
   *
   * 一次调用发两帧——开始帧（无 `isError`）与结果帧（带 `isError`），
   * 两帧共用同一个 `callId`，界面据此把调用行标成完成或失败。
   * 连续调用多个工具时，靠它区分「是哪一个结束了」。
   */
  callId?: string
  /**
   * 仅在开始帧出现：参数 JSON 原文。
   *
   * 后端最多给 4000 字符（超出以 `…` 截断）——参数可能是整段文件内容或 base64，
   * 原样下发会把单帧撑得很大。截断后仍可用 `callId` 追溯完整调用。
   */
  arguments?: string
  /** 仅在结果帧出现且为失败时存在：这次工具调用是否失败。 */
  isError?: boolean
}

/**
 * token 用量帧：一条助手消息实际消耗的 token。
 *
 * DSH 没有独立的 usage 事件，用量挂在 `assistant/message` 上（后端实测）；
 * 后端把它单独投影成一帧，前端据此显示用量。
 *
 * **所有字段都是可选的**：上游没报的桶就不出现，不补 0 —— 「用了 0 个 token」
 * 与「不知道用了多少」是两件事。注意 `totalTokens` 含缓存命中，不等于
 * input + output，不要自行相加代替它。
 */
export interface ChatStreamUsage {
  type: 'usage'
  /** 未缓存的输入 token。 */
  inputTokens?: number
  outputTokens?: number
  /** 缓存命中读取的 token；上游未报时不出现。 */
  cacheReadTokens?: number
  /** 缓存写入的 token；上游未报时不出现。 */
  cacheWriteTokens?: number
  /** 上游给出的总计（含缓存命中）。 */
  totalTokens?: number
}

/**
 * 会话标题帧：引擎为这条会话起的名字。
 *
 * DSH 自己会生成标题（`session/title` 事件），此前被当成未知事件丢弃，
 * 导致左栏所有会话永远显示「未命名对话」。后端把它落库并单独投影成一帧。
 */
export interface ChatStreamTitle {
  type: 'title'
  title: string
}

/**
 * 心跳帧：SDK 通道没有内建心跳，后端每 15~30 秒补一个注释/事件帧，
 * 用来让前端区分「Agent 还在跑」与「连接其实已经死了」。
 * 它不改变任何状态，只重置空闲计时。
 */
export interface ChatStreamHeartbeat {
  type: 'heartbeat'
}

/**
 * 待办清单帧：模型通过 {@code todo_write} 提交的整份任务清单。
 *
 * <p>DSH 的 todo 工具是「整表替换」语义：每次调用都给出完整清单，
 * 界面按最后一次为准，不做增量合并。状态由模型自己推进
 * （pending → in_progress → completed）。</p>
 */
export interface ChatStreamTodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface ChatStreamTodo {
  type: 'todo'
  todos: ChatStreamTodoItem[]
}

/**
 * 过程诊断帧：解释「为什么这次结果不对劲」，不携带正文。
 *
 * <p>四类：上下文压缩、达到 token 上限、模型重试、被中断。
 * 它们以前全被后端丢弃，用户只看到「答复怪怪的」却没有任何线索。</p>
 */
export interface ChatStreamDiagnostic {
  type: 'diagnostic'
  kind: 'compaction' | 'max-tokens' | 'retry' | 'interrupted'
  /** 给人看的一句话说明；可能不出现。 */
  detail?: string
}

/**
 * 上下文容量帧：当前模型最多能吃多少 token（占用率的分母）。
 *
 * 来源是 DSH 的 `request/context` 事件，每次发请求前记一条。
 * **和 `usage` 是两回事**：usage 说「这次用了多少」，这里说「最多能用多少」。
 * 分开发是因为更新时机不同 —— usage 每轮都变，窗口只跟模型走。
 *
 * 该字段 DSH 侧可能缺失（适配器没上报），所以后端**没值就不发帧**，
 * 前端读不到就当作「不知道」，不要编一个分母出来。
 */
export interface ChatStreamContext {
  type: 'context'
  /** 上下文窗口 token 数。窗口大小只在换模型时变，收到就覆盖。 */
  contextWindow?: number
  /** 工具 schema 的估算 token（DSH 的 `request/header`，chars/4）。 */
  toolsTokens?: number
  /** 分档快照；一轮结束时到达。旧后端不产时保持 undefined。 */
  breakdown?: ContextBreakdown
}

/**
 * 上下文分档：把「已用 N token」拆成可解释的几类。
 *
 * 分类口径对齐 magpie 的 `prompt.parts`（实测其各项之和等于总数）。
 * DSH 自带的 contextBreakdown 只分 system / tools / message 三档，
 * 粒度不够 —— 它把附件、工具输出、对话全算进 message。
 */
export interface ContextBreakdown {
  /** 系统提示词与工具 schema */
  systemTokens: number
  /** 记忆与项目规则：AGENTS.md、CLAUDE.md */
  memoryTokens: number
  /** 附件与读过的文件：图片、read 工具结果 */
  filesTokens: number
  /** 工具输出：bash 回显、浏览器快照 */
  resultsTokens: number
  /** 对话正文：历史轮次与当前轮 */
  chatTokens: number
}

/**
 * 后台任务帧：bash / 长任务的开始与结束。
 *
 * DSH 把每个任务登记成 job，成对发 registered / settled。这两类事件
 * 以前被后端整条丢弃，界面上完全没有任务的存在 —— 慢任务期间用户只看到
 * 「卡住了」，被 kill 的任务更是无声无息（实测一个会话 13060 个 job 里 200 个 killed）。
 */
export interface ChatStreamJob {
  type: 'job'
  jobId: string
  /** 任务类型，如 `bash`。 */
  kind: string
  /** 给人看的标签，通常是命令行。 */
  label: string
  /** `running` 表示还在跑；其余是终态。 */
  status: 'running' | 'completed' | 'killed' | 'failed'
  /** 已运行毫秒；未结束时没有这个字段。 */
  durationMs?: number
  /** 结算说明，如 `exit code: 0`。 */
  detail?: string
}

/**
 * 产物帧：模型通过 `present` 工具交付的文件。
 *
 * 这是「东西在哪」的唯一结构化来源。此前后端整条丢弃，用户只能从正文里
 * 自己抠路径。一条回复可能分多次交付，故调用方按路径去重合并。
 */
export interface ChatStreamDeliverables {
  type: 'deliverables'
  files: { path: string; description?: string }[]
}

export type ChatStreamMessage =
  | ChatStreamDelta
  | ChatStreamReasoning
  | ChatStreamRender
  | ChatStreamCompleted
  | ChatStreamTask
  | ChatStreamStatus
  | ChatStreamUsage
  | ChatStreamContext
  | ChatStreamJob
  | ChatStreamDeliverables
  | ChatStreamTitle
  | ChatStreamTodo
  | ChatStreamDiagnostic
  | ChatStreamHeartbeat
  | ChatStreamEnd
  | StreamError

import type { ChatMessage as ContractMessage, ChatSession } from '@/api/contracts'
import type { ChatMessage } from '@/features/chat/hooks/useChat'
import { now } from '@/features/chat/model/sessionStorage'

/**
 * 会话（对话线程）—— 「项目 + 对话」两级结构里的第二级。
 *
 * 参考 deepseek-harness 的工作区模型：工作区（这里叫项目）下面挂多个会话；
 * 没有归属的会话落进「未分组」，之后可以拖到某个项目下。
 * 与 dsh 的差别：本产品的项目就是创作者的片子，所以会话的归属字段叫 projectId，
 * 不另造 workspace 概念。
 *
 * 数据来源（2026-11-01 接入实况，契约 docs/contracts/agent.md §2）：
 *   · **有项目**的会话：走真实 HTTP。
 *     已接：会话列表、创建、详情、**消息历史读取**（GET /chat-sessions/{id}/messages）、
 *     **发送**（POST /chat-sessions/{id}/messages，202 才算发出）、**删除**（DELETE，软删除）。
 *     未接：SSE 回复。后端端点已就绪但会如实返回 `agent_unavailable`（Agent 进程没接），
 *     所以这类会话发出的消息会保存，但不会得到回复 —— 界面必须说「Agent 未接入」，
 *     不得编造回复，也不得把「已保存」说成「已回复」。
 *   · **无项目（未分组）**的会话：服务端没有这个端点（契约要求会话必须属于项目），
 *     只保留本页草稿并标「仅本页 · 未保存」，**不调用真实创建**。
 *
 * 读失败就是失败：列表加载失败给出错误与重试，不把「没读到」显示成「没有会话」。
 * 不做自动降级：连不上就报错，不悄悄换演示数据。
 */
export interface Session {
  id: string
  /** 会话标题：首条需求截断，用户可改（服务端会话暂无改名端点，只读） */
  title: string
  /** 归属项目；null = 未分组（本页草稿，不落盘） */
  projectId: string | null
  /** 工作目录（用户没选就是 null —— 未分组的会话通常也没有目录） */
  workdir: { label: string; path: string } | null
  /** 会话内容。服务端会话：已从服务端读回并映射成界面形状的历史
      （契约 ChatMessage → 界面 ChatMessage，见 `toViewMessage`）；本地草稿：本页暂存。 */
  messages: ChatMessage[]
  /** 置顶：置顶的排在组内最前（同 dsh 的 pinSession）—— 目前仅本页生效 */
  pinned?: boolean
  /** 归档：默认不显示，可在视图选项里筛「显示已归档」—— 目前仅本页生效 */
  archived?: boolean
  createdAt: number
  updatedAt: number
  /** 会话来源：`server` = 服务端已创建；`local` = 仅本页草稿（未分组） */
  origin: 'server' | 'local'
  /** 服务端消息计数（只读；来自 GET /chat-sessions/{id} 的派生值） */
  messageCount?: number
  /** 消息历史是否已从服务端读回（false = 还没读，或读失败；见 `messagesError`） */
  messagesLoaded?: boolean
  /** 消息历史读取失败的原因；有值 = 下面显示的不是完整历史，不得当成空会话 */
  messagesError?: string
  /** 创建服务端会话时随带的用户消息没存进服务端：原文放在这里，界面必须显示出来。
      不能悄悄丢掉 —— 用户刚写完的话，标题里还留着一半，正文没了最容易被当成丢数据。 */
  unsavedFirst?: { text: string; error: string }
  /** 最近一次「本页暂存」的明确说明，供界面显示；没有则不显示 */
  localNote?: string
  /** 服务端会话详情读取失败的原因（列表里已有元数据，这里只标注不是最新） */
  syncError?: string
}

/** 服务端 ISO 时间 → 本地毫秒；解析失败退回当前时间，避免 NaN 排序 */
export const toMs = (iso: string) => {
  const v = Date.parse(iso)
  return Number.isFinite(v) ? v : now()
}

/**
 * 契约消息 → 界面消息。
 *
 * 两边的 `ChatMessage` 同名但不同形状：契约里 role 是 user/assistant/system、时间是 ISO 字符串；
 * 界面里 role 只有 user/ai、时间是毫秒数。这一层映射必须在这里做完 —— 视图里再转一次，
 * 就会出现「有的地方认 role=assistant、有的地方只认 ai」两套判断。
 *
 * system 消息不下发展示（契约 agent.md §3：系统角色只进上下文，不进对话记录）。
 * `demo` 一律为 false：服务端读回来的就是真实持久消息，不能带演示标记。
 */
export function toViewMessage(m: ContractMessage, sessionId?: string): ChatMessage {
  return {
    id: m.id,
    role: m.role === 'user' ? 'user' : 'ai',
    text: m.text,
    ...(sessionId ? { sessionId } : {}),
    ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    ...(m.references?.length ? { references: m.references } : {}),
    taskId: m.taskId,
    at: toMs(m.createdAt),
    // 工具调用记录随消息读回：这是「切走会话再回来还能看到跑了什么」的唯一来源。
    // 没有调用时保持 undefined，界面上不出现空列表。
    ...(m.toolCalls && m.toolCalls.length > 0 ? { executedTools: m.toolCalls } : {}),
    // 思考过程同样随消息读回：界面上它是折叠的「思考」任务，
    // 不读回来就会一切换会话就消失（此前正是如此）。
    ...(m.reasoning ? { thinking: m.reasoning } : {}),
    ...(m.reasoningSegments && m.reasoningSegments.length > 0 ? { thinkingSegments: m.reasoningSegments } : {}),
    // 任务清单同样随消息读回：不读回来，completed 之后重读历史
    // 会把刚显示的清单冲掉 —— 用户看到的就是「闪一下就没了」。
    ...(m.todos && m.todos.length > 0 ? { todos: m.todos } : {}),
    // 用量同样随消息读回：不读回来，上下文占用条只在「刚发完这一轮」可见，
    // 刷新或重开会话就没了 —— 而「现在装了几成」正是重看历史时要问的。
    ...(m.usage ? { usage: m.usage } : {}),
    // 产物同样随消息读回：不读回来，completed 之后重读历史会把卡片冲掉。
    ...(m.deliverables && m.deliverables.length > 0 ? { deliverables: m.deliverables } : {}),
  }
}

export function toSession(s: ChatSession): Session {
  return {
    id: s.id,
    title: s.title || '未命名对话',
    projectId: s.projectId,
    workdir: null,
    messages: [],
    createdAt: toMs(s.createdAt),
    updatedAt: toMs(s.updatedAt),
    origin: 'server',
    messageCount: s.messageCount,
    messagesLoaded: false,
  }
}

/** 未分组在左栏里的虚拟分组 id（不是真项目，永远存在） */
export const UNGROUPED = '__ungrouped__'

/** 首条需求 → 会话标题：取第一行、去掉只有标点/数字的情况、截断 */
export function sessionTitle(text: string): string {
  const first = text.trim().split('\n')[0] ?? ''
  const usable = first.length >= 2 && !/^[\d\s\p{P}]+$/u.test(first) ? first : ''
  return (usable || '未命名对话').slice(0, 18)
}

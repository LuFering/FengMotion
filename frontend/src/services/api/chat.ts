/**
 * 对话域（README §3.9 / agent.md）：会话、消息历史、发消息、回复事件流。
 *
 * 边界（README §3.9、02 §3.1、agent.md §1）：**对话不是任务状态源**。
 * 消息只负责文本与结构化引用，最多记一个「这条消息触发了哪个任务」的 taskId；
 * 任务是否在跑、卡在哪、成没成，一律以任务域的事件流/快照为准，不在对话流里另存一份状态。
 *
 * 另一条硬要求：附件必须是**已完成上传**的 `fileId`（02 §1 兼容表：旧后端的 `{name,type,size}`
 * 没有文件身份，服务端按 fileId 读文件）。本层不做这项校验 —— 上传域负责给 fileId，
 * 发送域只保证「拿到什么就发什么」，真发不出 fileId 时服务端拒收比前端猜一个更安全。
 */
import type {
  ChatMessage,
  ChatMessageCreateRequest,
  ChatSession,
  ChatSessionCreateRequest,
  Page,
  PageQuery,
} from '@/types/contracts'
import type { HttpClient } from './http'
import { ApiError } from './errors'
import { openChatSessionStream } from './streams'
import { asPage } from './pagination'
import type { ChatStreamHandle, ChatStreamHandlers, ChatStreamOptions } from './streams'

export interface ChatSessionCreateOptions {
  idempotencyKey?: string
  signal?: AbortSignal
}

/** 列表查询的附加选项：`signal` 只属于传输层，不混进契约的 `PageQuery`。
 *  会话列表与消息历史都用它：切项目/切会话时要能取消上一段读取。 */
export interface ChatListOptions extends PageQuery {
  signal?: AbortSignal
}

export interface SendMessageOptions {
  /** 同一次「发送」的重试必须复用同一个键，否则会写出两条一样的用户消息（README §2.7）。 */
  idempotencyKey?: string
  signal?: AbortSignal
}

export interface ChatResource {
  listSessions(projectId: string, query?: ChatListOptions): Promise<Page<ChatSession>>
  createSession(
    projectId: string,
    body: ChatSessionCreateRequest,
    options?: ChatSessionCreateOptions,
  ): Promise<ChatSession>
  getSession(sessionId: string): Promise<ChatSession>
  deleteSession(sessionId: string): Promise<void>
  listMessages(sessionId: string, query?: ChatListOptions): Promise<Page<ChatMessage>>
  sendMessage(
    sessionId: string,
    body: ChatMessageCreateRequest,
    options?: SendMessageOptions,
  ): Promise<ChatMessage>
  stream(
    sessionId: string,
    handlers?: ChatStreamHandlers,
    options?: ChatStreamOptions,
  ): ChatStreamHandle
  /**
   * 上传一个附件，拿到可用于消息的 `fileId`。
   *
   * 与 `assets.uploads.*` 的分片协议不是一回事：那是「项目素材」（有归属、可版本化），
   * 这是「为这一条消息临时带上的文件」。两者后端是不同的存储位置，不要混用。
   */
  uploadAttachment(file: File, options?: { signal?: AbortSignal }): Promise<UploadedAttachment>
}

/** 附件上传结果（对应后端 `POST /api/uploads` 的响应）。 */
export interface UploadedAttachment {
  fileId: string
  name: string
  size: number
  kind: 'image' | 'video' | 'audio' | 'file'
  mimeType: string
  sha256: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.sessionId === 'string'
    && typeof value.text === 'string'
  )
}

/**
 * 发消息的返回形状有两处口径：本次派发的签名要求 `ChatMessage`，而 agent.md §3 规定
 * 服务端返回 `202 + { message, taskId? }`（信封，意思是「消息与任务同时创建」）。
 * 两者都收：取出 `message` 本体；信封里的 `taskId` 若消息本体没带就补上 ——
 * 它表示的正是「这条消息触发了哪个任务」（ChatMessage.taskId 的契约含义），
 * 丢掉它界面就无法从这条消息跳到对应任务。两者都不是则如实报错，
 * 不把信封装成消息往下传（那会让上层读到 undefined 字段）。
 */
function unwrapSentMessage(payload: unknown): ChatMessage {
  let message: ChatMessage | null = null
  if (isChatMessage(payload)) {
    message = payload
  } else if (isRecord(payload) && isChatMessage(payload.message)) {
    message = payload.message
  }
  if (!message) {
    throw ApiError.transport('internal_error', '发送消息接口没有返回消息本体，无法确认消息是否已保存。')
  }
  if (message.taskId === undefined && isRecord(payload) && typeof payload.taskId === 'string') {
    return { ...message, taskId: payload.taskId }
  }
  return message
}

export function createChatResource(http: HttpClient): ChatResource {
  return {
    async listSessions(projectId, query) {
      // 会话不跨项目（agent.md §6），所以列表挂在项目路径下；默认最近更新倒序由服务端实现。
      // 形状走共享 pagination.asPage：裸数组包成 Page，认不出则抛错（不返回空列表）。
      const { signal, ...page } = query ?? {}
      const payload = await http.get<unknown>(`/projects/${projectId}/chat-sessions`, {
        query: Object.keys(page).length > 0 ? { ...page } : undefined,
        signal,
      })
      return asPage<ChatSession>(payload, { source: `GET /projects/${projectId}/chat-sessions` })
    },

    createSession(projectId, body, options = {}) {
      // body 按契约仍带 projectId（ChatSessionCreateRequest 的必填字段），与路径上的 projectId 必须一致；
      // 这里不擅自删字段：服务端若校验归属，缺了反而会 400。
      return http.post<ChatSession>(`/projects/${projectId}/chat-sessions`, body, {
        idempotencyKey: options.idempotencyKey,
        signal: options.signal,
      })
    },

    getSession(sessionId) {
      return http.get<ChatSession>(`/chat-sessions/${sessionId}`)
    },

    async deleteSession(sessionId) {
      // 204（README §2.3）。agent.md §5：删除会话**不取消**其任务，服务端保留审计记录，
      // 所以这里不级联做任何任务操作。
      await http.del(`/chat-sessions/${sessionId}`)
    },

    async listMessages(sessionId, query) {
      // agent.md §2：消息历史按时间正序返回；游标不透明，客户端不得解析（README §2.5）。
      // signal 只属于传输层（切会话时取消上一段历史读取），不混进契约的 PageQuery。
      const { signal, ...page } = query ?? {}
      const payload = await http.get<unknown>(`/chat-sessions/${sessionId}/messages`, {
        query: Object.keys(page).length > 0 ? { ...page } : undefined,
        signal,
      })
      return asPage<ChatMessage>(payload, { source: `GET /chat-sessions/${sessionId}/messages` })
    },

    async uploadAttachment(file, options = {}) {
      /* multipart 交给 HttpClient 判断：它对 FormData 不设 Content-Type，
         由浏览器自己带 boundary（手动设会导致 boundary 丢失、后端解析失败）。 */
      const form = new FormData()
      form.append('file', file, file.name)
      return http.post<UploadedAttachment>('/uploads', form, { signal: options.signal })
    },

    async sendMessage(sessionId, body, options = {}) {
      // 服务端「先保存真实用户消息」再谈回复（02 §3.1）；失败时消息不落库或落库标 failed，
      // 不得假装已发送 —— 所以这里不缓存、不乐观插入，拿到结果才算发出。
      // 空文本、多个 target 由服务端判 400 validation_error（agent.md §3），本层不改写错误码。
      const payload = await http.post<unknown>(`/chat-sessions/${sessionId}/messages`, body, {
        idempotencyKey: options.idempotencyKey,
        signal: options.signal,
      })
      return unwrapSentMessage(payload)
    },

    stream(sessionId, handlers, options) {
      // 转发给 streams.openChatSessionStream：delta 无 seq、重连可能重放，所以以 `completed` 的完整消息为准
      // （agent.md §4），调用方不得把拼接中的文本当成最终回答；`task` 事件只是关联句柄，不是任务终态。
      return openChatSessionStream(http, sessionId, handlers ?? {}, options ?? {})
    },
  }
}

import type { ChatMessage, ChatStreamContext, ChatStreamDeliverables, ChatStreamJob, ChatStreamMessage, ChatStreamStatus, ChatStreamRender, ChatStreamTitle, ChatStreamUsage, ContextBreakdown, StreamError } from '../contracts'
import type { ChatStreamState } from '../types'
import { ApiError, apiErrorFromDetail, toApiError } from '../errors'
import type { HttpClient } from '../http'
import { IdleTimeoutError, readSseMessages, type SseMessage } from '../sse'
import { isRecord, delay } from './streamUtils'

/* ============================ 对话回复流 ============================ */

export interface ChatStreamHandlers {
  onDelta?: (messageId: string, delta: string, replaceFrom?: number) => void
  /**
   * 推理增量。与 {@link onDelta} 分开：这里的内容进「思考过程」折叠块，
   * 不进正文。后端没开推理或模型不产出时不会调用。
   */
  onReasoning?: (messageId: string, delta: string, position?: { textOffset: number; order: number }) => void
  onCompleted?: (message: ChatMessage) => void
  /** 这一轮改动了工程，后端自动渲染的进度；源码没变时不会调用。 */
  onRender?: (render: ChatStreamRender) => void
  /**
   * 用户主动停止了一轮。
   *
   * 与 {@link onError} 分开：停止是用户自己的决定，界面应显示「已停止」
   * 并回到可输入状态，而不是弹「执行失败」让人以为要重试。
   * 停止的那一轮不会落库，所以不会再有 `completed`。
   */
  onStopped?: () => void
  /**
   * 本轮超过前台等待上限，已转后台继续执行。
   *
   * 收到它意味着：连接即将结束，但任务**没有失败也没被取消**，
   * 完成时会照常落库。界面该说的是「转后台了，完成后可查看历史」，
   * 绝不能报错 —— 报错会诱导用户重发，那才是真的重复开销。
   */
  onBackground?: (info: { message: string }) => void
  onTask?: (messageId: string, taskId: string) => void
  /**
   * 阶段进度。DSH 的 SDK 通道没有 token 级增量（见后端 `harness集成与接口清单.md` §1.1），
   * 所以「正在做什么」只能靠这个回调呈现，正文仍等 `completed`。
   */
  onStatus?: (status: ChatStreamStatus) => void
  /**
   * token 用量。可选：后端没报或旧后端不产这帧时不会调用。
   * 一轮里可能来多次（每个模型调用一次），由调用方决定累加还是只显示最后一次。
   */
  onUsage?: (usage: ChatStreamUsage) => void
  /**
   * 上下文窗口大小（占用率的分母）。可选：适配器没上报时后端不发这帧。
   * 只在模型切换时才会变，收到就存下来复用。
   */
  onContext?: (context: ChatStreamContext) => void
  /**
   * 后台任务开始 / 结束。可选：旧后端不产这帧时不会调用。
   * 同一个 jobId 会来两次（running → 终态），由调用方按 id 覆盖而不是追加。
   */
  onJob?: (job: ChatStreamJob) => void
  /**
   * 模型交付的文件。可选：旧后端不产这帧时不会调用。
   * 一条回复可能来多次，由调用方按路径去重合并。
   */
  onDeliverables?: (frame: ChatStreamDeliverables) => void
  /**
   * 引擎为这条会话起的标题。可选：旧后端不产这帧时不会调用。
   * 收到后应更新会话标题，否则左栏只能一直是「未命名对话」。
   */
  onTitle?: (title: string) => void
  /**
   * 待办清单：模型通过 todo_write 提交的整份清单（整表替换，后到的为准）。
   * 可选：旧后端不产这帧时不会调用。
   */
  onTodo?: (todos: { content: string; status: 'pending' | 'in_progress' | 'completed' }[]) => void
  /**
   * 过程诊断：上下文压缩 / token 上限 / 重试 / 中断。
   * 可选：旧后端不产这帧时不会调用。
   */
  onDiagnostic?: (
    kind: 'compaction' | 'max-tokens' | 'retry' | 'interrupted',
    detail?: string,
  ) => void
  onState?: (state: ChatStreamState) => void
  onError?: (error: ApiError) => void
}

export interface ChatStreamOptions {
  harness?: string
  /** 当前 DSH provider 的模型 ID；省略使用服务端默认模型。 */
  model?: string
  /** DSH 适配器支持的推理强度 ID；省略使用适配器默认值。 */
  reasoningEffort?: string
  /** 只接上已有的一轮（切回对话时）；这条消息没有在跑或跑过的一轮就报 `turn_not_running`，不新开。 */
  attach?: boolean
  /** 用户点了「重新执行」：上一轮跑完了也再跑一次。 */
  rerun?: boolean
  signal?: AbortSignal
  idleTimeoutMs?: number
  reconnectLimit?: number
  lastEventId?: string
}

export interface ChatStreamHandle {
  readonly sessionId: string
  readonly lastEventId: string | null
  close(): void
  readonly finished: Promise<void>
}

/**
 * 对话回复流。
 *
 * 与任务流的关键区别：`delta` 没有 seq，重连后无法去重，也可能重放。
 * 所以契约规定以 `completed` 的完整消息为准（agent.md §流式），
 * 调用方**不能**把拼接中的文本当作最终回答 —— 这里只负责忠实转发与终态判定。
 */
export function openChatSessionStream(
  http: HttpClient,
  sessionId: string,
  handlers: ChatStreamHandlers = {},
  options: ChatStreamOptions = {},
): ChatStreamHandle {
  const controller = new AbortController()
  const idleTimeoutMs = options.idleTimeoutMs ?? http.config.streamIdleTimeoutMs
  const reconnectLimit = options.reconnectLimit ?? http.config.streamReconnectLimit
  // 稳定阈值同样走配置；理由见 types.ts 的 streamStableMs（只看「收到过帧」会被抖动故障骗过）
  const stableMs = http.config.streamStableMs

  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const signal = controller.signal

  let lastEventId: string | null = options.lastEventId ?? null
  const completedMessageIds: string[] = []
  let ended = false

  const emitState = (phase: ChatStreamState['phase']) => {
    handlers.onState?.({ phase, lastEventId, completedMessageIds: [...completedMessageIds] })
  }

  const handleMessage = (message: SseMessage): 'continue' | 'end' | 'error' => {
    if (message.id) lastEventId = message.id
    if (message.data.trim() === '') return 'continue'
    let payload: ChatStreamMessage
    try {
      payload = JSON.parse(message.data) as ChatStreamMessage
    } catch {
      return 'continue'
    }
    const type = isRecord(payload) && typeof payload.type === 'string' ? payload.type : message.event
    switch (type) {
      case 'delta': {
        const delta = payload as { messageId?: unknown; delta?: unknown; replaceFrom?: unknown }
        if (typeof delta.messageId === 'string' && typeof delta.delta === 'string') {
          const offset = delta.replaceFrom
          if (offset === undefined) handlers.onDelta?.(delta.messageId, delta.delta)
          else if (typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0) handlers.onDelta?.(delta.messageId, delta.delta, offset)
        }
        return 'continue'
      }
      case 'reasoning': {
        const r = payload as { messageId?: unknown; delta?: unknown; textOffset?: unknown; order?: unknown }
        if (typeof r.messageId === 'string' && typeof r.delta === 'string') {
          const offset = r.textOffset, order = r.order
          const position = typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0
            && typeof order === 'number' && Number.isSafeInteger(order) && order >= 0
            ? { textOffset: offset, order } : undefined
          handlers.onReasoning?.(r.messageId, r.delta, position)
        }
        return 'continue'
      }
      case 'render': {
        const r = payload as { state?: unknown; version?: unknown; artifactPath?: unknown; message?: unknown }
        if (r.state === 'rendering' || r.state === 'rendered' || r.state === 'failed' || r.state === 'skipped') {
          handlers.onRender?.({
            type: 'render',
            state: r.state,
            ...(typeof r.version === 'number' && Number.isSafeInteger(r.version) ? { version: r.version } : {}),
            ...(typeof r.artifactPath === 'string' ? { artifactPath: r.artifactPath } : {}),
            ...(typeof r.message === 'string' ? { message: r.message } : {}),
          })
        }
        return 'continue'
      }
      case 'diagnostic': {
        const d = payload as { kind?: unknown; detail?: unknown }
        if (typeof d.kind === 'string') {
          handlers.onDiagnostic?.(
            d.kind as 'compaction' | 'max-tokens' | 'retry' | 'interrupted',
            typeof d.detail === 'string' ? d.detail : undefined,
          )
        }
        return 'continue'
      }
      case 'todo': {
        const t = payload as { todos?: unknown }
        if (Array.isArray(t.todos)) {
          handlers.onTodo?.(t.todos as { content: string; status: 'pending' | 'in_progress' | 'completed' }[])
        }
        return 'continue'
      }
      case 'completed': {
        const completed = payload as { message?: ChatMessage }
        if (completed.message) {
          if (!completedMessageIds.includes(completed.message.id)) completedMessageIds.push(completed.message.id)
          handlers.onCompleted?.(completed.message)
        }
        return 'continue'
      }
      case 'task': {
        const task = payload as { messageId?: unknown; taskId?: unknown }
        if (typeof task.messageId === 'string' && typeof task.taskId === 'string') {
          handlers.onTask?.(task.messageId, task.taskId)
        }
        return 'continue'
      }
      case 'status': {
        // 只认契约里的三个 phase；未知值静默跳过，避免后端加新值时前端崩。
        const status = payload as {
          phase?: unknown
          name?: unknown
          label?: unknown
          callId?: unknown
          arguments?: unknown
          isError?: unknown
          textOffset?: unknown
          order?: unknown
        }
        const phase = status.phase
        if (phase === 'thinking' || phase === 'tool' || phase === 'done') {
          handlers.onStatus?.({
            type: 'status',
            phase,
            ...(typeof status.name === 'string' ? { name: status.name } : {}),
            ...(typeof status.label === 'string' ? { label: status.label } : {}),
            /* 工具结构化字段：后端 DSH 的 tool/call 事件本来就带这些，
               之前后端在映射成 status 帧时丢掉了，导致界面只能显示工具名。
               全部逐个校验类型，缺字段就是缺字段，不补默认值 —— 「不知道参数」
               和「参数是空字符串」是两件事。 */
            ...(typeof status.callId === 'string' && status.callId !== ''
              ? { callId: status.callId }
              : {}),
            ...(typeof status.arguments === 'string' ? { arguments: status.arguments } : {}),
            ...(typeof status.textOffset === 'number' && Number.isSafeInteger(status.textOffset) && status.textOffset >= 0 ? { textOffset: status.textOffset } : {}),
            ...(typeof status.order === 'number' && Number.isSafeInteger(status.order) && status.order >= 0 ? { order: status.order } : {}),
            ...(status.isError === true ? { isError: true } : {}),
          })
        }
        return 'continue'
      }
      case 'usage': {
        /* 用量帧。逐个字段校验：上游没报的桶就不带进结果，不补 0 ——
           「用了 0 个 token」与「不知道用了多少」不能混为一谈。 */
        const u = payload as unknown as Record<string, unknown>
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
        const usage: ChatStreamUsage = {
          type: 'usage',
          ...(num(u.inputTokens) !== undefined ? { inputTokens: num(u.inputTokens) } : {}),
          ...(num(u.outputTokens) !== undefined ? { outputTokens: num(u.outputTokens) } : {}),
          ...(num(u.cacheReadTokens) !== undefined ? { cacheReadTokens: num(u.cacheReadTokens) } : {}),
          ...(num(u.cacheWriteTokens) !== undefined ? { cacheWriteTokens: num(u.cacheWriteTokens) } : {}),
          ...(num(u.totalTokens) !== undefined ? { totalTokens: num(u.totalTokens) } : {}),
        }
        handlers.onUsage?.(usage)
        return 'continue'
      }
      case 'context': {
        /* 上下文帧，携带两类独立信息：
           contextWindow=分母（适配器上报才有），toolsTokens=工具 schema 估算。
           两者可能分两帧到，所以逐字段放行，不要求同时存在。
           非正数一律当没有 —— 0 当分母会除零，0 当占用会污染分档。 */
        const c = payload as unknown as Record<string, unknown>
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)
        const w = num(c.contextWindow)
        const t = num(c.toolsTokens)
        /* 分档是整块快照（不是增量）：五类一起到，某类为 0 是「确实是空的」，
           所以这里不能用上面的 num() —— 它把 0 当成「没有」。 */
        const bd = c.breakdown
        const bdNum = (v: unknown) =>
          typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
        let breakdown: ContextBreakdown | undefined
        if (bd && typeof bd === 'object') {
          const b = bd as Record<string, unknown>
          const s = bdNum(b.systemTokens)
          const m = bdNum(b.memoryTokens)
          const f = bdNum(b.filesTokens)
          const r = bdNum(b.resultsTokens)
          const ch = bdNum(b.chatTokens)
          if (s !== undefined && m !== undefined && f !== undefined
              && r !== undefined && ch !== undefined) {
            breakdown = {
              systemTokens: s,
              memoryTokens: m,
              filesTokens: f,
              resultsTokens: r,
              chatTokens: ch,
            }
          }
        }
        if (w !== undefined || t !== undefined || breakdown !== undefined) {
          handlers.onContext?.({
            type: 'context',
            ...(w !== undefined ? { contextWindow: w } : {}),
            ...(t !== undefined ? { toolsTokens: t } : {}),
            ...(breakdown !== undefined ? { breakdown } : {}),
          })
        }
        return 'continue'
      }
      case 'job': {
        /* 任务帧。status 只认四个值 —— 上游给别的就当没有这帧，
           不猜一个「可能完成」糊弄过去。 */
        const j = payload as unknown as Record<string, unknown>
        const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
        const jobId = str(j.jobId)
        const status = str(j.status)
        const allowed = ['running', 'completed', 'killed', 'failed'] as const
        const ok = allowed.find((x) => x === status)
        if (jobId && ok) {
          const dur = typeof j.durationMs === 'number' && Number.isFinite(j.durationMs) && j.durationMs >= 0
            ? j.durationMs : undefined
          handlers.onJob?.({
            type: 'job',
            jobId,
            kind: str(j.kind) ?? '',
            label: str(j.label) ?? '',
            status: ok,
            ...(dur !== undefined ? { durationMs: dur } : {}),
            ...(str(j.detail) ? { detail: str(j.detail) } : {}),
          })
        }
        return 'continue'
      }
      case 'deliverables': {
        /* 产物帧。没有 path 的条目直接丢弃 —— 卡片点了也打不开，
           留着只会是个死项。 */
        const d = payload as unknown as Record<string, unknown>
        const raw = Array.isArray(d.files) ? d.files : []
        const files = raw
          .map((f) => f as Record<string, unknown>)
          .filter((f) => typeof f.path === 'string' && f.path.trim().length > 0)
          .map((f) => ({
            path: String(f.path),
            ...(typeof f.description === 'string' && f.description.trim()
              ? { description: f.description } : {}),
          }))
        if (files.length > 0) {
          handlers.onDeliverables?.({ type: 'deliverables', files })
        }
        return 'continue'
      }
      case 'title': {
        // 空标题不覆盖：用空串盖掉会让本来有名字的会话变成无名
        const t = (payload as unknown as Partial<ChatStreamTitle>).title
        if (typeof t === 'string' && t.trim() !== '') handlers.onTitle?.(t)
        return 'continue'
      }
      case 'stopped': {
        handlers.onStopped?.()
        return 'continue'
      }
      case 'background': {
        const bg = payload as unknown as { message?: string }
        handlers.onBackground?.({ message: typeof bg.message === 'string' && bg.message ? bg.message : '任务已转后台继续执行' })
        return 'continue'
      }
      case 'heartbeat':
        // 心跳不改变任何状态：它的唯一作用是让上层知道连接还活着。
        // 空闲计时由 sse 读取层负责重置，这里无需额外动作。
        return 'continue'
      case 'end':
        ended = true
        return 'end'
      case 'error': {
        const streamError = payload as StreamError
        handlers.onError?.(apiErrorFromDetail(streamError.error))
        return 'error'
      }
      default:
        return 'continue'
    }
  }

  const run = async (): Promise<void> => {
    emitState('connecting')
    let attempt = 0

    for (;;) {
      /** 与任务流同理：连上、甚至收到一帧都不等于恢复，还要看这轮连接稳不稳定。 */
      let progressed = false
      let cycleStartedAt = 0
      if (signal.aborted) {
        emitState('aborted')
        return
      }
      try {
        cycleStartedAt = Date.now()
        const response = await http.openEventStream(`/chat-sessions/${sessionId}/stream`, {
          query: { harness: options.harness, model: options.model, reasoningEffort: options.reasoningEffort,
            attach: options.attach ? true : undefined, rerun: options.rerun ? true : undefined },
          lastEventId: lastEventId ?? undefined,
          signal,
        })
        emitState('streaming')

        for await (const message of readSseMessages(response, { signal, idleTimeoutMs })) {
          progressed = true
          const outcome = handleMessage(message)
          if (outcome === 'end') {
            emitState('ended')
            return
          }
          if (outcome === 'error') {
            emitState('failed')
            return
          }
        }

        if (signal.aborted) {
          emitState('aborted')
          return
        }
        if (ended) {
          emitState('ended')
          return
        }
        // 连接断开但没有 `end`：契约要求不得当作回答结束，重连续读
        emitState('streaming')
      } catch (error) {
        // 空闲超时先于 toApiError 判定，理由同任务流：否则「流没数据」会被报成服务端内部错误。
        const idle = error instanceof IdleTimeoutError
        const apiError = idle
          ? ApiError.transport(
              'stream_disconnected',
              `${Math.round(idleTimeoutMs / 1000)} 秒没有收到任何回复，按断线处理。`,
              error,
            )
          : toApiError(error)
        if (apiError.isAborted) {
          emitState('aborted')
          return
        }
        handlers.onError?.(apiError)
        // session_busy：上一轮还在跑，重连只会一次次被拒，提示一次就停
        // turn_not_running：这一轮已经不在了（后端重启过），重连只会一次次被拒
        if (apiError.isNotFound || apiError.isCapabilityGap || apiError.details?.rawCode === 'session_busy'
          || apiError.details?.rawCode === 'turn_not_running') {
          emitState('failed')
          return
        }
      }

      if (progressed && Date.now() - cycleStartedAt >= stableMs) attempt = 0
      attempt += 1
      if (attempt > reconnectLimit) {
        // 用户已经关掉这条流时，结果是「已取消」而不是「重连失败」：abort 优先
        if (signal.aborted) {
          emitState('aborted')
          return
        }
        handlers.onError?.(
          ApiError.transport('network_error', `回复流重连 ${reconnectLimit} 次仍未恢复，已停止等待。`),
        )
        emitState('failed')
        return
      }
      await delay(Math.min(1000 * attempt, 5000), signal)
    }
  }

  const finished = run()

  return {
    sessionId,
    get lastEventId() {
      return lastEventId
    },
    close() {
      controller.abort()
    },
    finished,
  }
}

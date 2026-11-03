/**
 * 任务事件流与对话回复流的状态机。
 *
 * 这两条流的难点不在「连上」，而在断开之后：
 * - 契约（README §2.9、task.md §7、02 §5）要求断线**不得**被当成完成，
 *   重连要带 `Last-Event-ID`，按 `(taskId, seq)` 去重，缺口补齐前显示「正在恢复」；
 * - 服务端只保证「同一任务事件 seq 严格递增」，所以客户端要能容忍乱序到达并按 seq 排水；
 * - 终态只认 `end` 帧或终态事件（complete/error/cancelled），一个任务最多一个终态。
 *
 * 这里不做乐观成功：任何「连接断了但没收到终态」的情形都如实停在 resyncing/failed，
 * 由界面说明「未完成」，而不是悄悄报成功。
 */
import type {
  AgentTask,
  ChatMessage,
  ChatStreamMessage,
  ChatStreamStatus,
  ChatStreamTitle,
  ChatStreamUsage,
  StreamError,
  TaskEvent,
  TaskStatus,
  TaskStreamEnd,
  TaskStreamEvent,
  TaskStreamMessage,
  TaskStreamSnapshot,
} from '@/types/contracts'
import type { ChatStreamState, TaskStreamPhase, TaskStreamState } from './types'
import { ApiError, apiErrorFromDetail, toApiError } from './errors'
import type { HttpClient } from './http'
import { IdleTimeoutError, readSseMessages, type SseMessage } from './sse'

/** 终态集合。终态不可回退，事件出现后再无事件（心跳除外）。 */
export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'completed',
  'failed',
  'cancelled',
])

const TERMINAL_EVENT_KINDS: ReadonlySet<TaskEvent['kind']> = new Set<TaskEvent['kind']>([
  'complete',
  'error',
  'cancelled',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTaskEvent(value: unknown): value is TaskEvent {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string'
    && typeof value.seq === 'number'
    && Number.isFinite(value.seq)
    && typeof value.taskId === 'string'
    && typeof value.kind === 'string'
    && typeof value.status === 'string'
    && typeof value.message === 'string'
  )
}

/**
 * 事件历史接口的返回形状在 02 里没有冻结（只说明用 `afterSeq` 补齐），
 * 所以两种常见形状都接受：`Page<TaskEvent>` 或裸数组。都不是就如实报错，不当成空。
 */
export function normalizeEventList(payload: unknown): TaskEvent[] {
  const raw = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.items)
      ? payload.items
      : null
  if (!raw) throw ApiError.transport('internal_error', '事件历史接口返回的内容无法识别，无法补齐事件缺口。')
  for (const item of raw) {
    if (!isTaskEvent(item)) {
      throw ApiError.transport('internal_error', '事件历史里存在缺少 seq/taskId 的事件，无法按序补齐。')
    }
  }
  return raw
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/* ============================ 任务事件流 ============================ */

export interface TaskEventStreamHandlers {
  onSnapshot?: (task: AgentTask, events: TaskEvent[]) => void
  onEvent?: (event: TaskEvent) => void
  onState?: (state: TaskStreamState) => void
  onError?: (error: ApiError) => void
}

export interface TaskEventStreamOptions {
  /** 已知水位（如上一次订阅收到的 seq），重连时从这里续。 */
  sinceSeq?: number
  signal?: AbortSignal
  idleTimeoutMs?: number
  reconnectLimit?: number
}

export interface TaskEventStreamHandle {
  readonly taskId: string
  /** 已连续交付的水位；关闭后可把它传给下一次订阅的 `sinceSeq`。 */
  readonly lastSeq: number
  close(): void
  /** 终态状态；失败/取消时是 null（**不是** completed）。 */
  readonly finished: Promise<TaskStatus | null>
}

type FrameOutcome = 'continue' | 'end' | 'error' | 'resync'

export function openTaskEventStream(
  http: HttpClient,
  taskId: string,
  handlers: TaskEventStreamHandlers = {},
  options: TaskEventStreamOptions = {},
): TaskEventStreamHandle {
  const controller = new AbortController()
  const idleTimeoutMs = options.idleTimeoutMs ?? http.config.streamIdleTimeoutMs
  const reconnectLimit = options.reconnectLimit ?? http.config.streamReconnectLimit
  // 稳定阈值走配置（types.ts 的 streamStableMs）：为什么不能只看「有没有收到数据」，见该字段注释
  const stableMs = http.config.streamStableMs
  const historyLimit = http.config.resyncLimit

  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const signal = controller.signal

  let lastSeq = options.sinceSeq ?? 0
  let taskStatus: TaskStatus | null = null
  let resyncAttempts = 0
  /** 已收到终态（事件或 `end` 帧），此后不再接受任何状态变化。 */
  let terminalReached = false
  /** 乱序到达的事件，等 seq 连续时再排水交付。 */
  const pending = new Map<number, TaskEvent>()

  const emitState = (phase: TaskStreamPhase) => {
    handlers.onState?.({ phase, lastSeq, taskStatus, resyncAttempts })
  }

  const drain = () => {
    for (;;) {
      const next = pending.get(lastSeq + 1)
      if (!next) break
      pending.delete(lastSeq + 1)
      lastSeq = next.seq
      handlers.onEvent?.(next)
      if (TERMINAL_EVENT_KINDS.has(next.kind)) {
        // 终态唯一：第一个终态事件之后不再接受其它状态
        terminalReached = true
        taskStatus = next.status
      }
    }
  }

  /** 按 seq 去重后交付；留下缺口时返回 false，由调用方补齐。 */
  const ingest = (event: TaskEvent): boolean => {
    if (terminalReached) return pending.size === 0
    if (event.seq <= lastSeq) return true
    pending.set(event.seq, event)
    drain()
    return pending.size === 0
  }

  const fetchHistory = async (afterSeq: number): Promise<TaskEvent[]> => {
    const payload = await http.get<unknown>(`/tasks/${taskId}/events/history`, {
      query: { afterSeq: afterSeq > 0 ? afterSeq : undefined, limit: historyLimit },
      signal,
    })
    return normalizeEventList(payload)
  }

  const handleMessage = (message: SseMessage): FrameOutcome => {
    if (message.data.trim() === '') return 'continue'
    let payload: TaskStreamMessage
    try {
      payload = JSON.parse(message.data) as TaskStreamMessage
    } catch {
      // 帧不可解析意味着可能漏了事件 —— 不能当无事发生，走补齐
      return 'resync'
    }
    const type = isRecord(payload) && typeof payload.type === 'string' ? payload.type : message.event
    switch (type) {
      case 'snapshot': {
        const snapshot = payload as TaskStreamSnapshot
        if (isRecord(snapshot.task) && typeof snapshot.task.status === 'string') {
          taskStatus = snapshot.task.status
          handlers.onSnapshot?.(snapshot.task, snapshot.events ?? [])
        }
        for (const event of snapshot.events ?? []) ingest(event)
        if (terminalReached) return 'end'
        return pending.size === 0 ? 'continue' : 'resync'
      }
      case 'event': {
        const event = (payload as TaskStreamEvent).event
        if (!isTaskEvent(event)) return 'resync'
        ingest(event)
        if (terminalReached) return 'end'
        return pending.size === 0 ? 'continue' : 'resync'
      }
      case 'end': {
        const end = payload as TaskStreamEnd
        if (typeof end.status === 'string') taskStatus = end.status
        return 'end'
      }
      case 'error': {
        const streamError = payload as StreamError
        handlers.onError?.(apiErrorFromDetail(streamError.error))
        return 'error'
      }
      default:
        // 未知事件类型按 SSE 规范忽略；它不影响已交付事件的水位
        return 'continue'
    }
  }

  const run = async (): Promise<TaskStatus | null> => {
    emitState('connecting')
    let attempt = 0

    for (;;) {
      /**
       * 这一轮连接的水位基线：只有**订阅之后真的收到过新事件**才算有进展。
       *
       * 不能在 `openEventStream` 成功后直接清零重连计数 —— 半开连接/连上就被断开的场景下，
       * 每次 TCP 握手成功都会把计数清零，`attempt > reconnectLimit` 永远不成立，
       * 界面会无声地永远停在「正在恢复」，与 `streamReconnectLimit`
       * 「超过后如实报失败，不假装仍在恢复」直接矛盾。
       */
      let progressBaseline = lastSeq
      /** 本轮连接建立时刻，用于判断它是否稳定存活过（见 STREAM_STABLE_MS）。 */
      let cycleStartedAt = 0
      if (signal.aborted) {
        emitState('aborted')
        return null
      }
      try {
        // 1) 先取快照对齐「任务此刻到底是什么状态」；订阅事件不负责裁决状态
        const task = await http.get<AgentTask>(`/tasks/${taskId}`, { signal })
        if (isRecord(task) && typeof task.status === 'string') taskStatus = task.status

        // 2) 有水位（或快照已终态）时先补历史，避免订阅/回放之间的竞态丢事件
        if (lastSeq > 0 || (taskStatus !== null && TERMINAL_TASK_STATUSES.has(taskStatus))) {
          const history = await fetchHistory(lastSeq)
          for (const event of history) ingest(event)
          if (terminalReached) {
            resyncAttempts = 0
            emitState('ended')
            return taskStatus
          }
          // 快照说终态、历史里却没有终态事件：以快照状态收束，但**不伪造**终态事件。
          // 这种只可能出现在事件已被保留期清掉的情况，故如实返回状态并标记结束。
          if (pending.size === 0 && taskStatus !== null && TERMINAL_TASK_STATUSES.has(taskStatus)) {
            emitState('ended')
            return taskStatus
          }
        }

        if (signal.aborted) {
          emitState('aborted')
          return null
        }

        // 3) 订阅事件流
        progressBaseline = lastSeq
        cycleStartedAt = Date.now()
        const response = await http.openEventStream(`/tasks/${taskId}/events`, {
          lastEventId: lastSeq > 0 ? String(lastSeq) : undefined,
          signal,
        })
        resyncAttempts = 0
        emitState('live')

        for await (const message of readSseMessages(response, { signal, idleTimeoutMs })) {
          const outcome = handleMessage(message)
          if (outcome === 'end') {
            emitState('ended')
            return taskStatus
          }
          if (outcome === 'error') {
            emitState('failed')
            return null
          }
          if (outcome === 'resync') {
            // 缺口出现：先就地补历史，尽量不打断这条连接
            emitState('resyncing')
            resyncAttempts += 1
            try {
              const history = await fetchHistory(lastSeq)
              for (const event of history) ingest(event)
            } catch (error) {
              const apiError = toApiError(error)
              if (apiError.isAborted) {
                emitState('aborted')
                return null
              }
              pending.clear()
              throw apiError
            }
            if (terminalReached) {
              emitState('ended')
              return taskStatus
            }
            if (pending.size === 0) {
              emitState('live')
              continue
            }
            if (pending.size > historyLimit * 2) {
              // 缺口大到补不上：如实失败，不再假装正在恢复
              handlers.onError?.(
                ApiError.transport(
                  'internal_error',
                  `事件缺口无法补齐（已有 ${pending.size} 条等待接续），已收到 ${lastSeq} 条事件。`,
                ),
              )
              emitState('failed')
              return null
            }
            // 补不齐就断开重连：契约规定服务端在缺口超过 200 条时会先发 snapshot
            break
          }
        }

        if (signal.aborted) {
          emitState('aborted')
          return null
        }
        // 4) 连接结束但没有 `end` —— 断线，不是完成
        if (terminalReached) {
          emitState('ended')
          return taskStatus
        }
        resyncAttempts += 1
        emitState('resyncing')
      } catch (error) {
        // 空闲超时要在包成 ApiError **之前**判断：`toApiError` 会把非 ApiError 归成
        // `internal_error`，那样「流没数据了」会被界面说成「服务端出错」，误判故障来源。
        const idle = error instanceof IdleTimeoutError
        const apiError = idle
          ? ApiError.transport(
              'stream_disconnected',
              `${Math.round(idleTimeoutMs / 1000)} 秒没有收到任何事件，按断线处理。`,
              error,
            )
          : toApiError(error)
        if (apiError.isAborted) {
          emitState('aborted')
          return null
        }
        if (idle) {
          // 空闲超时按断线处理，照常重连；不改变已交付水位
          resyncAttempts += 1
          emitState('resyncing')
        } else if (apiError.isNotFound || apiError.code === 'capability_unavailable' || apiError.code === 'agent_unavailable') {
          // 任务不存在或 Agent 没接：如实失败，不重试掩盖
          handlers.onError?.(apiError)
          emitState('failed')
          return null
        } else {
          handlers.onError?.(apiError)
          resyncAttempts += 1
          emitState('resyncing')
        }
      }

      // 只有「水位真的前进」且「这轮连接稳定存活过」才算恢复，否则连上就断的循环会无限重连
      if (lastSeq > progressBaseline && Date.now() - cycleStartedAt >= stableMs) attempt = 0
      attempt += 1
      if (attempt > reconnectLimit) {
        // 用户已经关掉这条流时，结果是「已取消」而不是「重连失败」：abort 优先
        if (signal.aborted) {
          emitState('aborted')
          return null
        }
        handlers.onError?.(
          ApiError.transport(
            'network_error',
            `事件流重连 ${reconnectLimit} 次仍未恢复，已停止；已收到 ${lastSeq} 条事件，未把断线当作完成。`,
          ),
        )
        emitState('failed')
        return null
      }
      await delay(Math.min(1000 * attempt, 5000), signal)
    }
  }

  const finished = run()

  return {
    taskId,
    get lastSeq() {
      return lastSeq
    },
    close() {
      controller.abort()
    },
    finished,
  }
}

/* ============================ 对话回复流 ============================ */

export interface ChatStreamHandlers {
  onDelta?: (messageId: string, delta: string) => void
  onCompleted?: (message: ChatMessage) => void
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
   * 引擎为这条会话起的标题。可选：旧后端不产这帧时不会调用。
   * 收到后应更新会话标题，否则左栏只能一直是「未命名对话」。
   */
  onTitle?: (title: string) => void
  onState?: (state: ChatStreamState) => void
  onError?: (error: ApiError) => void
}

export interface ChatStreamOptions {
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
        const delta = payload as { messageId?: unknown; delta?: unknown }
        if (typeof delta.messageId === 'string' && typeof delta.delta === 'string') {
          handlers.onDelta?.(delta.messageId, delta.delta)
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
      case 'title': {
        // 空标题不覆盖：用空串盖掉会让本来有名字的会话变成无名
        const t = (payload as unknown as Partial<ChatStreamTitle>).title
        if (typeof t === 'string' && t.trim() !== '') handlers.onTitle?.(t)
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
        if (apiError.isNotFound || apiError.isCapabilityGap) {
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

/**
 * SSE 帧解析与读取。
 *
 * 为什么自己解析：契约要求 `id: <seq>` + `event:` + `data:`，且服务端每 15 秒发 `: ping`
 * 注释心跳、45 秒无消息即视为断线（README §2.9）。`EventSource` 既不能带 `Last-Event-ID`
 * 自定义头（token 也不能放 URL），也不暴露「多久没收到任何字节」，所以走 fetch 流自己读。
 *
 * 心跳（注释行）不产生消息，但**算活着** —— 空闲计时必须在收到任何字节时重置，
 * 否则正常心跳会被误判成断线。
 */
import { ApiError } from './errors'

export interface SseMessage {
  /** SSE `id:` 字段（任务流里是该任务内的 seq）。 */
  id: string | null
  /** SSE `event:` 字段；缺省为 `message`。 */
  event: string
  data: string
  retryMs: number | null
}

/** 空闲超时：不是「请求超时」，而是流一段时间内一个字节都没来。 */
export class IdleTimeoutError extends Error {
  readonly idleMs: number

  constructor(idleMs: number) {
    super(`事件流 ${Math.round(idleMs / 1000)} 秒没有收到任何数据。`)
    this.name = 'IdleTimeoutError'
    this.idleMs = idleMs
  }
}

export interface SseParser {
  push(chunk: string): SseMessage[]
  /** 连接结束时把缓冲区里未以空行收尾的帧交出来（避免丢掉最后一帧）。 */
  flush(): SseMessage[]
}

/** 按 SSE 规范分帧：字段累积、空行派发、`:` 开头是注释。 */
export function createSseParser(): SseParser {
  let buffer = ''
  let eventType = ''
  let dataLines: string[] = []
  let lastId: string | null = null
  let retryMs: number | null = null

  const reset = () => {
    eventType = ''
    dataLines = []
    retryMs = null
  }

  const dispatch = (): SseMessage | null => {
    if (dataLines.length === 0) {
      // 规范：没有 data 的帧不派发（心跳注释、只有 id 的帧都属于此类）
      reset()
      return null
    }
    const message: SseMessage = {
      id: lastId,
      event: eventType === '' ? 'message' : eventType,
      data: dataLines.join('\n'),
      retryMs,
    }
    reset()
    return message
  }

  const handleLine = (line: string): SseMessage | null => {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return null
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    switch (field) {
      case 'event':
        eventType = value
        return null
      case 'data':
        dataLines.push(value)
        return null
      case 'id':
        // 规范：含 NUL 的 id 忽略
        if (!value.includes('\u0000')) lastId = value
        return null
      case 'retry': {
        const parsed = Number(value)
        if (Number.isFinite(parsed) && parsed >= 0) retryMs = parsed
        return null
      }
      default:
        // 未知字段按规范忽略，不影响已有的数据行
        return null
    }
  }

  return {
    push(chunk: string): SseMessage[] {
      buffer += chunk
      const messages: SseMessage[] = []
      for (;;) {
        const lf = buffer.indexOf('\n')
        const cr = buffer.indexOf('\r')
        let index = -1
        if (lf !== -1 && cr !== -1) index = Math.min(lf, cr)
        else if (lf !== -1) index = lf
        else if (cr !== -1) index = cr
        if (index === -1) break
        const line = buffer.slice(0, index)
        // CRLF / CR 都算一个换行
        const skip = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1
        buffer = buffer.slice(index + skip)
        const message = handleLine(line)
        if (message) messages.push(message)
      }
      return messages
    },
    flush(): SseMessage[] {
      const messages: SseMessage[] = []
      if (buffer !== '') {
        const message = handleLine(buffer)
        buffer = ''
        if (message) messages.push(message)
      }
      const tail = dispatch()
      if (tail) messages.push(tail)
      return messages
    },
  }
}

export interface ReadSseOptions {
  signal?: AbortSignal
  /** 超过这么久没有任何字节（含心跳注释）就抛 IdleTimeoutError，由调用方决定重连。 */
  idleTimeoutMs?: number
}

export async function* readSseMessages(
  response: Response,
  options: ReadSseOptions = {},
): AsyncGenerator<SseMessage> {
  const { signal, idleTimeoutMs } = options
  const body = response.body
  if (!body) throw ApiError.transport('network_error', '服务端没有返回事件流内容。')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()

  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let rejectOnIdle: ((error: unknown) => void) | null = null

  const armIdle = () => {
    if (!idleTimeoutMs || idleTimeoutMs <= 0) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      rejectOnIdle?.(new IdleTimeoutError(idleTimeoutMs))
    }, idleTimeoutMs)
  }
  const disarmIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  const onAbort = () => {
    // 取消时主动断开底层连接，read() 会以 done 结束，由调用方按「已取消」收尾
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    if (signal?.aborted) return
    armIdle()
    for (;;) {
      const idleSignal = new Promise<never>((_, reject) => {
        rejectOnIdle = reject
      })
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await Promise.race([reader.read(), idleSignal])
      } catch (error) {
        rejectOnIdle = null
        // 空闲超时原样抛给调用方（它知道怎么重连）；其它读失败是**连接被中断**，
        // 必须归成 network_error —— 否则底层运行时抛的 `TypeError: terminated` 这类原文
        // 会被上层包成 internal_error 直接展示，把「网线被掐断」说成「服务端出错」。
        if (error instanceof IdleTimeoutError) throw error
        if (signal?.aborted) return
        throw ApiError.transport('stream_disconnected', '事件流已断开（连接被中断），按断线处理。', error)
      }
      rejectOnIdle = null
      if (result.done) break
      // 任何字节都算活着（包括 `: ping`），心跳不会被误判成断线
      armIdle()
      const text = decoder.decode(result.value, { stream: true })
      for (const message of parser.push(text)) yield message
      if (signal?.aborted) return
    }
    for (const message of parser.flush()) yield message
  } finally {
    disarmIdle()
    rejectOnIdle = null
    signal?.removeEventListener('abort', onAbort)
    try {
      await reader.cancel()
    } catch {
      // 流已经断开时取消会失败，无影响
    }
  }
}

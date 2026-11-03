/**
 * API 失败对象与错误信封解析。
 *
 * 契约 v0.3 的错误形状是嵌套的 `{ error: { code, message, details, requestId } }`（README §2.4），
 * 但现运行骨架返回的是扁平的 `{ code, message }`（02 §1 兼容表）。迁移期前端必须**两种都认**，
 * 且要能区分出自己收到的是旧形状 —— 因为旧接口的语义缺口（比如 `GET /changes/{id}` 无变更也 404）
 * 不能当成新契约的语义来解读。
 *
 * 另外这里负责「用户看到什么」：契约要求服务端 message 面向用户、不含堆栈与内部路径；
 * 但对 `internal_error`/握手失败这类**服务端说不清**的情况，用本地文案，避免把技术错误直接抛给用户。
 */
import type { ApiErrorCode, ApiErrorDetail, RequestId } from '@/types/contracts'
import type { FailureCode } from './types'

/** HTTP 状态码兜底映射：服务端没给可识别 code 时按状态归类，好过当成成功。 */
const HTTP_STATUS_FALLBACK: Record<number, FailureCode> = {
  400: 'validation_error',
  401: 'unauthorized',
  403: 'validation_error',
  404: 'not_found',
  405: 'internal_error',
  406: 'internal_error',
  409: 'conflict',
  412: 'precondition_failed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'capability_unavailable',
  429: 'rate_limited',
  500: 'internal_error',
  502: 'agent_unavailable',
  503: 'agent_unavailable',
  504: 'timeout',
}

/** 允许自动重试的失败：只含「重发一次可能就好了」的类型，别的重试只是刷屏。 */
const RETRYABLE: ReadonlySet<FailureCode> = new Set<FailureCode>([
  'network_error',
  'stream_disconnected',
  'timeout',
  'rate_limited',
  'agent_unavailable',
])

export interface ParsedErrorPayload {
  code: FailureCode
  message: string
  details: Record<string, unknown> | null
  requestId: RequestId | null
  /** true = 收到的是旧骨架的扁平 `{code,message}`，不是 v0.3 信封。 */
  legacyShape: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isKnownApiCode(value: unknown): value is ApiErrorCode {
  switch (value) {
    case 'validation_error':
    case 'not_found':
    case 'conflict':
    case 'precondition_failed':
    case 'unsupported_media_type':
    case 'payload_too_large':
    case 'idempotency_conflict':
    case 'capability_unavailable':
    case 'agent_unavailable':
    case 'rate_limited':
    case 'cancelled':
    case 'internal_error':
      return true
    default:
      return false
  }
}

/**
 * 解析错误响应体。三种形状依次尝试：
 * 1. v0.3 嵌套信封；
 * 2. 旧骨架扁平 `{code,message}`（标记 `legacyShape`）；
 * 3. 都不是 → 按 HTTP 状态兜底（`internal_error`）。
 */
export function parseErrorPayload(status: number, payload: unknown): ParsedErrorPayload {
  const fallback = HTTP_STATUS_FALLBACK[status] ?? (status >= 500 ? 'internal_error' : 'internal_error')

  if (isRecord(payload)) {
    const nested = payload.error
    if (isRecord(nested)) {
      const code = isKnownApiCode(nested.code) ? nested.code : fallback
      const message = typeof nested.message === 'string' ? nested.message : ''
      const details: Record<string, unknown> = isRecord(nested.details) ? { ...nested.details } : {}
      // 契约只增码，前端可能落后于服务端。留着原始码才能排查，
      // 否则「服务端到底报了什么」只剩一个兜底值，用户报障时无从下手。
      if (typeof nested.code === 'string' && nested.code !== '' && !isKnownApiCode(nested.code)) {
        details.rawCode = nested.code
      }
      return {
        code,
        message,
        details: Object.keys(details).length > 0 ? details : null,
        requestId: typeof nested.requestId === 'string' ? nested.requestId : null,
        legacyShape: false,
      }
    }
    if (isKnownApiCode(payload.code) || typeof payload.code === 'string') {
      const code = isKnownApiCode(payload.code) ? payload.code : fallback
      const details: Record<string, unknown> = {}
      // 旧骨架的错误码（如 task_not_found）不在契约码表里，原样保留便于迁移期排查
      if (typeof payload.code === 'string' && payload.code !== '' && !isKnownApiCode(payload.code)) {
        details.rawCode = payload.code
      }
      return {
        code,
        message: typeof payload.message === 'string' ? payload.message : '',
        details: Object.keys(details).length > 0 ? details : null,
        requestId: typeof payload.requestId === 'string' ? payload.requestId : null,
        legacyShape: true,
      }
    }
  }

  return { code: fallback, message: '', details: null, requestId: null, legacyShape: false }
}

/** `Retry-After` 支持秒数与 HTTP 日期两种写法；解析不出就返回 null，不做假设。 */
export function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null
  const raw = headerValue.trim()
  if (raw === '') return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(raw)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - Date.now())
}

export interface ApiErrorInit {
  code: FailureCode
  message: string
  httpStatus?: number | null
  details?: Record<string, unknown> | null
  requestId?: RequestId | null
  retryAfterMs?: number | null
  legacyShape?: boolean
  cause?: unknown
}

export class ApiError extends Error {
  readonly code: FailureCode
  readonly httpStatus: number | null
  readonly details: Record<string, unknown> | null
  readonly requestId: RequestId | null
  readonly retryAfterMs: number | null
  /** 服务端用的是旧扁平错误形状；调用方可据此决定是否走旧语义（如 404 的歧义）。 */
  readonly legacyShape: boolean

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.code = init.code
    this.httpStatus = init.httpStatus ?? null
    this.details = init.details ?? null
    this.requestId = init.requestId ?? null
    this.retryAfterMs = init.retryAfterMs ?? null
    this.legacyShape = init.legacyShape ?? false
    if (init.cause !== undefined) this.cause = init.cause
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code)
  }

  /** 能力缺口：不是「用户做错了」，而是服务端没接这块，UI 应置灰并说明。 */
  get isCapabilityGap(): boolean {
    return this.code === 'capability_unavailable' || this.code === 'agent_unavailable'
  }

  get isNotFound(): boolean {
    return this.code === 'not_found'
  }

  /** 条件更新冲突：界面提示「已被其他窗口修改」并刷新，不要静默覆盖。 */
  get isPreconditionFailed(): boolean {
    return this.code === 'precondition_failed'
  }

  get isAborted(): boolean {
    return this.code === 'aborted'
  }

  static fromResponse(
    status: number,
    payload: unknown,
    headerRequestId: string | null,
    retryAfterHeader: string | null = null,
  ): ApiError {
    const parsed = parseErrorPayload(status, payload)
    return new ApiError({
      code: parsed.code,
      message: parsed.message,
      httpStatus: status,
      details: parsed.details,
      requestId: parsed.requestId ?? headerRequestId,
      retryAfterMs: parseRetryAfterMs(retryAfterHeader),
      legacyShape: parsed.legacyShape,
    })
  }

  /**
   * 传输层/本地失败。`code` 允许用契约错误码（如 `internal_error`）表达
   * 「本地就发现的问题」，因为它同样要进统一错误处理，不另开一套类型。
   */
  static transport(code: FailureCode, message: string, cause?: unknown): ApiError {
    return new ApiError({ code, message, httpStatus: null, cause })
  }

  static network(cause: unknown): ApiError {
    // 断网/DNS/连接被拒/后端未启动都会走到这里。文案不暴露内部地址与堆栈。
    return ApiError.transport('network_error', '连不上本地服务，请确认后端已启动且地址正确。', cause)
  }

  static timeout(timeoutMs: number): ApiError {
    // 小于 1 秒时按毫秒报：按下取整会显示「超过 0 秒没有响应」，等于什么都没说
    const duration = timeoutMs < 1000 ? `${Math.round(timeoutMs)} 毫秒` : `${Math.round(timeoutMs / 1000)} 秒`
    return ApiError.transport('timeout', `请求超过 ${duration}没有响应，已中止。`)
  }

  static aborted(): ApiError {
    return ApiError.transport('aborted', '请求已取消。')
  }

  /** 服务端返回的不是可解析 JSON。如实说明，不当作空成功。 */
  static malformed(status: number): ApiError {
    return new ApiError({
      code: 'internal_error',
      message: '服务端返回的内容不是合法 JSON，无法读取结果。',
      httpStatus: status,
    })
  }

  static capabilityUnavailable(capability: string, note?: string): ApiError {
    return new ApiError({
      code: 'capability_unavailable',
      message: note ?? `服务端尚未接入「${capability}」能力，本次操作没有执行。`,
      details: { capability },
    })
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

/** 把任意抛出物收敛成 ApiError，便于上层统一处理（不吞掉原始信息）。 */
export function toApiError(value: unknown): ApiError {
  if (isApiError(value)) return value
  if (value instanceof Error) {
    if (value.name === 'AbortError') return ApiError.aborted()
    return ApiError.transport('internal_error', value.message, value)
  }
  return ApiError.transport('internal_error', String(value))
}

/** 服务端 message 面向用户，可直接展示的码。其余用本地文案，避免把技术错误抛给用户。 */
const SERVER_MESSAGE_TRUSTED: ReadonlySet<FailureCode> = new Set<FailureCode>([
  'validation_error',
  'not_found',
  'conflict',
  'precondition_failed',
  'unsupported_media_type',
  'payload_too_large',
  'idempotency_conflict',
  'capability_unavailable',
  'agent_unavailable',
  'rate_limited',
  'cancelled',
])

const LOCAL_MESSAGES: Record<FailureCode, string> = {
  validation_error: '请求内容不合法，服务端没有执行。',
  not_found: '目标不存在或已被删除。',
  conflict: '当前状态与操作冲突，请刷新后重试。',
  precondition_failed: '内容已被其他窗口修改，请刷新后重试。',
  unsupported_media_type: '不支持这种文件类型。',
  payload_too_large: '文件或请求体超出服务端限制。',
  idempotency_conflict: '同一个提交键对应了不同的请求内容。',
  capability_unavailable: '服务端尚未接入这项能力，本次操作没有执行。',
  agent_unavailable: 'Agent 服务未连接，任务没有创建。',
  rate_limited: '请求过于频繁，请稍后重试。',
  cancelled: '该对象已经取消，不能继续操作。',
  internal_error: '服务端出现未预期错误，可凭请求 ID 反馈。',
  network_error: '连不上本地服务，请确认后端已启动且地址正确。',
  stream_disconnected: '与本地服务的连接已断开（数据流被中断）。',
  timeout: '请求超时，已中止。',
  aborted: '请求已取消。',
  unauthorized: '本地服务的临时凭据已失效，需要重新握手。',
}

/**
 * 给用户看的一句话。优先用服务端 message（契约规定它面向用户），
 * 只在服务端没给或该码不该透传技术细节时用本地文案。
 */
export function userMessageForError(error: ApiError, fallback?: string): string {
  const serverMessage = error.message.trim()
  if (serverMessage !== '' && SERVER_MESSAGE_TRUSTED.has(error.code)) return serverMessage
  const local = LOCAL_MESSAGES[error.code] ?? fallback
  if (error.code === 'internal_error' && error.requestId) {
    return `${local}（请求 ID：${error.requestId}）`
  }
  return local
}

/** 把契约的 `ApiErrorDetail` 转成 ApiError（用于 SSE 里的 `error` 事件）。 */
export function apiErrorFromDetail(detail: ApiErrorDetail, httpStatus: number | null = null): ApiError {
  return new ApiError({
    code: isKnownApiCode(detail.code) ? detail.code : 'internal_error',
    message: detail.message,
    httpStatus,
    details: detail.details ?? null,
    requestId: detail.requestId ?? null,
  })
}

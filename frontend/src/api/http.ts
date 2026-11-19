/**
 * HTTP 客户端：唯一的 fetch 出入口。
 *
 * 为什么集中在 service 层：01 §3 要求「请求、错误映射、SSE 管理留在 service，不在 JSX 中散落 fetch」。
 * 这里负责四件容易写错的事：
 * 1. **错误信封**：两种形状都认（见 errors.ts），非 2xx 一律抛 ApiError，绝不把失败当空数据；
 * 2. **条件更新与幂等**：`If-Match`（412 冲突提示刷新）、`Idempotency-Key`（重试复用键）；
 * 3. **超时与取消**：区分「调用方取消」「超时」「连不上」，三者对 UI 是三种不同状态；
 * 4. **SSE 入口**：`openEventStream` 保留响应体供流状态机消费（EventSource 不能带请求头，故用 fetch 流）。
 */
import type { ApiConfig, ApiConfigPatch, ApiResponse, QueryParams, RequestOptions } from './types'
import type { ApiErrorDetail } from '@/api/contracts'
import { buildApiUrl, newIdempotencyKey } from './config'
import { ApiError, apiErrorFromDetail } from './errors'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface HttpClientDeps {
  fetchImpl?: typeof fetch
  /**
   * 临时凭据提供者。返回 null 表示当前没有凭据。
   * token 只放内存（README §2.2），不落 localStorage、不进 URL。
   */
  tokenProvider?: () => string | null | Promise<string | null>
}

interface ResolvedBody {
  body: BodyInit | undefined
  hasBody: boolean
}

function serializeBody(body: unknown): ResolvedBody {
  if (body === undefined) return { body: undefined, hasBody: false }
  if (typeof body === 'string') return { body, hasBody: true }
  if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) {
    return { body, hasBody: true }
  }
  return { body: JSON.stringify(body), hasBody: true }
}

async function readBodyText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return Symbol.for('fengmotion.invalid-json')
  }
}

const INVALID_JSON = Symbol.for('fengmotion.invalid-json')

export class HttpClient {
  private current: ApiConfig
  private readonly deps: HttpClientDeps

  constructor(config: ApiConfig, deps: HttpClientDeps = {}) {
    this.current = config
    this.deps = deps
  }

  get config(): ApiConfig {
    return this.current
  }

  /** 改配置（如用户在设置里换了后端地址）。返回新配置供调用方显示来源。 */
  patchConfig(patch: ApiConfigPatch): ApiConfig {
    this.current = { ...this.current, ...patch, source: 'explicit' }
    return this.current
  }

  /** 仅读，不改：有些地方只想拼 URL（如给 <video src> 用签名地址前的自检）。 */
  url(path: string, query?: QueryParams): string {
    return buildApiUrl(this.current.baseUrl, path, query)
  }

  private async buildHeaders(method: HttpMethod, options: RequestOptions, hasBody: boolean): Promise<Headers> {
    const headers = new Headers()
    headers.set('Accept', options.accept ?? 'application/json')
    // FormData 的 boundary 必须由浏览器生成；手动标成 JSON 会使服务端无法解析上传。
    if (hasBody && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json; charset=utf-8')
    if (options.ifMatch !== undefined) headers.set('If-Match', options.ifMatch)
    if (options.idempotencyKey !== undefined && options.idempotencyKey !== null) {
      headers.set('Idempotency-Key', options.idempotencyKey)
    } else if (options.idempotencyKey === undefined && method === 'POST') {
      // 自动生成只是「这次调用唯一」；同一次用户意图的重试必须由调用方复用同一个键，
      // 否则重复提交会真的创建两条。tasks/chat/assets 的创建方法都暴露了该参数。
      headers.set('Idempotency-Key', newIdempotencyKey())
    }
    if (this.deps.tokenProvider) {
      const token = await this.deps.tokenProvider()
      if (token) headers.set('Authorization', `Bearer ${token}`)
    }
    for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value)
    return headers
  }

  /**
   * 带真实进度的上传（multipart）。
   *
   * <p><strong>为什么单独开一条 XHR 通道</strong>：{@code fetch} 没有上传进度事件，
   * 拿不到「已经发出多少字节」。界面上要画进度环就只能编，而编出来的进度
   * 在慢网络下会先跑满再长时间不动 —— 那比不显示更让人困惑。
   * XHR 的 {@code upload.onprogress} 是浏览器里唯一可靠的来源。</p>
   *
   * <p>不设 Content-Type：交给浏览器生成 multipart boundary，
   * 手动设会让 boundary 丢失，后端解析直接失败。</p>
   *
   * @param path    相对路径，例如 {@code /uploads}
   * @param form    表单数据
   * @param options 取消信号与进度回调
   * @returns 服务器返回的 JSON
   */
  uploadWithProgress<T>(
    path: string,
    form: FormData,
    options: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', this.url(path))
      xhr.withCredentials = this.current.credentials === 'include'
      xhr.setRequestHeader('Accept', 'application/json')

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          options.onProgress?.(Math.round((event.loaded / event.total) * 100))
        }
      }
      xhr.onload = () => {
        // 2xx 之外统一走 ApiError，与 HttpClient.request 的错误形状保持一致
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as T)
          } catch {
            reject(new ApiError({ code: 'internal_error', message: '上传响应不是合法 JSON', httpStatus: xhr.status }))
          }
          return
        }
        // 错误体形状与 ApiExceptionHandler 一致：{ error: { code, message, requestId } }
        try {
          const body = JSON.parse(xhr.responseText) as { error: ApiErrorDetail }
          reject(apiErrorFromDetail(body.error, xhr.status))
        } catch {
          // 非 JSON 错误体：给一个可读的通用失败，不把解析异常暴露给用户
          reject(new ApiError({
            code: 'internal_error',
            message: `上传失败（HTTP ${xhr.status}）`,
            httpStatus: xhr.status,
          }))
        }
      }
      xhr.onerror = () => reject(new ApiError({ code: 'network_error', message: '上传时网络中断' }))
      xhr.onabort = () => reject(new ApiError({ code: 'aborted', message: '上传已取消' }))

      if (options.signal) {
        if (options.signal.aborted) {
          xhr.abort()
          return
        }
        options.signal.addEventListener('abort', () => xhr.abort(), { once: true })
      }
      xhr.send(form)
    })
  }

  /**
   * 一次请求。非 2xx 抛 `ApiError`；成功返回数据 + ETag + requestId。
   *
   * `204 No Content` 视为成功且 `data` 为 `undefined`（契约 §2.3：删除返回 204）。
   */
  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const { body, hasBody } = serializeBody(options.body)
    const headers = await this.buildHeaders(method, options, hasBody)
    const url = this.url(path, options.query)

    const controller = new AbortController()
    let timedOut = false
    let callerAborted = false
    const timeoutMs = options.timeoutMs ?? this.current.timeoutMs
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
      : null

    const onCallerAbort = () => {
      callerAborted = true
      controller.abort()
    }
    if (options.signal) {
      if (options.signal.aborted) onCallerAbort()
      else options.signal.addEventListener('abort', onCallerAbort, { once: true })
    }

    try {
      const fetchImpl = this.deps.fetchImpl ?? fetch
      const response = await fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        credentials: this.current.credentials,
      })
      const headerRequestId = response.headers.get('x-request-id')

      if (!response.ok) {
        const text = await readBodyText(response)
        const payload = parseJsonText(text)
        throw ApiError.fromResponse(
          response.status,
          payload === INVALID_JSON ? null : payload,
          headerRequestId,
          response.headers.get('retry-after'),
        )
      }

      const etag = response.headers.get('etag')
      if (response.status === 204 || response.status === 205) {
        return { data: undefined as T, status: response.status, etag, requestId: headerRequestId }
      }

      const text = await readBodyText(response)
      if (text.trim() === '') {
        // 2xx 但空体：契约里只有 204 允许空；这里如实返回 undefined，由调用方决定是否算异常
        return { data: undefined as T, status: response.status, etag, requestId: headerRequestId }
      }
      const payload = parseJsonText(text)
      if (payload === INVALID_JSON) throw ApiError.malformed(response.status)
      return { data: payload as T, status: response.status, etag, requestId: headerRequestId }
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (callerAborted) throw ApiError.aborted()
      if (timedOut) throw ApiError.timeout(timeoutMs)
      throw ApiError.network(error)
    } finally {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onCallerAbort)
    }
  }

  /** 只要数据，不要 ETag（大多数读接口）。 */
  async data<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request<T>(method, path, options)
    return response.data
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.data<T>('GET', path, options)
  }

  /** 需要 ETag 时用（更新前的读取、或要把版本号交给条件更新）。 */
  getWithMeta<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, options)
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.data<T>('POST', path, { ...options, body })
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.data<T>('PATCH', path, { ...options, body })
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.data<T>('PUT', path, { ...options, body })
  }

  /** 删除。契约成功返回 204（无内容）。 */
  async del(path: string, options: RequestOptions = {}): Promise<void> {
    await this.request<void>('DELETE', path, options)
  }

  /**
   * 建立 SSE 连接并交回原始响应。
   *
   * 为什么不用 `EventSource`：它不能带 `Authorization`/`Last-Event-ID`/自定义头
   * （README §2.9 要求断线重连带 `Last-Event-ID`，02 §5 要求不把 token 放 URL）。
   * 超时不在这里管：流的存活靠空闲判定，见 sse.ts / streams.ts。
   */
  async openEventStream(
    path: string,
    options: { query?: QueryParams; lastEventId?: string; signal?: AbortSignal; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const headers = new Headers()
    headers.set('Accept', 'text/event-stream')
    headers.set('Cache-Control', 'no-cache')
    if (options.lastEventId) headers.set('Last-Event-ID', options.lastEventId)
    if (this.deps.tokenProvider) {
      const token = await this.deps.tokenProvider()
      if (token) headers.set('Authorization', `Bearer ${token}`)
    }
    for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value)

    const url = this.url(path, options.query)
    let response: Response
    try {
      const fetchImpl = this.deps.fetchImpl ?? fetch
      response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal: options.signal,
        credentials: this.current.credentials,
      })
    } catch (error) {
      if (options.signal?.aborted) throw ApiError.aborted()
      throw ApiError.network(error)
    }

    if (!response.ok) {
      const text = await readBodyText(response)
      const payload = parseJsonText(text)
      throw ApiError.fromResponse(
        response.status,
        payload === INVALID_JSON ? null : payload,
        response.headers.get('x-request-id'),
        response.headers.get('retry-after'),
      )
    }
    if (!response.body) {
      throw ApiError.transport('network_error', '服务端没有返回事件流内容。')
    }
    return response
  }
}

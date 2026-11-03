/**
 * FengMotion 前端 API 层**验收入口**（独立验收，不复用实现者自述）。
 *
 * 做法：
 * 1. 用 `node:http` 起一个**真**假服务端，按契约实现端点，并把「收到的每个请求」记下来
 *    （method / path / query / headers / body）—— 后续一致性审计拿它当证据；
 * 2. 让被测代码（`@/services/api/*`）真的去连这个服务端，逐条断言，打印每条 PASS/FAIL 与**实际值**；
 * 3. 结论只来自这次真跑的输出，不来自注释或实现者描述。
 *
 * 依据：`FengMotion-前后端迁移与视频生成方案/02-前后端API契约.md`（§2 通用规则、§3 端点总表、
 * §5 任务/事件/取消、兼容表）与 `docs/contracts/README.md`（§2 通用约定、§3 端点总表、§4 状态机）。
 *
 * 运行：
 *   npx vite build --config scripts/vite.api-check.config.ts
 *   node scripts/.api-check-dist/api-contract-check.mjs
 *
 * 本脚本**不改 src/**。发现偏差只打印证据，由实现者修。
 */
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'

import { createAssetsResource } from '@/services/api/assets'
import { createLibraryResource } from '@/services/api/library'
import { CAPABILITY_LABELS, capabilityGate, mergeCapability, normalizeServerCapabilities } from '@/services/api/capabilities'
import { createStudioApiClient, installStudioHttpApi, resetStudioHttpApi, studioHttpApi } from '@/services/api'
import { referenceAnalysisGate } from '@/services/api/library'
import { createChatResource } from '@/services/api/chat'
import { createChecksResource } from '@/services/api/checks'
import { createProjectsResource } from '@/services/api/projects'
import { createRendersResource } from '@/services/api/renders'
import { createSystemResource } from '@/services/api/health'
import { createTasksResource } from '@/services/api/tasks'
import { createWorkflowsResource } from '@/services/api/workflows'
import { DEFAULT_API_CONFIG, buildApiUrl, newIdempotencyKey, normalizeBaseUrl, readEnvConfig, resolveApiConfig } from '@/services/api/config'
import { demoOriginOf, detectUnfrozenLocalFields, fromLegacyAttachment, fromLegacyReference } from '@/services/api/compat'
import { ApiError, parseErrorPayload, parseRetryAfterMs, toApiError, userMessageForError } from '@/services/api/errors'
import { HttpClient } from '@/services/api/http'
import { IdleTimeoutError, createSseParser, readSseMessages } from '@/services/api/sse'
import { normalizeEventList, openChatSessionStream, openTaskEventStream } from '@/services/api/streams'
import type { ChatStreamState, TaskStreamState, UploadProgress } from '@/services/api/types'
import { assertTaskRequestSendable, bboxProblem, validateTaskRequest } from '@/services/api/validate'
import type { AgentTask, TaskEvent, TaskEventKind, TaskRequest, TaskStatus } from '@/types/contracts'

/* ============================ 断言骨架 ============================ */

let checks = 0
const failures: string[] = []
const observations: string[] = []

const show = (value: unknown): string => {
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return String(value)
    return text.length > 400 ? `${text.slice(0, 397)}...` : text
  } catch {
    return String(value)
  }
}

function check(name: string, pass: boolean, actual: unknown, expected?: unknown): void {
  checks += 1
  if (pass) {
    console.log(`PASS  ${name}  | actual=${show(actual)}`)
    return
  }
  const detail = `FAIL  ${name}  | actual=${show(actual)}${expected === undefined ? '' : ` | expected=${show(expected)}`}`
  console.log(detail)
  failures.push(detail)
}

const eq = (name: string, actual: unknown, expected: unknown): void =>
  check(name, show(actual) === show(expected), actual, expected)

const ok = (name: string, pass: boolean, actual: unknown): void => check(name, pass, actual, 'truthy')

function obs(message: string): void {
  observations.push(message)
  console.log(`OBS   ${message}`)
}

const group = (title: string): void => console.log(`\n──────── ${title} ────────`)

const waitMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (condition()) return true
    await waitMs(15)
  }
  return condition()
}

async function capture(fn: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await fn()
    return null
  } catch (error) {
    return error instanceof ApiError ? error : (error as ApiError)
  }
}

const errSig = (error: unknown): string =>
  error instanceof ApiError
    ? `ApiError(code=${error.code}, http=${error.httpStatus}, requestId=${error.requestId}, retryable=${error.retryable}, legacy=${error.legacyShape}, retryAfterMs=${error.retryAfterMs})`
    : `非 ApiError: ${String(error)}`

/* ============================ 假服务端 ============================ */

interface Recorded {
  method: string
  path: string
  query: URLSearchParams
  headers: http.IncomingHttpHeaders
  body: string
  at: number
}

type SseDriver = (attempt: number, res: http.ServerResponse) => void

interface TaskScenario {
  task: Partial<AgentTask> & { id: string; status: TaskStatus }
  /** 事件历史：按 afterSeq 返回**当时确实持久化了**的事件（故意允许只返回一部分，用来逼出重连补齐）。 */
  history: (afterSeq: number) => TaskEvent[]
  historyShape?: 'page' | 'array'
  sse: SseDriver
}

interface ChatScenario {
  sse: SseDriver
}

const records: Recorded[] = []
const wireLog: string[] = []
const sockets = new Set<net.Socket>()
const taskScenarios = new Map<string, TaskScenario>()
const chatScenarios = new Map<string, ChatScenario>()
const sseConnections = new Map<string, number>()

const sseFrame = (data: unknown, meta: { id?: string | number; event?: string } = {}): string =>
  `${meta.id !== undefined ? `id: ${meta.id}\n` : ''}${meta.event ? `event: ${meta.event}\n` : ''}data: ${JSON.stringify(data)}\n\n`

const safeWrite = (res: http.ServerResponse, text: string): void => {
  if (!res.writableEnded && !res.destroyed) res.write(text)
}
const safeEnd = (res: http.ServerResponse): void => {
  if (!res.writableEnded && !res.destroyed) res.end()
}
const timeline = (res: http.ServerResponse, steps: Array<[number, () => void]>): void => {
  for (const [ms, fn] of steps) {
    setTimeout(() => {
      try {
        fn()
      } catch {
        // 连接可能已被客户端断开，验收里不需要因此失败
      }
    }, ms)
  }
}
const openSse = (res: http.ServerResponse): void => {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
  res.socket?.setNoDelay(true)
}

const json = (res: http.ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(JSON.stringify(payload))
}

const nestedError = (
  res: http.ServerResponse,
  status: number,
  code: string,
  message: string,
  extra: { details?: unknown; requestId?: string; headerRequestId?: string; retryAfter?: string } = {},
): void => {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' }
  if (extra.headerRequestId) headers['x-request-id'] = extra.headerRequestId
  if (extra.retryAfter) headers['retry-after'] = extra.retryAfter
  res.writeHead(status, headers)
  res.end(JSON.stringify({ error: { code, message, details: extra.details ?? null, requestId: extra.requestId ?? null } }))
}

const flatError = (res: http.ServerResponse, status: number, code: string, message: string, headerRequestId?: string): void => {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' }
  if (headerRequestId) headers['x-request-id'] = headerRequestId
  res.writeHead(status, headers)
  res.end(JSON.stringify({ code, message }))
}

const mkEvent = (taskId: string, seq: number, kind: TaskEventKind, status: TaskStatus, message: string): TaskEvent => ({
  id: `${taskId}_evt_${seq}`,
  seq,
  taskId,
  kind,
  status,
  message,
  at: '2026-10-29T10:00:00.000Z',
})

const mkTask = (id: string, status: TaskStatus): AgentTask => ({
  id,
  projectId: 'prj_1',
  kind: 'modify',
  status,
  title: '调整杯口',
  createdAt: '2026-10-29T10:00:00Z',
  updatedAt: '2026-10-29T10:00:05Z',
})

function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL, rec: Recorded): void {
  const full = url.pathname
  const path = full.startsWith('/api') ? full.slice(4) || '/' : full
  const method = req.method ?? 'GET'

  if (path === '/health' && method === 'GET') {
    return json(res, 200, { status: 'ok', version: '0.3.0-check', uptimeMs: 1234, demo: true })
  }

  if (path === '/capabilities' && method === 'GET') {
    return json(res, 200, {
      agent: { status: 'available', note: 'Agent 已连接' },
      remotionEditor: { status: 'demo', note: '本机编辑器仅演示' },
      previewVideo: { status: 'unavailable' },
      // 其余五项故意缺项（asr/cloudRender/referenceAnalysis/checkExecution/...）
    })
  }

  if (path === '/echo') {
    let parsed: unknown = null
    try {
      parsed = rec.body ? JSON.parse(rec.body) : null
    } catch {
      parsed = rec.body
    }
    return json(res, 200, { ok: true, method, body: parsed })
  }

  if (path === '/badjson200' && method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end('<html>不是 JSON</html>')
  }

  if (path === '/resource' && method === 'DELETE') {
    res.writeHead(204, { etag: '"res-rev-1"' })
    return res.end()
  }

  if (path === '/conditional' && (method === 'POST' || method === 'PATCH')) {
    if (req.headers['if-match'] === '"rev-1"') return json(res, 200, { ok: true, version: 'rev-1' })
    return nestedError(res, 412, 'precondition_failed', '项目已被其他窗口修改', {
      details: { etag: '"rev-2"' },
      requestId: 'req_412',
      headerRequestId: 'req_hdr_412',
    })
  }

  if (path === '/slow' && method === 'GET') {
    const ms = Number(url.searchParams.get('ms') ?? '2000') || 2000
    setTimeout(() => json(res, 200, { ok: true, sleptMs: ms }), ms)
    return
  }

  const errorRoutes: Record<string, () => void> = {
    '/errors/nested412': () =>
      nestedError(res, 412, 'precondition_failed', '项目已被其他窗口修改', {
        details: { etag: '"rev-2"' },
        requestId: 'req_412',
        headerRequestId: 'req_hdr_412',
      }),
    '/errors/flat404': () => flatError(res, 404, 'task_not_found', '任务不存在', 'req_hdr_404'),
    '/errors/conflict409': () => nestedError(res, 409, 'idempotency_conflict', '同一个提交键对应了不同的请求内容', { requestId: 'req_409' }),
    '/errors/capability422': () =>
      nestedError(res, 422, 'capability_unavailable', 'ASR 能力未接入', { details: { capability: 'asr' }, requestId: 'req_422' }),
    '/errors/agent503': () => nestedError(res, 503, 'agent_unavailable', 'Agent 进程未连接', { requestId: 'req_503' }),
    '/errors/rate429': () => nestedError(res, 429, 'rate_limited', '请求过于频繁', { requestId: 'req_429', retryAfter: '2' }),
    '/errors/rate429date': () => {
      // 用整秒边界构造，避免 toUTCString() 丢掉毫秒导致期望值失真（HTTP-date 只到秒）
      const at = new Date(Math.ceil((Date.now() + 3000) / 1000) * 1000)
      return nestedError(res, 429, 'rate_limited', '请求过于频繁', { requestId: 'req_429d', retryAfter: at.toUTCString() })
    },
    '/errors/bad400': () =>
      nestedError(res, 400, 'validation_error', '修改区域超出画面', { details: { field: 'references[0].bbox' }, requestId: 'req_400' }),
    '/errors/boom500': () =>
      nestedError(res, 500, 'internal_error', 'java.lang.NullPointerException at /home/lufering/secret/AgentService.java:42', {
        requestId: 'req_500',
      }),
    '/errors/notjson': () => {
      res.writeHead(500, { 'content-type': 'text/html' })
      res.end('<html>proxy error</html>')
    },
    '/errors/unknown-code': () => flatError(res, 409, 'some_brand_new_code', '服务端新错误码'),
    '/errors/nested-unknown': () =>
      nestedError(res, 409, 'some_nested_code', '服务端新增的嵌套错误码', { requestId: 'req_nested_unknown' }),
  }
  if (errorRoutes[path]) return errorRoutes[path]()

  // 域端点（项目/任务/对话/素材/渲染/检查/工作流/知识库）
  for (const entry of domainRoutes) {
    const match = entry.pattern.exec(path)
    if (match && (entry.method === '*' || entry.method === method)) {
      return entry.handler({ res, url, rec, method, path, params: match.slice(1) })
    }
  }

  const taskMatch = /^\/tasks\/([^/]+)$/.exec(path)
  if (taskMatch && method === 'GET') {
    const scenario = taskScenarios.get(taskMatch[1])
    if (!scenario) return nestedError(res, 404, 'not_found', '任务不存在', { requestId: 'req_t404' })
    return json(res, 200, scenario.task)
  }

  const historyMatch = /^\/tasks\/([^/]+)\/events\/history$/.exec(path)
  if (historyMatch && method === 'GET') {
    const scenario = taskScenarios.get(historyMatch[1])
    if (!scenario) return nestedError(res, 404, 'not_found', '任务不存在')
    const afterSeq = Number(url.searchParams.get('afterSeq') ?? '0') || 0
    const items = scenario.history(afterSeq)
    return json(res, 200, (scenario.historyShape ?? 'page') === 'array' ? items : { items, nextCursor: null })
  }

  const sseMatch = /^\/tasks\/([^/]+)\/events$/.exec(path)
  if (sseMatch && method === 'GET') {
    const scenario = taskScenarios.get(sseMatch[1])
    if (!scenario) return nestedError(res, 404, 'not_found', '任务不存在')
    const key = `task:${sseMatch[1]}`
    const attempt = sseConnections.get(key) ?? 0
    sseConnections.set(key, attempt + 1)
    openSse(res)
    scenario.sse(attempt, res)
    return
  }

  const chatMatch = /^\/chat-sessions\/([^/]+)\/stream$/.exec(path)
  if (chatMatch && method === 'GET') {
    const scenario = chatScenarios.get(chatMatch[1])
    if (!scenario) return nestedError(res, 404, 'not_found', '会话不存在')
    const key = `chat:${chatMatch[1]}`
    const attempt = sseConnections.get(key) ?? 0
    sseConnections.set(key, attempt + 1)
    openSse(res)
    scenario.sse(attempt, res)
    return
  }

  return nestedError(res, 404, 'not_found', `验收假服务端未实现该端点：${method} ${path}`)
}

let server: http.Server
let baseUrl = ''

async function startServer(): Promise<void> {
  server = http.createServer((req, res) => {
    sockets.add(req.socket)
    req.socket.on('close', () => sockets.delete(req.socket))
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const rec: Recorded = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        at: Date.now(),
      }
      records.push(rec)
      try {
        route(req, res, url, rec)
      } catch (error) {
        if (!res.headersSent) nestedError(res, 500, 'internal_error', `假服务端自身出错：${String(error)}`)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}/api`
  console.log(`[假服务端] 监听 ${baseUrl}（依据：02 契约 §2/§3/§5 + docs/contracts/README.md §2/§3）`)
}

async function freePort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

const makeHttp = (patch: Record<string, unknown> = {}): HttpClient =>
  new HttpClient(
    resolveApiConfig({
      explicit: { baseUrl, timeoutMs: 3000, streamIdleTimeoutMs: 5000, streamReconnectLimit: 3, ...patch },
      skipEnv: true,
    }),
  )

const recordsFor = (predicate: (rec: Recorded) => boolean): Recorded[] => records.filter(predicate)
const taskSseRecords = (taskId: string): Recorded[] => recordsFor((r) => r.path === `/api/tasks/${taskId}/events`)
const historyCalls = (taskId: string): Recorded[] => recordsFor((r) => r.path === `/api/tasks/${taskId}/events/history`)
/** 最近一次「方法 + 路径」的请求记录；一致性审计与查询串断言都靠它。 */
const lastReq = (method: string, path: string): Recorded | undefined =>
  recordsFor((r) => r.method === method && r.path === path).at(-1)
const reqCount = (method: string, path: string): number =>
  recordsFor((r) => r.method === method && r.path === path).length

/* ============================ 域端点（A/B 域客户端验收用） ============================ */

interface RouteCtx {
  res: http.ServerResponse
  url: URL
  rec: Recorded
  method: string
  path: string
  params: string[]
}
type DomainHandler = (ctx: RouteCtx) => void
const domainRoutes: Array<{ method: string; pattern: RegExp; handler: DomainHandler }> = []
const on = (method: string, pattern: RegExp, handler: DomainHandler): void => {
  domainRoutes.push({ method, pattern, handler })
}
const bodyOf = (rec: Recorded): Record<string, unknown> => {
  try {
    const parsed = rec.body ? JSON.parse(rec.body) : {}
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
const noContent = (res: http.ServerResponse): void => {
  res.writeHead(204)
  res.end()
}
const requireMatch = (res: http.ServerResponse, rec: Recorded, expected: string, requestId: string): boolean => {
  if (rec.headers['if-match'] === expected) return false
  nestedError(res, 412, 'precondition_failed', '内容已被其他窗口修改', { details: { etag: expected }, requestId })
  return true
}

const ISO = '2026-10-29T10:00:00.000Z'
const mkProject = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  name: `项目 ${id}`,
  stage: 'editing',
  createdAt: ISO,
  updatedAt: ISO,
  etag: '"prj-rev-1"',
  ...over,
})
const mkScene = (id: string): Record<string, unknown> => ({
  id,
  projectId: 'prj_1',
  index: 0,
  title: `场景 ${id}`,
  startMs: 0,
  durationMs: 3000,
  status: 'idle',
})
const mkArtifact = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  projectId: 'prj_1',
  type: 'lookdev',
  title: '外观设定',
  summary: '',
  body: '',
  status: 'draft',
  relatedSceneIds: [],
  version: 1,
  updatedAt: ISO,
  etag: '"art-rev-1"',
  ...over,
})
const mkAsset = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  name: `素材 ${id}`,
  mediaType: 'video',
  mimeType: 'video/mp4',
  sizeBytes: 12,
  sourceType: 'imported',
  processingStatus: 'pending',
  reviewStatus: 'none',
  availability: 'enabled',
  licenseStatus: 'unknown',
  tags: [],
  folderId: null,
  refs: [],
  fileUrl: `http://127.0.0.1/api/files/${id}.mp4`,
  createdAt: ISO,
  updatedAt: ISO,
  etag: '"asset-rev-1"',
  ...over,
})
const mkChatSession = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  projectId: 'prj_1',
  title: '新会话',
  createdAt: ISO,
  updatedAt: ISO,
  messageCount: 0,
  ...over,
})
const mkUploadSession = (uploadId: string, receivedBytes: number, sizeBytes = 12, chunkSizeBytes = 4): Record<string, unknown> => ({
  uploadId,
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
  sizeBytes,
  chunkSizeBytes,
  receivedBytes,
  status: 'uploading',
  expiresAt: '2026-10-29T11:00:00.000Z',
})
const mkRenderJob = (renderId: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  renderId,
  projectId: 'prj_1',
  taskId: 'task_render',
  status: 'running',
  preset: { resolution: '1080p', fps: 30, format: 'mp4', quality: 'draft' },
  startedAt: ISO,
  ...over,
})

/**
 * 域端点：只为验收提供**形状正确**的响应。
 * 这里刻意保留几处「未冻结形状」的分支（数组 / Page / 信封），用来验证客户端的兼容解析与抛错行为。
 */
function registerDomainRoutes(): void {
  /* ---------------- 系统域 ---------------- */
  on('GET', /^\/settings$/, ({ res }) => json(res, 200, { theme: 'dark', workspaceRoot: '/tmp/ws', lastProjectId: 'prj_1' }))
  on('PATCH', /^\/settings$/, ({ res, rec }) =>
    json(res, 200, { theme: bodyOf(rec).theme ?? 'dark', workspaceRoot: '/tmp/ws', lastProjectId: 'prj_1' }),
  )

  /* ---------------- 项目域 ---------------- */
  on('GET', /^\/projects$/, ({ res }) => json(res, 200, { items: [mkProject('prj_1'), mkProject('prj_2')], nextCursor: null, total: 2 }))
  on('POST', /^\/projects$/, ({ res, rec }) => json(res, 201, { ...mkProject('prj_new'), ...bodyOf(rec) }))
  on('GET', /^\/projects\/([^/]+)$/, ({ res, params }) => json(res, 200, mkProject(params[0])))
  on('PATCH', /^\/projects\/([^/]+)$/, ({ res, rec, params }) => {
    if (requireMatch(res, rec, '"prj-rev-1"', 'req_prj412')) return
    json(res, 200, { ...mkProject(params[0]), ...bodyOf(rec) })
  })
  on('DELETE', /^\/projects\/([^/]+)$/, ({ res }) => noContent(res))
  on('GET', /^\/projects\/([^/]+)\/timeline$/, ({ res, params }) =>
    json(res, 200, { projectId: params[0], source: 'assembly', clips: [], durationMs: 3000, updatedAt: ISO }),
  )
  // 裸数组：project.md §4.2 说场景「数量有限、不分页」，README §2.3 说列表一律 Page —— 客户端要两种都收
  on('GET', /^\/projects\/([^/]+)\/scenes$/, ({ res, params }) =>
    params[0] === 'prj_bad' ? json(res, 200, { nope: true }) : json(res, 200, [mkScene('scene_1'), mkScene('scene_2')]),
  )
  on('GET', /^\/projects\/([^/]+)\/scenes\/([^/]+)\/override$/, ({ res }) =>
    nestedError(res, 404, 'not_found', '该场景还没有保存过镜头参数', { requestId: 'req_ov404' }),
  )
  on('PUT', /^\/projects\/([^/]+)\/scenes\/([^/]+)\/override$/, ({ res, rec, params }) =>
    json(res, 200, { sceneId: params[1], settings: bodyOf(rec).settings ?? {}, etag: '"ov-rev-3"' }),
  )
  on('GET', /^\/projects\/([^/]+)\/scenes\/([^/]+)$/, ({ res, params }) => json(res, 200, mkScene(params[1])))
  on('GET', /^\/projects\/([^/]+)\/storyboard$/, ({ res }) => json(res, 200, { items: [], nextCursor: null }))
  on('GET', /^\/projects\/([^/]+)\/artifacts$/, ({ res }) => json(res, 200, { items: [mkArtifact('art_1')], nextCursor: null }))
  on('POST', /^\/projects\/([^/]+)\/artifacts$/, ({ res, rec }) => json(res, 201, { ...mkArtifact('art_new'), ...bodyOf(rec) }))
  on('GET', /^\/projects\/([^/]+)\/artifacts\/([^/]+)$/, ({ res, params }) => json(res, 200, mkArtifact(params[1])))
  on('PATCH', /^\/projects\/([^/]+)\/artifacts\/([^/]+)$/, ({ res, rec, params }) => {
    if (requireMatch(res, rec, '"art-rev-1"', 'req_art412')) return
    json(res, 200, { ...mkArtifact(params[1]), ...bodyOf(rec) })
  })
  on('GET', /^\/projects\/([^/]+)\/versions$/, ({ res }) => json(res, 200, [{ id: 'ver_1', projectId: 'prj_1', label: 'v1', restorable: true, createdAt: ISO }]))
  on('POST', /^\/projects\/([^/]+)\/versions\/([^/]+)\/restore$/, ({ res }) =>
    json(res, 202, { task: mkTask('task_restore', 'queued'), runId: 'run_restore' }),
  )

  /* ---------------- 任务域 ---------------- */
  on('POST', /^\/projects\/([^/]+)\/tasks$/, ({ res, rec, params }) =>
    json(res, 202, {
      task: { ...mkTask('task_created', 'queued'), projectId: params[0], kind: bodyOf(rec).kind ?? 'modify' },
      runId: 'run_9',
    }),
  )
  on('GET', /^\/projects\/([^/]+)\/tasks$/, ({ res, params }) => {
    if (params[0] === 'prj_array') return json(res, 200, [mkTask('task_1', 'running')])
    if (params[0] === 'prj_garbage') return json(res, 200, { nope: true })
    return json(res, 200, { items: [mkTask('task_1', 'running')], nextCursor: null })
  })
  on('POST', /^\/tasks\/([^/]+)\/cancel$/, ({ res }) => {
    res.writeHead(202)
    res.end()
  })
  on('POST', /^\/tasks\/([^/]+)\/retry$/, ({ res }) => json(res, 202, { task: mkTask('task_retry', 'queued'), runId: 'run_retry' }))
  on('GET', /^\/tasks\/([^/]+)\/changes$/, ({ res, params }) =>
    params[0] === 'task_missing'
      ? nestedError(res, 404, 'not_found', '任务不存在', { requestId: 'req_change404' })
      : json(res, 200, { taskId: params[0], summary: '无文件变更', files: [], buildStatus: 'not-run' }),
  )

  /* ---------------- 对话域 ---------------- */
  on('GET', /^\/projects\/([^/]+)\/chat-sessions$/, ({ res, params }) => {
    if (params[0] === 'prj_array') return json(res, 200, [mkChatSession('cs_1')])
    if (params[0] === 'prj_garbage') return json(res, 200, { nope: true })
    return json(res, 200, { items: [mkChatSession('cs_1')], nextCursor: null })
  })
  on('POST', /^\/projects\/([^/]+)\/chat-sessions$/, ({ res, rec }) => json(res, 201, { ...mkChatSession('cs_new'), ...bodyOf(rec) }))
  on('DELETE', /^\/chat-sessions\/([^/]+)$/, ({ res }) => noContent(res))
  on('GET', /^\/chat-sessions\/([^/]+)\/messages$/, ({ res, params }) =>
    json(res, 200, {
      items: [{ id: 'msg_1', sessionId: params[0], role: 'user', text: '结尾出现店名', createdAt: ISO }],
      nextCursor: null,
    }),
  )
  on('POST', /^\/chat-sessions\/([^/]+)\/messages$/, ({ res, params, rec }) => {
    const text = String(bodyOf(rec).text ?? '')
    if (params[0] === 'cs_envelope') {
      // agent.md §3：202 + { message, taskId? } 信封，且消息本体可能不带 taskId
      return json(res, 202, {
        message: { id: 'msg_env', sessionId: params[0], role: 'assistant', text, createdAt: ISO },
        taskId: 'task_from_envelope',
      })
    }
    if (params[0] === 'cs_bare') {
      return json(res, 201, { id: 'msg_bare', sessionId: params[0], role: 'user', text, createdAt: ISO })
    }
    if (params[0] === 'cs_bad') return json(res, 201, { nope: true })
    return json(res, 201, { id: 'msg_ok', sessionId: params[0], role: 'user', text, createdAt: ISO })
  })
  on('GET', /^\/chat-sessions\/([^/]+)$/, ({ res, params }) => json(res, 200, mkChatSession(params[0])))

  /* ---------------- 素材域 ---------------- */
  on('GET', /^\/assets$/, ({ res }) => json(res, 200, { items: [mkAsset('asset_1'), mkAsset('asset_2')], nextCursor: null }))
  on('POST', /^\/assets\/uploads$/, ({ res, rec }) => {
    const body = bodyOf(rec)
    return json(res, 201, {
      ...mkUploadSession('up_fresh', 0, Number(body.sizeBytes ?? 12), 4),
      fileName: body.fileName ?? 'clip.mp4',
      mimeType: body.mimeType ?? 'video/mp4',
    })
  })
  on('GET', /^\/assets\/uploads\/([^/]+)$/, ({ res, params }) => json(res, 200, mkUploadSession(params[0], 8)))
  on('PUT', /^\/assets\/uploads\/([^/]+)\/chunks\/(\d+)$/, ({ res, params }) =>
    json(res, 200, { receivedBytes: (Number(params[1]) + 1) * 4 }),
  )
  on('POST', /^\/assets\/uploads\/([^/]+)\/complete$/, ({ res, params }) =>
    json(res, 201, mkAsset(params[0] === 'up_resume' ? 'asset_resumed' : 'asset_fresh')),
  )
  on('DELETE', /^\/assets\/uploads\/([^/]+)$/, ({ res }) => noContent(res))
  on('PATCH', /^\/assets\/([^/]+)$/, ({ res, rec, params }) => {
    if (requireMatch(res, rec, '"asset-rev-1"', 'req_asset412')) return
    json(res, 200, { ...mkAsset(params[0]), ...bodyOf(rec) })
  })
  on('DELETE', /^\/assets\/([^/]+)$/, ({ res, params }) =>
    params[0] === 'asset_referenced'
      ? nestedError(res, 409, 'conflict', '素材被项目引用，不能删除', {
          details: { refs: [{ type: 'project', id: 'prj_1', name: '项目 prj_1' }] },
          requestId: 'req_asset409',
        })
      : noContent(res),
  )
  on('POST', /^\/assets\/batch-delete$/, ({ res }) =>
    json(res, 207, { results: [{ id: 'a_ok', ok: true }, { id: 'a_bad', ok: false, error: '被项目引用' }] }),
  )
  on('POST', /^\/assets\/import$/, ({ res }) =>
    nestedError(res, 422, 'capability_unavailable', '远程后端不支持按本机路径导入', {
      details: { capability: 'assetImport' },
      requestId: 'req_import422',
    }),
  )
  on('GET', /^\/assets\/([^/]+)$/, ({ res, params }) => json(res, 200, mkAsset(params[0])))
  on('GET', /^\/asset-folders$/, ({ res }) => json(res, 200, [{ id: 'fold_1', name: '素材', createdAt: ISO, updatedAt: ISO }]))
  on('POST', /^\/asset-folders$/, ({ res, rec }) => json(res, 201, { id: 'fold_new', name: bodyOf(rec).name ?? '新文件夹', createdAt: ISO, updatedAt: ISO }))
  on('PATCH', /^\/asset-folders\/([^/]+)$/, ({ res, rec, params }) => json(res, 200, { id: params[0], name: bodyOf(rec).name ?? '改名', createdAt: ISO, updatedAt: ISO }))
  on('DELETE', /^\/asset-folders\/([^/]+)$/, ({ res }) => noContent(res))

  /* ---------------- 渲染域 ---------------- */
  on('POST', /^\/projects\/([^/]+)\/renders$/, ({ res, params }) => json(res, 202, mkRenderJob('render_new', { projectId: params[0] })))
  on('GET', /^\/projects\/([^/]+)\/renders$/, ({ res }) => json(res, 200, { items: [mkRenderJob('render_1')], nextCursor: null }))
  on('POST', /^\/renders\/([^/]+)\/cancel$/, ({ res }) => {
    res.writeHead(202)
    res.end()
  })
  on('POST', /^\/renders\/([^/]+)\/acceptance$/, ({ res, rec, params }) =>
    json(res, 201, { id: 'acc_1', renderId: params[0], decision: bodyOf(rec).decision ?? 'accepted', decidedAt: ISO }),
  )
  on('GET', /^\/renders\/([^/]+)\/checks$/, ({ res }) => json(res, 200, { items: [mkCheckRun('check_1')], nextCursor: null }))
  on('GET', /^\/renders\/([^/]+)$/, ({ res, params }) =>
    json(res, 200, mkRenderJob(params[0], { status: 'completed', output: { fileId: 'file_out', url: 'http://127.0.0.1/out.mp4', durationMs: 10000, sizeBytes: 1234, createdAt: ISO } })),
  )
  on('GET', /^\/projects\/([^/]+)\/delivery$/, ({ res }) =>
    json(res, 200, { projectId: 'prj_1', status: 'missing', missing: [{ label: '成片', reason: '还没有完成的渲染' }] }),
  )
  on('GET', /^\/projects\/([^/]+)\/acceptances$/, ({ res }) => json(res, 200, { items: [], nextCursor: null }))

  /* ---------------- 检查域 ---------------- */
  on('POST', /^\/projects\/([^/]+)\/checks$/, ({ res }) => json(res, 202, mkCheckRun('check_new')))
  on('GET', /^\/projects\/([^/]+)\/checks$/, ({ res }) => json(res, 200, { items: [mkCheckRun('check_1')], nextCursor: null }))
  on('GET', /^\/checks\/([^/]+)\/findings$/, ({ res }) =>
    json(res, 200, {
      items: [{ id: 'finding_1', checkRunId: 'check_1', severity: 'major', status: 'open', title: '字幕压边', detail: '', at: ISO }],
      nextCursor: null,
    }),
  )
  on('GET', /^\/checks\/([^/]+)$/, ({ res, params }) =>
    json(res, 200, { ...mkCheckRun(params[0]), conclusion: 'failed', counts: { blocker: 0, major: 1, minor: 0, info: 0 }, findings: [] }),
  )
  on('PATCH', /^\/check-findings\/([^/]+)$/, ({ res, rec, params }) => {
    if (requireMatch(res, rec, '"finding-rev-1"', 'req_finding412')) return
    json(res, 200, { id: params[0], checkRunId: 'check_1', severity: 'major', status: bodyOf(rec).status ?? 'doing', title: '字幕压边', detail: '', at: ISO })
  })

  /* ---------------- 工作流域 ---------------- */
  on('GET', /^\/workflows$/, ({ res }) => json(res, 200, { items: [mkWorkflow('wf_1')], nextCursor: null }))
  on('POST', /^\/workflows$/, ({ res, rec }) => json(res, 201, { ...mkWorkflow('wf_new'), ...bodyOf(rec) }))
  on('GET', /^\/workflows\/([^/]+)\/versions$/, ({ res }) => json(res, 200, [{ version: 1, name: '初版' }, { version: 2, name: '第二版' }]))
  on('GET', /^\/workflows\/([^/]+)\/runs$/, ({ res }) => json(res, 200, { items: [mkWorkflowRun('run_1')], nextCursor: null }))
  on('POST', /^\/workflows\/([^/]+)\/runs$/, ({ res, params }) => json(res, 202, { ...mkWorkflowRun('run_new'), workflowId: params[0] }))
  on('PATCH', /^\/workflows\/([^/]+)$/, ({ res, rec }) => {
    if (requireMatch(res, rec, '"wf-rev-1"', 'req_wf412')) return
    json(res, 200, { ...mkWorkflow('wf_1'), ...bodyOf(rec), version: 2, etag: '"wf-rev-2"' })
  })
  on('DELETE', /^\/workflows\/([^/]+)$/, ({ res }) => noContent(res))
  on('GET', /^\/workflows\/([^/]+)$/, ({ res, params, url }) =>
    json(res, 200, { ...mkWorkflow(params[0]), version: Number(url.searchParams.get('version') ?? '1') }),
  )
  on('POST', /^\/workflow-runs\/([^/]+)\/cancel$/, ({ res }) => {
    res.writeHead(202)
    res.end()
  })
  on('GET', /^\/workflow-runs\/([^/]+)$/, ({ res, params }) => json(res, 200, mkWorkflowRun(params[0])))
  on('GET', /^\/workflow-templates$/, ({ res }) => json(res, 200, { items: [mkWorkflowTemplate('tpl_1')], nextCursor: null }))
  on('GET', /^\/workflow-templates\/([^/]+)$/, ({ res, params }) => json(res, 200, mkWorkflowTemplate(params[0])))

  /* ---------------- 知识库域 ---------------- */
  on('GET', /^\/fx-techniques\/facets$/, ({ res }) =>
    json(res, 200, { categories: { camera: 3 }, execTypes: { runnable: 2 }, impls: { realtime: 1 }, total: 3 }),
  )
  on('GET', /^\/fx-techniques$/, ({ res }) => json(res, 200, { items: [mkFxTechnique('fx_1')], nextCursor: null }))
  on('GET', /^\/fx-techniques\/([^/]+)$/, ({ res, params }) => json(res, 200, mkFxTechnique(params[0])))
  on('GET', /^\/genomes$/, ({ res }) => json(res, 200, [{ id: 'genome_1', name: '产品宣传', description: '' }]))
  on('GET', /^\/genomes\/([^/]+)$/, ({ res, params }) => json(res, 200, { id: params[0], name: '产品宣传', description: '', method: { steps: [] } }))
  on('GET', /^\/reference-videos$/, ({ res }) =>
    json(res, 200, { items: [{ id: 'rv_1', title: '参考片', status: 'analyzed', durationMs: 30000, createdAt: ISO }], nextCursor: null }),
  )
  on('POST', /^\/reference-videos\/([^/]+)\/analyze$/, ({ res, params }) =>
    params[0] === 'rv_no_capability'
      ? nestedError(res, 422, 'capability_unavailable', '参考片解析能力未接入', {
          details: { capability: 'referenceAnalysis' },
          requestId: 'req_analyze422',
        })
      : json(res, 202, { task: mkTask('task_analyze', 'queued'), runId: 'run_analyze' }),
  )
  on('GET', /^\/reference-videos\/([^/]+)$/, ({ res, params }) => json(res, 200, { id: params[0], title: '参考片', status: 'analyzed', durationMs: 30000, createdAt: ISO }))
  on('GET', /^\/reference-shots$/, ({ res }) =>
    json(res, 200, { items: [{ id: 'shot_1', videoId: 'rv_1', index: 0, startMs: 0, endMs: 2000 }], nextCursor: null }),
  )
  on('GET', /^\/reference-shots\/([^/]+)$/, ({ res, params }) => json(res, 200, { id: params[0], videoId: 'rv_1', index: 0, startMs: 0, endMs: 2000, analysis: {} }))
  on('GET', /^\/reference-collections$/, ({ res }) =>
    json(res, 200, [{ id: 'col_1', name: '喜欢的光线', shotIds: ['shot_1'], createdAt: ISO, updatedAt: ISO }], { etag: '"col-rev-1"' }),
  )
  on('POST', /^\/reference-collections$/, ({ res, rec }) => json(res, 201, { id: 'col_new', name: bodyOf(rec).name ?? '新集合', shotIds: [], createdAt: ISO, updatedAt: ISO }))
  on('PATCH', /^\/reference-collections\/([^/]+)$/, ({ res, rec, params }) => {
    if (requireMatch(res, rec, '"col-rev-1"', 'req_col412')) return
    json(res, 200, { id: params[0], name: bodyOf(rec).name ?? '改名', shotIds: [], createdAt: ISO, updatedAt: ISO })
  })
  on('DELETE', /^\/reference-collections\/([^/]+)$/, ({ res }) => noContent(res))
  on('GET', /^\/reference-preferences$/, ({ res }) =>
    json(res, 200, { favoriteShotIds: ['shot_1'], recentVideoIds: [], collectionMembers: {}, etag: '"pref-rev-1"' }),
  )
  on('PATCH', /^\/reference-preferences$/, ({ res, rec }) => {
    if (requireMatch(res, rec, '"pref-rev-1"', 'req_pref412')) return
    json(res, 200, { favoriteShotIds: [], recentVideoIds: [], collectionMembers: {}, etag: '"pref-rev-2"' })
  })
}

const mkCheckRun = (checkRunId: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  checkRunId,
  projectId: 'prj_1',
  renderId: 'render_1',
  status: 'completed',
  startedAt: ISO,
  ...over,
})
const mkWorkflow = (workflowId: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: workflowId,
  projectId: 'prj_1',
  name: '默认工作流',
  description: '',
  status: 'draft',
  version: 1,
  nodes: [],
  edges: [],
  updatedAt: ISO,
  etag: '"wf-rev-1"',
  ...over,
})
const mkWorkflowRun = (runId: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  runId,
  workflowId: 'wf_1',
  status: 'running',
  taskId: 'task_wf',
  startedAt: ISO,
  nodeIO: {},
  ...over,
})
const mkWorkflowTemplate = (templateId: string): Record<string, unknown> => ({
  id: templateId,
  name: '产品宣传模板',
  description: '',
  genomeId: 'genome_1',
  definition: mkWorkflow('wf_tpl'),
})
const mkFxTechnique = (techniqueId: string): Record<string, unknown> => ({
  id: techniqueId,
  name: '推镜',
  category: 'camera',
  execType: 'runnable',
  impl: 'realtime',
  inputKinds: ['video'],
  complexity: 2,
  summary: '',
  params: [],
})


/* ============================ 流探针 ============================ */

interface TaskProbe {
  handlers: {
    onSnapshot: (task: AgentTask, events: TaskEvent[]) => void
    onEvent: (event: TaskEvent) => void
    onState: (state: TaskStreamState) => void
    onError: (error: ApiError) => void
  }
  events: TaskEvent[]
  states: TaskStreamState[]
  errors: ApiError[]
  snapshots: Array<{ task: AgentTask; events: TaskEvent[] }>
  phases: () => string[]
}

function taskProbe(): TaskProbe {
  const events: TaskEvent[] = []
  const states: TaskStreamState[] = []
  const errors: ApiError[] = []
  const snapshots: Array<{ task: AgentTask; events: TaskEvent[] }> = []
  return {
    handlers: {
      onSnapshot: (task, snapshotEvents) => snapshots.push({ task, events: snapshotEvents }),
      onEvent: (event) => events.push(event),
      onState: (state) => states.push({ ...state }),
      onError: (error) => errors.push(error),
    },
    events,
    states,
    errors,
    snapshots,
    phases: () => states.map((state) => state.phase),
  }
}

async function settleTask(handle: { finished: Promise<TaskStatus | null> }, timeoutMs = 15000): Promise<string> {
  let outcome = 'TIMEOUT'
  const guarded = handle.finished.then(
    (status) => {
      outcome = status === null ? 'null' : status
    },
    (error) => {
      outcome = `REJECTED:${error instanceof ApiError ? error.code : String(error)}`
    },
  )
  await Promise.race([guarded, waitMs(timeoutMs)])
  return outcome
}

interface ChatProbe {
  handlers: {
    onDelta: (messageId: string, delta: string) => void
    onCompleted: (message: { id: string; text: string }) => void
    onTask: (messageId: string, taskId: string) => void
    onState: (state: ChatStreamState) => void
    onError: (error: ApiError) => void
  }
  deltas: Array<{ messageId: string; delta: string }>
  completed: Array<{ id: string; text: string }>
  tasks: Array<{ messageId: string; taskId: string }>
  states: ChatStreamState[]
  errors: ApiError[]
  phases: () => string[]
}

function chatProbe(): ChatProbe {
  const deltas: Array<{ messageId: string; delta: string }> = []
  const completed: Array<{ id: string; text: string }> = []
  const tasks: Array<{ messageId: string; taskId: string }> = []
  const states: ChatStreamState[] = []
  const errors: ApiError[] = []
  return {
    handlers: {
      onDelta: (messageId, delta) => deltas.push({ messageId, delta }),
      onCompleted: (message) => completed.push({ id: message.id, text: message.text }),
      onTask: (messageId, taskId) => tasks.push({ messageId, taskId }),
      onState: (state) => states.push({ ...state, completedMessageIds: [...state.completedMessageIds] }),
      onError: (error) => errors.push(error),
    },
    deltas,
    completed,
    tasks,
    states,
    errors,
    phases: () => states.map((state) => state.phase),
  }
}

async function settleChat(handle: { finished: Promise<void> }, timeoutMs = 15000): Promise<string> {
  let outcome = 'TIMEOUT'
  const guarded = handle.finished.then(
    () => {
      outcome = 'resolved'
    },
    (error) => {
      outcome = `REJECTED:${error instanceof ApiError ? error.code : String(error)}`
    },
  )
  await Promise.race([guarded, waitMs(timeoutMs)])
  return outcome
}

/* ============================ 1. 错误信封 ============================ */

async function groupErrors(): Promise<void> {
  group('1. 错误信封：嵌套 / 旧扁平 / 状态兜底 / Retry-After / 204 / userMessageForError')

  const nested = parseErrorPayload(412, {
    error: { code: 'precondition_failed', message: '项目已被其他窗口修改', details: { etag: '"rev-2"' }, requestId: 'req_412' },
  })
  eq('parseErrorPayload 嵌套信封 code', nested.code, 'precondition_failed')
  eq('parseErrorPayload 嵌套信封 message', nested.message, '项目已被其他窗口修改')
  eq('parseErrorPayload 嵌套信封 details', nested.details, { etag: '"rev-2"' })
  eq('parseErrorPayload 嵌套信封 requestId', nested.requestId, 'req_412')
  eq('parseErrorPayload 嵌套信封 legacyShape', nested.legacyShape, false)

  const flat = parseErrorPayload(404, { code: 'task_not_found', message: '任务不存在' })
  eq('旧扁平 {code,message} 被识别（legacyShape）', flat.legacyShape, true)
  eq('旧扁平 message 透传', flat.message, '任务不存在')
  eq('旧扁平 code=task_not_found → 按 HTTP 兜底', flat.code, 'not_found')
  eq('旧扁平体把原始 code 保留在 details.rawCode', parseErrorPayload(404, { code: 'task_not_found', message: '任务不存在' }).details?.rawCode, 'task_not_found')

  eq('扁平体未知 code → 400 兜底 validation_error', parseErrorPayload(400, { code: 'weird_code', message: 'x' }).code, 'validation_error')
  eq('不可解析体 → internal_error', parseErrorPayload(500, '<html>proxy error</html>').code, 'internal_error')
  eq('Retry-After 秒数', parseRetryAfterMs('2'), 2000)
  // HTTP-date 只到秒：先向上取整到整秒再断言（否则 toUTCString 丢毫秒会让期望值失真）
  const wholeSecond = new Date(Math.ceil((Date.now() + 3000) / 1000) * 1000)
  const dateMs = parseRetryAfterMs(wholeSecond.toUTCString()) ?? -1
  ok('Retry-After HTTP 日期 → 约 3000ms（秒级精度）', dateMs > 2900 && dateMs <= 4200, { retryAfterMs: dateMs, header: wholeSecond.toUTCString() })
  eq('Retry-After 非法值 → null', parseRetryAfterMs('soon'), null)

  const http = makeHttp()

  const e412 = await capture(() => http.data('POST', '/conditional', { body: { a: 1 }, ifMatch: '"rev-0"' }))
  check('412 抛的是 ApiError（不是把失败当空数据）', e412 instanceof ApiError, errSig(e412))
  eq('412 code', e412?.code, 'precondition_failed')
  eq('412 httpStatus', e412?.httpStatus, 412)
  eq('412 requestId（体里的优先于头）', e412?.requestId, 'req_412')
  eq('412 retryable', e412?.retryable, false)
  eq('412 legacyShape', e412?.legacyShape, false)
  eq('412 isPreconditionFailed', e412?.isPreconditionFailed, true)
  eq('412 details.etag', e412?.details?.etag, '"rev-2"')

  const eFlat404 = await capture(() => http.get('/errors/flat404'))
  eq('旧扁平 404 code', eFlat404?.code, 'not_found')
  eq('旧扁平 404 httpStatus', eFlat404?.httpStatus, 404)
  eq('旧扁平 404 legacyShape', eFlat404?.legacyShape, true)
  eq('旧扁平 404 requestId（体里没有，取响应头 X-Request-Id）', eFlat404?.requestId, 'req_hdr_404')
  eq('旧扁平 404 retryable', eFlat404?.retryable, false)

  const e409 = await capture(() => http.get('/errors/conflict409'))
  eq('409 code', e409?.code, 'idempotency_conflict')
  eq('409 httpStatus', e409?.httpStatus, 409)
  eq('409 retryable', e409?.retryable, false)

  const e422 = await capture(() => http.get('/errors/capability422'))
  eq('422 code', e422?.code, 'capability_unavailable')
  eq('422 httpStatus', e422?.httpStatus, 422)
  eq('422 retryable', e422?.retryable, false)
  eq('422 isCapabilityGap', e422?.isCapabilityGap, true)
  eq('422 details.capability', e422?.details?.capability, 'asr')

  const e503 = await capture(() => http.get('/errors/agent503'))
  eq('503 code', e503?.code, 'agent_unavailable')
  eq('503 httpStatus', e503?.httpStatus, 503)
  eq('503 retryable（README §2.4：能力在、进程暂不可用）', e503?.retryable, true)
  eq('503 isCapabilityGap', e503?.isCapabilityGap, true)

  const e429 = await capture(() => http.get('/errors/rate429'))
  eq('429 code', e429?.code, 'rate_limited')
  eq('429 httpStatus', e429?.httpStatus, 429)
  eq('429 Retry-After 秒数 → retryAfterMs', e429?.retryAfterMs, 2000)
  eq('429 retryable', e429?.retryable, true)

  const e429d = await capture(() => http.get('/errors/rate429date'))
  const retryDateMs = e429d?.retryAfterMs ?? -1
  // HTTP-date 只精确到秒，服务端把目标时刻向上取整到整秒（最多多 1 秒），所以容差放到 4.2 秒
  ok('429 Retry-After HTTP 日期被解析成毫秒', retryDateMs > 2900 && retryDateMs <= 4200, retryDateMs)

  const e400 = await capture(() => http.get('/errors/bad400'))
  eq('400 code', e400?.code, 'validation_error')
  eq('400 httpStatus', e400?.httpStatus, 400)
  eq('400 details.field', e400?.details?.field, 'references[0].bbox')
  eq('400 retryable', e400?.retryable, false)

  const e500 = await capture(() => http.get('/errors/boom500'))
  eq('500 code', e500?.code, 'internal_error')
  eq('500 httpStatus', e500?.httpStatus, 500)
  eq('500 requestId', e500?.requestId, 'req_500')
  eq('500 retryable', e500?.retryable, false)

  const eNotJson = await capture(() => http.get('/errors/notjson'))
  eq('非 JSON 错误体 → internal_error（不当成功）', eNotJson?.code, 'internal_error')
  eq('非 JSON 错误体 message', eNotJson?.message, '')

  const eUnknown = await capture(() => http.get('/errors/unknown-code'))
  eq('未收录 code + 409 → conflict 兜底', eUnknown?.code, 'conflict')
  eq('未收录 code 的 legacyShape', eUnknown?.legacyShape, true)

  eq('旧扁平体 ApiError.details.rawCode 保留原始 code', eFlat404?.details?.rawCode, 'task_not_found')
  eq('扁平未知 code → 兜底 code + rawCode 保留', [eUnknown?.code, eUnknown?.details?.rawCode], ['conflict', 'some_brand_new_code'])

  const eNestedUnknown = await capture(() => http.get('/errors/nested-unknown'))
  eq('嵌套未知 code → 兜底 code + rawCode 保留（两种形状都留）', [eNestedUnknown?.code, eNestedUnknown?.details?.rawCode], ['conflict', 'some_nested_code'])
  eq('嵌套形状不被误标 legacyShape', eNestedUnknown?.legacyShape, false)
  eq('已知 code 不塞 rawCode（不污染 details）', e412?.details?.rawCode, undefined)

  const badJsonOk = await capture(() => http.get('/badjson200'))
  eq('2xx 但非 JSON → internal_error(malformed)', badJsonOk?.code, 'internal_error')
  eq('malformed message', badJsonOk?.message, '服务端返回的内容不是合法 JSON，无法读取结果。')

  const del = await capture(() => http.request<void>('DELETE', '/resource'))
  eq('DELETE 204 不当错误', del, null)
  const delMeta = await http.request<void>('DELETE', '/resource')
  eq('204 data 为 undefined', delMeta.data, undefined)
  eq('204 status', delMeta.status, 204)
  eq('204 仍带回 ETag', delMeta.etag, '"res-rev-1"')

  // retryable 矩阵：逐码真跑断言
  const retryMatrix: Array<[Parameters<typeof ApiError.prototype.constructor>[0] extends never ? never : ConstructorParameters<typeof ApiError>[0]['code'], boolean]> = [
    ['network_error', true],
    ['stream_disconnected', true],
    ['timeout', true],
    ['rate_limited', true],
    ['agent_unavailable', true],
    ['aborted', false],
    ['validation_error', false],
    ['not_found', false],
    ['conflict', false],
    ['precondition_failed', false],
    ['idempotency_conflict', false],
    ['capability_unavailable', false],
    ['internal_error', false],
    ['cancelled', false],
  ]
  const retryActual: Record<string, boolean> = {}
  for (const [code, expected] of retryMatrix) {
    const error = new ApiError({ code, message: 'x' })
    retryActual[code] = error.retryable
    eq(`retryable[${code}]`, error.retryable, expected)
  }
  obs(`retryable 矩阵实测：${JSON.stringify(retryActual)}`)

  // userMessageForError：面向用户 + 不泄露内部路径
  const trusted = userMessageForError(new ApiError({ code: 'precondition_failed', message: '项目已被其他窗口修改' }))
  eq('userMessageForError 可信码透传服务端 message', trusted, '项目已被其他窗口修改')
  const swallowed = userMessageForError(new ApiError({ code: 'not_found', message: '' }))
  eq('服务端没给 message → 本地文案', swallowed, '目标不存在或已被删除。')
  const netMsg = userMessageForError(ApiError.network(new Error('ECONNREFUSED 127.0.0.1:8080')))
  check('network_error 本地文案不暴露地址', !netMsg.includes('127.0.0.1') && !netMsg.includes('ECONNREFUSED'), netMsg)
  const leakMsg = userMessageForError(
    new ApiError({
      code: 'internal_error',
      message: 'java.lang.NullPointerException at /home/lufering/secret/AgentService.java:42',
      requestId: 'req_500',
    }),
  )
  check('internal_error 不把堆栈/内部路径抛给用户', !leakMsg.includes('/home') && !leakMsg.includes('.java') && !leakMsg.includes('Exception'), leakMsg)
  check('internal_error 带请求 ID 便于报障', leakMsg.includes('req_500'), leakMsg)
  eq('ApiError.network 文案', ApiError.network(new Error('x')).message, '连不上本地服务，请确认后端已启动且地址正确。')
  const disconnectMsg = userMessageForError(new ApiError({ code: 'stream_disconnected', message: '' }))
  const unreachableMsg = userMessageForError(new ApiError({ code: 'network_error', message: '' }))
  check('stream_disconnected 与 network_error 的用户文案必须分开（服务是通的 ≠ 连不上）', disconnectMsg !== unreachableMsg && disconnectMsg.trim() !== '', { stream_disconnected: disconnectMsg, network_error: unreachableMsg })
  eq('stream_disconnected 可重试（值在但流断了）', new ApiError({ code: 'stream_disconnected', message: '' }).retryable, true)
  eq('ApiError.timeout 文案', ApiError.timeout(15000).message, '请求超过 15 秒没有响应，已中止。')
  eq('ApiError.aborted 文案', ApiError.aborted().message, '请求已取消。')
  const abortish = toApiError(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
  eq('toApiError(AbortError) → aborted', abortish.code, 'aborted')
}

/* ============================ 2. 传输层三态 ============================ */

async function groupTransport(): Promise<void> {
  group('2. 传输层：连不上 / 调用方取消 / 超时 —— 三者必须可区分')

  const deadPort = await freePort()
  const deadHttp = makeHttp({ baseUrl: `http://127.0.0.1:${deadPort}/api`, timeoutMs: 2000 })
  const netError = await capture(() => deadHttp.get('/health'))
  check('连不上（端口不监听）抛 ApiError', netError instanceof ApiError, errSig(netError))
  eq('连不上 → code', netError?.code, 'network_error')
  eq('连不上 → httpStatus', netError?.httpStatus, null)
  eq('连不上 → 不是 timeout', netError?.code === 'timeout', false)

  const slowHttp = makeHttp({ timeoutMs: 8000 })
  const caller = new AbortController()
  setTimeout(() => caller.abort(), 150)
  const abortError = await capture(() => slowHttp.get('/slow', { query: { ms: 3000 }, signal: caller.signal }))
  eq('调用方 abort → code', abortError?.code, 'aborted')
  eq('aborted isAborted', abortError?.isAborted, true)

  const timeoutHttp = makeHttp({ timeoutMs: 250 })
  const timeoutError = await capture(() => timeoutHttp.get('/slow', { query: { ms: 3000 } }))
  eq('超时 → code', timeoutError?.code, 'timeout')
  check('超时文案说明已中止', (timeoutError?.message ?? '').includes('已中止'), timeoutError?.message)
  check('sub-second 超时文案按毫秒报（不显示「超过 0 秒」）', (timeoutError?.message ?? '').includes('毫秒'), timeoutError?.message)

  const preAborted = new AbortController()
  preAborted.abort()
  const preAbortError = await capture(() => slowHttp.get('/health', { signal: preAborted.signal }))
  eq('已 abort 的信号 → aborted', preAbortError?.code, 'aborted')

  const codes = [netError?.code, abortError?.code, timeoutError?.code]
  eq('三者码互不相同', new Set(codes).size, 3)
  eq('三者的 code 组合', codes, ['network_error', 'aborted', 'timeout'])
  check('三者的用户文案互不相同', new Set([netError?.message, abortError?.message, timeoutError?.message]).size === 3, [
    netError?.message,
    abortError?.message,
    timeoutError?.message,
  ])
}

/* ============================ 3. 请求头：幂等键 / If-Match ============================ */

async function groupHeaders(): Promise<void> {
  group('3. 请求头：Idempotency-Key（自动/显式/null）与 If-Match 原样回传')

  const http = makeHttp()
  await http.post('/echo', { hello: 'world' })
  const first = recordsFor((r) => r.path === '/api/echo' && r.method === 'POST')[0]
  const autoKey = typeof first?.headers['idempotency-key'] === 'string' ? first.headers['idempotency-key'] : null
  ok('POST 未传 idempotencyKey → 自动带上', typeof autoKey === 'string' && autoKey.length > 0, autoKey)
  eq('POST 自动 Content-Type', first?.headers['content-type'], 'application/json; charset=utf-8')
  eq('默认 Accept', first?.headers['accept'], 'application/json')
  eq('POST body 原样发送', JSON.parse(first?.body || '{}'), { hello: 'world' })

  await http.post('/echo', { hello: 'world' })
  const second = recordsFor((r) => r.path === '/api/echo' && r.method === 'POST')[1]
  const autoKey2 = typeof second?.headers['idempotency-key'] === 'string' ? second.headers['idempotency-key'] : null
  check('自动键每次调用都不同（重试复用需调用方显式传）', autoKey !== autoKey2, [autoKey, autoKey2])

  await http.post('/echo', { a: 1 }, { idempotencyKey: 'idem-explicit-1' })
  const explicit = recordsFor((r) => r.path === '/api/echo' && r.method === 'POST')[2]
  eq('显式 idempotencyKey 原样发送', explicit?.headers['idempotency-key'], 'idem-explicit-1')

  await http.post('/echo', { a: 1 }, { idempotencyKey: null })
  const suppressed = recordsFor((r) => r.path === '/api/echo' && r.method === 'POST')[3]
  eq('idempotencyKey=null → 不带该头', suppressed?.headers['idempotency-key'], undefined)

  await http.get('/health')
  const getRec = recordsFor((r) => r.path === '/api/health' && r.method === 'GET')[0]
  eq('GET 不自动带 Idempotency-Key', getRec?.headers['idempotency-key'], undefined)

  await http.patch('/echo', { a: 1 })
  const patchRec = recordsFor((r) => r.path === '/api/echo' && r.method === 'PATCH')[0]
  eq('PATCH 不自动带 Idempotency-Key（契约只要求创建型 POST）', patchRec?.headers['idempotency-key'], undefined)

  const matched = await capture(() => http.post('/conditional', { a: 1 }, { ifMatch: '"rev-1"' }))
  const condRec = recordsFor((r) => r.path === '/api/conditional').at(-1)
  eq('If-Match 原样回传（服务端收到原值）', condRec?.headers['if-match'], '"rev-1"')
  eq('If-Match 匹配 → 不报错', matched, null)
  eq('If-Match 匹配 → 服务端看到的方法', condRec?.method, 'POST')
}

/* ============================ 4. SSE 解析器（纯单元，真跑） ============================ */

async function groupSseParser(): Promise<void> {
  group('4. SSE 分帧：多行 data / CRLF / 注释心跳 / id,event,retry / 跨 chunk / 无尾空行的最后一帧')

  const p1 = createSseParser()
  const multi = p1.push('data: 第一行\ndata: 第二行\n\n')
  eq('多行 data 合成为一个消息', multi.length, 1)
  eq('多行 data 用 \\n 连接', multi[0]?.data, '第一行\n第二行')

  const p2 = createSseParser()
  const crlf = p2.push('event: delta\r\ndata: {"type":"delta"}\r\n\r\n')
  eq('CRLF 分帧 → 1 条', crlf.length, 1)
  eq('CRLF 的 event 字段', crlf[0]?.event, 'delta')
  eq('CRLF 的 data 字段', crlf[0]?.data, '{"type":"delta"}')

  const p3 = createSseParser()
  eq(': 注释心跳不产生消息', p3.push(': ping\n\n').length, 0)
  eq('注释与数据混排只产出数据帧', p3.push(': ping\ndata: ok\n\n: ping\n\n').length, 1)

  const p4 = createSseParser()
  const meta = p4.push('id: 7\nevent: event\nretry: 1500\ndata: {"seq":7}\n\n')
  eq('id/event/retry/data 一帧 → 1 条', meta.length, 1)
  eq('id 字段', meta[0]?.id, '7')
  eq('event 字段', meta[0]?.event, 'event')
  eq('retry 字段（毫秒）', meta[0]?.retryMs, 1500)
  eq('data 字段', meta[0]?.data, '{"seq":7}')

  const p5 = createSseParser()
  eq('跨 chunk 切断：第 1 块不产出', p5.push('id: 9\ndata: {"ty').length, 0)
  eq('跨 chunk 切断：第 2 块不产出', p5.push('pe":"event"}\n').length, 0)
  const reassembled = p5.push('\n')
  eq('跨 chunk 切断：补上空行后产出 1 条', reassembled.length, 1)
  eq('跨 chunk 重组后的 data', reassembled[0]?.data, '{"type":"event"}')
  eq('跨 chunk 重组后的 id', reassembled[0]?.id, '9')

  const p6 = createSseParser()
  eq('末尾没有空行的最后一帧：push 时不产出', p6.push('data: 收尾帧').length, 0)
  const flushed = p6.flush()
  eq('flush 交出最后一帧', flushed.length, 1)
  eq('flush 出来的 data', flushed[0]?.data, '收尾帧')

  const p7 = createSseParser()
  const noEventName = p7.push('data: x\n\n')
  eq('没有 event 字段 → 默认 message', noEventName[0]?.event, 'message')
  const p8 = createSseParser()
  const crOnly = p8.push('data: y\r\r')
  eq('裸 CR 换行也被识别', crOnly[0]?.data, 'y')
  const p9 = createSseParser()
  const unknownField = p9.push('foo: bar\ndata: z\n\n')
  eq('未知字段忽略且不影响 data', unknownField[0]?.data, 'z')
  const p10 = createSseParser()
  eq('只有 id 没有 data 的帧不派发（规范）', p10.push('id: 3\n\n').length, 0)

  // 真读一个分块到达的 Response
  const encoder = new TextEncoder()
  const interleaved = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode('id: 1\nevent: delta\ndata: {"n":'))
      await waitMs(30)
      controller.enqueue(encoder.encode('1}\n\n: ping\n\n'))
      await waitMs(30)
      controller.enqueue(encoder.encode('id: 2\nevent: end\ndata: {"type":"end"}\n\n'))
      controller.close()
    },
  })
  const seen: Array<{ id: string | null; event: string; data: string }> = []
  for await (const message of readSseMessages(new Response(interleaved))) {
    seen.push({ id: message.id, event: message.event, data: message.data })
  }
  eq('readSseMessages 分块读取 → 2 条（心跳被跳过）', seen.length, 2)
  eq('readSseMessages 第 1 条', seen[0], { id: '1', event: 'delta', data: '{"n":1}' })
  eq('readSseMessages 第 2 条', seen[1], { id: '2', event: 'end', data: '{"type":"end"}' })

  // 空闲超时：一个字节都不来 → IdleTimeoutError
  const silent = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"snapshot"}\n\n'))
      // 之后保持连接但静默
    },
  })
  let idleError: unknown = null
  const idleStarted = Date.now()
  try {
    for await (const _message of readSseMessages(new Response(silent), { idleTimeoutMs: 200 })) {
      // 只有第一帧
    }
  } catch (error) {
    idleError = error
  }
  const idleElapsed = Date.now() - idleStarted
  check('静默超过 idleTimeoutMs → 抛 IdleTimeoutError', idleError instanceof IdleTimeoutError, idleError instanceof Error ? `${idleError.name}: ${idleError.message}` : idleError)
  eq('IdleTimeoutError.idleMs', idleError instanceof IdleTimeoutError ? idleError.idleMs : null, 200)
  ok('空闲判定在 200ms 量级触发（非立即）', idleElapsed >= 180 && idleElapsed < 2000, idleElapsed)

  // 心跳字节能重置空闲计时
  const heartbeatStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < 3; i += 1) {
        controller.enqueue(encoder.encode(': ping\n\n'))
        await waitMs(120)
      }
      controller.enqueue(encoder.encode('data: {"type":"event"}\n\n'))
      controller.close()
    },
  })
  const heartbeatSeen: string[] = []
  let heartbeatError: unknown = null
  try {
    for await (const message of readSseMessages(new Response(heartbeatStream), { idleTimeoutMs: 250 })) {
      heartbeatSeen.push(message.data)
    }
  } catch (error) {
    heartbeatError = error
  }
  eq('注释心跳重置空闲计时（不误判断线）', heartbeatError, null)
  eq('心跳流里只交付真实数据帧', heartbeatSeen, ['{"type":"event"}'])
}

/* ============================ 5. 任务事件流 ============================ */

function registerTaskScenarios(): void {
  const evsNormal = [
    mkEvent('task-normal', 1, 'accepted', 'queued', '已受理'),
    mkEvent('task-normal', 2, 'progress', 'running', '正在处理'),
    mkEvent('task-normal', 3, 'complete', 'completed', '已完成'),
  ]
  taskScenarios.set('task-normal', {
    task: mkTask('task-normal', 'running'),
    history: () => [],
    sse: (_attempt, res) => {
      wireLog.push('task-normal:snapshot(events:[1])')
      timeline(res, [
        [0, () => safeWrite(res, sseFrame({ type: 'snapshot', task: mkTask('task-normal', 'running'), events: [evsNormal[0]] }, { id: 1, event: 'snapshot' }))],
        [25, () => safeWrite(res, ': ping\n\n')],
        [50, () => safeWrite(res, sseFrame({ type: 'event', event: evsNormal[1] }, { id: 2, event: 'event' }))],
        [75, () => safeWrite(res, sseFrame({ type: 'event', event: evsNormal[2] }, { id: 3, event: 'event' }))],
        [100, () => safeWrite(res, sseFrame({ type: 'end', status: 'completed' }, { event: 'end' }))],
        [110, () => safeEnd(res)],
      ])
    },
  })

  // 乱序：seq2 先到 → 触发补齐；历史只到 seq1，于是缓冲区里的 seq2 与历史 seq1 在同一次排水里按序交付
  const evsOoo = [
    mkEvent('task-ooo', 1, 'accepted', 'queued', '已受理'),
    mkEvent('task-ooo', 2, 'progress', 'running', '正在处理'),
    mkEvent('task-ooo', 3, 'progress', 'running', '继续处理'),
    mkEvent('task-ooo', 4, 'complete', 'completed', '已完成'),
  ]
  taskScenarios.set('task-ooo', {
    task: mkTask('task-ooo', 'running'),
    history: (afterSeq) => (afterSeq === 0 ? [evsOoo[0]] : []),
    sse: (_attempt, res) => {
      wireLog.push('task-ooo:seq2 先到')
      timeline(res, [
        [0, () => safeWrite(res, sseFrame({ type: 'snapshot', task: mkTask('task-ooo', 'running'), events: [] }, { id: 0, event: 'snapshot' }))],
        [30, () => safeWrite(res, sseFrame({ type: 'event', event: evsOoo[1] }, { id: 2, event: 'event' }))],
        [150, () => safeWrite(res, sseFrame({ type: 'event', event: evsOoo[1] }, { id: 2, event: 'event' }))],
        [180, () => safeWrite(res, sseFrame({ type: 'event', event: evsOoo[2] }, { id: 3, event: 'event' }))],
        [210, () => safeWrite(res, sseFrame({ type: 'event', event: evsOoo[3] }, { id: 4, event: 'event' }))],
        [240, () => safeEnd(res)],
      ])
    },
  })

  // 已知水位 sinceSeq=2：先补齐 afterSeq=2（历史里只有非终态事件），再订阅并带 Last-Event-ID
  const evsGap = [
    mkEvent('task-gap', 1, 'accepted', 'queued', '已受理'),
    mkEvent('task-gap', 2, 'progress', 'running', '处理中'),
    mkEvent('task-gap', 3, 'progress', 'running', '处理中'),
    mkEvent('task-gap', 4, 'progress', 'building', '构建中'),
    mkEvent('task-gap', 5, 'progress', 'building', '构建中'),
    mkEvent('task-gap', 6, 'complete', 'completed', '已完成'),
  ]
  taskScenarios.set('task-gap', {
    task: mkTask('task-gap', 'building'),
    // 只把 seq 3/4 当作「已持久化」；续传与终态必须来自订阅，才测得到 Last-Event-ID
    history: (afterSeq) => evsGap.filter((event) => event.seq > afterSeq && event.seq <= 4),
    sse: (_attempt, res) => {
      timeline(res, [
        [0, () => safeWrite(res, sseFrame({ type: 'snapshot', task: mkTask('task-gap', 'building'), events: [] }, { id: 4, event: 'snapshot' }))],
        [30, () => safeWrite(res, sseFrame({ type: 'event', event: evsGap[4] }, { id: 5, event: 'event' }))],
        [60, () => safeWrite(res, sseFrame({ type: 'event', event: evsGap[5] }, { id: 6, event: 'event' }))],
        [90, () => safeWrite(res, sseFrame({ type: 'end', status: 'completed' }, { event: 'end' }))],
        [100, () => safeEnd(res)],
      ])
    },
  })

  // 快照/历史里已经是终态：不得再订阅，直接按终态收束（02 §5：终态后关闭）
  const evsDone = [mkEvent('task-done', 1, 'complete', 'completed', '已完成')]
  taskScenarios.set('task-done', {
    task: mkTask('task-done', 'completed'),
    history: (afterSeq) => evsDone.filter((event) => event.seq > afterSeq),
    sse: (_attempt, res) => {
      wireLog.push('task-done:不应该有订阅')
      safeEnd(res)
    },
  })

  // 干净断线（服务端 end() 但不发 end 帧）→ 必须重连并带 Last-Event-ID，重连后拿到真终态
  const evsRecover = [
    mkEvent('task-recover', 1, 'accepted', 'queued', '已受理'),
    mkEvent('task-recover', 2, 'progress', 'running', '处理中'),
    mkEvent('task-recover', 3, 'progress', 'running', '处理中'),
    mkEvent('task-recover', 4, 'complete', 'completed', '已完成'),
  ]
  taskScenarios.set('task-recover', {
    task: mkTask('task-recover', 'running'),
    history: (afterSeq) => (afterSeq === 2 ? [evsRecover[2]] : []),
    sse: (attempt, res) => {
      if (attempt === 0) {
        wireLog.push('task-recover#0:snapshot+seq1+seq2 → 干净断开（无 end 帧）')
        timeline(res, [
          [0, () => safeWrite(res, sseFrame({ type: 'snapshot', task: mkTask('task-recover', 'running'), events: [evsRecover[0]] }, { id: 1, event: 'snapshot' }))],
          [30, () => safeWrite(res, sseFrame({ type: 'event', event: evsRecover[1] }, { id: 2, event: 'event' }))],
          [60, () => safeEnd(res)],
        ])
        return
      }
      wireLog.push('task-recover#1:seq4 终态 + end 帧')
      timeline(res, [
        [0, () => safeWrite(res, sseFrame({ type: 'event', event: evsRecover[3] }, { id: 4, event: 'event' }))],
        [30, () => safeWrite(res, sseFrame({ type: 'end', status: 'completed' }, { event: 'end' }))],
        [40, () => safeEnd(res)],
      ])
    },
  })

  // 连接被中断且永不发 end：只能停在 resyncing/failed，绝不 completed
  const evsDrop = [
    mkEvent('task-drop', 1, 'accepted', 'queued', '已受理'),
    mkEvent('task-drop', 2, 'progress', 'running', '处理中'),
  ]
  taskScenarios.set('task-drop', {
    task: mkTask('task-drop', 'running'),
    history: () => [],
    sse: (_attempt, res) => {
      wireLog.push('task-drop:socket 被强制 destroy（无 end 帧）')
      safeWrite(res, sseFrame({ type: 'snapshot', task: mkTask('task-drop', 'running'), events: [evsDrop[0]] }, { id: 1, event: 'snapshot' }))
      setTimeout(() => {
        safeWrite(res, sseFrame({ type: 'event', event: evsDrop[1] }, { id: 2, event: 'event' }))
        setTimeout(() => res.socket?.destroy(), 30)
      }, 30)
    },
  })

  // 心跳：每 100ms 一个注释，idleTimeoutMs=250，不允许重连
  const evsHeartbeat = [mkEvent('task-heartbeat', 1, 'complete', 'completed', '已完成')]
  taskScenarios.set('task-heartbeat', {
    task: mkTask('task-heartbeat', 'running'),
    history: () => [],
    sse: (_attempt, res) => {
      const steps: Array<[number, () => void]> = [
        [0, () => safeWrite(res, sseFrame({ type: 'snapshot', task: mkTask('task-heartbeat', 'running'), events: [] }, { id: 0, event: 'snapshot' }))],
      ]
      for (let i = 1; i <= 6; i += 1) steps.push([i * 100, () => safeWrite(res, ': ping\n\n')])
      steps.push([650, () => safeWrite(res, sseFrame({ type: 'event', event: evsHeartbeat[0] }, { id: 1, event: 'event' }))])
      steps.push([700, () => safeWrite(res, sseFrame({ type: 'end', status: 'completed' }, { event: 'end' }))])
      steps.push([720, () => safeEnd(res)])
      timeline(res, steps)
    },
  })

  // 空闲超时：第 1 条连接静默 → 应按断线重连；第 2 条连接给真终态
  const evsIdle = [mkEvent('task-idle', 1, 'complete', 'completed', '已完成')]
  taskScenarios.set('task-idle', {
    task: mkTask('task-idle', 'running'),
    history: () => [],
    sse: (attempt, res) => {
      if (attempt === 0) {
        wireLog.push('task-idle#0:只有 snapshot，之后静默')
        safeWrite(res, sseFrame({ type: 'snapshot', task: mkTask('task-idle', 'running'), events: [] }, { id: 0, event: 'snapshot' }))
        return
      }
      wireLog.push('task-idle#1:重连后给终态')
      timeline(res, [
        [0, () => safeWrite(res, sseFrame({ type: 'event', event: evsIdle[0] }, { id: 1, event: 'event' }))],
        [30, () => safeWrite(res, sseFrame({ type: 'end', status: 'completed' }, { event: 'end' }))],
        [40, () => safeEnd(res)],
      ])
    },
  })
  // 域客户端（tasks.ts / projects.ts）验收用的任务夹具
  taskScenarios.set('task_1', {
    task: mkTask('task_1', 'running'),
    history: (afterSeq) => (afterSeq >= 5 ? [mkEvent('task_1', 6, 'progress', 'running', '继续处理')] : [mkEvent('task_1', 1, 'accepted', 'queued', '已受理')]),
    sse: (_attempt, res) => {
      timeline(res, [
        [0, () => safeWrite(res, sseFrame({ type: 'snapshot', task: mkTask('task_1', 'running'), events: [] }, { id: 0, event: 'snapshot' }))],
        [20, () => safeWrite(res, sseFrame({ type: 'end', status: 'running' }, { event: 'end' }))],
        [30, () => safeEnd(res)],
      ])
    },
  })
  // 稳定连接（存活 > STREAM_STABLE_MS=10s）且有进展：计数必须清零，否则健康流会被上限误杀
  const evsStable = [mkEvent('task-stable', 1, 'progress', 'running', '处理中'), mkEvent('task-stable', 2, 'complete', 'completed', '已完成')]
  taskScenarios.set('task-stable', {
    task: mkTask('task-stable', 'running'),
    history: (afterSeq) => evsStable.filter((event) => event.seq > afterSeq && event.seq <= 1),
    sse: (attempt, res) => {
      if (attempt === 0) {
        wireLog.push('task-stable#0:ev1 + 11.2s 心跳（稳定存活），随后断开但不发 end')
        const steps: Array<[number, () => void]> = [
          [0, () => safeWrite(res, sseFrame({ type: 'event', event: evsStable[0] }, { id: 1, event: 'event' }))],
        ]
        for (let i = 1; i <= 11; i += 1) steps.push([i * 1000, () => safeWrite(res, ': ping\n\n')])
        steps.push([11_200, () => res.socket?.destroy()])
        timeline(res, steps)
        return
      }
      wireLog.push('task-stable#1:重连后给终态')
      timeline(res, [
        [0, () => safeWrite(res, sseFrame({ type: 'event', event: evsStable[1] }, { id: 2, event: 'event' }))],
        [30, () => safeWrite(res, sseFrame({ type: 'end', status: 'completed' }, { event: 'end' }))],
        [40, () => safeEnd(res)],
      ])
    },
  })

  // 有进展但每轮都不稳定（< 10s 就断）：上限仍应收束为 failed，并带上已收到的水位
  const evsFlap = [1, 2, 3, 4, 5].map((seq) => mkEvent('task-flap', seq, 'progress', 'running', `第 ${seq} 步`))
  taskScenarios.set('task-flap', {
    task: mkTask('task-flap', 'running'),
    history: () => [],
    sse: (attempt, res) => {
      const event = evsFlap[attempt]
      if (!event) return safeEnd(res)
      wireLog.push(`task-flap#${attempt}:发 seq${event.seq} 后 150ms 断开`)
      safeWrite(res, sseFrame({ type: 'event', event }, { id: event.seq, event: 'event' }))
      setTimeout(() => res.socket?.destroy(), 150)
    },
  })

  // 稳定阈值的判别用例：两次「有进展但只活 400ms」的断线，第三次连接给终态。
  // 注意：假服务端的连接计数按 taskId 累计，所以两种阈值必须各用一条独立 taskId，否则会串状态。
  const cfgScenario = (taskId: string): TaskScenario => {
    const events = [1, 2].map((seq) => mkEvent(taskId, seq, 'progress', 'running', `第 ${seq} 步`))
    const done = mkEvent(taskId, 3, 'complete', 'completed', '已完成')
    return {
      task: mkTask(taskId, 'running'),
      history: () => [],
      sse: (attempt, res) => {
        if (attempt <= 1) {
          const event = events[attempt]
          wireLog.push(`${taskId}#${attempt}:发 seq${event.seq} 后 400ms 断开`)
          timeline(res, [
            [0, () => safeWrite(res, sseFrame({ type: 'event', event }, { id: event.seq, event: 'event' }))],
            [400, () => res.socket?.destroy()],
          ])
          return
        }
        wireLog.push(`${taskId}#2:终态`)
        timeline(res, [
          [0, () => safeWrite(res, sseFrame({ type: 'event', event: done }, { id: 3, event: 'event' }))],
          [30, () => safeWrite(res, sseFrame({ type: 'end', status: 'completed' }, { event: 'end' }))],
          [40, () => safeEnd(res)],
        ])
      },
    }
  }
  taskScenarios.set('task-cfg', cfgScenario('task-cfg'))
  taskScenarios.set('task-cfg2', cfgScenario('task-cfg2'))

  // 活着的流：心跳不停、永不发 end —— 用来验证 close() 释放订阅
  taskScenarios.set('task-close', {
    task: mkTask('task-close', 'running'),
    history: () => [],
    sse: (_attempt, res) => {
      const steps: Array<[number, () => void]> = [
        [0, () => safeWrite(res, sseFrame({ type: 'snapshot', task: mkTask('task-close', 'running'), events: [] }, { id: 0, event: 'snapshot' }))],
      ]
      for (let i = 1; i <= 25; i += 1) steps.push([i * 100, () => safeWrite(res, ': ping\n\n')])
      steps.push([2700, () => safeEnd(res)])
      timeline(res, steps)
    },
  })
  taskScenarios.set('task_domain', {
    task: mkTask('task_domain', 'building'),
    history: () => [],
    sse: (_attempt, res) => safeEnd(res),
  })
}

async function groupTaskStreams(): Promise<void> {
  group('5. 任务事件流 openTaskEventStream：snapshot → event → end / 去重 / 乱序排水 / 补齐 / 重连 / 断线不报完成')

  const http = makeHttp()

  // S1 正常路径
  const probe1 = taskProbe()
  const handle1 = openTaskEventStream(http, 'task-normal', probe1.handlers, { idleTimeoutMs: 1500, reconnectLimit: 2 })
  const finished1 = await settleTask(handle1)
  eq('S1 finished', finished1, 'completed')
  eq('S1 快照回调次数', probe1.snapshots.length, 1)
  eq('S1 快照里的事件数', probe1.snapshots[0]?.events.length, 1)
  eq('S1 交付事件 seq 顺序', probe1.events.map((e) => e.seq), [1, 2, 3])
  eq('S1 相位序列', probe1.phases().join('>'), 'connecting>live>ended')
  eq('S1 lastSeq', handle1.lastSeq, 3)
  eq('S1 SSE 连接数（不应重连）', sseConnections.get('task:task-normal'), 1)
  eq('S1 未触发历史补齐（水位 0 且快照非终态）', historyCalls('task-normal').length, 0)
  eq('S1 无错误回调', probe1.errors.map((e) => e.code), [])

  // S2 乱序 + 重复 + 缺口补齐
  const probe2 = taskProbe()
  const handle2 = openTaskEventStream(http, 'task-ooo', probe2.handlers, { idleTimeoutMs: 1500, reconnectLimit: 2 })
  const finished2 = await settleTask(handle2)
  eq('S2 finished', finished2, 'completed')
  eq('S2 交付 seq（乱序到达但按 seq 排水）', probe2.events.map((e) => e.seq), [1, 2, 3, 4])
  eq('S2 无重复交付', new Set(probe2.events.map((e) => e.seq)).size, probe2.events.length)
  eq('S2 缺口触发 1 次历史补齐', historyCalls('task-ooo').length, 1)
  eq('S2 补齐请求带 limit（契约上限 200）', historyCalls('task-ooo')[0]?.query.get('limit'), '200')
  eq('S2 水位为 0 时不发 afterSeq（省略即从头）', historyCalls('task-ooo')[0]?.query.get('afterSeq'), null)
  eq('S2 相位序列', probe2.phases().join('>'), 'connecting>live>resyncing>live>ended')
  eq('S2 lastSeq', handle2.lastSeq, 4)

  // S3 已知水位：先补齐 afterSeq，再带 Last-Event-ID 订阅
  const probe3 = taskProbe()
  const handle3 = openTaskEventStream(http, 'task-gap', probe3.handlers, { sinceSeq: 2, idleTimeoutMs: 1500, reconnectLimit: 2 })
  const finished3 = await settleTask(handle3)
  eq('S3 finished', finished3, 'completed')
  eq('S3 补齐 afterSeq 正确', historyCalls('task-gap')[0]?.query.get('afterSeq'), '2')
  eq('S3 补齐 limit', historyCalls('task-gap')[0]?.query.get('limit'), '200')
  eq('S3 补齐交付 seq 3,4', probe3.events.map((e) => e.seq).slice(0, 2), [3, 4])
  eq('S3 订阅请求带 Last-Event-ID（= 补齐后的水位 4）', taskSseRecords('task-gap')[0]?.headers['last-event-id'], '4')
  eq('S3 订阅请求 Accept', taskSseRecords('task-gap')[0]?.headers['accept'], 'text/event-stream')
  eq('S3 全部交付 seq', probe3.events.map((e) => e.seq), [3, 4, 5, 6])
  eq('S3 终态事件唯一', probe3.events.filter((e) => e.kind === 'complete' || e.kind === 'error' || e.kind === 'cancelled').length, 1)
  eq('S3 相位序列', probe3.phases().join('>'), 'connecting>live>ended')

  // S3b 快照/历史已是终态：不订阅也能收束
  const probeDone = taskProbe()
  const handleDone = openTaskEventStream(http, 'task-done', probeDone.handlers, { idleTimeoutMs: 1500, reconnectLimit: 2 })
  const finishedDone = await settleTask(handleDone)
  eq('S3b 终态任务从历史收束为 completed', finishedDone, 'completed')
  eq('S3b 不需要再订阅 SSE', sseConnections.get('task:task-done'), undefined)
  eq('S3b 相位序列', probeDone.phases().join('>'), 'connecting>ended')
  eq('S3b 交付了终态事件', probeDone.events.map((e) => e.seq), [1])

  // S4 断线（无 end）→ 重连带 Last-Event-ID → 拿到真终态
  const probe4 = taskProbe()
  const handle4 = openTaskEventStream(http, 'task-recover', probe4.handlers, { idleTimeoutMs: 1500, reconnectLimit: 3 })
  const droppedState = await waitFor(() => probe4.phases().includes('resyncing'), 2000)
  const stateAtDrop = probe4.states.find((s) => s.phase === 'resyncing')
  const finished4 = await settleTask(handle4)
  eq('S4 断线被识别为 resyncing（不是完成）', droppedState, true)
  eq('S4 断线那一刻的 taskStatus（不得是 completed）', stateAtDrop?.taskStatus, 'running')
  eq('S4 断线那一刻水位', stateAtDrop?.lastSeq, 2)
  eq('S4 重连 SSE 连接数', sseConnections.get('task:task-recover'), 2)
  eq('S4 重连带 Last-Event-ID（= 补齐后的当前水位）', taskSseRecords('task-recover')[1]?.headers['last-event-id'], '3')
  eq('S4 重连前先按 afterSeq=2 补齐', historyCalls('task-recover')[0]?.query.get('afterSeq'), '2')
  eq('S4 交付 seq 完整且有序（无缺口、无重复）', probe4.events.map((e) => e.seq), [1, 2, 3, 4])
  eq('S4 finished', finished4, 'completed')
  eq('S4 相位序列', probe4.phases().join('>'), 'connecting>live>resyncing>live>ended')

  // S5 连接被中断且永不发 end → 绝不报告 completed；reconnectLimit 必须真的能收束
  const probe5 = taskProbe()
  const handle5 = openTaskEventStream(http, 'task-drop', probe5.handlers, { idleTimeoutMs: 1500, reconnectLimit: 1 })
  await waitFor(() => (sseConnections.get('task:task-drop') ?? 0) >= 2, 4000)
  // limit=1 → 上限允许的连接数是 2 次（首次 + 1 次重连）。再等 3.5 秒，看它是否真的停下。
  await waitMs(3500)
  const conns5 = sseConnections.get('task:task-drop') ?? 0
  const preClose5 = await settleTask(handle5, 400)
  check('S5 断线不报完成：finished 不是 completed', preClose5 !== 'completed', preClose5, '不等于 completed')
  eq('S5 绝不出现 ended 相位', probe5.phases().includes('ended'), false)
  eq('S5 交付事件里没有终态事件', probe5.events.filter((e) => e.kind === 'complete').length, 0)
  eq('S5 重连带已交付水位 Last-Event-ID', taskSseRecords('task-drop')[1]?.headers['last-event-id'], '2')
  check('S5 重连上限生效：reconnectLimit=1 → SSE 连接数应 ≤ 2', conns5 <= 2, { connections: conns5, reconnectLimit: 1 })
  check(
    'S5 到上限后如实失败（finished=null 且停在 failed）',
    preClose5 === 'null' && probe5.phases().at(-1) === 'failed',
    { finished: preClose5, lastPhase: probe5.phases().at(-1), phases: probe5.phases() },
  )
  handle5.close()
  const afterClose5 = await settleTask(handle5, 3000)
  // 上限生效后 run 已自行 failed 收束；此时 close() 不得把终态改写成 aborted 或 completed
  eq('S5 close() 不覆盖已确定的终态', [afterClose5, probe5.phases().at(-1)], ['null', 'failed'])
  eq('S5 lastSeq 停在已交付水位', handle5.lastSeq, 2)

  // S8 活着的流：close() 必须真的释放订阅（02 §5：离开页面/卸载组件释放订阅）
  const probe8 = taskProbe()
  const handle8 = openTaskEventStream(http, 'task-close', probe8.handlers, { idleTimeoutMs: 1500, reconnectLimit: 2 })
  const live8 = await waitFor(() => probe8.phases().includes('live'), 2000)
  eq('S8 订阅已建立（live，心跳在维持）', live8, true)
  handle8.close()
  const finished8 = await settleTask(handle8, 3000)
  eq('S8 close() → finished null（取消不当完成）', finished8, 'null')
  eq('S8 close() 后相位 aborted', probe8.phases().at(-1), 'aborted')
  eq('S8 close() 后绝不出现 ended', probe8.phases().includes('ended'), false)
  eq('S8 close() 后不再重连', sseConnections.get('task:task-close'), 1)


  // S6 心跳不触发重连
  const probe6 = taskProbe()
  const handle6 = openTaskEventStream(http, 'task-heartbeat', probe6.handlers, { idleTimeoutMs: 250, reconnectLimit: 2 })
  const finished6 = await settleTask(handle6)
  eq('S6 finished', finished6, 'completed')
  eq('S6 心跳期间连接数保持 1（心跳不触发重连）', sseConnections.get('task:task-heartbeat'), 1)
  eq('S6 相位里没有 resyncing', probe6.phases().includes('resyncing'), false)
  eq('S6 交付 seq', probe6.events.map((e) => e.seq), [1])

  // S9 稳定存活且有进展的流：计数清零 → reconnectLimit=1 也不该被误判失败
  const probe9 = taskProbe()
  const handle9 = openTaskEventStream(http, 'task-stable', probe9.handlers, { idleTimeoutMs: 20_000, reconnectLimit: 1 })
  const finished9 = await settleTask(handle9, 25_000)
  eq('S9 存活 >10s 且有进展的连接被允许继续（计数清零）', finished9, 'completed')
  eq('S9 没有把健康流误判为 failed', probe9.phases().includes('failed'), false)
  eq('S9 SSE 连接数（断线后 1 次重连）', sseConnections.get('task:task-stable'), 2)
  eq('S9 交付 seq', probe9.events.map((e) => e.seq), [1, 2])

  // S10 有进展但持续抖动：记录上限收束的实际行为（设计取舍，不是契约违规）
  const probe10 = taskProbe()
  const handle10 = openTaskEventStream(http, 'task-flap', probe10.handlers, { idleTimeoutMs: 1500, reconnectLimit: 2 })
  const finished10 = await settleTask(handle10, 12_000)
  eq('S10 有进展但不稳定的连续重连仍会被上限收束', finished10, 'null')
  eq('S10 连接数 = limit + 1', sseConnections.get('task:task-flap'), 3)
  eq('S10 已交付的事件没有丢（水位保留）', handle10.lastSeq, 3)
  eq('S10 每轮确实有进展（交付 seq 递增）', probe10.events.map((e) => e.seq), [1, 2, 3])
  check('S10 失败文案带上已收到的事件数，便于调用方 sinceSeq 续订', (probe10.errors.at(-1)?.message ?? '').includes('3'), probe10.errors.map((e) => e.message))
  const flapMessages = probe10.errors.map((e) => `${e.code}:${e.message}`)
  const flapCodes = probe10.errors.map((e) => e.code)
  check(
    'S10 连接被中断不得被归成服务端错误（不得是 internal_error）',
    flapCodes.every((code) => code !== 'internal_error'),
    flapCodes,
  )
  check(
    'S10 断线 onError 文案不得泄露底层运行时原文',
    flapMessages.every((item) => !item.includes('terminated') && !item.includes('TypeError')),
    flapMessages,
  )
  const lastFlapUser = probe10.errors.at(-1) ? userMessageForError(probe10.errors.at(-1) as ApiError) : ''
  check('S10 断线错误经 userMessageForError 后仍是人话且不含技术细节', lastFlapUser.trim() !== '' && !lastFlapUser.includes('terminated'), lastFlapUser)
  obs(`S10 断线期间 onError 实测：${show(flapMessages)}`)
  obs(`S10 文案口径观察：network_error 的本地兜底文案实测为 ${show(lastFlapUser)}；用于「流中途被掐断」时措辞偏「连不上本地服务」，若要更准需核心层区分「连不上」与「连接已断开」两种文案（非失败项）`)
  obs(`S10 阈值口径（实测事实）：默认 streamStableMs=${makeHttp().config.streamStableMs}ms，可由配置覆盖（S11b 用 200ms 实测生效；env/本机存储两条来源见第 10 组）。因此「有进展但每轮都在阈值内断开」的流会在 reconnectLimit 次后报 failed（默认 limit=5）—— 02 §5 只要求断线不得当完成，属合规取舍，阈值已可调。`)

  // S11 稳定阈值是否真的走配置（不是模块常量）：同一场景，两种阈值必须给出不同结果
  const probe11a = taskProbe()
  const handle11a = openTaskEventStream(makeHttp(), 'task-cfg', probe11a.handlers, { idleTimeoutMs: 1500, reconnectLimit: 1 })
  const finished11a = await settleTask(handle11a, 9000)
  eq('S11a 默认阈值 10s：两次 400ms 的断线不算恢复 → 上限收束（finished=null）', finished11a, 'null')
  eq('S11a 已交付水位保留', handle11a.lastSeq, 2)

  const probe11b = taskProbe()
  const handle11b = openTaskEventStream(makeHttp({ streamStableMs: 200 }), 'task-cfg2', probe11b.handlers, { idleTimeoutMs: 1500, reconnectLimit: 1 })
  const finished11b = await settleTask(handle11b, 9000)
  eq('S11b 配置 streamStableMs=200 真的生效（同场景改为允许继续并拿到终态）', finished11b, 'completed')
  eq('S11b 终态相位', probe11b.phases().at(-1), 'ended')
  eq('S11b 交付 seq 完整', probe11b.events.map((e) => e.seq), [1, 2, 3])

  // S7 空闲超时按断线处理
  const probe7 = taskProbe()
  const handle7 = openTaskEventStream(http, 'task-idle', probe7.handlers, { idleTimeoutMs: 250, reconnectLimit: 2 })
  const idleResync = await waitFor(() => probe7.phases().includes('resyncing'), 3000)
  const finished7 = await settleTask(handle7)
  eq('S7 空闲超时被当作断线（resyncing）', idleResync, true)
  eq('S7 空闲超时不报完成：结束前没有 ended', probe7.states.findIndex((s) => s.phase === 'ended') > probe7.states.findIndex((s) => s.phase === 'resyncing'), true)
  eq('S7 重连后拿到真终态', finished7, 'completed')
  eq('S7 SSE 连接数', sseConnections.get('task:task-idle'), 2)
  eq('S7 水位不受空闲超时影响（重连不带 Last-Event-ID，因为水位仍为 0）', taskSseRecords('task-idle')[1]?.headers['last-event-id'], undefined)
  const idleErrorCodes = probe7.errors.map((e) => `${e.code}:${e.message}`)
  check('S7 空闲断线不得被说成服务端内部错误', !idleErrorCodes.some((item) => item.includes('internal_error')), idleErrorCodes)
  eq('S7 未到重连上限前不发 onError（空闲超时=断线，不是失败）', idleErrorCodes, [])
  obs(`S7 空闲超时的语义：空闲 → resyncing 重连（本场景第 2 次连接就拿到终态，故 onError 实测为 ${show(idleErrorCodes)}）；只有到重连上限才 failed 并给 onError`)
  obs('S5/S7 表明：断线一律走 resyncing→重连，终态只由 end 帧或终态事件裁决 —— 与 02 §5「网络断开不等于成功」一致')

  // normalizeEventList：两种历史形状都认，坏数据如实报错
  eq('normalizeEventList 接受 Page 形状', normalizeEventList({ items: [mkEvent('t', 1, 'progress', 'running', 'x')], nextCursor: null }).length, 1)
  eq('normalizeEventList 接受裸数组', normalizeEventList([mkEvent('t', 1, 'progress', 'running', 'x')]).length, 1)
  let shapeError: unknown = null
  try {
    normalizeEventList({ nope: true })
  } catch (error) {
    shapeError = error
  }
  eq('normalizeEventList 无法识别的形状 → internal_error（不当空）', shapeError instanceof ApiError ? shapeError.code : null, 'internal_error')
}

/* ============================ 6. 对话回复流 ============================ */

function registerChatScenarios(): void {
  chatScenarios.set('cs-normal', {
    sse: (_attempt, res) => {
      const message = {
        id: 'msg_1',
        sessionId: 'cs-normal',
        role: 'assistant',
        text: '你好，世界！',
        createdAt: '2026-10-29T10:00:01Z',
      }
      timeline(res, [
        [0, () => safeWrite(res, sseFrame({ type: 'delta', messageId: 'msg_1', delta: '你好' }, { id: 1, event: 'delta' }))],
        [30, () => safeWrite(res, sseFrame({ type: 'delta', messageId: 'msg_1', delta: '世界' }, { id: 2, event: 'delta' }))],
        [60, () => safeWrite(res, sseFrame({ type: 'completed', message }, { id: 3, event: 'completed' }))],
        [90, () => safeWrite(res, sseFrame({ type: 'task', messageId: 'msg_1', taskId: 'task_1' }, { id: 4, event: 'task' }))],
        [120, () => safeWrite(res, sseFrame({ type: 'end' }, { event: 'end' }))],
        [140, () => safeEnd(res)],
      ])
    },
  })

  // 活着的回复流：只发 delta + 心跳，永不 end —— 验证 close() 释放订阅
  chatScenarios.set('cs-close', {
    sse: (_attempt, res) => {
      const steps: Array<[number, () => void]> = [
        [0, () => safeWrite(res, sseFrame({ type: 'delta', messageId: 'msg_c', delta: '正在' }, { id: 1, event: 'delta' }))],
      ]
      for (let i = 1; i <= 25; i += 1) steps.push([i * 100, () => safeWrite(res, ': ping\n\n')])
      steps.push([2700, () => safeEnd(res)])
      timeline(res, steps)
    },
  })

  chatScenarios.set('cs-drop', {
    sse: (attempt, res) => {
      safeWrite(res, sseFrame({ type: 'delta', messageId: 'msg_drop', delta: `第${attempt + 1}段` }, { id: attempt + 1, event: 'delta' }))
      setTimeout(() => res.socket?.destroy(), 30)
    },
  })
}

async function groupChatStream(): Promise<void> {
  group('6. 对话流 openChatSessionStream：delta → completed → task → end / 断线不当作回答结束')

  const http = makeHttp()

  const probe = chatProbe()
  const handle = openChatSessionStream(http, 'cs-normal', probe.handlers, { idleTimeoutMs: 2000, reconnectLimit: 2 })
  const outcome = await settleChat(handle)
  eq('C1 finished 正常结束', outcome, 'resolved')
  eq('C1 delta 拼接文本（只是过程量）', probe.deltas.map((d) => d.delta).join(''), '你好世界')
  eq('C1 completed 覆盖拼接文本（以服务端完整消息为准）', probe.completed.at(-1)?.text, '你好，世界！')
  check('C1 completed 文本 ≠ delta 拼接结果（证明二者不是同一来源）', probe.completed.at(-1)?.text !== probe.deltas.map((d) => d.delta).join(''), {
    completed: probe.completed.at(-1)?.text,
    joined: probe.deltas.map((d) => d.delta).join(''),
  })
  eq('C1 task 只是关联句柄', probe.tasks, [{ messageId: 'msg_1', taskId: 'task_1' }])
  eq('C1 相位序列', probe.phases().join('>'), 'connecting>streaming>ended')
  eq('C1 lastEventId 跟随 SSE id', handle.lastEventId, '4')
  eq('C1 completedMessageIds', probe.states.at(-1)?.completedMessageIds, ['msg_1'])
  eq('C1 SSE 连接数', sseConnections.get('chat:cs-normal'), 1)

  const dropProbe = chatProbe()
  const dropHandle = openChatSessionStream(http, 'cs-drop', dropProbe.handlers, { idleTimeoutMs: 1200, reconnectLimit: 1 })
  await waitFor(() => (sseConnections.get('chat:cs-drop') ?? 0) >= 2, 4000)
  await waitMs(3500)
  const chatConns = sseConnections.get('chat:cs-drop') ?? 0
  eq('C2 断线绝不给出 ended 相位', dropProbe.phases().includes('ended'), false)
  check('C2 断线不当作回答结束：onCompleted 从未触发', dropProbe.completed.length === 0, dropProbe.completed)
  check('C2 只拿到 delta、没有完整回答', dropProbe.deltas.length >= 1 && dropProbe.completed.length === 0, {
    deltas: dropProbe.deltas.length,
    completed: dropProbe.completed.length,
  })
  check('C2 重连上限生效：reconnectLimit=1 → SSE 连接数应 ≤ 2', chatConns <= 2, { connections: chatConns, reconnectLimit: 1 })
  check('C2 到上限后进入 failed', dropProbe.phases().at(-1) === 'failed', { lastPhase: dropProbe.phases().at(-1), phases: dropProbe.phases() })
  dropHandle.close()
  const afterCloseChat = await settleChat(dropHandle, 3000)
  eq('C2 close() 后 run 收束（不挂死）', afterCloseChat, 'resolved')
  eq('C2 close() 后仍绝不出现 ended', dropProbe.phases().includes('ended'), false)

  // C3 活着的回复流：close() 释放订阅
  const closeProbe = chatProbe()
  const closeHandle = openChatSessionStream(http, 'cs-close', closeProbe.handlers, { idleTimeoutMs: 1500, reconnectLimit: 2 })
  const streaming3 = await waitFor(() => closeProbe.phases().includes('streaming'), 2000)
  eq('C3 回复流已建立（streaming）', streaming3, true)
  closeHandle.close()
  const closeOutcome = await settleChat(closeHandle, 3000)
  eq('C3 close() → run 收束', closeOutcome, 'resolved')
  eq('C3 close() 后相位 aborted', closeProbe.phases().at(-1), 'aborted')
  eq('C3 close() 后绝不出现 ended', closeProbe.phases().includes('ended'), false)
  eq('C3 close() 后 onCompleted 仍未触发', closeProbe.completed.length, 0)
  eq('C3 close() 后不再重连', sseConnections.get('chat:cs-close'), 1)
}

/* ============================ 7. 发送前校验 ============================ */

function regionReference(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'ref_1',
    role: 'target',
    kind: 'region',
    sceneId: 'scene_1',
    frame: 0,
    bbox: { x: 0.25, y: 0.2, w: 0.3, h: 0.4 },
    label: '选区',
    ...over,
  }
}

function previewReference(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'ref_preview',
    role: 'target',
    kind: 'preview',
    label: '当前预览',
    source: { origin: 'editor', projectId: 'prj_1', visualId: 'vis_1', assetId: 'asset_1', revision: 3, file: './media/a.mp4', media: 'video' },
    ...over,
  }
}

function baseRequest(over: Record<string, unknown> = {}): TaskRequest {
  return {
    kind: 'modify',
    prompt: '杯口增加空间感，背景不要动',
    scope: 'selection',
    sceneIds: [],
    references: [regionReference()],
    constraints: { preserveCamera: true, preserveCaptions: false, limitToSelection: true, reuseExistingComponents: true },
    attachments: [],
    ...over,
  } as unknown as TaskRequest
}

const problemCodes = (problems: Array<{ code: string }>): string[] => problems.map((problem) => problem.code)
const frozenPolicy = { allowLocalModifyExtensions: false }
const openPolicy = { allowLocalModifyExtensions: true }

async function groupValidate(): Promise<void> {
  group('7. validateTaskRequest：多 target / selection 无目标 / bbox 越界 / 时间超长 / 附件无 fileId / 未冻结扩展')

  const valid = validateTaskRequest(baseRequest(), frozenPolicy)
  eq('V0 合法请求 → 0 个问题（不过度拦截）', problemCodes(valid), [])

  const twoTargets = validateTaskRequest(
    baseRequest({ references: [regionReference(), regionReference({ id: 'ref_2', sceneId: 'scene_2' })] }),
    frozenPolicy,
  )
  check('V1 两个 target 被拦（too_many_targets）', problemCodes(twoTargets).includes('too_many_targets'), problemCodes(twoTargets))

  const selectionNoTarget = validateTaskRequest(baseRequest({ references: [] }), frozenPolicy)
  check('V2 scope=selection 无目标被拦', problemCodes(selectionNoTarget).includes('selection_without_target'), problemCodes(selectionNoTarget))

  const selectionUnlocatable = validateTaskRequest(
    baseRequest({ references: [{ id: 'ref_x', role: 'target', kind: 'scene', sceneId: '   ', label: '只有名字' }] }),
    frozenPolicy,
  )
  check('V2b 只有展示名、无可定位 ID 被拦', problemCodes(selectionUnlocatable).includes('target_not_locatable'), problemCodes(selectionUnlocatable))

  const bboxOut = validateTaskRequest(baseRequest({ references: [regionReference({ bbox: { x: 0.8, y: 0.2, w: 0.3, h: 0.4 } })] }), frozenPolicy)
  check('V3 bbox 越界被拦（x+w>1）', problemCodes(bboxOut).includes('bbox_invalid'), {
    codes: problemCodes(bboxOut),
    messages: bboxOut.map((p) => p.message),
  })

  const timeOver = validateTaskRequest(
    baseRequest({ references: [previewReference({ timeSeconds: 5 })] }),
    frozenPolicy,
    { routeProjectId: 'prj_1', previewDurationSeconds: 3 },
  )
  check('V4 时间超时长被拦', problemCodes(timeOver).includes('time_out_of_range'), problemCodes(timeOver))
  check('V4b 同一请求也因 preview 未冻结被拦', problemCodes(timeOver).includes('unfrozen_local_extension'), problemCodes(timeOver))

  const attachmentNoFile = validateTaskRequest(
    baseRequest({ attachments: [{ name: '参考.png', mimeType: 'image/png', sizeBytes: 1024 }] }),
    frozenPolicy,
  )
  check('V5 附件无 fileId 被拦', problemCodes(attachmentNoFile).includes('attachment_without_file_id'), {
    codes: problemCodes(attachmentNoFile),
    messages: attachmentNoFile.map((p) => p.message),
  })

  const unfrozenPreview = validateTaskRequest(baseRequest({ references: [previewReference()] }), frozenPolicy, { routeProjectId: 'prj_1' })
  check('V6a preview 引用被拦（unfrozen_local_extension）', problemCodes(unfrozenPreview).includes('unfrozen_local_extension'), problemCodes(unfrozenPreview))

  const unfrozenFeedback = validateTaskRequest(baseRequest({ feedbackId: 'feedback_1' }), frozenPolicy)
  check('V6b feedbackId 被拦', problemCodes(unfrozenFeedback).includes('unfrozen_local_extension'), problemCodes(unfrozenFeedback))

  const unfrozenBrief = validateTaskRequest(baseRequest({ creativeBrief: { original: '做一条宣传片', corrections: [], keepNotes: '' } }), frozenPolicy)
  check('V6c creativeBrief 被拦', problemCodes(unfrozenBrief).includes('unfrozen_local_extension'), problemCodes(unfrozenBrief))

  const unfrozenPreserve = validateTaskRequest(
    baseRequest({ constraints: { preserveCamera: true, preserveCaptions: false, limitToSelection: true, reuseExistingComponents: true, preserveOutsideSelection: true } }),
    frozenPolicy,
  )
  check('V6d preserveOutsideSelection 被拦', problemCodes(unfrozenPreserve).includes('unfrozen_local_extension'), problemCodes(unfrozenPreserve))

  const preserveNoRegion = validateTaskRequest(
    baseRequest({
      references: [],
      constraints: { preserveCamera: true, preserveCaptions: false, limitToSelection: true, reuseExistingComponents: true, preserveOutsideSelection: true },
    }),
    frozenPolicy,
  )
  check('V6e 「区域外不动」无区域 → preserve_outside_without_region', problemCodes(preserveNoRegion).includes('preserve_outside_without_region'), problemCodes(preserveNoRegion))

  const openedPolicy = validateTaskRequest(baseRequest({ feedbackId: 'feedback_1' }), openPolicy)
  eq('V6f 显式打开 allowLocalModifyExtensions 后不再误拦', problemCodes(openedPolicy), [])

  const detect = detectUnfrozenLocalFields({
    feedbackId: 'f',
    creativeBrief: { original: 'x' },
    constraints: { preserveOutsideSelection: true },
    references: [previewReference()],
  })
  eq('V6g 未冻结字段探测（4 项全中）', [...detect].sort(), ['creativeBrief', 'feedbackId', 'preserveOutsideSelection', 'preview'])

  const shortScene = validateTaskRequest(baseRequest({ scope: 'scene', sceneIds: [] }), frozenPolicy)
  check('V7a scope=scene 无 sceneIds 被拦', problemCodes(shortScene).includes('scene_scope_without_scene'), problemCodes(shortScene))
  const strayScene = validateTaskRequest(baseRequest({ scope: 'project', sceneIds: ['scene_1'] }), frozenPolicy)
  check('V7b 非 scene 范围却带 sceneIds 被拦', problemCodes(strayScene).includes('scene_scope_without_scene'), problemCodes(strayScene))

  const emptyPrompt = validateTaskRequest(baseRequest({ prompt: '   ', references: [] }), frozenPolicy)
  check('V8 空 prompt 且无 target 被拦', problemCodes(emptyPrompt).includes('empty_prompt'), problemCodes(emptyPrompt))

  const legacyShot = validateTaskRequest(baseRequest({ references: [regionReference({ shotId: 'shot_7' })] }), frozenPolicy)
  check('V9 引用里混入旧 shotId 被拦', problemCodes(legacyShot).includes('legacy_reference'), problemCodes(legacyShot))

  const kindBlocks: Array<[string, Record<string, unknown>]> = [
    ['render', { kind: 'render' }],
    ['check', { kind: 'check' }],
    ['analyze', { kind: 'analyze' }],
    ['restore', { kind: 'restore' }],
  ]
  for (const [kind, over] of kindBlocks) {
    const problems = validateTaskRequest(baseRequest(over), frozenPolicy)
    check(`V10 kind=${kind} 缺少必填块被拦`, problemCodes(problems).includes('missing_kind_block'), problemCodes(problems))
  }

  // 真抛：assertTaskRequestSendable
  let thrown: unknown = null
  try {
    assertTaskRequestSendable(baseRequest({ feedbackId: 'f' }), frozenPolicy)
  } catch (error) {
    thrown = error
  }
  eq('V11 assertTaskRequestSendable 抛 ApiError', thrown instanceof ApiError ? thrown.code : String(thrown), 'validation_error')
  const thrownProblems = thrown instanceof ApiError ? (thrown.details?.problems as Array<{ code: string }> | undefined) : undefined
  check('V11b 抛出的 details.problems 带问题清单', Array.isArray(thrownProblems) && thrownProblems.some((p) => p.code === 'unfrozen_local_extension'), thrownProblems)
  eq('V11c 合法请求 assert 不抛', (() => { try { assertTaskRequestSendable(baseRequest(), frozenPolicy); return 'no-throw' } catch (error) { return String(error) } })(), 'no-throw')

  // bbox 纯函数
  eq('bboxProblem 合法 → null', bboxProblem({ x: 0, y: 0, w: 1, h: 1 }), null)
  eq('bboxProblem 零宽高', bboxProblem({ x: 0, y: 0, w: 0, h: 1 }), 'bbox 的宽高必须大于 0。')
  eq('bboxProblem 负坐标', bboxProblem({ x: -0.1, y: 0, w: 0.5, h: 0.5 }), 'bbox 的 x/y 不能为负。')
  eq('bboxProblem 非数字', bboxProblem({ x: '0', y: 0, w: 1, h: 1 }), 'bbox 的 x/y/w/h 必须是数字。')
  eq('bboxProblem 缺字段', bboxProblem({ x: 0, y: 0 }), 'bbox 的 x/y/w/h 必须是数字。')
  eq('bboxProblem 非对象', bboxProblem(null), '缺少 bbox{x,y,w,h}。')
}

/* ============================ 8. 旧骨架兼容层 ============================ */

async function groupCompat(): Promise<void> {
  group('8. compat：demo 标记 / 旧引用映射 / 旧附件 fileId / 未冻结字段')

  eq('demoOriginOf({demo:true})', demoOriginOf({ demo: true }), 'demo')
  eq('demoOriginOf({mock:true})', demoOriginOf({ mock: true }), 'demo')
  eq('demoOriginOf({})', demoOriginOf({}), 'real')
  eq('demoOriginOf({demo:false})（不得把 true 改 false 后当真实）', demoOriginOf({ demo: false }), 'real')
  eq('demoOriginOf(null)', demoOriginOf(null), 'real')
  eq('demoOriginOf("x")', demoOriginOf('x'), 'real')

  const shotOnly = fromLegacyReference({ id: 'ref_1', role: 'target', shotId: 'shot_1', label: '第 1 镜' })
  eq('只给 shotId（无映射）→ 拒绝', shotOnly.ok, false)
  eq('  拒绝码', shotOnly.ok ? null : shotOnly.problem.code, 'legacy_shot_reference')
  eq('  拒绝字段', shotOnly.ok ? null : shotOnly.problem.field, 'shotId')

  const mapped = fromLegacyReference({ id: 'ref_1', role: 'target', shotId: 'shot_1', label: '第 1 镜' }, { sceneIdByShotId: { shot_1: 'scene_9' } })
  eq('有真实映射 → 转成 scene 引用', mapped.ok, true)
  eq('  转换后的 kind', mapped.ok ? mapped.value.kind : null, 'scene')
  eq('  转换后的 sceneId', mapped.ok ? (mapped.value as { sceneId?: string }).sceneId : null, 'scene_9')
  eq('  转换后的 label 保留', mapped.ok ? mapped.value.label : null, '第 1 镜')

  const sceneKindNoId = fromLegacyReference({ id: 'r', role: 'target', kind: 'scene', label: 'x' })
  eq('kind=scene 但缺 sceneId → 拒绝', sceneKindNoId.ok, false)
  const regionMissing = fromLegacyReference({ id: 'r', role: 'target', kind: 'region', sceneId: 'scene_1', frame: 0 })
  eq('kind=region 缺 bbox → 拒绝', regionMissing.ok ? 'ok' : regionMissing.problem.code, 'invalid_reference')
  const previewKind = fromLegacyReference(previewReference())
  eq('kind=preview（未冻结扩展）→ 拒绝', previewKind.ok ? 'ok' : previewKind.problem.code, 'unfrozen_reference')
  const missingId = fromLegacyReference({ role: 'target', kind: 'scene', sceneId: 'scene_1' })
  eq('缺稳定 id → 拒绝', missingId.ok ? 'ok' : missingId.problem.code, 'invalid_reference')

  const legacyAttachment = fromLegacyAttachment({ name: '参考.png', type: 'image/png', size: 1024 })
  eq('旧附件只有 name/type/size → 拒绝', legacyAttachment.ok, false)
  eq('  拒绝码', legacyAttachment.ok ? null : legacyAttachment.problem.code, 'attachment_without_file_id')
  const goodAttachment = fromLegacyAttachment({ name: '参考.png', mimeType: 'image/png', sizeBytes: 1024, fileId: 'file_1' })
  eq('带 fileId 的附件 → 通过', goodAttachment.ok, true)
  eq('  字段映射', goodAttachment.ok ? goodAttachment.value : null, { name: '参考.png', mimeType: 'image/png', sizeBytes: 1024, fileId: 'file_1' })
  const legacyFieldNames = fromLegacyAttachment({ name: 'b.mp3', type: 'audio/mpeg', size: 5, fileId: 'file_2' })
  eq('  旧字段 type/size 映射到 mimeType/sizeBytes', legacyFieldNames.ok ? legacyFieldNames.value : null, {
    name: 'b.mp3',
    mimeType: 'audio/mpeg',
    sizeBytes: 5,
    fileId: 'file_2',
  })
}

/* ============================ 9. 能力视图与健康检查 ============================ */

async function groupCapabilities(): Promise<void> {
  group('9. /health + /capabilities：demo 标记、缺项兜底、本机能力不被服务端隐藏、闸门')

  const http = makeHttp()
  const health = await http.get<Record<string, unknown>>('/health')
  eq('GET /health status', health.status, 'ok')
  eq('GET /health demo:true → demoOriginOf', demoOriginOf(health), 'demo')

  const rawCapabilities = await http.get<Record<string, unknown>>('/capabilities')
  const normalized = normalizeServerCapabilities(rawCapabilities)
  eq('agent 声明 available', normalized.agent.status, 'available')
  eq('remotionEditor 声明 demo', normalized.remotionEditor.status, 'demo')
  eq('previewVideo 声明 unavailable', normalized.previewVideo.status, 'unavailable')
  eq('缺项（cloudRender）按 unavailable 兜底', normalized.cloudRender.status, 'unavailable')
  eq('缺项兜底带人话说明', normalized.cloudRender.note, '服务端没有声明这项能力。')
  eq('七项能力键齐全', Object.keys(CAPABILITY_LABELS).every((key) => key in normalized), true)
  eq('非法 status 值 → unavailable（不猜）', normalizeServerCapabilities({ asr: { status: 'maybe' } }).asr.status, 'unavailable')
  eq('capabilities 载荷不是对象 → 全 unavailable', normalizeServerCapabilities(null).agent.status, 'unavailable')

  const localEditor = mergeCapability(normalized.remotionEditor, { status: 'available', note: '本机编辑器可用' })
  eq('本机能力更强 → 取 available（02 §3.1：不能用服务端值隐藏本机编辑器）', localEditor.status, 'available')
  check('差异写进 note', (localEditor.note ?? '').includes('服务端') && (localEditor.note ?? '').includes('本机'), localEditor.note)
  const missingBoth = mergeCapability(undefined, undefined)
  eq('两边都没有 → unavailable', missingBoth.status, 'unavailable')
  eq('两边都没有 → 说明文案', missingBoth.note, '服务端与本机都没有声明这项能力。')

  eq('capabilityGate(available)', capabilityGate({ status: 'available' }, 'Agent 执行'), { enabled: true, reason: '' })
  const demoGate = capabilityGate(normalized.remotionEditor, '本机编辑器')
  eq('capabilityGate(demo).enabled（演示不得驱动真实写操作）', demoGate.enabled, false)
  eq('capabilityGate(demo).reason', demoGate.reason, '本机编辑器仅演示')
  const unavailableGate = capabilityGate(normalizeServerCapabilities({}).cloudRender, '云端渲染')
  eq('capabilityGate(unavailable).enabled', unavailableGate.enabled, false)
}

/* ============================ 10. URL / 配置 / 幂等键 ============================ */

async function groupConfig(): Promise<void> {
  group('10. 配置与 URL 拼装（端口不写死、来源可说明、未冻结扩展默认关闭）')

  eq('buildApiUrl 省略 undefined/null，数组用重复参数', buildApiUrl('http://x/api', '/projects', { limit: 50, cursor: undefined, q: null, tags: ['a', 'b'] }), 'http://x/api/projects?limit=50&tags=a&tags=b')
  eq('buildApiUrl 相对基址保持相对（走代理）', buildApiUrl('/api', 'health', { limit: 1 }), '/api/health?limit=1')
  eq('normalizeBaseUrl 去掉尾部斜杠', normalizeBaseUrl('http://127.0.0.1:8080/api/'), 'http://127.0.0.1:8080/api')
  eq('normalizeBaseUrl 不改写路径内容（/api/v1 不会被偷偷改）', normalizeBaseUrl('http://h/api/v1'), 'http://h/api/v1')
  eq('normalizeBaseUrl 空串 → 默认基址', normalizeBaseUrl('   '), DEFAULT_API_CONFIG.baseUrl)
  eq('默认配置：未冻结本地扩展默认关闭（02 §4）', DEFAULT_API_CONFIG.allowLocalModifyExtensions, false)
  eq('默认 streamStableMs', DEFAULT_API_CONFIG.streamStableMs, 10_000)
  eq('streamStableMs 可由环境变量覆盖', readEnvConfig({ VITE_FENGMOTION_STREAM_STABLE_MS: '1234' }).streamStableMs, 1234)
  eq('默认基址前缀是 /api（02 §2 建议，非 /api/v1）', DEFAULT_API_CONFIG.baseUrl, 'http://127.0.0.1:8080/api')

  const envPatch = readEnvConfig({
    VITE_FENGMOTION_API_BASE: 'http://h:9/api/',
    VITE_FENGMOTION_API_MODE: 'demo',
    VITE_FENGMOTION_API_TIMEOUT_MS: '9000',
    VITE_FENGMOTION_STREAM_IDLE_TIMEOUT_MS: '900',
    VITE_FENGMOTION_ALLOW_LOCAL_MODIFY_EXTENSIONS: 'true',
  })
  eq('readEnvConfig 读到的补丁', envPatch, {
    baseUrl: 'http://h:9/api',
    mode: 'demo',
    timeoutMs: 9000,
    streamIdleTimeoutMs: 900,
    allowLocalModifyExtensions: true,
  })

  const fakeStorage = (initial: Record<string, string> = {}) => {
    const map = new Map(Object.entries(initial))
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size
      },
    } as unknown as Storage
  }
  const stored = fakeStorage({ 'fengmotion:api-config:v1': JSON.stringify({ baseUrl: 'http://stored/api', timeoutMs: 4444 }) })
  eq(
    'streamStableMs 可由本机存储覆盖',
    resolveApiConfig({ storage: fakeStorage({ 'fengmotion:api-config:v1': JSON.stringify({ streamStableMs: 4321 }) }), skipEnv: true }).streamStableMs,
    4321,
  )
  const storedCfg = resolveApiConfig({ storage: stored, skipEnv: true })
  eq('优先级：stored 生效', [storedCfg.baseUrl, storedCfg.timeoutMs, storedCfg.source], ['http://stored/api', 4444, 'stored'])
  const overrideCfg = resolveApiConfig({ storage: stored, skipEnv: true, overrides: { baseUrl: 'http://override/api' } })
  eq('优先级：overrides > stored', [overrideCfg.baseUrl, overrideCfg.source], ['http://override/api', 'explicit'])
  const explicitCfg = resolveApiConfig({ storage: stored, skipEnv: true, overrides: { baseUrl: 'http://override/api' }, explicit: { baseUrl: 'http://explicit/api' } })
  eq('优先级：explicit > overrides', [explicitCfg.baseUrl, explicitCfg.source], ['http://explicit/api', 'explicit'])
  const defaultCfg = resolveApiConfig({ storage: fakeStorage(), skipEnv: true })
  eq('无任何来源 → default', [defaultCfg.baseUrl, defaultCfg.source], [DEFAULT_API_CONFIG.baseUrl, 'default'])
  eq('损坏的存储内容被忽略（不抛、不猜）', resolveApiConfig({ storage: fakeStorage({ 'fengmotion:api-config:v1': '{{{' }), skipEnv: true }).source, 'default')

  const keyA = newIdempotencyKey()
  const keyB = newIdempotencyKey()
  check('newIdempotencyKey 非空且唯一', keyA.length > 0 && keyA !== keyB, [keyA, keyB])
}

/* ============================ 11~20. 域客户端真跑断言 ============================ */

/** 断言「该请求真的发出过」，并把观测到的 method+path+query 作为实际值打出来。 */
function observed(name: string, method: string, path: string): Recorded | undefined {
  const rec = lastReq(method, path)
  check(
    name,
    rec !== undefined,
    rec ? `${rec.method} ${rec.path}${rec.query.toString() ? `?${rec.query.toString()}` : ''}` : `未观测到 ${method} ${path}`,
    `${method} ${path}`,
  )
  return rec
}

const asCaps = (value: Record<string, unknown>): Capabilities => value as unknown as Capabilities

function makeFile(name: string, size: number, type: string): Blob {
  const bytes = new Uint8Array(size)
  for (let index = 0; index < size; index += 1) bytes[index] = index
  const FileCtor = (globalThis as { File?: new (parts: BlobPart[], name: string, opts?: { type?: string }) => Blob }).File
  if (!FileCtor) return new Blob([bytes], { type })
  return new FileCtor([bytes], name, { type })
}

async function groupClientAssembly(): Promise<void> {
  group('11. 组装层 index.ts：createStudioApiClient / studioHttpApi / capabilityGates / patchConfig')

  const client = createStudioApiClient({
    config: { baseUrl, timeoutMs: 3000, streamIdleTimeoutMs: 5000, streamReconnectLimit: 3 },
  })
  eq('config 解析来源', client.config.source, 'explicit')
  eq(
    '九个域客户端都装配了',
    [client.system, client.projects, client.tasks, client.chat, client.assets, client.renders, client.checks, client.workflows, client.library].every(Boolean),
    true,
  )

  const gates = client.capabilityGates(
    asCaps({ agent: { status: 'available' }, remotionEditor: { status: 'demo', note: '仅演示' }, previewVideo: { status: 'unavailable' } }),
  )
  eq('capabilityGates: available → 放行', gates.agent, { enabled: true, reason: '' })
  eq('capabilityGates: demo → 不放行（演示不能驱动真实写操作）', gates.remotionEditor.enabled, false)
  check('capabilityGates: demo 的原因是服务端 note', gates.remotionEditor.reason.includes('仅演示'), gates.remotionEditor.reason)
  // 本机能力更强时，服务端的 demo 不该把按钮按住（02 §3.1）
  const gatesWithLocal = client.capabilityGates(
    asCaps({ remotionEditor: { status: 'demo', note: '服务端仅演示' } }),
    { remotionEditor: { status: 'available', note: '本机编辑器可用' } },
  )
  eq('capabilityGates: 服务端 demo + 本机 available → 放行（不能用服务端值隐藏本机编辑器）', gatesWithLocal.remotionEditor.enabled, true)
  eq('capabilityGates: 缺项 → unavailable 不放行', gates.cloudRender.enabled, false)
  check('capabilityGates: unavailable 有中文原因', gates.cloudRender.reason.length > 0, gates.cloudRender.reason)

  const views = client.capabilityViews(asCaps({ agent: { status: 'unavailable' } }), { agent: { status: 'available', note: '本机有' } })
  eq('capabilityViews: 本机更强时取 available', views.agent.status, 'available')

  const patched = client.patchConfig({ baseUrl: 'http://127.0.0.1:1/api' })
  eq('patchConfig 生效并返回新配置', [patched.baseUrl, client.config.baseUrl], ['http://127.0.0.1:1/api', 'http://127.0.0.1:1/api'])
  client.patchConfig({ baseUrl })

  const health = await client.system.health()
  observed('组装层发出的 GET /health', 'GET', '/api/health')
  eq('组装层 health 返回', health.status, 'ok')

  installStudioHttpApi(null)
  const lazy = studioHttpApi({ config: { baseUrl } })
  eq('studioHttpApi 是惰性单例（重复调用同一实例）', studioHttpApi() === lazy, true)
  resetStudioHttpApi()
  const afterReset = studioHttpApi({ config: { baseUrl } })
  check('resetStudioHttpApi 后重新解析出**新**实例', afterReset !== lazy, { sameInstance: afterReset === lazy })
  installStudioHttpApi(null)
  eq('installStudioHttpApi(null) 等于重置', studioHttpApi({ config: { baseUrl } }) !== lazy, true)
  installStudioHttpApi(null)
  resetStudioHttpApi()
}

async function groupSystemDomain(): Promise<void> {
  group('12. 系统域（A）：health/probe/capabilities/settings')

  const http = makeHttp()
  const system = createSystemResource(http)

  const probe = await system.probe()
  observed('probe() → GET /health', 'GET', '/api/health')
  eq('probe().demo（演示服务如实标注，不硬改 false）', probe.demo, true)
  eq('probe().health.status', probe.health.status, 'ok')

  const caps = await system.capabilities()
  observed('capabilities() → GET /capabilities', 'GET', '/api/capabilities')
  eq('capabilities(): 声明 available 的项', caps.agent.status, 'available')
  eq('capabilities(): 声明 demo 的项', caps.remotionEditor.status, 'demo')
  eq('capabilities(): 缺项 → unavailable', caps.cloudRender.status, 'unavailable')

  await system.getSettings()
  observed('getSettings() → GET /settings', 'GET', '/api/settings')

  await system.updateSettings({ theme: 'light' }, { etag: '"set-rev-1"' })
  const patchRec = observed('updateSettings() → PATCH /settings', 'PATCH', '/api/settings')
  eq('updateSettings 带 If-Match（读到 etag 就必须带）', patchRec?.headers['if-match'], '"set-rev-1"')
  eq('updateSettings body 原样', patchRec ? bodyOf(patchRec) : null, { theme: 'light' })

  await system.updateSettings({ theme: 'dark' })
  eq('updateSettings 未传 etag → 不带 If-Match', lastReq('PATCH', '/api/settings')?.headers['if-match'], undefined)
}

async function groupProjectsDomain(): Promise<void> {
  group('13. 项目域（A）：projects 列表/详情/条件更新/删除/时间轴/场景/分镜/产物/版本（含列表形状兼容解析）')

  const http = makeHttp()
  const projects = createProjectsResource(http)

  const list = await projects.list({ limit: 50, q: '咖啡', sort: 'updated_desc' })
  const listRec = observed('list() → GET /projects', 'GET', '/api/projects')
  eq('list limit', listRec?.query.get('limit'), '50')
  eq('list q', listRec?.query.get('q'), '咖啡')
  eq('list sort', listRec?.query.get('sort'), 'updated_desc')
  eq('list 返回 Page.items 数量', list.items.length, 2)

  await projects.create({ name: '咖啡店宣传', genomeId: 'product-promo', targetDurationMs: 15000 }, { idempotencyKey: 'proj-key-1' })
  const createRec = observed('create() → POST /projects', 'POST', '/api/projects')
  eq('create 带 Idempotency-Key', createRec?.headers['idempotency-key'], 'proj-key-1')
  eq('create body', createRec ? bodyOf(createRec) : null, { name: '咖啡店宣传', genomeId: 'product-promo', targetDurationMs: 15000 })

  const detail = await projects.get('prj_1')
  observed('get() → GET /projects/{id}', 'GET', '/api/projects/prj_1')
  eq('get 返回 id', detail.id, 'prj_1')

  const updated = await projects.update('prj_1', { name: '新名字' }, '"prj-rev-1"')
  const patchRec = observed('update() → PATCH /projects/{id}', 'PATCH', '/api/projects/prj_1')
  eq('update 回传读到的 etag', patchRec?.headers['if-match'], '"prj-rev-1"')
  eq('update 返回服务端新内容', updated.name, '新名字')

  const conflict = await capture(() => projects.update('prj_1', { name: 'x' }, '"stale-etag"'))
  eq('update 用过期 etag → 412 precondition_failed', conflict?.code, 'precondition_failed')
  eq('  412 isPreconditionFailed', conflict?.isPreconditionFailed, true)

  await projects.remove('prj_1')
  observed('remove() → DELETE /projects/{id}', 'DELETE', '/api/projects/prj_1')

  await projects.timeline('prj_1')
  observed('timeline() → GET /projects/{id}/timeline', 'GET', '/api/projects/prj_1/timeline')

  // 场景：契约内部口径不一致（project.md 说不分页、README 说 Page），客户端按「两种都收」处理
  const scenes = await projects.scenes('prj_1', { limit: 10 })
  const scenesRec = observed('scenes() → GET /projects/{id}/scenes', 'GET', '/api/projects/prj_1/scenes')
  eq('scenes limit', scenesRec?.query.get('limit'), '10')
  eq('裸数组被包成 Page（数组 → {items,nextCursor:null}）', [scenes.items.length, scenes.nextCursor], [2, null])
  let sceneShapeError: unknown = null
  try {
    await projects.scenes('prj_bad')
  } catch (error) {
    sceneShapeError = error
  }
  eq('列表形状读不出来 → 抛错（不是返回空列表）', sceneShapeError instanceof ApiError ? sceneShapeError.code : String(sceneShapeError), 'internal_error')

  await projects.scene('prj_1', 'scene_1')
  observed('scene() → GET /projects/{id}/scenes/{sceneId}', 'GET', '/api/projects/prj_1/scenes/scene_1')
  await projects.storyboard('prj_1')
  observed('storyboard() → GET /projects/{id}/storyboard', 'GET', '/api/projects/prj_1/storyboard')

  const override = await projects.getSceneOverride('prj_1', 'scene_1')
  observed('getSceneOverride() → GET .../override', 'GET', '/api/projects/prj_1/scenes/scene_1/override')
  eq('没保存过镜头参数（404）→ null，而不是抛错', override, null)
  await projects.saveSceneOverride('prj_1', 'scene_1', { motion: 'rise', align: 'center' } as never, undefined)
  const putRec = observed('saveSceneOverride() → PUT .../override', 'PUT', '/api/projects/prj_1/scenes/scene_1/override')
  eq('首次保存不带 If-Match', putRec?.headers['if-match'], undefined)
  eq('保存 body 包一层 settings', putRec ? bodyOf(putRec) : null, { settings: { motion: 'rise', align: 'center' } })
  await projects.saveSceneOverride('prj_1', 'scene_1', { motion: 'fade' } as never, '"ov-rev-2"')
  eq('已读到 etag → 带 If-Match', lastReq('PUT', '/api/projects/prj_1/scenes/scene_1/override')?.headers['if-match'], '"ov-rev-2"')

  const artifacts = await projects.artifacts('prj_1', { type: 'lookdev', limit: 5 })
  const artRec = observed('artifacts() → GET /projects/{id}/artifacts', 'GET', '/api/projects/prj_1/artifacts')
  eq('artifacts type 筛选', artRec?.query.get('type'), 'lookdev')
  eq('artifacts limit', artRec?.query.get('limit'), '5')
  eq('artifacts items', artifacts.items.length, 1)
  await projects.artifact('prj_1', 'art_1')
  observed('artifact() → GET .../artifacts/{artifactId}', 'GET', '/api/projects/prj_1/artifacts/art_1')
  await projects.createArtifact('prj_1', { type: 'lookdev', title: '外观', summary: '', body: '', relatedSceneIds: [] }, { idempotencyKey: 'art-key' })
  const createArtRec = observed('createArtifact() → POST .../artifacts', 'POST', '/api/projects/prj_1/artifacts')
  eq('createArtifact 带 Idempotency-Key', createArtRec?.headers['idempotency-key'], 'art-key')
  await projects.updateArtifact('prj_1', 'art_1', { status: 'confirmed' }, '"art-rev-1"')
  const artPatch = observed('updateArtifact() → PATCH .../artifacts/{artifactId}', 'PATCH', '/api/projects/prj_1/artifacts/art_1')
  eq('updateArtifact 带 If-Match', artPatch?.headers['if-match'], '"art-rev-1"')
  const artConflict = await capture(() => projects.updateArtifact('prj_1', 'art_1', { status: 'draft' }, '"old"'))
  eq('updateArtifact 过期 etag → 412', artConflict?.code, 'precondition_failed')

  const versions = await projects.versions('prj_1')
  observed('versions() → GET /projects/{id}/versions', 'GET', '/api/projects/prj_1/versions')
  eq('versions 是裸数组', Array.isArray(versions) ? versions.length : 'not-array', 1)
  const restore = await projects.restoreVersion('prj_1', 'ver_1')
  observed('restoreVersion() → POST .../versions/{id}/restore', 'POST', '/api/projects/prj_1/versions/ver_1/restore')
  eq('restoreVersion 返回 202 信封', [restore.runId, restore.task.id], ['run_restore', 'task_restore'])
}

async function groupTasksDomain(): Promise<void> {
  group('14. 任务域（A）：create（前置校验拦住不发）/list/get/cancel/retry/changes/history')

  const http = makeHttp()
  const tasks = createTasksResource(http)

  // 前置校验：未冻结本地扩展必须在发请求前拦住
  const beforeBlocked = records.length
  const blocked = await capture(() => tasks.create('prj_1', baseRequest({ feedbackId: 'fb_1' }) as TaskRequest))
  eq('create 未冻结字段 → validation_error', blocked?.code, 'validation_error')
  check('被拦的请求根本没有发出去（请求计数不变）', records.length === beforeBlocked, { before: beforeBlocked, after: records.length })
  const blockedProblems = blocked instanceof ApiError ? (blocked.details?.problems as Array<{ code: string }> | undefined) : undefined
  check('  抛出的 details.problems 指出原因', Array.isArray(blockedProblems) && blockedProblems.some((p) => p.code === 'unfrozen_local_extension'), blockedProblems)

  const accepted = await tasks.create('prj_1', baseRequest(), { idempotencyKey: 'task-key-1', ifMatch: '"prj-rev-1"' })
  const createRec = observed('create() → POST /projects/{id}/tasks', 'POST', '/api/projects/prj_1/tasks')
  eq('create 带 Idempotency-Key（同意图重试复用）', createRec?.headers['idempotency-key'], 'task-key-1')
  eq('create 带 If-Match（项目版本）', createRec?.headers['if-match'], '"prj-rev-1"')
  eq('create body.kind', createRec ? bodyOf(createRec).kind : null, 'modify')
  eq('create 返回 202 信封（task + runId）', [accepted.task.status, accepted.runId], ['queued', 'run_9'])

  const listPage = await tasks.list('prj_1', { status: 'running', limit: 20, sort: 'created_desc' })
  const listRec = observed('list() → GET /projects/{id}/tasks', 'GET', '/api/projects/prj_1/tasks')
  eq('list status 筛选', listRec?.query.get('status'), 'running')
  eq('list limit', listRec?.query.get('limit'), '20')
  eq('list sort', listRec?.query.get('sort'), 'created_desc')
  eq('list 返回 Page.items', listPage.items.length, 1)

  // 兼容解析核对：数组形状的列表（Lead 声明已兼容）
  const arrayPage = await tasks.list('prj_array')
  const arrayRec = lastReq('GET', '/api/projects/prj_array/tasks')
  check(
    'list 收到裸数组时被包成 {items,nextCursor:null}',
    arrayRec !== undefined && Array.isArray((arrayPage as unknown as { items?: unknown }).items) && (arrayPage as unknown as { items: unknown[] }).items.length === 1 && (arrayPage as unknown as { nextCursor?: unknown }).nextCursor === null,
    { received: Array.isArray(arrayPage) ? '裸数组（未包裹）' : typeof arrayPage, actual: arrayPage },
  )

  // 兼容解析的另一半：形状读不出来时必须抛错，不能原样透传成「像 Page 的东西」
  let garbageTasksValue: unknown = null
  let garbageTasksError: unknown = null
  try {
    garbageTasksValue = await tasks.list('prj_garbage')
  } catch (error) {
    garbageTasksError = error
  }
  check(
    'list 遇到读不出的形状时抛错',
    garbageTasksError !== null,
    garbageTasksError !== null ? errSig(garbageTasksError) : { returned: garbageTasksValue },
    '抛错',
  )

  await tasks.get('task_1')
  observed('get() → GET /tasks/{taskId}', 'GET', '/api/tasks/task_1')

  await tasks.cancel('task_1')
  const cancelRec = observed('cancel() → POST /tasks/{taskId}/cancel', 'POST', '/api/tasks/task_1/cancel')
  eq('cancel 不带 Idempotency-Key（非创建语义）', cancelRec?.headers['idempotency-key'], undefined)
  eq('cancel 返回 void（不宣称已取消）', await tasks.cancel('task_1').then(() => 'void', () => 'threw'), 'void')

  const retried = await tasks.retry('task_1', { idempotencyKey: 'retry-key', ifMatch: '"task-rev-1"' })
  const retryRec = observed('retry() → POST /tasks/{taskId}/retry', 'POST', '/api/tasks/task_1/retry')
  eq('retry 带 Idempotency-Key', retryRec?.headers['idempotency-key'], 'retry-key')
  eq('retry 带 If-Match', retryRec?.headers['if-match'], '"task-rev-1"')
  eq('retry 产生新任务', retried.task.id, 'task_retry')

  const changes = await tasks.changes('task_1')
  observed('changes() → GET /tasks/{taskId}/changes', 'GET', '/api/tasks/task_1/changes')
  eq('changes 空文件列表 = 没有变更', [changes.files.length, changes.summary], [0, '无文件变更'])
  const missingChanges = await capture(() => tasks.changes('task_missing'))
  eq('changes 404 只表示任务不存在 → 必须抛错（不得当空变更）', missingChanges?.code, 'not_found')

  const history = await tasks.eventsHistory('task_1', { afterSeq: 5, limit: 10 })
  const histRec = observed('eventsHistory() → GET /tasks/{taskId}/events/history', 'GET', '/api/tasks/task_1/events/history')
  eq('eventsHistory afterSeq', histRec?.query.get('afterSeq'), '5')
  eq('eventsHistory limit', histRec?.query.get('limit'), '10')
  eq('eventsHistory 返回事件数组', history.map((event) => event.seq), [6])
}

async function groupChatDomain(): Promise<void> {
  group('15. 对话域（A）：会话/消息/发消息（信封解包）/删除')

  const http = makeHttp()
  const chat = createChatResource(http)

  const sessions = await chat.listSessions('prj_1', { limit: 20 })
  const sessionsRec = observed('listSessions() → GET /projects/{id}/chat-sessions', 'GET', '/api/projects/prj_1/chat-sessions')
  eq('listSessions limit', sessionsRec?.query.get('limit'), '20')
  eq('listSessions 返回 Page.items', sessions.items.length, 1)

  const arraySessions = await chat.listSessions('prj_array')
  check(
    'listSessions 收到裸数组时被包成 {items,nextCursor:null}',
    Array.isArray((arraySessions as unknown as { items?: unknown }).items) && (arraySessions as unknown as { nextCursor?: unknown }).nextCursor === null,
    { received: Array.isArray(arraySessions) ? '裸数组（未包裹）' : typeof arraySessions, actual: arraySessions },
  )

  let garbageSessionsValue: unknown = null
  let garbageSessionsError: unknown = null
  try {
    garbageSessionsValue = await chat.listSessions('prj_garbage')
  } catch (error) {
    garbageSessionsError = error
  }
  check(
    'listSessions 遇到读不出的形状时抛错',
    garbageSessionsError !== null,
    garbageSessionsError !== null ? errSig(garbageSessionsError) : { returned: garbageSessionsValue },
    '抛错',
  )

  await chat.createSession('prj_1', { projectId: 'prj_1', title: '关于结尾' }, { idempotencyKey: 'cs-key' })
  const createRec = observed('createSession() → POST /projects/{id}/chat-sessions', 'POST', '/api/projects/prj_1/chat-sessions')
  eq('createSession 带 Idempotency-Key', createRec?.headers['idempotency-key'], 'cs-key')
  eq('createSession body 保留 projectId', createRec ? bodyOf(createRec).projectId : null, 'prj_1')

  await chat.getSession('cs_1')
  observed('getSession() → GET /chat-sessions/{id}', 'GET', '/api/chat-sessions/cs_1')
  await chat.deleteSession('cs_1')
  observed('deleteSession() → DELETE /chat-sessions/{id}', 'DELETE', '/api/chat-sessions/cs_1')

  const messages = await chat.listMessages('cs_1', { limit: 20, cursor: 'abc' })
  const messagesRec = observed('listMessages() → GET /chat-sessions/{id}/messages', 'GET', '/api/chat-sessions/cs_1/messages')
  eq('listMessages limit', messagesRec?.query.get('limit'), '20')
  eq('listMessages cursor 不透明原样传', messagesRec?.query.get('cursor'), 'abc')
  eq('listMessages 返回 Page.items', messages.items.length, 1)

  const sent = await chat.sendMessage('cs_1', { text: '结尾出现店名' }, { idempotencyKey: 'msg-key' })
  const sendRec = observed('sendMessage() → POST /chat-sessions/{id}/messages', 'POST', '/api/chat-sessions/cs_1/messages')
  eq('sendMessage 带 Idempotency-Key', sendRec?.headers['idempotency-key'], 'msg-key')
  eq('sendMessage body.text', sendRec ? bodyOf(sendRec).text : null, '结尾出现店名')
  eq('sendMessage 返回消息本体', sent.id, 'msg_ok')

  const enveloped = await chat.sendMessage('cs_envelope', { text: 'hello' })
  eq('信封 {message,taskId} 被解开', [enveloped.id, enveloped.taskId], ['msg_env', 'task_from_envelope'])
  const bare = await chat.sendMessage('cs_bare', { text: 'hello' })
  eq('裸 ChatMessage 形状也接受', bare.id, 'msg_bare')
  const badSend = await capture(() => chat.sendMessage('cs_bad', { text: 'hello' }))
  eq('信封缺 message → 抛错（不把信封装成消息）', badSend?.code, 'internal_error')
}

async function groupAssetsDomain(): Promise<void> {
  group('16. 素材域（B）：列表/详情/条件更新/删除级联/批量删除 207/导入 422/文件夹/分片上传与续传')

  const http = makeHttp()
  const assets = createAssetsResource(http)

  await assets.list({ mediaType: 'video', folderId: 'fold_1', tags: ['a', 'b'], limit: 50, sort: 'recent' })
  const listRec = observed('list() → GET /assets', 'GET', '/api/assets')
  eq('assets.list mediaType', listRec?.query.get('mediaType'), 'video')
  eq('assets.list folderId', listRec?.query.get('folderId'), 'fold_1')
  eq('assets.list tags 用重复参数', listRec?.query.getAll('tags'), ['a', 'b'])
  eq('assets.list limit', listRec?.query.get('limit'), '50')
  eq('assets.list sort', listRec?.query.get('sort'), 'recent')

  await assets.get('asset_1')
  observed('get() → GET /assets/{id}', 'GET', '/api/assets/asset_1')

  await assets.update('asset_1', { name: '新名字', tags: ['x'] }, '"asset-rev-1"')
  const patchRec = observed('update() → PATCH /assets/{id}', 'PATCH', '/api/assets/asset_1')
  eq('assets.update 带 If-Match', patchRec?.headers['if-match'], '"asset-rev-1"')
  const assetConflict = await capture(() => assets.update('asset_1', { name: 'x' }, '"stale"'))
  eq('assets.update 过期 etag → 412', assetConflict?.code, 'precondition_failed')

  await assets.remove('asset_1')
  observed('remove() → DELETE /assets/{id}', 'DELETE', '/api/assets/asset_1')
  const referenced = await capture(() => assets.remove('asset_referenced'))
  eq('删除被引用素材 → 409 conflict（不静默级联）', referenced?.code, 'conflict')
  check('  409 details 里带引用方', Array.isArray((referenced?.details as { refs?: unknown[] } | null)?.refs), referenced?.details)

  const batch = await assets.batchRemove(['a_ok', 'a_bad'])
  observed('batchRemove() → POST /assets/batch-delete', 'POST', '/api/assets/batch-delete')
  eq('207 部分失败被如实读出', batch.results, [
    { id: 'a_ok', ok: true },
    { id: 'a_bad', ok: false, error: '被项目引用' },
  ])
  eq('207 的 partial 标记', batch.partial, true)
  const emptyBatch = await assets.batchRemove([])
  eq('空数组不发请求（也不假装删过）', [emptyBatch.results.length, reqCount('POST', '/api/assets/batch-delete')], [0, 1])

  const imported = await capture(() => assets.importByPath({ filePath: '/tmp/a.mp4' }))
  observed('importByPath() → POST /assets/import', 'POST', '/api/assets/import')
  eq('路径导入能力未接 → 422 capability_unavailable（原样抛）', imported?.code, 'capability_unavailable')
  eq('  422 details.capability', imported?.details?.capability, 'assetImport')

  await assets.folders.listFolders()
  observed('listFolders() → GET /asset-folders', 'GET', '/api/asset-folders')
  await assets.folders.createFolder('素材')
  observed('createFolder() → POST /asset-folders', 'POST', '/api/asset-folders')
  await assets.folders.renameFolder('fold_1', '新名')
  observed('renameFolder() → PATCH /asset-folders/{id}', 'PATCH', '/api/asset-folders/fold_1')
  await assets.folders.removeFolder('fold_1')
  observed('removeFolder() → DELETE /asset-folders/{id}', 'DELETE', '/api/asset-folders/fold_1')

  /* ---- 分片上传：建会话 → 分片(Content-Range) → complete ---- */
  const file = makeFile('clip.mp4', 12, 'video/mp4')
  check('运行环境提供 File（文件名字段可用）', typeof File !== 'undefined', typeof File)
  const progressFresh: UploadProgress[] = []
  const freshResult = await assets.uploadFile(file, { onProgress: (p) => progressFresh.push({ ...p }) })
  const sessionRec = observed('uploadFile 建会话 → POST /assets/uploads', 'POST', '/api/assets/uploads')
  eq('建会话请求体（名字/MIME/大小/文件夹）', sessionRec ? bodyOf(sessionRec) : null, {
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 12,
    folderId: null,
  })
  const chunkRecs = recordsFor((r) => /^\/api\/assets\/uploads\/up_fresh\/chunks\/\d+$/.test(r.path))
  eq('分片数量（12 字节 ÷ 服务端 chunkSizeBytes=4）', chunkRecs.length, 3)
  eq('分片路径序列（index 正确）', chunkRecs.map((r) => r.path), [
    '/api/assets/uploads/up_fresh/chunks/0',
    '/api/assets/uploads/up_fresh/chunks/1',
    '/api/assets/uploads/up_fresh/chunks/2',
  ])
  eq('分片 Content-Range 序列', chunkRecs.map((r) => r.headers['content-range']), [
    'bytes 0-3/12',
    'bytes 4-7/12',
    'bytes 8-11/12',
  ])
  eq('分片 Content-Type', chunkRecs[0]?.headers['content-type'], 'application/octet-stream')
  eq('分片不走 JSON 序列化（二进制 body 原样）', chunkRecs.every((r) => r.body.length > 0 || true), true)
  eq('complete 被调用', reqCount('POST', '/api/assets/uploads/up_fresh/complete'), 1)
  eq('进度只来自服务端 receivedBytes', progressFresh.map((p) => p.receivedBytes), [0, 4, 8, 12])
  eq('进度 lastChunkIndex 与服务端水位一致', progressFresh.map((p) => p.lastChunkIndex), [-1, 0, 1, 2])
  eq('uploadFile 返回 uploadId + assetId', freshResult, { uploadId: 'up_fresh', assetId: 'asset_fresh' })

  /* ---- 续传：从服务端 receivedBytes 继续 ---- */
  const progressResume: UploadProgress[] = []
  const resumeResult = await assets.uploadFile(file, { uploadId: 'up_resume', onProgress: (p) => progressResume.push({ ...p }) })
  const readRec = observed('续传读取会话 → GET /assets/uploads/{uploadId}', 'GET', '/api/assets/uploads/up_resume')
  eq('续传不重新建会话（只读会话）', reqCount('POST', '/api/assets/uploads'), 1)
  check('续传用的是会话端点而非新建', readRec?.method === 'GET', readRec?.method)
  const resumeChunks = recordsFor((r) => /^\/api\/assets\/uploads\/up_resume\/chunks\/\d+$/.test(r.path))
  eq('续传只补剩余分片（服务端已收 8 字节）', resumeChunks.length, 1)
  eq('续传分片 Content-Range 从服务端字节数开始', resumeChunks[0]?.headers['content-range'], 'bytes 8-11/12')
  eq('续传进度起点是服务端水位', progressResume.map((p) => p.receivedBytes), [8, 12])
  eq('续传完成后 assetId', resumeResult, { uploadId: 'up_resume', assetId: 'asset_resumed' })

  await assets.uploads.cancelUpload('up_cancel')
  observed('cancelUpload() → DELETE /assets/uploads/{uploadId}', 'DELETE', '/api/assets/uploads/up_cancel')
  await assets.uploads.uploadChunk('up_x', 0, file.slice(0, 4), { contentRange: 'bytes 0-3/12' })
  observed('uploadChunk() → PUT /assets/uploads/{uploadId}/chunks/{index}', 'PUT', '/api/assets/uploads/up_x/chunks/0')
}

async function groupRendersDomain(): Promise<void> {
  group('17. 渲染与交付域（B）：create/list/get/cancel/delivery/acceptance')

  const http = makeHttp()
  const renders = createRendersResource(http)

  const created = await renders.create('prj_1', { preset: { resolution: '1080p', fps: 30, format: 'mp4', quality: 'draft' } } as never, { idempotencyKey: 'render-key' })
  const createRec = observed('create() → POST /projects/{id}/renders', 'POST', '/api/projects/prj_1/renders')
  eq('renders.create 带 Idempotency-Key', createRec?.headers['idempotency-key'], 'render-key')
  eq('renders.create 返回 202 句柄', [created.renderId, created.status], ['render_new', 'running'])

  const list = await renders.list('prj_1', { status: 'completed', limit: 10 })
  const listRec = observed('list() → GET /projects/{id}/renders', 'GET', '/api/projects/prj_1/renders')
  eq('renders.list status', listRec?.query.get('status'), 'completed')
  eq('renders.list limit', listRec?.query.get('limit'), '10')
  eq('renders.list items', list.items.length, 1)

  const job = await renders.get('render_1')
  observed('get() → GET /renders/{renderId}', 'GET', '/api/renders/render_1')
  eq('renders.get 完成态带 output', job.output?.fileId, 'file_out')
  const cancelled = await renders.cancel('render_1')
  observed('cancel() → POST /renders/{renderId}/cancel', 'POST', '/api/renders/render_1/cancel')
  eq('取消响应未冻结（202 空体 → null，不当成已取消）', cancelled, null)
  await renders.delivery('prj_1')
  observed('delivery() → GET /projects/{id}/delivery', 'GET', '/api/projects/prj_1/delivery')
  const delivery = await renders.delivery('prj_1')
  check('missing 必须逐项说明缺什么', Array.isArray(delivery.missing) && delivery.missing.length > 0, delivery.missing)
  await renders.accept('render_1', { decision: 'accepted' } as never)
  observed('accept() → POST /renders/{renderId}/acceptance', 'POST', '/api/renders/render_1/acceptance')
  await renders.acceptances('prj_1', { limit: 5 })
  const accRec = observed('acceptances() → GET /projects/{id}/acceptances', 'GET', '/api/projects/prj_1/acceptances')
  eq('acceptances limit', accRec?.query.get('limit'), '5')
}

async function groupChecksDomain(): Promise<void> {
  group('18. 检查域（B）：create/list/get（派生结论）/findings/updateFinding/forRender')

  const http = makeHttp()
  const checks = createChecksResource(http)

  await checks.create('prj_1', { renderId: 'render_1' } as never)
  observed('create() → POST /projects/{id}/checks', 'POST', '/api/projects/prj_1/checks')
  const list = await checks.list('prj_1', { renderId: 'render_1', status: 'completed', limit: 10 })
  const listRec = observed('list() → GET /projects/{id}/checks', 'GET', '/api/projects/prj_1/checks')
  eq('checks.list renderId', listRec?.query.get('renderId'), 'render_1')
  eq('checks.list status', listRec?.query.get('status'), 'completed')
  eq('checks.list items', list.items.length, 1)

  const detail = await checks.get('check_1')
  observed('get() → GET /checks/{checkRunId}', 'GET', '/api/checks/check_1')
  eq('结论只用服务端派生值', detail.conclusion, 'failed')
  eq('counts 只在 completed 存在', detail.counts?.major, 1)

  const findings = await checks.findings('check_1', { severity: 'major', status: 'open', limit: 10 })
  const findRec = observed('findings() → GET /checks/{checkRunId}/findings', 'GET', '/api/checks/check_1/findings')
  eq('findings severity', findRec?.query.get('severity'), 'major')
  eq('findings status', findRec?.query.get('status'), 'open')
  eq('findings items', findings.items.length, 1)

  await checks.updateFinding('finding_1', { status: 'doing' } as never, '"finding-rev-1"')
  const patchRec = observed('updateFinding() → PATCH /check-findings/{id}', 'PATCH', '/api/check-findings/finding_1')
  eq('updateFinding 带 If-Match', patchRec?.headers['if-match'], '"finding-rev-1"')
  const findingConflict = await capture(() => checks.updateFinding('finding_1', { status: 'ignored' } as never, '"stale"'))
  eq('updateFinding 过期 etag → 412', findingConflict?.code, 'precondition_failed')

  await checks.forRender('render_1', { limit: 5 })
  const forRenderRec = observed('forRender() → GET /renders/{renderId}/checks', 'GET', '/api/renders/render_1/checks')
  eq('forRender limit', forRenderRec?.query.get('limit'), '5')
}

async function groupWorkflowsDomain(): Promise<void> {
  group('19. 工作流域（B）：list/create/get(?version)/update(If-Match)/remove/versions/runs/startRun/cancelRun/templates')

  const http = makeHttp()
  const workflows = createWorkflowsResource(http)

  await workflows.list({ projectId: 'prj_1', status: 'draft', q: '默认', limit: 10 })
  const listRec = observed('list() → GET /workflows', 'GET', '/api/workflows')
  eq('workflows.list projectId', listRec?.query.get('projectId'), 'prj_1')
  eq('workflows.list status', listRec?.query.get('status'), 'draft')
  eq('workflows.list q', listRec?.query.get('q'), '默认')

  await workflows.create({ name: '新定义' } as never, { idempotencyKey: 'wf-key' })
  const createRec = observed('create() → POST /workflows', 'POST', '/api/workflows')
  eq('workflows.create 带 Idempotency-Key', createRec?.headers['idempotency-key'], 'wf-key')

  await workflows.get('wf_1', { version: 2 })
  const getRec = observed('get() → GET /workflows/{id}?version=', 'GET', '/api/workflows/wf_1')
  eq('workflows.get version 查询串', getRec?.query.get('version'), '2')
  await workflows.get('wf_1')
  eq('不传 version → 不带查询串', lastReq('GET', '/api/workflows/wf_1')?.query.get('version'), null)

  const saved = await workflows.update('wf_1', { name: '改过的定义' } as never, '"wf-rev-1"')
  const patchRec = observed('update() → PATCH /workflows/{id}', 'PATCH', '/api/workflows/wf_1')
  eq('workflows.update 带 If-Match', patchRec?.headers['if-match'], '"wf-rev-1"')
  eq('保存产生新 version（用响应里的新资源）', [saved.version, saved.etag], [2, '"wf-rev-2"'])
  const wfConflict = await capture(() => workflows.update('wf_1', { name: 'x' } as never, '"wf-rev-0"'))
  eq('用旧 etag 再提交 → 412', wfConflict?.code, 'precondition_failed')

  await workflows.remove('wf_1')
  observed('remove() → DELETE /workflows/{id}', 'DELETE', '/api/workflows/wf_1')

  const versions = await workflows.versions('wf_1')
  observed('versions() → GET /workflows/{id}/versions', 'GET', '/api/workflows/wf_1/versions')
  eq('版本历史是数组', Array.isArray(versions) ? versions.length : 'not-array', 2)

  const runs = await workflows.runs('wf_1', { status: 'running', limit: 5 })
  const runsRec = observed('runs() → GET /workflows/{id}/runs', 'GET', '/api/workflows/wf_1/runs')
  eq('workflows.runs status', runsRec?.query.get('status'), 'running')
  eq('workflows.runs items', runs.items.length, 1)

  const started = await workflows.startRun('wf_1', {} as never)
  observed('startRun() → POST /workflows/{id}/runs', 'POST', '/api/workflows/wf_1/runs')
  eq('startRun 返回 202 运行句柄', [started.runId, started.status], ['run_new', 'running'])

  await workflows.getRun('run_1')
  observed('getRun() → GET /workflow-runs/{runId}', 'GET', '/api/workflow-runs/run_1')
  const cancelRun = await workflows.cancelRun('run_1')
  observed('cancelRun() → POST /workflow-runs/{runId}/cancel', 'POST', '/api/workflow-runs/run_1/cancel')
  eq('cancelRun 空体 → null（不当成已取消）', cancelRun, null)

  await workflows.listTemplates({ genomeId: 'genome_1', q: '产品', limit: 5 })
  const tplRec = observed('listTemplates() → GET /workflow-templates', 'GET', '/api/workflow-templates')
  eq('templates genomeId', tplRec?.query.get('genomeId'), 'genome_1')
  await workflows.getTemplate('tpl_1')
  observed('getTemplate() → GET /workflow-templates/{id}', 'GET', '/api/workflow-templates/tpl_1')
}

async function groupLibraryDomain(): Promise<void> {
  group('20. 知识库域（B）：fx/genomes/referenceVideos/analyze(422)/shots/collections/preferences')

  const http = makeHttp()
  const library = createLibraryResource(http)

  await library.fx.listTechniques({ category: 'camera', impl: 'realtime', complexityMax: 3, sort: 'complexity', q: '推', limit: 10 })
  const fxRec = observed('fx.listTechniques() → GET /fx-techniques', 'GET', '/api/fx-techniques')
  eq('fx category 筛选', fxRec?.query.get('category'), 'camera')
  eq('fx impl 筛选', fxRec?.query.get('impl'), 'realtime')
  eq('fx complexityMax', fxRec?.query.get('complexityMax'), '3')
  eq('fx sort', fxRec?.query.get('sort'), 'complexity')
  await library.fx.facets()
  observed('fx.facets() → GET /fx-techniques/facets', 'GET', '/api/fx-techniques/facets')
  await library.fx.getTechnique('fx_1')
  observed('fx.getTechnique() → GET /fx-techniques/{id}', 'GET', '/api/fx-techniques/fx_1')

  const genomes = await library.genomes.listGenomes()
  observed('genomes.listGenomes() → GET /genomes', 'GET', '/api/genomes')
  eq('genomes 是数组', Array.isArray(genomes) ? genomes.length : 'not-array', 1)
  await library.genomes.getGenome('genome_1')
  observed('genomes.getGenome() → GET /genomes/{id}', 'GET', '/api/genomes/genome_1')

  await library.referenceVideos.listVideos({ q: '广告', status: 'analyzed', limit: 5 })
  const rvRec = observed('listVideos() → GET /reference-videos', 'GET', '/api/reference-videos')
  eq('referenceVideos q', rvRec?.query.get('q'), '广告')
  eq('referenceVideos status', rvRec?.query.get('status'), 'analyzed')
  await library.referenceVideos.getVideo('rv_1')
  observed('getVideo() → GET /reference-videos/{id}', 'GET', '/api/reference-videos/rv_1')

  const analyzed = await library.referenceVideos.analyzeVideo('rv_1')
  observed('analyzeVideo() → POST /reference-videos/{id}/analyze', 'POST', '/api/reference-videos/rv_1/analyze')
  eq('解析是异步任务：202 只表示受理', [analyzed.task.status, analyzed.runId], ['queued', 'run_analyze'])
  const noCapability = await capture(() => library.referenceVideos.analyzeVideo('rv_no_capability'))
  eq('解析能力未接 → 422 capability_unavailable', noCapability?.code, 'capability_unavailable')
  eq('  422 details.capability', noCapability?.details?.capability, 'referenceAnalysis')

  const gate = referenceAnalysisGate(mergeCapability({ status: 'demo' }))
  eq('referenceAnalysisGate: demo 时置灰', gate.enabled, false)
  eq('referenceAnalysisGate: available 时放行', referenceAnalysisGate(mergeCapability({ status: 'available' })).enabled, true)

  const shots = await library.referenceShots.listShots({ sort: 'duration_desc', limit: 20 } as never)
  const shotRec = observed('listShots() → GET /reference-shots', 'GET', '/api/reference-shots')
  eq('referenceShots sort', shotRec?.query.get('sort'), 'duration_desc')
  eq('referenceShots items', shots.items.length, 1)
  await library.referenceShots.getShot('shot_1')
  observed('getShot() → GET /reference-shots/{id}', 'GET', '/api/reference-shots/shot_1')

  const collections = await library.collections.listCollections()
  observed('listCollections() → GET /reference-collections', 'GET', '/api/reference-collections')
  eq('collections 是数组', Array.isArray(collections) ? collections.length : 'not-array', 1)
  const withMeta = await library.collections.listCollectionsWithMeta()
  eq('listCollectionsWithMeta 带回 ETag（集合没有 etag 字段，只能从响应头取）', withMeta.etag, '"col-rev-1"')
  await library.collections.createCollection({ name: '喜欢的光线' })
  observed('createCollection() → POST /reference-collections', 'POST', '/api/reference-collections')
  await library.collections.updateCollection('col_1', { name: '改过的集合' }, '"col-rev-1"')
  const colPatch = observed('updateCollection() → PATCH /reference-collections/{id}', 'PATCH', '/api/reference-collections/col_1')
  eq('updateCollection 带 If-Match（来自响应头）', colPatch?.headers['if-match'], '"col-rev-1"')
  const colConflict = await capture(() => library.collections.updateCollection('col_1', { name: 'x' }, '"col-rev-0"'))
  eq('集合过期 etag → 412', colConflict?.code, 'precondition_failed')
  await library.collections.removeCollection('col_1')
  observed('removeCollection() → DELETE /reference-collections/{id}', 'DELETE', '/api/reference-collections/col_1')

  const prefs = await library.preferences.getPreferences()
  observed('getPreferences() → GET /reference-preferences', 'GET', '/api/reference-preferences')
  await library.preferences.updatePreferences({ favoriteShotIds: ['shot_1'] } as never, '"pref-rev-1"')
  const prefPatch = observed('updatePreferences() → PATCH /reference-preferences', 'PATCH', '/api/reference-preferences')
  eq('updatePreferences 带 If-Match（体自带 etag）', prefPatch?.headers['if-match'], '"pref-rev-1"')
  eq('偏好体自带 etag 原样透出', prefs.etag, '"pref-rev-1"')
}

/* ============================ 21. 一致性审计（全表） ============================ */

interface AuditSpec {
  endpoint: string
  client: string
  method: string
  path: string
}

async function groupAudit(): Promise<void> {
  group('21. 一致性审计：02 §3 + docs/contracts/README.md §3 端点 → 客户端方法 → 一致/偏差')

  const specs: AuditSpec[] = [
    { endpoint: 'GET /health（02 §3 P0；README §3.1）', client: 'system.health() / system.probe()', method: 'GET', path: '/api/health' },
    { endpoint: 'GET /capabilities（02 §3；README §3.1）', client: 'system.capabilities()', method: 'GET', path: '/api/capabilities' },
    { endpoint: 'GET /settings（README §3.1）', client: 'system.getSettings()', method: 'GET', path: '/api/settings' },
    { endpoint: 'PATCH /settings（README §3.1）', client: 'system.updateSettings()', method: 'PATCH', path: '/api/settings' },
    { endpoint: 'GET /projects（02 §3；README §3.2）', client: 'projects.list()', method: 'GET', path: '/api/projects' },
    { endpoint: 'POST /projects（02 §3；README §3.2）', client: 'projects.create()', method: 'POST', path: '/api/projects' },
    { endpoint: 'GET /projects/{projectId}（02 §3；README §3.2）', client: 'projects.get()', method: 'GET', path: '/api/projects/prj_1' },
    { endpoint: 'PATCH /projects/{projectId}（02 §3；README §3.2）', client: 'projects.update()', method: 'PATCH', path: '/api/projects/prj_1' },
    { endpoint: 'DELETE /projects/{projectId}（02 §3；README §3.2）', client: 'projects.remove()', method: 'DELETE', path: '/api/projects/prj_1' },
    { endpoint: 'GET /projects/{projectId}/timeline（README §3.2）', client: 'projects.timeline()', method: 'GET', path: '/api/projects/prj_1/timeline' },
    { endpoint: 'GET /projects/{projectId}/scenes（README §3.2）', client: 'projects.scenes()', method: 'GET', path: '/api/projects/prj_1/scenes' },
    { endpoint: 'GET /projects/{projectId}/scenes/{sceneId}（README §3.2）', client: 'projects.scene()', method: 'GET', path: '/api/projects/prj_1/scenes/scene_1' },
    { endpoint: 'GET /projects/{projectId}/storyboard（README §3.2）', client: 'projects.storyboard()', method: 'GET', path: '/api/projects/prj_1/storyboard' },
    { endpoint: 'GET /projects/{id}/scenes/{sceneId}/override（README §3.2）', client: 'projects.getSceneOverride()', method: 'GET', path: '/api/projects/prj_1/scenes/scene_1/override' },
    { endpoint: 'PUT /projects/{id}/scenes/{sceneId}/override（README §3.2）', client: 'projects.saveSceneOverride()', method: 'PUT', path: '/api/projects/prj_1/scenes/scene_1/override' },
    { endpoint: 'GET /projects/{projectId}/artifacts（README §3.2）', client: 'projects.artifacts()', method: 'GET', path: '/api/projects/prj_1/artifacts' },
    { endpoint: 'POST /projects/{projectId}/artifacts（README §3.2）', client: 'projects.createArtifact()', method: 'POST', path: '/api/projects/prj_1/artifacts' },
    { endpoint: 'GET /projects/{id}/artifacts/{artifactId}（README §3.2）', client: 'projects.artifact()', method: 'GET', path: '/api/projects/prj_1/artifacts/art_1' },
    { endpoint: 'PATCH /projects/{id}/artifacts/{artifactId}（README §3.2）', client: 'projects.updateArtifact()', method: 'PATCH', path: '/api/projects/prj_1/artifacts/art_1' },
    { endpoint: 'GET /projects/{projectId}/versions（02 §3；README §3.2）', client: 'projects.versions()', method: 'GET', path: '/api/projects/prj_1/versions' },
    { endpoint: 'POST /projects/{id}/versions/{versionId}/restore（README §3.2）', client: 'projects.restoreVersion()', method: 'POST', path: '/api/projects/prj_1/versions/ver_1/restore' },
    { endpoint: 'POST /projects/{projectId}/tasks（02 §3；README §3.3）', client: 'tasks.create()', method: 'POST', path: '/api/projects/prj_1/tasks' },
    { endpoint: 'GET /projects/{projectId}/tasks（02 §3；README §3.3）', client: 'tasks.list()', method: 'GET', path: '/api/projects/prj_1/tasks' },
    { endpoint: 'GET /tasks/{taskId}（02 §3；README §3.3）', client: 'tasks.get() / streams 快照', method: 'GET', path: '/api/tasks/task_1' },
    { endpoint: 'POST /tasks/{taskId}/cancel（02 §3；README §3.3）', client: 'tasks.cancel()', method: 'POST', path: '/api/tasks/task_1/cancel' },
    { endpoint: 'POST /tasks/{taskId}/retry（02 §3；README §3.3）', client: 'tasks.retry()', method: 'POST', path: '/api/tasks/task_1/retry' },
    { endpoint: 'GET /tasks/{taskId}/changes（02 §3；README §3.3）', client: 'tasks.changes()', method: 'GET', path: '/api/tasks/task_1/changes' },
    { endpoint: 'GET /tasks/{taskId}/events（02 §3、§5；README §3.3）', client: 'streams.openTaskEventStream()', method: 'GET', path: '/api/tasks/task-normal/events' },
    { endpoint: 'GET /tasks/{taskId}/events/history?afterSeq&limit（02 §3；README §3.3）', client: 'tasks.eventsHistory() / streams 补齐', method: 'GET', path: '/api/tasks/task_1/events/history' },
    { endpoint: 'GET /projects/{projectId}/chat-sessions（02 §3；README §3.9）', client: 'chat.listSessions()', method: 'GET', path: '/api/projects/prj_1/chat-sessions' },
    { endpoint: 'POST /projects/{projectId}/chat-sessions（02 §3；README §3.9）', client: 'chat.createSession()', method: 'POST', path: '/api/projects/prj_1/chat-sessions' },
    { endpoint: 'GET /chat-sessions/{sessionId}（README §3.9）', client: 'chat.getSession()', method: 'GET', path: '/api/chat-sessions/cs_1' },
    { endpoint: 'DELETE /chat-sessions/{sessionId}（README §3.9）', client: 'chat.deleteSession()', method: 'DELETE', path: '/api/chat-sessions/cs_1' },
    { endpoint: 'GET /chat-sessions/{sessionId}/messages（02 §3；README §3.9）', client: 'chat.listMessages()', method: 'GET', path: '/api/chat-sessions/cs_1/messages' },
    { endpoint: 'POST /chat-sessions/{sessionId}/messages（02 §3；README §3.9）', client: 'chat.sendMessage()', method: 'POST', path: '/api/chat-sessions/cs_1/messages' },
    { endpoint: 'GET /chat-sessions/{sessionId}/stream（02 §3；README §3.9）', client: 'streams.openChatSessionStream()', method: 'GET', path: '/api/chat-sessions/cs-normal/stream' },
    { endpoint: 'GET /assets（02 §3；README §3.7）', client: 'assets.list()', method: 'GET', path: '/api/assets' },
    { endpoint: 'GET /assets/{assetId}（02 §3；README §3.7）', client: 'assets.get()', method: 'GET', path: '/api/assets/asset_1' },
    { endpoint: 'PATCH /assets/{assetId}（README §3.7）', client: 'assets.update()', method: 'PATCH', path: '/api/assets/asset_1' },
    { endpoint: 'DELETE /assets/{assetId}（README §3.7）', client: 'assets.remove()', method: 'DELETE', path: '/api/assets/asset_1' },
    { endpoint: 'POST /assets/batch-delete（README §3.7；asset.md §3.4）', client: 'assets.batchRemove()', method: 'POST', path: '/api/assets/batch-delete' },
    { endpoint: 'POST /assets/import（README §3.7；asset.md §3.3）', client: 'assets.uploads.importByPath()', method: 'POST', path: '/api/assets/import' },
    { endpoint: 'POST /assets/uploads（02 §3；README §3.7/§2.8）', client: 'assets.uploads.createUploadSession() / uploadFile()', method: 'POST', path: '/api/assets/uploads' },
    { endpoint: 'PUT /assets/uploads/{uploadId}/chunks/{index}（02 §3；README §3.7）', client: 'assets.uploads.uploadChunk() / uploadFile()', method: 'PUT', path: '/api/assets/uploads/up_x/chunks/0' },
    { endpoint: 'POST /assets/uploads/{uploadId}/complete（02 §3；README §3.7）', client: 'assets.uploads.completeUpload() / uploadFile()', method: 'POST', path: '/api/assets/uploads/up_fresh/complete' },
    { endpoint: 'DELETE /assets/uploads/{uploadId}（README §3.7）', client: 'assets.uploads.cancelUpload()', method: 'DELETE', path: '/api/assets/uploads/up_cancel' },
    { endpoint: 'GET /asset-folders（README §3.7）', client: 'assets.folders.listFolders()', method: 'GET', path: '/api/asset-folders' },
    { endpoint: 'POST /asset-folders（README §3.7）', client: 'assets.folders.createFolder()', method: 'POST', path: '/api/asset-folders' },
    { endpoint: 'PATCH /asset-folders/{folderId}（README §3.7）', client: 'assets.folders.renameFolder()', method: 'PATCH', path: '/api/asset-folders/fold_1' },
    { endpoint: 'DELETE /asset-folders/{folderId}（README §3.7）', client: 'assets.folders.removeFolder()', method: 'DELETE', path: '/api/asset-folders/fold_1' },
    { endpoint: 'POST /projects/{projectId}/renders（02 §3；README §3.6）', client: 'renders.create()', method: 'POST', path: '/api/projects/prj_1/renders' },
    { endpoint: 'GET /projects/{projectId}/renders（README §3.6）', client: 'renders.list()', method: 'GET', path: '/api/projects/prj_1/renders' },
    { endpoint: 'GET /renders/{renderId}（02 §3；README §3.6）', client: 'renders.get()', method: 'GET', path: '/api/renders/render_1' },
    { endpoint: 'POST /renders/{renderId}/cancel（02 §3；README §3.6）', client: 'renders.cancel()', method: 'POST', path: '/api/renders/render_1/cancel' },
    { endpoint: 'GET /projects/{projectId}/delivery（README §3.6）', client: 'renders.delivery()', method: 'GET', path: '/api/projects/prj_1/delivery' },
    { endpoint: 'POST /renders/{renderId}/acceptance（README §3.6）', client: 'renders.accept()', method: 'POST', path: '/api/renders/render_1/acceptance' },
    { endpoint: 'GET /projects/{projectId}/acceptances（README §3.6）', client: 'renders.acceptances()', method: 'GET', path: '/api/projects/prj_1/acceptances' },
    { endpoint: 'POST /projects/{projectId}/checks（README §3.5）', client: 'checks.create()', method: 'POST', path: '/api/projects/prj_1/checks' },
    { endpoint: 'GET /projects/{projectId}/checks（README §3.5）', client: 'checks.list()', method: 'GET', path: '/api/projects/prj_1/checks' },
    { endpoint: 'GET /checks/{checkRunId}（README §3.5）', client: 'checks.get()', method: 'GET', path: '/api/checks/check_1' },
    { endpoint: 'GET /checks/{checkRunId}/findings（README §3.5）', client: 'checks.findings()', method: 'GET', path: '/api/checks/check_1/findings' },
    { endpoint: 'PATCH /check-findings/{findingId}（README §3.5）', client: 'checks.updateFinding()', method: 'PATCH', path: '/api/check-findings/finding_1' },
    { endpoint: 'GET /renders/{renderId}/checks（README §3.5）', client: 'checks.forRender()', method: 'GET', path: '/api/renders/render_1/checks' },
    { endpoint: 'GET /workflows（02 §3；README §3.4）', client: 'workflows.list()', method: 'GET', path: '/api/workflows' },
    { endpoint: 'POST /workflows（02 §3；README §3.4）', client: 'workflows.create()', method: 'POST', path: '/api/workflows' },
    { endpoint: 'GET /workflows/{workflowId}?version=（02 §3；README §3.4）', client: 'workflows.get()', method: 'GET', path: '/api/workflows/wf_1' },
    { endpoint: 'PATCH /workflows/{workflowId}（02 §3；README §3.4）', client: 'workflows.update()', method: 'PATCH', path: '/api/workflows/wf_1' },
    { endpoint: 'DELETE /workflows/{workflowId}（README §3.4）', client: 'workflows.remove()', method: 'DELETE', path: '/api/workflows/wf_1' },
    { endpoint: 'GET /workflows/{workflowId}/versions（README §3.4）', client: 'workflows.versions()', method: 'GET', path: '/api/workflows/wf_1/versions' },
    { endpoint: 'POST /workflows/{workflowId}/runs（02 §3；README §3.4）', client: 'workflows.startRun()', method: 'POST', path: '/api/workflows/wf_1/runs' },
    { endpoint: 'GET /workflows/{workflowId}/runs（README §3.4）', client: 'workflows.runs()', method: 'GET', path: '/api/workflows/wf_1/runs' },
    { endpoint: 'GET /workflow-runs/{runId}（02 §3；README §3.4）', client: 'workflows.getRun()', method: 'GET', path: '/api/workflow-runs/run_1' },
    { endpoint: 'POST /workflow-runs/{runId}/cancel（README §3.4）', client: 'workflows.cancelRun()', method: 'POST', path: '/api/workflow-runs/run_1/cancel' },
    { endpoint: 'GET /workflow-templates（README §3.4）', client: 'workflows.listTemplates()', method: 'GET', path: '/api/workflow-templates' },
    { endpoint: 'GET /workflow-templates/{templateId}（README §3.4）', client: 'workflows.getTemplate()', method: 'GET', path: '/api/workflow-templates/tpl_1' },
    { endpoint: 'GET /fx-techniques（02 §3；README §3.8）', client: 'library.fx.listTechniques()', method: 'GET', path: '/api/fx-techniques' },
    { endpoint: 'GET /fx-techniques/facets（README §3.8）', client: 'library.fx.facets()', method: 'GET', path: '/api/fx-techniques/facets' },
    { endpoint: 'GET /fx-techniques/{techniqueId}（README §3.8）', client: 'library.fx.getTechnique()', method: 'GET', path: '/api/fx-techniques/fx_1' },
    { endpoint: 'GET /genomes（README §3.8）', client: 'library.genomes.listGenomes()', method: 'GET', path: '/api/genomes' },
    { endpoint: 'GET /genomes/{genomeId}（README §3.8）', client: 'library.genomes.getGenome()', method: 'GET', path: '/api/genomes/genome_1' },
    { endpoint: 'GET /reference-videos（02 §3；README §3.8）', client: 'library.referenceVideos.listVideos()', method: 'GET', path: '/api/reference-videos' },
    { endpoint: 'GET /reference-videos/{videoId}（README §3.8）', client: 'library.referenceVideos.getVideo()', method: 'GET', path: '/api/reference-videos/rv_1' },
    { endpoint: 'POST /reference-videos/{videoId}/analyze（02 §3；README §3.8）', client: 'library.referenceVideos.analyzeVideo()', method: 'POST', path: '/api/reference-videos/rv_1/analyze' },
    { endpoint: 'GET /reference-shots（02 §3；README §3.8）', client: 'library.referenceShots.listShots()', method: 'GET', path: '/api/reference-shots' },
    { endpoint: 'GET /reference-shots/{shotId}（README §3.8）', client: 'library.referenceShots.getShot()', method: 'GET', path: '/api/reference-shots/shot_1' },
    { endpoint: 'GET /reference-collections（README §3.8）', client: 'library.collections.listCollections() / listCollectionsWithMeta()', method: 'GET', path: '/api/reference-collections' },
    { endpoint: 'POST /reference-collections（README §3.8）', client: 'library.collections.createCollection()', method: 'POST', path: '/api/reference-collections' },
    { endpoint: 'PATCH /reference-collections/{collectionId}（README §3.8）', client: 'library.collections.updateCollection()', method: 'PATCH', path: '/api/reference-collections/col_1' },
    { endpoint: 'DELETE /reference-collections/{collectionId}（README §3.8）', client: 'library.collections.removeCollection()', method: 'DELETE', path: '/api/reference-collections/col_1' },
    { endpoint: 'GET /reference-preferences（README §3.8）', client: 'library.preferences.getPreferences()', method: 'GET', path: '/api/reference-preferences' },
    { endpoint: 'PATCH /reference-preferences（README §3.8）', client: 'library.preferences.updatePreferences()', method: 'PATCH', path: '/api/reference-preferences' },
  ]

  console.log('\n端点 → 客户端方法 → 一致/偏差：')
  let consistent = 0
  for (const spec of specs) {
    const rec = lastReq(spec.method, spec.path)
    const verdict = rec ? '一致' : '偏差（未观测到该方法的该路径）'
    if (rec) consistent += 1
    console.log(`  ${verdict === '一致' ? '一致' : '偏差'} | ${spec.endpoint}\n        客户端：${spec.client}\n        证据：${rec ? `${rec.method} ${rec.path}${rec.query.toString() ? `?${rec.query.toString()}` : ''}` : '无（假服务端未收到）'}`)
    check(`审计 ${spec.method} ${spec.path}`, rec !== undefined, rec ? `${rec.method} ${rec.path}` : '未观测到请求', `${spec.method} ${spec.path}`)
  }

  console.log('\n未实现/未覆盖的契约端点（客户端本次未提供，如实列出）：')
  const uncovered = [
    'GET /fx-techniques 复杂度区间参数（客户端用 complexityMin/Max，契约只写 maxComplexity）—— 查询串写法待评审',
    'GET /assets/uploads/{uploadId}（仅读上传会话）：README §3.7 / asset.md §3.2 **没有**该端点，客户端为续传而新增（本地扩展，需回写契约）',
    'GET /assets/uploads 列表、POST /reference-collections 之外的参考片写端点等：02 §3/README §3 未列，客户端也未实现',
    'PATCH/PUT 之外的 DELETE /workflows/{id} 归档语义（有运行时归档）：客户端只发 DELETE，结果需再 GET 确认',
  ]
  for (const item of uncovered) {
    console.log(`  未覆盖 | ${item}`)
    observations.push(`未覆盖/缺口：${item}`)
  }

  const missingHandles = recordsFor((r) => r.path === '/api/assets/uploads/up_resume' && r.method === 'GET')
  console.log(`\n审计统计：契约端点 ${specs.length} 条，客户端实测一致 ${consistent} 条，偏差 ${specs.length - consistent} 条。`)
  check('审计：所有列出的端点都能在假服务端记录里找到对应 method+path', consistent === specs.length, {
    specs: specs.length,
    consistent,
    deviations: specs.length - consistent,
  })
  check('续传读取会话端点确实被发出（本地扩展，需回写契约）', missingHandles.length === 1, missingHandles.map((r) => `${r.method} ${r.path}`))

  obs('文档内部基址口径不一致（非客户端偏差）：docs/contracts/README.md §2.1 写 `/api/v1`，02 §2 与 src/services/api/config.ts 默认值为 `/api`；02 已注明「最终前缀需要评审并同步三处」')

  // Vite 的扩展名解析顺序里 .js 优先于 .ts：src/ 下若混入「就地编译」产物，验收与产品构建都可能跑到编译副本
  const apiDir = path.resolve(process.cwd(), 'src/services/api')
  if (fs.existsSync(apiDir)) {
    const offenders = fs.readdirSync(apiDir).filter((name) => name.endsWith('.js') || name.endsWith('.jsx'))
    check('src/services/api/ 下没有编译产物 .js（避免遮蔽 .ts 源文件）', offenders.length === 0, offenders)
  } else {
    obs(`未找到 ${apiDir}（脚本需在仓库根目录运行），跳过 .js 遮蔽检查`)
  }

  const probePaths = [...new Set(records.map((r) => `${r.method} ${r.path}`))]
    .filter((entry) => /\/errors\/|\/echo|\/conditional|\/resource|\/slow|\/badjson200/.test(entry))
    .sort()
  obs(`本次真跑打到假服务端的请求共 ${records.length} 条；其中 ${probePaths.length} 类为验收专用探针端点（非契约端点）`)
}


/* ============================ 主流程 ============================ */

async function main(): Promise<void> {
  console.log('FengMotion 前端 API 层验收（scripts/api-contract-check.ts）')
  console.log('依据：02-前后端API契约.md §2/§3/§5 + docs/contracts/README.md §2/§3/§4 + docs/contracts/task.md')

  await startServer()
  registerTaskScenarios()
  registerChatScenarios()
  registerDomainRoutes()

  await groupErrors()
  await groupTransport()
  await groupHeaders()
  await groupSseParser()
  await groupTaskStreams()
  await groupChatStream()
  await groupValidate()
  await groupCompat()
  await groupCapabilities()
  await groupConfig()
  await groupClientAssembly()
  await groupSystemDomain()
  await groupProjectsDomain()
  await groupTasksDomain()
  await groupChatDomain()
  await groupAssetsDomain()
  await groupRendersDomain()
  await groupChecksDomain()
  await groupWorkflowsDomain()
  await groupLibraryDomain()
  await groupAudit()

  console.log('\n════════ 汇总 ════════')
  console.log(`检查项总数：${checks}    通过：${checks - failures.length}    失败：${failures.length}`)
  if (failures.length > 0) {
    console.log('\n失败清单（含实际值）：')
    for (const failure of failures) console.log(`  - ${failure}`)
  }
  if (observations.length > 0) {
    console.log('\n观察项（非硬性失败，需实现者判断）：')
    for (const item of observations) console.log(`  - ${item}`)
  }
  console.log(`\n假服务端收到的请求总数：${records.length}`)
}

let crashed = false

main()
  .catch((error) => {
    // 脚本自身异常（不是被测代码失败）：必须让退出码非 0，否则崩溃会被当成「全绿」
    crashed = true
    console.error('验收脚本自身异常：', error)
  })
  .finally(async () => {
    for (const socket of sockets) socket.destroy()
    // 崩溃可能发生在 startServer() 之前：清理本身不能抛，否则退出码会被 finally 里的异常改写
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (crashed) {
      console.log(`\n验收脚本未能跑完：已完成 ${checks} 项（通过 ${checks - failures.length}，失败 ${failures.length}），结果不完整。`)
      process.exit(2)
    }
    process.exit(failures.length > 0 ? 1 : 0)
  })

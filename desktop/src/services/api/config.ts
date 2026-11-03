/**
 * API 层配置：基址、模式、超时、流参数。
 *
 * 为什么要有这一层：视图里不写死端口/地址（README §2.1「端口从设置读取，不写死在视图」），
 * 同时保留三条硬规则：
 * 1. **不自动降级** —— 连不上就是连不上，不换成演示数据；
 * 2. **token 不进 localStorage**（README §2.2：token 只放内存，过期重新握手）；
 * 3. 契约 v0.3 未冻结的本地扩展字段默认**不允许**真实发送（02 §4）。
 *
 * 取值优先级：显式入参 > 环境变量 > 本机存储 > 默认值。来源写进 `ApiConfig.source` 供界面说明。
 */
import type { ApiConfig, ApiConfigPatch, ApiMode, QueryParams, QueryValue } from './types'

/** 本机存储键（只存基址与模式等**偏好**，绝不存 token）。 */
export const API_CONFIG_STORAGE_KEY = 'fengmotion:api-config:v1'

/**
 * 默认基址：本地 Agent 服务。
 *
 * 前缀用 `/api` 而不是 `/api/v1`：02 §1 决定延续 `/api`（`docs/contracts/settings.md` 里的
 * `/api/v1` 是待评审的第三处口径，最终前缀需评审后三处同步）。这里不偷偷改写用户填的值。
 */
export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8080/api'

export const DEFAULT_TIMEOUT_MS = 15_000
/** 契约目标：服务端 15 秒心跳、客户端 45 秒无消息重连（README §2.9）。 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 45_000
export const DEFAULT_STREAM_RECONNECT_LIMIT = 5
/**
 * 「这轮连接算恢复」的最短稳定存活时间（毫秒）。
 * 取 10 秒：抖动型故障（连上→发一帧→立刻断开）每轮都有数据，
 * 不设这个门槛的话重连上限永远不生效（见 types.ts 的同名字段）。
 */
export const DEFAULT_STREAM_STABLE_MS = 10_000
/** 事件缺口补齐上限（契约「最多最近 200 条」）。 */
export const DEFAULT_RESYNC_LIMIT = 200

/* ============================ 取值工具 ============================ */

/**
 * 读环境变量时同时容忍「在 Vite 里」和「在纯 Node 里」两种运行形态。
 * 直接写 `import.meta.env.X` 在非 Vite 环境会抛（`import.meta.env` 是 undefined）。
 */
export function readEnv(): Record<string, unknown> {
  const meta = import.meta as ImportMeta & { env?: Record<string, unknown> }
  return meta.env ?? {}
}

function readString(env: Record<string, unknown>, key: string): string | undefined {
  const raw = env[key]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

function readNumber(env: Record<string, unknown>, key: string): number | undefined {
  const raw = env[key]
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function readBoolean(env: Record<string, unknown>, key: string): boolean | undefined {
  const raw = env[key]
  if (typeof raw === 'boolean') return raw
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  return undefined
}

/** 只去掉首尾空白与结尾多余斜杠；不改写路径内容（`/api/v1` 不会被偷偷改成 `/api`）。 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return DEFAULT_API_BASE_URL
  return trimmed.endsWith('/') ? trimmed.replace(/\/+$/, '') : trimmed
}

function normalizeMode(raw: string | undefined): ApiMode | undefined {
  return raw === 'demo' || raw === 'http' ? raw : undefined
}

function normalizeCredentials(raw: unknown): RequestCredentials | undefined {
  return raw === 'omit' || raw === 'same-origin' || raw === 'include' ? raw : undefined
}

/* ============================ 环境变量 ============================ */

export function readEnvConfig(env: Record<string, unknown> = readEnv()): ApiConfigPatch {
  const patch: ApiConfigPatch = {}
  const baseUrl = readString(env, 'VITE_FENGMOTION_API_BASE')
  if (baseUrl) patch.baseUrl = normalizeBaseUrl(baseUrl)
  const mode = normalizeMode(readString(env, 'VITE_FENGMOTION_API_MODE'))
  if (mode) patch.mode = mode
  const timeoutMs = readNumber(env, 'VITE_FENGMOTION_API_TIMEOUT_MS')
  if (timeoutMs !== undefined) patch.timeoutMs = timeoutMs
  const idle = readNumber(env, 'VITE_FENGMOTION_STREAM_IDLE_TIMEOUT_MS')
  if (idle !== undefined) patch.streamIdleTimeoutMs = idle
  const stable = readNumber(env, 'VITE_FENGMOTION_STREAM_STABLE_MS')
  if (stable !== undefined) patch.streamStableMs = stable
  const credentials = normalizeCredentials(readString(env, 'VITE_FENGMOTION_API_CREDENTIALS'))
  if (credentials) patch.credentials = credentials
  const allowExtensions = readBoolean(env, 'VITE_FENGMOTION_ALLOW_LOCAL_MODIFY_EXTENSIONS')
  if (allowExtensions !== undefined) patch.allowLocalModifyExtensions = allowExtensions
  return patch
}

/* ============================ 本机存储 ============================ */

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 隐私模式/沙箱下访问 localStorage 会抛；此时当作没有存储，而不是让整个模块加载失败
    return null
  }
}

/** 读取本机偏好。内容损坏或类型不符一律忽略（返回 null），不抛、不猜。 */
export function readStoredConfig(storage: Storage | null = defaultStorage()): ApiConfigPatch | null {
  if (!storage) return null
  let parsed: unknown
  try {
    const raw = storage.getItem(API_CONFIG_STORAGE_KEY)
    if (!raw) return null
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  const patch: ApiConfigPatch = {}
  if (typeof record.baseUrl === 'string' && record.baseUrl.trim() !== '') {
    patch.baseUrl = normalizeBaseUrl(record.baseUrl)
  }
  const mode = normalizeMode(typeof record.mode === 'string' ? record.mode : undefined)
  if (mode) patch.mode = mode
  const timeoutMs = typeof record.timeoutMs === 'number' && record.timeoutMs > 0 ? record.timeoutMs : undefined
  if (timeoutMs !== undefined) patch.timeoutMs = timeoutMs
  const stableMs = typeof record.streamStableMs === 'number' && record.streamStableMs > 0 ? record.streamStableMs : undefined
  if (stableMs !== undefined) patch.streamStableMs = stableMs
  const credentials = normalizeCredentials(record.credentials)
  if (credentials) patch.credentials = credentials
  if (typeof record.allowLocalModifyExtensions === 'boolean') {
    patch.allowLocalModifyExtensions = record.allowLocalModifyExtensions
  }
  return Object.keys(patch).length > 0 ? patch : null
}

/**
 * 写入本机偏好。**只写配置，不写 token**（README §2.2）。
 * 存储不可用时返回 false，由调用方提示「仅本次会话有效」，不假装保存成功。
 */
export function writeStoredConfig(
  patch: ApiConfigPatch,
  storage: Storage | null = defaultStorage(),
): boolean {
  if (!storage) return false
  try {
    const current = readStoredConfig(storage) ?? {}
    const next: ApiConfigPatch = { ...current, ...patch }
    storage.setItem(API_CONFIG_STORAGE_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

export function clearStoredConfig(storage: Storage | null = defaultStorage()): void {
  try {
    storage?.removeItem(API_CONFIG_STORAGE_KEY)
  } catch {
    // 清不掉也不影响运行；下次仍会读到旧值，如实由调用方提示
  }
}

/* ============================ 合成配置 ============================ */

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: DEFAULT_API_BASE_URL,
  mode: 'http',
  timeoutMs: DEFAULT_TIMEOUT_MS,
  streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  streamReconnectLimit: DEFAULT_STREAM_RECONNECT_LIMIT,
  streamStableMs: DEFAULT_STREAM_STABLE_MS,
  resyncLimit: DEFAULT_RESYNC_LIMIT,
  credentials: 'omit',
  allowLocalModifyExtensions: false,
  source: 'default',
}

export interface ResolveApiConfigOptions {
  /** 显式传入优先于一切；传了就是 `source: 'explicit'`。 */
  explicit?: ApiConfigPatch
  storage?: Storage | null
  /** 会话内一次性覆盖（如桌面端设置页保存的值），优先级高于 env、低于 explicit。 */
  overrides?: ApiConfigPatch
  env?: Record<string, unknown>
  /** 关闭环境变量读取（纯 Node 测试用）。 */
  skipEnv?: boolean
}

export function resolveApiConfig(options: ResolveApiConfigOptions = {}): ApiConfig {
  const stored = readStoredConfig(options.storage ?? defaultStorage())
  const envPatch = options.skipEnv ? {} : readEnvConfig(options.env ?? readEnv())
  const overrides = options.overrides ?? {}
  const explicit = options.explicit

  const merged: ApiConfig = {
    ...DEFAULT_API_CONFIG,
    ...stored,
    ...envPatch,
    ...overrides,
    ...explicit,
  }
  const source = explicit
    ? 'explicit'
    : Object.keys(overrides).length > 0
      ? 'explicit'
      : Object.keys(envPatch).length > 0
        ? 'env'
        : stored
          ? 'stored'
          : 'default'
  return { ...merged, source }
}

/* ============================ URL ============================ */

function appendQueryValue(params: URLSearchParams, key: string, value: QueryValue): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    // 数组用重复参数表达（`tags=a&tags=b`），与契约里 `tags?: string[]` 的常见实现一致
    for (const item of value) {
      if (item === undefined || item === null) continue
      params.append(key, String(item))
    }
    return
  }
  params.append(key, String(value))
}

/** 拼出完整请求 URL；相对基址（以 `/` 开头）保持相对，交给浏览器按同源解析。 */
export function buildApiUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  const params = new URLSearchParams()
  if (query) {
    for (const [key, value] of Object.entries(query)) appendQueryValue(params, key, value)
  }
  const search = params.toString()
  const base = normalizeBaseUrl(baseUrl)
  return `${base}${suffix}${search ? `?${search}` : ''}`
}

/** 生成幂等键。重试同一次用户意图时必须复用同一个值，不要在这里重新生成。 */
export function newIdempotencyKey(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID()
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

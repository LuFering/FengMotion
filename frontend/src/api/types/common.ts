/** API 契约 · 通用。纯类型，规则见 api/contracts.ts 文件头。 */

/* ============================ 通用 ============================ */

/** 稳定实体 ID。后端保证同一实体内唯一、跨会话稳定；推荐 ULID。 */
export type Id = string

/** ISO 8601 UTC 时间串（如 2026-10-23T06:27:00Z）。格式化属视图职责，不进契约。 */
export type IsoDateTime = string

/** 毫秒时间戳，仅用于在产物/画面上定位。 */
export type TimecodeMs = number

/**
 * 演示标记。`true` = 由演示适配器产出，UI 必须显示「演示」标识。
 * 真实后端数据不返回该字段（不是 `false`，是不出现），避免「假数据看起来像真的」。
 */
export type DemoFlag = true

/** 服务端请求 ID，用于错误追踪与用户报障。 */
export type RequestId = string

export interface Page<T> {
  items: T[]
  /** 下一页游标；`null` 表示没有更多。游标不透明，客户端不得解析。 */
  nextCursor: string | null
  /** 当前页总数（可选；后端无法廉价计算时省略）。 */
  total?: number
}

export interface PageQuery {
  cursor?: string
  /** 默认 50，上限 200。 */
  limit?: number
}

export type SortDirection = 'asc' | 'desc'

/**
 * 统一错误码。只增不改义；新增码必须写进 README 的错误码表。
 * - capability_unavailable：能力未接入（解析 / ASR / 云渲染 / Agent / 检查执行）
 * - agent_unavailable：Agent 进程未连接，区别于「能力根本没做」
 */
export type ApiErrorCode =
  | 'validation_error'
  | 'not_found'
  | 'conflict'
  | 'precondition_failed'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'idempotency_conflict'
  | 'capability_unavailable'
  | 'agent_unavailable'
  | 'rate_limited'
  | 'cancelled'
  | 'internal_error'

export interface ApiErrorDetail {
  code: ApiErrorCode
  /** 面向用户的一句话；不得包含堆栈、模型推理或内部路径细节。 */
  message: string
  /** 结构化补充（字段名、冲突 ID、能力名等），形状由 code 决定。 */
  details?: Record<string, unknown>
  requestId?: RequestId
}

export interface ApiErrorResponse {
  error: ApiErrorDetail
}

/** 能力状态：真实可用 / 仅演示 / 未接入。UI 必须按此置灰或标注。 */
export type CapabilityStatus = 'available' | 'demo' | 'unavailable'

export interface Capability {
  status: CapabilityStatus
  /** 一句人话，说明为什么不可用（如「云渲染未接入」）。 */
  note?: string
}

/** 能力声明。前端据此决定按钮可用性，不得靠猜或按页面写死。 */
export interface Capabilities {
  agent: Capability
  remotionEditor: Capability
  previewVideo: Capability
  cloudRender: Capability
  referenceAnalysis: Capability
  asr: Capability
  checkExecution: Capability
}

export type ThemeMode = 'dark' | 'light' | 'tactile'

export interface AppSettings {
  theme: ThemeMode
  /** 桌面端项目根目录；浏览器演示态为只读展示。 */
  workspaceRoot: string
  locale: 'zh-CN'
  /** 打开时恢复上次项目（可选）。 */
  lastProjectId?: string
}

export interface SettingsUpdateRequest {
  theme?: ThemeMode
  workspaceRoot?: string
  lastProjectId?: string
}

export interface HealthStatus {
  status: 'ok' | 'degraded'
  version: string
  uptimeMs: number
}

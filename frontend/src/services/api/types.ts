/**
 * 前端 API 层的**传输层本地类型**（纯类型，无运行时）。
 *
 * 为什么单独一份：`src/types/contracts.ts` 是前后端共同冻结的契约视图，
 * 这里只放「只有前端传输层才关心」的东西 —— 配置、请求信封、流状态、发送前校验结论。
 * 领域实体一律复用 `@/types/contracts`，不在这里抄第二份。
 *
 * 冻结规则同契约：只增不改义。凡需要后端配合的字段，必须同时登记在
 * `docs/dev/前后端协议.md` 的本地扩展一节，否则视为未评审。
 */
import type {
  AgentReference,
  ApiErrorCode,
  Capability,
  CapabilityStatus,
  PageQuery,
  TaskStatus,
} from '@/types/contracts'

/* ============================ 配置 ============================ */

/**
 * `http` = 走真实 HTTP 端点的适配器；`demo` = 显式演示模式（由调用方选择 MockStudioApi）。
 *
 * 这里**不做自动降级**：连不上后端就是连不上，不能悄悄换成演示数据糊过去
 * （见 02 §2 真实状态、01 §5「不静默用 demo 伪装真实响应」）。
 */
export type ApiMode = 'http' | 'demo'

/** 配置取值来源，用于界面说明「这个地址是哪来的」，而不是让用户猜。 */
export type ApiConfigSource = 'explicit' | 'env' | 'stored' | 'default'

export interface ApiConfig {
  /** 服务基址，如 `http://127.0.0.1:8080/api`；以 `/` 开头表示同源相对路径（走代理时用）。 */
  baseUrl: string
  mode: ApiMode
  /** 单次请求超时（毫秒）。SSE 不用它，见 streamIdleTimeoutMs。 */
  timeoutMs: number
  /** 流空闲多久判定断线并重连（毫秒）。契约目标 45 秒（README §2.9）。 */
  streamIdleTimeoutMs: number
  /** 连续重连次数上限；超过后如实报失败，不假装仍在恢复。 */
  streamReconnectLimit: number
  /**
   * 「这一轮连接算恢复」所需的最短稳定存活时间（毫秒）。
   *
   * 抖动型故障（连上 → 发一帧 → 立刻断开）每轮都有数据，若一收到数据就清零重连计数，
   * `streamReconnectLimit` 永远不生效。默认 10 秒：远大于毫秒级抖动，又明显小于
   * `streamIdleTimeoutMs`（契约 45 秒），不会误杀正常长连接。
   * 产品若希望「有进展就永不放弃」，把这个值调小即可，但那样重连上限也不再能收束抖动故障 —— 取舍要写进契约。
   */
  streamStableMs: number
  /** 一次补齐事件缺口时最多拉多少条历史（契约上限 200）。 */
  resyncLimit: number
  credentials: RequestCredentials
  /**
   * 是否允许发送契约 v0.3 **尚未冻结**的本地扩展字段：
   * `preview` 引用、`feedbackId`、`creativeBrief`、`preserveOutsideSelection`。
   *
   * 默认 false。02 §4 明确：只有服务端能校验并持久化这些字段时才可用于真实执行，
   * 否则目标身份/区域会静默丢失（P0 阻塞项）。所以默认拒绝真实发送并说明原因，
   * 由评审后显式打开，不靠猜。
   */
  allowLocalModifyExtensions: boolean
  source: ApiConfigSource
}

export type ApiConfigPatch = Partial<Omit<ApiConfig, 'source'>>

/* ============================ 请求信封 ============================ */

/** 查询参数值；`undefined`/`null` 一律省略（契约用「字段不出现」表达未知，不用空串冒充）。 */
export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[]

export type QueryParams = Record<string, QueryValue>

export interface RequestOptions {
  query?: QueryParams
  /** JSON 请求体；无 body 的请求（GET/DELETE）不传。 */
  body?: unknown
  headers?: Record<string, string>
  /** 调用方取消信号；与超时信号合流。 */
  signal?: AbortSignal
  /** 条件更新：带 `If-Match: <etag>`，不匹配服务端返回 412 precondition_failed。 */
  ifMatch?: string
  /**
   * 幂等键。三种取值各有含义，别混：
   * - `undefined`：自动生成一个（同一次调用内唯一）——防不住重复点击；
   * - `string`：同一次用户意图的**重试必须复用同一个键**，服务端 24h 内重放首次结果；
   * - `null`：明确不带该头（仅用于服务端不支持幂等的旧接口）。
   */
  idempotencyKey?: string | null
  timeoutMs?: number
  accept?: string
}

export interface ApiResponse<T> {
  data: T
  status: number
  /** 响应头 `ETag`；`null` 表示该资源不带版本。下次更新必须原样回传。 */
  etag: string | null
  /** 响应头 `X-Request-Id`（或错误体里的 requestId），报障时给用户。 */
  requestId: string | null
}

/* ============================ 失败 ============================ */

/**
 * 传输层才会产生的失败码，不在 `ApiErrorCode` 里。
 *
 * 为什么需要：契约错误码表只覆盖「服务端答复了」的情况；断网、超时、被调用方取消
 * 根本没到服务端，用 `internal_error` 冒充会把「连不上」说成「服务端出错」。
 * `unauthorized` 对应 README §2.2 的 401 重新握手，但 `ApiErrorCode` 未收录该值 —— 属契约缺口，
 * 已在 docs/dev/前后端协议.md 登记。
 *
 * `stream_disconnected` 与 `network_error` 分开：前者是**已经连上、流在中途断了**
 * （SSE 被掐断或空闲超时），服务本身是通的；后者是压根没能建立连接。
 * 两者对用户的下一步动作不同（前者等等就好，后者要检查后端是否启动），合并会给出错的指引。
 */
export type LocalFailureCode =
  | 'network_error'
  | 'stream_disconnected'
  | 'timeout'
  | 'aborted'
  | 'unauthorized'

export type FailureCode = ApiErrorCode | LocalFailureCode

/* ============================ 流 ============================ */

export type TaskStreamPhase =
  | 'connecting'
  /** 已对齐水位，正在按 seq 顺序交付事件。 */
  | 'live'
  /** 事件缺口未补齐（断线/漏事件）。**不是**完成，UI 必须显示「正在恢复」。 */
  | 'resyncing'
  /** 收到终态 `end`，或者从历史里拿到了终态事件。 */
  | 'ended'
  | 'failed'
  | 'aborted'

export interface TaskStreamState {
  phase: TaskStreamPhase
  /** 已连续交付到的事件水位；重连时作为 `Last-Event-ID`。 */
  lastSeq: number
  /** 已取到的任务快照（终态判断只认它和终态事件，不认断线）。 */
  taskStatus: TaskStatus | null
  /** 补齐缺口失败的次数，仅用于界面说明。 */
  resyncAttempts: number
}

export type ChatStreamPhase = 'connecting' | 'streaming' | 'ended' | 'failed' | 'aborted'

export interface ChatStreamState {
  phase: ChatStreamPhase
  /** 最后一次 SSE `id`；重连时作为 `Last-Event-ID`。 */
  lastEventId: string | null
  /** 已收到 `completed` 的消息 ID。 */
  completedMessageIds: string[]
}

/* ============================ 能力 ============================ */

/**
 * 能力视图：把「服务端声明的能力」与「本机真实具备的能力」分开保留再合并。
 *
 * 02 §3.1：不能用服务端 `unavailable` 隐藏本机编辑器能力（当前项目已有本机编辑器），
 * 所以合并规则是「就近优先 + 保留来源」，而不是取服务端值。
 */
export interface CapabilityView {
  status: CapabilityStatus
  note?: string
  server?: Capability
  client?: Capability
}

/** 本机能力声明，由前端探测得出（编辑器、浏览器编码等），不是服务端返回的。 */
export type ClientCapabilities = Partial<Record<string, Capability>>

export interface CapabilityGate {
  enabled: boolean
  /** 置灰原因；enabled 时为空串。 */
  reason: string
}

/* ============================ 发送前校验 ============================ */

export type TaskRequestProblemCode =
  | 'missing_kind_block'
  | 'empty_prompt'
  | 'too_many_targets'
  | 'scene_scope_without_scene'
  | 'selection_without_target'
  | 'target_not_locatable'
  | 'preview_project_mismatch'
  | 'time_out_of_range'
  | 'range_not_increasing'
  | 'bbox_invalid'
  | 'preserve_outside_without_region'
  | 'attachment_without_file_id'
  | 'legacy_reference'
  | 'unfrozen_local_extension'

export interface TaskRequestProblem {
  code: TaskRequestProblemCode
  /** 面向用户的一句话；不得只给字段路径。 */
  message: string
  /** 出问题的位置，如 `references[0].bbox`，便于前端定位高亮。 */
  field?: string
}

/** 发送策略：本地扩展默认禁用，见 `ApiConfig.allowLocalModifyExtensions`。 */
export interface TaskSendPolicy {
  allowLocalModifyExtensions: boolean
}

/* ============================ 上传 ============================ */

export interface UploadProgress {
  uploadId: string
  /** **服务端已确认**的字节数，不是前端估算（README §2.8）。 */
  receivedBytes: number
  sizeBytes: number
  /** 已完成的最后一个分片序号，断线续传从这里继续。 */
  lastChunkIndex: number
}

export interface UploadOptions {
  folderId?: string | null
  signal?: AbortSignal
  onProgress?: (progress: UploadProgress) => void
  /** 续传：复用已存在的上传会话，从服务端 `receivedBytes` 之后继续。 */
  uploadId?: string
}

export interface UploadResult {
  uploadId: string
  assetId: string | null
}

/* ============================ 工具类型 ============================ */

/** 便于各域把 `PageQuery` 直接摊进 query，同时允许域内追加自己的筛选字段。 */
export type ListQuery<T extends PageQuery = PageQuery> = T

/** 引用在任务请求里的角色统计，供发送前校验与界面说明复用。 */
export interface ReferenceRoles {
  targets: AgentReference[]
  contexts: AgentReference[]
}

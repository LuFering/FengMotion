/**
 * FengMotion 前后端 API 契约 —— 全量类型（纯类型，零 import、零运行时、零实现）。
 *
 * 覆盖域：
 * - 通用与错误、分页、能力声明
 * - 项目 / 时间线 / 场景 / 分镜 / 镜头参数 / 产物 / 版本
 * - 任务、事件流、变更集
 * - 工作流定义与运行、模板
 * - 检查运行与问题项
 * - 渲染、产物、交付与验收
 * - 素材、文件夹、上传
 * - 特效库 / 参考片库 / 片型画像
 * - 对话会话与消息流
 * - 设置与能力
 *
 * 口径来源：
 * - docs/contracts/README.md（总则、端点总表、跨域状态机）
 * - docs/contracts/{project,task,workflow,check,render,asset,library,agent,settings}.md
 *
 * 冻结规则：字段与枚举只增不改义；新语义新增字段或枚举值，旧值标注废弃并给迁移期。
 * 本文件不得 import 任何模块，也不得出现实现代码——后端、适配器、视图共用这一份类型。
 */

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

/* ======================= 资源状态（五维正交） ======================= */

/**
 * 页面职责合同 §1.1 的五维资源状态。五个维度各自独立，禁止压成一个 `ready`。
 * 适用于素材、特效、参考片等「可被引用」的资源。
 */
export type ResourceSourceType = 'builtin' | 'imported' | 'generated' | 'sample'

/** 处理到哪一步（解析 / 转码 / 抽帧等）。 */
export type ResourceProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed'

/** 人确认过吗。`none` = 尚未产生审核（不等于通过）。 */
export type ResourceReviewStatus = 'none' | 'pending' | 'approved' | 'rejected'

/** 现在还能用吗。`deprecated` 是终态，不可回到 enabled。 */
export type ResourceAvailability = 'enabled' | 'disabled' | 'deprecated'

/** 引用关系：资源被谁用了。多值，不是状态。 */
export interface ResourceRef {
  kind: 'project' | 'workflow' | 'task' | 'scene'
  id: Id
  label: string
}

/* ============================ 项目 ============================ */

export type ProjectStage = 'idea' | 'draft' | 'editing' | 'rendering' | 'done'

export interface ProjectCounts {
  scenes: number
  /** 定稿场景数。 */
  doneScenes: number
  /** 分镜表规划段数。 */
  storyboardSegments: number
  /** 已生成的合成文件数。 */
  compositions: number
  /** 当前成片时间轴片段数。 */
  timelineClips: number
}

export interface ProjectSummary {
  id: Id
  name: string
  /** 一句话：这片子讲什么。 */
  tagline: string
  stage: ProjectStage
  /** 片型画像 ID（六选一），未定为 null。 */
  genomeId: string | null
  /** 当前成片时长；未排完时为 0。 */
  durationMs: number
  /** 目标时长；未定目标时字段不出现。 */
  targetDurationMs?: number
  counts: ProjectCounts
  coverUrl: string | null
  /** 项目根目录绝对路径，用于「在文件管理器中打开」。 */
  rootPath: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  /** true = 只存在于本次会话、尚未落盘。UI 必须标「仅本次会话有效」。 */
  planned?: true
  etag: string
  demo?: DemoFlag
}

export interface ProjectSettings {
  width: number
  height: number
  fps: number
  targetDurationMs: number
  genomeId: string | null
}

export interface ProjectDetail extends ProjectSummary {
  settings: ProjectSettings
}

export interface ProjectCreateRequest {
  name: string
  genomeId: string
  targetDurationMs: number
  /** 不传则用 workspaceRoot 下的默认目录。 */
  rootPath?: string
}

/** 条件更新：请求头带 `If-Match: <etag>`，不匹配返回 `precondition_failed`。 */
export interface ProjectUpdateRequest {
  name?: string
  tagline?: string
  stage?: ProjectStage
  genomeId?: string | null
  targetDurationMs?: number
}

export interface ProjectListQuery extends PageQuery {
  stage?: ProjectStage
  q?: string
  sort?: 'updated_desc' | 'updated_asc' | 'name_asc'
}

/** 成片时间轴的一段。时间单位毫秒，`startMs` 相对成片零点。 */
export interface TimelineClip {
  id: Id
  sceneId: Id
  startMs: number
  durationMs: number
  track: number
  title: string
  /** 可直接播放的媒体 URL；没有可播放来源时不出现。 */
  sourceUrl?: string
}

export interface Timeline {
  projectId: Id
  fps: number
  width: number
  height: number
  /** 成片总时长（毫秒）。 */
  durationMs: number
  clips: TimelineClip[]
  /** assembly = 真实组装时间轴；demo = 演示数据。 */
  source: 'assembly' | 'demo'
  etag: string
}

export type SceneStatus = 'done' | 'running' | 'waiting' | 'failed' | 'idle' | 'untracked'

/** 场景（通用层叫法）。范式层的「镜头」在 05 期前仍可能出现在实现内部，不进口径。 */
export interface Scene {
  id: Id
  projectId: Id
  /** 从 1 开始的展示序号。 */
  index: number
  /** 卡片短名（如 s01）。 */
  label: string
  title: string
  durationMs: number
  /** 在成片时间轴上的起点；未入时间轴为 null。 */
  startMs: number | null
  thumbnailUrl: string | null
  status: SceneStatus
  note: string
  /** 合成页 URL；没有合成文件为 null。 */
  compositionUrl: string | null
  storyboardId: Id | null
  inTimeline: boolean
  /** false = 时长只是估算，UI 必须标注「未实测」。 */
  timingKnown: boolean
}

export interface StoryboardEntry {
  id: Id
  projectId: Id
  /** 段号（如「第 12 段」）。 */
  segment: string
  /** 原始时间码文本，保持分镜表原样，不解析成数值。 */
  timecode: string
  /** 原始时长文本。 */
  duration: string
  narration: string
  visual: string
  motion: string
  transition: string
  act: string
}

export type ShotMotion = 'rise' | 'fade' | 'slide' | 'none'
export type ShotAlign = 'left' | 'center' | 'right'

/** 场景内可编辑的字幕/版式参数，按项目持久化。 */
export interface ShotSettings {
  title: string
  subtitle: string
  accent: string
  fontScale: number
  motion: ShotMotion
  align: ShotAlign
  durationSeconds: number
}

export interface ShotOverride {
  projectId: Id
  sceneId: Id
  settings: ShotSettings
  updatedAt: IsoDateTime
  etag: string
}

export type ArtifactType = 'content-contract' | 'lookdev' | 'film-plan' | 'qa'
export type ArtifactStatus = 'confirmed' | 'draft' | 'needs-review'

/** 工作台产物：可审阅、可引用的版本化文档。 */
export interface WorkbenchArtifact {
  id: Id
  projectId: Id
  type: ArtifactType
  title: string
  /** 展示版本号（如 v3），与 WorkflowDefinition.version 无关。 */
  version: string
  status: ArtifactStatus
  updatedAt: IsoDateTime
  summary: string
  body: string
  relatedSceneIds: Id[]
  etag: string
  demo?: DemoFlag
}

/** 项目版本/来源。restorable=false 表示只读来源，恢复动作必须禁用。 */
export interface ProjectVersion {
  id: Id
  projectId: Id
  name: string
  /** 来源描述（文件名、分支、快照 ID）。 */
  source: string
  kind: 'render' | 'storyboard' | 'snapshot'
  createdAt: IsoDateTime
  summary: string
  restorable: boolean
  demo?: DemoFlag
}

/* ============================ 任务 ============================ */

/**
 * 任务种类。undo/redo/restore 是对已发生变更的反向操作，同样走任务通道。
 * check / analyze 是 06 期与参考片解析的入口；能力未接入时后端返回 capability_unavailable。
 */
export type TaskKind = 'modify' | 'render' | 'check' | 'analyze' | 'undo' | 'redo' | 'restore'

/**
 * 任务状态（产品可见口径，由 WorkflowRunStatus 派生，不独立演进）。
 * building 是 running 的子阶段：编译/构建阶段仍属运行中，只是提示更具体。
 */
export type TaskStatus = 'queued' | 'running' | 'building' | 'completed' | 'failed' | 'cancelled'

/** 事件种类与状态迁移一一对应，事件是状态迁移的唯一可观察出口。 */
export type TaskEventKind = 'accepted' | 'progress' | 'build' | 'complete' | 'error' | 'cancelled'

export interface ModificationConstraints {
  preserveCamera: boolean
  preserveCaptions: boolean
  limitToSelection: boolean
  reuseExistingComponents: boolean
  durationSeconds?: number
  resolution?: '1080p' | '1440p' | '4k'
}

/**
 * 结构化引用：Agent 修改的对象 + 它需要读取的上下文。
 * 位置一律用稳定 ID / 精确帧 / 归一化区域 / 产物版本表示，不让模型从「这里/这段」猜。
 */
export type AgentReference =
  | { id: string; role: 'target' | 'context'; kind: 'project'; projectId: Id; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'scene'; sceneId: Id; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'frame'; sceneId: Id; frame: number; timecode: string; label: string; snapshotId?: Id }
  | { id: string; role: 'target' | 'context'; kind: 'range'; sceneId: Id; startFrame: number; endFrame: number; timecode: string; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'region'; sceneId: Id; frame: number; bbox: { x: number; y: number; w: number; h: number }; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'artifact'; artifactId: Id; version: string; label: string }

export interface TaskAttachment {
  name: string
  mimeType: string
  sizeBytes: number
  /** 已上传文件的 ID；仅元信息时为 undefined。 */
  fileId?: Id
}

export type TaskScope = 'project' | 'scene' | 'selection'

/** 渲染参数。 */
export interface RenderPreset {
  resolution: '1080p' | '1440p' | '4k'
  fps: number
  format: 'mp4' | 'webm'
  quality: 'draft' | 'standard' | 'high'
}

/**
 * 任务请求。任务创建挂在项目路径下（`POST /projects/{projectId}/tasks`），
 * 因此请求体不再重复携带 projectId。
 */
export interface TaskRequest {
  kind: TaskKind
  prompt: string
  scope: TaskScope
  sceneIds: Id[]
  references: AgentReference[]
  constraints: ModificationConstraints
  attachments: TaskAttachment[]
  /** kind=render 时必填。 */
  render?: { preset: RenderPreset; range?: { startMs: number; endMs: number } }
  /** kind=check 时必填：检查哪个产物版本。 */
  check?: { renderId: Id; categories?: string[] }
  /** kind=analyze 时必填：解析哪个参考片。 */
  analyze?: { referenceVideoId: Id }
  /** kind=restore 时必填。 */
  restore?: { versionId: Id }
}

export interface TaskError {
  code: string
  message: string
  retryable: boolean
}

export interface AgentTask {
  id: Id
  projectId: Id
  kind: TaskKind
  status: TaskStatus
  title: string
  /** 0–100；后端无法给出可信进度时不出现，不用假百分比。 */
  progress?: number
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  /** 仅 failed 存在。 */
  error?: TaskError
  demo?: DemoFlag
}

/**
 * 任务事件。`seq` 单调递增，断线重连以 `Last-Event-ID`（上一事件的 seq）续传；
 * `message` 只描述可观察操作，不得包含模型推理过程。
 */
export interface TaskEvent {
  id: Id
  seq: number
  taskId: Id
  kind: TaskEventKind
  status: TaskStatus
  message: string
  at: IsoDateTime
  /** 事件附带的机器可读信息（如变更文件数、当前节点），形状由 kind 决定。 */
  data?: Record<string, unknown>
  demo?: DemoFlag
}

export interface ChangeSetFile {
  path: string
  summary: string
  additions: number
  deletions: number
}

export interface ChangeSet {
  taskId: Id
  /** 一句话概括本次改动；无改动时为「无文件变更」。 */
  summary: string
  files: ChangeSetFile[]
  buildStatus: 'not-run' | 'passed' | 'failed'
  demo?: DemoFlag
}

/** 任务创建成功后的关联句柄，避免前端再发三次请求。 */
export interface TaskAcceptedResponse {
  task: AgentTask
  runId?: Id
  checkRunId?: Id
  renderId?: Id
}

export interface TaskListQuery extends PageQuery {
  status?: TaskStatus
  kind?: TaskKind
  sort?: 'created_desc' | 'created_asc'
}

/* ============================ 工作流 ============================ */

/** 节点端口声明。inputs/outputs 都按端口名寻址，连线只连端口，不连节点。 */
export interface WorkflowNodePort {
  name: string
  /** 端口数据类型标签（如 'video' | 'image' | 'text' | 'number'），仅作约束提示。 */
  type?: string
  /** 必填端口缺少连线时，运行期以 failed 结束并在 error 中指明 nodeId/port。 */
  required?: boolean
}

export interface WorkflowNode {
  id: string
  /** 节点类型（如 'generate' | 'compose' | 'check'），由运行时注册表解释，契约不枚举实现。 */
  type: string
  params: Record<string, unknown>
  inputs: WorkflowNodePort[]
  outputs: WorkflowNodePort[]
  /** 展示与归因用的自由元信息（标题、说明、作者），不参与执行语义。 */
  meta?: Record<string, unknown>
}

/** 连线端点：节点 + 端口。 */
export interface WorkflowEdgeEnd {
  node: string
  port: string
}

export interface WorkflowEdge {
  id: string
  from: WorkflowEdgeEnd
  to: WorkflowEdgeEnd
}

export type WorkflowStatus = 'draft' | 'published' | 'archived'

/**
 * 工作流定义。同一 id 的不同 version 是不可变快照：
 * 修改定义必须产生新 version，运行实例记录它当时用的 definitionVersion。
 */
export interface WorkflowDefinition {
  id: Id
  projectId: Id | null
  name: string
  description: string
  /** 定义版本号，随每次结构变更递增；已发布的 version 不允许原地修改。 */
  version: number
  status: WorkflowStatus
  tags: string[]
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  etag: string
  demo?: DemoFlag
}

export interface WorkflowSummary {
  id: Id
  projectId: Id | null
  name: string
  description: string
  version: number
  status: WorkflowStatus
  tags: string[]
  nodeCount: number
  updatedAt: IsoDateTime
  demo?: DemoFlag
}

export interface WorkflowTemplate {
  id: Id
  name: string
  description: string
  /** 适配的片型画像；空数组表示通用。 */
  genomeIds: string[]
  coverUrl: string | null
  tags: string[]
  /** 从模板创建时使用的定义快照版本。 */
  definitionId: Id
  definitionVersion: number
  demo?: DemoFlag
}

export interface WorkflowCreateRequest {
  projectId?: Id
  name: string
  description?: string
  /** 从模板创建时提供；与 nodes/edges 二选一。 */
  templateId?: Id
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
}

/** 保存即产生新 version；请求头带 `If-Match: <etag>`。 */
export interface WorkflowUpdateRequest {
  name?: string
  description?: string
  status?: WorkflowStatus
  tags?: string[]
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
}

/**
 * 运行状态。单向不回退：pending → running → (succeeded | failed | cancelled)。
 * 取消只在 pending/running 期间有效；已进入终态的运行不可再迁移。
 */
export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface WorkflowRunError {
  /** 出错的节点；定义级错误（如版本缺失）不填。 */
  nodeId?: string
  /** 出错端口；与 nodeId 同时出现时可精确定位到端口。 */
  port?: string
  message: string
  /** 稳定错误码，供 UI 分支与日志聚合；新增码只增不改义。 */
  code?: string
}

/** 单节点的输入输出快照。缺失的节点表示尚未执行（不是空对象冒充已执行）。 */
export interface WorkflowNodeIO {
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
}

export interface WorkflowRun {
  runId: Id
  projectId: Id
  /** 关联的任务 ID；任务状态由运行状态派生，见 task.md 的映射表。 */
  taskId: Id
  definitionId: Id
  definitionVersion: number
  status: WorkflowRunStatus
  nodeIO: Record<string, WorkflowNodeIO>
  error?: WorkflowRunError
  startedAt: IsoDateTime
  /** 仅终态存在；running 时字段不出现。 */
  completedAt?: IsoDateTime
  demo?: DemoFlag
}

export interface WorkflowRunRequest {
  projectId: Id
  /**
   * 运行输入，按端口/参数名寻址。定义里声明为必填但未提供的输入，
   * 后端在创建运行前返回 validation_error，不创建半成品运行。
   */
  inputs?: Record<string, unknown>
  sceneIds?: Id[]
}

/* ============================ 检查 ============================ */

/**
 * 检查运行状态。没有 pending：检查在创建时即开始执行。
 * 运行级取消只表示「这次检查没跑完」，不得解释为「检查通过」。
 */
export type CheckRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface CheckCounts {
  blocker: number
  major: number
  minor: number
  info: number
}

export interface CheckRun {
  checkRunId: Id
  projectId: Id
  taskId: Id
  /** 被检查的产物版本；换产物必须新开 run。 */
  renderId: Id
  status: CheckRunStatus
  startedAt: IsoDateTime
  /** 仅终态存在。 */
  completedAt?: IsoDateTime
  /** P1 预留：复检以新 run 替代旧 run 时指向被替代者；旧 run 数据只读保留。 */
  supersedesCheckRunId?: Id
  /** 已完成 run 的问题计数；running/未执行时不出现，不用 0 冒充「没问题」。 */
  counts?: CheckCounts
  demo?: DemoFlag
}

/** 问题严重度。blocker/major 阻断交付；minor/info 只提示。 */
export type CheckSeverity = 'blocker' | 'major' | 'minor' | 'info'

/** 问题定位的对象类型；与 targetId 组合定位，禁止只给文字描述。 */
export type CheckTargetType = 'scene' | 'timeline' | 'render' | 'asset' | 'workflow_node'

/**
 * 处理状态（人对问题的动作），与「检查结论」是两个概念：
 * resolved/ignored 只表示人处理过，绝不等于该项检查通过。
 */
export type CheckFindingStatus = 'open' | 'doing' | 'resolved' | 'ignored'

/** 证据项：可回溯的原始材料，不是结论摘要。 */
export interface CheckEvidence {
  kind: 'frame' | 'screenshot' | 'log' | 'metric'
  /** 产物 ID 或存储路径；与 timecodeMs 组合可定位到帧。 */
  ref: string
  timecodeMs?: TimecodeMs
  note?: string
}

export interface CheckFinding {
  findingId: Id
  projectId: Id
  checkRunId: Id
  /** 问题分类（如 'technical' | 'narrative'），由检查项定义，不在此枚举。 */
  category: string
  severity: CheckSeverity
  title: string
  description: string
  targetType: CheckTargetType
  targetId: Id
  /** 画面定位：仅在 targetType 为 scene/timeline/render 时有意义。 */
  timecodeMs?: TimecodeMs
  /** 证据（关键帧、截图、日志片段）；叙事类结论必须带，否则视为无效结论。 */
  evidence?: CheckEvidence[]
  status: CheckFindingStatus
  suggestedFix?: string
  /** 可执行的修改入口标识，供 UI 跳到对应操作；契约只约定标识，不约定交互。 */
  fixAction?: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  /** P1 预留 */
  resolvedAt?: IsoDateTime
  /** P1 预留：被哪条新问题项取代。 */
  supersededByFindingId?: Id
  etag: string
}

/**
 * 检查结论（派生值，不落库）：
 * - passed：run.status=completed 且无 blocker/major
 * - failed：run.status=completed 且存在 blocker/major
 * - not_run：没有 run，或 run 未完成（running/failed/cancelled）
 */
export type CheckConclusion = 'passed' | 'failed' | 'not_run'

export interface CheckRunDetail {
  run: CheckRun
  findings: Page<CheckFinding>
  conclusion: CheckConclusion
}

export interface CheckCreateRequest {
  /** 被检查的产物版本。 */
  renderId: Id
  /** 不传 = 全部检查项。 */
  categories?: string[]
  /** 只检查某段场景；不传 = 全片。 */
  sceneIds?: Id[]
  /** 复检时指向被替代的旧 run。 */
  supersedesCheckRunId?: Id
}

/** 只允许人改处理状态；检查结论字段不可由客户端写入。 */
export interface CheckFindingUpdateRequest {
  status: CheckFindingStatus
  note?: string
}

/* ============================ 渲染与交付 ============================ */

export type RenderStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface RenderOutput {
  fileId: Id
  url: string
  thumbnailUrl?: string
  durationMs: number
  sizeBytes: number
  width: number
  height: number
  fps: number
  createdAt: IsoDateTime
}

export interface RenderJob {
  renderId: Id
  projectId: Id
  taskId: Id
  status: RenderStatus
  preset: RenderPreset
  /** 仅 completed 存在。 */
  output?: RenderOutput
  error?: TaskError
  startedAt: IsoDateTime
  completedAt?: IsoDateTime
  demo?: DemoFlag
}

export interface RenderCreateRequest {
  preset: RenderPreset
  /** 只渲染某段；不传 = 全片。 */
  range?: { startMs: number; endMs: number }
}

/**
 * 交付状态。未组装/缺件时不得给下载入口，只能列出缺什么。
 * assembling 只是渲染/检查进行中，不等于可交付。
 */
export type DeliveryStatus =
  | 'unassembled'
  | 'assembling'
  | 'deliverable'
  | 'delivered'
  | 'missing'
  | 'acceptance_failed'

export interface DeliveryMissingItem {
  kind: 'scene' | 'render' | 'check' | 'asset' | 'acceptance'
  refId?: Id
  label: string
  /** 一句人话：缺什么、为什么。 */
  reason: string
}

export interface DeliveryState {
  projectId: Id
  status: DeliveryStatus
  /** 当前候选产物；尚未渲染时不出现。 */
  renderId?: Id
  missing: DeliveryMissingItem[]
  acceptance?: AcceptanceRecord
  updatedAt: IsoDateTime
  demo?: DemoFlag
}

export type AcceptanceDecision = 'accepted' | 'rejected'

export interface AcceptanceRecord {
  acceptanceId: Id
  projectId: Id
  renderId: Id
  decision: AcceptanceDecision
  note?: string
  /** 验收人标识（本地用户 ID，不是姓名）。 */
  decidedBy: string
  decidedAt: IsoDateTime
}

export interface AcceptanceRequest {
  decision: AcceptanceDecision
  note?: string
}

/* ============================ 素材 ============================ */

export type MediaType = 'image' | 'video' | 'audio' | 'font' | 'doc'

export type LicenseStatus = 'allowed' | 'attribution_required' | 'restricted' | 'unknown'

/**
 * 素材。授权状态与审核状态是两个独立字段：
 * 审核只改审核，不推断授权；无可靠授权信息一律 unknown。
 */
export interface Asset {
  id: Id
  name: string
  mediaType: MediaType
  mimeType: string
  sizeBytes: number
  sourceType: ResourceSourceType
  processingStatus: ResourceProcessingStatus
  /** 仅 processingStatus=failed 时存在。 */
  processingError?: string
  reviewStatus: ResourceReviewStatus
  availability: ResourceAvailability
  licenseStatus: LicenseStatus
  licenseDetails?: string
  width?: number
  height?: number
  durationMs?: number
  tags: string[]
  folderId: Id | null
  refs: ResourceRef[]
  /** 原始文件访问地址；需要鉴权时由后端签发短期 URL。 */
  fileUrl: string
  thumbnailUrl?: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  lastUsedAt?: IsoDateTime
  etag: string
  demo?: DemoFlag
}

export interface AssetFolder {
  id: Id
  name: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

/** 上传会话：分片上传，逐片确认；完成后生成 Asset。 */
export interface UploadSession {
  uploadId: Id
  fileName: string
  mimeType: string
  sizeBytes: number
  chunkSizeBytes: number
  receivedBytes: number
  status: 'created' | 'uploading' | 'completed' | 'failed' | 'cancelled'
  expiresAt: IsoDateTime
}

export interface AssetUpdateRequest {
  name?: string
  tags?: string[]
  folderId?: Id | null
  licenseStatus?: LicenseStatus
  licenseDetails?: string
  reviewStatus?: ResourceReviewStatus
  /** 停用/弃用由人显式操作；弃用不可逆。 */
  availability?: ResourceAvailability
}

export interface AssetListQuery extends PageQuery {
  mediaType?: MediaType
  sourceType?: ResourceSourceType
  folderId?: Id
  q?: string
  tags?: string[]
  sort?: 'recent' | 'name' | 'size' | 'created'
}

export interface AssetImportRequest {
  /** 桌面端按绝对路径导入（不经过浏览器上传）。 */
  filePath: string
  folderId?: Id
}

/* ============================ 知识库 ============================ */

export type FxCategory = 'camera' | 'transition' | 'lighting' | 'particles' | 'compositing' | 'stylize' | 'typography'
export type FxExecType = 'runnable' | 'composable' | 'reference'
export type FxImpl = 'realtime' | 'offline' | 'ai' | 'composite'
export type FxInputKind = 'image' | 'video' | 'audio' | 'text'

export interface FxParam {
  key: string
  label: string
  /** 源库默认值，已带单位。 */
  value: string
  hint: string
}

export interface FxTechnique {
  id: Id
  name: string
  nameEn: string
  aliases: string[]
  keywords: string[]
  intent: string
  category: FxCategory
  categoryLabel: string
  scenes: string[]
  antiScenes: string[]
  execType: FxExecType
  execLabel: string
  impl: FxImpl
  implLabel: string
  /** 1–5，源库口径。 */
  complexity: number
  inputKinds: FxInputKind[]
  inputLabels: string[]
  inputRequirement: string
  output: string
  dependencies: string[]
  steps: string[]
  compatibility: string[]
  limitations: string[]
  failures: string[]
  params: FxParam[]
  previewImageUrl: string
  previewVideoUrl: string | null
  previewCaption: string
  related: Id[]
  alternatives: Id[]
  featured: boolean
  version: string
  updatedAt: IsoDateTime
  demo?: DemoFlag
}

export interface FxFacet {
  id: string
  label: string
  count: number
}

export interface FxFacets {
  categories: FxFacet[]
  execTypes: FxFacet[]
  impls: FxFacet[]
  inputKinds: FxFacet[]
}

export interface MethodStep {
  /** 卡面上只留这几个字。 */
  k: string
  /** 完整名字（悬停 / 无障碍用）。 */
  name: string
  judge: string
  star?: boolean
}

/** 一套做法：片型不同，做法不同。 */
export interface Method {
  name: string
  lead: string
  steps: MethodStep[]
}

/** 片型画像：对某类作品的抽象描述，不得冒充「已解析视频」。 */
export interface Genome {
  id: Id
  name: string
  from: '实测' | '规格'
  persona: string
  /** 可量指纹。 */
  fingerprint: Array<{ key: string; value: string }>
  traits: string[]
  note: string
  /** 该型的判据图（项目卡封面）。 */
  imageUrl?: string
  method: Method
  demo?: DemoFlag
}

export type ReferenceStatus = 'analyzed' | 'partial' | 'pending'

export interface ReferenceVideo {
  id: Id
  title: string
  durationMs: number
  source: string
  description: string
  tags: string[]
  thumbnailUrl?: string
  /** 视频级解析状态；镜头段各有自己的 status。 */
  status: ReferenceStatus
  createdAt: IsoDateTime
  demo?: DemoFlag
}

export interface AnalysisValue {
  value: string
  /** 0–1；无置信度时为 null，不用 0 冒充「确定」。 */
  confidence: number | null
  /** 观察事实或推断依据。 */
  evidence: string
  /** true = 该维度尚未解析。 */
  pending: boolean
}

export type AnalysisKey =
  | 'scale' | 'composition' | 'cameraMove' | 'subjectMove'
  | 'color' | 'lighting' | 'rhythm' | 'transition'
  | 'narrative' | 'shotType'

export interface ReferenceShot {
  id: Id
  videoId: Id
  index: number
  startMs: number
  endMs: number
  status: ReferenceStatus
  tags: string[]
  /** 观察事实（只写看得到的）。 */
  observation: string
  /** 模型推断（必须与观察分开呈现）。 */
  inference: string
  /** 可复用建议。 */
  suggestion: string
  analysis: Record<AnalysisKey, AnalysisValue>
}

export interface ReferenceCollection {
  id: Id
  name: string
  note: string
  shotIds: Id[]
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

/** 参考片库的个人偏好：收藏、最近浏览、集合成员关系。跨项目共享。 */
export interface ReferencePreference {
  favorites: Id[]
  recent: Id[]
  /** collectionId → shotIds */
  memberships: Record<Id, Id[]>
  etag: string
}

export interface ReferencePreferenceUpdate {
  favorites?: Id[]
  recent?: Id[]
  memberships?: Record<Id, Id[]>
}

export interface ReferenceShotQuery extends PageQuery {
  videoId?: Id
  status?: ReferenceStatus
  q?: string
  tags?: string[]
  sort?: 'source' | 'index' | 'duration_desc' | 'duration_asc'
}

/* ============================ 对话 ============================ */

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatSession {
  id: Id
  projectId: Id
  title: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  messageCount: number
  demo?: DemoFlag
}

export interface ChatMessage {
  id: Id
  sessionId: Id
  role: ChatRole
  text: string
  /** 该条消息触发的任务；只是对话时不出现。 */
  taskId?: Id
  references?: AgentReference[]
  attachments?: TaskAttachment[]
  createdAt: IsoDateTime
  demo?: DemoFlag
}

export interface ChatSessionCreateRequest {
  projectId: Id
  title?: string
}

export interface ChatMessageCreateRequest {
  text: string
  references?: AgentReference[]
  attachments?: TaskAttachment[]
  /** 直接下达的修改约束；不传 = 用默认值。 */
  constraints?: ModificationConstraints
}

/* ============================ 流式协议 ============================ */

export interface TaskStreamSnapshot {
  type: 'snapshot'
  task: AgentTask
  /** 已发生的事件（用于重连补齐，最多最近 200 条）。 */
  events: TaskEvent[]
}

export interface TaskStreamEvent {
  type: 'event'
  event: TaskEvent
}

export interface TaskStreamEnd {
  type: 'end'
  status: TaskStatus
}

export interface StreamError {
  type: 'error'
  error: ApiErrorDetail
}

export type TaskStreamMessage = TaskStreamSnapshot | TaskStreamEvent | TaskStreamEnd | StreamError

export interface ChatStreamDelta {
  type: 'delta'
  messageId: Id
  delta: string
}

export interface ChatStreamCompleted {
  type: 'completed'
  message: ChatMessage
}

export interface ChatStreamTask {
  type: 'task'
  messageId: Id
  taskId: Id
}

export interface ChatStreamEnd {
  type: 'end'
}

export type ChatStreamMessage =
  | ChatStreamDelta
  | ChatStreamCompleted
  | ChatStreamTask
  | ChatStreamEnd
  | StreamError

/**
 * FengMotion 契约（纯类型，零实现、零运行时）。
 *
 * 口径来源：
 * - docs/contracts/workflow.md —— 工作流定义与运行
 * - docs/contracts/check.md    —— 检查运行与问题项
 * - docs/contracts/task.md     —— 任务协议与事件流
 *
 * 冻结规则：字段与枚举只增不改义；新语义新增字段或枚举值，旧值标注废弃并给迁移期。
 * 本文件不得 import 任何模块，也不得出现实现代码——视图与适配器从这里取类型。
 */

/* ============================ 通用 ============================ */

/** ISO 8601 UTC 时间串（如 2026-10-23T06:27:00Z）。格式化属视图职责，不进契约。 */
export type IsoDateTime = string

/** 毫秒时间戳，仅用于在产物/画面上定位（配合 targetType + targetId）。 */
export type TimecodeMs = number

/**
 * 演示标记。`true` = 由演示适配器产出，UI 必须显示「演示」标识。
 * 真实后端数据不返回该字段（不是 `false`，是不出现），避免「假数据看起来像真的」。
 */
export type DemoFlag = true

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

/**
 * 工作流定义。同一 id 的不同 version 是不可变快照：
 * 修改定义必须产生新 version，运行实例记录它当时用的 definitionVersion。
 */
export interface WorkflowDefinition {
  id: string
  name: string
  /** 定义版本号，随每次结构变更递增；已发布的 version 不允许原地修改。 */
  version: number
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
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
  runId: string
  /** 关联的任务 ID；任务状态由运行状态派生，见 task.md 的映射表。 */
  taskId: string
  definitionId: string
  definitionVersion: number
  status: WorkflowRunStatus
  nodeIO: Record<string, WorkflowNodeIO>
  error?: WorkflowRunError
  startedAt: IsoDateTime
  /** 仅终态存在；running 时字段不出现。 */
  completedAt?: IsoDateTime
}

/* ============================ 检查 ============================ */

/**
 * 检查运行状态。没有 pending：检查在创建时即开始执行。
 * 运行级取消只表示「这次检查没跑完」，不得解释为「检查通过」。
 */
export type CheckRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface CheckRun {
  checkRunId: string
  taskId: string
  renderId: string
  status: CheckRunStatus
  startedAt: IsoDateTime
  /** 仅终态存在。 */
  completedAt?: IsoDateTime
  /** P1 预留：复检以新 run 替代旧 run 时指向被替代者；旧 run 数据只读保留。 */
  supersedesCheckRunId?: string
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

export interface CheckFinding {
  findingId: string
  checkRunId: string
  /** 问题分类（如 'technical' | 'narrative'），由检查项定义，不在此枚举。 */
  category: string
  severity: CheckSeverity
  title: string
  description: string
  targetType: CheckTargetType
  targetId: string
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
  supersededByFindingId?: string
}

/** 证据项：可回溯的原始材料，不是结论摘要。 */
export interface CheckEvidence {
  kind: 'frame' | 'screenshot' | 'log' | 'metric'
  /** 产物 ID 或存储路径；与 timecodeMs 组合可定位到帧。 */
  ref: string
  timecodeMs?: TimecodeMs
  note?: string
}

/* ============================ 任务 ============================ */

/** 任务种类。undo/redo/restore 是对已发生变更的反向操作，同样走任务通道。 */
export type TaskKind = 'modify' | 'render' | 'undo' | 'redo' | 'restore'

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
 *
 * 位置一律用稳定 ID / 精确帧 / 归一化区域 / 产物版本表示；
 * 不让模型从「这里/这段」猜位置。
 */
export type AgentReference =
  | { id: string; role: 'target' | 'context'; kind: 'project'; projectId: string; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'shot'; shotId: string; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'frame'; shotId: string; frame: number; timecode: string; label: string; snapshotId?: string }
  | { id: string; role: 'target' | 'context'; kind: 'range'; shotId: string; startFrame: number; endFrame: number; timecode: string; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'region'; shotId: string; frame: number; bbox: { x: number; y: number; w: number; h: number }; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'artifact'; artifactId: string; version: string; label: string }

export interface TaskAttachment {
  name: string
  /** MIME 类型 */
  type: string
  /** 字节数 */
  size: number
}

export interface TaskRequest {
  kind: TaskKind
  prompt: string
  scope: 'project' | 'scene' | 'selection'
  sceneIds: string[]
  references?: AgentReference[]
  constraints: ModificationConstraints
  attachments: TaskAttachment[]
}

export interface AgentTask {
  id: string
  kind: TaskKind
  status: TaskStatus
  title: string
  createdAt: IsoDateTime
  demo?: DemoFlag
}

export interface TaskEvent {
  id: string
  taskId: string
  kind: TaskEventKind
  status: TaskStatus
  /** 面向用户的可见说明；不得包含模型推理过程。 */
  message: string
  at: IsoDateTime
  demo?: DemoFlag
}

export interface ChangeSet {
  taskId: string
  files: Array<{ path: string; summary: string; additions: number; deletions: number }>
  buildStatus: 'not-run' | 'passed' | 'failed'
  demo?: DemoFlag
}

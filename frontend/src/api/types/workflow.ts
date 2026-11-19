/** API 契约 · 工作流。纯类型，规则见 api/contracts.ts 文件头。 */
import type { DemoFlag, Id, IsoDateTime } from './common'

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

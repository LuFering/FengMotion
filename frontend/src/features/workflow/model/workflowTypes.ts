import { readHarnessSelection } from '@/features/harness/hooks/useHarnessSelection'
import { type NodeIO } from '@/features/workflow/services/workflowExecution'
import type { AgentReference, AgentTask, ChangeSet, TaskEvent, TaskStatus } from '@/api/studioApi'
import { type WfEdgeInstance, type WfNodeInstance, type WfPath, type WorkflowLegacyDrafts, type WorkflowPresetMeta } from '@/features/workflow/model/workflowTemplates'

export interface WorkflowDef {
  id: string
  name: string
  description: string
  path: WfPath
  presetId: string
  projectId: string | null
  revision: number
  schemaVersion?: number
  legacyDrafts?: WorkflowLegacyDrafts
  /** 若从后端启用的 skill 预设新建，保存其 presetId 与来源快照 */
  skillPresetId?: string | null
  skillPresetMeta?: WorkflowPresetMeta
  createdAt: string
  updatedAt: string
  nodes: WfNodeInstance[]
  edges: WfEdgeInstance[]
  resourceReferences?: AgentReference[]
}

export interface WfArtifact {
  id: string
  nodeId: string
  nodeType: string
  kind: string
  title: string
  filename: string
  summary: string
  content: string
  /**
   * 这个产物是真实文件还是界面快照。
   *
   * <p>以前这里写死 `true`，等于类型层面就规定了「所有产物都是假的」。
   * 「制作与渲染」节点现在会真的调 agent 改工程并渲染出片，
   * 那个产物必须能标记成 false，界面才不会把真视频说成演示快照。</p>
   */
  demo: boolean
}

export type WfNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting_info'

export interface WorkflowRun {
  id: string
  workflowId: string
  workflowName: string
  revision: number
  /** Immutable run identity; absent on legacy records. */
  projectId?: string | null
  executionMode?: 'project' | 'demo' | 'evaluation' | 'single-demo'
  nodeLabels?: Record<string, string>
  status: TaskStatus
  task: AgentTask
  events: TaskEvent[]
  artifacts: WfArtifact[]
  changes: ChangeSet | null
  nodeStatus: Record<string, WfNodeStatus>
  startedAt: string
  finishedAt: string | null
  demo: boolean
  nodeIO?: Record<string, NodeIO>
  definition?: WorkflowDef
  engineSelection?: ReturnType<typeof readHarnessSelection>
  nodeAttempts?: Record<string, number>
  /** 每个节点尝试的标准 UUID requestId，供后端 recordCorrection 幂等校验与断线重连复用 */
  nodeRequestIds?: Record<string, string>
  /** 本次运行提交过的审片返工签名，防止未再次审片时重复追加同一条 correction */
  submittedReworkSignature?: string
}

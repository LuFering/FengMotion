/**
 * 工作流服务层（v5 重构 · schemaVersion 2）
 *
 * 页面只经此层读写。形状对齐冻结契约：运行的 task/events 复用 studioApi
 * 的 AgentTask / TaskEvent，产物变更摘要复用 ChangeSet。
 *
 * 本文件只做对外入口，实现按职责拆在 workflow/ 下：
 * - store：本机存储、种子工作流、增删改查（workflowService）
 * - gate：Gate 评估（首页与检查器共用同一口径）
 * - runSteps：演示执行器的共用步骤（拓扑序、产物生成与校验）
 * - demoRun：整条运行与项目图运行（两者互相调用，放在一起）
 * - singleNodeRun：检查器里的「只运行此节点」
 * - projectRun：项目运行的继续、交付与失败重试
 * 类型在 model/workflowTypes。
 */
export type { WorkflowDef, WfArtifact, WfNodeStatus, WorkflowRun } from '@/features/workflow/model/workflowTypes'
export { workflowService } from '@/features/workflow/services/workflow/store'
export { GATE_PRIMARY_KIND, evaluateGate, gateSummaryOf, type GateEval } from '@/features/workflow/services/workflow/gate'
export { QUALITY_QUESTIONS, type DemoRunHandle } from '@/features/workflow/services/workflow/runSteps'
export { startDemoRun, workflowResourceReferences } from '@/features/workflow/services/workflow/demoRun'
export { startSingleNodeRun } from '@/features/workflow/services/workflow/singleNodeRun'
export { resumeProjectRun, deliverProjectRun, retryFailedProjectRun } from '@/features/workflow/services/workflow/projectRun'

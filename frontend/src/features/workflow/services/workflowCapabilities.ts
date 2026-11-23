/**
 * 节点执行能力：同一个节点在不同条件下做的事不同（关联项目时「制作与渲染」会真实调用 Agent，没关联时只是演示）。
 * 界面上的节点标签、检查器、运行按钮都从这里取，不在组件里各写一套判断。
 *
 * 契约 workflow-editor-ui.md §4：后端将提供 GET /api/workflow/node-capabilities；
 * 端点实现之前，按当前执行器（demoRun.ts / workflowExecution.ts）的事实在这里维护一份（§4.3）。
 */
import type { WfPath } from '@/features/workflow/model/workflowTemplates'

export type NodeExecution = 'agent' | 'resolve' | 'manual' | 'deterministic' | 'demo'

export interface NodeCapability {
  execution: NodeExecution
  /** 界面标签 */
  label: string
  /** 给用户看的一句话：这个节点运行时会做什么 */
  detail: string
}

export const EXECUTION_LABEL: Record<NodeExecution, string> = {
  agent: '真实制作',
  resolve: '读取资料',
  manual: '需要你确认',
  deterministic: '自动判定',
  demo: '演示',
}

const PROJECT_DETAIL: Record<string, { execution: NodeExecution; detail: string }> = {
  /* 文件名（prompt.original.md / corrections.md）是执行器的实现，不写进界面文案 */
  prompt: { execution: 'resolve', detail: '第一次运行时保存你的原话，之后的修改单独记录，原话不会被覆盖' },
  refs: { execution: 'resolve', detail: '选中的素材和参考片段会一起交给制作' },
  capability: { execution: 'resolve', detail: '勾选的技法作为参考交给制作，不会自动套用' },
  create: { execution: 'agent', detail: '调用 Agent 修改项目并渲染，每次生成一个新版本' },
  review: { execution: 'manual', detail: '结论由你决定；选「需要修改」，下次运行会回到制作' },
  delivery: { execution: 'deterministic', detail: '审片通过的正是最新一次渲染时输出成片，不调用模型' },
}

export function nodeCapability(nodeType: string, ctx: { path: WfPath; projectId: string | null | undefined }): NodeCapability {
  if (ctx.path === 'structured') {
    return { execution: 'manual', label: EXECUTION_LABEL.manual, detail: '只评估阶段产物和检查点，不制作视频' }
  }
  if (!ctx.projectId) {
    return { execution: 'demo', label: EXECUTION_LABEL.demo, detail: '还没关联项目，运行只演示流程，不会改动任何项目' }
  }
  const known = PROJECT_DETAIL[nodeType]
  if (!known) return { execution: 'demo', label: EXECUTION_LABEL.demo, detail: '这个节点还没有接入真实执行' }
  return { ...known, label: EXECUTION_LABEL[known.execution] }
}

/** 运行按钮旁边的标签：整条工作流这次运行是真实制作、演示还是只评估 */
export function runCapability(ctx: { path: WfPath; projectId: string | null | undefined }): { label: string; detail: string; real: boolean } {
  if (ctx.path === 'structured') return { label: '只评估', detail: '只评估阶段产物与检查点，不会制作视频', real: false }
  if (!ctx.projectId) return { label: '演示', detail: '没有关联项目：运行只演示流程，不读写项目。关联项目后可以真实制作。', real: false }
  return { label: '真实制作', detail: '会调用 Agent 修改关联项目并渲染；交付需要审片通过最新一次渲染', real: true }
}

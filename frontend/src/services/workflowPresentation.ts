import type { WorkflowDef, WorkflowRun } from './workflowService'

export function workflowBrief(workflow: WorkflowDef) {
  const prompt = workflow.nodes.find((n) => n.type === 'prompt')?.params.text
  return (typeof prompt === 'string' && prompt.trim() ? prompt : workflow.description).trim().replace(/\s+/g, ' ')
}

/** Historical outputs only project onto the exact definition that produced them. */
export function runMatchesDefinition(run: WorkflowRun | null, workflow: WorkflowDef | null, dirty: boolean) {
  return Boolean(run && workflow && !dirty && run.workflowId === workflow.id
    && run.revision === workflow.revision && run.projectId !== undefined && run.projectId === workflow.projectId)
}

export function workflowRunLabel(run: WorkflowRun) {
  switch (run.executionMode) {
    case 'project': return '项目运行'
    case 'evaluation': return '状态评估'
    case 'single-demo': return '单节点演示'
    case 'demo': return '演示运行'
    // Old records don't prove execution mode: a failed real run can have no video.
    default: return run.artifacts.some((a) => !a.demo) ? '运行记录 · 含真实产物' : '运行记录 · 类型未记录'
  }
}

export function workflowProjectLabel(projectId: string | null, projects: Array<{ id: string; name: string }>, loading = false, failed = false) {
  if (!projectId) return '未关联项目 · 可编辑与演示'
  const project = projects.find((p) => p.id === projectId)
  if (project) return project.name
  return loading ? '正在读取关联项目…' : failed ? '关联项目读取失败' : '关联项目不在当前列表'
}

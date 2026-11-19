import { extractReworkCorrection } from '@/features/workflow/services/workflowExecution'
import type { WorkflowDef, WorkflowRun } from '@/features/workflow/model/workflowTypes'
import { startDemoRun, startProjectGraph } from '@/features/workflow/services/workflow/demoRun'

export function resumeProjectRun(run:WorkflowRun,callbacks:Parameters<typeof startDemoRun>[1]) {
  if(!run.definition || !run.projectId || !['running','awaiting_info'].includes(run.status))throw new Error('此记录没有可继续的执行快照')
  return startProjectGraph(run.definition,{...callbacks,projectId:run.projectId},run)
}

/** 只比结构（节点 ID、类型与连线），不比参数：审片结论改的是参数，保存时 revision 会变，不能用 revision 判断。 */
export function graphShape(wf: Pick<WorkflowDef, 'nodes' | 'edges'>): string {
  const nodes = wf.nodes.map((n) => `${n.id}:${n.type}`).sort().join('|')
  const edges = wf.edges.map((e) => `${e.source}.${e.sourcePort}>${e.target}.${e.targetPort}`).sort().join('|')
  return `${nodes}#${edges}`
}

/**
 * 按最新审片结论继续交付。
 *
 * <p>新运行一定会重新渲染，上一轮的审片结论永远对不上新版本；普通的继续运行读的是运行开始时的快照，
 * 看不到之后的审片结论。这里只把当前工作流里审片节点的参数同步进快照，清掉审片与交付的旧结果让它们重新判断，
 * 保留 create 的结果，不重新渲染。</p>
 *
 * <p>审片结论是「需要修改」时拒绝：继续运行会沿用原来的 requestId，带上修改意见后后端会按幂等冲突拒绝。
 * 返工统一走新运行。</p>
 */
export function deliverProjectRun(run: WorkflowRun, current: WorkflowDef | null, callbacks: Parameters<typeof startDemoRun>[1]) {
  if (!run.definition || !run.projectId || run.status !== 'awaiting_info'
    || !Object.values(run.nodeIO ?? {}).some((io) => io.outputs?.status === 'awaiting_review')) {
    throw new Error('这次运行没有停在「等待审片通过」，无法继续交付')
  }
  if (!current || current.id !== run.workflowId) throw new Error('找不到这次运行对应的工作流')
  if (graphShape(current) !== graphShape(run.definition)) {
    throw new Error('工作流结构在这次运行之后改过，请重新运行')
  }
  const definition = structuredClone(run.definition)
  for (const node of definition.nodes) {
    if (node.type !== 'review') continue
    const fresh = current.nodes.find((n) => n.id === node.id)
    if (fresh) node.params = structuredClone(fresh.params)
  }
  if (extractReworkCorrection(definition).rework) {
    throw new Error('审片结论是「需要修改」，请点「运行」开始新一轮制作')
  }
  const copy = structuredClone(run)
  copy.definition = definition
  copy.nodeIO = { ...(copy.nodeIO ?? {}) }
  for (const node of definition.nodes) {
    if (node.type === 'review' || node.type === 'delivery') delete copy.nodeIO[node.id]
  }
  copy.status = 'running'
  return startProjectGraph(definition, { ...callbacks, projectId: copy.projectId! }, copy)
}

export function retryFailedProjectRun(previous:WorkflowRun,callbacks:Parameters<typeof startDemoRun>[1]){
  if(!previous.definition||!previous.projectId||previous.status!=='failed')throw new Error('此运行没有可重试的失败节点')
  const copy=structuredClone(previous)
  copy.nodeAttempts={...copy.nodeAttempts}
  for(const [id,io] of Object.entries(copy.nodeIO??{}))if(io.error){copy.nodeAttempts[id]=(copy.nodeAttempts[id]??0)+1;io.outputs={};delete io.error;}
  copy.status='running'
  return startProjectGraph(copy.definition!,{...callbacks,projectId:copy.projectId!},copy)
}

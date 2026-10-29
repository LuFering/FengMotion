import { FileText, History, LoaderCircle } from 'lucide-react'
import type { TaskEvent, TaskRequest } from '@/services/studioApi'
import type { WorkflowRun } from '@/services/workflowService'
import { TASK_STATUS_LABEL } from '@/shell/status'

/** The sent request is immutable context, independent of the current selection. */
export function RequestSnapshot({ request }: { request: TaskRequest | null | undefined }) {
  if (!request) return null
  const target = request.references?.find((ref) => ref.role === 'target')
  const contexts = request.references?.filter((ref) => ref.role === 'context') ?? []
  const keep = [request.constraints.preserveCamera && '机位', request.constraints.preserveCaptions && '字幕与配音', request.constraints.limitToSelection && '其他场景', request.constraints.reuseExistingComponents && '复用现有组件'].filter(Boolean)
  return <details className="wb-request-snapshot"><summary><FileText size={12}/><span>{target?.label ?? '整个项目'}</span><small>查看发送记录</small></summary><dl>
    <dt>修改目标</dt><dd>{target?.label ?? '整个项目'}</dd>
    {target?.kind === 'preview' && <><dt>预览来源</dt><dd>{target.source.file}</dd>{target.source.revision !== undefined && <><dt>{target.source.origin === 'editor' ? '编辑版本' : '工作流版本'}</dt><dd>v{target.source.revision}</dd></>}{target.timeSeconds !== undefined && <><dt>时间位置</dt><dd>{target.timeSeconds.toFixed(3)} 秒</dd></>}{target.bbox && <><dt>画面区域</dt><dd>x {(target.bbox.x * 100).toFixed(1)}% · y {(target.bbox.y * 100).toFixed(1)}%<br/>宽 {(target.bbox.w * 100).toFixed(1)}% · 高 {(target.bbox.h * 100).toFixed(1)}%</dd></>}</>}
    {contexts.length > 0 && <><dt>参考上下文</dt><dd>{contexts.map((ref) => ref.label).join('、')}</dd></>}
    <dt>保留条件</dt><dd>{keep.length ? keep.join(' · ') : '无额外限制'}{request.creativeBrief?.keepNotes && <><br/>{request.creativeBrief.keepNotes}</>}</dd>
    {target?.kind === 'preview' && target.endTimeSeconds !== undefined && <><dt>结束位置</dt><dd>{target.endTimeSeconds.toFixed(3)} 秒</dd></>}
    {request.creativeBrief && <><dt>需求依据</dt><dd>{request.creativeBrief.original}<br/>{request.creativeBrief.corrections.map((c, i) => <span key={c.id}>补充 {i + 1}：{c.text}<br/></span>)}</dd></>}
  </dl></details>
}

/** Workflow runs and conversation requests share the execution drawer, not a fake unified progress. */
export function WorkflowExecutionLog({ runs, liveEvents, running }: { runs: WorkflowRun[]; liveEvents: TaskEvent[]; running: boolean }) {
  if (!runs.length && !liveEvents.length) return null
  return <section className="wb-workflow-log" aria-label="工作流执行记录"><div className="wb-workflow-log-title"><History size={13}/>工作流演示记录</div>
    {running && <div className="wb-workflow-running" role="status"><LoaderCircle size={13} className="animate-spin"/>{liveEvents.at(-1)?.message ?? '演示执行已开始'}</div>}
    {runs.slice(0, 8).map((run) => <details key={run.id} className="wb-workflow-run"><summary><b>{run.workflowName}</b><span>v{run.revision} · {new Date(run.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><span>{TASK_STATUS_LABEL[run.status] ?? run.status} · {run.artifacts.length} 项记录</span></summary><div className="wb-workflow-run-content">{run.events.map((event) => <p key={event.id}>{event.message}</p>)}{run.artifacts.map((artifact) => <details key={artifact.id}><summary>{artifact.title}</summary><p>{artifact.summary}</p><pre>{artifact.content}</pre></details>)}</div></details>)}
  </section>
}

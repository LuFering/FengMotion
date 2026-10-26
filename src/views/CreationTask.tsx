import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  startDemoRun,
  workflowService,
  type WorkflowRun,
  type WfNodeStatus,
} from '../services/workflowService'
import { WF_NODE_DEFS } from '../data/workflowTemplates'
import '../styles/creation-task.css'

/**
 * 工作台「本次制作」任务面 —— 创作启动层建好的工作流实例在这里执行与呈现：
 * 阶段进度、产物、再运行，以及回方法工坊（工作流编辑器）的深链。
 * 它读的是工作流同一份运行记录（workflowService），不另立状态；
 * Gate 的确认动作目前仍在编辑器检查器里，这里如实指路，不假装内联。
 */

const STATUS_MARK: Record<WfNodeStatus, string> = {
  pending: '·',
  running: '…',
  completed: '✓',
  failed: '✕',
  skipped: '—',
}

export function CreationTaskPanel(props: {
  workflowId: string
  autoRun: boolean
  onOpenEditor: () => void
  onClose: () => void
}) {
  const wf = useMemo(() => workflowService.getWorkflow(props.workflowId), [props.workflowId])
  const stages = useMemo(
    () => (wf?.nodes ?? []).filter((n) => WF_NODE_DEFS.some((d) => d.type === n.type)),
    [wf],
  )
  const labelOf = useCallback(
    (type: string) => WF_NODE_DEFS.find((d) => d.type === type)?.label ?? type,
    [],
  )
  const [statuses, setStatuses] = useState<Record<string, WfNodeStatus>>({})
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState<WorkflowRun | null>(() =>
    props.workflowId ? (workflowService.listRuns(props.workflowId)[0] ?? null) : null,
  )
  const startedRef = useRef(false)

  const doRun = useCallback(() => {
    if (!wf || running) return
    setRunning(true)
    setRun(null)
    setStatuses({})
    const handle = startDemoRun(wf, {
      onEvent: () => {},
      onNodeStatus: (nodeId, status) =>
        setStatuses((prev) => ({ ...prev, [nodeId]: status })),
    })
    void handle.done.then((r) => {
      setRun(r)
      setRunning(false)
    })
  }, [wf, running])

  useEffect(() => {
    if (!props.autoRun || startedRef.current) return
    startedRef.current = true
    if (!run) doRun()
    // 只在挂载时判断一次：已有运行记录则直接呈现，不重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!wf) return null
  const artifacts = run?.artifacts ?? []

  return (
    <section className="ctk" aria-label="本次制作">
      <header className="ctk-head">
        <b>本次制作</b>
        <span className="ctk-demo">演示执行器</span>
        <span className="ctk-spacer" />
        <button type="button" className="ctk-x" onClick={props.onClose} aria-label="收起本次制作">✕</button>
      </header>
      <div className="ctk-name" title={wf.name}>{wf.name}</div>
      <div className="ctk-meta">
        {wf.path === 'prompt-first' ? 'Prompt-first' : 'Structured'} · {stages.length} 个阶段
        {run ? ` · ${run.status === 'completed' ? '已完成' : run.status}` : running ? ' · 运行中' : ' · 未运行'}
      </div>

      <ul className="ctk-stages">
        {stages.map((n) => {
          const s = statuses[n.id] ?? (run ? 'completed' : 'pending')
          return (
            <li key={n.id} data-s={s}>
              <span className="ctk-mark">{STATUS_MARK[s]}</span>
              <span className="ctk-stage-name">{labelOf(n.type)}</span>
              <span className="ctk-stage-status">
                {s === 'completed' ? '已完成' : s === 'running' ? '运行中' : s === 'failed' ? '失败' : ''}
              </span>
            </li>
          )
        })}
      </ul>

      {artifacts.length > 0 && (
        <div className="ctk-artifacts">
          <div className="ctk-sub">产物 {artifacts.length} 项</div>
          {artifacts.map((a) => (
            <div key={a.id} className="ctk-art" title={a.summary}>
              <span>{a.title}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ctk-actions">
        <button type="button" className="ctk-run" disabled={running} onClick={doRun}>
          {running ? '运行中…' : run ? '再运行一次' : '开始运行'}
        </button>
        <button type="button" className="ctk-editor" onClick={props.onOpenEditor}>
          打开工作流编辑器
        </button>
      </div>
    </section>
  )
}

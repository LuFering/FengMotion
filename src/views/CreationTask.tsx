import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { startDemoRun, workflowService, type WorkflowRun, type WfNodeStatus } from '../services/workflowService'
import { WF_NODE_DEFS } from '../data/workflowTemplates'
import '../styles/creation-task.css'

/**
 * 工作台左栏的「正在制作」——一条简短状态，不是阶段清单。
 *
 * 左栏是导航，用途是「这部片有哪些内容、要去哪里改」。工作流有几个阶段、跑到第几步、
 * 产出了哪几份产物，属于工作流编辑器与底部任务面板；铺进 230px 的左栏会把导航淹掉。
 * 所以这里只回答三个问题：在做什么、做到哪、要去哪里看细节。
 *
 * 「查看执行」去底部任务面板（那里有事件与产物），「工作流」去编辑器看阶段与 Gate。
 * Gate 的确认动作仍在编辑器检查器里，这里如实指路，不假装内联。
 *
 * 运行仍是演示执行器（不调 AI、不写文件、不出片），所以标记保留、不删。
 */

/** 把节点状态压成一句进度话，而不是把每个节点列出来。 */
/** 这一格报的是「这次执行器跑到哪」，不是「这部片做到哪」。
    制作进度归左栏「当前进度」—— 它还要看结论有没有落下来（没人看片就不算完），
    所以两个数天然不同。以前两边都写「x/y 阶段」，同一个屏幕上会并排出现
    3/3 和 2/3 两个读数，看着像 bug。单位分开：这里说「步」。 */
function progressOf(stages: { id: string }[], statuses: Record<string, WfNodeStatus>, run: WorkflowRun | null, running: boolean) {
  if (stages.length === 0) return '没有可运行的阶段'
  const done = stages.filter((n) => (statuses[n.id] ?? (run ? 'completed' : 'pending')) === 'completed').length
  if (running) return `运行中 · ${done}/${stages.length} 步`
  if (!run) return `未运行 · ${stages.length} 个步骤`
  if (run.status === 'completed') return `本次运行已完成 · ${stages.length} 步`
  return `本次运行${run.status === 'cancelled' ? '已停止' : '失败'} · ${done}/${stages.length} 步`
}

export function CreationTaskPanel(props: {
  workflowId: string
  autoRun: boolean
  onOpenEditor: () => void
  /** 去看这次到底跑了什么 —— 底部任务面板的执行过程 */
  onOpenExecution: () => void
  /** 跑完一次运行后通知外面重取运行记录：左栏「当前进度」读的是同一份存储，
      不通知它就会一格说「已完成」、一格还停在「未运行」。 */
  onRan?: () => void
  onClose: () => void
}) {
  const wf = useMemo(() => workflowService.getWorkflow(props.workflowId), [props.workflowId])
  const onRan = props.onRan
  const stages = useMemo(
    () => (wf?.nodes ?? []).filter((n) => WF_NODE_DEFS.some((d) => d.type === n.type)),
    [wf],
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
    /* 这里不需要事件回调：事件属于底部任务面板，这一格只显示一行进度。
       （onEvent 仍然是必须传的 —— startDemoRun 用不到时会断言失败。） */
    const handle = startDemoRun(wf, {
      onEvent: () => {},
      onNodeStatus: (nodeId, status) => setStatuses((prev) => ({ ...prev, [nodeId]: status })),
    })
    void handle.done.then((r) => {
      setRun(r)
      setRunning(false)
      onRan?.()
    })
  }, [wf, running, onRan])

  useEffect(() => {
    if (!props.autoRun || startedRef.current) return
    startedRef.current = true
    if (!run) doRun()
    // 只在挂载时判断一次：已有运行记录则直接呈现，不重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!wf) return null
  const progress = progressOf(stages, statuses, run, running)

  return (
    <section className="ctk" aria-label="正在制作">
      <header className="ctk-head">
        <b>正在制作</b>
        <span className="ctk-demo">演示执行器</span>
        <span className="ctk-spacer" />
        <button type="button" className="ctk-x" onClick={props.onClose} aria-label="收起正在制作">✕</button>
      </header>
      <div className="ctk-name" title={wf.name}>{wf.name}</div>
      <div className="ctk-meta" data-running={running || undefined}>
        {running ? <span className="fm-dot" data-s="running" /> : null}
        {progress}
      </div>
      <div className="ctk-actions">
        <button type="button" className="ctk-run" disabled={running} onClick={doRun}>
          {running ? '运行中…' : run ? '再运行一次' : '开始运行'}
        </button>
        {/* 两个深链放第二行：挤在同一行会把主动作压成「开始…」 */}
        <div className="ctk-links">
          <button type="button" className="ctk-mini" onClick={props.onOpenExecution}>查看执行</button>
          <button type="button" className="ctk-mini" onClick={props.onOpenEditor}>工作流</button>
        </div>
      </div>
    </section>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  startDemoRun, workflowService,
  type WfNodeStatus, type WorkflowDef, type WorkflowRun,
} from '@/services/workflowService'
import { WF_NODE_DEFS } from '@/data/workflowTemplates'
import { fmtDay, TASK_STATUS_LABEL } from '@/shell/status'
import { Progress } from '@/components/ui/progress'

/**
 * 工作台左栏「当前进度」——概览里的第一格：这部片做到哪、下一步是什么、怎么开始跑。
 *
 * 这里原来分成两块：一块「正在制作」面板（标题行 + 名称 + 阶段数 + 三个动作），
 * 一块「当前进度」读数卡（进度条 + 落在哪一步 + 最近一次运行）。两块都在报同一件事，
 * 同屏并排会出现两个阶段数（一个数执行器跑了几步、一个数制作进度），怎么措辞都别扭。
 * 现在合成一格：读数在上、动作在下，数只有一个。
 *
 * 阶段清单与工作流编辑器同一份定义（节点图里的阶段节点）。一个阶段算「做完」要同时
 * 满足两条：运行把它标成 completed，**并且它真的留下了结论** —— 看片节点要有
 * checks.done、门禁要有 decision。只看运行状态，演示执行器跑完就会显示
 * 「所有阶段都已完成」，而下面「待决定」还挂着一条，自相矛盾。
 * 没跑过就如实写「未运行」，不按内容猜、不编百分比 —— 工作流里没有「第几秒、
 * 第几个镜头」这种刻度，那是渲染切片，不是内容。
 *
 * 运行仍是演示执行器（不调 AI、不写文件、不出片），所以标记保留、不删。
 */

export function RailProgressPanel({ workflow, autoRun, task, onRunStart, onOpenTask, onOpenEditor, onOpenExecution }: {
  /** 当前项目的工作流；节点参数由外面传进来（写回决定后外面会重取，这里才跟着更新） */
  workflow: WorkflowDef | null
  /** 从创作启动层带过来的「建好就开跑」 */
  autoRun: boolean
  /** AI 任务此刻在哪个内容上。只在真的还在跑时有值 —— 没有就整块不显示，
      左栏不常驻一条「暂无任务」。指令、文件变化、错误详情不在这里，
      它们在右侧任务页与底部面板。 */
  task: { label: string; state: string } | null
  /** 真的跑起来了 —— 外面据此消费掉启动信号，避免下次进工作台又自动跑一遍 */
  onRunStart?: () => void
  /** 点这一块：右侧跳到当前任务（那里才是执行过程） */
  onOpenTask: () => void
  onOpenEditor: () => void
  /** 去看这次到底跑了什么 —— 底部任务面板的执行过程 */
  onOpenExecution: () => void
}) {
  const stages = useMemo(
    () => (workflow?.nodes ?? []).filter((n) => WF_NODE_DEFS.some((d) => d.type === n.type)),
    [workflow],
  )
  const [statuses, setStatuses] = useState<Record<string, WfNodeStatus>>({})
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState<WorkflowRun | null>(null)
  const startedRef = useRef(false)
  /* 进来先看上次跑成什么样；自己再跑一次就换成本次的结果 */
  const run = finished ?? (workflow ? (workflowService.listRuns(workflow.id)[0] ?? null) : null)

  const doRun = useCallback(() => {
    if (!workflow || running) return
    setRunning(true)
    setFinished(null)
    setStatuses({})
    onRunStart?.()
    /* 这里不需要事件回调：事件属于底部任务面板，这一格只显示一行进度。
       （onEvent 仍然是必须传的 —— startDemoRun 用不到时会断言失败。） */
    const handle = startDemoRun(workflow, {
      onEvent: () => {},
      onNodeStatus: (nodeId, status) => setStatuses((prev) => ({ ...prev, [nodeId]: status })),
    })
    void handle.done.then((r) => {
      setFinished(r)
      setRunning(false)
    })
  }, [workflow, running, onRunStart])

  useEffect(() => {
    /* 只在挂载时判断一次：已经有运行记录就直接呈现，不重跑 */
    if (!autoRun || startedRef.current || !workflow) return
    startedRef.current = true
    if (!run) doRun()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!workflow || stages.length === 0) return null

  const statusOfNode = (id: string): WfNodeStatus => statuses[id] ?? run?.nodeStatus?.[id] ?? 'pending'
  /* 双条件才算做完：运行标了 completed，并且这一步留下了结论 */
  const stageDone = (n: (typeof stages)[number]) => {
    const st = statusOfNode(n.id)
    if (st === 'skipped') return true
    if (st !== 'completed') return false
    if (n.type === 'review') return !!(n.params.checks as Record<string, boolean> | undefined)?.done
    if (n.type === 'gate') return n.params.decision === 'confirmed'
    return true
  }
  const done = stages.filter(stageDone).length
  const runningStage = stages.find((n) => statusOfNode(n.id) === 'running' && !stageDone(n))
  const next = runningStage ?? stages.find((n) => !stageDone(n))
  const labelOf = (n: (typeof stages)[number]) => WF_NODE_DEFS.find((d) => d.type === n.type)?.label ?? n.type
  const at = run ? run.finishedAt || run.startedAt : ''

  return (
    <section>
      <div className="fw-scene-hd">
        <span>当前进度</span><span className="spacer" />
        <span className="hint num">{done}/{stages.length}</span>
      </div>
      <div className="fw-prog">
        {/* 正在制作：压在这一张卡的第一行，不另开栏目。说的是「在哪个内容上」，
            具体做了什么去右侧看。 */}
        {task && (
          <button type="button" className="fw-prog-live" onClick={onOpenTask}>
            <span className="fw-prog-live-hd">
              <i className="fm-dot" data-s="running" />
              <b>正在制作</b>
              <span className="fw-prog-state">{task.state}</span>
            </span>
            <span className="fw-prog-live-now">
              <b>{task.label}</b>
              <span className="fw-prog-live-go" aria-hidden="true">›</span>
            </span>
          </button>
        )}
        <Progress value={(done / stages.length) * 100}
                  aria-label={`阶段进度 ${done}/${stages.length}`} />
        <span className="fw-prog-now">
          <i className="fm-dot" data-s={next ? (runningStage ? 'running' : 'idle') : 'done'} />
          <b>{next ? labelOf(next) : '所有阶段都已完成'}</b>
          <span className="fw-prog-state">{next ? (runningStage ? '进行中' : '待做') : '已完成'}</span>
        </span>
        <span className="fw-prog-meta">
          <span>{run ? `${fmtDay(at)} · ${TASK_STATUS_LABEL[run.status] ?? run.status}` : '未运行'}</span>
          <span className="fw-prog-demo">演示执行器</span>
        </span>
        <div className="fw-prog-acts">
          <button type="button" className="fw-prog-run" disabled={running} onClick={doRun}>
            {/* 三个按钮平分这一行，5 个字会截断成「再运行…」，所以用 4 字 */}
            {running ? '运行中…' : run ? '重新运行' : '开始运行'}
          </button>
          <button type="button" className="fw-prog-mini" onClick={onOpenExecution}>查看执行</button>
          <button type="button" className="fw-prog-mini" onClick={onOpenEditor}>工作流</button>
        </div>
      </div>
    </section>
  )
}

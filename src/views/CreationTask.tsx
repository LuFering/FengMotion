import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Square } from 'lucide-react'
import { workflowService, type WfArtifact, type WfNodeStatus } from '../services/workflowService'
import type { TaskStatus } from '../services/studioApi'
import type { useAgentTasks } from '../hooks/useAgentTasks'
import { WF_NODE_DEFS } from '../data/workflowTemplates'
import { TASK_STATUS_LABEL } from '@/shell/status'
import '../styles/creation-task.css'

/**
 * 工作台「本次制作」任务面 —— 创作启动层建好的工作流实例在这里执行与呈现：
 * 阶段进度、产物、再运行，以及回方法工坊（工作流编辑器）的深链。
 *
 * 它**不持有运行状态**：这次运行的记录写在 useAgentTasks 那一份共享记录里，
 * 面板只是这份记录的一个读法。之前这里是自己调 startDemoRun、把 onEvent 写成
 * `() => {}` 直接丢掉事件，于是这次运行只活在组件内部，底部任务面板完全看不见它 ——
 * 同一个应用里两处各说一套「AI 在做什么」，正是这次要消掉的东西。
 * 本次会话还没有这条记录时，回落到 workflowService 里上一次真实持久化的运行
 * （有就如实显示，没有就显示未运行），不编造中间态。
 *
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
  /** 全应用唯一的一份任务记录（App 注入）；底部任务面板读的是同一份 */
  tasks: ReturnType<typeof useAgentTasks>
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

  /* 本工作流在本次会话里的那条记录 —— 阶段状态与产物都从它读，本地不再存第二份 */
  const record = props.tasks.records.find((r) => r.workflow?.workflowId === props.workflowId) ?? null
  /* 会话里还没有记录时，才去读上一次持久化的真实运行；
     有记录就不读存储：运行中每帧 JSON.parse 一遍 localStorage 是白花钱。
     落盘的时机在运行结束时，所以回落到的一定是终态 —— 不会出现「按钮被一条
     早就断掉的运行锁死」这种状态。（真正取消了的运行也会落盘，如实显示。） */
  const persisted = useMemo(
    () => (record || !props.workflowId ? null : workflowService.listRuns(props.workflowId)[0] ?? null),
    [record, props.workflowId],
  )
  const live = record?.workflow ?? null
  const nodeStatus: Record<string, WfNodeStatus> = live?.nodeStatus ?? persisted?.nodeStatus ?? {}
  const artifacts: WfArtifact[] = live?.artifacts ?? persisted?.artifacts ?? []
  const status: TaskStatus | null = record?.task.status ?? persisted?.status ?? null
  /** 这条任务 id 就是底部任务面板「执行过程」里那一行 */
  const taskId: string | null = record?.task.id ?? persisted?.task.id ?? null
  /** 运行中由共享记录的状态说了算：排队/运行/构建都还没结束 */
  const running = status === 'queued' || status === 'running' || status === 'building'

  const doRun = useCallback(() => {
    if (!wf || running) return
    /* 不传 onNodeStatus：runWorkflow 已经把节点状态写进共享记录，面板从记录读。
       本地再收一份就是第二份状态，等于把刚拆掉的东西又搬回来。 */
    props.tasks.runWorkflow(wf)
  }, [wf, running, props.tasks])

  const startedRef = useRef(false)
  useEffect(() => {
    if (!props.autoRun || startedRef.current) return
    startedRef.current = true
    /* 只在挂载时判断一次：本次会话已有记录、或上一次持久化的运行已存在，
       就直接呈现，不重跑 —— autoRun 是「第一次进来替用户按一下」，不是「每次进来都跑」 */
    if (record || persisted) return
    doRun()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!wf) return null

  return (
    <section className="ctk" aria-label="本次制作" data-task-id={taskId ?? undefined} data-workflow-id={wf.id}>
      <header className="ctk-head">
        <b>本次制作</b>
        <span className="ctk-demo">演示执行器</span>
        <span className="ctk-spacer" />
        <button type="button" className="ctk-x" onClick={props.onClose} aria-label="收起本次制作">✕</button>
      </header>
      <div className="ctk-name" title={wf.name}>{wf.name}</div>
      <div className="ctk-meta" data-status={status ?? 'idle'}>
        {wf.path === 'prompt-first' ? 'Prompt-first' : 'Structured'} · {stages.length} 个阶段
        {status ? ` · ${TASK_STATUS_LABEL[status] ?? status}` : ' · 未运行'}
      </div>

      <ul className="ctk-stages">
        {stages.map((n) => {
          const s = nodeStatus[n.id] ?? 'pending'
          return (
            <li key={n.id} data-s={s}>
              <span className="ctk-mark">{STATUS_MARK[s]}</span>
              <span className="ctk-stage-name">{labelOf(n.type)}</span>
              <span className="ctk-stage-status">
                {s === 'completed' ? '已完成'
                  : s === 'running' ? '运行中'
                  : s === 'failed' ? '失败'
                  : s === 'skipped' ? '已跳过' : ''}
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
              <em>{a.kind}</em>
            </div>
          ))}
        </div>
      )}

      <div className="ctk-actions">
        <button type="button" className="ctk-run" disabled={running} onClick={doRun}>
          {running ? '运行中…' : record || persisted ? '再运行一次' : '开始运行'}
        </button>
        {running && taskId && (
          /* 停的是共享记录里那条任务（studioApi 任务与工作流运行都停得掉）。
             只放图标：左栏只有 200px，文字会把这两个按钮挤成两行。 */
          <button type="button" className="ctk-stop" title="停止这条任务" aria-label="停止这条任务"
                  onClick={() => props.tasks.cancel(taskId)}>
            <Square className="size-3" />
          </button>
        )}
        <button type="button" className="ctk-editor" onClick={props.onOpenEditor}>
          打开工作流编辑器
        </button>
      </div>
    </section>
  )
}

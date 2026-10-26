import { useCallback, useRef, useState } from 'react'
import type { AgentTask, ChangeSet, TaskEvent, TaskRequest, TaskRun } from '@/services/studioApi'
import { studioApi } from '@/services/studioApi'
import type { WfArtifact, WfNodeStatus, WorkflowDef, WorkflowRun } from '@/services/workflowService'
import { startDemoRun } from '@/services/workflowService'

/** 工作流执行器产出的那部分：产物与节点状态和事件同源，不做第二份状态。 */
export interface WorkflowRunRef {
  runId: string
  workflowId: string
  artifacts: WfArtifact[]
  nodeStatus: Record<string, WfNodeStatus>
}

export interface TaskRecord {
  task: AgentTask
  events: TaskEvent[]
  changes: ChangeSet | null
  /** 只有工作流运行带这一项；studioApi 的演示任务不产出产物，就没有它。 */
  workflow?: WorkflowRunRef
}

export interface WorkflowRunTicket {
  taskId: string
  cancel: () => void
  done: Promise<WorkflowRun>
}

/**
 * 全应用唯一的一份任务记录。
 *
 * 两个来源共用一个列表，底部任务面板与工作台读的是同一批 record：
 *   studioApi   —— 工作台输入框发起的修改/导出任务
 *   runWorkflow —— 工作流实例的一次运行（带产物、节点状态、变更集）
 * 分开存会让「AI 在做什么」在两处各说一套 —— 这正是之前 CreationTask 的运行
 * 只活在自己组件里、底部任务面板完全看不见的原因。
 */
export function useAgentTasks() {
  const [records, setRecords] = useState<TaskRecord[]>([])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const runs = useRef(new Map<string, TaskRun>())
  const wfCancels = useRef(new Map<string, () => void>())

  const patchRecord = useCallback((taskId: string, patch: (record: TaskRecord) => TaskRecord) => {
    setRecords((prev) => prev.map((record) => (record.task.id === taskId ? patch(record) : record)))
  }, [])

  const pushEvent = useCallback((taskId: string, event: TaskEvent) => {
    patchRecord(taskId, (record) => ({
      ...record,
      task: { ...record.task, status: event.status },
      events: [...record.events, event],
    }))
  }, [patchRecord])

  const applyEvent = useCallback((run: TaskRun, event: TaskEvent) => {
    patchRecord(run.task.id, (record) => ({
      ...record,
      task: { ...record.task, status: event.status },
      events: [...record.events, event],
      changes: run.changes,
    }))
  }, [patchRecord])

  const start = useCallback((request: TaskRequest) => {
    let runRef: TaskRun
    runRef = studioApi.startTask(request, (event) => applyEvent(runRef, event))
    runs.current.set(runRef.task.id, runRef)
    setActiveTaskId(runRef.task.id)
    setRecords((prev) => [{ task: runRef.task, events: [], changes: null }, ...prev])
    void runRef.done.finally(() => {
      runs.current.delete(runRef.task.id)
    })
    return runRef.task.id
  }, [applyEvent])

  const render = useCallback(() => {
    let runRef: TaskRun
    runRef = studioApi.render((event) => applyEvent(runRef, event))
    runs.current.set(runRef.task.id, runRef)
    setActiveTaskId(runRef.task.id)
    setRecords((prev) => [{ task: runRef.task, events: [], changes: null }, ...prev])
    void runRef.done.finally(() => runs.current.delete(runRef.task.id))
    return runRef.task.id
  }, [applyEvent])

  /**
   * 运行一次工作流实例，并把这次运行登记进同一份记录。
   *
   * startDemoRun 一进去就同步 emit 第一条事件，那时记录还不存在；所以先缓冲事件与
   * 节点状态，拿到 handle.task 建好记录后再按序回放，否则第一条 accepted 会静默丢掉。
   * 回放之后的事件走 live 路径。
   */
  const runWorkflow = useCallback((wf: WorkflowDef, hooks?: {
    onNodeStatus?: (nodeId: string, status: WfNodeStatus) => void
  }): WorkflowRunTicket => {
    const pendingEvents: TaskEvent[] = []
    const pendingStatus: Array<[string, WfNodeStatus]> = []
    let taskId = ''
    let live = false

    const setNodeStatus = (nodeId: string, status: WfNodeStatus) => {
      patchRecord(taskId, (record) => record.workflow
        ? { ...record, workflow: { ...record.workflow, nodeStatus: { ...record.workflow.nodeStatus, [nodeId]: status } } }
        : record)
      hooks?.onNodeStatus?.(nodeId, status)
    }

    const handle = startDemoRun(wf, {
      onEvent: (event) => {
        if (!live) { pendingEvents.push(event); return }
        pushEvent(taskId, event)
      },
      onNodeStatus: (nodeId, status) => {
        if (!live) { pendingStatus.push([nodeId, status]); return }
        setNodeStatus(nodeId, status)
      },
    })

    taskId = handle.task.id
    setRecords((prev) => [{
      task: handle.task,
      events: [],
      changes: null,
      workflow: { runId: handle.runId, workflowId: wf.id, artifacts: [], nodeStatus: {} },
    }, ...prev])
    setActiveTaskId(taskId)
    wfCancels.current.set(taskId, handle.cancel)
    live = true
    pendingEvents.forEach((event) => pushEvent(taskId, event))
    pendingStatus.forEach(([nodeId, status]) => setNodeStatus(nodeId, status))

    const done = handle.done.then((run) => {
      wfCancels.current.delete(taskId)
      patchRecord(taskId, (record) => ({
        ...record,
        task: { ...record.task, status: run.status },
        changes: run.changes,
        ...(record.workflow
          ? { workflow: { ...record.workflow, artifacts: run.artifacts, nodeStatus: run.nodeStatus } }
          : {}),
      }))
      return run
    })

    return { taskId, cancel: handle.cancel, done }
  }, [patchRecord, pushEvent])

  /** 两条来源都要能停：只查 studioApi 的 run 会让任务面板上的停止键对工作流运行无效。 */
  const cancel = useCallback((taskId: string) => {
    runs.current.get(taskId)?.cancel()
    wfCancels.current.get(taskId)?.()
  }, [])

  const retry = useCallback((taskId: string) => {
    const record = records.find((item) => item.task.id === taskId)
    if (!record) return null
    return start({
      kind: record.task.kind,
      prompt: record.task.title,
      scope: 'project',
      sceneIds: [],
      constraints: { preserveCamera: true, preserveCaptions: true, limitToSelection: false, reuseExistingComponents: true },
      attachments: [],
    })
  }, [records, start])

  const active = records.find((record) => record.task.id === activeTaskId) ?? null

  return { records, active, start, render, runWorkflow, cancel, retry, setActiveTaskId }
}

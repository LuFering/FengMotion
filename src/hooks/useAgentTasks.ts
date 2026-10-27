import { useCallback, useRef, useState } from 'react'
import type { AgentTask, ChangeSet, TaskEvent, TaskRequest, TaskRun } from '@/services/studioApi'
import { studioApi } from '@/services/studioApi'

export interface TaskRecord {
  task: AgentTask
  /** 这次请求原样留着 —— 左栏「正在制作」要靠它说清此刻在改哪个内容
      （任务对象本身只有一句标题，回答不了「哪一个画面」）。 */
  request: TaskRequest | null
  events: TaskEvent[]
  changes: ChangeSet | null
}

export function useAgentTasks() {
  const [records, setRecords] = useState<TaskRecord[]>([])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const runs = useRef(new Map<string, TaskRun>())

  const applyEvent = useCallback((run: TaskRun, event: TaskEvent) => {
    setRecords((prev) => {
      const index = prev.findIndex((record) => record.task.id === run.task.id)
      const base: TaskRecord = index < 0
        ? { task: run.task, request: null, events: [], changes: null }
        : prev[index]
      const next: TaskRecord = {
        ...base,
        task: { ...base.task, status: event.status },
        events: [...base.events, event],
        changes: run.changes,
      }
      /* 事件可能比记录先到（适配器在 startTask 返回之前就 emit）：直接补一条，
         既不丢第一条事件，也不让回调炸在 undefined 上。 */
      return index < 0 ? [next, ...prev] : prev.map((record, i) => (i === index ? next : record))
    })
  }, [])

  const start = useCallback((request: TaskRequest) => {
    let runRef: TaskRun
    runRef = studioApi.startTask(request, (event) => applyEvent(runRef, event))
    runs.current.set(runRef.task.id, runRef)
    setActiveTaskId(runRef.task.id)
    const record: TaskRecord = { task: runRef.task, request, events: [], changes: null }
    setRecords((prev) => prev.some((r) => r.task.id === record.task.id) ? prev : [record, ...prev])
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
    const record: TaskRecord = { task: runRef.task, request: null, events: [], changes: null }
    setRecords((prev) => prev.some((r) => r.task.id === record.task.id) ? prev : [record, ...prev])
    void runRef.done.finally(() => runs.current.delete(runRef.task.id))
    return runRef.task.id
  }, [applyEvent])

  const cancel = useCallback((taskId: string) => {
    runs.current.get(taskId)?.cancel()
  }, [])

  const retry = useCallback((taskId: string) => {
    const record = records.find((item) => item.task.id === taskId)
    if (!record) return null
    return start(record.request ?? {
      kind: record.task.kind,
      prompt: record.task.title,
      scope: 'project',
      sceneIds: [],
      constraints: { preserveCamera: true, preserveCaptions: true, limitToSelection: false, reuseExistingComponents: true },
      attachments: [],
    })
  }, [records, start])

  const active = records.find((record) => record.task.id === activeTaskId) ?? null

  return { records, active, start, render, cancel, retry, setActiveTaskId }
}

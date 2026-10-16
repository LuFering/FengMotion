import { useCallback, useRef, useState } from 'react'
import type { AgentTask, ChangeSet, TaskEvent, TaskRequest, TaskRun } from '@/services/studioApi'
import { studioApi } from '@/services/studioApi'

export interface TaskRecord {
  task: AgentTask
  events: TaskEvent[]
  changes: ChangeSet | null
}

export function useAgentTasks() {
  const [records, setRecords] = useState<TaskRecord[]>([])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const runs = useRef(new Map<string, TaskRun>())

  const applyEvent = useCallback((run: TaskRun, event: TaskEvent) => {
    setRecords((prev) => prev.map((record) =>
      record.task.id === run.task.id
        ? {
            ...record,
            task: { ...record.task, status: event.status },
            events: [...record.events, event],
            changes: run.changes,
          }
        : record,
    ))
  }, [])

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

  const cancel = useCallback((taskId: string) => {
    runs.current.get(taskId)?.cancel()
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

  return { records, active, start, render, cancel, retry, setActiveTaskId }
}

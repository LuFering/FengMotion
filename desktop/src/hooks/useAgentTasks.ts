import { useCallback, useRef, useState } from 'react'
import type { AgentTask, ChangeSet, TaskEvent, TaskRequest, TaskRun } from '@/services/studioApi'
import { studioApi } from '@/services/studioApi'
import { studioHttpApi } from '@/services/api'
import { toAgentTask, type RenderTaskRequest } from '@/services/api/taskClient'

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

  /**
   * 用**真实后端**提交一个渲染任务。
   *
   * <p>与 `start()` 的区别：`start()` 走演示适配器（本地 setTimeout 模拟），
   * 这个走 `/api/projects/{id}/tasks`，进度由 SSE 真实推送。</p>
   *
   * <p>为什么不直接替换 `start()`：演示路径仍有用（后端不可用时界面不能瘫）。
   * 两个入口并存，由调用方根据是否有真实项目决定，界面上再区分标注。</p>
   *
   * @param projectId 项目 ID
   * @param film      场景数据（Remotion props）
   * @param prompt    用户要求
   * @param signal    组件卸载时用来断流
   * @returns 任务 ID；提交失败时返回 null
   */
  const startReal = useCallback(async (
    projectId: string,
    film: RenderTaskRequest['film'],
    prompt: string,
  ): Promise<string | null> => {
    try {
      const run = await studioHttpApi().task.start(projectId, { prompt, film }, (event) => {
        setRecords((prev) => prev.map((record) => {
          if (record.task.id !== event.taskId) return record
          return {
            ...record,
            task: { ...record.task, status: event.status },
            events: [...record.events, event],
          }
        }))
      })

      /* 先落一条本地记录：事件可能比这行代码更早到达，
         没有记录的话 applyEvent 找不到宿主，事件就丢了。 */
      const now = new Date().toISOString()
      const record: TaskRecord = {
        task: {
          id: run.taskId,
          kind: 'render',
          status: 'queued',
          title: prompt || '渲染任务',
          createdAt: now,
          mock: false,
        },
        request: null,
        events: [],
        changes: null,
      }
      setRecords((prev) => prev.some((r) => r.task.id === record.task.id) ? prev : [record, ...prev])
      setActiveTaskId(run.taskId)

      runs.current.set(run.taskId, {
        task: record.task,
        events: [],
        changes: null,
        cancel: () => run.cancel(),
        done: run.done.then(() => undefined),
      })

      void run.done.then((finalTask) => {
        // 终态以查询结果为准：事件流可能在收尾时漏掉最后一条
        const agentTask = toAgentTask(finalTask)
        setRecords((prev) => prev.map((r) => (
          r.task.id === run.taskId ? { ...r, task: agentTask } : r
        )))
        setRecords((prev) => prev.map((r) => (
          r.task.id === run.taskId
            ? { ...r, events: [], changes: null }
            : r
        )))
        runs.current.delete(run.taskId)
      })

      return run.taskId
    } catch {
      // 提交失败由调用方决定怎么提示；这里不吞成「假任务」
      return null
    }
  }, [])

  /**
   * 从后端回读项目的任务历史。
   *
   * <p>没有这一步，刷新页面后任务记录就没了 —— 而任务明明落库了。
   * 用户会以为「刚才那次渲染丢了」，实际上数据还在。</p>
   *
   * @param projectId 项目 ID
   */
  const loadHistory = useCallback(async (projectId: string) => {
    try {
      const list = await studioHttpApi().task.list(projectId)
      if (list.length === 0) return
      setRecords((prev) => {
        // 以后端为准合并：本地正在跑的任务保留（它的事件还在到达），其余用后端快照
        const runningLocally = new Set(
          prev.filter((r) => !['completed', 'failed', 'cancelled'].includes(r.task.status))
            .map((r) => r.task.id),
        )
        const fromServer = list
          .filter((t) => !runningLocally.has(t.id))
          .map((t) => ({
            task: toAgentTask(t),
            request: null,
            events: [],
            changes: null,
          }))
        const kept = prev.filter((r) => runningLocally.has(r.task.id))
        const merged = [...kept, ...fromServer]
        /* 回读后把最新一条设为当前任务：否则 activeTask 为 null，
           界面上的任务结果卡与「查看执行」全都不会显示 —— 历史读了也看不到。 */
        const newest = merged[0]
        if (newest) setActiveTaskId((current) => current ?? newest.task.id)
        return merged
      })
    } catch {
      // 回读失败不影响新任务提交：界面照常可用，只是历史暂时看不到
    }
  }, [])

  const active = records.find((record) => record.task.id === activeTaskId) ?? null

  return { records, active, start, startReal, loadHistory, render, cancel, retry, setActiveTaskId }
}

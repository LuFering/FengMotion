import { useCallback, useRef, useState } from 'react'
import type { AgentTask, ChangeSet, TaskEvent, TaskRequest, TaskRun } from '@/services/studioApi'
import { studioApi } from '@/services/studioApi'
import { studioHttpApi } from '@/services/api'
import { toAgentTask, type ModifyTaskRequest, type ProjectSceneState, type RenderTaskRequest } from '@/services/api/taskClient'

/**
 * 真实提交失败的原因。
 *
 * <p>为什么要细分，而不是一个 null 了事：用户看到「点了没反应」与
 * 看到「项目还没有场景，请先创建」是完全不同的两件事 ——
 * 前者会让人反复点按钮，后者知道下一步该做什么。</p>
 */
export type SubmitFailure =
  /** 后端连不上 / 超时 */
  | { reason: 'unreachable'; message: string }
  /** 场景版本已变，需要重新读取后重试 */
  | { reason: 'conflict'; message: string }
  /** 项目还没有当前场景，不能修改 */
  | { reason: 'no_scene'; message: string }
  /** 后端拒绝（含执行期的版本冲突、规则式修改无法理解的要求等） */
  | { reason: 'rejected'; message: string; code: string | null }

/** 真实修改请求的快照（实际发给后端的那些字段）。 */
export interface ModifySnapshot {
  prompt: string
  scope: 'project' | 'scene'
  sceneIds: string[]
  /** 提交时基于的场景版本 */
  baseVersion: number
}

export interface TaskRecord {
  task: AgentTask
  /** 这次请求原样留着 —— 左栏「正在制作」要靠它说清此刻在改哪个内容
      （任务对象本身只有一句标题，回答不了「哪一个画面」）。 */
  request: TaskRequest | null
  /**
   * 真实修改请求的快照。
   *
   * <p>为什么单独存：{@link request} 是演示路径的 TaskRequest，带 references/
   * constraints；真实修改根本不发那些字段。任务详情若拿界面当前的约束冒充
   * 「发送时的条件」，就是在向用户展示一份没发生过的请求。</p>
   */
  modify?: ModifySnapshot | null
  events: TaskEvent[]
  changes: ChangeSet | null
}

/**
 * 把一次提交失败归类成界面能区分的几种。
 *
 * <p>分类依据只看 HTTP 状态与错误码 —— 不猜文案内容。
 * 靠 message 里的关键词判断迟早会在改文案时失效。</p>
 *
 * @param error 抛出的异常
 * @returns 失败原因
 */
function describeFailure(error: unknown): SubmitFailure {
  const status = (error as { httpStatus?: number | null })?.httpStatus ?? null
  const code = (error as { code?: string })?.code ?? null
  const message = error instanceof Error ? error.message : String(error)

  if (code === 'scene_version_conflict' || status === 409) {
    return { reason: 'conflict', message }
  }
  if (status === null) {
    // 没有 HTTP 状态通常意味着请求根本没发出去：后端没起、网络断了
    return { reason: 'unreachable', message }
  }
  return { reason: 'rejected', message, code }
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
   * 读取项目当前场景。
   *
   * <p>读不到就如实返回失败，**不回退到演示路径**：后端不可用时让用户
   * 以为「界面还能用」比明确报错更糟 —— 他会拿一个假结果当真的用。
   * 只有用户自己选择演示入口时才走 Mock。</p>
   *
   * @param projectId 项目 ID
   * @returns 成功时返回场景状态；失败时返回 `{ failure }`
   */
  const currentScene = useCallback(async (projectId: string): Promise<
    { scene: ProjectSceneState; failure?: undefined } | { scene?: undefined; failure: SubmitFailure }
  > => {
    try {
      const scene = await studioHttpApi().task.currentScene(projectId)
      return { scene }
    } catch (error) {
      return { failure: describeFailure(error) }
    }
  }, [])

  /**
   * 用**真实后端**提交一个修改任务。
   *
   * <p>与 {@link startReal} 的分工：渲染是把给定场景渲成 mp4，
   * 修改是让后端基于当前场景按用户要求改完再渲。两者都走真实后端，
   * 都不含 Mock。</p>
   *
   * <p>请求体刻意只带 {@code kind/prompt/scope/sceneIds/baseVersion} ——
   * 后端第一版只解释这些。参考定位与保留约束没有实现，带上就是
   * 「收下但不执行」，所以类型和界面都不提供。</p>
   *
   * @param projectId 项目 ID
   * @param request   修改请求（含 baseVersion）
   * @returns 成功时返回任务 ID；失败时返回原因，供界面如实展示
   */
  const startModify = useCallback(async (
    projectId: string,
    request: ModifyTaskRequest,
    onSettled?: (status: string) => void,
  ): Promise<{ taskId: string; failure?: undefined } | { taskId?: undefined; failure: SubmitFailure }> => {
    try {
      const run = await studioHttpApi().task.startModify(projectId, request, (event) => {
        setRecords((prev) => prev.map((record) => {
          if (record.task.id !== event.taskId) return record
          return {
            ...record,
            task: { ...record.task, status: event.status },
            events: [...record.events, event],
          }
        }))
      })

      const now = new Date().toISOString()
      const record: TaskRecord = {
        task: {
          id: run.taskId,
          kind: 'modify',
          status: 'queued',
          title: request.prompt || '修改任务',
          createdAt: now,
          mock: false,
        },
        request: null,
        /* 存真实发出去的字段快照：任务详情要照着它说「本次实际提交了什么」，
           而不是拿界面当前状态顶替。 */
        modify: {
          prompt: request.prompt,
          scope: request.scope,
          sceneIds: [...request.sceneIds],
          baseVersion: request.baseVersion,
        },
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
        setRecords((prev) => prev.map((r) => (
          r.task.id === run.taskId ? { ...r, task: toAgentTask(finalTask) } : r
        )))
        runs.current.delete(run.taskId)
        onSettled?.(finalTask.status)
      })

      return { taskId: run.taskId }
    } catch (error) {
      return { failure: describeFailure(error) }
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

  return { records, active, start, startReal, startModify, currentScene, loadHistory, render, cancel, retry, setActiveTaskId }
}

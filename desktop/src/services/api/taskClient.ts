/**
 * 任务接口客户端：对接后端的制作任务系统。
 *
 * <p>与 `studioApi.ts` 里的 `MockStudioApi` 是同一接口的两个实现 ——
 * 前端切换时不用改调用点，只要换 `studioApi` 绑定的实例。</p>
 *
 * <p>关键差异：真实任务的进度是**异步推送**的（SSE），而 Mock 用 setTimeout 模拟。
 * 所以这里 `startTask` 立即返回 taskId，事件通过 EventSource 陆续到达。</p>
 */
import type { HttpClient } from './http'
import type {
  AgentTask as StudioAgentTask,
  TaskEvent as StudioTaskEvent,
  TaskKind,
  TaskStatus,
} from '../studioApi'

/** 后端任务视图。 */
interface BackendTask {
  id: string
  projectId: string
  kind: string
  status: string
  prompt: string
  progress: number
  message: string
  artifactPath: string | null
  errorCode: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

/** 后端任务事件视图。 */
interface BackendTaskEvent {
  id: string
  seq: number
  kind: string
  status: string
  message: string
  data?: Record<string, unknown>
  at: string
}

/** 创建任务的请求体。 */
export interface RenderTaskRequest {
  /** 用户要求（人可读） */
  prompt: string
  /** 场景数据，就是 Remotion 工程接受的 props */
  film: {
    width: number
    height: number
    fps: number
    backgroundColor?: string
    color?: string
    scenes: {
      id: string
      text?: string
      subtitle?: string
      backgroundColor?: string
      color?: string
      backgroundImage?: string
      durationSeconds: number
      textAnimation?: 'fade' | 'slide' | 'none'
      transition?: 'cut' | 'fade'
    }[]
  }
}

/** 前端事件回调。 */
export type TaskEventHandler = (event: StudioTaskEvent) => void

/** 一次任务运行的句柄。 */
export interface BackendTaskRun {
  taskId: string
  projectId: string
  cancel(): void
  done: Promise<BackendTask>
  /** 关闭事件流（组件卸载时调用，避免连接泄漏） */
  dispose(): void
}

/**
 * 后端状态到前端状态的映射。
 *
 * <p>后端没有 `building` 之外的细分；前端契约里的取值是超集，
 * 这里做一次显式映射而不是直接强转 —— 强转会在后端新增状态时静默变成脏数据。</p>
 *
 * @param status 后端状态
 * @returns 前端状态
 */
function toTaskStatus(status: string): TaskStatus {
  switch (status) {
    case 'queued': return 'queued'
    case 'running': return 'running'
    case 'building': return 'building'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    // 未知状态按「排队中」处理：宁可显示成还没开始，也不要显示成已完成
    default: return 'queued'
  }
}

/**
 * 后端事件种类到前端种类的映射。
 *
 * @param kind 后端种类
 * @returns 前端种类
 */
function toEventKind(kind: string): StudioTaskEvent['kind'] {
  switch (kind) {
    case 'accepted': return 'accepted'
    case 'progress': return 'progress'
    case 'build': return 'build'
    case 'complete': return 'complete'
    case 'error': return 'error'
    case 'cancelled': return 'cancelled'
    default: return 'progress'
  }
}

/**
 * 把后端任务转成前端任务。
 *
 * @param task 后端任务
 * @returns 前端任务
 */
export function toAgentTask(task: BackendTask): StudioAgentTask {
  return {
    id: task.id,
    // 后端目前只产出 render；其它值不该出现，兜底按 render 处理
    kind: (task.kind === 'render' ? 'render' : 'render') as TaskKind,
    status: toTaskStatus(task.status),
    // 标题用用户原话：比「渲染任务」这种泛化描述更有信息
    title: task.prompt || '渲染任务',
    createdAt: task.createdAt,
    mock: false,
  }
}

/**
 * 把后端事件转成前端事件。
 *
 * @param event 后端事件
 * @param taskId 任务 ID
 * @returns 前端事件
 */
export function toTaskEvent(event: BackendTaskEvent, taskId: string): StudioTaskEvent {
  return {
    id: event.id,
    taskId,
    kind: toEventKind(event.kind),
    status: toTaskStatus(event.status),
    message: event.message,
    at: event.at,
    mock: false,
  }
}

/**
 * 创建任务接口客户端。
 *
 * @param http HTTP 客户端
 * @returns 任务操作集合
 */
export function createTaskClient(http: HttpClient) {
  return {
    /**
     * 提交一个渲染任务。
     *
     * @param projectId 项目 ID
     * @param request 请求体
     * @param onEvent 事件回调
     * @returns 运行句柄
     */
    async start(
      projectId: string,
      request: RenderTaskRequest,
      onEvent: TaskEventHandler,
    ): Promise<BackendTaskRun> {
      const task = await http.post<BackendTask>(
        `/projects/${encodeURIComponent(projectId)}/tasks`,
        request,
      )

      /* 用 EventSource 订阅：它自带断线重连，比手写 fetch 流稳。
         注意 EventSource 不能自定义 header，所以 Last-Event-ID 由浏览器
         在重连时自动带上 —— 这正是后端设计 seq 的用途。 */
      const url = http.url(`/tasks/${encodeURIComponent(task.id)}/events`)
      const source = new EventSource(url)

      let settled = false
      let resolveDone: (value: BackendTask) => void
      const done = new Promise<BackendTask>((resolve) => { resolveDone = resolve })

      const finish = async () => {
        if (settled) return
        settled = true
        source.close()
        try {
          // 终态以查询为准：事件流可能在最后一条事件之前就关闭
          const latest = await http.get<BackendTask>(`/tasks/${encodeURIComponent(task.id)}`)
          resolveDone(latest)
        } catch {
          resolveDone(task)
        }
      }

      const handle = (raw: MessageEvent) => {
        try {
          const parsed = JSON.parse(String(raw.data)) as BackendTaskEvent
          onEvent(toTaskEvent(parsed, task.id))
          const status = toTaskStatus(parsed.status)
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            void finish()
          }
        } catch {
          // 单条事件解析失败不该中断整条流
        }
      }

      // 后端用 event 名区分种类（accepted/progress/...），所以每种都要监听
      for (const name of ['accepted', 'progress', 'build', 'complete', 'error', 'cancelled']) {
        source.addEventListener(name, handle as EventListener)
      }
      source.onerror = () => {
        /* EventSource 会自动重连，这里不主动关闭。
           但如果任务其实已经结束（连接被服务端正常关闭），onerror 也会触发一次 ——
           用一次查询确认状态，才决定是否收尾。 */
        void (async () => {
          if (settled) return
          try {
            const latest = await http.get<BackendTask>(`/tasks/${encodeURIComponent(task.id)}`)
            const status = toTaskStatus(latest.status)
            if (status === 'completed' || status === 'failed' || status === 'cancelled') {
              settled = true
              source.close()
              resolveDone(latest)
            }
          } catch {
            // 查询也失败就等 EventSource 自己重连
          }
        })()
      }

      return {
        taskId: task.id,
        projectId,
        cancel: () => {
          void http.post(`/tasks/${encodeURIComponent(task.id)}/cancel`, {}).catch(() => {
            // 取消失败（如任务已结束）不该抛给界面：状态由事件流反映
          })
        },
        done,
        dispose: () => source.close(),
      }
    },

    /**
     * 查询项目任务列表。
     *
     * @param projectId 项目 ID
     * @returns 任务列表
     */
    async list(projectId: string): Promise<BackendTask[]> {
      const result = await http.get<{ items?: BackendTask[] }>(
        `/projects/${encodeURIComponent(projectId)}/tasks`,
      )
      return Array.isArray(result?.items) ? result.items : []
    },
  }
}

export type TaskClient = ReturnType<typeof createTaskClient>

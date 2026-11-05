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

/**
 * 修改任务的请求体。
 *
 * <p><strong>刻意不含 references / constraints</strong>：后端第一版只解释
 * {@code scope}、{@code sceneIds} 与 {@code prompt}，参考定位与「保留约束」
 * 都没有实现。前端若把它们塞进来，服务端会收下但不执行 —— 用户勾了
 * 「保持镜头」而系统其实没管，比根本不提供这个开关更糟。
 * 所以类型层面就不给这些字段留位置，界面上的对应控件也一并禁用并说明。</p>
 *
 * <p><strong>不含 film</strong>：场景基线由后端持有。前端再带一份只会引入
 * 「两边各一份、不知谁对」的问题。项目还没有场景时不允许提交修改。</p>
 */
export interface ModifyTaskRequest {
  /** 任务类型，固定为 modify。 */
  kind: 'modify'
  /** 用户原话。后端当前只认「把文字改成 X」「文字/背景颜色改成 X」。 */
  prompt: string
  /**
   * 修改范围。第一版只支持 project / scene；
   * selection 需要「画面坐标 → 场景」映射，后端会以 unsupported_field 拒绝。
   */
  scope: 'project' | 'scene'
  /** scope=scene 时的目标场景；scope=project 时为空数组。 */
  sceneIds: string[]
  /**
   * 提交时基于的场景版本。
   *
   * <p>与库中版本不符会在创建阶段直接 409 {@code scene_version_conflict}，
   * 请求不会被受理，也就不会白跑一次渲染。真正的防覆盖仍由后端执行时的
   * 条件更新保证 —— 这里只是提前拦截。</p>
   */
  baseVersion: number
}

/**
 * 项目当前场景。
 *
 * <p>{@code initialized=false} 时 {@code film} 为 null —— 这是「还没有场景」的
 * 明确状态，不是空场景。调用方必须区分，不能自己造一份默认场景冒充已有内容。</p>
 */
export interface ProjectRenderSnapshot {
  kind: 'project-render'
  entry: string
  compositionId: string
  sourceSnapshot?: string
  sourceHash?: string
  output: { durationInFrames: number; width: number; height: number; fps: number; renderMs: number }
}

export type ProjectFilmSnapshot = RenderTaskRequest['film'] | ProjectRenderSnapshot

export interface ProjectSceneState {
  projectId: string
  initialized: boolean
  version: number
  film: ProjectFilmSnapshot | null
  taskId: string | null
  updatedAt: string | null
}

/**
 * 一个场景历史版本。
 *
 * <p>场景版本与「预览版本」不是一回事：预览版本是工作流/编辑器产出的文件，
 * 场景版本是**修改任务的提交结果**（每次提交留下完整 film 快照）。
 * 两者各自独立，不要互相冒充。</p>
 */
export interface ProjectSceneVersion {
  version: number
  film: ProjectFilmSnapshot
  taskId: string | null
  prompt: string
  editSummary: string
  artifactPath: string | null
  /** task = 修改任务产生；restore = 回退产生 */
  source: string
  /** 回退来源版本；非回退为 null */
  fromVersion: number | null
  createdAt: string
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
 * 订阅任务事件流并返回运行句柄。
 *
 * <p>渲染与修改共用这一份：两种任务的「怎么订阅、怎么判断终态、取消怎么发」
 * 是同一件事，各自维护一份迟早会长出不同的行为（比如一边处理了
 * 连接正常关闭、另一边没处理）。</p>
 *
 * @param http      HTTP 客户端
 * @param projectId 项目 ID
 * @param task      后端已创建的任务
 * @param onEvent   事件回调
 * @returns 运行句柄
 */
function subscribeWith(
  http: HttpClient,
  projectId: string,
  task: BackendTask,
  onEvent: TaskEventHandler,
): BackendTaskRun {
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

  /* 后端用 event 名区分种类（accepted/progress/build/...）。
     warning 也要监听：它承载「你设的约束本版没生效」这类必须让用户看见的信息。 */
  for (const name of ['accepted', 'progress', 'build', 'complete', 'error', 'cancelled', 'warning']) {
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
      return subscribeWith(http, projectId, task, onEvent)
    },

    /**
     * 提交一个修改任务。
     *
     * <p>与 {@link start} 的区别只在请求体：修改需要 {@code baseVersion}
     * 让后端做版本预检。事件订阅、取消、终态收尾完全共用同一套逻辑，
     * 不另写一条链路 —— 两条链路各自维护会慢慢长出不同的行为。</p>
     *
     * <p>项目还没有当前场景时后端会拒绝（它需要基线），所以调用方应先读
     * {@link currentScene}，{@code initialized=false} 时不要提交。</p>
     *
     * @param projectId 项目 ID
     * @param request 修改请求
     * @param onEvent 事件回调
     * @returns 运行句柄
     */
    async startModify(
      projectId: string,
      request: ModifyTaskRequest,
      onEvent: TaskEventHandler,
    ): Promise<BackendTaskRun> {
      const task = await http.post<BackendTask>(
        `/projects/${encodeURIComponent(projectId)}/tasks`,
        request,
      )
      return subscribeWith(http, projectId, task, onEvent)
    },

    /**
     * 读取项目当前场景。
     *
     * <p>{@code initialized=false} 表示「还没有场景」，不是「场景是空的」。
     * 调用方必须据此区分展示，不能自己造一份默认场景。</p>
     *
     * @param projectId 项目 ID
     * @returns 当前场景状态
     */
    currentScene(projectId: string): Promise<ProjectSceneState> {
      return http.get<ProjectSceneState>(`/projects/${encodeURIComponent(projectId)}/scene`)
    },

    /**
     * 列出项目的场景版本历史，新版本在前。
     *
     * <p>还没产生过快照的项目返回空数组 —— 这是真实状态（从旧库升级上来的
     * 项目没有历史），调用方应显示「还没有版本」而不是「加载失败」。</p>
     *
     * @param projectId 项目 ID
     * @returns 版本列表
     */
    async sceneVersions(projectId: string): Promise<ProjectSceneVersion[]> {
      const result = await http.get<{ items?: ProjectSceneVersion[] }>(
        `/projects/${encodeURIComponent(projectId)}/scene/versions`,
      )
      return Array.isArray(result?.items) ? result.items : []
    },

    /**
     * 回退到某个场景版本。
     *
     * <p>回退会**新增**一个版本（内容等于目标版本），不会删除历史。
     * 带上 {@code expectedVersion} 做乐观并发校验：界面看到的版本已过期时
     * 后端返回 409，避免把别人后来的改动一起丢掉。</p>
     *
     * @param projectId 项目 ID
     * @param version 要回退到的版本号
     * @param expectedVersion 界面当前看到的版本号；不传则不做校验
     * @returns 新产生的版本
     */
    restoreSceneVersion(
      projectId: string,
      version: number,
      expectedVersion?: number,
    ): Promise<ProjectSceneVersion> {
      return http.post<ProjectSceneVersion>(
        `/projects/${encodeURIComponent(projectId)}/scene/versions/${version}/restore`,
        expectedVersion === undefined ? {} : { expectedVersion },
      )
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

/**
 * 任务域（README §3.3 / task.md）：创建、列表、详情、取消、重试、变更集、事件历史与事件流。
 *
 * 这个域最容易犯的错是「把没发生的事说成已发生」，所以三处刻意收紧了：
 * 1. **发送前校验**：创建任务必须先过 `validate.assertTaskRequestSendable` ——
 *    02 §1 把「目标身份/版本/时间/区域/硬约束无法完整编码」列为 P0 阻塞，
 *    现有后端会忽略未知字段，本地 `preview` 引用可能只剩 kind 与 label，发出去就是改错对象；
 * 2. **取消只是受理**：202 不等于已取消，终态以事件流/快照为准（task.md §6.3、02 §5）；
 * 3. **变更集的 404 与「无变更」是两件事**（02 §1 兼容表里旧后端把两者混在一起了）。
 */
import type {
  AgentTask,
  ChangeSet,
  Page,
  TaskAcceptedResponse,
  TaskEvent,
  TaskListQuery,
  TaskRequest,
} from '@/types/contracts'
import type { HttpClient } from './http'
import { assertTaskRequestSendable } from './validate'
import { asPage } from './pagination'
import { normalizeEventList, openTaskEventStream } from './streams'
import type { TaskEventStreamHandle, TaskEventStreamHandlers, TaskEventStreamOptions } from './streams'

export interface CreateTaskOptions {
  /** 同一次用户意图的重试必须复用同一个键（README §2.7：24h 内同 key 同 body 重放首次结果）。 */
  idempotencyKey?: string
  /** 创建时的项目版本；版本已变服务端返回 412，要求用户确认后重新发起（02 §4、task.md §6.4）。 */
  ifMatch?: string
  signal?: AbortSignal
  /** 预览媒体的真实时长（秒），用于核对引用时间是否越界；不知道就不传，校验不会因此假装通过。 */
  previewDurationSeconds?: number
  /** 服务端已知的场景 ID 集合；给了就核对引用指向的场景是否真实存在。 */
  knownSceneIds?: string[]
  /** 服务端已知的产物 ID 集合；给了就核对 artifact 引用。 */
  knownArtifactIds?: string[]
}

export interface RetryTaskOptions {
  /** 防重复点击用：同一次点击的重试复用同一个键；不传则每次调用生成新键（每次都会建新任务）。 */
  idempotencyKey?: string
  /** 重试必须重新校验版本：版本已变服务端返回 412（task.md §6.4），不是静默沿用旧版本。 */
  ifMatch?: string
  signal?: AbortSignal
}

export interface TaskEventHistoryQuery {
  /** 只取 `seq > afterSeq` 的事件；断线补齐时传已交付的水位。 */
  afterSeq?: number
  /** 契约上限 200（README §2.5、task.md §7.2）；不传由服务端取默认值。 */
  limit?: number
}

export interface TasksResource {
  create(projectId: string, request: TaskRequest, options?: CreateTaskOptions): Promise<TaskAcceptedResponse>
  list(projectId: string, query?: TaskListQuery): Promise<Page<AgentTask>>
  get(taskId: string): Promise<AgentTask>
  cancel(taskId: string): Promise<void>
  retry(taskId: string, options?: RetryTaskOptions): Promise<TaskAcceptedResponse>
  changes(taskId: string): Promise<ChangeSet>
  eventsHistory(taskId: string, query?: TaskEventHistoryQuery): Promise<TaskEvent[]>
  stream(
    taskId: string,
    handlers?: TaskEventStreamHandlers,
    options?: TaskEventStreamOptions,
  ): TaskEventStreamHandle
}

export function createTasksResource(http: HttpClient): TasksResource {
  return {
    async create(projectId, request, options = {}) {
      // 校验放在发请求之前，且用的是**当前配置**里的开关：本地未冻结扩展字段默认禁用（02 §4）。
      // 这里不做「有问题就发出去等回执」的折中 —— 服务端忽略未知字段时不会报错，只会改错东西。
      assertTaskRequestSendable(
        request,
        { allowLocalModifyExtensions: http.config.allowLocalModifyExtensions },
        {
          routeProjectId: projectId,
          previewDurationSeconds: options.previewDurationSeconds,
          knownSceneIds: options.knownSceneIds,
          knownArtifactIds: options.knownArtifactIds,
        },
      )
      // 202 + TaskAcceptedResponse 只表示任务已入队（README §2.3）；
      // 进度与终态一律从 `/tasks/{id}/events` 订阅，或读 task 快照。
      return http.post<TaskAcceptedResponse>(`/projects/${projectId}/tasks`, request, {
        idempotencyKey: options.idempotencyKey,
        ifMatch: options.ifMatch,
        signal: options.signal,
      })
    },

    async list(projectId, query) {
      // 排序默认 created_desc，由服务端实现（README §2.5：不在前端重排后再显示，那样和分页对不上）。
      // 形状统一交给共享 pagination.asPage：裸数组包成 Page，认不出的形状抛错而不是原样透传。
      const payload = await http.get<unknown>(`/projects/${projectId}/tasks`, {
        query: query ? { ...query } : undefined,
      })
      return asPage<AgentTask>(payload, { source: `GET /projects/${projectId}/tasks` })
    },

    get(taskId) {
      // 任务快照是终态判断的另一半依据（另一半是终态事件）；`progress` 缺失表示后端给不出可信进度，
      // 不要在这里补 0 或伪造百分比。
      return http.get<AgentTask>(`/tasks/${taskId}`)
    },

    async cancel(taskId) {
      // 202 只是「受理」：后端尽力停止，最终是否真的取消以 `cancelled` 事件或快照状态为准
      // （task.md §6.3、02 §5：取消与完成的竞态中只有一个终态，可能最终是 completed）。
      // 所以本方法返回 void —— 绝不在这里对外宣称「已取消成功」。
      // 终态任务再取消，服务端返回 409 cancelled，如实抛出交给界面说明。
      // 不带 Idempotency-Key：README §2.7 只要求创建型 POST 幂等，取消重发没有创建语义。
      await http.post<void>(`/tasks/${taskId}/cancel`, undefined, { idempotencyKey: null })
    },

    retry(taskId, options = {}) {
      // 重试产生**新任务**，旧任务与其事件只读保留（task.md §6.4）。
      // 因此默认用新键：若复用创建旧任务时的键，服务端 24h 内会重放旧任务结果，等于重试没发生。
      // 版本校验走 If-Match：版本已变返回 412，要求用户确认后重新发起，而不是悄悄用新版本重跑。
      return http.post<TaskAcceptedResponse>(`/tasks/${taskId}/retry`, undefined, {
        idempotencyKey: options.idempotencyKey,
        ifMatch: options.ifMatch,
        signal: options.signal,
      })
    },

    changes(taskId) {
      // `files: []` 才是「没有变更」，404 只表示任务不存在，必须抛出（task.md §6.2）。
      // 不要按旧后端 `GET /api/changes/{id}` 的语义解读：那个接口「无变更也 404」（02 §1 兼容表），
      // 把 404 当无变更，会把「任务不存在」显示成「没有改动」。
      return http.get<ChangeSet>(`/tasks/${taskId}/changes`)
    },

    async eventsHistory(taskId, query = {}) {
      const payload = await http.get<unknown>(`/tasks/${taskId}/events/history`, {
        query: { afterSeq: query.afterSeq, limit: query.limit },
      })
      // 历史接口的返回形状在 02 里没有冻结（`Page<TaskEvent>` 与裸数组都可能，02 §5 只规定用 afterSeq 补齐），
      // 所以交给 normalizeEventList：认不出来就抛错，避免「缺口没补上却显示已恢复」。
      return normalizeEventList(payload)
    },

    stream(taskId, handlers, options) {
      // 直接转发给 streams.openTaskEventStream：断线重连、seq 去重、缺口补齐、终态唯一都在那里。
      // 这一层不重复实现，也不加「连不上就当完成」的兜底（README §2.9：断线不得当作完成）。
      return openTaskEventStream(http, taskId, handlers ?? {}, options ?? {})
    },
  }
}

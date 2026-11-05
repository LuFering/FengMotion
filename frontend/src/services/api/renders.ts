/**
 * 渲染与交付域客户端。
 *
 * 依据：`docs/contracts/render.md`（§1 作业与端点、§2 交付状态、§3 验收、§4 与检查/任务的关系、§5 规则边界）
 * 与 `docs/contracts/README.md`（§2.3 成功响应、§2.7 并发与幂等、§4.4 渲染与交付状态机）。
 *
 * 三条红线写在最前面，界面实现时必须照此：
 * 1. **`output` 只在真实完成后存在**（render.md §1.1）：`status !== 'completed'` 时不得给出下载入口，
 *    也不要用占位 URL 顶上；未完成只显示状态与下一步入口。
 * 2. **`deliverable` 是服务端派生值**（render.md §2.1）：前端不得本地推导「应该可交付了」；
 *    `missing` 非空时必须逐项说明缺什么，只给一个状态词算契约违规（README §4.4）。
 * 3. **202 只是受理**（README §2.3）：创建渲染返回 202 不代表产物已生成，真实状态看 `RenderJob.status`。
 */
import type { HttpClient } from './http'
import type {
  AcceptanceRecord,
  AcceptanceRequest,
  DeliveryState,
  Page,
  PageQuery,
  RenderCreateRequest,
  RenderJob,
  RenderStatus,
} from '@/types/contracts'
import { asPage } from './pagination'

/**
 * 渲染历史筛选：render.md §1.2 的 `?status=&cursor=`。
 * `src/types/contracts.ts` 没有冻结 `RenderListQuery`（只有 `RenderJob` 等实体），故在此按端点声明。
 */
export interface RenderListQuery extends PageQuery {
  status?: RenderStatus
}

export function createRendersResource(http: HttpClient) {
  function projectRendersPath(projectId: string): string {
    return `/projects/${encodeURIComponent(projectId)}/renders`
  }

  function renderPath(renderId: string): string {
    return `/renders/${encodeURIComponent(renderId)}`
  }

  return {
    /**
     * `POST /projects/{projectId}/renders` → `202` + `RenderJob`（render.md §1.2）。
     *
     * - `options.idempotencyKey`：同一次用户意图的重试必须复用同一个键，服务端 24h 内重放首次结果
     *   （README §2.7）；不传则每次调用自动生成一个 —— 那只能防同一请求体内重发，防不住用户连点两次。
     *   连点保护需要调用方在点击时生成一次键并复用。
     * - 云渲染未接入 → `422 capability_unavailable`（`details.capability=cloudRender`），如实抛出；
     *   项目未组装完成 → `409 conflict`（`details.missing` 列缺件）。
     * - 创建成功会同时产生 `kind=render` 任务，进度请订阅任务事件流，别轮询死等。
     */
    create(
      projectId: string,
      body: RenderCreateRequest,
      options: { idempotencyKey?: string; signal?: AbortSignal } = {},
    ): Promise<RenderJob> {
      return http.post<RenderJob>(projectRendersPath(projectId), body, {
        idempotencyKey: options.idempotencyKey,
        signal: options.signal,
      })
    },

    /**
     * `GET /projects/{projectId}/renders`：历史列表，默认最近更新倒序（README §2.5）。
     *
     * 形状用 `asPage` 归一：列表可能是 `Page<T>`，也可能是契约里另一种口径的裸数组；
     * 认不出形状就抛错，避免调用方把「没读到」显示成「没有渲染记录」。
     */
    async list(projectId: string, query: RenderListQuery = {}): Promise<Page<RenderJob>> {
      const path = projectRendersPath(projectId)
      const payload = await http.get<unknown>(path, { query: { ...query } })
      return asPage<RenderJob>(payload, { source: `GET ${path}` })
    },

    /**
     * `GET /renders/{renderId}`：详情才带 `output`/`error`。
     *
     * ⚠️ 只有 `status === 'completed'` 且 `output` 存在时才可渲染下载入口（render.md §5）；
     * 未 completed 时 `output` 本就不该出现，界面也不得用缩略图/占位地址假装有产物。
     */
    get(renderId: string): Promise<RenderJob> {
      return http.get<RenderJob>(renderPath(renderId))
    },

    /**
     * `POST /renders/{renderId}/cancel`：取消是**请求**不是保证（render.md §1.2、02 §5），
     * 已写出的部分产物保留并标注；终态下取消会返回 409，如实抛出。
     *
     * 返回 `RenderJob | null`：契约没有冻结取消响应的形状，服务端可能只回受理（202 + 空体）。
     * 要真实状态请重新 `get()` 或订阅关联任务事件，**不要**把「发出了取消」当成「已取消」。
     */
    async cancel(renderId: string): Promise<RenderJob | null> {
      const response = await http.request<RenderJob | undefined>(
        'POST',
        `${renderPath(renderId)}/cancel`,
      )
      return response.data ?? null
    },

    /**
     * `GET /projects/{projectId}/delivery` → `DeliveryState`（render.md §2）。
     *
     * 交付状态由服务端在渲染完成、检查完成、验收提交后重算（render.md §4）；前端不本地推导。
     * `missing[]` 是给人看的缺件清单：非空时必须逐项展示 `label` + `reason`，
     * 且此时不得给下载入口（README §4.4）。
     */
    delivery(projectId: string): Promise<DeliveryState> {
      return http.get<DeliveryState>(`/projects/${encodeURIComponent(projectId)}/delivery`)
    },

    /**
     * `POST /renders/{renderId}/acceptance`：提交验收决定（render.md §3.1）。
     *
     * - 只有 `deliverable` 状态可验收，其他状态 `409 conflict`；
     * - `rejected` 必须带 `note`（≥1 字），否则 `400 validation_error` —— 前端应在提交前拦住空 note；
     * - `decidedBy` 由服务端从会话身份取，客户端不得传入、不得伪造；
     * - 重复验收以最新一次为准、历史全部保留，所以这里不额外做幂等去重（契约允许重复提交）。
     */
    accept(renderId: string, body: AcceptanceRequest): Promise<AcceptanceRecord> {
      return http.post<AcceptanceRecord>(`${renderPath(renderId)}/acceptance`, body)
    },

    /**
     * `GET /projects/{projectId}/acceptances`：验收历史（render.md §3.1）。
     * 形状用 `asPage` 归一（裸数组 / `Page<T>` 都可能出现），认不出就抛错。
     */
    async acceptances(projectId: string, query: PageQuery = {}): Promise<Page<AcceptanceRecord>> {
      const path = `/projects/${encodeURIComponent(projectId)}/acceptances`
      const payload = await http.get<unknown>(path, { query: { ...query } })
      return asPage<AcceptanceRecord>(payload, { source: `GET ${path}` })
    },
  }
}

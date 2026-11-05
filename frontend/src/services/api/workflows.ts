/**
 * 工作流域客户端（定义 / 版本 / 运行 / 模板）。
 *
 * 依据：`docs/contracts/workflow.md`（§2 定义、§3 版本规则、§4 端点、§5 运行状态机、§6 nodeIO、§7 与任务/检查的关系）
 * 与 `docs/contracts/README.md` §4.2。
 *
 * 几条容易写错的语义：
 * 1. **保存产生新 version**（workflow.md §3）：`PATCH` 是「保存 + 升版本」，不是原地覆盖；
 *    只改 `name`/`description`/`tags` 不升 version，但 `etag` 会变 —— 所以每次保存后必须用响应里的新资源，
 *    不能继续用旧 etag 提交。
 * 2. **删除可能只是归档**（workflow.md §3）：有运行记录的定义会变成 `status=archived` 而不是物理删除，
 *    所以删除成功后不要断言「定义没了」，需要真相再 `get()`。
 * 3. **运行成功 ≠ 交付通过**（workflow.md §7）：交付由检查与验收决定（见 `checks.ts`/`renders.ts`）。
 * 4. **未执行的节点不出现在 `nodeIO`**（workflow.md §6）：不要把缺失的节点当成「空对象已执行」。
 */
import type { HttpClient } from './http'
import type {
  IsoDateTime,
  Page,
  PageQuery,
  WorkflowCreateRequest,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunRequest,
  WorkflowRunStatus,
  WorkflowStatus,
  WorkflowSummary,
  WorkflowTemplate,
  WorkflowUpdateRequest,
} from '@/types/contracts'
import { asPage } from './pagination'

/** 定义列表筛选：workflow.md §4.1 的 `?projectId=&status=&q=&tag=&cursor=`。 */
export interface WorkflowListQuery extends PageQuery {
  projectId?: string
  status?: WorkflowStatus
  q?: string
  tag?: string
}

/** 模板列表筛选：workflow.md §4.2 的 `?genomeId=&q=&tag=&cursor=`。 */
export interface WorkflowTemplateListQuery extends PageQuery {
  genomeId?: string
  q?: string
  tag?: string
}

/** 运行列表筛选：workflow.md §4.3 的 `?status=&cursor=`。 */
export interface WorkflowRunListQuery extends PageQuery {
  status?: WorkflowRunStatus
}

/**
 * 版本历史条目（只读元信息，workflow.md §4.1）。
 *
 * ⚠️ 契约缺口：`src/types/contracts.ts` 没有对应实体，端点又只说「只读元信息」。
 * 这里只声明能确认的 `version`，其余字段全部可选 —— 不用必填字段假装它们的形状已冻结。
 */
export interface WorkflowVersionEntry {
  version: number
  name?: string
  status?: WorkflowStatus
  createdAt?: IsoDateTime
  updatedAt?: IsoDateTime
  [key: string]: unknown
}

export function createWorkflowsResource(http: HttpClient) {
  function workflowPath(workflowId: string): string {
    return `/workflows/${encodeURIComponent(workflowId)}`
  }

  function runPath(runId: string): string {
    return `/workflow-runs/${encodeURIComponent(runId)}`
  }

  return {
    /**
     * `GET /workflows`：定义列表（`Page<WorkflowSummary>`，不含 nodes/edges）。
     *
     * 形状用 `asPage` 归一：裸数组与 `Page<T>` 两种口径都接受，认不出形状抛错。
     */
    async list(query: WorkflowListQuery = {}): Promise<Page<WorkflowSummary>> {
      const path = '/workflows'
      const payload = await http.get<unknown>(path, { query: { ...query } })
      return asPage<WorkflowSummary>(payload, { source: `GET ${path}` })
    },

    /**
     * `POST /workflows`：新建定义，空白或从模板（`templateId` 与 `nodes/edges` 二选一，
     * 同时提供会 `400 validation_error`；workflow.md §4.1）。
     *
     * `options.idempotencyKey` 用于同一意图的重试复用（README §2.7）；不传则自动生成，
     * 只防同请求体重发，防不住连点 —— 连点保护由调用方复用同一个键实现。
     */
    create(
      body: WorkflowCreateRequest,
      options: { idempotencyKey?: string; signal?: AbortSignal } = {},
    ): Promise<WorkflowDefinition> {
      return http.post<WorkflowDefinition>('/workflows', body, {
        idempotencyKey: options.idempotencyKey,
        signal: options.signal,
      })
    },

    /**
     * `GET /workflows/{workflowId}?version=`：详情；不传 version 取最新版本。
     * 历史版本是只读快照，改结构必须产生新 version（workflow.md §3），所以查看旧版本时界面应禁用保存。
     */
    get(
      workflowId: string,
      options: { version?: number; signal?: AbortSignal } = {},
    ): Promise<WorkflowDefinition> {
      const query = options.version === undefined ? undefined : { version: options.version }
      return http.get<WorkflowDefinition>(workflowPath(workflowId), {
        query,
        signal: options.signal,
      })
    },

    /**
     * `PATCH /workflows/{workflowId}`：保存并（结构有变时）产生新 version，必须带 `If-Match`。
     *
     * 返回的是保存后的**新**资源：请用它替换本地缓存 —— 旧 `etag` 已经失效，
     * 再用它提交会得到 `412 precondition_failed`（README §2.7）。
     */
    update(
      workflowId: string,
      body: WorkflowUpdateRequest,
      etag: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<WorkflowDefinition> {
      return http.patch<WorkflowDefinition>(workflowPath(workflowId), body, {
        ifMatch: etag,
        signal: options.signal,
      })
    },

    /**
     * `DELETE /workflows/{workflowId}`：无运行时删除，有运行时归档（workflow.md §3）。
     * 服务端不区分这两种结果、也不返回内容，需要确认「到底删了还是归档了」请再 `get()`。
     */
    async remove(workflowId: string): Promise<void> {
      await http.del(workflowPath(workflowId))
    },

    /**
     * `GET /workflows/{workflowId}/versions`：版本历史。
     *
     * 返回数组而不是 `Page<T>`：端点没有游标参数（workflow.md §4.1），按「文档给了 cursor 才分页」处理。
     * 形状本身是契约缺口（见 `WorkflowVersionEntry` 注释）。
     */
    versions(workflowId: string): Promise<WorkflowVersionEntry[]> {
      return http.get<WorkflowVersionEntry[]>(`${workflowPath(workflowId)}/versions`)
    },

    /**
     * `GET /workflows/{workflowId}/runs`：该定义的运行列表。
     * 形状用 `asPage` 归一（裸数组 / `Page<T>` 都可能出现），认不出就抛错。
     */
    async runs(
      workflowId: string,
      query: WorkflowRunListQuery = {},
    ): Promise<Page<WorkflowRun>> {
      const path = `${workflowPath(workflowId)}/runs`
      const payload = await http.get<unknown>(path, { query: { ...query } })
      return asPage<WorkflowRun>(payload, { source: `GET ${path}` })
    },

    /**
     * `POST /workflows/{workflowId}/runs` → `202` + `WorkflowRun`（workflow.md §4.3）。
     *
     * 启动会同时创建任务：进度与终态请用返回的 `taskId` 订阅任务事件流，
     * 不要把 202 或 `pending` 当成成功。缺少必填输入会 `400 validation_error`
     * （`details.missingInputs` 列端口名），服务端不会创建半成品运行。
     */
    startRun(workflowId: string, body: WorkflowRunRequest): Promise<WorkflowRun> {
      return http.post<WorkflowRun>(`${workflowPath(workflowId)}/runs`, body)
    },

    /** `GET /workflow-runs/{runId}`：运行详情（`nodeIO`/`error`）。 */
    getRun(runId: string): Promise<WorkflowRun> {
      return http.get<WorkflowRun>(runPath(runId))
    },

    /**
     * `POST /workflow-runs/{runId}/cancel`：取消（仅 `pending`/`running`）。
     *
     * 与任务取消同语义：是请求不是保证，已产生的 `nodeIO` 保留；终态下取消返回 409，如实抛出。
     * 响应形状未冻结，故可能为 `null`；真实状态以 `getRun()` 或任务事件为准。
     */
    async cancelRun(runId: string): Promise<WorkflowRun | null> {
      const response = await http.request<WorkflowRun | undefined>(
        'POST',
        `${runPath(runId)}/cancel`,
      )
      return response.data ?? null
    },

    /**
     * `GET /workflow-templates`：模板广场（只读定义快照，模板升级不影响已创建的定义）。
     * 形状用 `asPage` 归一（裸数组 / `Page<T>` 都可能出现），认不出就抛错。
     */
    async listTemplates(query: WorkflowTemplateListQuery = {}): Promise<Page<WorkflowTemplate>> {
      const path = '/workflow-templates'
      const payload = await http.get<unknown>(path, { query: { ...query } })
      return asPage<WorkflowTemplate>(payload, { source: `GET ${path}` })
    },

    /** `GET /workflow-templates/{templateId}`：模板详情（含定义快照）。 */
    getTemplate(templateId: string): Promise<WorkflowTemplate> {
      return http.get<WorkflowTemplate>(`/workflow-templates/${encodeURIComponent(templateId)}`)
    },
  }
}

/**
 * 检查域客户端（检查运行 / 问题项）。
 *
 * 依据：`docs/contracts/check.md`（§1 铁律、§2 CheckRun、§3 CheckFinding、§4 端点、§5 结论派生）
 * 与 `docs/contracts/README.md` §4.3。
 *
 * 三条铁律必须在界面与数据层同时成立，不能只在文案上写：
 * 1. **`resolved`/`ignored` 只是人处理过，不等于检查通过**（check.md §1 铁律一）：处理状态
 *    （`CheckFinding.status`）与检查结论（`CheckConclusion`）是两个概念，本层不把两者互相推导。
 * 2. **`cancelled` 不等于通过**（check.md §2 铁律二）：`running`/`failed`/`cancelled` 与「没有 run」
 *    一样只能表达为 `not_run`；`completed` 也只表示「检查项跑完了」，不是「没问题」。
 * 3. **结论是派生值**（check.md §5、README §4.3）：只有 `CheckRunDetail.conclusion` 算数，
 *    前端不得用「findings 都 resolved 了」自己推出通过；`counts` 只在 `completed` 存在，
 *    不得用 0 冒充「没问题」。
 *
 * 另外：`capability_unavailable`（`details.capability=checkExecution`）表示检查执行能力未接入，
 * 服务端不会创建 run；本层如实抛出，由界面按能力声明置灰（README §2.4 铁律、§2.10）。
 */
import type { HttpClient } from './http'
import type {
  CheckCreateRequest,
  CheckFinding,
  CheckFindingStatus,
  CheckFindingUpdateRequest,
  CheckRun,
  CheckRunDetail,
  CheckRunStatus,
  CheckSeverity,
  Page,
  PageQuery,
} from '@/types/contracts'
import { asPage } from './pagination'

/**
 * 项目检查列表筛选：check.md §4 的 `?renderId=&status=&cursor=`。
 * 契约没有冻结该查询类型，故在此按端点声明（实体仍一律取自 `@/types/contracts`）。
 */
export interface CheckListQuery extends PageQuery {
  renderId?: string
  status?: CheckRunStatus
}

/** 问题项筛选：check.md §4 的 `?severity=&status=&category=&cursor=`。 */
export interface CheckFindingListQuery extends PageQuery {
  severity?: CheckSeverity
  status?: CheckFindingStatus
  category?: string
}

export function createChecksResource(http: HttpClient) {
  function projectChecksPath(projectId: string): string {
    return `/projects/${encodeURIComponent(projectId)}/checks`
  }

  return {
    /**
     * `POST /projects/{projectId}/checks` → `202` + `CheckRun`（check.md §4）。
     *
     * - 没有 `pending` 状态：创建即开始执行（check.md §2）；
     * - `renderId` 必须属于该项目且状态 `completed`，否则 `400 validation_error`；
     * - 复检必须新开 run，用 `supersedesCheckRunId` 指向旧 run，旧 run 只读保留；
     * - 检查执行能力未接入 → `422 capability_unavailable`，不创建 run（如实抛出）。
     */
    create(projectId: string, body: CheckCreateRequest): Promise<CheckRun> {
      return http.post<CheckRun>(projectChecksPath(projectId), body)
    },

    /**
     * `GET /projects/{projectId}/checks`：项目检查列表（可按产物/状态筛选）。
     *
     * 形状用 `asPage` 归一：裸数组与 `Page<T>` 两种口径都能接受，认不出形状抛错 ——
     * 「这次没读到」不能显示成「这个项目没有检查记录」。
     */
    async list(projectId: string, query: CheckListQuery = {}): Promise<Page<CheckRun>> {
      const path = projectChecksPath(projectId)
      const payload = await http.get<unknown>(path, { query: { ...query } })
      return asPage<CheckRun>(payload, { source: `GET ${path}` })
    },

    /**
     * `GET /checks/{checkRunId}`：运行详情 + 派生结论 + 首批问题项（check.md §4）。
     *
     * `conclusion` 只用这里的值：`not_run` 包含「没有 run」与「run 未完成（running/failed/cancelled）」，
     * **不得**把它显示成通过（check.md §5 铁律二）。
     *
     * 详情内的 `findings` 字段本身就是 `Page<CheckFinding>`，所以同样用 `asPage` 归一：
     * 不归一时调用方读 `detail.findings.items` 会在裸数组响应下拿到 `undefined` 而不报错 —— 与列表接口是同一类缺陷。
     * 其余字段原样透传：这一层不重写 `run`/`conclusion` 等业务字段，也不替服务端补默认值。
     */
    async get(checkRunId: string): Promise<CheckRunDetail> {
      const path = `/checks/${encodeURIComponent(checkRunId)}`
      const payload = await http.get<unknown>(path)
      const detail = (typeof payload === 'object' && payload !== null ? payload : {}) as CheckRunDetail
      return {
        ...detail,
        findings: asPage<CheckFinding>(detail.findings, { source: `GET ${path} 的 findings` }),
      }
    },

    /**
     * `GET /checks/{checkRunId}/findings`：问题项分页（check.md §4）。
     * 形状用 `asPage` 归一：认不出就抛错，避免「没读到问题项」被当成「这条片没有问题」。
     */
    async findings(
      checkRunId: string,
      query: CheckFindingListQuery = {},
    ): Promise<Page<CheckFinding>> {
      const path = `/checks/${encodeURIComponent(checkRunId)}/findings`
      const payload = await http.get<unknown>(path, { query: { ...query } })
      return asPage<CheckFinding>(payload, { source: `GET ${path}` })
    },

    /**
     * `PATCH /check-findings/{findingId}`：只改处理状态，带 `If-Match`（check.md §4）。
     *
     * - 只接受 `status`/`note`；`severity`/`title`/`evidence` 等结论字段客户端不可写；
     * - `status=resolved` 只写 finding，**不改** `CheckRun.status`、**不改** `conclusion`
     *   （check.md §4）——「人处理过」与「检查通过」必须分开呈现；
     * - 重复提交同一状态幂等返回当前对象；`412 precondition_failed` 表示他人已改，需要重新拉取。
     */
    updateFinding(
      findingId: string,
      body: CheckFindingUpdateRequest,
      etag: string,
    ): Promise<CheckFinding> {
      return http.patch<CheckFinding>(`/check-findings/${encodeURIComponent(findingId)}`, body, {
        ifMatch: etag,
      })
    },

    /**
     * `GET /renders/{renderId}/checks`：某个产物的检查记录（check.md §4）。
     * 形状用 `asPage` 归一（裸数组 / `Page<T>` 都可能出现），认不出就抛错。
     */
    async forRender(renderId: string, query: PageQuery = {}): Promise<Page<CheckRun>> {
      const path = `/renders/${encodeURIComponent(renderId)}/checks`
      const payload = await http.get<unknown>(path, { query: { ...query } })
      return asPage<CheckRun>(payload, { source: `GET ${path}` })
    },
  }
}

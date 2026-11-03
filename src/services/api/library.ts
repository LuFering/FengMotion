/**
 * 知识库域客户端（特效库 / 片型画像 / 参考片与镜头段 / 集合与偏好）。
 *
 * 依据：`docs/contracts/library.md`（§2 特效、§3 片型、§4 参考片与镜头段、§5 集合与偏好、§6 三库共同规则）
 * 与 `docs/contracts/README.md` §2.5/§2.10/§3.8。
 *
 * 边界与红线：
 * 1. 三套数据模型不混用（library.md §1）：技法 ≠ 参考片 ≠ 片型画像，本层按子资源分开暴露，不提供跨库聚合。
 * 2. **解析能力未接入 → 422 `capability_unavailable`**（`details.capability=referenceAnalysis`）：
 *    `analyzeVideo` 如实抛出；界面应先用 `referenceAnalysisGate` 置灰按钮（README §2.10），
 *    但闸门只是提前提示，服务端仍可能返回 422（能力状态会变），两者都要处理。
 * 3. `pending=true` 的分析维度不得填默认值（library.md §4.2）：`AnalysisValue` 原样透传，本层不补 0/空串。
 * 4. 收藏只是个人标记，不是「已审核/已采用」（library.md §5）；偏好是工作区级，跨项目共享。
 */
import type { HttpClient } from './http'
import type { ApiResponse, CapabilityGate, CapabilityView } from './types'
import type {
  FxCategory,
  FxExecType,
  FxFacets,
  FxImpl,
  FxInputKind,
  FxTechnique,
  Genome,
  Page,
  PageQuery,
  ReferenceCollection,
  ReferencePreference,
  ReferencePreferenceUpdate,
  ReferenceShot,
  ReferenceShotQuery,
  ReferenceStatus,
  ReferenceVideo,
  TaskAcceptedResponse,
} from '@/types/contracts'
import { CAPABILITY_LABELS, capabilityGate } from './capabilities'
import { asPage } from './pagination'

/**
 * 特效列表筛选：library.md §2.2 的 `?category=&execType=&impl=&inputKind=&maxComplexity=&q=&sort=&cursor=`。
 * 复杂度区间用 `complexityMin`/`complexityMax` 表达（契约只写了 `maxComplexity`，属缺口，已在汇报中提出）。
 */
export interface FxTechniqueQuery extends PageQuery {
  category?: FxCategory
  execType?: FxExecType
  impl?: FxImpl
  inputKind?: FxInputKind
  complexityMin?: number
  complexityMax?: number
  q?: string
  sort?: 'cat' | 'complexity' | 'updated'
}

/** 参考片列表筛选：library.md §4.3 的 `?q=&tag=&status=&cursor=`。 */
export interface ReferenceVideoQuery extends PageQuery {
  q?: string
  tag?: string
  status?: ReferenceStatus
}

/** 新建集合请求体：library.md §5 的 `{ name, note, shotIds }`。 */
export interface ReferenceCollectionCreateRequest {
  name: string
  note?: string
  shotIds?: string[]
}

/** 更新集合请求体：改名/备注/成员，未提供的字段不改。 */
export interface ReferenceCollectionUpdateRequest {
  name?: string
  note?: string
  shotIds?: string[]
}

/**
 * 「发起解析」按钮的可用性闸门。
 *
 * 为什么放在 API 层：能力状态来自 `GET /capabilities`，置灰规则是「只有 `available` 放行」，
 * 且 `demo` 也不能驱动真实写操作（README §2.10）。把规则收在这里，
 * 界面只需 `const gate = referenceAnalysisGate(views.referenceAnalysis)`，不再各自判断。
 * 注意它只是提前提示：能力状态可能刚变化，`analyzeVideo` 仍必须处理 422 的真实返回。
 */
export function referenceAnalysisGate(view: CapabilityView): CapabilityGate {
  return capabilityGate(view, CAPABILITY_LABELS.referenceAnalysis)
}

export function createLibraryResource(http: HttpClient) {
  return {
    /* ---------------- 特效库（只读目录，不提供写端点） ---------------- */
    fx: {
      /**
       * `GET /fx-techniques`：列表返回 `Page<FxTechnique>`（library.md §2.2）。
       *
       * 形状用 `asPage` 归一：裸数组与 `Page<T>` 两种口径都接受，认不出形状抛错
       * （技法库条目多，这里尤其不能把「没读到」显示成「没有技法」）。
       */
      async listTechniques(query: FxTechniqueQuery = {}): Promise<Page<FxTechnique>> {
        const path = '/fx-techniques'
        const payload = await http.get<unknown>(path, { query: { ...query } })
        return asPage<FxTechnique>(payload, { source: `GET ${path}` })
      },

      /**
       * `GET /fx-techniques/facets`：筛选面与计数。
       * 注意是**全量计数**，不随当前筛选变化（library.md §2.2），界面别拿它当筛选后的结果数。
       */
      facets(): Promise<FxFacets> {
        return http.get<FxFacets>('/fx-techniques/facets')
      },

      /** `GET /fx-techniques/{techniqueId}`：完整详情（列表项字段较少，不要用列表项充当详情）。 */
      getTechnique(techniqueId: string): Promise<FxTechnique> {
        return http.get<FxTechnique>(`/fx-techniques/${encodeURIComponent(techniqueId)}`)
      },
    },

    /* ---------------- 片型画像（只读） ---------------- */
    genomes: {
      /**
       * `GET /genomes`：返回数组而不是 `Page<T>` —— 端点没有游标参数（library.md §3），
       * 按「文档给了 cursor 才分页」处理（README §2.5）。
       */
      listGenomes(): Promise<Genome[]> {
        return http.get<Genome[]>('/genomes')
      },

      /** `GET /genomes/{genomeId}`：详情（含 `method` 方法步骤）。 */
      getGenome(genomeId: string): Promise<Genome> {
        return http.get<Genome>(`/genomes/${encodeURIComponent(genomeId)}`)
      },
    },

    /* ---------------- 参考片与镜头段 ---------------- */
    referenceVideos: {
      /**
       * `GET /reference-videos`：列表（library.md §4.3）。
       * 形状用 `asPage` 归一：裸数组与 `Page<T>` 两种口径都接受，认不出形状抛错。
       */
      async listVideos(query: ReferenceVideoQuery = {}): Promise<Page<ReferenceVideo>> {
        const path = '/reference-videos'
        const payload = await http.get<unknown>(path, { query: { ...query } })
        return asPage<ReferenceVideo>(payload, { source: `GET ${path}` })
      },

      /**
       * `GET /reference-videos/{videoId}`：详情（服务端可能附带镜头段计数，契约未冻结该字段，本层不声明）。
       */
      getVideo(videoId: string): Promise<ReferenceVideo> {
        return http.get<ReferenceVideo>(`/reference-videos/${encodeURIComponent(videoId)}`)
      },

      /**
       * `POST /reference-videos/{videoId}/analyze` → `202` + `TaskAcceptedResponse`（library.md §4.3）。
       *
       * - 解析是异步任务（`kind=analyze`）：返回的 `task` 只表示受理，完成后由任务事件通知，
       *   视频/镜头段状态轮询 `getVideo`/`listShots` 即可；不要把 202 当作解析完成；
       * - 能力未接入 → `422 capability_unavailable`（`details.capability=referenceAnalysis`），
       *   如实抛出，不伪造 `partial` 状态；界面用 `referenceAnalysisGate` 提前置灰；
       * - 重复解析不覆盖旧分析（P1 保留历史），所以这里不做幂等去重。
       */
      analyzeVideo(videoId: string): Promise<TaskAcceptedResponse> {
        return http.post<TaskAcceptedResponse>(
          `/reference-videos/${encodeURIComponent(videoId)}/analyze`,
        )
      },
    },

    referenceShots: {
      /**
       * `GET /reference-shots`：镜头段列表（`ReferenceShotQuery` 已由契约冻结）。
       * 形状用 `asPage` 归一：认不出就抛错，避免把「没读到镜头段」显示成「这片没有镜头段」。
       */
      async listShots(query: ReferenceShotQuery = {}): Promise<Page<ReferenceShot>> {
        const path = '/reference-shots'
        const payload = await http.get<unknown>(path, { query: { ...query } })
        return asPage<ReferenceShot>(payload, { source: `GET ${path}` })
      },

      /**
       * `GET /reference-shots/{shotId}`：详情。
       * 十维分析里 `pending=true` 的维度表示**尚未解析**，界面显示「未解析」，不得填默认值
       * 或 0（library.md §4.2 铁律）；观察（`observation`）与推断（`inference`）必须分块呈现。
       */
      getShot(shotId: string): Promise<ReferenceShot> {
        return http.get<ReferenceShot>(`/reference-shots/${encodeURIComponent(shotId)}`)
      },
    },

    /* ---------------- 集合 ---------------- */
    collections: {
      /** `GET /reference-collections`：数组返回（端点无游标参数，见上面的分页口径）。 */
      listCollections(): Promise<ReferenceCollection[]> {
        return http.get<ReferenceCollection[]>('/reference-collections')
      },

      /**
       * 带版本的集合读取：`GET /reference-collections`，把响应头 `ETag` 一并交回调用方。
       *
       * 为什么必须有它：`ReferenceCollection` 类型里没有 `etag` 字段（契约缺口），
       * 而 `updateCollection` 的 `If-Match` 是必填的（README §2.7：不匹配返回 412）。
       * 没有这个方法，调用方永远拿不到集合的版本号，那个写接口事实上不可用。
       *
       * 为什么用列表端点而不是单资源详情：README §3.8 只冻结了 `GET /reference-collections`
       * （列表）与 `POST`/`PATCH`/`DELETE`，**没有** `GET /reference-collections/{collectionId}`；
       * 不为了拿一个 ETag 去调用契约里不存在的端点。
       *
       * 注意：`ETag` 是这次响应所代表的一份状态；拿到后请尽快用它提交更新，
       * 且要用同一份响应里的集合定位目标，别用另一次读取的数据配这次的 ETag（会 412）。
       */
      listCollectionsWithMeta(): Promise<ApiResponse<ReferenceCollection[]>> {
        return http.getWithMeta<ReferenceCollection[]>('/reference-collections')
      },

      /** `POST /reference-collections`：新建集合（不产生镜头段，只登记成员关系）。 */
      createCollection(body: ReferenceCollectionCreateRequest): Promise<ReferenceCollection> {
        return http.post<ReferenceCollection>('/reference-collections', body)
      },

      /**
       * `PATCH /reference-collections/{collectionId}`：改名/备注/成员，带 `If-Match`。
       *
       * ⚠️ 契约缺口：`ReferenceCollection` 类型里**没有** `etag` 字段（library.md §5 与 README §2.7
       * 却要求条件更新）。所以 etag 由调用方提供，取自 `listCollectionsWithMeta()` 的响应头
       * （见该方法的注释）；本层只做透传，不猜、不缓存版本号。
       */
      updateCollection(
        collectionId: string,
        body: ReferenceCollectionUpdateRequest,
        etag: string,
      ): Promise<ReferenceCollection> {
        return http.patch<ReferenceCollection>(
          `/reference-collections/${encodeURIComponent(collectionId)}`,
          body,
          { ifMatch: etag },
        )
      },

      /** `DELETE /reference-collections/{collectionId}`：只删集合，不删镜头段（library.md §5）。 */
      async removeCollection(collectionId: string): Promise<void> {
        await http.del(`/reference-collections/${encodeURIComponent(collectionId)}`)
      },
    },

    /* ---------------- 个人偏好（工作区级） ---------------- */
    preferences: {
      /**
       * `GET /reference-preferences`：收藏/最近/成员关系。
       * 返回体自带 `etag`，更新时必须原样回传（README §2.7）。
       */
      getPreferences(): Promise<ReferencePreference> {
        return http.get<ReferencePreference>('/reference-preferences')
      },

      /**
       * `PATCH /reference-preferences`：更新偏好，带 `If-Match`。
       * 412 表示其他窗口已改过，界面应重新拉取再合并，不要覆盖（README §2.7）。
       * 返回更新后的对象（含新 `etag`），请用它替换本地缓存。
       */
      updatePreferences(body: ReferencePreferenceUpdate, etag: string): Promise<ReferencePreference> {
        return http.patch<ReferencePreference>('/reference-preferences', body, { ifMatch: etag })
      },
    },
  }
}

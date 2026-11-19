/**
 * 语义检索（对应后端 `/api/retrieval/search`）。
 *
 * <p><strong>为什么状态必须带进前端</strong>：一次检索有三种完全不同的结果 ——
 * 「语义命中」「语义不可用但字面命中」「确实没有」。把它们都表现成空列表，
 * 用户会以为库里没有相关内容；都表现成有结果，用户又会把字面匹配当成语义命中。
 * 后端已经分好状态，这里只做转发，<strong>不在前端重新推断</strong>。</p>
 *
 * <p>另一个必须守住的点：后端即使检索失败也返回 HTTP 200（「没查到」和「查不了」
 * 都是这个接口的正常业务结果），所以这里<strong>不能用状态码判断成败</strong>，
 * 必须读响应体的 {@code status} / {@code usable} / {@code degraded}。</p>
 */
import type { HttpClient } from './http'

/** 一条命中。 */
export interface RetrievalHit {
  /** 来源：asset / reference / technique / capability */
  kind: string
  /** 资源 ID */
  id: string
  /** 段号 */
  chunk: number
  /** 命中文本 */
  text: string
  /** 语义相似度；降级时为字面命中词块占比，含义由 status 决定 */
  score: number
}

/** 检索状态，与后端 RetrievalResult.Status 一一对应。 */
export type RetrievalStatus =
  | 'SUCCESS_WITH_HITS'
  | 'SUCCESS_NO_MATCH'
  | 'DEGRADED_LITERAL_WITH_HITS'
  | 'DEGRADED_LITERAL_NO_MATCH'
  | 'INDEX_NOT_READY'
  | 'SERVICE_FAILED'

/** 检索响应。 */
export interface RetrievalResponse {
  status: RetrievalStatus
  /** 是否降级为字面匹配：true 时结果不能称为「语义命中」 */
  degraded: boolean
  /** 是否有可展示的结果 */
  usable: boolean
  /** 人类可读说明，仅降级/失败时出现 */
  reason?: string
  /** 索引总段数 */
  indexed: number
  hits: RetrievalHit[]
}

/** 检索参数。 */
export interface RetrievalQuery {
  /** 自然语言查询 */
  q: string
  /** 限定来源，逗号分隔 */
  kinds?: string
  /** 返回条数 */
  limit?: number
}

export function createRetrievalResource(http: HttpClient) {
  return {
    /**
     * 语义检索。
     *
     * @param query 查询
     * @return 带状态的响应；网络异常时抛出，由调用方决定是否退回本地匹配
     */
    search(query: RetrievalQuery): Promise<RetrievalResponse> {
      const params = new URLSearchParams({ q: query.q })
      if (query.kinds) params.set('kinds', query.kinds)
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      return http.get<RetrievalResponse>(`/retrieval/search?${params.toString()}`)
    },
  }
}

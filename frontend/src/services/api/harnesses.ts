/**
 * 引擎域（harness）：`GET /api/harnesses`、`GET /api/harnesses/{id}/models`。
 *
 * 依据：`FengMotion-backend/docs/接口清单-供前端改造.md` §4 与
 *       `FengMotion-backend/docs/harness集成与接口清单.md` §3.1。
 *       这两份文档标注这两个接口是 🔨「可做，未实现」——**后端尚未上线**。
 *       所以本客户端按文档写的形状实现，但调用方必须能处理 404/503：
 *       后端没实现时如实降级为「拿不到引擎列表」，不得回退成硬编码引擎名冒充真实数据。
 *
 * 一条关键事实（`harness集成与接口清单.md` §1.1 已实测）：
 * DSH 对外只有 SDK / headless / ACP 三条通道，**都拿不到 token 级流**，
 * 所以 `capabilities.streaming` 目前只有 `commit` 一个值。前端据此**不应显示打字机动画**
 * （文档 §4.1 明确要求：「不要显示，会误导用户」）。
 */
import type { HttpClient } from './http'
import { asPage } from './pagination'

/** 引擎可用性。`misconfigured` 表示能启动但配置不对（如缺 provider）。 */
export type HarnessStatus = 'available' | 'unavailable' | 'misconfigured'

/**
 * 流式能力。
 * · `commit` —— 文本在步骤提交点整段到达（SDK 通道的现状）
 * · `token`  —— 逐 token 到达（DSH 目前只对 Web 客户端开放，进程外集成拿不到）
 */
export type HarnessStreaming = 'commit' | 'token'

/** 取消能力。`process` 表示只能杀子进程，不是优雅中止（SDK 协议没有 cancel 方法）。 */
export type HarnessCancel = 'process' | 'graceful'

export interface HarnessCapabilities {
  streaming: HarnessStreaming
  cancel: HarnessCancel
  resume: boolean
  tools: boolean
  reasoning: boolean
}

export interface HarnessDescriptor {
  id: string
  name: string
  kind: 'sdk' | 'headless' | 'acp'
  status: HarnessStatus
  version: string | null
  /** 不可用的原因。`status !== 'available'` 时应有值，界面要如实显示。 */
  note: string | null
  capabilities: HarnessCapabilities
}

export interface HarnessList {
  items: HarnessDescriptor[]
  /** 探测结果缓存时间。探测要 spawn 进程，后端会缓存（建议 60 秒）。 */
  cachedAt: string | null
}

export interface HarnessModel {
  id: string
  label: string
  /**
   * 是否默认模型。
   *
   * 注意字段名：后端实测返回的是 `isDefault`，而后端文档 `接口清单-供前端改造.md` §4.2 写的是 `default`。
   * 两个都读，以文档为准、实测兜底 —— 字段名不一致属契约缺口（见前后端协议.md #20）。
   */
  default: boolean
  contextWindow?: number
  maxTokens?: number
}

/**
 * 后端返回的是 `{items: [...]}`，但也可能在某些实现里直接给数组。
 * 统一走 `asPage`：它只接受这两种形状，其他一律抛 `internal_error`，
 * 不会把形状不对的响应当成空列表 —— 「拿不到」和「确实没有」必须能区分。
 */
function readItems<T>(payload: unknown, source: string): T[] {
  return asPage<T>(payload, { source }).items
}

export interface HarnessResource {
  /**
   * 引擎列表。
   *
   * 注意：后端未实现此端点时会抛 `not_found`（或 503）。
   * 调用方应把这种情况呈现为「引擎状态未知」，**不要**退回本地硬编码的引擎清单冒充真实探测结果。
   */
  list(options?: { signal?: AbortSignal }): Promise<HarnessList>
  /** 某引擎的可用模型。数据来自 DSH 的 provider 配置，不在后端硬编码。 */
  models(harnessId: string, options?: { signal?: AbortSignal }): Promise<HarnessModel[]>
}

export function createHarnessResource(http: HttpClient): HarnessResource {
  return {
    async list(options = {}) {
      const payload = await http.get<unknown>('/harnesses', { signal: options.signal })
      const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      return {
        items: readItems<HarnessDescriptor>(payload, 'GET /harnesses'),
        cachedAt: typeof record.cachedAt === 'string' ? record.cachedAt : null,
      }
    },

    async models(harnessId, options = {}) {
      const payload = await http.get<unknown>(`/harnesses/${encodeURIComponent(harnessId)}/models`, {
        signal: options.signal,
      })
      const items = readItems<Record<string, unknown>>(payload, `GET /harnesses/${harnessId}/models`)
      return items.map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        label: typeof item.label === 'string' ? item.label : (typeof item.id === 'string' ? item.id : ''),
        // 文档写 `default`，后端实测给 `isDefault`：两个都读
        default: item.default === true || item.isDefault === true,
        ...(typeof item.contextWindow === 'number' ? { contextWindow: item.contextWindow } : {}),
        ...(typeof item.maxTokens === 'number' ? { maxTokens: item.maxTokens } : {}),
      }))
    },
  }
}

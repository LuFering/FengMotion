/**
 * 列表形状兼容解析。
 *
 * 为什么需要单独一个文件：契约里「列表」有两种口径 ——
 * README §2.3 规定游标分页 `Page<T>`，而 `project.md` §4.2/§5 又规定场景、分镜这类
 * 有限集合直接返回裸数组（`Scene[]` / `StoryboardEntry[]`），`agent.md` 的会话与消息同理存在争议。
 * 两种口径都出现在同一份契约里，前端不猜是哪一种：**认得出就统一成 `Page<T>`，认不出就抛错**。
 *
 * 关键红线：形状读不出来时绝不能返回空列表。调用方会把 `undefined` 或 `[]`
 * 显示成「没有数据」，而事实是「没读到」——那正是把失败说成空态。
 */
import type { Page } from '@/types/contracts'
import { ApiError } from './errors'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export interface AsPageOptions {
  /** 出错定位信息，写清是哪个请求（如 `GET /projects/prj_1/tasks`），便于报障。 */
  source: string
}

/**
 * 把服务端返回的列表转成 `Page<T>`。
 *
 * - 裸数组 → `{ items, nextCursor: null }`（不编造 `total`：没有就是没有）
 * - `{ items, nextCursor?, total? }` → 原样透出
 * - 其它形状 → 抛 `internal_error`，由界面提示「这个列表没读到」
 *
 * `total` 只在服务端真的给了数字时才带上；`nextCursor` 缺失按「没有更多」处理
 * （契约要求该字段存在，缺失是服务端未按契约返回，但把它当错误会让整页列表打不开，
 * 故按最不伤人的一侧处理，并在此注明）。
 */
export function asPage<T>(payload: unknown, options: AsPageOptions): Page<T> {
  if (Array.isArray(payload)) {
    return { items: payload as T[], nextCursor: null }
  }
  if (isRecord(payload) && Array.isArray(payload.items)) {
    const page: Page<T> = {
      items: payload.items as T[],
      nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : null,
    }
    if (typeof payload.total === 'number' && Number.isFinite(payload.total)) page.total = payload.total
    return page
  }
  throw ApiError.transport(
    'internal_error',
    `${options.source} 返回的列表形状无法识别（既不是数组，也不是 {items,nextCursor}），已按错误处理，避免把「没读到」显示成「没有数据」。`,
  )
}

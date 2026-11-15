/**
 * 刷新恢复：把一个会话里**真实发生过的创作轮次**回填进共享结果存储。
 *
 * <p>为什么必须按会话查：早先恢复只请求「项目最近一次创作状态」，
 * 请求里不带会话。于是最近一次任务属于会话 B 时，B 的结论会被写进
 * 当时打开着的会话 A 的作用域 —— 查询虽然还按用户消息 id 匹配、
 * 通常不会贴错消息，但 B 自己刷新后也无法可靠恢复。</p>
 *
 * <p>所以这里做三件事：
 * 1. 按「项目 + 会话」拉该会话的创作轮次（`/creation-rounds`）；
 * 2. 逐条核对返回记录自己的 projectId / sessionId 与当前请求一致 ——
 *    不一致就跳过，绝不用「当前界面会话」顶替任务所属会话；
 * 3. 只有带 `userMessageId` 的记录才写入；旧记录缺身份就降级不写。</p>
 */

import { studioHttpApi } from '@/services/api'
import { recordRoundOutcome } from '@/shell/roundOutcomes'
import { shouldRestoreRound, shouldRefetchBackfill } from '@/shell/roundRestoreRules'

export { shouldRestoreRound, shouldRestoreLatestState } from '@/shell/roundRestoreRules'

/** 一条创作轮次（后端 `GET /workflow/creation-rounds` 的返回项）。 */
export interface CreationRoundItem {
  requestId: string
  projectId: string
  sessionId: string
  userMessageId: string
  status: string
  reply: string | null
  version: number | null
  error: string | null
  createdAt: string
  updatedAt: string
}

/**
 * 已回填过的作用域 → 上次回填的时间戳。
 *
 * <p>存时间而不是一个「done」布尔值：一次成功后永久标记会让会话
 * **长期看不到后来产生的结果**。结果可能是另一个窗口、后台恢复中的任务、
 * 或别的入口写进服务端的，当前页面并没有收到对应的实时写入；
 * 若一直用旧缓存，切回会话时就永远看不到那一轮。</p>
 *
 * <p>所以改成有 TTL 的缓存：超过 {@link BACKFILL_TTL_MS} 就重新拉一次。</p>
 */
const done = new Map<string, number>()

function scope(projectId: string, sessionId: string): string {
  return `${projectId}::${sessionId}`
}

/**
 * 回填某个「项目 + 会话」的历史轮次结果。
 *
 * <p>只回填「本轮未改动工程」这类需要展示的结论（`awaiting_info`）——
 * 有产物的轮次界面靠版本/产物展示，不需要这条提示。</p>
 *
 * @param projectId 项目 ID
 * @param sessionId 会话 ID
 * @param options.force 为 true 时忽略「已回填过」缓存，强制重新拉取
 * @returns 实际写入的轮次数
 */
export async function backfillRoundOutcomes(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
  options: {
    force?: boolean
    /**
     * 发现服务端存在这些轮次时的回调。
     *
     * <p>调用方用它判断「本页消息列表是否缺这些轮次」，缺就强制重拉消息 ——
     * 只写结论而不补消息，界面上会因为找不到对应的回复而什么都不显示。</p>
     */
    onRoundsFound?: (userMessageIds: string[]) => void
  } = {},
): Promise<number> {
  if (!projectId || !sessionId) return 0
  const key = scope(projectId, sessionId)
  if (!options.force && !shouldRefetchBackfill(done.get(key))) return 0

  let items: CreationRoundItem[]
  try {
    items = await studioHttpApi().workflowContext.creationRounds(projectId, sessionId)
  } catch {
    /* 拉不到就保持「不回填」：宁可没有提示，也不猜一条出来。
       不记入 done，下次进入仍会重试。 */
    return 0
  }
  done.set(key, Date.now())
  if (!Array.isArray(items)) return 0

  let written = 0
  /* 服务端有、但本页消息列表里没有的轮次 —— 这类轮次光写结论没用：
     结论要挂到「那条回复」上，而回复本身还没进本页。
     典型来源：另一个窗口、后台恢复中的任务、别的入口写进服务端的结果。 */
  const seen = new Set<string>()

  for (const item of items) {
    if (!shouldRestoreRound(item, projectId, sessionId)) continue
    const ok = recordRoundOutcome(projectId, sessionId, {
      reply: item.reply ?? '',
      userMessageId: item.userMessageId,
      ...(item.requestId ? { requestId: item.requestId } : {}),
    })
    if (ok) written += 1
    seen.add(item.userMessageId)
  }

  /* 通知调用方：这些轮次需要在消息列表里补上。
     不在本模块直接调 loadMessages —— 它属于会话层，
     这里只负责「发现差异」，避免把 UI 依赖塞进纯数据模块。 */
  if (seen.size > 0 && options.onRoundsFound) {
    try { options.onRoundsFound([...seen]) } catch { /* 回调异常不影响回填结果 */ }
  }
  return written
}

/** 清掉「已回填」标记，让下次进入重新拉取（测试与会话重建时用）。 */
export function resetBackfillState(): void {
  done.clear()
}

/**
 * 让某个作用域的缓存立刻失效。
 *
 * <p>本页面**自己**产生了新的创作轮次时用：那条结果已经当场写进 store 了，
 * 但缓存还停在旧时间点。不主动失效的话，用户切走再切回来，
 * 会因为「缓存没过期」而不再拉取 —— 别的窗口/后台产生的结果也同理拿不到。</p>
 */
export function invalidateBackfill(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
): void {
  if (!projectId || !sessionId) return
  done.delete(scope(projectId, sessionId))
}

/**
 * 缓存是否仍在有效期内 —— 供测试与诊断使用。
 *
 * @param now 可注入当前时间，便于测 TTL 边界
 */
export function isBackfillFresh(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!projectId || !sessionId) return false
  return !shouldRefetchBackfill(done.get(scope(projectId, sessionId)), now)
}

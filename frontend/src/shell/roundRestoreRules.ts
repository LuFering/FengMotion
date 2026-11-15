/**
 * 刷新恢复的**身份核对规则** —— 纯函数，不依赖网络与 React。
 *
 * <p>单独成文件有两个原因：
 * 1. 恢复路径有两条（「项目最近一次状态」与「按会话列出的历史轮次」），
 *    判定必须只有一份，否则两处会慢慢分叉；
 * 2. 纯函数可以被回归测试直接覆盖 ——「判定正确但入口漏接」是这个项目
 *    反复出现的毛病，判定本身必须先能独立验证。</p>
 *
 * <p>两条路径的共同原则：**任务自己的会话**才是归属依据，
 * 当前界面打开的会话不能顶替它。缺身份就降级不显示，绝不猜。</p>
 */

/**
 * 一条历史轮次记录该不该回填到当前作用域。
 *
 * <p>四个条件缺一不可：
 * · 项目一致 —— 防止别的项目混进来；
 * · 会话一致 —— 防止把会话 B 的结果写进会话 A；
 * · 消息 id 存在 —— 没有归属依据只能降级；
 * · 状态是「等待补充信息」—— 有产物的轮次靠版本/产物展示，不需要这条提示。</p>
 *
 * @param item 后端返回的轮次记录
 * @param projectId 当前作用域项目
 * @param sessionId 当前作用域会话
 * @returns 是否应回填
 */
export function shouldRestoreRound(
  item: { projectId?: string | null; sessionId?: string | null; userMessageId?: string | null; status?: string | null } | null | undefined,
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  if (!projectId || !sessionId) return false
  if (!item) return false
  if (item.projectId !== projectId) return false
  if (item.sessionId !== sessionId) return false
  if (!item.userMessageId) return false
  if (item.status !== 'awaiting_info') return false
  return true
}

/**
 * 「项目最近一次创作状态」该不该写进当前会话的结果存储。
 *
 * <p>`GET /creation` 只按项目查，拿到的是**项目最近一次**结果 ——
 * 它可能属于另一个会话。直接用当前的 `boundSessionId` 写入，
 * 就会把会话 B 的结论落进会话 A 的作用域。</p>
 *
 * @param state 后端回显的创作状态
 * @param projectId 当前项目
 * @param sessionId 当前会话
 * @returns 是否应写入
 */
export function shouldRestoreLatestState(
  state: {
    state?: string | null
    sessionId?: string | null
    userMessageId?: string | null
  } | null | undefined,
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  if (!state || !projectId || !sessionId) return false
  if (state.state !== 'awaiting_info') return false
  if (!state.userMessageId) return false
  /* 关键：必须核对状态自己的会话，不能用当前界面会话代替 */
  if (!state.sessionId) return false
  if (state.sessionId !== sessionId) return false
  return true
}

/* ── 回填缓存的有效期判定 ────────────────────────────────────── */

/**
 * 回填缓存的有效期。
 *
 * <p>存「上次回填时间」而不是一个 done 布尔值：一次成功后永久标记，
 * 会话就**长期看不到后来产生的结果** —— 那些结果可能来自另一个窗口、
 * 后台恢复中的任务，或别的入口，当前页面并没有收到对应的实时写入。</p>
 */
export const BACKFILL_TTL_MS = 30_000

/**
 * 这次进入会话要不要真的去拉一次回填。
 *
 * @param lastBackfillAt 上次成功回填的时间戳；从未回填为 undefined
 * @param now 当前时间
 * @param ttlMs 有效期
 * @returns 是否应发起请求
 */
export function shouldRefetchBackfill(
  lastBackfillAt: number | undefined,
  now: number = Date.now(),
  ttlMs: number = BACKFILL_TTL_MS,
): boolean {
  /* 从没回填过 → 必须拉 */
  if (lastBackfillAt === undefined) return true
  /* 时间戳异常（时钟回拨/脏数据）→ 当作过期，宁可多拉一次也不长期用旧数据 */
  if (!Number.isFinite(lastBackfillAt) || lastBackfillAt > now) return true
  return now - lastBackfillAt >= ttlMs
}

/* ── 回复保存失败的归属判定 ──────────────────────────────────── */

/**
 * 核对服务端是否已保存这条回复的结果 —— **三态**，不能压成两态。
 *
 * <p>把「查完了，确实没有」和「没查成」混为一谈，界面就会在断网时
 * 断言「回复没有存进会话」—— 而那时后端很可能已经自动保存好了。
 * 用户会因此以为回复丢了、去点重试，甚至重发一遍。</p>
 */
export type ReplyLookup =
  /** 找到了：服务端确实有这条回复 */
  | { kind: 'found'; messageId: string; text: string }
  /** 查完了（翻到末页）确实没有 */
  | { kind: 'absent' }
  /** 没查成：网络/接口失败，或翻页上限被触及 —— 结果未知 */
  | { kind: 'unknown'; reason: string }

/**
 * 保存抛错后，这条回复该怎么呈现。
 *
 * <p>**保存失败 ≠ 一定没保存**：后端在创作完成时会自动把回复落库
 * （`syncTaskReplyToSession`），前端那次 POST 失败可能只是重复写入被拒、
 * 或响应没回来。所以不能凭一个异常就断言结果，必须先核对服务端。</p>
 *
 * <p>三种文案必须分开：`absent` 才可以说「没有存进会话」；
 * `unknown` 只能说「无法确认」，且同样给重试入口。</p>
 */
export function resolveReplySaveState(
  lookup: ReplyLookup,
): 'saved' | 'absent' | 'unknown' {
  if (lookup.kind === 'found') return 'saved'
  if (lookup.kind === 'absent') return 'absent'
  return 'unknown'
}

/**
 * 生成「回复未确认保存」时给用户看的说明。
 *
 * @param state 三态判定结果
 * @param cause 原始异常/原因文本（用于补充细节）
 * @returns 说明文案；`saved` 时返回 null（不该显示任何警告）
 */
export function replySaveNotice(
  state: 'saved' | 'absent' | 'unknown',
  cause: string,
): string | null {
  if (state === 'saved') return null
  if (state === 'absent') {
    /* 完整查找过、确实没有：可以明确断言 */
    return `回复没有存进会话（${cause}）。刷新后会看不到这条，请点重试补存。`
  }
  /* 结果未知：绝不能断言没有保存 */
  return `无法确认这条回复是否已存进会话（${cause}）。它可能已经保存，刷新后若看不到请点重试补存。`
}

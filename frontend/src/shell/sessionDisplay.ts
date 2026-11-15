/**
 * 会话在两处界面的**唯一**显示规则：标题、时间、项目归属。
 *
 * <p>为什么需要：同一个会话在完整对话区叫「未命名对话 · 3小时前」，
 * 在工作台侧栏下拉里却叫「用 bash 执行 sleep 30… (17:29)」——
 * 名字不同、时间格式不同，用户切到工作台会以为是两条不同的会话。</p>
 *
 * <p>更严重的一处：侧栏只显示时分，于是 **11 月 6 日 17:29** 和
 * **今天 17:29** 在界面上完全一样（真机确认过）。同一时间产生歧义，
 * 用户无法判断自己在看哪一轮。</p>
 *
 * <p>规则：**标题只认一个来源**（服务端标题，没有才用首条消息生成的标题）；
 * **时间必须能区分日期**（今天给相对时间，跨天给「昨天 / 9月3日」）；
 * **侧栏要能看出会话属于当前项目**。</p>
 */
import type { Session } from './useSessions'

/** 未命名会话的占位标题。两处必须用同一个字符串，否则又会出现「名字不同」。 */
export const UNTITLED_SESSION = '未命名对话'

/**
 * 会话标题。
 *
 * <p>只读 {@code session.title}，不再各处自己拼首句摘要 ——
 * `useSessions` 在创建时已按 `sessionTitle()` 生成过标题，
 * 侧栏再拼一遍就等于有了第二个真相。</p>
 */
export function sessionDisplayTitle(session: Pick<Session, 'title'> | null | undefined): string {
  const t = session?.title?.trim()
  return t && t.length > 0 ? t : UNTITLED_SESSION
}

/** 是否还没被命名（用于决定要不要显示成弱化样式）。 */
export function isUntitledSession(session: Pick<Session, 'title'> | null | undefined): boolean {
  return sessionDisplayTitle(session) === UNTITLED_SESSION
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/**
 * 会话时间 —— **必须能区分日期**。
 *
 * <p>今天的会话给相对时间（「刚刚」「23分钟前」「3小时前」），读起来最直观；
 * 跨天的给「昨天」「9月3日」，因为「17:29」这种只报时分的写法
 * 会让六天前和今天看起来一模一样（真机确认过的缺陷）。</p>
 *
 * @param at 毫秒时间戳
 * @param now 便于测试注入的当前时间
 */
export function sessionTimeLabel(at: number | null | undefined, now: number = Date.now()): string {
  if (!at || !Number.isFinite(at)) return ''
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const nowDate = new Date(now)

  if (!sameDay(d, nowDate)) {
    const yesterday = new Date(now)
    yesterday.setDate(nowDate.getDate() - 1)
    if (sameDay(d, yesterday)) return '昨天'
    /* 同一年不重复写年份；跨年必须写，否则「9月3日」可能是去年的。 */
    return d.getFullYear() === nowDate.getFullYear()
      ? `${d.getMonth() + 1}月${d.getDate()}日`
      : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }

  const diff = Math.max(0, now - at)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  return `${Math.floor(minutes / 60)}小时前`
}

/**
 * 会话时间的完整形态（悬停提示用）。
 *
 * <p>列表里为了紧凑用了相对时间，但用户需要能核对准确时刻 ——
 * 所以任何显示时间的地方都要能拿到这一份完整时间。</p>
 */
export function sessionTimeFull(at: number | null | undefined): string {
  if (!at || !Number.isFinite(at)) return ''
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 侧栏下拉里的一行文字。
 *
 * <p>侧栏只列当前项目的会话，但仍要**明确标出项目**：
 * 多项目用户看到一列会话名，不知道它们属于哪个项目。</p>
 */
export function sessionOptionLabel(
  session: Session,
  projectName: string | null | undefined,
  now: number = Date.now(),
): string {
  const title = sessionDisplayTitle(session)
  const time = sessionTimeLabel(session.updatedAt, now)
  const project = projectName?.trim()
  const head = project ? `${project} · ${title}` : title
  return time ? `${head}（${time}）` : head
}

/**
 * 下拉选项的文字 —— **不重复项目名**。
 *
 * <p>下拉框只有一百多像素宽，而选项要同时装下项目名、会话名和时间。
 * 实测项目名一长，「项目名 · 会话名（时间）」就被截得只剩项目名，
 * 用户反而看不到自己选的是哪条会话。</p>
 *
 * <p>项目归属改在**框外**显示一次（这些会话都属于当前项目），
 * 框内的有限宽度全部留给会话名和时间。悬停仍给带项目的完整标识。</p>
 */
export function sessionOptionText(session: Session, now: number = Date.now()): string {
  const title = sessionDisplayTitle(session)
  const time = sessionTimeLabel(session.updatedAt, now)
  return time ? `${title}（${time}）` : title
}

import type { ReplyLookup } from '@/features/chat/model/roundRestoreRules'
import { studioHttpApi } from '@/api'
import { ApiError, userMessageForError } from '@/api/errors'

/**
 * 核对服务端是否**真的**存下了这一轮的回复 —— 返回三态。
 *
 * <p>判据是「会话里存在一条 taskId 等于这条用户消息 id 的助手消息」——
 * 这正是保存时写入的归属字段，比比对文本可靠（文本可能被截断/改写）。</p>
 *
 * <p>三态缺一不可：把「查完了确实没有」和「没查成」都返回 null，
 * 界面就会在断网时断言「回复没有存进会话」—— 而那时后端很可能已经
 * 自动保存好了。翻页上限被触及也算「没查完」，同样不能当作确实没有。</p>
 */
export const findStoredReply = async (
  sid: string,
  userMessageId: string,
  fallbackText: string,
): Promise<ReplyLookup> => {
  try {
    /* 跟游标翻页：只读第一页会在长会话里漏掉刚存的那条，
       从而把「其实存好了」误判成「没存」。 */
    let cursor: string | undefined
    for (let page = 0; page < 20; page += 1) {
      const res = await studioHttpApi().chat.listMessages(sid, {
        limit: 80,
        ...(cursor ? { cursor } : {}),
      })
      for (const m of res.items ?? []) {
        if (m.role === 'assistant' && m.taskId === userMessageId) {
          return { kind: 'found', messageId: m.id, text: m.text ?? fallbackText }
        }
      }
      cursor = res.nextCursor ?? undefined
      if (!cursor) return { kind: 'absent' }
    }
    /* 翻到上限还没到末页：**没有查完**，不能断言不存在 */
    return { kind: 'unknown', reason: '会话消息过多，未能查完' }
  } catch (err) {
    /* 核对本身失败：结果未知，绝不当作「没有保存」 */
    return {
      kind: 'unknown',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 发送失败的原因（人话优先；网络/未找到/内容不合规各有说法）。 */
export const sendErrorText = (cause: unknown): string => {
  if (cause instanceof ApiError) {
    if (cause.code === 'network_error') return '无法连接本地服务，消息没有发出去。请确认后端已启动。'
    if (cause.code === 'not_found') return '服务端没有找到这条会话，消息没有发出去。'
    if (cause.code === 'validation_error' && cause.message.trim()) return cause.message
    return userMessageForError(cause, '消息没有发出去。')
  }
  return cause instanceof Error ? cause.message : '消息没有发出去。'
}

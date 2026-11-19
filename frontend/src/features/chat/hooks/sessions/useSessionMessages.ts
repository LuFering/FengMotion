import type * as React from 'react'
import { useCallback } from 'react'
import type { ChatMessage as ContractMessage } from '@/api/contracts'
import { studioHttpApi } from '@/api'
import { toViewMessage, type Session } from '@/features/chat/model/sessionMapping'
import { loadSessionExtras } from '@/features/chat/model/sessionStorage'
import { ApiError } from '@/api/errors'
import { messagesErrorMessage, withPeriod } from '@/features/chat/model/sessionErrors'
import type { ChatMessage } from '@/features/chat/hooks/useChat'

export interface UseSessionMessagesArgs {
  commitSessions: (next: Session[] | ((list: Session[]) => Session[])) => void
  loadingMessages: React.RefObject<Set<string>>
  messageRequests: React.RefObject<Map<string, AbortController>>
  mountedRef: React.RefObject<boolean>
  sessionsRef: React.RefObject<Session[]>
}

/** 从 useSessions.ts 的 useSessions 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useSessionMessages({ commitSessions, loadingMessages, messageRequests, mountedRef, sessionsRef }: UseSessionMessagesArgs) {
  /**
   * 读服务端消息历史（GET /chat-sessions/{id}/messages）。
   *
   * 消息按 seq 正序、游标分页（后端 keyset）：这里一路翻到 nextCursor 为空，
   * 与项目/会话列表的翻页口径一致。游标重复说明服务端分页异常，宁可报错也不死循环。
   *
   * 失败不清空已有消息：读失败 ≠ 空会话，界面要能同时显示「已读到的部分」和「没读全」。
   */
  const loadMessages = useCallback(async (sessionId: string, options: { force?: boolean } = {}) => {
    const target = sessionsRef.current.find((s) => s.id === sessionId)
    if (!target || target.origin !== 'server') return
    if (loadingMessages.current.has(sessionId)) return
    // 已读成功且非强制重试：不重复拉（切回同一条会话不该再打一次接口）
    if (!options.force && target.messagesLoaded) return

    loadingMessages.current.add(sessionId)
    messageRequests.current.get(sessionId)?.abort()
    const controller = new AbortController()
    messageRequests.current.set(sessionId, controller)
    commitSessions((list) => list.map((s) => (
      s.id === sessionId ? { ...s, messagesError: undefined } : s
    )))
    try {
      const items: ContractMessage[] = []
      const seen = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await studioHttpApi().chat.listMessages(sessionId, {
          limit: 200,
          cursor,
          signal: controller.signal,
        })
        items.push(...page.items)
        if (page.nextCursor && seen.has(page.nextCursor)) throw new Error('消息分页游标重复')
        if (page.nextCursor) seen.add(page.nextCursor)
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      if (!mountedRef.current) return
      // system 消息不下发展示（契约 §3）；其余按契约顺序原样保留
      const mapped = items.filter((m) => m.role !== 'system').map((m) => toViewMessage(m, sessionId))
      // 按会话严格隔离读取附加回复：只读明确属于当前 sessionId 的记录，杜绝跨会话串味
      const extras = loadSessionExtras(sessionId).filter((m) => m.sessionId === sessionId)
      const combined = [...mapped]
      for (const ex of extras) {
        if (!combined.some((m) => m.id === ex.id)) {
          combined.push(ex)
        }
      }

      combined.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))

      commitSessions((list) => list.map((s) => {
        if (s.id !== sessionId) return s
        /* 没存进服务端的那条首条需求：历史读回来之后仍然要显示，否则它会随着
           「服务端历史为准」被冲掉 —— 那句话就真的从界面上消失了。 */
        const missing = s.unsavedFirst
          ? [{ id: `unsaved-${sessionId}`, role: 'user' as const, text: s.unsavedFirst.text, at: s.updatedAt }]
          : []
        return { ...s, messages: [...missing, ...combined], messagesLoaded: true, messagesError: undefined }
      }))
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'aborted') return
      if (!mountedRef.current) return
      const message = messagesErrorMessage(cause)
      commitSessions((list) => list.map((s) => (
        s.id === sessionId ? { ...s, messagesError: withPeriod(message) } : s
      )))
    } finally {
      loadingMessages.current.delete(sessionId)
      messageRequests.current.delete(sessionId)
    }
  }, [commitSessions])

  /**
   * 发一条消息（支持 user 用户消息或 assistant 助手创作答复）。
   *
   * 顺序是「先让服务端保存，再写进本页」：契约要求不得把没落库的消息显示成已发送。
   * 因此这里不做乐观插入 —— 失败时抛错，调用方显示「没有发出去」，草稿留在输入框里。
   *
   * 幂等：同一次发送的重试必须复用同一个 Idempotency-Key（README §2.7），
   * 否则重试会写出两条一样的用户消息。调用方负责把键带下来。
   */
  const sendMessage = useCallback(async (
    sessionId: string,
    text: string,
    options: {
      idempotencyKey?: string
      role?: 'user' | 'assistant'
      taskId?: string
      attachments?: ContractMessage['attachments']
      references?: ContractMessage['references']
    } = {},
  ): Promise<ChatMessage> => {
    /* 附件只带 fileId 等元信息，不带路径与字节 —— 契约要求消息只引用已上传的附件。
       空数组不传：让请求体保持「没有附件」的形状，而不是一个空列表。 */
    const body = {
      text,
      ...(options.role ? { role: options.role } : {}),
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.references?.length ? { references: options.references } : {}),
      ...(options.attachments && options.attachments.length > 0
        ? { attachments: options.attachments }
        : {}),
    }
    const saved = await studioHttpApi().chat.sendMessage(sessionId, body, {
      idempotencyKey: options.idempotencyKey,
    })
    const view = toViewMessage(saved, sessionId)
    if (mountedRef.current) {
      commitSessions((list) => list.map((s) => {
        if (s.id !== sessionId) return s
        // 同 id 已在列表里（重复提交/刷新竞态）：不重复插入
        if (s.messages.some((m) => m.id === view.id)) return s
        return {
          ...s,
          messages: [...s.messages, view],
          // 服务端已确认这条消息：更新时间以服务端保存的那条为准
          updatedAt: view.at ?? s.updatedAt,
          messageCount: (s.messageCount ?? 0) + 1,
        }
      }))
    }
    return view
  }, [commitSessions])
  return { loadMessages, sendMessage }
}

import type * as React from 'react'
import { useCallback } from 'react'
import { sessionTitle, toSession, type Session } from '@/features/chat/model/sessionMapping'
import { now, makeId } from '@/features/chat/model/sessionStorage'
import { studioHttpApi } from '@/api'
import { withPeriod, messagesErrorMessage, createErrorMessage } from '@/features/chat/model/sessionErrors'
import { ApiError } from '@/api/errors'
import type { CreateSessionInput, CreateSessionResult } from '@/features/chat/hooks/useSessions'

export interface UseSessionCreateArgs {
  begin: () => void
  commitSessions: (next: Session[] | ((list: Session[]) => Session[])) => void
  end: () => void
  loadedRef: React.RefObject<Set<string>>
  mountedRef: React.RefObject<boolean>
  sessionsRef: React.RefObject<Session[]>
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>
  setCreateError: React.Dispatch<React.SetStateAction<string | null>>
  setLoadedProjects: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>
}

/** 会话的新建与重试保存：有项目时在服务端创建，失败或无项目时保留为本页未保存草稿。 */
export function useSessionCreate({ begin, commitSessions, end, loadedRef, mountedRef, sessionsRef, setActiveId, setCreateError, setLoadedProjects }: UseSessionCreateArgs) {
  /**
   * 新建会话：有项目 → 真实创建；无项目 → 本页草稿，明确标「未保存」。
   * 服务端创建失败时返回 `{session:fallback,error}`：会话保留为 origin=local 的
   * 未保存草稿（内容不丢、可重试），绝不冒充变成服务端会话。
   */
  const create = useCallback(async (input: CreateSessionInput): Promise<CreateSessionResult> => {
    const projectId = input.projectId ?? null
    const title = sessionTitle(input.firstText ?? '')
    if (!projectId) {
      const t = now()
      const s: Session = {
        id: makeId(),
        title,
        projectId: null,
        workdir: input.workdir ?? null,
        messages: input.messages ?? [],
        createdAt: t,
        updatedAt: t,
        origin: 'local',
        localNote: '未分组对话仅保存在本页，刷新后不会保留。',
      }
      commitSessions((list) => [s, ...list])
      setActiveId(s.id)
      return { session: s, error: null }
    }

    begin()
    try {
      const created = await studioHttpApi().chat.createSession(projectId, {
        projectId,
        // 空标题交给服务端生成「未命名对话」：不传空串冒充有效标题。
        title: input.firstText ? title : undefined,
      })
      /* 首页带过来的首条需求只在本页存在：会话建好后必须真的存进服务端，
         否则对话视图一读历史就只剩空会话，用户刚写的那段话看起来像丢了。
         存失败时把原文留在 unsavedFirst 里由界面明示，绝不悄悄吞掉。 */
      const first = (input.messages ?? []).filter((m) => m.role === 'user' && m.text.trim())
      let unsavedFirst: Session['unsavedFirst']
      for (const m of first) {
        try {
          // 会话刚建好，服务端还没有任何消息：这里不需要幂等键复用，直接发
          await studioHttpApi().chat.sendMessage(created.id, { text: m.text })
        } catch (cause) {
          unsavedFirst = { text: m.text, error: withPeriod(messagesErrorMessage(cause)) }
          break
        }
      }
      const s: Session = {
        ...toSession(created),
        workdir: input.workdir ?? null,
        // 已存进服务端的消息由 loadMessages 读回；这里只保留没存进去的那条，
        // 不塞第二份 —— 两份不同 id 的同一句话会在对话里显示两次。
        messages: unsavedFirst
          ? [{ id: `unsaved-${created.id}`, role: 'user', text: unsavedFirst.text, at: now() }]
          : [],
        unsavedFirst,
      }
      loadedRef.current.add(projectId)
      setLoadedProjects(new Set(loadedRef.current))
      commitSessions((list) => [s, ...list.filter((x) => x.id !== s.id)])
      setActiveId(s.id)
      if (mountedRef.current) setCreateError(null)
      return { session: s, error: null }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'aborted') {
        return { session: null, error: '请求已取消，会话没有创建。' }
      }
      const message = createErrorMessage(cause)
      if (mountedRef.current) setCreateError(message)
      const t = now()
      // 保留用户刚输入的内容，但明确标「未保存」：origin=local，绝不冒充服务端会话。
      // 左栏提供「重试保存」，成功后才换成服务端 id。
      const fallback: Session = {
        id: makeId(),
        title,
        projectId,
        workdir: input.workdir ?? null,
        messages: input.messages ?? [],
        createdAt: t,
        updatedAt: t,
        origin: 'local',
        localNote: `未保存到服务端：${withPeriod(message)}可在左栏菜单重试保存。`,
      }
      commitSessions((list) => [fallback, ...list])
      setActiveId(fallback.id)
      return { session: fallback, error: message }
    } finally {
      end()
    }
  }, [commitSessions])

  /**
   * 对创建失败的本页草稿重试真实创建。成功时用服务端会话替换本地 id：
   * 本地暂存的消息、置顶/归档偏好一并迁过去；失败保持原会话并更新说明。
   */
  const retryCreate = useCallback(async (sessionId: string): Promise<CreateSessionResult> => {
    const local = sessionsRef.current.find((s) => s.id === sessionId)
    if (!local) return { session: null, error: '要重试的会话不存在。' }
    if (!local.projectId) return { session: local, error: null }
    if (local.origin === 'server') return { session: local, error: null }

    begin()
    try {
      const created = await studioHttpApi().chat.createSession(local.projectId, {
        projectId: local.projectId,
        title: local.title === '未命名对话' ? undefined : local.title,
      })
      const server = toSession(created)
      const next: Session = {
        ...server,
        messages: local.messages,
        workdir: local.workdir,
        pinned: local.pinned,
        archived: local.archived,
        localNote: undefined,
      }
      commitSessions((list) => list.map((s) => (s.id === local.id ? next : s)))
      setActiveId((cur) => (cur === local.id ? next.id : cur))
      loadedRef.current.add(local.projectId)
      setLoadedProjects(new Set(loadedRef.current))
      if (mountedRef.current) setCreateError(null)
      return { session: next, error: null }
    } catch (cause) {
      const message = createErrorMessage(cause)
      if (mountedRef.current) setCreateError(message)
      commitSessions((list) => list.map((s) => (
        s.id === local.id ? { ...s, localNote: `仍未保存到服务端：${withPeriod(message)}` } : s
      )))
      return { session: null, error: message }
    } finally {
      end()
    }
  }, [commitSessions])
  return { create, retryCreate }
}

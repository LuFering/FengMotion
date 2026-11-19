import type * as React from 'react'
import { useCallback } from 'react'
import type { Session } from '@/features/chat/model/sessionMapping'
import { now } from '@/features/chat/model/sessionStorage'
import { studioHttpApi } from '@/api'
import { ApiError } from '@/api/errors'
import { removeErrorMessage } from '@/features/chat/model/sessionErrors'

export interface UseSessionEditingArgs {
  commitSessions: (next: Session[] | ((list: Session[]) => Session[])) => void
  mountedRef: React.RefObject<boolean>
  sessionsRef: React.RefObject<Session[]>
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>
  setRemoveError: React.Dispatch<React.SetStateAction<string | null>>
}

/** 从 useSessions.ts 的 useSessions 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useSessionEditing({ commitSessions, mountedRef, sessionsRef, setActiveId, setRemoveError }: UseSessionEditingArgs) {
  const update = useCallback((id: string, patch: Partial<Omit<Session, 'id'>>) => {
    commitSessions((list) => list.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: now() } : s)))
  }, [commitSessions])

  /**
   * 移除会话。
   *
   * 服务端会话：真的调 DELETE（agent.md §5，204 软删除），**成功之后**才从列表移除。
   * 先移除再删会让「界面上没了、服务端还在」看起来像删成功 —— 失败时用户会以为
   * 刷新一下就会消失，其实它还在。
   * 本地草稿：没有服务端身份，直接丢本页内容。
   */
  const remove = useCallback(async (id: string) => {
    const target = sessionsRef.current.find((s) => s.id === id)
    if (!target) return
    if (target.origin !== 'server') {
      commitSessions((list) => list.filter((s) => s.id !== id))
      setActiveId((cur) => (cur === id ? null : cur))
      return
    }
    try {
      await studioHttpApi().chat.deleteSession(id)
      if (!mountedRef.current) return
      commitSessions((list) => list.filter((s) => s.id !== id))
      setActiveId((cur) => (cur === id ? null : cur))
      setRemoveError(null)
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'aborted') return
      if (!mountedRef.current) return
      // 404 说明服务端本来就没有它：把这一条从列表移除，并说明「不是这次删掉的」
      if (cause instanceof ApiError && cause.code === 'not_found') {
        commitSessions((list) => list.filter((s) => s.id !== id))
        setActiveId((cur) => (cur === id ? null : cur))
      }
      setRemoveError(removeErrorMessage(cause))
    }
  }, [commitSessions])
  return { update, remove }
}

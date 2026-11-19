import type * as React from 'react'
import { useCallback } from 'react'
import { now } from '@/features/chat/model/sessionStorage'
import { studioHttpApi } from '@/api'
import { toMs, type Session } from '@/features/chat/model/sessionMapping'
import { ApiError } from '@/api/errors'
import { detailErrorMessage, withPeriod } from '@/features/chat/model/sessionErrors'

export interface UseSessionMetaArgs {
  commitSessions: (next: Session[] | ((list: Session[]) => Session[])) => void
  mountedRef: React.RefObject<boolean>
  sessionsRef: React.RefObject<Session[]>
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>
}

/** 从 useSessions.ts 的 useSessions 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useSessionMeta({ commitSessions, mountedRef, sessionsRef, setActiveId }: UseSessionMetaArgs) {
  /** 拖拽改归属：仅对本地草稿生效；服务端会话没有改归属端点，不允许伪装。 */
  const moveTo = useCallback((id: string, projectId: string | null) => {
    commitSessions((list) => list.map((s) => (
      s.id === id && s.origin === 'local' ? { ...s, projectId, updatedAt: now() } : s
    )))
  }, [commitSessions])

  /**
   * 采用引擎回传的会话标题。
   *
   * 与用户手动 `rename` 分开：那个只允许本地草稿（服务端没有重命名端点，不能假装保存了）。
   * 这个是引擎已经落库的标题，服务端会话来更新是如实同步，不是伪造。
   */
  const adoptServerTitle = useCallback((id: string, title: string) => {
    const t = title.trim()
    if (!t) return
    commitSessions((list) => list.map((s) => (
      s.id === id ? { ...s, title: t.slice(0, 60) } : s
    )))
  }, [commitSessions])

  /** 重命名会话：仅本地草稿（服务端无重命名端点，不伪造已保存）。 */
  const rename = useCallback((id: string, title: string) => {
    const t = title.trim()
    if (!t) return
    commitSessions((list) => list.map((s) => (
      s.id === id && s.origin === 'local' ? { ...s, title: t.slice(0, 40) } : s
    )))
  }, [commitSessions])

  /** 置顶 / 取消置顶（仅本页视图偏好） */
  const setPinned = useCallback((id: string, pinned: boolean) => {
    commitSessions((list) => list.map((s) => (s.id === id ? { ...s, pinned } : s)))
  }, [commitSessions])

  /** 归档 / 取消归档（仅本页视图偏好）：归档的会话从默认视图里隐去（不删除） */
  const setArchived = useCallback((id: string, archived: boolean) => {
    commitSessions((list) => list.map((s) => (s.id === id ? { ...s, archived } : s)))
    if (archived) setActiveId((cur) => (cur === id ? null : cur))
  }, [commitSessions])

  /**
   * 读服务端会话详情，刷新标题/更新时间/消息计数。
   * 只对 origin=server 的会话生效 —— 未分组草稿没有服务端身份，不能拿本地 id 去问服务端。
   * 失败只标注 `syncError`：列表里已有元数据，界面照常显示，但用户能看到「这份不是最新的」，
   * 而不是把旧数据当权威、也不静默吞掉错误。
   * 不计入全局 loading：这是补充刷新，列表已经在显示；若置 loading，左栏会闪一下
   * 「正在加载对话…」，看起来像列表丢了。
   */
  const syncSession = useCallback(async (sessionId: string): Promise<void> => {
    const local = sessionsRef.current.find((s) => s.id === sessionId)
    if (!local) return
    if (local.origin !== 'server') return
    try {
      const detail = await studioHttpApi().chat.getSession(sessionId)
      if (!mountedRef.current) return
      if (detail.id !== sessionId) {
        // 服务端返回了别的会话：宁可标错，也不把别人的标题/计数贴到当前会话上。
        commitSessions((list) => list.map((s) => (
          s.id === sessionId ? { ...s, syncError: '服务端返回的会话 id 与请求不一致，未采用其内容。' } : s
        )))
        return
      }
      commitSessions((list) => list.map((s) => {
        if (s.id !== sessionId) return s
        return {
          ...s,
          title: detail.title || s.title,
          updatedAt: toMs(detail.updatedAt),
          messageCount: detail.messageCount,
          syncError: undefined,
        }
      }))
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'aborted') return
      if (!mountedRef.current) return
      const message = detailErrorMessage(cause)
      commitSessions((list) => list.map((s) => (
        s.id === sessionId ? { ...s, syncError: withPeriod(message) } : s
      )))
    }
  }, [commitSessions])
  return { moveTo, rename, adoptServerTitle, setPinned, setArchived, syncSession }
}

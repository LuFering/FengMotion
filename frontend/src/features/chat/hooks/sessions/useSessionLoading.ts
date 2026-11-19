import type * as React from 'react'
import { useCallback } from 'react'
import type { ChatSession } from '@/api/contracts'
import { studioHttpApi } from '@/api'
import { toSession, type Session } from '@/features/chat/model/sessionMapping'
import { ApiError } from '@/api/errors'
import { listErrorMessage } from '@/features/chat/model/sessionErrors'

export interface UseSessionLoadingArgs {
  begin: () => void
  commitSessions: (next: Session[] | ((list: Session[]) => Session[])) => void
  end: () => void
  loadedRef: React.RefObject<Set<string>>
  loadingProjects: React.RefObject<Set<string>>
  mountedRef: React.RefObject<boolean>
  projectRequests: React.RefObject<Map<string, AbortController>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setLoadedProjects: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>
}

/** 按项目从服务端读取会话列表并与本页已有会话合并，提供刷新与出错后重读。 */
export function useSessionLoading({ begin, commitSessions, end, loadedRef, loadingProjects, mountedRef, projectRequests, setError, setLoadedProjects }: UseSessionLoadingArgs) {
  /** 拉取某项目的全部会话（翻页直到 nextCursor 为空）。失败保留错误，不清空已有列表。 */
  const loadProject = useCallback(async (projectId: string) => {
    if (loadingProjects.current.has(projectId)) return
    loadingProjects.current.add(projectId)
    projectRequests.current.get(projectId)?.abort()
    const controller = new AbortController()
    projectRequests.current.set(projectId, controller)
    begin()
    if (mountedRef.current) setError(null)
    try {
      const items: ChatSession[] = []
      const seen = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await studioHttpApi().chat.listSessions(projectId, {
          limit: 200,
          cursor,
          signal: controller.signal,
        })
        items.push(...page.items)
        if (page.nextCursor && seen.has(page.nextCursor)) throw new Error('会话分页游标重复')
        if (page.nextCursor) seen.add(page.nextCursor)
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      if (!mountedRef.current) return
      const remote = items.map(toSession)
      // 刷新时保留本页已有的临时消息与置顶/归档状态：
      // · 本地草稿：messages 是本页唯一副本，冲掉就等于丢内容；
      // · 服务端会话：messages 是已读回的历史（messagesLoaded=true），冲掉会让用户
      //   正在看的对话瞬间清空 —— 列表刷新只该更新元数据，不该动消息。
      commitSessions((list) => {
        const localById = new Map(list.map((s) => [s.id, s]))
        const merged = remote.map((s) => {
          const local = localById.get(s.id)
          return local
            ? {
                ...s,
                messages: local.messages,
                messagesLoaded: local.messagesLoaded,
                messagesError: local.messagesError,
                pinned: local.pinned,
                archived: local.archived,
                workdir: local.workdir,
                localNote: local.localNote,
                updatedAt: local.messages.length > 0 ? local.updatedAt : s.updatedAt,
              }
            : s
        })
        const localOnly = list.filter((s) => s.origin === 'local' && s.projectId === projectId)
        const others = list.filter((s) => s.projectId !== projectId)
        return [...merged, ...localOnly, ...others]
      })
      loadedRef.current.add(projectId)
      setLoadedProjects(new Set(loadedRef.current))
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'aborted') return
      if (!mountedRef.current) return
      setError(listErrorMessage(cause))
    } finally {
      loadingProjects.current.delete(projectId)
      projectRequests.current.delete(projectId)
      end()
    }
  }, [commitSessions])

  /**
   * 拉取给定项目（缺省先读项目列表）的会话。
   *
   * 默认只读「还没读过」的项目，避免切视图时重复打请求；
   * `force` 时连读过的项目也重读 —— 必须提供这条路径：会话列表是服务端的快照，
   * 在别处（工作台 / 另一个窗口 / 上一轮对话）新建的会话，只有重读才会出现。
   */
  const refresh = useCallback(async (projectIds?: string[], options?: { force?: boolean }) => {
    const force = options?.force === true
    let ids = projectIds
    if (!ids) {
      try {
        const page = await studioHttpApi().projects.list({ limit: 200 })
        ids = page.items.map((p) => p.id)
      } catch (cause) {
        if (mountedRef.current) setError(cause instanceof Error ? cause.message : '无法加载项目，会话未读取')
        return
      }
    }
    for (const id of ids) {
      if (force || !loadedRef.current.has(id)) await loadProject(id)
    }
  }, [loadProject])

  /** 强制重读某项目（错误重试） */
  const reload = useCallback(async (projectId: string) => {
    loadedRef.current.delete(projectId)
    await loadProject(projectId)
  }, [loadProject])
  return { refresh, reload }
}

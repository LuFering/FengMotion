import { useMemo } from 'react'
import { UNGROUPED } from '@/features/chat/hooks/useSessions'
import type { ConversationProps } from '@/features/chat/Conversation'

export interface UseSessionTreeArgs {
  archiveFilter: 'hide' | 'show' | 'only'
  groupMode: 'project' | 'flat'
  orderMode: 'updated' | 'manual'
  props: ConversationProps
  query: string
}

/** 对话页左栏的会话列表数据：按归档筛选、搜索、排序与分组方式算出分组列表。 */
export function useSessionTree({ archiveFilter, groupMode, orderMode, props, query }: UseSessionTreeArgs) {
  /* 「制作已开始」只认本会话里真的创建过东西（AI 消息带 changes），
     不能拿「左栏选中了某个项目」当依据 —— 那是切换当前项目，不是开始制作 */
  /* ── 左栏数据管线（对齐 dsh：筛选 → 搜索 → 排序 → 分组）──
     1. archiveFilter：隐藏已归档（默认）/ 全部 / 仅已归档
     2. query：按会话名称过滤（大小写不敏感）
     3. orderMode：最近更新 / 手动（手动=用户拖拽后的既有顺序）
        置顶的永远在最前（dsh pinSession 语义）
     4. groupMode：按项目两级 / 单列表 */
  const visibleSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return props.threads.sessions
      .filter((t) => {
        if (archiveFilter === 'hide' && t.archived) return false
        if (archiveFilter === 'only' && !t.archived) return false
        if (q && !t.title.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => {
        if (!!b.pinned !== !!a.pinned) return a.pinned ? -1 : 1
        if (orderMode === 'updated') return b.updatedAt - a.updatedAt
        return 0
      })
  }, [props.threads.sessions, archiveFilter, query, orderMode])

  /**
   * 按项目归组的会话列表。
   *
   * <p>排序不是装饰：左栏混排所有项目的 150 条会话时，用户在「制作能力验证」
   * 里要先在「草稿核验A/B」「tool-persist2」之间找出自己项目的两条。
   * 所以当前项目永远置顶，其余项目按「有没有会话、最近活跃」排，
   * 没有会话的项目沉到后面 —— 但不删除，用户仍能发现并点进去。</p>
   */
  const grouped = useMemo(() => {
    if (groupMode === 'flat') {
      return [{ key: 'flat', projectId: UNGROUPED, sessions: visibleSessions }]
    }
    const groups = props.projects.map((p) => {
      const sessions = visibleSessions.filter((t) => t.projectId === p.id)
      return {
        key: p.id,
        projectId: p.id,
        sessions,
        /* 最近活跃时间：用于把「刚聊过的项目」排在前面。没有会话时为 0。 */
        latest: sessions.reduce<number>((max, t) => {
          /* updatedAt 在本地线程是毫秒数，服务端会话是 ISO 字符串：两种都要认。 */
          const raw = t.updatedAt ?? t.createdAt
          const at = typeof raw === 'number' ? raw : Date.parse(String(raw ?? ''))
          return Number.isFinite(at) && at > max ? at : max
        }, 0),
      }
    })
    const orphans = visibleSessions.filter((t) => !t.projectId || !props.projects.some((p) => p.id === t.projectId))
    if (orphans.length > 0) {
      groups.push({
        key: UNGROUPED,
        projectId: UNGROUPED,
        sessions: orphans,
        latest: orphans.reduce<number>((max, t) => {
          /* updatedAt 在本地线程是毫秒数，服务端会话是 ISO 字符串：两种都要认。 */
          const raw = t.updatedAt ?? t.createdAt
          const at = typeof raw === 'number' ? raw : Date.parse(String(raw ?? ''))
          return Number.isFinite(at) && at > max ? at : max
        }, 0),
      })
    }
    /* 当前项目第一；其余有会话的按最近活跃排；没有会话的垫底。
       同为空项目时保持原顺序（稳定排序），避免列表在刷新后跳动。 */
    const currentId = props.openProject
    return [...groups].sort((a, b) => {
      const aCur = a.projectId === currentId
      const bCur = b.projectId === currentId
      if (aCur !== bCur) return aCur ? -1 : 1
      const aHas = a.sessions.length > 0
      const bHas = b.sessions.length > 0
      if (aHas !== bHas) return aHas ? -1 : 1
      return b.latest - a.latest
    })
  }, [props.projects, props.openProject, visibleSessions, groupMode])

  const noMatches = visibleSessions.length === 0

  return { noMatches, grouped }
}

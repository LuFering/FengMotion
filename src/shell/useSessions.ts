import { useCallback, useState } from 'react'
import type { ChatMessage } from './useChat'

/**
 * 会话（对话线程）—— 「项目 + 对话」两级结构里的第二级。
 *
 * 参考 deepseek-harness 的工作区模型：工作区（这里叫项目）下面挂多个会话；
 * 没有归属的会话落进「未分组」，之后可以拖到某个项目下。
 * 与 dsh 的差别：本产品的项目就是创作者的片子，所以会话的归属字段叫 projectId，
 * 不另造 workspace 概念。
 *
 * ⚠️ 演示适配器语义：会话只存内存，刷新即回到种子状态；
 *    接后端时把这里换成 API（结构不变），见 docs/dev/前后端协议.md。
 */
export interface Session {
  id: string
  /** 会话标题：首条需求截断，用户可改 */
  title: string
  /** 归属项目；null = 未分组 */
  projectId: string | null
  /** 工作目录（用户没选就是 null —— 未分组的会话通常也没有目录） */
  workdir: { label: string; path: string } | null
  /** 会话内容 */
  messages: ChatMessage[]
  /** 置顶：置顶的排在组内最前（同 dsh 的 pinSession） */
  pinned?: boolean
  /** 归档：默认不显示，可在视图选项里筛「显示已归档」（同 dsh 的 archiveSession） */
  archived?: boolean
  createdAt: number
  updatedAt: number
}

/** 未分组在左栏里的虚拟分组 id（不是真项目，永远存在） */
export const UNGROUPED = '__ungrouped__'

let seq = 0
const makeId = () => `s-${Date.now().toString(36)}-${seq++}`

/** 首条需求 → 会话标题：取第一行、去掉只有标点/数字的情况、截断 */
export function sessionTitle(text: string): string {
  const first = text.trim().split('\n')[0] ?? ''
  const usable = first.length >= 2 && !/^[\d\s\p{P}]+$/u.test(first) ? first : ''
  return (usable || '未命名对话').slice(0, 18)
}

const now = () => Date.now()

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  /** 新建会话：可选带归属项目、工作目录、首条消息 */
  const create = useCallback((input: {
    firstText?: string
    projectId?: string | null
    workdir?: { label: string; path: string } | null
    messages?: ChatMessage[]
  }) => {
    const t = now()
    const s: Session = {
      id: makeId(),
      title: sessionTitle(input.firstText ?? ''),
      projectId: input.projectId ?? null,
      workdir: input.workdir ?? null,
      messages: input.messages ?? [],
      createdAt: t,
      updatedAt: t,
    }
    setSessions((list) => [s, ...list])
    setActiveId(s.id)
    return s
  }, [])

  const update = useCallback((id: string, patch: Partial<Omit<Session, 'id'>>) => {
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: now() } : s)))
  }, [])

  const remove = useCallback((id: string) => {
    setSessions((list) => list.filter((s) => s.id !== id))
    setActiveId((cur) => (cur === id ? null : cur))
  }, [])

  /** 拖拽改归属：把会话移进某个项目，或移回未分组 */
  const moveTo = useCallback((id: string, projectId: string | null) => {
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, projectId, updatedAt: now() } : s)))
  }, [])

  /** 重命名会话（空标题回退为「未命名对话」） */
  const rename = useCallback((id: string, title: string) => {
    const t = title.trim()
    if (!t) return
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, title: t.slice(0, 40) } : s)))
  }, [])

  /** 置顶 / 取消置顶 */
  const setPinned = useCallback((id: string, pinned: boolean) => {
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, pinned } : s)))
  }, [])

  /** 归档 / 取消归档：归档的会话从默认视图里隐去（不删除） */
  const setArchived = useCallback((id: string, archived: boolean) => {
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, archived } : s)))
    if (archived) setActiveId((cur) => (cur === id ? null : cur))
  }, [])

  return { sessions, activeId, setActiveId, create, update, remove, moveTo, rename, setPinned, setArchived }
}

export type SessionsState = ReturnType<typeof useSessions>

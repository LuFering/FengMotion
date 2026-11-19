import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage as ContractMessage } from '@/api/contracts'
import type { ChatMessage } from '@/features/chat/hooks/useChat'
import { readLastActiveId, writeLastActiveId, saveSessionExtra } from '@/features/chat/model/sessionStorage'
import { type Session } from '@/features/chat/model/sessionMapping'
import { useSessionMeta } from '@/features/chat/hooks/sessions/useSessionMeta'
import { useSessionMessages } from '@/features/chat/hooks/sessions/useSessionMessages'
import { useSessionEditing } from '@/features/chat/hooks/sessions/useSessionEditing'
import { useSessionCreate } from '@/features/chat/hooks/sessions/useSessionCreate'
import { useSessionLoading } from '@/features/chat/hooks/sessions/useSessionLoading'
export type { Session } from '@/features/chat/model/sessionMapping'
export { UNGROUPED, sessionTitle } from '@/features/chat/model/sessionMapping'

export interface CreateSessionInput {
  firstText?: string
  projectId?: string | null
  workdir?: { label: string; path: string } | null
  messages?: ChatMessage[]
}

/**
 * 创建结果。`error` 有值 = 服务端没有建成；此时 `session` 若是本地草稿也只是
 * 未保存内容，调用方必须显示 error，不得当成功处理。
 */
export interface CreateSessionResult {
  session: Session | null
  error: string | null
}

export interface SessionsState {
  sessions: Session[]
  activeId: string | null
  setActiveId: (id: string | null) => void
  create: (input: CreateSessionInput) => Promise<CreateSessionResult>
  update: (id: string, patch: Partial<Omit<Session, 'id'>>) => void
  /** 移除会话：服务端会话真的删（DELETE，软删除）；本地草稿只丢本页内容。
      返回 Promise：失败时调用方要能显示原因，不能「界面上没了但服务端还在」。 */
  remove: (id: string) => Promise<void>
  /** 删除失败的原因（按会话 id 记：失败的那条会回到列表里并标出原因） */
  removeError: string | null
  clearRemoveError: () => void
  moveTo: (id: string, projectId: string | null) => void
  rename: (id: string, title: string) => void
  /** 采用引擎回传的标题（服务端会话也适用：它是已落库的事实，不是伪造）。 */
  adoptServerTitle: (id: string, title: string) => void
  setPinned: (id: string, pinned: boolean) => void
  setArchived: (id: string, archived: boolean) => void
  /** 拉取给定项目（缺省则先读项目列表）中尚未加载过的会话。
      `force` = 连已加载过的项目也重读：列表是服务端的快照，别处新建的会话
      只有重读才会出现（此前按项目去重，导致「切换项目后新会话永远看不到」）。 */
  refresh: (projectIds?: string[], options?: { force?: boolean }) => Promise<void>
  /** 重新读取某项目（忽略已加载标记，用于重试 / 切换项目时刷新） */
  reload: (projectId: string) => Promise<void>
  /** 对创建失败的本页草稿重试真实创建；成功后用服务端会话替换本页 id。 */
  retryCreate: (sessionId: string) => Promise<CreateSessionResult>
  /** 读服务端会话详情（GET /chat-sessions/{id}），刷新标题/更新时间/消息计数。 */
  syncSession: (sessionId: string) => Promise<void>
  /** 读服务端消息历史（GET /chat-sessions/{id}/messages，翻页取全），装进会话。
      `force` 用于重试；已有内容且已读成功时不重复读。 */
  loadMessages: (sessionId: string, options?: { force?: boolean }) => Promise<void>
  /** 发一条消息（POST /chat-sessions/{id}/messages）。只有服务端返回 202 才写进会话；
      失败时抛错，由调用方显示「没有发出去」。返回服务端确认的那条消息。 */
  sendMessage: (
    sessionId: string,
    text: string,
    options?: {
      idempotencyKey?: string
      role?: 'user' | 'assistant'
      taskId?: string
      attachments?: ContractMessage['attachments']
      references?: ContractMessage['references']
    },
  ) => Promise<ChatMessage>
  /** 保存一条属于该会话的本地附加消息（如工作台完成的 AI 创作答复），使其在 reload 或刷新后依然完整恢复 */
  appendExtraMessage: (sessionId: string, message: ChatMessage) => void
  /** 查询某会话是否正在读取消息 */
  isSessionLoadingMessages: (sessionId: string) => boolean
  /** 是否有会话请求在途 */
  loading: boolean
  /** 最近一次**列表读取**失败的原因；读成功会清空。只装列表错误：
      创建失败有自己的通道（`createError`），否则「新建失败」会被显示成「列表加载失败」。 */
  error: string | null
  /** 最近一次创建/重试保存失败的原因；成功创建后清空，也可由用户手动关闭。 */
  createError: string | null
  clearCreateError: () => void
  /** 已成功读取过列表的项目（用于区分「加载中」与「确实没有会话」） */
  loadedProjects: ReadonlySet<string>
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  /* 初值先读上次打开的那条：刷新后能回到同一会话，草稿才显示得出来。
     真正可用性在会话列表加载完后由下面的恢复逻辑校验（可能已被删除）。 */
  const [activeId, setActiveId] = useState<string | null>(() => readLastActiveId())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [loadedProjects, setLoadedProjects] = useState<ReadonlySet<string>>(() => new Set())
  /** 在途请求计数：并发加载时不让先返回的请求提前关掉 loading */
  const inflight = useRef(0)
  /** 每个项目当前的 AbortController，重复请求/卸载时取消旧请求 */
  const projectRequests = useRef(new Map<string, AbortController>())
  /** 每个会话当前的历史读取 AbortController：切会话时取消上一段，免得旧结果覆盖新会话 */
  const messageRequests = useRef(new Map<string, AbortController>())
  /** 正在读历史的会话，避免 StrictMode / 重复 effect 发起同一请求 */
  const loadingMessages = useRef(new Set<string>())
  /** 正在加载的项目，避免 StrictMode / 重复 effect 发起同一请求 */
  const loadingProjects = useRef(new Set<string>())
  /** 已成功加载过的项目（用 ref 判断，避免闭包读到旧的 state） */
  const loadedRef = useRef(new Set<string>())
  /** 最新的会话列表：重试创建等异步回调要读「此刻」的数据，不能依赖闭包里的旧数组。
      写法是「先写 ref 再 setState」：子组件的 effect 早于父组件执行，所以本 hook 返回后
      紧接着就被调用方 effect 读到的，必须是刚算出来的那份，而不是上一轮渲染的。
      只靠 `useEffect` 同步 ref 会晚一拍：服务端会话刚建好就被对话视图读历史，
      那里查 sessionsRef 找不到，loadMessages 直接静默返回，界面永远停在「正在读取」。 */
  const sessionsRef = useRef<Session[]>([])
  useEffect(() => { sessionsRef.current = sessions }, [sessions])
  /** 写会话列表的唯一入口：保证 state 与 ref 永远一致。 */
  const commitSessions = useCallback((next: Session[] | ((list: Session[]) => Session[])) => {
    const value = typeof next === 'function' ? (next as (list: Session[]) => Session[])(sessionsRef.current) : next
    sessionsRef.current = value
    setSessions(value)
  }, [])

  const mountedRef = useRef(true)

  const begin = () => {
    inflight.current += 1
    if (mountedRef.current) setLoading(true)
  }
  const end = () => {
    inflight.current = Math.max(0, inflight.current - 1)
    if (inflight.current === 0 && mountedRef.current) setLoading(false)
  }

  /** 拉取某项目的全部会话（翻页直到 nextCursor 为空）。失败保留错误，不清空已有列表。 */
  const { refresh, reload } = useSessionLoading({ begin, commitSessions, end, loadedRef, loadingProjects, mountedRef, projectRequests, setError, setLoadedProjects })

  /**
   * 新建会话：有项目 → 真实创建；无项目 → 本页草稿，明确标「未保存」。
   * 服务端创建失败时返回 `{session:fallback,error}`：会话保留为 origin=local 的
   * 未保存草稿（内容不丢、可重试），绝不冒充变成服务端会话。
   */
  const { create, retryCreate } = useSessionCreate({ begin, commitSessions, end, loadedRef, mountedRef, sessionsRef, setActiveId, setCreateError, setLoadedProjects })

  const { update, remove } = useSessionEditing({ commitSessions, mountedRef, sessionsRef, setActiveId, setRemoveError })

  /**
   * 读服务端消息历史（GET /chat-sessions/{id}/messages）。
   *
   * 消息按 seq 正序、游标分页（后端 keyset）：这里一路翻到 nextCursor 为空，
   * 与项目/会话列表的翻页口径一致。游标重复说明服务端分页异常，宁可报错也不死循环。
   *
   * 失败不清空已有消息：读失败 ≠ 空会话，界面要能同时显示「已读到的部分」和「没读全」。
   */
  const { loadMessages, sendMessage } = useSessionMessages({ commitSessions, loadingMessages, messageRequests, mountedRef, sessionsRef })

  /** 拖拽改归属：仅对本地草稿生效；服务端会话没有改归属端点，不允许伪装。 */
  const { moveTo, rename, adoptServerTitle, setPinned, setArchived, syncSession } = useSessionMeta({ commitSessions, mountedRef, sessionsRef, setActiveId })

  useEffect(() => {
    /* StrictMode 会挂载→卸载→再挂载同一组件实例：如果只在卸载时置 false、
       不在挂载时置回 true，开发模式下第一次清理会让后续所有请求结果被丢弃
       （会话永远显示为空，且不报错）。所以挂载时也要恢复。
       清理时把 ref 里的容器取出来再操作：清理函数抓的是「本次挂载」的容器，
       但 ref 本身在重挂载后仍是同一个对象 —— 取快照能避免误用下次挂载的状态。 */
    mountedRef.current = true
    const requests = projectRequests.current
    const loading = loadingProjects.current
    const messageReqs = messageRequests.current
    const loadingMsgs = loadingMessages.current
    return () => {
      mountedRef.current = false
      for (const c of requests.values()) c.abort()
      requests.clear()
      loading.clear()
      // 卸载时取消历史读取：结果已经没人要，留着只会让请求继续跑
      for (const c of messageReqs.values()) c.abort()
      messageReqs.clear()
      loadingMsgs.clear()
    }
  }, [])

  const clearCreateError = useCallback(() => setCreateError(null), [])
  const clearRemoveError = useCallback(() => setRemoveError(null), [])

  const appendExtraMessage = useCallback((sessionId: string, message: ChatMessage) => {
    saveSessionExtra(sessionId, message)
    commitSessions((list) => list.map((s) => {
      if (s.id !== sessionId) return s
      if (s.messages.some((m) => m.id === message.id)) return s
      return {
        ...s,
        messages: [...s.messages, message],
        updatedAt: message.at ?? Date.now(),
      }
    }))
  }, [commitSessions])

  const isSessionLoadingMessages = useCallback((sessionId: string) => {
    return loadingMessages.current.has(sessionId)
  }, [])

  /* 选中变化时记下来：刷新后靠它把用户带回同一条会话。
     包一层而不是在十几处 setActiveId 调用点各写一次，避免漏改。 */
  const selectActiveId = useCallback((id: string | null) => {
    setActiveId(id)
    writeLastActiveId(id)
  }, [])

  /* 这里刻意不做「列表里找不到就清空」的校验：
     会话是按项目懒加载的，某个时刻 sessions 里可能只有别的项目的会话，
     此时清空会把有效的记录误删（实测踩到：刷新后 id 立刻被清掉，
     草稿因此再也接不回来）。找不到就只是 activeThread 为 null，
     界面照常显示「未选中」，不会误导；用户点一下就能选回来。 */

  return {
    sessions, activeId, setActiveId: selectActiveId, create, update, remove, removeError, clearRemoveError,
    moveTo, rename, adoptServerTitle, setPinned, setArchived,
    refresh, reload, retryCreate, syncSession, loadMessages, sendMessage,
    appendExtraMessage, isSessionLoadingMessages,
    loading, error, createError, clearCreateError, loadedProjects,
  }
}

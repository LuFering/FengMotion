import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage as ContractMessage, ChatSession } from '@/types/contracts'
import type { ChatMessage } from './useChat'
import { studioHttpApi } from '@/services/api'
import { ApiError, userMessageForError } from '@/services/api/errors'

/**
 * 会话（对话线程）—— 「项目 + 对话」两级结构里的第二级。
 *
 * 参考 deepseek-harness 的工作区模型：工作区（这里叫项目）下面挂多个会话；
 * 没有归属的会话落进「未分组」，之后可以拖到某个项目下。
 * 与 dsh 的差别：本产品的项目就是创作者的片子，所以会话的归属字段叫 projectId，
 * 不另造 workspace 概念。
 *
 * 数据来源（2026-11-01 接入实况，契约 docs/contracts/agent.md §2）：
 *   · **有项目**的会话：走真实 HTTP。
 *     已接：会话列表、创建、详情、**消息历史读取**（GET /chat-sessions/{id}/messages）、
 *     **发送**（POST /chat-sessions/{id}/messages，202 才算发出）、**删除**（DELETE，软删除）。
 *     未接：SSE 回复。后端端点已就绪但会如实返回 `agent_unavailable`（Agent 进程没接），
 *     所以这类会话发出的消息会保存，但不会得到回复 —— 界面必须说「Agent 未接入」，
 *     不得编造回复，也不得把「已保存」说成「已回复」。
 *   · **无项目（未分组）**的会话：服务端没有这个端点（契约要求会话必须属于项目），
 *     只保留本页草稿并标「仅本页 · 未保存」，**不调用真实创建**。
 *
 * 读失败就是失败：列表加载失败给出错误与重试，不把「没读到」显示成「没有会话」。
 * 不做自动降级：连不上就报错，不悄悄换演示数据。
 */
export interface Session {
  id: string
  /** 会话标题：首条需求截断，用户可改（服务端会话暂无改名端点，只读） */
  title: string
  /** 归属项目；null = 未分组（本页草稿，不落盘） */
  projectId: string | null
  /** 工作目录（用户没选就是 null —— 未分组的会话通常也没有目录） */
  workdir: { label: string; path: string } | null
  /** 会话内容。服务端会话：已从服务端读回并映射成界面形状的历史
      （契约 ChatMessage → 界面 ChatMessage，见 `toViewMessage`）；本地草稿：本页暂存。 */
  messages: ChatMessage[]
  /** 置顶：置顶的排在组内最前（同 dsh 的 pinSession）—— 目前仅本页生效 */
  pinned?: boolean
  /** 归档：默认不显示，可在视图选项里筛「显示已归档」—— 目前仅本页生效 */
  archived?: boolean
  createdAt: number
  updatedAt: number
  /** 会话来源：`server` = 服务端已创建；`local` = 仅本页草稿（未分组） */
  origin: 'server' | 'local'
  /** 服务端消息计数（只读；来自 GET /chat-sessions/{id} 的派生值） */
  messageCount?: number
  /** 消息历史是否已从服务端读回（false = 还没读，或读失败；见 `messagesError`） */
  messagesLoaded?: boolean
  /** 消息历史读取失败的原因；有值 = 下面显示的不是完整历史，不得当成空会话 */
  messagesError?: string
  /** 创建服务端会话时随带的用户消息没存进服务端：原文放在这里，界面必须显示出来。
      不能悄悄丢掉 —— 用户刚写完的话，标题里还留着一半，正文没了最容易被当成丢数据。 */
  unsavedFirst?: { text: string; error: string }
  /** 最近一次「本页暂存」的明确说明，供界面显示；没有则不显示 */
  localNote?: string
  /** 服务端会话详情读取失败的原因（列表里已有元数据，这里只标注不是最新） */
  syncError?: string
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
/** 服务端 ISO 时间 → 本地毫秒；解析失败退回当前时间，避免 NaN 排序 */
const toMs = (iso: string) => {
  const v = Date.parse(iso)
  return Number.isFinite(v) ? v : now()
}

/**
 * 契约消息 → 界面消息。
 *
 * 两边的 `ChatMessage` 同名但不同形状：契约里 role 是 user/assistant/system、时间是 ISO 字符串；
 * 界面里 role 只有 user/ai、时间是毫秒数。这一层映射必须在这里做完 —— 视图里再转一次，
 * 就会出现「有的地方认 role=assistant、有的地方只认 ai」两套判断。
 *
 * system 消息不下发展示（契约 agent.md §3：系统角色只进上下文，不进对话记录）。
 * `demo` 一律为 false：服务端读回来的就是真实持久消息，不能带演示标记。
 */
export function toViewMessage(m: ContractMessage): ChatMessage {
  return {
    id: m.id,
    role: m.role === 'user' ? 'user' : 'ai',
    text: m.text,
    taskId: m.taskId,
    at: toMs(m.createdAt),
    // 工具调用记录随消息读回：这是「切走会话再回来还能看到跑了什么」的唯一来源。
    // 没有调用时保持 undefined，界面上不出现空列表。
    ...(m.toolCalls && m.toolCalls.length > 0 ? { executedTools: m.toolCalls } : {}),
  }
}

function toSession(s: ChatSession): Session {
  return {
    id: s.id,
    title: s.title || '未命名对话',
    projectId: s.projectId,
    workdir: null,
    messages: [],
    createdAt: toMs(s.createdAt),
    updatedAt: toMs(s.updatedAt),
    origin: 'server',
    messageCount: s.messageCount,
    messagesLoaded: false,
  }
}

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

/** 创建失败的展示文案：错误对象的人话优先，空则给稳定兜底。 */
function createErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'network_error') return '无法连接本地服务，会话没有创建。请确认后端已启动。'
    if (cause.code === 'aborted') return '请求已取消，会话没有创建。'
    // not_found 既可能是项目被删，也可能是这个端点还没实现（现骨架就是这样）。
    // 区分不了就不硬说「项目不存在」——两种可能都说，文案尽量短，左栏不占三行。
    if (cause.code === 'not_found') {
      return '会话接口尚未接入，或项目不存在，没有创建。'
    }
    // 统一走 userMessageForError：服务端没给 message 时也不会显示空内容，
    // 且 internal_error 之类不透传技术细节。
    return userMessageForError(cause, '会话没有创建。')
  }
  return cause instanceof Error ? cause.message : '会话没有创建。'
}

/** 列表读取失败的展示文案：读失败就说读失败，不能显示成「没有会话」。 */
function listErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'network_error') return '无法连接本地服务，会话列表没有读到。请确认后端已启动。'
    // 与创建同理：404 分不清「项目被删」还是「会话端点没实现」，两种可能都说。
    if (cause.code === 'not_found') return '会话接口尚未接入，或项目不存在，列表没有读到。'
    return userMessageForError(cause, '会话列表没有读到。')
  }
  return cause instanceof Error ? cause.message : '会话列表没有读到。'
}

/** 详情读取失败的展示文案。不复用通用错误文案：503 在契约里兜底成
    「Agent 服务未连接，任务没有创建」，而这里只是读会话详情，说成任务没创建会误导。 */
function detailErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'network_error') return '无法连接本地服务，会话详情没有读到。请确认后端已启动。'
    if (cause.code === 'not_found') return '服务端没有找到这条会话，可能已被删除。'
    if (cause.code === 'validation_error' && cause.message.trim()) return cause.message
    const id = cause.requestId ? `（请求 ID：${cause.requestId}）` : ''
    return `服务端没有返回会话详情${id}，可稍后重试。`
  }
  return cause instanceof Error ? cause.message : '无法读取会话详情。'
}

/** 消息历史读取失败的展示文案。单独一套：这里失败不等于会话不存在，
    更不能显示成「这条对话是空的」—— 空会话与没读到是两件事。 */
function messagesErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'network_error') return '无法连接本地服务，历史消息没有读到。请确认后端已启动。'
    if (cause.code === 'not_found') return '服务端没有找到这条会话，可能已被删除。'
    if (cause.code === 'validation_error' && cause.message.trim()) return cause.message
    return userMessageForError(cause, '历史消息没有读到。')
  }
  return cause instanceof Error ? cause.message : '历史消息没有读到。'
}

/** 删除失败的展示文案。不复用发送文案：删除不涉及消息内容，
    说成「消息没发出去」会让人以为输入的东西丢了。 */
function removeErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'network_error') return '无法连接本地服务，会话没有删除。请确认后端已启动。'
    if (cause.code === 'validation_error' && cause.message.trim()) return cause.message
    if (cause.code === 'internal_error' && cause.requestId) {
      return `服务端出现未预期错误，会话没有删除（请求 ID：${cause.requestId}）。`
    }
    return '服务端没有确认删除，会话仍保留在列表里。'
  }
  return cause instanceof Error ? cause.message : '会话没有删除。'
}

/** 给一句已经自带句号的错误接续说明，避免「。。」。 */
function withPeriod(text: string): string {
  return /[。！？.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}。`
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
  /** 拉取给定项目（缺省则先读项目列表）中尚未加载过的会话。 */
  refresh: (projectIds?: string[]) => Promise<void>
  /** 重新读取某项目（忽略已加载标记，用于重试） */
  reload: (projectId: string) => Promise<void>
  /** 对创建失败的本页草稿重试真实创建；成功后用服务端会话替换本页 id。 */
  retryCreate: (sessionId: string) => Promise<CreateSessionResult>
  /** 读服务端会话详情（GET /chat-sessions/{id}），刷新标题/更新时间/消息计数。 */
  syncSession: (sessionId: string) => Promise<void>
  /** 读服务端消息历史（GET /chat-sessions/{id}/messages，翻页取全），装进会话。
      `force` 用于重试；已有内容且已读成功时不重复读。 */
  loadMessages: (sessionId: string, options?: { force?: boolean }) => Promise<void>
  /** 发一条用户消息（POST /chat-sessions/{id}/messages）。只有服务端返回 202 才写进会话；
      失败时抛错，由调用方显示「没有发出去」。返回服务端确认的那条消息。 */
  sendMessage: (
    sessionId: string,
    text: string,
    options?: { idempotencyKey?: string; attachments?: ContractMessage['attachments'] },
  ) => Promise<ChatMessage>
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
  const [activeId, setActiveId] = useState<string | null>(null)
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

  /** 拉取给定项目（缺省先读项目列表）中尚未加载过的会话。 */
  const refresh = useCallback(async (projectIds?: string[]) => {
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
      if (!loadedRef.current.has(id)) await loadProject(id)
    }
  }, [loadProject])

  /** 强制重读某项目（错误重试） */
  const reload = useCallback(async (projectId: string) => {
    loadedRef.current.delete(projectId)
    await loadProject(projectId)
  }, [loadProject])

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
      const mapped = items.filter((m) => m.role !== 'system').map(toViewMessage)
      commitSessions((list) => list.map((s) => {
        if (s.id !== sessionId) return s
        /* 没存进服务端的那条首条需求：历史读回来之后仍然要显示，否则它会随着
           「服务端历史为准」被冲掉 —— 那句话就真的从界面上消失了。 */
        const missing = s.unsavedFirst
          ? [{ id: `unsaved-${sessionId}`, role: 'user' as const, text: s.unsavedFirst.text, at: s.updatedAt }]
          : []
        return { ...s, messages: [...missing, ...mapped], messagesLoaded: true, messagesError: undefined }
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
   * 发一条用户消息。
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
    options: { idempotencyKey?: string; attachments?: ContractMessage['attachments'] } = {},
  ): Promise<ChatMessage> => {
    /* 附件只带 fileId 等元信息，不带路径与字节 —— 契约要求消息只引用已上传的附件。
       空数组不传：让请求体保持「没有附件」的形状，而不是一个空列表。 */
    const body = {
      text,
      ...(options.attachments && options.attachments.length > 0
        ? { attachments: options.attachments }
        : {}),
    }
    const saved = await studioHttpApi().chat.sendMessage(sessionId, body, {
      idempotencyKey: options.idempotencyKey,
    })
    const view = toViewMessage(saved)
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

  return {
    sessions, activeId, setActiveId, create, update, remove, removeError, clearRemoveError,
    moveTo, rename, adoptServerTitle, setPinned, setArchived,
    refresh, reload, retryCreate, syncSession, loadMessages, sendMessage,
    loading, error, createError, clearCreateError, loadedProjects,
  }
}

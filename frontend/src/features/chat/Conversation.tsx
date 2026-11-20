import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Menu01 } from '@untitledui/icons'
import { useHarnessSelection, setHarnessSelection } from '@/features/harness/hooks/useHarnessSelection'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { JobPanel } from '@/features/chat/components/JobPanel'
import { SubagentBadge } from '@/features/chat/components/SubagentBadge'
import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import { registerComposer, type DeliverableAsset } from '@/features/assets/hooks/usePendingAssets'
import { studioHttpApi } from '@/api'
import { chatStreamManager } from '@/features/chat/services/chatStreamManager'
import { loadPrefs, type ModelPrefs } from '@/features/harness/model/harnesses'
import type { ChatState, ChatMessage } from '@/features/chat/hooks/useChat'
import { sessionTitle, type SessionsState } from '@/features/chat/hooks/useSessions'
import { chatApi, hydrateDemoChat } from '@/features/chat/services/chatService'
import type { NewProjectInput } from '@/features/project/hooks/useProjects'
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { ViewSwitch } from '@/shared/components/ViewSwitch'
import type { ProjectSummary } from '@/features/project/model/projects'
import { setSessionDraft } from '@/features/chat/hooks/useDraftStore'
import { prepareCreationEntry } from '@/features/creation/services/creationEntry'
import { useRoundOutcomes } from '@/features/chat/model/roundOutcomes'
import { backfillRoundOutcomes } from '@/features/chat/services/roundOutcomeBackfill'
import { messagesForSession } from '@/features/chat/model/conversationRound'
import { DRAFT_SESSION, usableName, MODULE_SERVED_IDS, MODULE_FAILED_IDS } from '@/features/chat/model/conversationSession'
import { useComposerFiles } from '@/features/chat/hooks/composer/useComposerFiles'
import { useSendMessage } from '@/features/chat/hooks/reply/useSendMessage'
import { useServerReply } from '@/features/chat/hooks/reply/useServerReply'
import { useComposerModel } from '@/features/chat/hooks/composer/useComposerModel'
import { usePresence } from '@/features/chat/hooks/sidebar/usePresence'
import { useSessionTree } from '@/features/chat/hooks/sidebar/useSessionTree'
import { useSidebarUi } from '@/features/chat/hooks/sidebar/useSidebarUi'
import { useReplyStreamState } from '@/features/chat/hooks/reply/useReplyStreamState'
import type { ComposerAttachment } from '@/features/chat/model/composerAttachment'
import { ConversationComposerSeat } from '@/features/chat/components/conversation/ConversationComposerSeat'
import { ProjectTile } from '@/shared/components/ProjectTile'
import { isUntitledSession, sessionDisplayTitle } from '@/features/chat/model/sessionDisplay'
import { ConversationThread } from '@/features/chat/components/conversation/ConversationThread'
import { useScrollFollow } from '@/features/chat/hooks/thread/useScrollFollow'
import { ConversationSidebar } from '@/features/chat/components/conversation/ConversationSidebar'
import '@/features/chat/styles/conversation.css'

export interface ConversationProps {
  overviewOpen?: boolean
  onOverviewChange?: (open: boolean) => void
  projectOverview?: ReactNode
  chat: ChatState
  projects: ProjectSummary[]
  openProject: string | null
  onSelectProject: (id: string) => void
  /** 左栏直建项目（dsh workspace.create 语义：不弹表单，建完就地改名） */
  onNewProject: () => Promise<{ id: string; name: string }>
  /** 左栏行内改名（Enter/失焦提交，Esc 放弃） */
  onRenameProject?: (id: string, name: string) => Promise<void>
  onCreateProject: (input: NewProjectInput) => Promise<{ id: string }>
  projectsLoading: boolean
  projectsError: string | null
  onRefreshProjects: () => void
  /** 会话列表读取失败的原因（左栏区分「没有会话」与「没读到」） */
  sessionsError: string | null
  onRetrySessions: () => void
  onOpenWorkbench: (sessionId?: string | null) => void
  /** 会话树（项目 + 对话两级）：左栏用它，拖拽改归属也走它 */
  threads: SessionsState
  /** 当前会话 id；null = 还没有会话（从空白进入） */
  activeSessionId: string | null
  homeTransfer?: { sessionId: string; draft: string; files: { file: File; kind: 'file' | 'image' | 'video' }[]; intent: 'create' | 'chat' } | null
  onHomeTransferConsumed?: () => void
  /** 归档项目：移出列表，项目目录与成片保留在磁盘上。 */
  onArchiveProject?: (projectId: string) => Promise<void>
  /** 删除项目：物理删除，项目目录与成片一并删掉，不可撤销。
      返回 Promise 是为了让失败能落到左栏的错误提示，而不是静默关掉对话框。 */
  onDeleteProject?: (projectId: string) => Promise<void>
}

export function Conversation(props: ConversationProps) {
  const { chat } = props
  const [projectPending, setProjectPending] = useState(false)
  const submissionInFlight = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const preparedEmptyProject = useRef<string | null>(null)
  const [entryNote, setEntryNote] = useState<{ sessionId: string | null; text: string } | null>(null)
  /** 新建项目/开始制作失败（服务端拒绝/连不上）：明确的错误，不做乐观成功 */
  const [projectError, setProjectError] = useState<string | null>(null)
  const showProjectError = (error: unknown) => setProjectError(error instanceof Error ? error.message : '项目操作失败')
  /** 服务端会话发送失败的原因（没有发出去）：显示在输入框上方，草稿保留可重试 */
  const [sendError, setSendError] = useState<string | null>(null)
  /** 服务端回复的如实说明（Agent 未接入等）：显示在最后一条用户消息下方。
      与 `failed` 分开：能力缺口不是「回复失败」，重试也不会好。 */
  const [replyNote, setReplyNote] = useState<string | null>(null)
  /** 最后一轮没有完成、也没有回复（后端重启过）：显示「重新执行」，由用户决定要不要再跑 */
  const [unfinishedReply, setUnfinishedReply] = useState(false)
  /**
   * 「创作回复确认没存进会话」的待补存信息。
   *
   * <p>保存失败时不能只写控制台：后端可能已自动落库、也可能没有，
   * 单凭异常无法断言。核对服务端后确认没有，才记在这里 ——
   * 界面据此显示可见状态并提供重试，与回复落库的既有恢复机制一致。</p>
   */
  const [replySaveRetry, setReplySaveRetry] = useState<{
    sessionId: string
    userMessageId: string
    reply: string
    localId: string
  } | null>(null)
  /* 同一次发送重试复用同一个幂等键（README §2.7）；发送成功后清空 */
  const idemKeyRef = useRef<string | null>(null)
  /**
   * 幂等键绑定的正文。
   *
   * <p>为什么要记：幂等键的契约是「同一份内容重复提交复用同一个键」。
   * 但用户改了字再发，内容已经不是同一份了 —— 继续复用旧键，
   * 后端会以「幂等键已用于不同请求」拒绝（实测复现）。
   * 所以键必须与内容绑定：内容一变就换新键。</p>
   */
  const idemTextRef = useRef<string | null>(null)
  /* 卸载后不再回写状态：发送/回复的异步回调可能晚于卸载到达 */
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const { loadMessages, pending, setPending, setPendingStartedAt, breakdown, contextUsed, contextWindow, toolsTokens, clearRoundTrace, deliverablesRef, setAgentPhase, setBreakdown, setContextUsed, setContextWindow, setJobs, setStopping, setToolsTokens, setUsage, jobs, agentPhase, pendingStartedAt, stopping } = useReplyStreamState({ chat, props, setReplyNote })
  /* dsh 响应式：1024 以下左栏自动收为 56px 轨，手动展开为覆盖式抽屉 */
  const { archiveFilter, groupMode, orderMode, query, sideOpen, setEditing, setEditText, setCollapsedGroups, setSideOpen, setQuery, viewMenu, setViewMenu, setRowMenu, setGroupMode, setOrderMode, setArchiveFilter, collapsedGroups, dragId, setDropTarget, setDragId, editing, editText, dropTarget, rowMenu, setArchivingProject, setDeleteConfirmText, setDeletingProject, archivingProject, deletingBusy, confirmArchiveProject, deletingProject, deleteConfirmText, confirmDeleteProject } = useSidebarUi({ props, setProjectError, showProjectError })

  /* ── 输入区工具栏（对齐 dsh InputBar：左侧附件/权限，右侧模型/发送）──
     attachments=待发送附件；permission=权限模式（dsh preset.readOnly/workspaceWrite/fullAccess）；
     harnessId/model/prefs=引擎与模型配置（与首页共用同一份 data/harnesses）；
     composerMenu=当前展开的弹层（'add' 附件菜单 / 'perm' 权限 / 'model' 模型） */
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const activeSessionRef = useRef(props.activeSessionId)
  activeSessionRef.current = props.activeSessionId
  const engineSelection = useHarnessSelection()
  const harnessId = engineSelection.harness
  const setHarnessId = (harness: string) => setHarnessSelection({ harness, model: undefined, reasoningEffort: undefined })
  const model = engineSelection.model ?? ''
  const setModel = (model: string) => setHarnessSelection({ model })
  const thinking = engineSelection.reasoningEffort ?? null
  const setThinking = (reasoningEffort: string) => setHarnessSelection({ reasoningEffort })
  const [prefs, setPrefs] = useState<Record<string, ModelPrefs>>(loadPrefs)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  /* 已经排过回复的用户消息 id：防止同一条被排两次（重挂载 / 增量刷新）。
     必须是模块级：组件卸载（切去工作台）后 useRef 会重建，
     续流时就分不清「这条已经在跑」还是「还没开始」，会重复起流。 */
  const servedRef = MODULE_SERVED_IDS
  /* 当前回复流的退订函数：切会话或卸载时用它断线 */
  const streamStopRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /* 待发送 → 本输入框。注册期间才接受投递；离开这个视图就注销，
     免得在素材库里点「添加到对话」时被投到一个看不见的输入框里。 */
  useEffect(() => {
    registerComposer((list: DeliverableAsset[]) => {
      const existing = new Set(attachmentsRef.current.map((a) => a.assetId).filter(Boolean))
      const incoming = list.filter((item) => !existing.has(item.assetId))
      if (attachmentsRef.current.length + incoming.length > 6) {
        setSendError('输入框最多添加 6 个附件，请先移除部分附件再试。')
        return false
      }
      setAttachments((prev) => {
        const have = new Set(prev.map((a) => a.assetId).filter(Boolean))
        const add = list
          .filter((x) => !have.has(x.assetId))
          .map((x) => ({
            name: x.name,
            size: 0,
            kind: x.kind,
            purpose: x.purpose,
            note: x.note,
            assetId: x.assetId,
            /* 把资源类型与参考/技法参数一并带上。
               只带名字的话，agent 拿到的是一句看不懂的话，
               用户选了「借鉴节奏但别用画面」也无从表达。 */
            source: x.source ?? 'asset',
            refVideoId: x.refVideoId,
            refStart: x.refStart,
            refEnd: x.refEnd,
            refWants: x.refWants,
            fxId: x.fxId,
            fxVersion: x.fxVersion,
          }))
        return [...prev, ...add]
      })
      return true
    })
    return () => registerComposer(null)
  }, [])

  /* 会话 ⇄ 当前对话的双向同步：
     - 切到另一条会话：把它的消息装进 chat（正在思考中不切，避免丢回复）
     - 当前对话有新消息：写回这条会话（左栏顺序、后续拖拽都以它为准） */
  const loadedRef = useRef<string | null>(null)
  /* 装载会话后的第一次写回必须跳过：
     切换会话时 replaceMessages 是本轮 effect 里排的队，写回 effect 在同一个 commit
     里读到的 chat.messages 还是**上一条会话**的 —— 直接写就会把旧内容盖进新会话。 */
  const skipWriteRef = useRef(false)
  /** 当前会话是否来自服务端。服务端会话：消息历史与发送都走真实接口；
      回复（SSE）后端已就绪但 Agent 未接入，会如实返回 agent_unavailable，
      所以这类会话不发演示回复 —— 演示回复只能属于「仅本页」的草稿会话。 */
  const activeThread = props.threads.sessions.find((t) => t.id === props.activeSessionId) ?? null
  const activeIsServer = activeThread?.origin === 'server'
  const sessionDraft = useSessionDraft(activeThread?.projectId, props.activeSessionId)
  /* 「本轮未改动工程」按轮次读共享 store —— 与工作台侧栏同一份数据 */
  const getRoundOutcome = useRoundOutcomes(activeThread?.projectId, props.activeSessionId)

  /* 历史轮次回填：对话区自己也要能恢复历史结论。
     只读共享 store 而不回填的话，直接打开对话区（没经过工作台）时，
     刷新前的轮次结论一条都不会出现。按「项目 + 会话」拉，逐条核对身份后写入。

     还有一件事：**只补结论不补消息是不够的**。结论要挂到「那条回复」上，
     而外部（另一个窗口 / 后台恢复中的任务）产生的轮次，本页消息列表里
     根本没有 —— 界面会因为找不到可挂载的回复而什么都不显示。
     所以发现服务端有本页没有的轮次时，强制重拉一次消息。 */
  /* 最新消息列表的引用：回调是异步到达的，闭包里直接读 `messages` 会拿到
     挂载那一刻的旧值（此时甚至还没定义），判断「本页有没有这条」就会永远为否。 */
  const messagesLiveRef = useRef<ChatMessage[]>([])
  useEffect(() => {
    messagesLiveRef.current = chat.messages
  }, [chat.messages])

  useEffect(() => {
    const pid = activeThread?.projectId
    const sid = props.activeSessionId
    if (!pid || !sid || !activeIsServer) return
    void backfillRoundOutcomes(pid, sid, {
      onRoundsFound: (userMessageIds) => {
        /* 只认「本页确实没有」的：已存在的轮次不该触发重拉，
           否则每次进入都会白打一次接口。 */
        const known = new Set(
          messagesLiveRef.current.map((m) => m.taskId).filter(Boolean) as string[],
        )
        const missing = userMessageIds.filter((id) => !known.has(id))
        if (missing.length > 0) void loadMessages(sid, { force: true })
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.projectId, props.activeSessionId, activeIsServer])

  // 维护当前会话 key 与切换保护锁，严格防止切换会话时旧会话附件被异步写入新草稿
  const prevSessionKeyRef = useRef(sessionDraft.key)
  const isSwitchingSessionRef = useRef(false)

  // 切换会话时，从 sessionDraft 恢复未发送附件
  useEffect(() => {
    isSwitchingSessionRef.current = true
    prevSessionKeyRef.current = sessionDraft.key
    setAttachments(sessionDraft.draft.attachments || [])
    const timer = setTimeout(() => {
      isSwitchingSessionRef.current = false
    }, 0)
    return () => clearTimeout(timer)
  }, [sessionDraft.key])

  // 附件变化时同步回 sessionDraft 内存库（保留原生 File 对象）
  // 严格隔离：仅在非切换会话期间，且当前 key 匹配时允许写回当前草稿，依赖项精简杜绝多余刷新
  const { updateDraft, key: draftSessionKey } = sessionDraft
  useEffect(() => {
    if (isSwitchingSessionRef.current) return
    if (prevSessionKeyRef.current !== draftSessionKey) return
    updateDraft({ attachments })
  }, [attachments, draftSessionKey, updateDraft])

  // 实时获取当前会话所属项目的最新工程版本，用于过期警示核验（支持会话切换与窗口激活实时校准）
  const [stageLeadVersion, setStageLeadVersion] = useState<number | null>(null)
  /* 当前工程版本号 —— 取**场景版本**（后端权威），不是创作状态里的 version。
     两者含义不同：creation.version 是那轮创作产出的版本，工程可能又往前走了。
     读不到就保持 null，界面据此降级（不拿别的数字顶替）。 */
  const refreshProjectVersion = useCallback(() => {
    const pid = activeThread?.projectId
    if (!pid) {
      setStageLeadVersion(null)
      return
    }
    studioHttpApi().task.currentScene(pid)
      .then((state) => {
        /* initialized 为 false 时后端也会给 version: 0 —— 0 不是版本号，
           不能当成「当前工程版本 v0」传给胶囊。 */
        if (state?.initialized && typeof state.version === 'number') {
          setStageLeadVersion(state.version)
        } else {
          setStageLeadVersion(null)
        }
      })
      .catch(() => setStageLeadVersion(null))
  }, [activeThread?.projectId])

  useEffect(() => {
    refreshProjectVersion()
    window.addEventListener('focus', refreshProjectVersion)
    return () => window.removeEventListener('focus', refreshProjectVersion)
  }, [refreshProjectVersion, activeThread?.id])
  /* 进服务端会话时读一次详情（GET /chat-sessions/{id}），用服务端的最新标题/更新时间/
     消息计数校准列表里的那份。只补读一次：这是补充刷新，不是数据来源 —— 失败时列表
     里的元数据照常显示，只是标出「不是最新」，由用户决定要不要重试。 */
  const syncedRef = useRef(new Set<string>())
  const syncSession = props.threads.syncSession
  const activeThreadId = activeThread?.id ?? null
  useEffect(() => {
    if (!activeThreadId || activeThread?.origin !== 'server') return
    if (syncedRef.current.has(activeThreadId)) return
    syncedRef.current.add(activeThreadId)
    void syncSession(activeThreadId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, activeThread?.origin, syncSession])
  const retrySync = () => {
    if (!activeThreadId) return
    syncedRef.current.delete(activeThreadId)
    void syncSession(activeThreadId)
  }
  /* 进服务端会话时读历史消息（GET /chat-sessions/{id}/messages）。
     与详情分开读：详情只补元数据，历史失败不能拖累标题/时间的刷新，反之亦然。
     已读过的不重复读（hook 内部也判断 messagesLoaded，这里先判断是为了少发一次 effect）。 */
  const activeMessagesLoaded = activeThread?.messagesLoaded === true
  useEffect(() => {
    if (!activeThreadId || activeThread?.origin !== 'server') return
    if (activeMessagesLoaded) return
    void loadMessages(activeThreadId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, activeThread?.origin, activeMessagesLoaded, loadMessages])
  const retryMessages = () => {
    if (!activeThreadId) return
    void loadMessages(activeThreadId, { force: true })
  }
  /* 服务端会话的 chat 内容以「会话里的服务端消息」为准：历史读取完成、发送被确认，
     都会换掉那个数组。记住上一次装进 chat 的数组身份，变了就重新装一次 ——
     用身份而不是长度判断，因为消息可能被替换而条数不变。
     正在流式产出的回复占位不在服务端消息里，必须原样保留，否则每次发消息都会把
     刚起的「正在回复…」冲掉。
     （Agent 接入后，`completed` 的回复也是服务端消息：届时在这里补一次
      `loadMessages(force)` 把它读回来即可，不需要另存一份。） */
  const serverMirrorRef = useRef<ChatMessage[] | null>(null)
  useEffect(() => {
    if (!activeThread) return
    if (activeThread.origin === 'server') {
      if (serverMirrorRef.current === activeThread.messages) return
      serverMirrorRef.current = activeThread.messages
      loadedRef.current = activeThread.id
      const inFlight = messagesForSession(chat.messages, activeThread.id, true).filter((m) => m.streaming)
      const next = [...activeThread.messages]
      for (const m of inFlight) if (!next.some((x) => x.id === m.id)) next.push(m)
      chat.replaceMessages(next)
      return
    }
    if (pending) return
    serverMirrorRef.current = null
    if (loadedRef.current === activeThread.id) return
    loadedRef.current = activeThread.id
    skipWriteRef.current = true
    /* 一律换成该会话的消息（空会话就清空）：否则从有消息的会话切到服务端空会话时，
       上一条会话的内容会留在下面，看起来像服务端读回来的。 */
    chat.replaceMessages(activeThread.messages)
    if (activeThread.messages.length > 0) {
      /* 把既有历史交给演示适配器：不给它的话，这条会话会被当成第一轮，
         用户早就答过的信息会被再问一遍 —— 正好违反「只在必要时提问」。 */
      hydrateDemoChat(activeThread.id, activeThread.messages.map((m) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        text: m.text,
      })))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id, activeThread?.origin, activeThread?.messages, pending])

  /* 仅在会话真正改变（从 session A 切换至 session B）时断掉旧会话的回复流；
     切视图（如切至工作台）属于同一个会话，流由 chatStreamManager 全局托管，绝不断流！ */
  const activeSessionIdRef = useRef(props.activeSessionId)
  useEffect(() => {
    const prevSid = activeSessionIdRef.current
    if (prevSid && prevSid !== props.activeSessionId) {
      /* 切走会话只做本地清理，**不**再请求后端停止。
         理由：切换会话不等于放弃那条回复 —— 它由 chatStreamManager 全局托管，
         切回来还能看到结果；贸然停掉会让用户切个页就丢掉正在生成的回答。
         真正的停止只由用户显式点击触发（那里会打 /stop）。
         另外这里原先同时调用 stop(prevSid) 与 streamStopRef.current（内部也调 stop），
         一次切换会发出两次停止请求 —— 现已去掉。 */
      streamStopRef.current = null
      setPending(false)
      setReplyNote(null)
      setUnfinishedReply(false)
      setSendError(null)
      idemKeyRef.current = null
      idemTextRef.current = null
    }
    activeSessionIdRef.current = props.activeSessionId
  }, [props.activeSessionId])
  useEffect(() => {
    if (!props.activeSessionId) return
    if (loadedRef.current !== props.activeSessionId) return
    const mine = chat.messages.filter((m) => m.id !== 'intro')
    /* 先判断「是否需要写回」，再消费 skip 标记：空会话没有可写的内容，
       不能把标记吃掉，否则下一次真实装载会被误写。 */
    if (mine.length === 0) { skipWriteRef.current = false; return }
    if (skipWriteRef.current) { skipWriteRef.current = false; return }
    const t = props.threads.sessions.find((x) => x.id === props.activeSessionId)
    /* 服务端会话的消息不能写回会话对象：消息已经由 sendMessage 在服务端确认后写入，
       这里再写一遍会用「界面上的数组」覆盖它（还会顺手改 updatedAt，让左栏时间乱跳）。
       写回只服务于本地草稿 —— 它们的 messages 是本页唯一副本。 */
    if (t?.origin === 'server') return
    if (t && t.messages.length === mine.length) return
    /* 标题：会话还是「未命名对话」时，用首条需求补上（之后不覆盖用户/既有标题） */
    const firstUser = mine.find((m) => m.role === 'user')
    const patch: { messages: typeof mine; title?: string } = { messages: mine }
    if (firstUser && (!t || t.title === '未命名对话')) patch.title = sessionTitle(firstUser.text)
    props.threads.update(props.activeSessionId, patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages, props.activeSessionId])

  /* 工作台对话 tab 的 intro 免责句不属于创作会话，对话视图里滤掉 */
  const messages = useMemo(() => messagesForSession(chat.messages, props.activeSessionId, activeIsServer), [chat.messages, props.activeSessionId, activeIsServer])
  /**
   * 当前这轮实时推理的文本。
   *
   * 推理是「边想边说」的：帧到达时 AI 消息的 text 还是空的，thinking 已经有内容。
   * 所以取最后一条 AI 消息的 thinking，而不是等整轮结束。
   */

  /**
   * 本轮推理的最终文本。
   *
   * 与 streamingThinking 分开：那个只在「最后一条是 AI 且还在流」时有值，
   * 一轮结束后就变空 —— 于是「思考」任务会从列表里消失，用户再也看不到
   * 这一轮想过什么。这里取本轮所有 AI 消息的 thinking 中最后一段非空的，
   * 让结束后仍可回看（与历史路径的呈现一致）。
   */
  const userMessages = useMemo(() => messages.filter((m) => m.role === 'user'), [messages])

  /* 最新的用户消息 id：回复 effect 只依赖它（见下方说明，不能依赖整个数组） */
  const lastUserId = userMessages.length > 0 ? userMessages[userMessages.length - 1].id : null

  /** 起一条演示回复流（只属于本页草稿）。返回退订函数：退订 = 断线，不当作完成。 */
  const startReply = () => {
    const serviceSessionId = props.activeSessionId ?? DRAFT_SESSION
    const aiId = chat.startAiMessage()
    let settled = false
    /* 这条流有没有真的产出内容。没有产出就必须把占位撤掉 ——
       留着就是一个空的「正在回复…」，看起来像卡死。 */
    let produced = false
    const stop = chatApi.stream(serviceSessionId, (msg) => {
      switch (msg.type) {
        case 'delta':
          produced = true
          chat.appendAiText(aiId, msg.delta)
          break
        case 'completed':
          /* completed 带最终完整文本，以它为准（覆盖已拼接的），见契约 §4 */
          produced = true
          chat.finishAiMessage(aiId, msg.message.text)
          break
        case 'error':
          settled = true
          /* 已经吐出来的半截文本留着并标明失败：不删（那是真实收到的），也不当完成 */
          chat.failAiMessage(aiId, msg.error.message)
          setPending(false)
          break
        case 'task':
          /* 演示适配器不建任务；真后端出现 taskId 时由任务流另行订阅，不塞进对话流 */
          break
        case 'end':
          settled = true
          setPending(false)
          if (!produced) chat.removeMessage(aiId)
          break
      }
    })
    streamStopRef.current = stop
    return () => {
      stop()
      if (settled) return
      /* 中断：撤掉没说完的那条 —— 半截文本既不当成回复留着，也不当成「已回复」。
         但**不撤销 servedRef 的登记**：切去工作台会让本视图卸载，
         若在这里撤登记，重挂载就分不清「这轮还在跑、只是看不见」，
         会再起一条流，用户回来看到两条重复回复。
         续流由上面那个 effect 按「有没有 AI 回复」判断，不需要靠撤销登记来触发。 */
      chat.removeMessage(aiId)
      setPending(false)
    }
  }
  const firstBrief = userMessages[0]?.text ?? ''
  const currentProject = props.projects.find((p) => p.id === props.openProject) ?? null
  /* 标题优先用当前项目名：左栏选项目之后，这里应该跟着变，
     否则用户会不知道现在聊的是哪一支片子 */
  const title = currentProject?.name ?? (usableName(firstBrief).slice(0, 14) || '未命名创作')
  const headTitle = activeThread && !isUntitledSession(activeThread) ? sessionDisplayTitle(activeThread) : title

  /**
   * 当前会话的全部工具调用（历史 + 本轮实时）。
   *
   * 子代理徽标要从这里判断「有没有在跑的」。两条来源都要：
   * 历史消息里的（切回来还能看到）+ 正在流式接收的（刚派出去的）。
   * 流式那批不进 messages，只活在 chat.toolCalls 里。
   */
  const activeSubagentTools = [
    ...messages.flatMap((m) => m.executedTools ?? []),
  ]
  /* 「制作已开始」只认本会话里真的创建过东西（AI 消息带 changes），
     不能拿「左栏选中了某个项目」当依据 —— 那是切换当前项目，不是开始制作 */
  /* ── 左栏数据管线（对齐 dsh：筛选 → 搜索 → 排序 → 分组）──
     1. archiveFilter：隐藏已归档（默认）/ 全部 / 仅已归档
     2. query：按会话名称过滤（大小写不敏感）
     3. orderMode：最近更新 / 手动（手动=用户拖拽后的既有顺序）
        置顶的永远在最前（dsh pinSession 语义）
     4. groupMode：按项目两级 / 单列表 */
  const { noMatches, grouped } = useSessionTree({ archiveFilter, groupMode, orderMode, props, query })

  /* ── 项目与对话面板的开合 ──
     面板挂在左上角切换按钮下面，浮在阅读区之上。
     收起时机：再点按钮、点面板外、Esc、切到别的对话（含新建）、打开全部项目。 */
  const switchRef = useRef<HTMLDivElement>(null)
  const sidePresence = usePresence(sideOpen, 220)
  const sideKey = `${props.activeSessionId ?? ''}|${props.overviewOpen ? 1 : 0}`
  const [sideKeySeen, setSideKeySeen] = useState(sideKey)
  if (sideKey !== sideKeySeen) {
    setSideKeySeen(sideKey)
    if (sideOpen) setSideOpen(false)
  }
  useEffect(() => {
    if (!sideOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (target && switchRef.current?.contains(target)) return
      /* 面板里打开的归档/删除确认框挂在 body 上，点它不算「点面板外」 */
      if (target instanceof Element && target.closest('[role="dialog"]')) return
      setSideOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      /* Esc 先关面板里的小菜单，再关面板 */
      if (rowMenu || viewMenu) { setRowMenu(null); setViewMenu(false); return }
      setSideOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [sideOpen, rowMenu, viewMenu, setSideOpen, setRowMenu, setViewMenu])

  /* 回复流：订阅 services/chatService 的 stream，视图只负责显示。
     ⚠️ 依赖必须是「最后一条用户消息的 id」，不能是整个 messages 数组 ——
        流每吐一个增量都会改 messages，写成 [messages] 会让 effect 每帧重跑，
        cleanup 顺手把刚建的流掐断，表现就是回复永远停在头几个字。
     ⚠️ 退订等同于断线：**不当作完成**，并把没说完的那条从界面上撤掉，
        否则 StrictMode 重挂载会留下一条半截回复，再叠一条新的。 */
  /* 服务端会话的续流：切去工作台会让本视图卸载，卸载时只断掉订阅，后端那一轮照常跑。
     回到本视图时若最后一条用户消息还没有回复，就**只接上**那一轮（attach）：
     还在跑就从头补发、接着看实时输出；已经不在了（后端重启过）就显示「重新执行」，由用户决定。
     原先这里会直接再跑一遍这条消息，实测造成过重复执行、两个 agent 同时改同一个项目。 */
  useEffect(() => {
    if (!activeIsServer) return
    if (!props.activeSessionId) return
    if (lastUserId === null) return
    /* 最后一轮已经有 AI 回复：这轮结束了，不用再起流 */
    const at = messages.findIndex((m) => m.id === lastUserId)
    if (at >= 0 && messages.slice(at + 1).some((m) => m.role === 'ai')) return
    const lastUserMsg = at >= 0 ? messages[at] : null
    /* 明确区分工作台创作任务与普通对话：只有携带任务 taskId 或明确标记为创作修改（action === 'workflow_modify'）的消息才由工作台处理，普通带目标引用的对话正常恢复起流 */
    const isCreationTask = Boolean(
      lastUserMsg?.taskId ||
      lastUserMsg?.references?.some((r) => (r as unknown as { action?: string }).action === 'workflow_modify')
    )
    if (isCreationTask) return
    /* 同一条已经在跑（首次挂载刚起的流或全局其他视图正在跑的流）：不要重复起流 */
    if (chatStreamManager.has(props.activeSessionId)) {
      setPending(true)
      return
    }
    /* 不依赖 pending：它是 React state，发送后要等一次渲染才更新，
       而 effect 可能先跑。只看 servedRef —— 登记过的就说明已经起过流。 */
    if (servedRef.has(lastUserId)) return
    /* 失败过的不要再自动重起：会变成无限重试（见 MODULE_FAILED_IDS 注释） */
    if (MODULE_FAILED_IDS.has(lastUserId)) return
    servedRef.add(lastUserId)
    /* 只接上，不重跑：还在跑就接着看实时输出；已经不在了由用户点「重新执行」决定 */
    startServerReply({ attach: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIsServer, props.activeSessionId, lastUserId])

  useEffect(() => {
    /* 服务端会话：回复走 startServerReply（真实 SSE），不排演示回复。
       演示回复只能属于「仅本页」的草稿会话 —— 否则等于把保存在的消息演成假回答。 */
    if (activeIsServer) return
    if (lastUserId === null || servedRef.has(lastUserId)) return
    /* 这条用户消息后面已经有回复了就不再排：切到工作台再切回来会让本视图重挂载，
       新挂载的 servedRef 是空的，只按 id 判断会把同一条再排一次流，
       在末尾留下一个空的「正在回复…」。 */
    const at = messages.findIndex((m) => m.id === lastUserId)
    if (at >= 0 && messages.slice(at + 1).some((m) => m.role === 'ai')) return
    const lastUserMsg = at >= 0 ? messages[at] : null
    const isCreationTask = Boolean(
      lastUserMsg?.taskId ||
      lastUserMsg?.references?.some((r) => (r as unknown as { action?: string }).action === 'workflow_modify')
    )
    if (isCreationTask) return
    if (MODULE_FAILED_IDS.has(lastUserId)) return
    servedRef.add(lastUserId)
    setPendingStartedAt(Date.now())
    setPending(true)
    return startReply()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUserId, activeIsServer])

  /* 跟随最新内容：贴底时内容一变高就跟到底；用户往上翻就停，回到底部或发消息再恢复。
     翻离底部时显示 dsh 那个 34px 的「回到最新」圆钮。 */
  const viewRef = useRef<HTMLDivElement>(null)
  const { away: awayFromBottom, toBottom } = useScrollFollow(scrollRef, viewRef)
  const backToBottom = useCallback(() => toBottom('smooth'), [toBottom])
  /* 发出新一轮（或切到别的会话）时回到底部，让人看着这一轮从头执行 */
  useEffect(() => {
    if (pending) toBottom()
  }, [pending, toBottom])
  useEffect(() => {
    toBottom()
  }, [props.activeSessionId, toBottom])

  /* ── 输入区派生值 ── */
  const { backendModels, effectiveEffort, effectiveModel, selectedHarness, composerHarnesses, composerContextUsage, composerPromptTokens, composerMeterPanel } = useComposerModel({ breakdown, contextUsed, contextWindow, harnessId, messages, model, prefs, setPrefs, thinking, toolsTokens })

  /**
   * 服务端会话的回复流（SSE）。
   *
   * 后端端点已就绪，但 Agent 进程还没接：服务端会如实返回 `agent_unavailable`。
   * 这种情况**不是**「回复失败」，而是「还没有能力回复」—— 界面要说清楚差在哪，
   * 不能显示成红色的「这条回复没有完成」（那会让人以为重试就能好），
   * 更不能编一段回复顶上。所以这里单独用 `replyNote` 状态渲染，不走 `failed`。
   *
   * 真接上 Agent 之后这里不用改：delta/completed 走与演示适配器同一套收尾逻辑。
   */
  /* attach：只接上还在跑（或刚跑完）的那一轮，不新开；rerun：用户点了「重新执行」 */
  const { startServerReply } = useServerReply({ activeThread, backendModels, chat, clearRoundTrace, deliverablesRef, effectiveEffort, effectiveModel, harnessId, lastUserId, loadMessages, messages, props, selectedHarness, setAgentPhase, setBreakdown, setContextUsed, setContextWindow, setJobs, setPending, setPendingStartedAt, setReplyNote, setStopping, setToolsTokens, setUnfinishedReply, setUsage, streamStopRef })

  /** 发送失败的原因（人话优先；网络/未找到/内容不合规各有说法）。 */
  const { send, retrySaveReply, retryLastRound, submit } = useSendMessage({ activeIsServer, activeSessionRef, activeThread, attachments, chat, effectiveEffort, effectiveModel, harnessId, idemKeyRef, idemTextRef, inputRef, messages, mountedRef, pending, projectPending, props, replySaveRetry, selectedHarness, servedRef, sessionDraft, setAttachments, setPending, setReplySaveRetry, setSendError, setStageLeadVersion, setSubmitting, startServerReply, submissionInFlight })
  const { addFiles } = useComposerFiles({ mountedRef, setAttachments })
  const transferredHomeSession = useRef<string | null>(null)
  useEffect(() => {
    const transfer = props.homeTransfer
    if (!transfer || transfer.sessionId !== props.activeSessionId || transferredHomeSession.current === transfer.sessionId) return
    transferredHomeSession.current = transfer.sessionId
    chat.setDraft(transfer.draft)
    setEntryNote({ sessionId: transfer.sessionId, text: transfer.intent === 'create' ? '项目已准备好，确认下方需求后发送，即可开始制作。' : '想法已带入，发送后进入讨论，不修改工程。' })
    for (const item of transfer.files) addFiles([item.file], item.kind)
    props.onHomeTransferConsumed?.()
    // 一次性交接，避免重渲染或 StrictMode 重复上传。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.homeTransfer, props.activeSessionId])
  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []), undefined, () => { e.target.value = '' })
  }

  /* `intoProject` 让项目行上的「在此项目新建对话」按钮能指定归属；
     不传时沿用当前打开的项目（旧行为）。
     有项目 = 真实创建（失败时左栏显示错误，不伪造会话）；没有项目 = 本页草稿。 */
  const newSession = (intoProject?: string | null) => {
    props.onOverviewChange?.(false)
    /* 开新会话时把上一段的引用清掉即可：退订由 chatStreamManager 负责，
       这里若调 streamStopRef 会额外给后端发一次 /stop（它内部含请求），
       把「开新会话」误变成「停止上一轮」。 */
    streamStopRef.current = null
    setPending(false)
    setReplyNote(null)
    setSendError(null)
    idemKeyRef.current = null
    idemTextRef.current = null
    chat.clearChat()
    /* 左栏也要真的多一条会话，否则新建只清空了内容、树上什么都没变。
       归属：行内按钮给了就用它，否则沿用当前项目（在项目里开新对话，
       默认还是这个项目的活）；都没有就落未分组，之后可拖过去。 */
    const projectId = intoProject === undefined ? props.openProject : intoProject
    /* 创建完成前先不锁 loadedRef：会话要等拿到 id 后才能装消息。
       只有服务端创建成功才锁；失败时选中的是可继续输入的本地草稿，
       若锁上会跳过「装载即清空」，上一会话的消息会留在下面。 */
    void props.threads.create({ projectId, workdir: null }).then((result) => {
      if (result.session && result.session.origin === 'server') loadedRef.current = result.session.id
    })
  }

  /* 左栏直建项目（对齐 dsh：不弹表单、不问片型时长，建出来就是一个空项目，
     紧接着进「行内改名」态 —— dsh 的 create 也只是接管一个目录，
     名字之后再 rename，不需要先填一张表）。 */
  const createProjectInline = async () => {
    props.onOverviewChange?.(false)
    if (projectPending) return
    setProjectPending(true)
    setProjectError(null)
    try {
    const p = await props.onNewProject()
    setEditing(p.id)
    /* 回填真实名字而不是写死「未命名项目」：
       写死以后用户按回车就把它改成同名，与已有目录撞上。 */
    setEditText(p.name ?? '未命名项目')
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      next.delete(p.id)
      return next
    })
    } catch (error) { showProjectError(error) }
    finally { setProjectPending(false) }
  }

  const startCreationFromEmpty = async () => {
    if (projectPending) return
    setProjectPending(true)
    setSendError(null)
    // Snapshot the complete draft before changing sessions; never move an old target.
    const text = sessionDraft.draft.text
    const files = attachments
    try {
      const prepared = await prepareCreationEntry({ projectId: props.openProject ?? preparedEmptyProject.current }, {
        createProject: props.onNewProject,
        createSession: async (input) => {
          const result = await props.threads.create(input)
          if (result.session) setSessionDraft(result.session.projectId, result.session.id, { text, attachments: files, intentAction: 'modify' })
          return result
        },
        onProjectReady: (id) => { preparedEmptyProject.current = id },
      })
      setSessionDraft(prepared.projectId, prepared.sessionId, { text, attachments: files, intentAction: 'modify' })
      props.onSelectProject(prepared.projectId)
      preparedEmptyProject.current = null
      setEntryNote({ sessionId: prepared.sessionId, text: '项目已准备好，写下需求并发送，即可开始制作。' })
    } catch (error) {
      setSendError(error instanceof Error ? error.message : '项目尚未准备好，请重试。')
    } finally { setProjectPending(false) }
  }

  return (
    <div className="cv3">

      {props.overviewOpen && props.projectOverview}
      <div className="cv3-main" style={props.overviewOpen ? { display: 'none' } : undefined}>
        <header className="cv3-head">
          <div className="cv3-title-row">
            {/* 左上角的切换按钮：项目色块 + 当前对话标题 + ▾。既说明「现在在哪」，
                点开又是「项目与对话」面板 —— 面板浮在阅读区上面，不挤占对话 */}
            <div className="cv3-switch-wrap" ref={switchRef}>
              <button type="button" className="cv3-switch-btn" aria-haspopup="dialog" aria-expanded={sideOpen}
                      title={currentProject ? `${currentProject.name} · ${headTitle}` : headTitle}
                      onClick={() => setSideOpen((o) => !o)}>
                {currentProject ? <ProjectTile name={currentProject.name} size="xs" /> : <UiIcon icon={Menu01} size="sm" className="cv3-switch-icon" />}
                <span className="cv3-crumb-text">{headTitle}</span>
                <UiIcon icon={SemIcons.collapse} size="xs" className="cv3-switch-caret" />
              </button>
              {sidePresence && (
              <ConversationSidebar
                archiveFilter={archiveFilter}
                collapsedGroups={collapsedGroups}
                createProjectInline={createProjectInline}
                dragId={dragId}
                state={sidePresence}
                dropTarget={dropTarget}
                editText={editText}
                editing={editing}
                groupMode={groupMode}
                grouped={grouped}
                newSession={newSession}
                noMatches={noMatches}
                orderMode={orderMode}
                projectError={projectError}
                projectPending={projectPending}
                props={props}
                query={query}
                rowMenu={rowMenu}
                setArchiveFilter={setArchiveFilter}
                setArchivingProject={setArchivingProject}
                setCollapsedGroups={setCollapsedGroups}
                setDeleteConfirmText={setDeleteConfirmText}
                setDeletingProject={setDeletingProject}
                setDragId={setDragId}
                setDropTarget={setDropTarget}
                setEditText={setEditText}
                setEditing={setEditing}
                setGroupMode={setGroupMode}
                setOrderMode={setOrderMode}
                setQuery={setQuery}
                setRowMenu={setRowMenu}
                setViewMenu={setViewMenu}
                showProjectError={showProjectError}
                viewMenu={viewMenu}
              />
              )}
            </div>
            {/* 子代理徽标：跟在标题后面。「派了个分身去干活」和「跑条 bash」
                不是一个量级的事 —— 前者可能几十秒不回来，不标出来用户会以为卡住。 */}
            <SubagentBadge tools={activeSubagentTools} />
            {/* 后台任务：放在标题右侧而不是输入框上方 ——
                它不是「要读的内容」，放输入框上方会把人往输入框推的视线打断。
                只显示还在跑的、以及出事的（快任务完成即移除），
                实测一个会话 13060 个 job，全列出来等于刷屏。 */}
            {jobs.length > 0 && (
              <JobPanel jobs={jobs} onDismiss={(id) => setJobs((prev) => prev.filter((x) => x.jobId !== id))} />
            )}
            <ViewSwitch current="conversation" workbenchDisabled={props.openProject === null}
                        onSwitch={(target) => { if (target === 'workbench') props.onOpenWorkbench(props.activeSessionId) }} />
          </div>
        </header>

        <div className="cv3-scroll" ref={scrollRef}>
          <div className="cv3-view" ref={viewRef}>
            <ConversationThread
              activeIsServer={activeIsServer}
              activeMessagesLoaded={activeMessagesLoaded}
              activeThread={activeThread}
              agentPhase={agentPhase}
              entryNote={entryNote}
              getRoundOutcome={getRoundOutcome}
              messages={messages}
              pending={pending}
              pendingStartedAt={pendingStartedAt}
              projectPending={projectPending}
              props={props}
              replyNote={replyNote}
              replySaveRetry={replySaveRetry}
              retryLastRound={retryLastRound}
              retryMessages={retryMessages}
              retrySaveReply={retrySaveReply}
              retrySync={retrySync}
              send={send}
              sessionDraft={sessionDraft}
              setEntryNote={setEntryNote}
              setReplyNote={setReplyNote}
              startCreationFromEmpty={startCreationFromEmpty}
              startServerReply={startServerReply}
              unfinishedReply={unfinishedReply}
              userMessages={userMessages}
            />
          </div>

          <ConversationComposerSeat
            overlay={awayFromBottom ? (
              /* 「回到最新」：翻离底部时才出现（dsh 的 34px 圆钮），挂在输入席上缘 */
              <button type="button" className="cv3-to-bottom" aria-label="回到最新" title="回到最新"
                      onClick={backToBottom}>
                <UiIcon icon={SemIcons.collapse} size="md" />
              </button>
            ) : null}
            activeIsServer={activeIsServer}
            activeThread={activeThread}
            addFiles={addFiles}
            attachments={attachments}
            backendModels={backendModels}
            composerContextUsage={composerContextUsage}
            composerHarnesses={composerHarnesses}
            composerMeterPanel={composerMeterPanel}
            composerPromptTokens={composerPromptTokens}
            effectiveModel={effectiveModel}
            fileRef={fileRef}
            imageRef={imageRef}
            messages={messages}
            onPickFiles={onPickFiles}
            pending={pending}
            projectPending={projectPending}
            props={props}
            selectedHarness={selectedHarness}
            sendError={sendError}
            sessionDraft={sessionDraft}
            setAttachments={setAttachments}
            setHarnessId={setHarnessId}
            setModel={setModel}
            setSendError={setSendError}
            setThinking={setThinking}
            stageLeadVersion={stageLeadVersion}
            stopping={stopping}
            streamStopRef={streamStopRef}
            submit={submit}
            submitting={submitting}
          />
        </div>
      </div>

      {/* 归档项目确认：只是移出列表，文件与成片都留着。 */}
      <Dialog open={archivingProject !== null} onOpenChange={(o) => { if (!o && !deletingBusy) setArchivingProject(null) }}>
        <DialogContent className="cv3-del-dlg" showCloseButton aria-describedby={undefined}>
          <DialogTitle className="cv3-del-title">归档项目</DialogTitle>
          <DialogDescription className="cv3-del-desc">
            「{archivingProject?.name}」将从项目列表中移除。
            <strong>项目目录与已渲染的成片仍保留在磁盘上</strong>，之后可以再找回来。
          </DialogDescription>
          <div className="cv3-del-acts">
            <Button variant="ghost" size="sm" onClick={() => setArchivingProject(null)} disabled={deletingBusy}>取消</Button>
            <Button variant="default" size="sm" onClick={() => void confirmArchiveProject()} disabled={deletingBusy}>
              {deletingBusy ? '归档中…' : '归档项目'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除项目确认：物理删除，目录与成片真的被删掉。
          要求逐字输入项目名才放行 —— 这一步不可撤销，
          一次手滑点错就可能丢掉几十分钟的渲染成果。 */}
      <Dialog open={deletingProject !== null} onOpenChange={(o) => {
        if (!o && !deletingBusy) { setDeletingProject(null); setDeleteConfirmText('') }
      }}>
        <DialogContent className="cv3-del-dlg" showCloseButton aria-describedby={undefined}>
          <DialogTitle className="cv3-del-title">删除项目</DialogTitle>
          <DialogDescription className="cv3-del-desc">
            「{deletingProject?.name}」的项目目录与已渲染的成片
            <strong>将被永久删除，无法恢复</strong>。
            三库里的素材、技法、参考片不受影响。
          </DialogDescription>
          <label className="cv3-del-input">
            <span className="cv3-del-input-label">输入项目名以确认</span>
            <input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)}
                   placeholder={deletingProject?.name} aria-label="输入项目名以确认删除"
                   disabled={deletingBusy} autoComplete="off" />
          </label>
          <div className="cv3-del-acts">
            <Button variant="ghost" size="sm"
                    onClick={() => { setDeletingProject(null); setDeleteConfirmText('') }}
                    disabled={deletingBusy}>取消</Button>
            <Button variant="destructive" size="sm"
                    onClick={() => void confirmDeleteProject()}
                    disabled={deletingBusy || deleteConfirmText !== deletingProject?.name}>
              {deletingBusy ? '删除中…' : '永久删除'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

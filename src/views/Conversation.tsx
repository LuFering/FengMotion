import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  AlertCircle, Archive, ArchiveRestore, Check, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, FileText, FolderPlus, ImageIcon,
  ListFilter, LoaderCircle, MessageSquarePlus, PanelLeft, Pencil, Pin, PinOff, Plus, Search, Send, Shield,
  ShieldAlert, ShieldCheck, Trash2, X,
} from 'lucide-react'
import { registerComposer, type DeliverableAsset } from '@/shell/usePendingAssets'
import { PURPOSE_LABEL } from '@/shell/usePendingAssets'

/** 用途 → 输入框里显示的短标签（与待发送面板同一套文案） */
const PURPOSE_TXT: Record<string, string> = PURPOSE_LABEL

/** 从空白进入（还没建会话）时，服务层用的会话键。
 *  必须是每段对话各一个键：两条未落盘的对话共用一个键会在适配器里串消息。 */
const DRAFT_SESSION = '__draft__'
import { HARNESSES, REASONING_LABEL, DEFAULT_PREFS, prefsKey, loadPrefs, savePrefs, type ModelPrefs, type Reasoning } from '../data/harnesses'
import type { ChatState } from '../shell/useChat'
import { UNGROUPED, sessionTitle, type SessionsState } from '../shell/useSessions'
import { workflowService } from '../services/workflowService'
import {
  chatApi, hydrateDemoChat, requirementCard, isRequirementConfirmed,
  CONFIRM_REQUIREMENT_TEXT, NEEDS_MODEL_NOTE,
} from '../services/chatService'
import { GENOMES } from '../data/genomes'
import type { NewProjectInput } from '../shell/useProjects'
import type { WfPath } from '../data/workflowTemplates'
import { SegmentedControl } from '../components/ui/segmented-control'
import {
  Popover, PopoverContent, PopoverTrigger,
} from '../components/ui/popover'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from '../components/ui/dropdown-menu'
import { ViewSwitch } from '../components/ViewSwitch'
import type { ProjectSummary } from '../data/projects'
import '../styles/conversation.css'

/**
 * 创作对话视图 —— 先聊清楚，再开始制作。
 *
 * 版式最初照抄 deepseek-harness 的 Web 对话界面（三栏、气泡、思考过程、轨迹 tab…），
 * 这一轮**按本产品做深度适配**（作者要求）：
 *   - 左侧会话栏换成「我的项目」：这里是创作者的活，不是聊天记录清单；
 *   - 删掉 dsh 的通用 Agent 概念：智能体团队、创造模式、完全权限、演示模型、
 *     轨迹 tab、思考过程、@ 提及与 / 指令 —— 本产品没有这些东西，留着只会误导；
 *   - 保留与本产品对得上的部分：对话气泡、制作方案卡（含制作路径与「开始制作」）、
 *     检索到的参考/特效、以及「已创建了什么」的实话表。
 *
 * 与工作台的关系：同一个会话的两种呈现，顶部用同一个 ViewSwitch 互相切换；
 * 工作台右栏的对话 tab 也读同一份 chat 状态。
 *
 * 回复来源：走 services/chatService（契约 docs/contracts/agent.md + 演示适配器）。
 * 视图不再自己编回复 —— 那是「视图内造数据」，前后端协议第 1 条明令禁止。
 * 演示适配器只做字面整理：读不到就问，读到了就不重复问；原话原样保留。
 * 会话与项目仍在内存里（持久化尚未接入，不假装做了）。
 */

/* 与 StartCreation 同口径：首行过短 / 只有数字标点时不直接当名字 */
function usableName(text: string): string {
  const first = text.trim().split('\n')[0] ?? ''
  return first.length >= 2 && !/^[\d\s\p{P}]+$/u.test(first) ? first : ''
}

/* 权限模式文案（对齐 dsh preset.readOnly / workspaceWrite / fullAccess）
   每个模式配一句说明：权限是「放开多少」的选择，只说名字看不出后果。 */
const PERM_LABEL = {
  readOnly: '仅可查看',
  workspaceWrite: '工作区内修改',
  fullAccess: '完全权限',
} as const

const PERM_MODES = [
  { id: 'readOnly' as const, label: '仅可查看', desc: '只读取文件，不做任何修改', Icon: Shield },
  { id: 'workspaceWrite' as const, label: '工作区内修改', desc: '只允许改当前工作目录内的文件', Icon: ShieldCheck },
  { id: 'fullAccess' as const, label: '完全权限', desc: '减少确认步骤，可执行敏感操作', Icon: ShieldAlert },
]

/* 相对时间（对齐 dsh time.ago：刚刚 / N分钟 / N小时 / N天 / N个月 / N年） */
function fmtAgo(t: number): string {
  const d = Date.now() - t
  const m = Math.floor(d / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const day = Math.floor(h / 24)
  if (day < 30) return `${day}天前`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}个月前`
  return `${Math.floor(mo / 12)}年前`
}

/* 绝对时间（对齐 dsh date.ymd / hover.created 的「创建于」） */
function fmtWhen(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/* 富文本小渲染：段落 + 数字编号列表 + 行内 `代码` 与 **加粗**（只渲染文本自带的结构，不编造内容） */
function renderInline(line: string, keyPrefix: string): ReactNode {
  return line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`') && p.length >= 2) return <code key={`${keyPrefix}-${i}`}>{p.slice(1, -1)}</code>
    if (p.startsWith('**') && p.endsWith('**') && p.length >= 4) return <b key={`${keyPrefix}-${i}`}>{p.slice(2, -2)}</b>
    return <span key={`${keyPrefix}-${i}`}>{p}</span>
  })
}

function renderRich(text: string): ReactNode {
  const blocks: ReactNode[] = []
  let list: string[] = []
  let k = 0
  const flush = () => {
    if (list.length === 0) return
    blocks.push(<ol key={`ol-${k++}`}>{list.map((item, i) => <li key={i}>{renderInline(item, `li-${k}-${i}`)}</li>)}</ol>)
    list = []
  }
  text.split('\n').forEach((line) => {
    const m = line.match(/^\d+[.、]\s+(.*)$/)
    if (m) { list.push(m[1]); return }
    flush()
    if (line.trim()) blocks.push(<p key={`p-${k++}`}>{renderInline(line, `p-${k}`)}</p>)
  })
  flush()
  return blocks
}

export function Conversation(props: {
  chat: ChatState
  projects: ProjectSummary[]
  openProject: string | null
  onSelectProject: (id: string) => void
  /** 左栏直建项目（dsh workspace.create 语义：不弹表单，建完就地改名） */
  onNewProject: () => { id: string }
  /** 左栏行内改名（Enter/失焦提交，Esc 放弃） */
  onRenameProject?: (id: string, name: string) => void
  onCreateProject: (input: NewProjectInput) => { id: string }
  onLaunch: (r: { workflowId: string; projectId: string | null; autoRun: boolean }) => void
  onOpenWorkbench: () => void
  /** 会话树（项目 + 对话两级）：左栏用它，拖拽改归属也走它 */
  threads: SessionsState
  /** 当前会话 id；null = 还没有会话（从空白进入） */
  activeSessionId: string | null
  /** 删除项目（会话会先落回未分组，由本视图负责搬迁） */
  onDeleteProject?: (projectId: string) => void
}) {
  const { chat } = props
  const [proPath, setProPath] = useState<WfPath>('prompt-first')
  const [pending, setPending] = useState(false)
  /* dsh 响应式：1024 以下左栏自动收为 56px 轨，手动展开为覆盖式抽屉 */
  const [narrow, setNarrow] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 1024))
  const [sideExpanded, setSideExpanded] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024))
  /* 左栏两级树：折叠状态、正在拖的会话、拖放目标组 */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /* ── 左栏视图选项（对齐 dsh 的 viewOptions / groupBy / orderBy / filterBy）──
     query=搜索会话名称；groupMode=按项目/单列表；orderMode=最近更新/手动；
     archiveFilter=隐藏已归档/全部/仅已归档 */
  const [query, setQuery] = useState('')
  const [groupMode, setGroupMode] = useState<'project' | 'flat'>('project')
  const [orderMode, setOrderMode] = useState<'updated' | 'manual'>('updated')
  const [archiveFilter, setArchiveFilter] = useState<'hide' | 'show' | 'only'>('hide')
  const [viewMenu, setViewMenu] = useState(false)
  /* 每行的「更多」菜单：记录当前展开的是哪个 id（项目/会话共用一套浮层） */
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  /* 引擎/模型弹窗：modelOpen = 是否展开，modelPane = 当前在哪一级
     （null = 引擎列表；某引擎 id = 该引擎的模型页）。对齐首页的 harnessPane。 */
  const [modelOpen, setModelOpen] = useState(false)
  const [modelPane, setModelPane] = useState<string | null>(null)
  /* 行内重命名：editing = 正在编辑的 id，editText = 输入值 */
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  /* ── 输入区工具栏（对齐 dsh InputBar：左侧附件/权限，右侧模型/发送）──
     attachments=待发送附件；permission=权限模式（dsh preset.readOnly/workspaceWrite/fullAccess）；
     harnessId/model/prefs=引擎与模型配置（与首页共用同一份 data/harnesses）；
     composerMenu=当前展开的弹层（'add' 附件菜单 / 'perm' 权限 / 'model' 模型） */
  const [attachments, setAttachments] = useState<{
    name: string; size: number; kind: 'file' | 'image' | 'video'
    /* 来自「待发送」的附件带着用途与备注：界面要显示「logo.png · 用于画面」，
       而不只是塞一串文件名 —— 用途是用户特意选的，丢在这里等于白选。 */
    purpose?: string; note?: string; assetId?: string
  }[]>([])
  const [permission, setPermission] = useState<'readOnly' | 'workspaceWrite' | 'fullAccess'>('workspaceWrite')
  const [harnessId, setHarnessId] = useState(HARNESSES[0].id)
  const [model, setModel] = useState(HARNESSES[0].models[0])
  const [prefs, setPrefs] = useState<Record<string, ModelPrefs>>(loadPrefs)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  /* 已经排过回复的用户消息 id：防止同一条被排两次（重挂载 / 增量刷新） */
  const servedRef = useRef(new Set<string>())
  /* 当前回复流的退订函数：切会话或卸载时用它断线 */
  const streamStopRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /* 待发送 → 本输入框。注册期间才接受投递；离开这个视图就注销，
     免得在素材库里点「添加到对话」时被投到一个看不见的输入框里。 */
  useEffect(() => {
    registerComposer((list: DeliverableAsset[]) => {
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
          }))
        return [...prev, ...add].slice(0, 6)
      })
      return true
    })
    return () => registerComposer(null)
  }, [])

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1024)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /* 会话 ⇄ 当前对话的双向同步：
     - 切到另一条会话：把它的消息装进 chat（正在思考中不切，避免丢回复）
     - 当前对话有新消息：写回这条会话（左栏顺序、后续拖拽都以它为准） */
  const loadedRef = useRef<string | null>(null)
  /* 装载会话后的第一次写回必须跳过：
     切换会话时 replaceMessages 是本轮 effect 里排的队，写回 effect 在同一个 commit
     里读到的 chat.messages 还是**上一条会话**的 —— 直接写就会把旧内容盖进新会话。 */
  const skipWriteRef = useRef(false)
  const activeThread = props.threads.sessions.find((t) => t.id === props.activeSessionId) ?? null
  useEffect(() => {
    if (!activeThread || pending) return
    if (loadedRef.current === activeThread.id) return
    loadedRef.current = activeThread.id
    skipWriteRef.current = true
    if (activeThread.messages.length > 0) {
      chat.replaceMessages(activeThread.messages)
      /* 把既有历史交给演示适配器：不给它的话，这条会话会被当成第一轮，
         用户早就答过的信息会被再问一遍 —— 正好违反「只在必要时提问」 */
      hydrateDemoChat(activeThread.id, activeThread.messages.map((m) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        text: m.text,
      })))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id, pending])
  useEffect(() => {
    if (!props.activeSessionId) return
    if (loadedRef.current !== props.activeSessionId) return
    if (skipWriteRef.current) { skipWriteRef.current = false; return }
    const mine = chat.messages.filter((m) => m.id !== 'intro')
    if (mine.length === 0) return
    const t = props.threads.sessions.find((x) => x.id === props.activeSessionId)
    if (t && t.messages.length === mine.length) return
    /* 标题：会话还是「未命名对话」时，用首条需求补上（之后不覆盖用户/既有标题） */
    const firstUser = mine.find((m) => m.role === 'user')
    const patch: { messages: typeof mine; title?: string } = { messages: mine }
    if (firstUser && (!t || t.title === '未命名对话')) patch.title = sessionTitle(firstUser.text)
    props.threads.update(props.activeSessionId, patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages, props.activeSessionId])

  /* 工作台对话 tab 的 intro 免责句不属于创作会话，对话视图里滤掉 */
  const messages = useMemo(() => chat.messages.filter((m) => m.id !== 'intro'), [chat.messages])
  const userMessages = useMemo(() => messages.filter((m) => m.role === 'user'), [messages])

  /* 最新的用户消息 id：回复 effect 只依赖它（见下方说明，不能依赖整个数组） */
  const lastUserId = userMessages.length > 0 ? userMessages[userMessages.length - 1].id : null

  /* 需求确认卡的数据经服务层投影而来（视图不自己拼数据）。
     投影覆盖「原文 + 后续纠正」，原文始终原样呈现。 */
  const reqTexts = useMemo(() => userMessages.map((m) => m.text), [userMessages])
  const reqCard = useMemo(() => requirementCard(reqTexts), [reqTexts])
  const reqConfirmed = useMemo(() => isRequirementConfirmed(reqTexts), [reqTexts])

  /** 起一条回复流。返回退订函数：退订 = 断线，不当作完成。 */
  const startReply = (userMessageId: string) => {
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
      /* 中断：撤销登记并撤掉没说完的那条 —— 半截文本既不当成回复留着，
         也不当成「已回复」；下次进入会重新起流 */
      servedRef.current.delete(userMessageId)
      chat.removeMessage(aiId)
      setPending(false)
    }
  }
  const firstBrief = userMessages[0]?.text ?? ''
  const currentProject = props.projects.find((p) => p.id === props.openProject) ?? null
  /* 标题优先用当前项目名：左栏选项目之后，这里应该跟着变，
     否则用户会不知道现在聊的是哪一支片子 */
  const title = currentProject?.name ?? (usableName(firstBrief).slice(0, 14) || '未命名创作')
  /* 「制作已开始」只认本会话里真的创建过东西（AI 消息带 changes），
     不能拿「左栏选中了某个项目」当依据 —— 那是切换当前项目，不是开始制作 */
  const launched = messages.some((m) => m.role === 'ai' && m.changes && m.changes.length > 0)
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

  const grouped = useMemo(() => {
    if (groupMode === 'flat') {
      return [{ key: 'flat', projectId: UNGROUPED, sessions: visibleSessions }]
    }
    const groups = props.projects.map((p) => ({
      key: p.id,
      projectId: p.id,
      sessions: visibleSessions.filter((t) => t.projectId === p.id),
    }))
    const orphans = visibleSessions.filter((t) => !t.projectId || !props.projects.some((p) => p.id === t.projectId))
    if (orphans.length > 0) groups.push({ key: UNGROUPED, projectId: UNGROUPED, sessions: orphans })
    return groups
  }, [props.projects, visibleSessions, groupMode])

  const noMatches = visibleSessions.length === 0

  const drawer = narrow && sideExpanded
  const rail = !sideExpanded

  /* 回复流：订阅 services/chatService 的 stream，视图只负责显示。
     ⚠️ 依赖必须是「最后一条用户消息的 id」，不能是整个 messages 数组 ——
        流每吐一个增量都会改 messages，写成 [messages] 会让 effect 每帧重跑，
        cleanup 顺手把刚建的流掐断，表现就是回复永远停在头几个字。
     ⚠️ 退订等同于断线：**不当作完成**，并把没说完的那条从界面上撤掉，
        否则 StrictMode 重挂载会留下一条半截回复，再叠一条新的。 */
  useEffect(() => {
    if (lastUserId === null || servedRef.current.has(lastUserId)) return
    /* 这条用户消息后面已经有回复了就不再排：切到工作台再切回来会让本视图重挂载，
       新挂载的 servedRef 是空的，只按 id 判断会把同一条再排一次流，
       在末尾留下一个空的「正在回复…」。 */
    const at = messages.findIndex((m) => m.id === lastUserId)
    if (at >= 0 && messages.slice(at + 1).some((m) => m.role === 'ai')) return
    servedRef.current.add(lastUserId)
    setPending(true)
    return startReply(lastUserId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUserId])

  /* 新消息进来滚到底（只在接近底部时跟随，不抢用户翻历史） */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  const growInput = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 336)}px`
  }

  /** 发一条消息（输入框提交、卡片上的「确认」都走这一处，避免两份逻辑走偏） */
  const send = (text: string) => {
    const v = text.trim()
    if (!v || pending) return
    chat.addUserMessage(v)
    /* 同时交给服务层：回复流按「服务端收到的最后一条用户消息」起流，
       只加在界面上的话，适配器找不到这条提问，会去回上一条。
       原话原样传，不截断、不摘要。
       附件暂不随消息提交：契约要求附件先上传为 Asset、再以 fileId 引用，
       而上传能力还没接（见 docs/contracts/agent.md §6）。宁可不带，
       也不要拿 size=0 / 假 MIME 冒充「已上传」。 */
    const serviceSessionId = props.activeSessionId ?? DRAFT_SESSION
    chatApi.sendMessage(serviceSessionId, { text: v }).catch((err: unknown) => {
      /* 落不下去就说清楚，不假装已发送（契约 agent.md §6） */
      const note = err instanceof Error ? err.message : '消息没能提交。'
      const id = chat.startAiMessage()
      chat.failAiMessage(id, note)
      setPending(false)
    })
    chat.setDraft('')
    /* 发送成功后附件才离开输入框 —— 失败/中断时保留，用户不必重新挑一遍。
       （这里 addUserMessage 之后没有失败分支：真正的投递能力尚未接入，
       所以"成功"= 消息已进入对话。） */
    setAttachments([])
  }

  const submit = () => {
    send(chat.draft)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) el.style.height = 'auto'
    })
  }

  /* ── 输入区派生值 ── */
  const harness = HARNESSES.find((h) => h.id === harnessId) ?? HARNESSES[0]
  const prefKey = prefsKey(harnessId, model)
  const currentPrefs: ModelPrefs = prefs[prefKey] ?? DEFAULT_PREFS
  const setPref = (patch: Partial<ModelPrefs>) => {
    setPrefs((all) => {
      const next = { ...all, [prefKey]: { ...(all[prefKey] ?? DEFAULT_PREFS), ...patch } }
      savePrefs(next)
      return next
    })
  }
  /* 未接入的引擎不许发送（与首页同口径），附件/草稿至少有一个才算有内容 */
  const canSend = !pending && harness.ready && (chat.draft.trim().length > 0 || attachments.length > 0)

  /* 附件：kind 按 MIME 判定；最多 6 个（同首页上限） */
  const addFiles = (files: File[], forced?: 'file' | 'image' | 'video', done?: () => void) => {
    if (files.length > 0) {
      const picked = files.map((f) => ({
        name: f.name,
        size: f.size,
        kind: forced ?? (f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'file'),
      }))
      setAttachments((prev) => [...prev, ...picked].slice(0, 6))
    }
    done?.()
  }
  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []), undefined, () => { e.target.value = '' })
  }

  /* 删除项目：会话不跟着删，按 dsh delete.desc 的语义落进「未分组」 */
  const onDeleteProject = (projectId: string) => {
    props.threads.sessions.filter((t) => t.projectId === projectId).forEach((t) => props.threads.moveTo(t.id, null))
    props.onDeleteProject?.(projectId)
  }

  /* `intoProject` 让项目行上的「在此项目新建对话」按钮能指定归属；
     不传时沿用当前打开的项目（旧行为）。 */
  const newSession = (intoProject?: string | null) => {
    /* 开新会话时必须把上一段的回复流断掉：退订 = 断线（不当作完成），
       否则旧对话的回复会插进新会话里 */
    streamStopRef.current?.()
    streamStopRef.current = null
    setPending(false)
    chat.clearChat()
    /* 左栏也要真的多一条会话，否则新建只清空了内容、树上什么都没变。
       归属：行内按钮给了就用它，否则沿用当前项目（在项目里开新对话，
       默认还是这个项目的活）；都没有就落未分组，之后可拖过去。 */
    const t = props.threads.create({
      projectId: intoProject === undefined ? props.openProject : intoProject,
      workdir: null,
    })
    loadedRef.current = t.id
  }

  /* 左栏直建项目（对齐 dsh：不弹表单、不问片型时长，建出来就是一个空项目，
     紧接着进「行内改名」态 —— dsh 的 create 也只是接管一个目录，
     名字之后再 rename，不需要先填一张表）。 */
  const createProjectInline = () => {
    const p = props.onNewProject()
    setEditing(p.id)
    setEditText('未命名项目')
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      next.delete(p.id)
      return next
    })
    return p
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
  }

  /* 开始制作：与 StartCreation 同一套创建逻辑（建项目 + createFromPath + 落工作台）；
     先把真实创建的项目与工作流记进“已创建”表，再切工作台 */
  const launch = (quick: boolean) => {
    const brief = firstBrief
    if (!brief.trim()) return
    const name = usableName(brief)
    const projectName = name.slice(0, 14) || '未命名创作'
    const project = props.onCreateProject({
      name: projectName,
      genome: GENOMES[0]?.id ?? 'explainer',
      targetDuration: 180,
    })
    const wf = workflowService.createFromPath(quick ? 'prompt-first' : proPath, 'general', name.slice(0, 24) || '未命名创作', {
      projectId: project.id,
      seedPrompt: brief,
    })
    chat.addAiMessage({
      text: '项目建好了，制作方案也备了一份。',
      changes: [
        { file: projectName, change: '项目' },
        { file: wf.name, change: '工作流' },
      ],
    })
    props.onLaunch({ workflowId: wf.id, projectId: project.id, autoRun: quick })
  }

  return (
    <div className="cv3">
      {drawer && <button type="button" aria-label="关闭项目栏" className="cv3-backdrop" onClick={() => setSideExpanded(false)} />}

      {/* 收起时整块不渲染：不留 56px 竖条（那是 dsh 的「图标轨」，本产品收起后
          左栏里没有任何还需要常驻的图标，留一条空轨道只是视觉噪音）。 */}
      {!rail && <aside className="cv3-side" data-drawer={drawer || undefined} aria-label="项目与对话">
        {/* 左栏标题与项目/对话操作同层，视图选项靠近下面的列表。 */}
        <div className="cv3-side-top">
          <h1 className="cv3-library-title">我的创作</h1>
          <button type="button" className="cv3-icon-btn" aria-label="新建对话" title="新建对话"
                  onClick={() => newSession()}>
            <MessageSquarePlus size={15} />
          </button>
          <button type="button" className="cv3-icon-btn" aria-label="新建项目" title="新建项目"
                  onClick={createProjectInline}>
            <FolderPlus size={15} />
          </button>
          {/* 视图选项（对齐 dsh viewOptions：分组方式 / 排序方式 / 归档筛选） */}
          <div className="cv3-viewwrap">
            <button type="button" className="cv3-icon-btn" aria-label="视图选项" title="视图选项"
                    aria-expanded={viewMenu} data-on={viewMenu || undefined}
                    onClick={() => { setViewMenu((o) => !o); setRowMenu(null) }}>
              <ListFilter size={15} />
            </button>
            {viewMenu && (
              <div className="cv3-menu cv3-viewmenu" role="menu">
                <div className="cv3-menu-sec">分组方式</div>
                <button type="button" role="menuitemradio" aria-checked={groupMode === 'project'}
                        onClick={() => { setGroupMode('project'); setViewMenu(false) }}>
                  <span>按项目</span>{groupMode === 'project' && <Check size={13} />}
                </button>
                <button type="button" role="menuitemradio" aria-checked={groupMode === 'flat'}
                        onClick={() => { setGroupMode('flat'); setViewMenu(false) }}>
                  <span>单列表</span>{groupMode === 'flat' && <Check size={13} />}
                </button>
                <div className="cv3-menu-sec">排序方式</div>
                <button type="button" role="menuitemradio" aria-checked={orderMode === 'updated'}
                        onClick={() => { setOrderMode('updated'); setViewMenu(false) }}>
                  <span>最近更新</span>{orderMode === 'updated' && <Check size={13} />}
                </button>
                <button type="button" role="menuitemradio" aria-checked={orderMode === 'manual'}
                        onClick={() => { setOrderMode('manual'); setViewMenu(false) }}>
                  <span>手动排序</span>{orderMode === 'manual' && <Check size={13} />}
                </button>
                <div className="cv3-menu-sec">筛选会话</div>
                {([['hide', '隐藏已归档'], ['show', '全部对话（显示已归档）'], ['only', '仅显示已归档']] as const).map(([v, label]) => (
                  <button key={v} type="button" role="menuitemradio" aria-checked={archiveFilter === v}
                          onClick={() => { setArchiveFilter(v); setViewMenu(false) }}>
                    <span>{label}</span>{archiveFilter === v && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 搜索会话（对齐 dsh search.placeholder / search.noMatches） */}
        <label className="cv3-search">
          <Search size={13} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="搜索对话名称" aria-label="搜索对话" />
          {query && (
            <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={12} /></button>
          )}
        </label>

        <div className="cv3-side-list">
          {/* 只有「真的一条会话都没有、也没有任何项目」时才整块换成提示。
              原来用 noMatches（= 没有会话）挡掉整个列表，导致左栏直建出来的
              空项目根本不显示 —— 新建项目点了没反应。dsh 的项目行是常驻的，
              哪怕它下面一条会话都没有。 */}
          {query.trim() && noMatches ? (
            <p className="cv3-side-hint">无匹配结果</p>
          ) : grouped.length === 0 ? (
            <p className="cv3-side-hint">暂无会话</p>
          ) : grouped.map((g) => {
            const isUng = g.projectId === UNGROUPED
            const flat = g.key === 'flat'
            const proj = isUng || flat ? null : props.projects.find((p) => p.id === g.projectId) ?? null
            const collapsed = collapsedGroups.has(g.key)
            return (
              <div key={g.key} className="cv3-group" data-ungrouped={isUng && !flat || undefined}
                   onDragOver={(e) => {
                     if (!dragId || flat) return
                     e.preventDefault()
                     setDropTarget(g.projectId)
                   }}
                   onDragLeave={(e) => {
                     if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                     setDropTarget((t) => (t === g.projectId ? null : t))
                   }}
                   onDrop={(e) => {
                     e.preventDefault()
                     if (dragId && !flat) props.threads.moveTo(dragId, isUng ? null : g.projectId)
                     setDragId(null)
                     setDropTarget(null)
                   }}>
                {!flat && (
                  <div className="cv3-group-row">
                    {/* 新建后立刻在这里就地改名（dsh 的 renameInput：建完就打字，
                        不用先填弹窗里的表单再确认一遍） */}
                    {!isUng && proj && editing === proj.id ? (
                      <div className="cv3-group-head cv3-group-editrow">
                        <ChevronRight size={13} className="cv3-group-caret" data-open={!collapsed || undefined} />
                        <input className="cv3-group-edit" autoFocus value={editText}
                               aria-label="项目名称"
                               onChange={(e) => setEditText(e.target.value)}
                               onBlur={() => {
                                 props.onRenameProject?.(proj.id, editText)
                                 setEditing(null)
                               }}
                               onKeyDown={(e) => {
                                 if (e.key === 'Enter') {
                                   props.onRenameProject?.(proj.id, editText)
                                   setEditing(null)
                                 }
                                 if (e.key === 'Escape') setEditing(null)
                               }} />
                      </div>
                    ) : (
                    <button type="button" className="cv3-group-head"
                            data-drop={dropTarget === g.projectId || undefined}
                            onClick={() => setCollapsedGroups((prev) => {
                              const next = new Set(prev)
                              if (next.has(g.key)) next.delete(g.key)
                              else next.add(g.key)
                              return next
                            })}
                            title={isUng ? '没有归属项目的对话，可拖到项目下' : proj?.name}>
                      <ChevronRight size={13} className="cv3-group-caret" data-open={!collapsed || undefined} />
                      <span className="cv3-group-name">{isUng ? '未分组' : proj?.name ?? '未命名项目'}</span>
                      {/* 0 不显示：空项目挂一个「0」只是噪音，还会和下面的
                          「还没有对话。」重复表达同一件事。dsh 的行也没有计数。 */}
                      {g.sessions.length > 0 && (
                        <span className="cv3-group-count num">{g.sessions.length}</span>
                      )}
                    </button>
                    )}
                    {!isUng && proj && (
                      <>
                        <div className="cv3-rowmenu-wrap">
                          <button type="button" className="cv3-row-more" aria-label={`${proj.name} 的操作`}
                                  aria-expanded={rowMenu === proj.id}
                                  onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === proj.id ? null : proj.id); setViewMenu(false) }}>
                            <Ellipsis size={14} />
                          </button>
                          {rowMenu === proj.id && (
                            <div className="cv3-menu cv3-rowmenu" role="menu">
                              <button type="button" role="menuitem"
                                      onClick={() => { props.onSelectProject(proj.id); setRowMenu(null) }}>
                                <PanelLeft size={13} /><span>打开项目</span>
                              </button>
                              <button type="button" role="menuitem"
                                      onClick={() => { setEditing(proj.id); setEditText(proj.name); setRowMenu(null) }}>
                                <Pencil size={13} /><span>重命名项目</span>
                              </button>
                              <button type="button" role="menuitem" data-danger
                                      onClick={() => { setRowMenu(null); onDeleteProject(proj.id) }}>
                                <Trash2 size={13} /><span>删除项目</span>
                              </button>
                            </div>
                          )}
                        </div>
                        {/* 在此项目里新建对话（对齐 dsh ProjectRowItem 的 rowActions：
                            小图标、悬停才现身，放在操作钮最右，点一下就把新会话挂到这个项目下） */}
                        <button type="button" className="cv3-row-new" aria-label={`在 ${proj.name} 中新建对话`}
                                title={`在 ${proj.name} 中新建对话`}
                                onClick={(e) => { e.stopPropagation(); newSession(proj.id) }}>
                          <MessageSquarePlus size={14} />
                        </button>
                      </>
                    )}
                  </div>
                )}
                {!collapsed && (
                  <div className="cv3-group-body">
                    {g.sessions.length === 0 ? (
                      <p className="cv3-side-hint">{flat ? '暂无会话' : isUng ? '没有未分组的对话。' : '还没有对话。'}</p>
                    ) : g.sessions.map((t) => (
                      <div key={t.id} className="cv3-session"
                           draggable
                           data-current={t.id === props.activeSessionId || undefined}
                           data-dragging={dragId === t.id || undefined}
                           data-archived={t.archived || undefined}
                           onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move' }}
                           onDragEnd={() => { setDragId(null); setDropTarget(null) }}
                           onClick={() => {
                             if (editing === t.id) return
                             props.threads.setActiveId(t.id)
                             if (!isUng && !flat && proj) props.onSelectProject(proj.id)
                           }}
                           title={`${t.title} · 创建于 ${fmtWhen(t.createdAt)}`}>
                        {editing === t.id ? (
                          <input className="cv3-session-edit" autoFocus value={editText}
                                 onChange={(e) => setEditText(e.target.value)}
                                 onBlur={() => { props.threads.rename(t.id, editText); setEditing(null) }}
                                 onKeyDown={(e) => {
                                   if (e.key === 'Enter') { props.threads.rename(t.id, editText); setEditing(null) }
                                   if (e.key === 'Escape') setEditing(null)
                                 }}
                                 onClick={(e) => e.stopPropagation()} />
                        ) : (
                          <>
                            {t.pinned && <Pin size={11} className="cv3-session-pin" aria-label="已置顶" />}
                            <span className="cv3-session-name">{t.title}</span>
                            {t.archived
                              ? <span className="cv3-session-flag">已归档</span>
                              : <span className="cv3-session-time num">{fmtAgo(t.updatedAt)}</span>}
                          </>
                        )}
                        <div className="cv3-rowmenu-wrap">
                          <button type="button" className="cv3-row-more" aria-label={`${t.title} 的操作`}
                                  aria-expanded={rowMenu === t.id}
                                  onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === t.id ? null : t.id); setViewMenu(false) }}>
                            <Ellipsis size={13} />
                          </button>
                          {rowMenu === t.id && (
                            <div className="cv3-menu cv3-rowmenu" role="menu">
                              <button type="button" role="menuitem"
                                      onClick={() => { setEditing(t.id); setEditText(t.title); setRowMenu(null) }}>
                                <Pencil size={13} /><span>重命名</span>
                              </button>
                              <button type="button" role="menuitem"
                                      onClick={() => { props.threads.setPinned(t.id, !t.pinned); setRowMenu(null) }}>
                                {t.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                                <span>{t.pinned ? '取消置顶' : '置顶会话'}</span>
                              </button>
                              <button type="button" role="menuitem"
                                      onClick={() => { props.threads.setArchived(t.id, !t.archived); setRowMenu(null) }}>
                                {t.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                                <span>{t.archived ? '取消归档' : '归档会话'}</span>
                              </button>
                              <button type="button" role="menuitem" data-danger
                                      onClick={() => { props.threads.remove(t.id); setRowMenu(null) }}>
                                <Trash2 size={13} /><span>删除会话</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {/* 底部的整行「新建项目」已移除（dsh 左栏没有整行大按钮）：
            新建入口收到顶部图标条，项目行上另有「在此项目新建对话」。 */}
      </aside>}

      <div className="cv3-main">
        <header className="cv3-head">
          <div className="cv3-title-row">
            <button type="button" className="cv3-icon-btn" aria-label={sideExpanded ? '收起项目栏' : '展开项目栏'} title={sideExpanded ? '收起项目栏' : '展开项目栏'} onClick={() => setSideExpanded((o) => !o)}>
              <PanelLeft size={16} />
            </button>
            <div className="cv3-crumb" title={title}>{title}</div>
            <ViewSwitch current="conversation" workbenchDisabled={props.openProject === null}
                        onSwitch={(target) => { if (target === 'workbench') props.onOpenWorkbench() }} />
          </div>
        </header>

        <div className="cv3-scroll" ref={scrollRef}>
          <div className="cv3-view">
            <div className="cv3-col">
              {userMessages.length === 0 && (
                <p className="cv3-ai-intro">说说你想做的片子：讲给谁、多长、什么感觉。</p>
              )}

              {messages.map((m) => m.role === 'user' ? (
                <p key={m.id} className="cv3-user">{m.text}</p>
              ) : (
                <div key={m.id} className="cv3-ai-block">
                  {/* 文字不完整时由下面的「正在回复…」点明，正文本身不做修饰 */}
                  <div className="cv3-rich">{renderRich(m.text)}</div>
                  {m.streaming && <p className="cv3-streaming">正在回复…</p>}
                  {/* 失败就说失败：半截文本不得冒充完成（契约 §4） */}
                  {m.failed && (
                    <p className="cv3-failed" role="alert">
                      <AlertCircle size={13} /> 这条回复没有完成：{m.failed}
                    </p>
                  )}
                  {/* 演示来源必须在消息上可见，不能只写在别处 */}
                  {m.demo && !m.streaming && !m.failed && (
                    <p className="cv3-demo-note">演示回复 · 未连接 Agent</p>
                  )}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="cv3-tools">
                      {m.toolCalls.map((t, i) => (
                        <div key={i} className="cv3-tool">
                          <b>{t.label}</b>
                          <span>{t.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.changes && m.changes.length > 0 && (
                    <div className="cv3-changes">
                      <b className="cv3-changes-title">新建的东西</b>
                      <table>
                        <thead><tr><th>名字</th><th>类型</th></tr></thead>
                        <tbody>
                          {m.changes.map((c, i) => (
                            <tr key={i}><td><code>{c.file}</code></td><td>{c.change}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                {/* 需求确认卡（说明文档 §3）：方向明确时不摆多个方向让用户逐项审批 ——
                    这里只有一份「我读到的」，用户确认或纠正即可。
                    「画面构想」如实标出要等模型，不编一段像分镜的文字顶上。 */}
                {messages[messages.length - 1]?.id === m.id && !m.streaming && !m.failed && userMessages.length > 0 && !reqConfirmed && (
                  <div className="cv3-req">
                    <div className="cv3-req-head">
                      <b>需求确认</b>
                      <span>对就确认，不对就直接说</span>
                    </div>

                    <div className="cv3-req-block">
                      <span className="cv3-req-k">你的原始需求（原样保留）</span>
                      <p className="cv3-req-orig">{reqCard.firstPrompt}</p>
                    </div>

                    {reqCard.corrections.length > 0 && (
                      <div className="cv3-req-block">
                        <span className="cv3-req-k">你后来补的（原样追加，不回改上面的原文）</span>
                        <ul className="cv3-req-corrections">
                          {reqCard.corrections.map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      </div>
                    )}

                    <div className="cv3-req-block">
                      <span className="cv3-req-k">我读到的（逐条附原文，可核对）</span>
                      {reqCard.decided.length > 0 ? (
                        <ul className="cv3-req-facts">
                          {reqCard.decided.map((f, i) => (
                            <li key={i}><b>{f.label}</b><span>出自「{f.quote}」</span></li>
                          ))}
                        </ul>
                      ) : (
                        <p className="cv3-req-none">原话里还没有可核对的字。</p>
                      )}
                      {reqCard.missing.length > 0 && (
                        <p className="cv3-req-missing">还没说：{reqCard.missing.join('；')}</p>
                      )}
                    </div>

                    <div className="cv3-req-block">
                      <span className="cv3-req-k">画面构想</span>
                      <p className="cv3-req-model">{NEEDS_MODEL_NOTE}</p>
                      <p className="cv3-req-model">你也可以直接在下面写想拍什么，我原样记下。</p>
                    </div>

                    <div className="cv3-req-actions">
                      <button type="button" className="cv3-primary"
                              onClick={() => send(CONFIRM_REQUIREMENT_TEXT)}>确认，就按这些</button>
                      <button type="button" className="cv3-secondary"
                              onClick={() => inputRef.current?.focus()}>我要纠正</button>
                    </div>
                  </div>
                )}

                  {/* 下一步：原来这块由本地伪造的「制作方案」三条带出来 ——
                      那三条是编的内容（不是模型给的，也不是工作流产的），已删。
                      入口本身保留：它是进入工作台的路，不该跟着伪造内容一起消失。 */}
                  {messages[messages.length - 1]?.id === m.id && !m.streaming && !m.failed && !launched && (
                    <div className="cv3-plan">
                      <b className="cv3-plan-title">下一步</b>
                      <div className="cv3-plan-path">
                        <span>专业制作路径</span>
                        <SegmentedControl value={proPath}
                                          onChange={(v) => setProPath(v as WfPath)}
                                          ariaLabel="专业制作路径"
                                          options={[{ value: 'prompt-first', label: 'Prompt-first' }, { value: 'structured', label: 'Structured' }]} />
                      </div>
                      <div className="cv3-plan-actions">
                        <button type="button" className="cv3-primary" onClick={() => launch(true)}>开始制作</button>
                        <button type="button" className="cv3-secondary" onClick={() => launch(false)}>先去工作台看看</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {pending && messages[messages.length - 1]?.role === 'user' && (
                <p className="cv3-pending"><LoaderCircle className="cv3-spin" size={14} /> 正在回复…</p>
              )}
            </div>
          </div>

          <div className="cv3-seat">
            <form className="cv3-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
              <div className="cv3-card">
                {/* 待发送附件（对齐 dsh attachment.pending：可逐个移除） */}
                {attachments.length > 0 && (
                  <div className="cv3-attach-row">
                    {attachments.map((a, i) => (
                      <span key={`${a.name}-${i}`} className="cv3-attach-chip" data-kind={a.kind}
                            data-from-pending={a.assetId ? '' : undefined}
                            title={a.note ? `${PURPOSE_TXT[a.purpose ?? ''] ?? ''} · ${a.note}` : undefined}>
                        {a.kind === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />}
                        <span className="cv3-attach-name">{a.name}</span>
                        {/* 用途是用户在待发送面板特意选的，必须跟着附件一起显示，
                            否则「作为参考」和「用于画面」在输入框里长得一模一样 */}
                        {a.purpose && a.purpose !== 'unspecified' && (
                          <span className="cv3-attach-purpose">{PURPOSE_TXT[a.purpose] ?? a.purpose}</span>
                        )}
                        <button type="button" aria-label={`移除文件 ${a.name}`}
                                onClick={() => setAttachments((l) => l.filter((_, j) => j !== i))}>
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <textarea className="cv3-input" rows={1} ref={inputRef}
                          value={chat.draft}
                          onChange={(e) => { chat.setDraft(e.target.value); growInput() }}
                          onKeyDown={onInputKeyDown}
                          placeholder="说说你想做的片子，或补充制作要求" />
                <div className="cv3-row">
                  {/* 左侧：添加文件 / 权限模式 */}
                  <div className="cv3-leading">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="cv3-chip-btn" aria-label="添加文件或调用指令" title="添加文件或调用指令">
                          <Plus size={14} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="top" align="start" sideOffset={8} className="cv3-ddm cv3-ddm-add">
                        <DropdownMenuLabel className="cv3-ddm-label">添加到这条对话</DropdownMenuLabel>
                        <div className="cv3-addgrid">
                          <button type="button" onClick={() => fileRef.current?.click()}>
                            <span className="cv3-addicon"><FileText size={16} /></span>
                            <b>文件</b>
                            <em>剧本、分镜表</em>
                          </button>
                          <button type="button" onClick={() => imageRef.current?.click()}>
                            <span className="cv3-addicon"><ImageIcon size={16} /></span>
                            <b>图片</b>
                            <em>参考画面</em>
                          </button>
                        </div>
                        <p className="cv3-ddm-note">也可以直接把文件拖进输入框</p>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="cv3-chip-btn cv3-perm-btn" aria-label="权限设置" title="权限设置">
                          {permission === 'readOnly' ? <Shield size={13} />
                            : permission === 'fullAccess' ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}
                          <span className="cv3-chip-label">{PERM_LABEL[permission]}</span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="top" align="start" sideOffset={8} className="cv3-ddm cv3-ddm-perm">
                        <DropdownMenuLabel className="cv3-ddm-label">权限模式</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={permission} onValueChange={(v) => setPermission(v as typeof permission)}>
                          {PERM_MODES.map(({ id, label, desc, Icon }) => (
                            <DropdownMenuRadioItem key={id} value={id} className="cv3-ddm-permrow">
                              <span className="cv3-perm-icon" data-danger={id === 'fullAccess' || undefined}><Icon size={14} /></span>
                              <span className="cv3-perm-text">
                                <b>{label}</b>
                                <em>{desc}</em>
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {/* 右侧：引擎与模型、发送。
                      引擎/模型选择器照首页那套做（两段式 chip + 两级弹窗），
                      原来是一个通用 CPU 图标 + 扁平菜单，和首页明显不是同一个东西。 */}
                  <div className="cv3-trailing">
                    <Popover open={modelPane !== null || modelOpen} onOpenChange={(o) => {
                      if (!o) { setModelOpen(false); setModelPane(null) }
                      else setModelOpen(true)
                    }}>
                      <PopoverTrigger asChild>
                        <button type="button" className="cv3-hbtn"
                                data-off={!harness.ready || undefined}
                                data-connected={harness.ready || undefined}
                                aria-label="选择执行引擎与模型" title={harness.ready ? '切换执行引擎' : '该引擎未接入'}
                                style={{ '--h-color': harness.color } as CSSProperties}>
                          <span className="cv3-hseg" data-off={!harness.ready || undefined}>
                            <i aria-hidden="true" />
                            <span className="cv3-hmark-img" aria-hidden="true"
                                  style={{ maskImage: `url(${harness.icon})`, WebkitMaskImage: `url(${harness.icon})` }} />
                            {harness.ready
                              ? <><span className="cv3-hdiv" aria-hidden="true" /><span className="cv3-hmodel">{model}</span></>
                              : <span className="cv3-hoff">未接入AI</span>}
                          </span>
                          <ChevronDown size={12} className="cv3-hchev" aria-hidden="true" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="top" align="end" sideOffset={9} className="cv3-hpop">
                        <div className="cv3-hp-scroll">
                          {/* 一级：引擎列表；二级：该引擎的模型 + 模型设置（从右侧滑入） */}
                          <div className="cv3-hp-pane" data-active={modelPane === null || undefined}>
                            <div className="cv3-hp-head">
                              <b>执行引擎</b>
                              <span>{HARNESSES.filter((h) => h.ready).length} 个已接入</span>
                            </div>
                            <div className="cv3-hp-list" role="listbox" aria-label="执行引擎">
                              {HARNESSES.map((h) => (
                                <button key={h.id} type="button" className="cv3-hp-item" role="option"
                                        aria-selected={h.id === harnessId}
                                        data-off={!h.ready || undefined}
                                        style={{ '--h-color': h.color } as CSSProperties}
                                        onClick={() => { setHarnessId(h.id); setModel(h.models[0]); setModelPane(h.id) }}>
                                  <span className="cv3-hp-logo" aria-hidden="true"
                                        style={{ maskImage: `url(${h.icon})`, WebkitMaskImage: `url(${h.icon})` }} />
                                  <span className="cv3-hp-txt">
                                    <b>{h.name}</b>
                                    <small>{h.ready ? '本机已配置' : '未接入，仅展示'}</small>
                                  </span>
                                  {h.id === harnessId && <Check size={13} className="cv3-hp-ck" aria-hidden="true" />}
                                  <ChevronRight size={13} className="cv3-hp-go" aria-hidden="true" />
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="cv3-hp-pane cv3-hp-models" data-active={modelPane !== null || undefined}>
                            <div className="cv3-hp-head">
                              <button type="button" className="cv3-hp-back" onClick={() => setModelPane(null)}>
                                <ChevronLeft size={11} aria-hidden="true" />引擎
                              </button>
                              <b>{harness.name}</b>
                            </div>
                            <div className="cv3-hp-list" role="listbox" aria-label="模型">
                              {harness.models.map((m) => (
                                <div key={m} className="cv3-hp-modelwrap">
                                  <button type="button" className="cv3-hp-item cv3-hp-model" role="option"
                                          aria-selected={m === model}
                                          onClick={() => setModel(m)}>
                                    <span className="cv3-hp-radio" aria-hidden="true" />
                                    <span className="cv3-hp-txt"><b className="num">{m}</b></span>
                                    {m === model && <Check size={13} className="cv3-hp-ck" aria-hidden="true" />}
                                  </button>
                                  {/* 选中模型下方展开设置抽屉：思考强度 + 最大上下文。
                                      首页两个都给了，这里原来只有推理等级、缺最大上下文。 */}
                                  {m === model && (
                                    <div className="cv3-hp-drawer">
                                      <div className="cv3-hp-row">
                                        <span className="cv3-hp-label">思考强度</span>
                                        <div className="cv3-hp-seg" role="radiogroup" aria-label="思考强度">
                                          {(['off', 'standard', 'enhanced'] as Reasoning[]).map((v) => (
                                            <button key={v} type="button" role="radio"
                                                    aria-checked={currentPrefs.reasoning === v}
                                                    className={currentPrefs.reasoning === v ? 'on' : undefined}
                                                    onClick={() => setPref({ reasoning: v })}>{REASONING_LABEL[v]}</button>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="cv3-hp-row">
                                        <span className="cv3-hp-label">最大上下文</span>
                                        <div className="cv3-hp-seg" role="radiogroup" aria-label="最大上下文">
                                          {([32, 64, 128] as const).map((v) => (
                                            <button key={v} type="button" role="radio"
                                                    aria-checked={currentPrefs.context === v}
                                                    className={currentPrefs.context === v ? 'on' : undefined}
                                                    onClick={() => setPref({ context: v })}>{v}K</button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                            {!harness.ready && (
                              <p className="cv3-hp-note">{harness.name} 未接入：不会真的执行，切回已配置引擎才能发送。</p>
                            )}
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                    <button className="cv3-send" type="submit" disabled={!canSend} aria-label="发送">
                      {pending ? <LoaderCircle size={16} className="cv3-spin" /> : <Send size={16} />}
                    </button>
                  </div>
                </div>
                {/* 隐藏的文件选择器（对齐 dsh 的 file input：多选） */}
                <input ref={fileRef} type="file" multiple hidden onChange={onPickFiles} />
                <input ref={imageRef} type="file" accept="image/*" multiple hidden
                       onChange={(e) => addFiles(Array.from(e.target.files ?? []), 'image', () => { if (imageRef.current) imageRef.current.value = '' })} />
              </div>
            </form>
            {/* 「N 条需求」计数已去掉：它数的是用户消息条数，不是需求条数
                （用户可能只发一句「继续」），挂在这里既不准也没人看。
                「已开始制作」是真实状态，保留。 */}
            <footer className="cv3-status">
              {launched && <span className="cv3-pill">已开始制作</span>}
            </footer>
          </div>
        </div>
      </div>
    </div>
  )
}

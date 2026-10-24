import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Archive, ArchiveRestore, Check, ChevronRight, Ellipsis, ListFilter, LoaderCircle,
  PanelLeft, Pencil, Pin, PinOff, Plus, Search, Send, Trash2, X,
} from 'lucide-react'
import type { ChatState } from '../shell/useChat'
import { UNGROUPED, sessionTitle, type SessionsState } from '../shell/useSessions'
import { workflowService } from '../services/workflowService'
import { GENOMES } from '../data/genomes'
import type { NewProjectInput } from '../shell/useProjects'
import type { WfPath } from '../data/workflowTemplates'
import { SegmentedControl } from '../components/ui/segmented-control'
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
 * 演示口径：回复由本地演示生成（未接 Agent）；会话与项目在内存里。
 */

interface DemoReply {
  text: string
  toolCalls: { label: string; detail: string }[]
  plan?: string[]
}

const GENERIC_PLAN = [
  '开场先说一件让人想看下去的事',
  '中间分两三点讲清楚，每点配一个画面',
  '结尾落回观众自己的处境',
]

const TOKEN_PLAN = [
  '开场先让人意识到自己见过 Token 但说不清',
  '中间用生活里的东西打比方，讲清它是什么、怎么算钱',
  '结尾说回观众自己的使用场景',
]

function demoReply(userText: string, turn: number): DemoReply {
  if (turn === 0) {
    const aboutToken = /token/i.test(userText)
    return {
      text: aboutToken
        ? '这条像 Token 科普。先定三件事：\n1. 讲给谁\n2. 多长\n3. 什么感觉\n回一个就行，剩下的我按常规补。'
        : '先定三件事：\n1. 讲给谁\n2. 多长\n3. 什么感觉\n回一个就行，剩下的我按常规补。',
      toolCalls: [
        { label: '参考片库', detail: '沙漠公路那条片的推镜：人不动，背景往后拉' },
        { label: '特效库', detail: '多莉变焦：人保持大小，背景快速缩放' },
      ],
      plan: aboutToken ? TOKEN_PLAN : GENERIC_PLAN,
    }
  }
  const snippet = userText.trim().slice(0, 24)
  return {
    text: `“${snippet}”已经加进方案，其余照上一版。还要补就接着说，不用了直接开始制作。`,
    toolCalls: [{ label: '改方案', detail: '把这条并进方案要点' }],
  }
}

/* 与 StartCreation 同口径：首行过短 / 只有数字标点时不直接当名字 */
function usableName(text: string): string {
  const first = text.trim().split('\n')[0] ?? ''
  return first.length >= 2 && !/^[\d\s\p{P}]+$/u.test(first) ? first : ''
}

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
  onNewProject: () => void
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
  /* 行内重命名：editing = 正在编辑的 id，editText = 输入值 */
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const repliedRef = useRef(new Set<string>())
  const replyTimer = useRef<number | null>(null)
  const aliveRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1024)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /* 真实卸载后不再 setState。StrictMode 首次挂载会模拟一轮卸载，
     所以这里只置位、不做业务决定（见下方演示回复的 effect）。 */
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
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
    if (activeThread.messages.length > 0) chat.replaceMessages(activeThread.messages)
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

  /* 有新用户消息且还没回：演示 agent 900ms 后回一条（原型延迟，非真实推理耗时）
     ⚠️ 不能在这里 clearTimeout：StrictMode 挂载后会立刻跑一次 cleanup，
        定时器被清掉，而 repliedRef 已标记该条 → 第二次进入直接 return，
        回复永远不会来、pending 永远为 true（表现：一直「正在思考…」，
        从首页进入会话必现，输入框与发送键全被锁死）。
        定时器的生命周期改由 newSession / 卸载守卫处理。 */
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'user' || repliedRef.current.has(last.id)) return
    repliedRef.current.add(last.id)
    setPending(true)
    replyTimer.current = window.setTimeout(() => {
      replyTimer.current = null
      /* 卸载时放弃本条回复，并撤销“已回复”标记：再次进入本视图时会重新排期 */
      if (!aliveRef.current) { repliedRef.current.delete(last.id); return }
      chat.addAiMessage(demoReply(last.text, userMessages.length - 1))
      setPending(false)
    }, 900)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

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

  const submit = () => {
    const v = chat.draft.trim()
    if (!v || pending) return
    chat.addUserMessage(v)
    chat.setDraft('')
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) el.style.height = 'auto'
    })
  }

  /* 删除项目：会话不跟着删，按 dsh delete.desc 的语义落进「未分组」 */
  const onDeleteProject = (projectId: string) => {
    props.threads.sessions.filter((t) => t.projectId === projectId).forEach((t) => props.threads.moveTo(t.id, null))
    props.onDeleteProject?.(projectId)
  }

  const newSession = () => {
    /* 开新会话时把未落地的演示回复一起取消，否则旧对话的回复会插进新会话 */
    if (replyTimer.current !== null) {
      window.clearTimeout(replyTimer.current)
      replyTimer.current = null
    }
    setPending(false)
    chat.clearChat()
    /* 左栏也要真的多一条会话，否则「新对话」只清空了内容、树上什么都没变。
       归属沿用当前项目（在项目里开新对话，默认还是这个项目的活）；
       当前没有项目时落未分组，之后可拖过去。 */
    const t = props.threads.create({ projectId: props.openProject, workdir: null })
    loadedRef.current = t.id
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
        <div className="cv3-side-top">
          <button type="button" className="cv3-new" onClick={newSession} title="新建对话">
            <Plus size={15} /><span className="cv3-new-label">新对话</span>
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
          {grouped.length === 0 || noMatches ? (
            <p className="cv3-side-hint">{query.trim() ? '无匹配结果' : '暂无会话'}</p>
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
                      <span className="cv3-group-count num">{g.sessions.length}</span>
                    </button>
                    {!isUng && proj && (
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
        <button type="button" className="cv3-side-add" onClick={props.onNewProject}>
          <Plus size={14} />新建项目
        </button>
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
                  <div className="cv3-rich">{renderRich(m.text)}</div>
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
                  {m.plan && (
                    <div className="cv3-plan">
                      <b className="cv3-plan-title">制作方案</b>
                      <ol>
                        {m.plan.map((p, i) => <li key={i}>{p}</li>)}
                      </ol>
                      {!launched && (
                        <>
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
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {pending && (
                <p className="cv3-pending"><LoaderCircle className="cv3-spin" size={14} /> 正在整理…</p>
              )}
            </div>
          </div>

          <div className="cv3-seat">
            <form className="cv3-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
              <div className="cv3-card">
                <textarea className="cv3-input" rows={1} ref={inputRef}
                          value={chat.draft}
                          onChange={(e) => { chat.setDraft(e.target.value); growInput() }}
                          onKeyDown={onInputKeyDown}
                          placeholder="说说你想做的片子，或补充制作要求" />
                <div className="cv3-row">
                  <div className="cv3-trailing">
                    <button className="cv3-send" type="submit" disabled={!chat.draft.trim() || pending} aria-label="发送">
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </form>
            <footer className="cv3-status">
              <span className="cv3-pill">{userMessages.length} 条需求</span>
              {launched && (<><span className="cv3-sep">·</span><span className="cv3-pill">已开始制作</span></>)}
            </footer>
          </div>
        </div>
      </div>
    </div>
  )
}

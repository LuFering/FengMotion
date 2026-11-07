import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search as SeekSearch } from '@/components/Search'
import { WebSearchTrace, isSearchTool, type SearchCall } from '@/components/WebSearchTrace'
import {
  ChatMessage as ChatBubble, ChatComposer, ThinkingIndicator, MarkdownText,
  AnswerBody, AnswerActions, MessageActions, RunningDivider,
  TaskList, type TaskItem, type TaskStepChip,
} from '@/components/chat'
import type { CSSProperties } from 'react'
import {
  AlertCircle, Archive, ArchiveRestore, Check, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, FileText, FolderPlus, ImageIcon,
  ListFilter, LoaderCircle, MessageSquarePlus, PanelLeft, Pencil, Pin, PinOff, Shield,
  ShieldAlert, ShieldCheck, Trash2, X,
} from 'lucide-react'
import { registerComposer, type DeliverableAsset, type AssetPurpose } from '@/shell/usePendingAssets'
import { deliveredReferences } from '@/services/creationResources'
import { PURPOSE_LABEL } from '@/shell/usePendingAssets'
import { studioHttpApi } from '@/services/api'
import { newIdempotencyKey } from '@/services/api/config'
import { ApiError, userMessageForError } from '@/services/api/errors'

/** 用途 → 输入框里显示的短标签（与待发送面板同一套文案） */
const PURPOSE_TXT: Record<string, string> = PURPOSE_LABEL

/** 从空白进入（还没建会话）时，服务层用的会话键。
 *  必须是每段对话各一个键：两条未落盘的对话共用一个键会在适配器里串消息。 */
const DRAFT_SESSION = '__draft__'
import { HARNESSES, REASONING_LABEL, DEFAULT_PREFS, prefsKey, loadPrefs, savePrefs, type ModelPrefs, type Reasoning } from '../data/harnesses'
import { useHarnesses, availabilityOf, AVAILABILITY_LABEL, modelsOf } from '../shell/useHarnesses'
import type { ChatState, ChatMessage } from '../shell/useChat'
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
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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
 * 回复来源（2026-11-01 实况）：
 *   · 服务端会话：消息历史与发送都走真实接口（GET/POST /chat-sessions/{id}/messages），
 *     回复走真实 SSE —— 后端端点已就绪但 Agent 未接入，会如实返回 agent_unavailable，
 *     界面在回复位置写明「Agent 还没接入」，**不编回复**。
 *   · 本页草稿（未分组）：回复走 services/chatService 的演示适配器，消息上标「演示回复」。
 * 两条路径都不在视图里造数据 —— 那是「视图内造数据」，前后端协议第 1 条明令禁止。
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


/**
 * 工具调用列表的渲染。
 *
 * 实时（流式进行中）与历史（从服务端读回）两处都用它 —— 同一个语义必须长得一样，
 * 否则用户会以为是两种不同的东西。
 *
 * @param calls 调用记录
 * @param live  是否来自正在进行的流；历史记录没有「执行中」这种中间态
 */
/**
 * 已起过回复流的用户消息 id（模块级，跨组件卸载保留）。
 *
 * <p>切去工作台再切回来会让本视图重新挂载。<strong>后端不支持断点续读</strong>
 * （ChatStreamController 的 Last-Event-ID 只校验格式），所以「重新连上同一条流」
 * 做不到；能做的只有：记住已经跑过的那一轮，不要重复起流，
 * 并把真实结果从服务端消息里读回来。</p>
 */
const MODULE_SERVED_IDS = new Set<string>()

/**
 * 已经失败过的用户消息 id（模块级，跨卸载保留）。
 *
 * <p>为什么必须记：失败时 `onError` 会把占位的 AI 消息删掉，于是
 * 「最后一轮没有 AI 回复」这个条件重新成立，自动起流的 effect 会再起一次 ——
 * 引擎持续失败时就是一个**无限重试循环**（真机实测：错误提示已经显示，
 * 思考态却还在跑，计时器一路涨到 0:37 并继续）。
 * 记下失败的 id，自动路径就不再重试；用户点「重试」才重发。</p>
 */
const MODULE_FAILED_IDS = new Set<string>()


/**
 * 把工具调用转成 TaskList 的任务。
 *
 * ⚠️ 只处理**非搜索类**调用：网页搜索有自己的一套轨迹（WebSearchTrace），
 * 它回答的是「去查了什么来源」，和「执行了哪些命令」不是一件事。
 * 混在一张任务列表里，两类信息会互相稀释。
 *
 * 按工具名归组、保留首次出现顺序（顺序就是实际发生顺序）：
 * 一轮十几次 bash/read/write 平铺成一行一个，看起来是「一堆零散动作」；
 * 归成「读文件 / 执行命令 / 写文件」几个任务，才看得出这一轮做了哪几类事。
 */
function toolCallsToTasks(calls: SearchCall[], running: boolean): TaskItem[] {
  const groups = new Map<string, SearchCall[]>()
  for (const call of calls) {
    const list = groups.get(call.name)
    if (list) list.push(call)
    else groups.set(call.name, [call])
  }

  return [...groups.entries()].map(([name, list]) => {
    const failed = list.filter((c) => c.isError).length
    const done = list.filter((c) => c.done === true).length
    const allDone = done === list.length
    return {
      title: `${name} · ${list.length} 次${failed > 0 ? ` · ${failed} 失败` : ''}`,
      runningTitle: running && !allDone ? `正在执行 ${name}` : undefined,
      /* 每类工具一个图标：bash / read / write / web_fetch 之间要能一眼分开。
         ⚠️ 必须把 className 透传下去：TaskList 用它挂 .tl-task-icon
         （16px 盒 + --dim 颜色）。不透传的话图标会按 SVG 默认尺寸与继承色渲染，
         尺寸和颜色都与网页搜索的图标对不上。 */
      icon: function Icon({ className }: { className?: string }) {
        return <ToolIcon name={name} className={className} />
      },
      steps: list.map((call) => {
        const chips = call.arguments ? toolChips(call.arguments) : []
        return {
          label: call.arguments ? shortArgs(call.arguments) : `${name} 调用`,
          /* 失败标记优先：出错时最该看到的是「失败了」，不是它碰了哪个文件 */
          chips: call.isError ? [{ label: '失败' }] : (chips.length > 0 ? chips : undefined),
        }
      }),
    }
  })
}

/**
 * TaskList 的 revealed 是「单元数」：每个任务 1 个标题单元 + 每步 1 个单元。
 * 按真实到达数算，不编造进度。
 */
function toolCallsRevealed(calls: SearchCall[]): number {
  const groups = new Map<string, number>()
  for (const call of calls) groups.set(call.name, (groups.get(call.name) ?? 0) + 1)
  let total = 0
  for (const n of groups.values()) total += 1 + n
  return total
}


/**
 * 工具名 → 图标。
 *
 * 为什么每个任务要有图标：网页搜索那块的标题有一个放大镜，任务列表没有，
 * 两块并排时一眼就能看出「一个是检索、一个是执行」；但任务列表内部
 * bash / read / write / web_fetch 之间完全没有区分，只能靠读文字。
 *
 * 图标用内联 SVG（stroke 描边、18×18），与 WebSearchTrace 的 LensIcon 同一套画法 ——
 * 引用 lucide 会让两种图标在同一行里线宽不一致。
 */
function ToolIcon({ name, className }: { name: string; className?: string }) {
  const n = name.toLowerCase()
  /* className 由 TaskList 传入（.tl-task-icon，负责 16px 盒与颜色）；
     .tl-task-svg 负责线宽与填充。两个都要，否则图标没有尺寸约束。 */
  const common = {
    viewBox: '0 0 18 18',
    'aria-hidden': true,
    className: `tl-task-svg${className ? ` ${className}` : ''}`,
  } as const

  /* 终端 / 命令 */
  if (n.includes('bash') || n.includes('shell') || n.includes('pwsh') || n.includes('terminal')) {
    return (
      <svg {...common}>
        <rect x="2" y="3.5" width="14" height="11" rx="2" />
        <path d="M5.2 7.4 L7.4 9.4 L5.2 11.4" />
        <path d="M9.4 11.4 H12.6" />
      </svg>
    )
  }
  /* 读文件 */
  if (n === 'read' || n.includes('read_file') || n.includes('readfile')) {
    return (
      <svg {...common}>
        <path d="M4 2.5 H11 L14 5.5 V15.5 H4 Z" />
        <path d="M11 2.5 V5.5 H14" />
      </svg>
    )
  }
  /* 写 / 编辑文件 */
  if (n === 'write' || n.includes('write') || n.includes('edit') || n.includes('str_replace')) {
    return (
      <svg {...common}>
        <path d="M3 15 L3.6 11.8 L11.8 3.6 L14.4 6.2 L6.2 14.4 Z" />
        <path d="M10.6 4.8 L13.2 7.4" />
      </svg>
    )
  }
  /* 抓网页 */
  if (n.includes('fetch') || n.includes('http') || n.includes('url')) {
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="6.5" />
        <path d="M2.5 9 H15.5" />
        <path d="M9 2.5 C11.4 4.8 11.4 13.2 9 15.5" />
      </svg>
    )
  }
  /* 目录 / 列文件 */
  if (n.includes('ls') || n.includes('dir') || n.includes('glob') || n.includes('list')) {
    return (
      <svg {...common}>
        <path d="M2.5 5.5 H7 L8.5 7.2 H15.5 V14 H2.5 Z" />
      </svg>
    )
  }
  /* 搜索类（理论上已被 WebSearchTrace 拿走，兜底） */
  if (n.includes('search') || n.includes('grep') || n.includes('find')) {
    return (
      <svg {...common}>
        <circle cx="7.6" cy="7.6" r="5.4" />
        <path d="M11.6 11.6 L15.4 15.4" />
      </svg>
    )
  }
  /* 兜底：一个圆点，不编造含义 */
  return (
    <svg {...common}>
      <circle cx="9" cy="9" r="3.2" />
    </svg>
  )
}


/**
 * 从工具参数里抽出「这一步碰到了哪些文件」。
 *
 * 对应 BoardUI 任务列表的 chips：步骤行右侧跟一串小标签，
 * 每个标签是一个文件名 + 文件类型图标。它解决的问题是
 * 「Read / 写 / 编辑 这些动词本身没有信息量」——真正想知道的是
 * 它读了哪个文件。
 *
 * 只从参数里取真实出现的路径，不做推测：
 * 认 file_path / path / file 这类字段，以及命令里看起来像文件名的词。
 */
function toolChips(args: string): TaskStepChip[] {
  let parsed: Record<string, unknown> | null = null
  try {
    const v = JSON.parse(args)
    if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>
  } catch {
    /* 非 JSON：下面按命令文本猜 */
  }

  const paths: string[] = []
  if (parsed) {
    for (const k of ['file_path', 'path', 'file', 'target', 'filename']) {
      const v = parsed[k]
      if (typeof v === 'string' && v.trim()) paths.push(v.trim())
    }
  }
  /* 命令里出现的文件名：取最后一个路径段，过滤掉纯参数与 URL */
  if (paths.length === 0) {
    const text = parsed ? String(parsed.command ?? '') : args
    for (const word of text.split(/\s+/)) {
      if (!/[./]/.test(word)) continue
      if (word.startsWith('-') || word.startsWith('http')) continue
      const base = word.replace(/^["']|["']$/g, '').split('/').pop() ?? ''
      if (base && /\.\w+$/.test(base)) paths.push(base)
    }
  }

  return paths.slice(0, 4).map((p) => {
    const label = p.split('/').pop() || p
    return { label, icon: <FileTypeIcon name={label} /> }
  })
}


/**
 * 文件类型图标（chip 里的那个小字）。
 *
 * BoardUI 用 React 官方图标标 .tsx 文件；本项目没有那套品牌图标，
 * 改成按扩展名区分的通用图形 —— 目的是「一眼看出这是代码还是文档」，
 * 不是「认出这是哪个框架」。
 */
function FileTypeIcon({ name }: { name: string }) {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const common = { viewBox: '0 0 16 16', 'aria-hidden': true, className: 'tl-chip-svg' } as const

  /* 代码类 */
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'sh'].includes(ext)) {
    return (
      <svg {...common}>
        <path d="M5.6 4.4 L2.6 8 L5.6 11.6" />
        <path d="M10.4 4.4 L13.4 8 L10.4 11.6" />
      </svg>
    )
  }
  /* 配置 / 数据 */
  if (['json', 'yml', 'yaml', 'toml', 'xml', 'csv'].includes(ext)) {
    return (
      <svg {...common}>
        <path d="M3 3 H13 V13 H3 Z" />
        <path d="M3 6.5 H13" />
      </svg>
    )
  }
  /* 文档 */
  if (['md', 'txt', 'doc', 'docx', 'pdf'].includes(ext)) {
    return (
      <svg {...common}>
        <path d="M4 2 H10 L12.5 4.5 V14 H4 Z" />
        <path d="M6 7 H10.5" />
        <path d="M6 9.8 H10.5" />
      </svg>
    )
  }
  /* 图片 / 视频 */
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'mp4', 'mov', 'webm'].includes(ext)) {
    return (
      <svg {...common}>
        <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
        <path d="M2.5 10.5 L6 7.5 L9 10" />
      </svg>
    )
  }
  /* 兜底：普通文件 */
  return (
    <svg {...common}>
      <path d="M4 2 H10 L12.5 4.5 V14 H4 Z" />
    </svg>
  )
}

/**
 * 参数摘要。
 *
 * ⚠️ 不能直接把 JSON 原文截断显示 —— 实测步骤行会变成
 * `{"description":"Run echo hello and report out...`，用户读不出「在干什么」。
 * 工具参数是有结构的，要按已知字段取「人话」那一段：
 *   command / description / file_path / path / pattern / query / url
 * 都不认识时才退回「键名：值」的压缩形式。
 */
function shortArgs(args: string): string {
  let parsed: Record<string, unknown> | null = null
  try {
    const v = JSON.parse(args)
    if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>
  } catch {
    /* 不是 JSON（例如纯命令字符串）：直接当文本用 */
  }

  if (!parsed) {
    const oneLine = args.replace(/\s+/g, ' ').trim()
    return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine
  }

  /* 优先级按「哪个字段最能说明这一步在干什么」排 */
  const KEYS = ['description', 'command', 'query', 'pattern', 'file_path', 'path', 'url', 'prompt']
  for (const k of KEYS) {
    const v = parsed[k]
    if (typeof v === 'string' && v.trim()) return truncate(v.trim())
  }

  /* 兜底：取前两个字符串字段，拼成「键：值」 */
  const parts = Object.entries(parsed)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .slice(0, 2)
    .map(([k, v]) => `${k}=${String(v)}`)
  return truncate(parts.join(' ') || '（无参数）')
}

function truncate(t: string): string {
  const oneLine = t.replace(/\s+/g, ' ').trim()
  return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine
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


export function Conversation(props: {
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
  onLaunch: (r: { workflowId: string; projectId: string | null; autoRun: boolean }) => void
  onOpenWorkbench: () => void
  /** 会话树（项目 + 对话两级）：左栏用它，拖拽改归属也走它 */
  threads: SessionsState
  /** 当前会话 id；null = 还没有会话（从空白进入） */
  activeSessionId: string | null
  homeTransfer?: { sessionId: string; draft: string; files: { file: File; kind: 'file' | 'image' | 'video' }[] } | null
  onHomeTransferConsumed?: () => void
  /** 归档项目：移出列表，项目目录与成片保留在磁盘上。 */
  onArchiveProject?: (projectId: string) => Promise<void>
  /** 删除项目：物理删除，项目目录与成片一并删掉，不可撤销。
      返回 Promise 是为了让失败能落到左栏的错误提示，而不是静默关掉对话框。 */
  onDeleteProject?: (projectId: string) => Promise<void>
}) {
  const { chat } = props
  const [projectPending, setProjectPending] = useState(false)
  /** 新建项目/开始制作失败（服务端拒绝/连不上）：明确的错误，不做乐观成功 */
  const [projectError, setProjectError] = useState<string | null>(null)
  const showProjectError = (error: unknown) => setProjectError(error instanceof Error ? error.message : '项目操作失败')
  /** 服务端会话发送失败的原因（没有发出去）：显示在输入框上方，草稿保留可重试 */
  const [sendError, setSendError] = useState<string | null>(null)
  /** 服务端回复的如实说明（Agent 未接入等）：显示在最后一条用户消息下方。
      与 `failed` 分开：能力缺口不是「回复失败」，重试也不会好。 */
  const [replyNote, setReplyNote] = useState<string | null>(null)
  /* 同一次发送重试复用同一个幂等键（README §2.7）；发送成功后清空 */
  const idemKeyRef = useRef<string | null>(null)
  /* 卸载后不再回写状态：发送/回复的异步回调可能晚于卸载到达 */
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const [proPath, setProPath] = useState<WfPath>('prompt-first')
  const [pending, setPending] = useState(false)
  /** 本轮开始时间：给 ThinkingIndicator 的计时器用。
      记在 state 里而不是渲染时 Date.now()，否则每帧都会变、计时器会抖。 */
  const [pendingStartedAt, setPendingStartedAt] = useState<number | null>(null)
  /**
   * 每秒自增一次，只为驱动思考态计时器的重渲染。
   *
   * 不在渲染里直接 Date.now()：那样要等别的原因触发重渲染，数字才会跳，
   * 实测会一直停在 0:00（没有 state 变化就没有重渲染）。
   */
  /* tick 的值本身不参与渲染，它只是「让这个组件每秒重算一次」的开关：
     elapsed 是算出来的（now - startedAt），父组件不重渲染就不会更新。 */
  const [tick, setTick] = useState(0)
  void tick
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [pending])
  /**
   * Agent 当前阶段。
   *
   * 正文由 `delta` 逐 token 到达（见后端 §11），所以这里的阶段只负责回答
   * 「模型在想、还是在跑工具」。工具阶段额外带 `callId` / `arguments`：
   * 后端把 DSH 的 `tool/call` 结构化透传过来了，界面才有机会显示
   * 「在跑哪个工具、参数是什么」，而不是只有一句「正在调用工具」。
   */
  const [agentPhase, setAgentPhase] = useState<{
    phase: string
    label?: string
    callId?: string
    arguments?: string
    isError?: boolean
  } | null>(null)

  /**
   * 本轮的完整工具调用记录。
   *
   * 与 `agentPhase` 的区别：`agentPhase` 只描述**当前**在做什么，流结束时清空；
   * `toolCalls` 保留整轮的每一次调用，让用户能回头看「刚才跑了什么、哪个失败了」。
   * 视频任务里一轮可能有十几次工具调用，只看当前一个等于没有记录。
   *
   * 按 `callId` 归并：开始帧建条目，结果帧翻转状态。没有 callId 的帧
   * （理论上不该出现，后端在缺 ID 时不下发）单独成条，不硬塞进上一条。
   */
  const [toolCalls, setToolCalls] = useState<{
    callId: string
    name: string
    arguments?: string
    isError?: boolean
    done: boolean
  }[]>([])

  /**
   * `toolCalls` 的镜像。
   *
   * 为什么需要：`onCompleted` 的闭包是建流那一刻捕获的，读 `toolCalls` 只会拿到
   * 当时的空数组（state 更新不会改已捕获的闭包）。用 ref 才能取到本轮最新的记录。
   */
  const toolCallsRef = useRef<{
    callId: string
    name: string
    arguments?: string
    isError?: boolean
    done: boolean
  }[]>([])

  /**
   * 本轮累计的 token 用量。
   *
   * 一轮可能有多次模型调用（每步一次），所以按桶累加而不是覆盖最后一次。
   * `cacheReadTokens` 单独累计：它含在 `totalTokens` 里，不重复加进 input。
   */
  const [usage, setUsage] = useState<{
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    totalTokens?: number
  } | null>(null)
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
  /* 归档确认：待归档的项目；null = 没在归档。归档只是移出列表，文件留着。 */
  const [archivingProject, setArchivingProject] = useState<ProjectSummary | null>(null)
  /* 删除确认：待删的项目；null = 没在删。
     删除走物理删除，项目目录真的被删掉，所以确认框要用户输入项目名。 */
  const [deletingProject, setDeletingProject] = useState<ProjectSummary | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  /* 删除确认框里输入的项目名：必须与项目名完全一致才让删。
     不可撤销的操作不能靠一次点击就生效 —— 手滑点错的代价太大。 */
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  /**
   * 确认归档项目：移出列表，文件留着。
   *
   * <p>失败时关掉对话框并把原因留在左栏：项目仍在列表里，
   * 让用户看见「没删掉」比对话框一直卡在原地有用。</p>
   */
  const confirmArchiveProject = useCallback(async () => {
    if (!archivingProject) return
    if (!props.onArchiveProject) {
      setProjectError('归档项目未接入')
      setArchivingProject(null)
      return
    }
    setDeletingBusy(true)
    try {
      await props.onArchiveProject(archivingProject.id)
      setArchivingProject(null)
    } catch (error) {
      showProjectError(error)
      setArchivingProject(null)
    } finally {
      setDeletingBusy(false)
    }
  }, [archivingProject, props])

  /**
   * 确认删除项目：物理删除，目录与成片真的被删掉。
   *
   * <p>要求项目名逐字一致才放行：这一步不可撤销，
   * 一次误点就可能丢掉几十分钟的渲染成果。</p>
   */
  const confirmDeleteProject = useCallback(async () => {
    if (!deletingProject) return
    /* 没接上删除实现时如实说「没删」，不能关掉对话框装作删掉了 ——
       项目还在列表里，用户会以为是自己看错了。 */
    if (!props.onDeleteProject) {
      setProjectError('删除项目未接入')
      setDeletingProject(null)
      return
    }
    setDeletingBusy(true)
    try {
      await props.onDeleteProject(deletingProject.id)
      setDeletingProject(null)
      /* 连输入框一起清掉：这段文字是上一次删除的残留，
         留在 state 里会让下一个删除框直接带着上次的项目名出现 ——
         上次输的恰好就是这次的项目名时，按钮会直接可点。 */
      setDeleteConfirmText('')
    } catch (error) {
      showProjectError(error)
      setDeletingProject(null)
      setDeleteConfirmText('')
    } finally {
      setDeletingBusy(false)
    }
  }, [deletingProject, props])

  /* ── 输入区工具栏（对齐 dsh InputBar：左侧附件/权限，右侧模型/发送）──
     attachments=待发送附件；permission=权限模式（dsh preset.readOnly/workspaceWrite/fullAccess）；
     harnessId/model/prefs=引擎与模型配置（与首页共用同一份 data/harnesses）；
     composerMenu=当前展开的弹层（'add' 附件菜单 / 'perm' 权限 / 'model' 模型） */
  const [attachments, setAttachments] = useState<{
    name: string; size: number; kind: 'file' | 'image' | 'video' | 'technique'
    /* 资源类型：素材 / 参考片段 / 技法。参考片段与技法没有可上传的文件，
       但仍要随消息带给 agent —— 它们的价值在于「借鉴什么」，不是文件本身。 */
    source?: 'asset' | 'ref' | 'fx'
    refVideoId?: string; refStart?: number; refEnd?: number; refWants?: string
    fxId?: string; fxVersion?: string
    uploadId?: string
    /* 来自「待发送」的附件带着用途与备注：界面要显示「logo.png · 用于画面」，
       而不只是塞一串文件名 —— 用途是用户特意选的，丢在这里等于白选。 */
    purpose?: string; note?: string; assetId?: string
    /* 上传结果。选文件后立刻上传，发送时只带 fileId ——
       契约要求「附件先上传、消息只引用 fileId」，不在这里带路径或原始字节。 */
    fileId?: string
    mimeType?: string
    /* 上传中 / 失败。失败时仍然显示这个附件（带着原因），
       而不是静默消失让用户以为选上了。 */
    uploading?: boolean
    uploadError?: string
  }[]>([])
  const [permission, setPermission] = useState<'readOnly' | 'workspaceWrite' | 'fullAccess'>('workspaceWrite')
  const [harnessId, setHarnessId] = useState(HARNESSES[0].id)
  const [model, setModel] = useState(HARNESSES[0].models[0])
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
  /** 当前会话是否来自服务端。服务端会话：消息历史与发送都走真实接口；
      回复（SSE）后端已就绪但 Agent 未接入，会如实返回 agent_unavailable，
      所以这类会话不发演示回复 —— 演示回复只能属于「仅本页」的草稿会话。 */
  const activeThread = props.threads.sessions.find((t) => t.id === props.activeSessionId) ?? null
  const activeIsServer = activeThread?.origin === 'server'
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
  const loadMessages = props.threads.loadMessages
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
      const inFlight = chat.messages.filter((m) => m.streaming)
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

  /* 切会话 / 卸载：断掉服务端回复流。
     不断的话，上一条会话的 delta 会追加进新会话的 chat（回复插错地方），
     而且重挂载会留下一条半截回复。断线不当作完成 —— 与服务端流的口径一致。 */
  useEffect(() => () => {
    streamStopRef.current?.()
    streamStopRef.current = null
    setPending(false)
    setReplyNote(null)
    setSendError(null)
    idemKeyRef.current = null
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
  const messages = useMemo(() => chat.messages.filter((m) => m.id !== 'intro'), [chat.messages])
  /**
   * 当前这轮实时推理的文本。
   *
   * 推理是「边想边说」的：帧到达时 AI 消息的 text 还是空的，thinking 已经有内容。
   * 所以取最后一条 AI 消息的 thinking，而不是等整轮结束。
   */
  const streamingThinking = useMemo(() => {
    const last = messages[messages.length - 1]
    return last?.role === 'ai' ? (last.thinking ?? '') : ''
  }, [messages])

  /**
   * 本轮推理的最终文本。
   *
   * 与 streamingThinking 分开：那个只在「最后一条是 AI 且还在流」时有值，
   * 一轮结束后就变空 —— 于是「思考」任务会从列表里消失，用户再也看不到
   * 这一轮想过什么。这里取本轮所有 AI 消息的 thinking 中最后一段非空的，
   * 让结束后仍可回看（与历史路径的呈现一致）。
   */
  const lastThinking = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'ai' && m.thinking) return m.thinking
    }
    return ''
  }, [messages])
  const userMessages = useMemo(() => messages.filter((m) => m.role === 'user'), [messages])

  /* 最新的用户消息 id：回复 effect 只依赖它（见下方说明，不能依赖整个数组） */
  const lastUserId = userMessages.length > 0 ? userMessages[userMessages.length - 1].id : null

  /* 需求确认卡的数据经服务层投影而来（视图不自己拼数据）。
     投影覆盖「原文 + 后续纠正」，原文始终原样呈现。 */
  const reqTexts = useMemo(() => userMessages.map((m) => m.text), [userMessages])
  const reqCard = useMemo(() => requirementCard(reqTexts), [reqTexts])
  const reqConfirmed = useMemo(() => isRequirementConfirmed(reqTexts), [reqTexts])

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
  /* 服务端会话的续流：切去工作台会让本视图卸载，卸载时那条流被 cleanup 断掉。
     后端不支持断点续读（Last-Event-ID 只校验格式），所以这里不尝试「接上旧流」，
     而是在回到本视图时判断「最后一轮是否留下了没有回复的用户消息」：
     有就重起一次流，让用户能接着说话，而不是永远卡在「正在回复…」或干脆没反应。

     注意：重起等于让 agent 再跑一遍这一轮。这正是原先失败的点 ——
     旧代码直接 return，切回来就什么都不做，用户再发消息也失败。 */
  useEffect(() => {
    if (!activeIsServer) return
    if (!props.activeSessionId) return
    if (lastUserId === null) return
    /* 最后一轮已经有 AI 回复：这轮结束了，不用再起流 */
    const at = messages.findIndex((m) => m.id === lastUserId)
    if (at >= 0 && messages.slice(at + 1).some((m) => m.role === 'ai')) return
    /* 同一条已经在跑（首次挂载刚起的流）：不要重复 */
    if (servedRef.has(lastUserId) && pending) return
    /* 失败过的不要再自动重起：会变成无限重试（见 MODULE_FAILED_IDS 注释） */
    if (MODULE_FAILED_IDS.has(lastUserId)) return
    servedRef.add(lastUserId)
    startServerReply()
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
    if (MODULE_FAILED_IDS.has(lastUserId)) return
    servedRef.add(lastUserId)
    setPendingStartedAt(Date.now())
    setPending(true)
    return startReply()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUserId, activeIsServer])

  /* 新消息进来滚到底（只在接近底部时跟随，不抢用户翻历史） */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  /**
   * 用户是否已经翻离底部。
   *
   * dsh 在翻离底部时给一个 34px 的「回到最新」圆钮（.dM7RPG_toBottom）：
   * 生成中内容一直往下长，翻上去看历史的人需要一个明确的一步返回，
   * 否则只能自己一路往下滚。
   */
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const onScrollTrack = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setAwayFromBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 320)
  }, [])
  const backToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])


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
  const startServerReply = () => {
    const sessionId = props.activeSessionId
    if (!sessionId) return
    streamStopRef.current?.()
    const aiId = chat.startAiMessage({ demo: false })
    let produced = false
    setPendingStartedAt(Date.now())
    setPending(true)
    // 新的一轮从零开始记工具调用：上一轮的记录属于上一条回复，留着会串味。
    setToolCalls([])
    toolCallsRef.current = []
    setUsage(null)
    const handle = studioHttpApi().chat.stream(sessionId, {
      /* 推理增量进「思考过程」块，不进正文 */
      onReasoning: (_messageId, delta) => {
        chat.appendAiReasoning(aiId, delta)
      },
      onDelta: (_messageId, delta) => {
        produced = true
        chat.appendAiText(aiId, delta)
      },
      onCompleted: (message) => {
        produced = true
        // 带上本轮工具记录：completed 到服务端消息读回之间有个异步空档，
        // 不先挂上去，列表会在这一瞬间闪空。
        chat.finishAiMessage(aiId, message.text, toolCallsRef.current, message.reasoning)
        /* 服务端会话的内容以 server 消息数组为准（见上方 serverMirror 的说明）。
           这里必须把刚落库的回复重新读回来：否则下一次发消息、或任何让
           `activeThread.messages` 身份变化的操作，都会用「只有用户消息」的数组
           覆盖 chat，把这条回复冲掉 —— 实测就是这样丢掉上一轮回答的。
           只对 server 会话做：本地草稿没有服务端历史可读。 */
        if (props.threads.sessions.some((t) => t.id === sessionId && t.origin === 'server')) {
          void loadMessages(sessionId, { force: true })
        }
      },
      onError: (error) => {
        // 能力缺口：删掉占位，改用「Agent 未接入」说明，不当作回复失败
        chat.removeMessage(aiId)
        /* 记下这条失败，自动路径不再重试 —— 否则删掉占位后
           「最后一轮没有 AI 回复」又成立，effect 会无限重起流。 */
        const failedUser = [...messages].reverse().find((mm) => mm.role === 'user')
        if (failedUser) MODULE_FAILED_IDS.add(failedUser.id)
        setPending(false)
        setPendingStartedAt(null)
        setAgentPhase(null)
        setReplyNote(error.isCapabilityGap
          ? 'Agent 暂时不可用：这条消息已保存在服务端，但没有收到回复。'
          : `没有拿到回复：${userMessageForError(error, '回复流中断了。')}`)
      },
      onStatus: (status) => {
        if (status.phase === 'thinking') {
          setAgentPhase({ phase: 'thinking' })
        } else if (status.phase === 'tool') {
          /* 工具阶段保留结构化字段。同一 callId 的结果帧只翻转 isError，
             不把 name/label/arguments 清空 —— 后端结果帧不带 name（避免重复下发），
             若整个覆盖，界面上「正在调用 bash」的名字会在结束瞬间消失。 */
          setAgentPhase((prev) => {
            const sameCall = prev?.phase === 'tool' && status.callId !== undefined
              && prev.callId === status.callId
            const name = status.name ?? (sameCall ? prev?.label : undefined)
            return {
              phase: 'tool',
              ...(name ? { label: name } : {}),
              ...(status.callId ? { callId: status.callId } : (sameCall && prev?.callId ? { callId: prev.callId } : {})),
              /* 参数只在开始帧有；结果帧沿用上一次的值，避免中途被抹掉 */
              ...(status.arguments !== undefined
                ? { arguments: status.arguments }
                : (sameCall && prev?.arguments !== undefined ? { arguments: prev.arguments } : {})),
              ...(status.isError ? { isError: true } : {}),
            }
          })
          /* 同时维护整轮调用记录。规则：
             · 有 arguments → 这是一次新调用的开始帧，追加条目
             · 没有 arguments 且带 callId → 结果帧，回填对应条目的 done/isError
             不按「有没有 isError」判断开始还是结束：失败的结果帧才有 isError，
             成功的结果帧两者都没有，只能靠 arguments 的有无来区分。 */
          /* 每处更新都同时写 ref：`onCompleted` 的闭包读不到最新 state，
             只能靠 ref 取本轮完整记录。两处（state / ref）必须在同一个更新函数里，
             拆开写会漏掉其中一条路径。 */
          if (status.arguments !== undefined) {
            setToolCalls((prev) => {
              const next = [
                ...prev,
                {
                  callId: status.callId ?? `anon-${prev.length}`,
                  name: status.label ?? status.name ?? '工具',
                  ...(status.arguments ? { arguments: status.arguments } : {}),
                  done: false,
                },
              ]
              toolCallsRef.current = next
              return next
            })
          } else if (status.callId) {
            const target = status.callId
            setToolCalls((prev) => {
              const next = prev.map((c) => (
                c.callId === target
                  ? { ...c, done: true, ...(status.isError ? { isError: true } : {}) }
                  : c
              ))
              toolCallsRef.current = next
              return next
            })
          }
        } else {
          setAgentPhase(null)
        }
      },
      onState: (state) => {
        if (state.phase === 'ended' || state.phase === 'failed' || state.phase === 'aborted') {
          setPending(false)
          setAgentPhase(null)
          // 结束但没有产出任何内容：撤掉空占位，别留一个「正在回复…」看起来像卡死
          if (!produced) chat.removeMessage(aiId)
        }
      },
      onTitle: (title) => {
        /* 引擎给会话命了名：同步到左栏，用户不用刷新就能看到。
           后端已经落库，这里只是把同一事实反映到界面，不是本地伪造。 */
        props.threads.adoptServerTitle(sessionId, title)
      },
      onUsage: (u) => {
        /* 按桶累加：一轮里每个模型调用都会报一次，用户关心的是「这一轮总共花了多少」。
           缺失的桶保持 undefined 而不是 0 —— 界面上显示「未报告」比显示「0」诚实。 */
        setUsage((prev) => {
          const add = (a: number | undefined, b: number | undefined) =>
            a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)
          return {
            ...(add(prev?.inputTokens, u.inputTokens) !== undefined
              ? { inputTokens: add(prev?.inputTokens, u.inputTokens) } : {}),
            ...(add(prev?.outputTokens, u.outputTokens) !== undefined
              ? { outputTokens: add(prev?.outputTokens, u.outputTokens) } : {}),
            ...(add(prev?.cacheReadTokens, u.cacheReadTokens) !== undefined
              ? { cacheReadTokens: add(prev?.cacheReadTokens, u.cacheReadTokens) } : {}),
            ...(add(prev?.totalTokens, u.totalTokens) !== undefined
              ? { totalTokens: add(prev?.totalTokens, u.totalTokens) } : {}),
          }
        })
      },
    })
    streamStopRef.current = () => handle.close()
  }

  /** 发送失败的原因（人话优先；网络/未找到/内容不合规各有说法）。 */
  const sendErrorText = (cause: unknown): string => {
    if (cause instanceof ApiError) {
      if (cause.code === 'network_error') return '无法连接本地服务，消息没有发出去。请确认后端已启动。'
      if (cause.code === 'not_found') return '服务端没有找到这条会话，消息没有发出去。'
      if (cause.code === 'validation_error' && cause.message.trim()) return cause.message
      return userMessageForError(cause, '消息没有发出去。')
    }
    return cause instanceof Error ? cause.message : '消息没有发出去。'
  }


  const send = (text: string) => {
    const v = text.trim()
    if (pending) return
    if (!v) {
      if (attachments.length) setSendError('请填写一条消息后再发送附件。')
      return
    }
    if (attachments.length && !activeIsServer) {
      setSendError('当前对话未保存到项目，附件无法随消息发送。请先创建或选择项目会话。')
      return
    }
    /* 上传状态只对**真实文件素材**有意义。
       参考片段与技法没有文件可上传，它们的价值是「借鉴什么」，
       拿 fileId / MIME 去校验会把它们全判成「不合格附件」而发不出去。 */
    const fileAttachments = attachments.filter((a) => !a.assetId && (a.source ?? 'asset') === 'asset')
    if (fileAttachments.some((a) => !a.fileId || a.uploading || a.uploadError)) {
      setSendError('请等待附件上传完成；上传失败的附件请移除后重新添加。')
      return
    }
    if (fileAttachments.some((a) => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(a.mimeType ?? ''))) {
      setSendError('当前 AI 只能接收 PNG、JPEG、WebP 或 GIF 图片，请移除其他附件。')
      return
    }
    if (activeIsServer) { void sendToServer(v); return }
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

  /**
   * 服务端会话发送：先落库，再显示。
   *
   * 为什么不做乐观插入：契约（agent.md §3）要求「服务端先保存真实用户消息」，
   * 没落库就显示成已发送是假的。这里等服务端 202 返回 `message` 之后才写进会话 ——
   * 失败时消息根本不会出现在对话里，草稿留在输入框，用户能直接重试。
   *
   * 幂等键（README §2.7）：同一个草稿重复提交必须复用同一个键，否则会写出两条
   * 一样的消息。键随草稿内容绑定，发送成功后清掉，下次新输入换新键。
   */
  const sendToServer = async (text: string) => {
    const sessionId = props.activeSessionId
    if (!sessionId || !activeIsServer) return
    const key = idemKeyRef.current ?? newIdempotencyKey()
    idemKeyRef.current = key
    setSendError(null)
    try {
      /* 只把「上传成功」的附件带上。上传中或失败的跳过 ——
         带一个没有 fileId 的附件过去，后端只能忽略或报错，都不如不带。
         用户看到失败标记时可以选择重试或去掉它。 */
      const ready = attachments
        .filter((a) => a.fileId && !a.uploading && !a.uploadError)
        // 字段名对齐契约 TaskAttachment：sizeBytes 而不是 size，不额外塞 kind
        // （后端能由 mimeType 推出归类，重复字段只会带来不一致风险）
        .map((a) => ({
          fileId: a.fileId!,
          name: a.name,
          mimeType: a.mimeType ?? '',
          sizeBytes: a.size,
        }))
      /* 参考片与特效走 references 通道。
         它们没有文件可传，但必须让 agent 知道「这是要借鉴的片段/技法」——
         塞进 attachments 会被 fileId 校验挡掉，等于送不进去。 */
      const refs = deliveredReferences(attachments
        .filter((item) => item.assetId)
        .map((item) => ({ ...item, assetId: item.assetId!, purpose: (item.purpose ?? 'unspecified') as AssetPurpose })))
      const saved = await props.threads.sendMessage(sessionId, text, {
        idempotencyKey: key,
        ...(ready.length > 0 ? { attachments: ready } : {}),
        ...(refs.length > 0 ? { references: refs } : {}),
      })
      if (!mountedRef.current) return
      idemKeyRef.current = null
      chat.setDraft('')
      setAttachments([])
      /* 刚发出去的这条不在「服务端历史镜像」里（mirror 只跟着会话对象走），
         先写进 chat，下面起回复流时它才在对话里。会话对象里已经有一条同样内容的
         记录，切走再回来会以那一份为准，不会重复。 */
      chat.appendMessage(saved)
      /* 消息已保存，但回复要等 Agent：后端 SSE 端点已就绪，当前如实返回
         agent_unavailable。起一次回复流 —— 接上 Agent 就是正常流式，
         接不上就在回复位置写明「Agent 未接入」，而不是让用户以为回复还在路上。 */
      startServerReply()
    } catch (cause) {
      if (!mountedRef.current) return
      // 没有发出去：消息不显示、草稿保留、给出原因；幂等键保留以便原样重试
      setSendError(sendErrorText(cause))
    }
  }

  /**
   * 重试这一轮：把最后一条用户消息原样再发一次。
   *
   * 为什么不是「重新请求服务端生成」：本项目的回复来自一轮真实的 Agent 执行，
   * 后端不支持断点续读（Last-Event-ID 只校验格式），所以「接着刚才那条继续」
   * 做不到。能做的是把同一句话再发一遍 —— 幂等键保证服务端不会重复落库。
   */
  const retryLastRound = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser || pending) return
    /* 用户主动重试：清掉失败标记，否则自动路径与手动路径都被挡住 */
    MODULE_FAILED_IDS.delete(lastUser.id)
    servedRef.delete(lastUser.id)
    send(lastUser.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, pending])

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
  /* 未接入的引擎不许发送（与首页同口径），附件/草稿至少有一个才算有内容。
     服务端会话同样可发：消息会真的保存（POST /chat-sessions/{id}/messages），
     只是回复要等 Agent 接入 —— 这一点由发送后的说明点明，不用禁用输入来表达。 */
  /**
   * 引擎可用性按**真实探测**判定（`/api/capabilities` 的 agent 项 + `/api/harnesses`），
   * 不用本地 harness.ready（那是演示数据）。
   *
   * 注意这里与服务端会话的差异：服务端会话发消息只要求「消息能保存」，
   * 后端 `POST /messages` 已实现（后端清单 §1.6 标 ✅），所以**不因引擎未接入而禁发**；
   * 本地草稿会话的回复要靠 Agent，未接入时发送没有意义，因此禁用。
   */
  const probe = useHarnesses()
  const harnessState = availabilityOf(probe, harness.id)
  const stateOf = (id: string) => availabilityOf(probe, id)
  /**
   * 模型列表以**后端目录**为准（`/api/harnesses/{id}/models`）。
   * 本地 `harness.models` 是产品侧写的名字，与 DSH 实际路由的模型不一致。
   */
  const modelsOfHarness = (id: string) => modelsOf(probe, id)

  /**
   * 当前选中的模型可能不在后端目录里（本地默认值 `deepseek-chat` 在 DSH 路由中并不存在）。
   *
   * 用**派生值**而不是 effect 里 setState：effect 里改状态会触发级联渲染
   * （react 规则 set-state-in-effect），而且派生更符合 React 的数据流方向。
   */
  const backendModels = modelsOfHarness(harnessId).models
  const effectiveModel =
    backendModels.length === 0 || backendModels.some((m) => m.id === model)
      ? model
      : (backendModels.find((m) => m.default) ?? backendModels[0]).id
  /**
   * 引擎 / 模型选择器。
   *
   * 从原输入框里抽出来成为独立变量：新 Composer 的 trailing 槽需要它，
   * 而它是这一段最长的 JSX，留在调用处会把输入框的骨架埋掉。
   * 行为与外观完全沿用原来的两段式 chip + 两级弹窗 —— 第 10 项要求「用对话界面的」，
   * 所以这里不重写，只是搬家。
   */
  const composerModelPicker = (
    <>
    <Popover open={modelPane !== null || modelOpen} onOpenChange={(o) => {
      if (!o) { setModelOpen(false); setModelPane(null) }
      else setModelOpen(true)
    }}>
      <PopoverTrigger asChild>
        <button type="button" className="cv3-hbtn"
                data-off={harnessState.state !== 'available' || undefined}
                data-connected={harnessState.state === 'available' || undefined}
                aria-label="选择执行引擎与模型"
                title={harnessState.state === 'available' ? '切换执行引擎' : (harnessState.note ?? '该引擎未接入')}
                style={{ '--h-color': harness.color } as CSSProperties}>
          <span className="cv3-hseg" data-off={harnessState.state !== 'available' || undefined}>
            <i aria-hidden="true" />
            <span className="cv3-hmark-img" aria-hidden="true"
                  style={{ maskImage: `url(${harness.icon})`, WebkitMaskImage: `url(${harness.icon})` }} />
            {harnessState.state === 'available'
              ? <><span className="cv3-hdiv" aria-hidden="true" /><span className="cv3-hmodel">{effectiveModel}</span></>
              : <span className="cv3-hoff">{AVAILABILITY_LABEL[harnessState.state]}</span>}
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
              <span>
                {probe.access === 'unavailable'
                  ? 'DSH 未接入'
                  : probe.access === 'demo'
                    ? 'DSH 仅演示'
                    : probe.access === 'unknown'
                      ? '状态未知'
                      : `${HARNESSES.filter((h) => stateOf(h.id).state === 'available').length} 个已接入`}
              </span>
            </div>
            <div className="cv3-hp-list" role="listbox" aria-label="执行引擎">
              {HARNESSES.map((h) => {
                const state = stateOf(h.id)
                return (
                <button key={h.id} type="button" className="cv3-hp-item" role="option"
                        aria-selected={h.id === harnessId}
                        data-off={state.state !== 'available' || undefined}
                        title={state.note ?? undefined}
                        style={{ '--h-color': h.color } as CSSProperties}
                        onClick={() => {
                          setHarnessId(h.id)
                          setModel(modelsOfHarness(h.id).models[0]?.id ?? '')
                          setModelPane(h.id)
                        }}>
                  <span className="cv3-hp-logo" aria-hidden="true"
                        style={{ maskImage: `url(${h.icon})`, WebkitMaskImage: `url(${h.icon})` }} />
                  <span className="cv3-hp-txt">
                    <b>{h.name}</b>
                    <small>{AVAILABILITY_LABEL[state.state]}{state.state === 'not_connected' ? '，仅展示' : ''}</small>
                  </span>
                  {h.id === harnessId && <Check size={13} className="cv3-hp-ck" aria-hidden="true" />}
                  <ChevronRight size={13} className="cv3-hp-go" aria-hidden="true" />
                </button>
              )
              })}
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
              {modelsOfHarness(harness.id).models.map((m) => (
                <div key={m.id} className="cv3-hp-modelwrap">
                  <button type="button" className="cv3-hp-item cv3-hp-model" role="option"
                          aria-selected={m.id === effectiveModel}
                          onClick={() => setModel(m.id)}>
                    <span className="cv3-hp-radio" aria-hidden="true" />
                    <span className="cv3-hp-txt"><b className="num">{m.label}</b></span>
                    {m.id === effectiveModel && <Check size={13} className="cv3-hp-ck" aria-hidden="true" />}
                  </button>
                  {/* 选中模型下方展开设置抽屉：思考强度 + 最大上下文。
                      首页两个都给了，这里原来只有推理等级、缺最大上下文。 */}
                  {m.id === effectiveModel && (
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
            {harnessState.state !== 'available' && (
              <p className="cv3-hp-note">
                {harness.name} {AVAILABILITY_LABEL[harnessState.state]}
                {harnessState.note ? `：${harnessState.note}` : '：不会真的执行。'}
              </p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
    </>
  )

  /* 引擎不可用（未接入 / 未连接）时只拦发送，不锁输入框：
     用户仍该能把想法先写下来，等引擎接上再发。
     规则与原来 canSend 的后半段一致。 */
  const sendBlocked = !(activeIsServer || harnessState.state === 'available')

  /* 附件：kind 按 MIME 判定；最多 6 个（同首页上限） */
  const addFiles = (files: File[], forced?: 'file' | 'image' | 'video', done?: () => void) => {
    if (files.length > 0) {
      const picked = files.slice(0, 6).map((f) => ({
        file: f,
        uploadId: crypto.randomUUID(),
        name: f.name,
        size: f.size,
        kind: (forced ?? (f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'file')) as 'file' | 'image' | 'video',
        mimeType: f.type,
        uploading: true,
      }))
      /* 先在界面里占位（显示「上传中」），再逐个上传。
         选完就传、而不是等发送时再传：用户能看到进度，发送时也不用等。 */
      setAttachments((prev) => [...prev, ...picked].slice(0, 6))

      for (const item of picked) {
        // 走真实后端的 /api/uploads（studioHttpApi），不是演示适配器 chatApi ——
        // 后者是本地 mock，没有上传能力。
        void studioHttpApi().chat.uploadAttachment(item.file)
          .then((uploaded: { fileId: string; mimeType: string }) => {
            if (!mountedRef.current) return
            setAttachments((prev) => prev.map((a) => (
              a.uploadId === item.uploadId && a.uploading
                ? { ...a, fileId: uploaded.fileId, mimeType: uploaded.mimeType, uploading: false, uploadError: undefined }
                : a
            )))
          })
          .catch((cause: unknown) => {
            if (!mountedRef.current) return
            const reason = cause instanceof Error ? (cause.message.trim() || '上传失败') : '上传失败'
            setAttachments((prev) => prev.map((a) => (
              a.uploadId === item.uploadId && a.uploading
                ? { ...a, uploading: false, uploadError: reason }
                : a
            )))
          })
      }
    }
    done?.()
  }
  const transferredHomeSession = useRef<string | null>(null)
  useEffect(() => {
    const transfer = props.homeTransfer
    if (!transfer || transfer.sessionId !== props.activeSessionId || transferredHomeSession.current === transfer.sessionId) return
    transferredHomeSession.current = transfer.sessionId
    chat.setDraft(transfer.draft)
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
    /* 开新会话时必须把上一段的回复流断掉：退订 = 断线（不当作完成），
       否则旧对话的回复会插进新会话里 */
    streamStopRef.current?.()
    streamStopRef.current = null
    setPending(false)
    setReplyNote(null)
    setSendError(null)
    idemKeyRef.current = null
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


  /* 开始制作：与 StartCreation 同一套创建逻辑（建项目 + createFromPath + 落工作台）；
     先把真实创建的项目与工作流记进“已创建”表，再切工作台 */
  const launch = async (quick: boolean) => {
    const brief = firstBrief
    if (!brief.trim() || projectPending) return
    setProjectPending(true)
    setProjectError(null)
    try {
    const name = usableName(brief)
    const projectName = name.slice(0, 14) || '未命名创作'
    const project = await props.onCreateProject({
      name: projectName,
      genome: GENOMES[0]?.id ?? 'explainer',
      targetDuration: 180,
    })
    const wf = workflowService.createFromPath(quick ? 'prompt-first' : proPath, 'general', name.slice(0, 24) || '未命名创作', {
      projectId: project.id,
      // 项目承接用户的整段讨论，按消息顺序保留原话，不能只带第一句。
      seedPrompt: userMessages.map((message) => message.text).join('\n\n'),
      resourceReferences: [
        ...chat.messages.flatMap((message) => message.role === 'user' ? (message.references ?? []).filter((ref) => ref.kind === 'asset' || ref.kind === 'reference' || ref.kind === 'technique') : []),
        ...deliveredReferences(attachments
          .filter((item) => item.assetId && !item.uploading && !item.uploadError)
          .map((item) => ({ ...item, assetId: item.assetId!, purpose: (item.purpose ?? 'unspecified') as AssetPurpose }))),
      ],
    })
    chat.addAiMessage({
      text: '项目建好了，制作方案也备了一份。',
      changes: [
        { file: projectName, change: '项目' },
        { file: wf.name, change: '工作流' },
      ],
    })
    props.onLaunch({ workflowId: wf.id, projectId: project.id, autoRun: quick })
    } catch (error) { showProjectError(error) }
    finally { setProjectPending(false) }
  }

  return (
    <div className="cv3">
      {drawer && <button type="button" aria-label="关闭项目栏" className="cv3-backdrop" onClick={() => setSideExpanded(false)} />}

      {/* 收起时整块不渲染：不留 56px 竖条（那是 dsh 的「图标轨」，本产品收起后
          左栏里没有任何还需要常驻的图标，留一条空轨道只是视觉噪音）。 */}
      {!rail && <aside className="cv3-side" data-drawer={drawer || undefined} aria-label="项目与对话">
        {/* 左栏标题与项目/对话操作同层，视图选项靠近下面的列表。 */}
        <div className="cv3-side-top">
          {/* 搜索并进这一排：收起时和旁边的图标按钮同款，点开时占满整条，
              同排其他按钮随即隐去，收起后再回来（见 conversation.css）。 */}
          <SeekSearch value={query} onChange={setQuery} width={248} size={28}
                      placeholder="搜索对话名称" ariaLabel="搜索对话" />
          <div className="cv3-top-actions">
          <button type="button" className="cv3-icon-btn" aria-label="新建对话" title="新建对话"
                  onClick={() => newSession()}>
            <MessageSquarePlus size={15} />
          </button>
          <button type="button" className="cv3-icon-btn" aria-label="新建项目" title="新建项目"
                  disabled={projectPending} onClick={() => void createProjectInline()}>
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
        </div>

        {/* 读取/创建的项目与对话状态：放在标题下方，标题始终锚在左栏顶部，
            不因一条错误被推下去。 */}
        {props.projectsLoading && <p role="status" className="cv3-side-hint">正在加载项目…</p>}
        {props.projectsError && (
          <p role="alert" className="cv3-side-error">
            项目加载失败：{props.projectsError}
            <button type="button" onClick={props.onRefreshProjects}>重试</button>
          </p>
        )}
        {projectError && <p role="alert" className="cv3-side-error">{projectError}</p>}
        {props.threads.createError && (
          <p role="alert" className="cv3-side-error">
            新建对话失败：{props.threads.createError}
            <button type="button" onClick={props.threads.clearCreateError}>知道了</button>
          </p>
        )}
        {/* 删除失败：服务端没有确认删除，那条对话仍在列表里 —— 明说，别让「点了没反应」被当成删掉了 */}
        {props.threads.removeError && (
          <p role="alert" className="cv3-side-error">
            删除对话失败：{props.threads.removeError}
            <button type="button" onClick={props.threads.clearRemoveError}>知道了</button>
          </p>
        )}
        {/* 会话列表读取：加载中 / 失败(可重试) / 未读到都如实显示，
            不让「没读到」看起来像「没有对话」。 */}
        {props.threads.loading && <p role="status" className="cv3-side-hint">正在加载对话…</p>}
        {props.sessionsError && (
          <p role="alert" className="cv3-side-error">
            对话加载失败：{props.sessionsError}
            <button type="button" onClick={props.onRetrySessions}>重试</button>
          </p>
        )}

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
                                 void props.onRenameProject?.(proj.id, editText).catch(showProjectError)
                                 setEditing(null)
                               }}
                               onKeyDown={(e) => {
                                 if (e.key === 'Enter') {
                                   e.currentTarget.blur()
                                 }
                                 if (e.key === 'Escape') setEditing(null)
                               }} />
                      </div>
                    ) : (
                    <button type="button" className="cv3-group-head"
                            data-drop={dropTarget === g.projectId || undefined}
                            /* 点项目头 = 展开 + 选中该项目。原先只做折叠，导致
                               「新建对话」拿不到 projectId、只能落到未分组 —— 用户
                               明明是在项目里点的新建，对话却不在项目下（真机三次踩到）。
                               收起时不改选中态：收起只是视觉折叠，不该顺手切走当前项目。 */
                            data-current={!isUng && proj && props.openProject === proj.id || undefined}
                            onClick={() => {
                              /* 选中先行、折叠随后：`collapsed` 是渲染时捕获的值，
                                 但在同一批事件里被更新前读取并不可靠 —— 之前用
                                 `willExpand &&` 守卫导致点了没反应（真机验证为 disabled
                                 的工作台按钮始终不亮）。现在不管展开还是收起，点项目头
                                 都把它设为当前项目：这是「我要在这个项目里工作」的明确意图，
                                 收起只是视觉动作，不该因此丢掉选中。 */
                              if (!isUng && proj) props.onSelectProject(proj.id)
                              setCollapsedGroups((prev) => {
                                const next = new Set(prev)
                                if (next.has(g.key)) next.delete(g.key)
                                else next.add(g.key)
                                return next
                              })
                            }}
                            title={isUng ? '没有归属项目的对话，可拖到项目下' : `${proj?.name ?? ''}（点击展开并切换到此项目）`}>
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
                              <button type="button" role="menuitem"
                                      onClick={() => { setRowMenu(null); setArchivingProject(proj) }}>
                                <Archive size={13} /><span>归档项目</span>
                              </button>
                              <button type="button" role="menuitem" data-danger
                                      onClick={() => {
                                        setRowMenu(null)
                                        /* 打开时就清空确认框：上一次删除留下的文字
                                           不能出现在这一次里 —— 那等于替用户预填了
                                           一个可能恰好匹配的项目名。 */
                                        setDeleteConfirmText('')
                                        setDeletingProject(proj)
                                      }}>
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
                              : t.origin === 'local'
                                ? <span className="cv3-session-flag" title={t.localNote ?? '未保存到服务端'}>仅本页</span>
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
                            /* 菜单整体拦掉点击冒泡：菜单项在会话行内部，而整行点击=切换会话。
                               不拦的话，点「删除对话」会先把会话切成这一条，删完再清空当前对话 ——
                               用户只是想删掉一条不相关的会话。 */
                            <div className="cv3-menu cv3-rowmenu" role="menu"
                                 onClick={(e) => e.stopPropagation()}
                                 onKeyDown={(e) => e.stopPropagation()}>
                              {/* 服务端会话暂无重命名端点：不提供会「只改本页却像已保存」的操作 */}
                              {t.origin === 'local' ? (
                                <button type="button" role="menuitem"
                                        onClick={() => { setEditing(t.id); setEditText(t.title); setRowMenu(null) }}>
                                  <Pencil size={13} /><span>重命名</span>
                                </button>
                              ) : (
                                <button type="button" role="menuitem" disabled
                                        title="服务端尚未提供会话重命名">
                                  <Pencil size={13} /><span>重命名（暂不可用）</span>
                                </button>
                              )}
                              {t.origin === 'local' && t.projectId && (
                                <button type="button" role="menuitem"
                                        onClick={() => {
                                          setRowMenu(null)
                                          // 失败原因由 threads.createError 统一显示，这里不重复
                                          void props.threads.retryCreate(t.id)
                                        }}>
                                  <Check size={13} /><span>重试保存到服务端</span>
                                </button>
                              )}
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
                                      onClick={() => {
                                        setRowMenu(null)
                                        // 服务端会话是真的删（软删除，服务端保留审计），先确认再删：
                                        // 删错了没法在本页撤销，恢复要另走接口。
                                        if (t.origin === 'server'
                                            && !window.confirm(`删除对话「${t.title}」？服务端将不再返回这条对话。`)) return
                                        void props.threads.remove(t.id)
                                      }}>
                                <Trash2 size={13} />
                                <span>{t.origin === 'local' ? '丢弃这条草稿' : '删除对话'}</span>
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

        <div className="cv3-scroll" ref={scrollRef} onScroll={onScrollTrack}>
          <div className="cv3-view">
            <div className="cv3-col">
              {/* 服务端会话：历史、发送与 Agent 回复都已接上。
                 这里只说明「消息会持久化」这一件用户关心的事实 ——
                 之前那句「Agent 回复尚未接入」在接入之后成了错误信息，
                 会让人以为发了也没回答（真机截图确认过）。 */}

              {/* 历史读取：加载中 / 失败（可重试）。失败时不清空已读到的部分，
                  但必须说明「不是完整历史」—— 空会话与没读到是两件事。 */}
              {activeIsServer && !activeMessagesLoaded && !activeThread?.messagesError && (
                <p className="cv3-streaming" role="status">
                  <LoaderCircle className="cv3-spin" size={13} /> 正在读取历史消息…
                </p>
              )}
              {activeIsServer && activeThread?.messagesError && (
                <p className="cv3-sync-error" role="alert">
                  <AlertCircle size={13} />
                  <span>历史消息没读全（{activeThread.messagesError}）当前显示的只是已读到的部分。</span>
                  <button type="button" onClick={retryMessages}>重试</button>
                </p>
              )}
              {/* 首条需求没存进服务端：内容是用户刚写的，必须原样留在界面上并说明没存。
                  不说的话，读回历史后这条会消失，看起来就像「刚写的话丢了」。 */}
              {activeIsServer && activeThread?.unsavedFirst && (
                <p className="cv3-sync-error" role="alert">
                  <AlertCircle size={13} />
                  <span>
                    下面第一条需求没有存进服务端（{activeThread.unsavedFirst.error}）
                    内容只保留在本页，可复制后重新发送。
                  </span>
                </p>
              )}
              {/* 详情读取失败：标题/时间/计数仍来自列表，只是可能不是最新 —— 明说，并给重试 */}
              {activeIsServer && activeThread?.syncError && (
                <p className="cv3-sync-error" role="alert">
                  <AlertCircle size={13} />
                  <span>最新详情没读到（{activeThread.syncError}）当前显示的是最近一次拿到的信息，可能不是最新。</span>
                  <button type="button" onClick={retrySync}>重试</button>
                </p>
              )}
              {userMessages.length === 0 && !activeIsServer && (
                <p className="cv3-ai-intro">说说你想做的片子：讲给谁、多长、什么感觉。</p>
              )}
              {/* 本页草稿：明确「不在服务端」。服务端会话已在上面说明，不重复。 */}
              {activeThread?.origin === 'local' && (
                <p className="cv3-local-note" role="note">
                  {activeThread.projectId
                    ? `${activeThread.localNote ?? '这条对话尚未保存到服务端。'} 未接入 Agent 的回复仅用于梳理需求，不代表已经执行。`
                    : '这条对话没有归属项目，仅保存在本页，刷新后不会保留。未接入 Agent 的回复仅用于梳理需求，不代表已经执行。'}
                </p>
              )}

              {messages.map((m) => m.role === 'user' ? (
                <ChatBubble
                  key={m.id}
                  role="user"
                  text={m.text}
                  at={m.at}
                  attachments={m.attachments?.map((a) => ({
                    name: a.name,
                    kind: a.mimeType?.startsWith('image/') ? 'image' as const : 'file' as const,
                    sizeBytes: a.sizeBytes,
                  }))}
                />
              ) : (
                <div key={m.id} className="cv3-ai-block">
                  {/* ══ 过程区（turn-process）═══════════════════════════
                      顺序照 dsh 的 ChatView：思考 → 工具调用 → 运行指示。
                      这三块回答的是「它怎么做到的」，正文回答「结论是什么」，
                      所以必须在正文之前、且视觉上更弱。 */}

                  {/* 过程区按两类分开呈现：
                      · 网页搜索 → WebSearchTrace（来源轨迹，它内部只认搜索类工具）
                      · 其余工具 → TaskList（任务列表：一次任务 = 一个工具的多步调用）
                      两者混在一张清单里会互相稀释 —— 搜索回答「查了什么来源」，
                      任务列表回答「执行了哪几类动作」。 */}
                  {m.executedTools && <WebSearchTrace calls={m.executedTools} live={false} />}
                  {(() => {
                    /* 过程日志：思考与工具调用合成一张任务列表 —— 这正是
                       BoardUI 任务列表的用法（一条日志里既有「正在思考」也有
                       「执行了什么」）。搜索类不进来，它有自己的轨迹。 */
                    const tools = (m.executedTools ?? []).filter((c) => !isSearchTool(c.name))
                    const tasks = [
                      /* 思考用全文而不是 truncate：推理已经落库，界面却只显示
                         开头 72 字，等于把存下来的内容又丢掉一次。多行排版见
                         task-list.css 的 .tl-step--multiline。 */
                      ...(m.thinking ? [{ title: '思考', steps: [{ label: m.thinking, multiline: true }] }] : []),
                      ...toolCallsToTasks(tools, false),
                    ]
                    if (tasks.length === 0) return null
                    return (
                      <TaskList
                        tasks={tasks}
                        revealed={(m.thinking ? 2 : 0) + toolCallsRevealed(tools)}
                        run={false}
                        working={false}
                      />
                    )
                  })()}
                  {/* 演示适配器的工具摘要：同样用任务列表，保持两处一致 */}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <TaskList
                      tasks={[{ title: '工具调用', steps: m.toolCalls.map((t) => ({ label: `${t.label}：${t.detail}` })) }]}
                      revealed={1 + m.toolCalls.length}
                      run={false}
                      working={false}
                    />
                  )}

                  {/* 正文：Markdown + 代码高亮。
                      之前是手写 renderRich，只认 **加粗**、反引号、`1. ` 编号，
                      表格/多级列表/代码块全都走样 —— 那等于把结构信息丢了。 */}
                  {m.text ? (
                    <AnswerBody>
                      <MarkdownText text={m.text} />
                    </AnswerBody>
                  ) : null}

                  {/* 失败 / 演示标记：必须可见，不能只靠别处说明 */}
                  {m.failed ? (
                    <p className="cm-failed" role="alert">这条回复没有完成：{m.failed}</p>
                  ) : null}
                  {m.demo && !m.streaming && !m.failed ? (
                    <p className="cm-note">演示回复 · 未连接 Agent</p>
                  ) : null}

                  {/* 操作条：dsh 放在正文之后、左移 6px 对齐文字 */}
                  {!m.streaming && m.text ? (
                    <AnswerActions>
                      <MessageActions
                        text={m.text}
                        at={m.at}
                        onRetry={m.failed ? () => retryLastRound() : undefined}
                      />
                    </AnswerActions>
                  ) : null}
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
                    「画面构想」如实标出要等模型，不编一段像分镜的文字顶上。
                    只在**演示适配器**的回复后出现：那张卡假设「AI 回复 = 需求澄清」，
                    而接上真 Agent 后，模型可能只是在回答普通问题（例如「介绍AI发展史」）。
                    给那种回复挂一张「这条片子多长 / 什么画幅」的表单，是把创作流程
                    硬套到所有对话上 —— 实测在真机验收时就是这样错的。 */}
                {m.demo && messages[messages.length - 1]?.id === m.id && !m.streaming && !m.failed && userMessages.length > 0 && !reqConfirmed && (
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

                  {/* 真实 Agent 回复后的出口。
                      与下面的演示卡是两条独立路径：这里**不假设**这条回复是需求梳理，
                      也不建议「开始制作」—— 用户可能只是问了个普通问题。只给一个
                      明确可行动作：带着这段对话去工作台继续。
                      没有归属项目时不给按钮（工作台需要项目），改为提示先建项目 ——
                      给一个点了会失败的按钮比不给更糟。 */}
                  {!m.demo && m.id === messages[messages.length - 1]?.id && !m.streaming && !m.failed && (
                    <div className="cv3-after">
                      {currentProject ? (
                        <button type="button" className="cv3-secondary cv3-after-btn"
                                onClick={() => props.onOpenWorkbench()}>
                          带着这段对话去工作台
                        </button>
                      ) : (
                        <p className="cv3-after-hint">这条对话还没有归属项目，建一个项目即可进入工作台继续。</p>
                      )}
                    </div>
                  )}
                  {/* 演示回复后的「下一步」卡：原来那块由本地伪造的「制作方案」三条带出来，
                      那三条是编的内容（不是模型给的，也不是工作流产的），已删。
                      入口本身保留：它是进入工作台的路。只跟演示回复走 ——
                      真 Agent 回答普通问题时不该弹「专业制作路径 / 开始制作」。 */}
                  {m.demo && messages[messages.length - 1]?.id === m.id && !m.streaming && !m.failed && !launched && (
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

              {/* ⚠️ 这里原来写的是「pending 且最后一条是 user」。
                  但真实流程一发送就会插入一条 streaming 的 AI 消息（useChat.startAiMessage），
                  所以「最后一条是 user」永远不成立 —— 思考态从来没显示过（实测 ti=0 全程）。
                  正确条件：pending 且当前 AI 消息还没有正文（有正文就该看正文，不是看思考）。 */}
              {pending && (messages[messages.length - 1]?.role === 'ai' ? !messages[messages.length - 1]?.text : true) && (
                <>
                {/* dsh 只在「上一块不是用户消息」时画这条 0.5px 分隔线：
                    紧跟在用户发言之后时，气泡本身就足够分隔，再画一条是多余的。 */}
                {messages[messages.length - 1]?.role !== 'user' ? <RunningDivider /> : null}
                {/* 思考态用 ThinkingOrbs：状态与当前阶段一一对应，
                    不是随便挑一个好看的动画。
                    阶段来自后端结构化透传（thinking / tool / 回复），
                    所以这里显示的是真实阶段，不是按时长猜的。 */}
                <ThinkingIndicator
                  phase={
                    agentPhase === null
                      ? 'working'
                      : agentPhase.phase === 'thinking'
                        ? 'solving'
                        : agentPhase.phase === 'tool'
                          ? 'searching'
                          : 'working'
                  }
                  label={
                    agentPhase?.phase === 'tool' && agentPhase.label
                      ? agentPhase.isError
                        ? `工具失败：${agentPhase.label}`
                        : `正在调用：${agentPhase.label}`
                      : undefined
                  }
                  elapsed={pendingStartedAt ? (Date.now() - pendingStartedAt) / 1000 : undefined}
                />
                </>
              )}
              {/* 工具调用历史：一轮里可能调十几次工具，只显示「当前一个」等于没有记录。
                  这里用 TaskList —— 它是 BoardUI 任务列表的 1:1 移植（第 6、7 项），
                  按「任务 → 步骤」组织，比一串 <details> 更像「它到底做了什么」。
                  revealed 传真实推进单元数：内部计时器完全关掉，
                  显示进度等于真实到达的工具调用数，不编造。

                  注意这里**不能加 `pending &&`**：真机验收时发现，回复一结束整个列表
                  就连同 usage 一起消失，用户再也回看不到「刚才跑了什么」。
                  工具调用是这一轮回复的组成部分，属于历史而不是瞬时状态。

                  另一个真机发现：一旦消息挂上了 `executedTools`（落库后读回的历史记录），
                  这里必须让位 —— 否则同一次调用会在消息块内外各画一遍，界面上出现
                  两条「bash 完成」。两者是同一份数据的前后两个阶段，只能显示一个。 */}
              {toolCalls.length > 0
                && !messages[messages.length - 1]?.executedTools
                && (
                <>
                  <WebSearchTrace calls={toolCalls} live />
                  <TaskList
                    tasks={[
                      /* 实时思考：推理帧到达后，第一个任务就是「思考」。
                         与历史路径同一个结构，用户看到的永远是同一种组织方式。 */
                      /* 与历史消息里的思考同样用全文：实时看和回看应是同一份内容，
                         只在这里截断会让「正在思考」比「回看」少显示一大段。 */
                      ...((streamingThinking || lastThinking) ? [{ title: '思考', runningTitle: '正在思考', steps: [{ label: streamingThinking || lastThinking, multiline: true }] }] : []),
                      ...toolCallsToTasks(toolCalls.filter((c) => !isSearchTool(c.name)), pending),
                    ]}
                    revealed={((streamingThinking || lastThinking) ? 2 : 0) + toolCallsRevealed(toolCalls.filter((c) => !isSearchTool(c.name)))}
                    run={!pending}
                    working={pending ? '正在处理' : false}
                  />
                  {/* 思考中但还没有工具调用：单独一条「思考」任务，
                      让过程区始终有东西可看，而不是一片空白等正文。 */}
                  {pending && toolCalls.length === 0 && !messages[messages.length - 1]?.text ? (
                    <TaskList
                      tasks={[{ title: '思考', runningTitle: '正在思考', steps: [{ label: '分析你的要求' }] }]}
                      run={false}
                      working={false}
                    />
                  ) : null}
                </>
              )}
              {/* token 用量：回答「这一轮花了多少」。只显示上游真的报了的桶，
                  没报的不占位 —— 显示「输入 0」会让人以为完全没消耗。
                  缓存命中单独标出：它含在总计里，单看总计容易高估成本。
                  同样不能加 `pending &&`：用量是这一轮的结算，结束后才最该看见。 */}
              {usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined) && (
                <p className="cv3-usage num">
                  {usage.inputTokens !== undefined && <>输入 {usage.inputTokens}</>}
                  {usage.outputTokens !== undefined && <>{usage.inputTokens !== undefined ? ' · ' : ''}输出 {usage.outputTokens}</>}
                  {usage.cacheReadTokens !== undefined && usage.cacheReadTokens > 0 && (
                    <> · 缓存命中 {usage.cacheReadTokens}</>
                  )}
                </p>
              )}
              {/* 服务端回复的如实说明：能力缺口（Agent 未接入）不是「回复失败」，
                  所以用中性说明而不是红色失败块 —— 重试也不会好，别让人白等。 */}
              {replyNote && (
                <p className="cv3-demo-note" role="note">{replyNote}</p>
              )}
            </div>
          </div>

          {/* 「回到最新」：翻离底部时才出现（dsh 的 34px 圆钮） */}
          {awayFromBottom ? (
            <button type="button" className="cv3-to-bottom" aria-label="回到最新" title="回到最新"
                    onClick={backToBottom}>
              <ChevronDown size={16} />
            </button>
          ) : null}

          <div className="cv3-seat">
            {/* 输入框：几何取自 BoardUI 免费聊天模板（52px 胶囊 / 36px 圆钮 /
                10px 间距），加载态是环绕光带。
                引擎与模型选择器沿用对话界面原来那一套（composerModelPicker），
                不换实现 —— 第 10 项要的就是「用对话界面的」。
                ⚠️ 必须包在 .cv3-compose 里：那个类带着左右 32px 内边距与
                「与消息列同宽并居中」的约束。原先是 .cv3-card 提供宽度，
                换成新组件后如果直接挂到 .cv3-seat 上，输入框会横跨整个主区
                （实测 1044px vs 消息列 680px），跟上面的对话完全不对齐。 */}
            <div className="cv3-compose">
            <ChatComposer
              value={chat.draft}
              onValueChange={(v) => { chat.setDraft(v); setSendError(null) }}
              onSubmit={submit}
              busy={pending}
              placeholder={activeIsServer
                ? '继续这条对话：消息会保存到服务端'
                : '说说你想做的片子，或补充制作要求'}
              onAttach={() => fileRef.current?.click()}
              sendBlocked={sendBlocked}
              leading={(
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
              )}
              trailing={composerModelPicker}
              above={attachments.length > 0 ? (
                <div className="cv3-attach-row">
                  {attachments.map((a, i) => (
                    <span key={`${a.name}-${i}`} className="cv3-attach-chip" data-kind={a.kind}
                          data-from-pending={a.assetId ? '' : undefined}
                          title={a.note ? `${PURPOSE_TXT[a.purpose ?? ''] ?? ''} · ${a.note}` : undefined}>
                      {a.kind === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />}
                      <span className="cv3-attach-name">{a.name}{a.uploading ? ' · 上传中' : a.uploadError ? ` · 上传失败：${a.uploadError}` : ''}</span>
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
              ) : null}
              error={sendError ? (
                <p className="cv3-compose-note" role="alert" data-error="">
                  <AlertCircle size={12} /> {sendError}
                </p>
              ) : null}
              statusLeft={launched ? <span className="cv3-pill">已开始制作</span> : null}
            />
            </div>
            {/* 隐藏的文件选择器（对齐 dsh 的 file input：多选） */}
            <input ref={fileRef} type="file" multiple hidden onChange={onPickFiles} />
            <input ref={imageRef} type="file" accept="image/*" multiple hidden
                   onChange={(e) => addFiles(Array.from(e.target.files ?? []), 'image', () => { if (imageRef.current) imageRef.current.value = '' })} />
          </div>
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

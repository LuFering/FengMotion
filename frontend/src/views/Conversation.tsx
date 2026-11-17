import { ProjectResourceEvidence } from '../components/ProjectResourceEvidence'
import { submitCreation } from '../services/creationClient'
import { useHarnessSelection, setHarnessSelection } from '@/shell/useHarnessSelection'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search as SeekSearch } from '@/components/Search'
import { WebSearchTrace, isSearchTool, type SearchCall } from '@/components/WebSearchTrace'
import { ChecklistDrawer } from '@/components/bencho/Checklist'
import { JobPanel, type JobView } from '@/components/chat/JobPanel'
import { Deliverables } from '@/components/chat/Deliverables'
import { SubagentBadge } from '@/components/chat/SubagentBadge'
import { FileChanges } from '@/components/chat/FileChanges'
import { collectFileChanges } from '@/components/chat/fileChanges'
import { QuestionFormCard } from '@/components/chat/QuestionFormCard'
import { splitQuestionForms } from '@/components/chat/questionForm'
import { ContextMeter, type Kind } from '@/components/bencho/ContextMeter'
import {
  ChatMessage as ChatBubble, ThinkingIndicator, MarkdownText,
  AnswerBody, AnswerActions, MessageActions, RunningDivider,
  TaskList, type TaskItem, type TaskStepChip,
} from '@/components/chat'
import {
  AlertCircle, AlertTriangle, Archive, ArchiveRestore, Check, ChevronDown, ChevronRight,
  CircleSlash, Ellipsis, FolderPlus, Minimize2, RotateCcw,
  LayoutGrid, ListFilter, LoaderCircle, MessageSquarePlus, PanelLeft, Pencil, Pin, PinOff,
  Trash2,
} from 'lucide-react'
import { LeiBoxComposer } from '@/components/chat/LeiBoxComposer'
import { ComposerAttachments } from '@/components/chat/ComposerAttachments'
import { CreationProgress } from '@/components/chat/CreationProgress'
import type { ContextUsageSnapshot } from '@/components/chat/LeiBoxComposer'
import { TargetSummaryPill } from '@/components/chat/TargetSummaryPill'
import { useSessionDraft } from '@/shell/useDraftStore'
import { PURPOSE_LABEL, registerComposer, type DeliverableAsset, type AssetPurpose } from '@/shell/usePendingAssets'
import { deliveredReferences } from '@/services/creationResources'
import { studioHttpApi } from '@/services/api'
import { chatStreamManager, useSessionStream } from '@/services/chatStreamManager'
import { newIdempotencyKey } from '@/services/api/config'
import { ApiError, userMessageForError } from '@/services/api/errors'

/** 从空白进入（还没建会话）时，服务层用的会话键。
 *  必须是每段对话各一个键：两条未落盘的对话共用一个键会在适配器里串消息。 */
const DRAFT_SESSION = '__draft__'
import { HARNESSES, DEFAULT_PREFS, prefsKey, loadPrefs, savePrefs, type ModelPrefs } from '../data/harnesses'
import { useHarnesses, availabilityOf, modelsOf, matchHarness } from '../shell/useHarnesses'
import type { ChatState, ChatMessage } from '../shell/useChat'
import { UNGROUPED, sessionTitle, type SessionsState } from '../shell/useSessions'
import { chatApi, hydrateDemoChat } from '../services/chatService'
import type { NewProjectInput } from '../shell/useProjects'
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ViewSwitch } from '../components/ViewSwitch'
import type { ProjectSummary } from '../data/projects'
import type { ContextBreakdown } from '../types/contracts'
import { resolveSendPlan } from '@/services/sendPlan'
import { isSameRequest, messageFingerprint, creationFingerprint } from '@/services/sendFingerprint'
import { markDraftSent, noteDraftInput, clearSentPartsOnly, currentFieldVersions, setSessionDraft } from '@/shell/useDraftStore'
import { prepareCreationEntry, ensureCreationContext } from '@/services/creationEntry'
import { sessionDisplayTitle, sessionTimeLabel, sessionTimeFull } from '@/shell/sessionDisplay'
import { useRoundOutcomes, clearRoundOutcome, recordRoundOutcome } from '@/shell/roundOutcomes'
import { backfillRoundOutcomes, invalidateBackfill } from '@/shell/roundOutcomeBackfill'
import { resolveReplySaveState, replySaveNotice, type ReplyLookup } from '@/shell/roundRestoreRules'
import { lastRoundThinking, shouldShowMessageMeter, messagesForSession } from './conversationRound'
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
          /* 没参数（或参数是 `{}`）时依次兜底：
             中文说明 > 工具名。直接写「无参数」占一整行却什么也没说。 */
          label: (call.arguments && shortArgs(call.arguments)) || NO_ARG_HINT[name] || name,
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
 * 「思考」任务的图标。
 *
 * <p>思考不是工具调用，但它和工具步骤同处一张任务列表；不给图标时，
 * 工具行前面都有图标、唯独思考行前面空一格，看起来像渲染漏了。</p>
 */
function ThinkingIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 18 18"
      aria-hidden
      className={`tl-task-svg${className ? ` ${className}` : ''}`}
    >
      {/* 一个思考气泡：外框 + 两个点，与工具图标的线宽保持一致 */}
      <path d="M9 2.8 C12.9 2.8 15.6 5.2 15.6 8.2 C15.6 11.2 12.9 13.6 9 13.6
               C7.9 13.6 6.9 13.4 6 13 L3 14.4 L3.9 11.6
               C2.9 10.7 2.4 9.5 2.4 8.2 C2.4 5.2 5.1 2.8 9 2.8 Z" />
      <circle cx="6.6" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11.4" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
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
  /* mjs / cjs / mts / cts 也是 JS/TS，漏掉会掉进文档图标的兜底，
     同一个项目里 .js 是代码图标、.mjs 是文档图标，看起来像渲染错了。 */
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'sh'].includes(ext)) {
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
/**
 * 无参数工具的中文说明。
 *
 * 有些工具的意图完全由「调用本身」表达（`list_agents` 不带任何参数）。
 * 此时行内容只能靠工具名，但直接写英文名读起来是「代码」不是「动作」。
 * 只列确实见过且语义明确的几个；没收录的退回工具名，不硬编。
 */
const NO_ARG_HINT: Record<string, string> = {
  list_agents: '查看子代理列表',
  list_tasks: '查看任务列表',
  list_jobs: '查看后台任务',
  exit_plan_mode: '退出计划模式',
  get_goal: '查看当前目标',
}

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

  /* ── 数组参数（todo_write 的 todos）───────────────────────
     它的唯一字段是一个对象数组，下面那套「取字符串字段」的逻辑
     一个都取不到，结果整行显示「（无参数）」—— 看起来像调用失败了。
     这里按语义翻译：给出条目数 + 正在做的那条。 */
  if (Array.isArray(parsed.todos)) {
    const list = parsed.todos as { content?: unknown; status?: unknown }[]
    const doing = list.find((t) => t?.status === 'in_progress')
    const doingText = typeof doing?.content === 'string' ? doing.content.trim() : ''
    const head = `更新任务清单 · ${list.length} 项`
    return truncate(doingText ? `${head}：${doingText}` : head)
  }

  /* ── 交付参数（present 的 files）─────────────────────────
     和 todo_write 同因：唯一字段是对象数组，取字符串字段那套取不到，
     整行会显示「（无参数）」，看起来像调用失败。这里给出文件名。 */
  if (Array.isArray(parsed.files)) {
    const list = parsed.files as { path?: unknown }[]
    const names = list
      .map((f) => (typeof f?.path === 'string' ? f.path.split(/[\\/]/).pop() ?? '' : ''))
      .filter(Boolean)
    const head = `交付 ${list.length} 个文件`
    return truncate(names.length > 0 ? `${head}：${names.join('、')}` : head)
  }

  /* 优先级按「哪个字段最能说明这一步在干什么」排 */
  const KEYS = ['description', 'command', 'query', 'pattern', 'file_path', 'path', 'url', 'prompt']
  for (const k of KEYS) {
    const v = parsed[k]
    if (typeof v === 'string' && v.trim()) return truncate(v.trim())
  }

  /* 兜底：取前两个**标量**字段，拼成「键：值」。
     数组/对象也接进来 —— 它们至少说明「带了什么」，比什么都不说强。 */
  const parts = Object.entries(parsed)
    .filter(([, v]) => v !== null && v !== undefined)
    .slice(0, 2)
    .map(([k, v]) => {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        return `${k}=${String(v)}`
      }
      if (Array.isArray(v)) return `${k}[${v.length}]`
      return `${k}={…}`
    })

  /* 真的没有任何参数（如 list_agents 的参数就是 `{}`）。
     返回空串，让调用方用工具名兜底 —— 「无参数」占满一整行却什么也没说，
     连着几次调用就是几行废话。这类工具靠调用本身表达意图。 */
  if (parts.length === 0) return ''
  return truncate(parts.join(' '))
}

/** 诊断类型的兜底文案（后端一般会给 detail）。 */
const DIAGNOSTIC_LABEL: Record<string, string> = {
  compaction: '上下文已压缩，早期对话被摘要替代',
  'max-tokens': '本回合达到 token 上限，回复可能不完整',
  retry: '模型调用失败，正在重试',
  interrupted: '本轮被中断',
}

function truncate(t: string): string {
  const oneLine = t.replace(/\s+/g, ' ').trim()
  return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine
}

/* 相对时间（对齐 dsh time.ago：刚刚 / N分钟 / N小时 / N天 / N个月 / N年） */
/**
 * 会话列表的时间 —— 与工作台侧栏**共用同一套规则**（`sessionTimeLabel`）。
 *
 * <p>原先这里自己算相对时间（「6天前」），侧栏用 `toLocaleTimeString`（「17:29」），
 * 同一个时间在两处长得不一样；更糟的是侧栏那种写法让六天前和今天无法区分。
 * 现在两处都调共享实现，今天给相对时间、跨天给「昨天 / 9月3日」。</p>
 */
const fmtAgo = (t: number): string => sessionTimeLabel(t)

/* 绝对时间（对齐 dsh date.ymd / hover.created 的「创建于」） */
function fmtWhen(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}


export function Conversation(props: {
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
}) {
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
  const [pending, setPending] = useState(false)
  /** 本轮开始时间：给 ThinkingIndicator 的计时器用。
      记在 state 里而不是渲染时 Date.now()，否则每帧都会变、计时器会抖。 */
  const [pendingStartedAt, setPendingStartedAt] = useState<number | null>(null)

  /**
   * 停止请求是否还在等后端答复。
   *
   * <p>轮次核对能防止「迟到的停止响应误伤新流」，但更省事的是不给这个机会：
   * 结果没确定之前输入框继续保持忙碌，用户就无法在这一瞬发出下一轮。
   * 管理器对在途请求做了去重，连点只会打一次 /stop。</p>
   */
  const [stopping, setStopping] = useState(false)

  const loadMessages = props.threads.loadMessages
  const handledStreamPhaseRef = useRef<{ phase: string; sessionId?: string | null }>({ phase: 'idle' })

  /**
   * 清空「本轮」的过程痕迹：工具调用、token 用量、上下文分档、当前阶段。
   *
   * <p>停止生成时这一轮的 AI 消息会被撤掉，但这些是**独立 state**，
   * 不随消息一起消失。真机验收发现：点了停止，正文没了，
   * 「思考 / bash · 1 次 / 11.5K 上下文条」还留在界面上 ——
   * 用户看到的就是「停了但没停干净」。所以凡是撤销本轮回复的地方，
   * 都要连同这些痕迹一起清掉。</p>
   */
  const clearRoundTrace = () => {
    setToolCalls([])
    toolCallsRef.current = []
    setUsage(null)
    setAgentPhase(null)
    /* 上下文分档与实测 prompt 大小也是**这一轮**的读数：
       不清掉的话，停止后界面会留着一根「11.5K / 1M」的占用条，
       指向一条已经被撤销的回复。窗口大小（分母）保留 —— 它来自模型目录，
       与本轮无关。 */
    setBreakdown(null)
    setContextUsed(null)
  }

  // 响应式订阅全局会话回复流状态（支持工作台与对话区无缝跨页状态同步）
  const streamInfo = useSessionStream(props.activeSessionId)
  useEffect(() => {
    const isNewEvent = handledStreamPhaseRef.current.phase !== streamInfo.phase ||
      handledStreamPhaseRef.current.sessionId !== props.activeSessionId
    handledStreamPhaseRef.current = { phase: streamInfo.phase, sessionId: props.activeSessionId }

    if (streamInfo.phase === 'streaming') {
      setPending(true)
      if (streamInfo.startedAt) setPendingStartedAt(streamInfo.startedAt)
    } else if (streamInfo.phase === 'completed' || streamInfo.phase === 'stopped') {
      setPending(false)
      setPendingStartedAt(null)
      setAgentPhase(null)
      /* 确认停止的清理放在这里，而不是只挂在 SSE 的 onStopped 上：
         后端一确认，管理器就会断开连接，onStopped 事件很可能不再到达，
         半截回复会留在界面上。管理器登记了「哪一轮被确认停止」，
         这里读一次即删（takeConfirmedStop），保证与事件路径不重复清理。 */
      if (streamInfo.phase === 'stopped' && props.activeSessionId) {
        const confirmed = chatStreamManager.takeConfirmedStop(props.activeSessionId)
        if (confirmed) {
          if (confirmed.aiMessageId) chat.removeMessage(confirmed.aiMessageId)
          clearRoundTrace()
          setReplyNote('已停止生成。你的消息已保存，这条回复没有保存。')
        }
      }
      // 严格保证：每次完成只在首次进入 completed 阶段时触发一次同步，绝不反复重读
      if (isNewEvent && props.activeSessionId && streamInfo.phase === 'completed') {
        void loadMessages(props.activeSessionId, { force: true })
      }
    } else if (streamInfo.phase === 'error') {
      setPending(false)
      setPendingStartedAt(null)
      setAgentPhase(null)
      if (streamInfo.error) {
        setReplyNote(`没有拿到回复：${streamInfo.error}`)
      }
    }
  }, [streamInfo.phase, streamInfo.startedAt, streamInfo.error, props.activeSessionId, loadMessages])
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

  /**
   * 上下文窗口大小 —— 占用率的分母。
   *
   * 和 `usage` 刻意分开：usage 是**累计账单**（按桶累加，回答「这条会话花了多少」），
   * 这里要的是**此刻装了多少**（最后一次请求的 prompt 有多大）。
   * 混成一个数会得出「占了 300%」这种荒谬结论。
   *
   * `null` 表示引擎没报（适配器不上报），此时不画占用率，而不是编一个分母。
   */
  const [contextWindow, setContextWindow] = useState<number | null>(null)

  /**
   * 工具 schema 的估算占用（token）。来源是 DSH 的 `request/header`。
   *
   * 分档里的 System / Messages 两档只能拿到「合起来多少」——
   * 要靠这个值和 System 提示长度反推，所以它是独立一份。
   * `null` 表示还没发过请求（或引擎没给）。
   */
  const [toolsTokens, setToolsTokens] = useState<number | null>(null)

  /**
   * 上下文分档：把「已用 N token」拆成 system / memory / files / results / chat。
   *
   * `null` 表示后端还没上报（跑完一轮后才有）。分档口径对齐 magpie 的
   * prompt.parts —— 它回答了 usage 总数回答不了的问题：哪一块在膨胀。
   */
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null)

  /**
   * 此刻上下文里装了多少 token —— 占用率的分子。
   *
   * 取**最后一次**请求的 prompt 大小（覆盖，不累加）。与上面的 `usage`
   * 是两码事：那个是累计账单，问「这条会话一共花了多少」；这个是当前水位，
   * 问「现在装了几成」。用累加值算占用会得到超过 100% 的荒谬结果。
   */
  const [contextUsed, setContextUsed] = useState<number | null>(null)

  /**
   * 正在跑、或刚跑完的后台任务。
   *
   * 同一个 jobId 会来两帧（running → 终态），所以按 id 覆盖而不是追加 ——
   * 追加会得到两条同名记录。完成的短任务由 JobPanel 自己移除，
   * 这里只负责维护事实，不管「该不该显示」。
   */
  const [jobs, setJobs] = useState<JobView[]>([])

  /**
   * 本轮交付的产物。
   *
   * 用 ref 而不是 state：它只在收尾时用到一次（挂到消息上），
   * 中途不驱动渲染 —— 每来一帧都 setState 会白跑一次渲染。
   * 按 path 去重：一条回复可能分多次 present，同一文件不重复列。
   */
  const deliverablesRef = useRef<{ path: string; description?: string }[]>([])
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
  /* 模型/引擎选择状态：输入框已换成 LeiBox 官方组件（它自带模型与推理
     档位菜单），这几个状态暂时没有消费方，但引擎切换、会话偏好仍要用到，
     保留并显式标记，避免被当成死代码删掉。 */
  const [modelOpen, setModelOpen] = useState(false)
  const [modelPane, setModelPane] = useState<string | null>(null)
  void modelOpen; void setModelOpen; void modelPane; void setModelPane
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
    /* 真实上传进度 0–100。上传中才有值；落地后置 undefined，
       图块据此判断「环该不该画、角落要不要显示百分比」。 */
    progress?: number
    /* 本地预览地址（object URL）。图片附件在卡片里直接显示缩略图，
       而不是一个「图片」图标 —— 用户选了两张图，必须能看出是哪两张。
       生命周期：随附件一起移除时回收，见 removeAttachment。 */
    previewUrl?: string
  }[]>([])
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
  const lastThinking = useMemo(() => lastRoundThinking(messages), [messages])
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

  /**
   * 当前会话的全部工具调用（历史 + 本轮实时）。
   *
   * 子代理徽标要从这里判断「有没有在跑的」。两条来源都要：
   * 历史消息里的（切回来还能看到）+ 正在流式接收的（刚派出去的）。
   * 流式那批不进 messages，只活在 chat.toolCalls 里。
   */
  const activeSubagentTools = [
    ...messages.flatMap((m) => m.executedTools ?? []),
    ...toolCalls.map((t) => ({ name: t.name, done: t.done, isError: t.isError })),
  ]
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
    /* 开新一轮前只需断掉本地旧流，**不能**调 streamStopRef ——
       它内部会请求后端 /stop，等于每次发送都先给上一轮发一次停止请求。
       这里清 ref 即可：旧连接由 chatStreamManager 在 register 新流时接管。 */
    streamStopRef.current = null
    const aiId = chat.startAiMessage({ demo: false, projectId: activeThread?.projectId ?? undefined, sessionId })
    let produced = false
    setPendingStartedAt(Date.now())
    setPending(true)
    // 新的一轮从零开始记工具调用：上一轮的记录属于上一条回复，留着会串味。
    setToolCalls([])
    toolCallsRef.current = []
    // 产物同理：上一轮交付的文件不属于这一条回复。
    deliverablesRef.current = []
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
      onTodo: (todos) => {
        /* 任务清单整表替换：模型每次 todo_write 都给完整清单。 */
        chat.setAiTodos(aiId, todos)
      },
      onDiagnostic: (kind, detail) => {
        /* 压缩 / token 上限 / 重试：不改变正文，但解释了「为什么这次不对劲」。
           以前后端直接丢弃，用户只能看到答复怪却无从判断。 */
        chat.addAiDiagnostic(aiId, kind, detail)
      },
      onCompleted: (message) => {
        chatStreamManager.notifyCompleted(sessionId)
        produced = true
        // 带上本轮工具记录：completed 到服务端消息读回之间有个异步空档，
        // 不先挂上去，列表会在这一瞬间闪空。
        chat.finishAiMessage(aiId, message.text, toolCallsRef.current, message.reasoning, message.todos,
                             deliverablesRef.current)
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
        chatStreamManager.notifyError(sessionId, error.message || '回复流中断')
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
        /* 上下文占用要的是**最后一次请求的 prompt 大小**，不是累加值 ——
           所以单独存一份，绝不能复用上面那个按桶累加的 `usage`。
           公式与 DSH 一致：未缓存输入 + 缓存读 + 缓存写（不含输出，
           因为输出还没回到上下文里）。inputTokens 为 0 的样本要跳过：
           压缩刚结束时上游只报 output，直接用会把进度条打到 0。 */
        const prompt = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0)
        if ((u.inputTokens ?? 0) > 0 && prompt > 0) {
          setContextUsed(prompt)
        }
      },
      onDeliverables: (f) => {
        /* 合并去重：同一 path 后到的覆盖前面的（说明可能更完整）。 */
        const map = new Map(deliverablesRef.current.map((x) => [x.path, x]))
        for (const item of f.files) map.set(item.path, item)
        deliverablesRef.current = [...map.values()]
      },
      onJob: (j) => {
        /* 同一 jobId 会来两帧：registered（running）与 settled（终态）。
           按 id 覆盖，不能追加 —— 追加会变成两条同名记录。
           startedAt 只在本机记一次：settled 帧不带开始时间，若覆盖掉就
           算不出「它跑了多久」。 */
        setJobs((prev) => {
          const at = prev.find((x) => x.jobId === j.jobId)
          const next: JobView = {
            jobId: j.jobId,
            kind: j.kind,
            label: j.label,
            status: j.status,
            startedAt: at?.startedAt ?? Date.now(),
            ...(j.durationMs !== undefined ? { durationMs: j.durationMs } : {}),
            ...(j.detail !== undefined ? { detail: j.detail } : {}),
          }
          return at
            ? prev.map((x) => (x.jobId === j.jobId ? next : x))
            : [...prev, next]
        })
      },
      onStopped: () => {
        /* 服务端确认了这一轮已停止（收到 stopped 事件）。
           注意：这里**不再**调用 chatStreamManager.stop —— 那会再发一次 /stop 请求，
           且会把已是 stopped 的状态重新广播一遍。清理只做本地。
           注意保存边界：**用户那条消息在启动回复流之前就已经写入服务端了**
           （见发送流程里 sendMessage 先于 stream），停止后不保存的是这条
           未完成的 AI 回复 —— 半截正文撤掉，避免下次读历史时它又消失。
           文案不能说成「这一轮没有保存」，那会让人以为自己的话也没了。 */
        /* 只清本地，且与 phase effect 去重：若管理器登记的「确认停止」标记
           已被 takeConfirmedStop 取走，说明那条路径已经清理过，这里不重复。
           反之（服务端主动推 stopped 事件、非用户点击）则在这里清理。 */
        const confirmed = chatStreamManager.takeConfirmedStop(sessionId)
        if (!confirmed) {
          chat.removeMessage(aiId)
          clearRoundTrace()
          setReplyNote('已停止生成。你的消息已保存，这条回复没有保存。')
        }
        setPending(false)
        setPendingStartedAt(null)
        setAgentPhase(null)
      },
      onBackground: (info) => {
        chatStreamManager.release(sessionId)
        /* 超时转后台 ≠ 失败。任务还在跑，完成时会落库。
           这里必须放在 replyNote（中性说明）而不是失败提示里，
           否则用户会以为挂了而重发一遍 —— 那才是真的重复消耗。 */
        setPending(false)
        setPendingStartedAt(null)
        setAgentPhase(null)
        setReplyNote(info.message)
      },
      onContext: (c) => {
        /* 窗口大小只跟模型走，不随轮次变 —— 覆盖即可，不累加。
           引擎没报（适配器不上报）时这帧根本不会来，保持 null = 「不知道」。
           工具 schema 同理：每次请求都一样，覆盖。 */
        if (c.contextWindow !== undefined) setContextWindow(c.contextWindow)
        if (c.toolsTokens !== undefined) setToolsTokens(c.toolsTokens)
        /* 分档是整块快照，直接覆盖。它是「此刻上下文里有什么」，
           不是累计值 —— 累加会把压缩掉的内容也算进去。 */
        if (c.breakdown !== undefined) setBreakdown(c.breakdown)
      },
    }, { harness: selectedHarness?.id ?? harnessId, model: backendModels.length ? effectiveModel : undefined, reasoningEffort: effectiveEffort ?? undefined })
    chatStreamManager.register({
      sessionId,
      userMessageId: lastUserId ?? undefined,
      aiMessageId: aiId,
      stop: () => handle.close(),
      startedAt: Date.now(),
    })
    streamStopRef.current = () => {
      /* 停止必须打到后端，而且**不能在这里顺手 close()**：
         管理器会在后端确认后自行断开本地流。这里若提前 close，
         就变成「先断 SSE、再等后端」—— 与设计相反：
         · 停止失败时，用户再也收不到仍在生成的那条回复；
         · 后端确认时，stopped 事件也可能因为连接已断而收不到，半截回复留在界面上。
         所以这里只发起停止请求，本地收尾交给管理器与事件流。 */
      setStopping(true)
      void chatStreamManager.stop(sessionId).then((outcome) => {
        setStopping(false)
        /* 按后端真实答复分开说，不把 stopped:false 当成「已停止」：
           · stopped：管理器已断流并广播，这里不必再做什么；
           · supersededRound：后端停掉了，但那条回复已经不在了（刚跑完或
             已换新一轮），本地没有需要收尾的东西，如实说明；
           · not_running：后端没找到在跑的进程（可能刚好跑完，也可能是停止
             早于进程登记）—— 保持连接，让真实终态自己到达，并重新读一次历史；
           · failed：请求没送达，后端状态未知，同样保持连接。 */
        if (outcome.supersededRound) {
          setReplyNote('这次停止针对的回复已经结束了；如果还有新的回复在生成，请再点一次停止。')
          void props.threads.loadMessages(sessionId, { force: true })
        } else if (outcome.status === 'not_running') {
          setReplyNote('这次没有停止到正在运行的回复；回复可能继续，也可能已经结束。已重新读取会话，请以最新回复为准。')
          void props.threads.loadMessages(sessionId, { force: true })
        } else if (outcome.status === 'failed') {
          setReplyNote(`停止请求没有送达（${(outcome.error ?? '').slice(0, 60)}）。回复可能继续，请再点一次停止或稍后重新读取会话确认。`)
        }
      })
    }
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
    if (pending || submissionInFlight.current || projectPending) return
    if (!v) {
      if (attachments.length) setSendError('请填写一条消息后再发送附件。')
      return
    }
    if (attachments.length && !activeIsServer) {
      setSendError('当前对话未保存到项目，附件无法随消息发送。请先创建或选择项目会话。')
      return
    }
    /* 拦截必须在**两条路径分叉之前**。
       之前只在 sendToServer（服务端会话）里拦，而未归属项目的会话是 origin='local'，
       在下面 `if (activeIsServer)` 处就分流走了本地路径 —— 于是界面显示
       「请先关联项目」，消息却照样发出去、还起了普通对话回复。实测复现。
       所以这里按同一份判定先拦一次，两条路径都绕不过去。 */
    {
      const gate = resolveSendPlan({
        targetSnapshot: sessionDraft.draft.targetSnapshot,
        draftIntent: sessionDraft.draft.intentAction,
        continuationScopeMode: sessionDraft.draft.continuationScopeMode,
        hasProject: Boolean(activeThread?.projectId),
        /* 本地草稿（含服务端创建失败后的降级会话）即使有 projectId，
           也走不了修改分支 —— 它在这一行下面就被分流到本地路径了。 */
        isServerSession: Boolean(activeIsServer),
      })
      if (gate.kind === 'blocked') {
        setSendError(
          gate.reason === 'missing_target'
            ? '当前草稿处于继续调整流程，尚未选定修改目标。请先在工作台圈定时间段或画面，或选择【确认整片修改】后再提交。'
            : gate.reason === 'unsaved_session'
              ? '这条会话还没有保存到项目，无法发起工程修改。请先在左栏重试保存这条对话，或新建一个已保存的项目会话。'
              : '这条会话还没有归属项目，无法发起工程修改。请先在「我的创作」里打开或新建一个项目会话，再提交修改意见。')
        return
      }
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
    if (!sessionId || !activeIsServer || submissionInFlight.current) return
    // Keep service/draft work bound to the submitted session after navigation.
    // View-only state must never leak into the session now on screen.
    const isSubmissionVisible = () => mountedRef.current && activeSessionRef.current === sessionId
    const showSubmissionError = (message: string) => {
      if (isSubmissionVisible()) setSendError(message)
    }
    submissionInFlight.current = true
    setSubmitting(true)
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

      const targetSnapshot = sessionDraft.draft.targetSnapshot
      const continuationMode = sessionDraft.draft.continuationScopeMode

      /* 发送去向由唯一判定函数决定（显示端调的是同一个函数）。
         这里不再自己写一套顺序 —— 两套一旦分叉，界面就会说谎。 */
      const plan = resolveSendPlan({
        targetSnapshot,
        draftIntent: sessionDraft.draft.intentAction,
        continuationScopeMode: continuationMode,
        /* 项目归属与会话来源都必须传真实值：
           没有项目、或仍是本地草稿，都发不出创作任务。
           不传的话判定会说「修改」，实际却落回普通回复 —— 界面在说谎。 */
        hasProject: Boolean(activeThread?.projectId),
        isServerSession: Boolean(activeIsServer),
      })

      // 1. 拦截态：缺目标、缺项目、或会话未保存，都不能当作普通聊天吞掉
      if (plan.kind === 'blocked') {
        setSendError(
          plan.reason === 'missing_target'
            ? '当前草稿处于继续调整流程，尚未选定修改目标。请先在工作台圈定时间段或画面，或选择【确认整片修改】后再提交。'
            : plan.reason === 'unsaved_session'
              ? '这条会话还没有保存到项目，无法发起工程修改。请先在左栏重试保存这条对话，或新建一个已保存的项目会话。'
              : '这条会话还没有归属项目，无法发起工程修改。请先在「我的创作」里打开或新建一个项目会话，再提交修改意见。')
        return
      }

      /* 2. 意图直接取判定结果：
         · 显式 query 优先（用户最后一次主动选择，范围确认不能推翻）；
         · 显式 modify **没有目标也算修改**（旧注释写成「只有确认整片才修改」不准确）；
         · 无目标、无意图、未确认整片 → 普通对话。 */
      const isModifyIntent = plan.kind === 'modify'
      const isWholeConfirmedContinuation = continuationMode === 'whole_confirmed'

      const creationReferences: NonNullable<Parameters<typeof props.threads.sendMessage>[2]>['references'] = [...refs]
      if (activeThread?.projectId) {
        if (targetSnapshot) {
          creationReferences.push({
            id: `ref-target-${activeThread.projectId}`,
            role: isModifyIntent ? 'target' : 'context',
            kind: 'project',
            projectId: activeThread.projectId,
            label: targetSnapshot.label || (targetSnapshot.rangeSpan ? `时间段（${targetSnapshot.rangeSpan.start}–${targetSnapshot.rangeSpan.end}）` : '工作台引用目标'),
            action: isModifyIntent ? 'workflow_modify' : 'workflow_query',
          })
        } else if (isWholeConfirmedContinuation && isModifyIntent) {
          /* 只有确定是修改时才推「整片工程修改」目标。
             用户已改成「关于此提问」时不能推这个 action —— 那会让后端按改工程处理。 */
          creationReferences.push({
            id: `ref-target-${activeThread.projectId}`,
            role: 'target',
            kind: 'project',
            projectId: activeThread.projectId,
            label: '整片工程修改',
            action: 'workflow_modify',
          })
        } else if (isWholeConfirmedContinuation) {
          /* 确认整片过、但用户改成了提问：仍把整片作为上下文带上，action 是查询。 */
          creationReferences.push({
            id: `ref-target-${activeThread.projectId}`,
            role: 'context',
            kind: 'project',
            projectId: activeThread.projectId,
            label: '整片工程（仅提问，不修改）',
            action: 'workflow_query',
          })
        } else if (isModifyIntent) {
          /* 明确选了「修改此目标」但没有局部目标、也没点过「确认整片」：
             这是一次整片工程修改，**必须推 workflow_modify 引用**。
             不推的话消息里没有任何修改标记，自动续流守卫
             （按 action === 'workflow_modify' 判断是否创作任务）识别不出来，
             于是修改提交完又额外起了一条普通对话回复 —— 实测复现：
             一次修改同时出现 AI 思考回复 + 创作任务两条线。
             同时这也让「这条消息触发的是哪种动作」在服务端历史里可查。 */
          creationReferences.push({
            id: `ref-target-${activeThread.projectId}`,
            role: 'target',
            kind: 'project',
            projectId: activeThread.projectId,
            label: '整片工程修改',
            action: 'workflow_modify',
          })
        }
      }

      /* ── 发送身份：在**请求组装完成之后**计算 ──
         不再手写「等价标识」：直接用即将发出去的真实字段算身份。
         早期版本漏掉了素材引用（refs）和目标图片，导致「文字不变、只换参考素材」
         仍被认成旧请求 —— 现在入参就是真正要发送的那份对象。 */
      const messageIdFp = messageFingerprint({
        sessionId,
        text: text.trim(),
        references: creationReferences.length > 0 ? creationReferences : null,
        attachments: ready.length > 0 ? ready : null,
      })
      /* 消息幂等键：同一份消息请求才复用。刷新后靠 pendingSubmission 恢复，
         否则「消息已保存、创作结果不确定」时刷新再发会重复落一条用户消息。 */
      const pending = sessionDraft.draft.pendingSubmission
      const recoveredKey = (pending && pending.requestId && pending.idempotencyKey
        && isSameRequest(messageIdFp, pending))
        ? pending.idempotencyKey
        : null
      const key = recoveredKey
        ?? ((idemKeyRef.current && idemTextRef.current === messageIdFp) ? idemKeyRef.current : newIdempotencyKey())
      idemKeyRef.current = key
      idemTextRef.current = messageIdFp
      /* 是不是上一轮的重试 —— 创作 requestId 能否复用的唯一判据。 */
      const isRetryOfPending = isSameRequest(messageIdFp, pending)
      /* 提交快照：记录「这次到底发了什么」。
         成功后只清与这份快照相同的部分 —— 用户在等待期间改过的
         目标/附件/意图会被保留（见 clearSentPartsOnly）。 */
      const sentSnapshot = {
        text: sessionDraft.draft.text,
        attachments: [...attachments],
        targetSnapshot: sessionDraft.draft.targetSnapshot,
        continuationScopeMode: sessionDraft.draft.continuationScopeMode ?? null,
        intentAction: sessionDraft.draft.intentAction,
        /* 逐字段版本在「即将发请求」处取：
           之后流程内部写 pendingSubmission 不属于任何用户可编辑字段，不会推进版本。 */
        versions: currentFieldVersions(activeThread?.projectId, sessionId),
        idempotencyKey: key,
      }

      // 1. 若是修改意图且带有明确基准版本，必须在保存用户消息之前严格核对工程当前最新版本！
      // 绝不先存消息再报错，杜绝在会话历史中留下未执行修改的孤立消息
      if (isModifyIntent && targetSnapshot && activeThread?.projectId) {
        if (targetSnapshot.version !== null && targetSnapshot.version !== undefined) {
          const targetVer = Number(targetSnapshot.version)
          try {
            /* 【基准必须与显示同源】提交前的「工程当前版本」以**当前场景版本**为准。
               原实现先用 creation().version —— 那是「上一轮创作产出的版本」，
               工程可能又往前走了；它甚至可能落后于场景版本，导致
               「界面显示 v18、校验按 v17 比」，两边结论不一致。

               顺序：当前场景版本（权威）→ 场景版本历史最大值（兜底）→ 不猜。 */
            let confirmedVer: number | null = null
            try {
              const scene = await studioHttpApi().task.currentScene(activeThread.projectId)
              if (scene?.initialized && typeof scene.version === 'number') {
                confirmedVer = Number(scene.version)
              }
            } catch { /* 读不到就走下一步 */ }

            /* 【不得用历史最大值完成确认】场景版本列表里最高的一版**不等于**
               当前工程版本：工程可能已经改到 v17，而这一版还没渲出片，
               列表最高仍是 v16。拿它当「当前工程版本」会让提交前校验
               放行一个其实已过期的基准。
               所以这里**只**认 currentScene 的权威值；读不到就保持 null，
               由下面分支明确阻止并说明原因。 */
            if (confirmedVer !== null) {
              if (isSubmissionVisible()) setStageLeadVersion(confirmedVer)
              if (targetVer < confirmedVer) {
                showSubmissionError(`目标引用的基准版本（v${targetVer}）已过期，工程当前最新版本为 v${confirmedVer}。新版画面与时间轴可能已变动，请点击输入框上方胶囊核对后再提交。`)
                return
              }
            } else {
              showSubmissionError(`未能确认工程当前版本（目标引用基准版本为 v${targetVer}）。为防止基于错误基准进行修改，请检查网络或重新选择画面目标后再提交。`)
              return
            }
          } catch (verErr: unknown) {
            const msg = verErr instanceof Error ? verErr.message : String(verErr)
            showSubmissionError(`未能确认工程当前版本（${msg}）。为防止基于错误基准进行修改，请稍后重试。`)
            return
          }
        }
      }

      // 2. 版本核对通过后，将用户消息正式写入服务端会话
      if (isModifyIntent && activeThread?.projectId) {
        await ensureCreationContext(activeThread.projectId, text.trim(), studioHttpApi().workflowContext)
      }
      const saved = await props.threads.sendMessage(sessionId, text, {
        idempotencyKey: key,
        ...(ready.length > 0 ? { attachments: ready } : {}),
        ...(creationReferences.length > 0 ? { references: creationReferences } : {}),
      })
      // A saved creation message must still register its durable job even when
      // the user has left this view. Ordinary chat can resume when reopened.
      if (!isSubmissionVisible() && !isModifyIntent) return

      // 3. 若用户明确选择修改视频（含带目标快照修改或已确认的整片续改），真实触发后端创作修改任务；若仅为提问，则走普通对话回复
      if (isModifyIntent && activeThread?.projectId) {
        const span = targetSnapshot?.rangeSpan
        const spanText = span ? `${Math.floor(span.start / 60)}:${String(Math.floor(span.start % 60)).padStart(2, '0')}–${Math.floor(span.end / 60)}:${String(Math.floor(span.end % 60)).padStart(2, '0')}` : ''
        const correctionText = spanText ? `【指定时间段 ${spanText}】\n\n用户原话：${text.trim()}` : text.trim()

        // 严格合规校验：必须是合法的图片数据（JPEG Data URL 或图片路径），绝不传递 mp4 视频文件
        const rawImg = targetSnapshot?.previewImage
        const validPreviewImg = (rawImg && (rawImg.startsWith('data:image/') || rawImg.endsWith('.jpg') || rawImg.endsWith('.jpeg') || rawImg.endsWith('.png')))
          ? rawImg
          : undefined
        
        /* 【关键】只有「同一份内容的原样重试」才能复用 requestId。
           用户改了要求再发，那是一个**新的创作请求**，必须用新的 requestId ——
           否则会把新要求提交成上一轮的任务，或复用到旧任务状态上、
           把用户刚写的新内容丢掉。判据是完整发送快照（isRetryOfPending）。 */
        /* 创作请求身份：入参就是下面真正要 POST 的那几个字段。 */
        const creationIdFp = creationFingerprint({
          projectId: activeThread.projectId,
          intent: text.trim(),
          references: creationReferences,
          previewImage: validPreviewImg ?? null,
          baseVersion: targetSnapshot?.version ?? null,
          correction: correctionText,
          selection: { harness: selectedHarness?.id ?? harnessId, model: effectiveModel, reasoningEffort: effectiveEffort ?? undefined },
        })
        /* 【连接层核对】只有当这次创作字段与上次记录**完全一致**时才复用旧任务。
           isRetryOfPending 保证「是同一条消息」；creationIdFp 保证「是同一份创作请求」。
           两者都成立才允许把旧任务状态当成这次的结果 ——
           否则会出现「新要求提交后却显示旧任务已完成」。 */
        const recordedCreationFp = sessionDraft.draft.pendingSubmission?.creationFingerprint
        /* 必须**确认**创作字段一致才复用旧任务。
           旧记录没有 creationFingerprint 时无法确认 —— 不能默认放行
           （那等于把「不知道」当成「一致」，会把新要求接到旧任务上）。 */
        const oldReqId = (isRetryOfPending && recordedCreationFp !== undefined
          && recordedCreationFp === creationIdFp)
          ? sessionDraft.draft.pendingSubmission?.requestId
          : null
        const reqId = (oldReqId && oldReqId.trim())
          ? oldReqId.trim()
          : (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : '00000000-0000-4000-8000-' + String(Date.now()).padStart(12, '0'))

        /* 【发起前先落盘恢复信息】。
           原先 pendingSubmission 只在 create() 失败或抛错后才写 ——
           若请求仍在等待时用户刷新页面，身份全丢，重发会多落一条用户消息、
           并新建一个创作任务。所以这里在**发请求之前**先把恢复所需的三项
           写进草稿（消息 id、消息幂等键、创作 requestId）。
           失败分支随后会用更完整的内容覆盖它，二者不冲突。 */
        sessionDraft.updateDraft({
          pendingSubmission: {
            requestId: reqId,
            promptKey: messageIdFp,
            messageFingerprint: messageIdFp,
            creationFingerprint: creationIdFp,
            idempotencyKey: key,
            sessionId,
            userMessageId: saved.id,
            createdAt: Date.now(),
            targetSnapshot,
          },
        })

        // 重试前置幂等检查：若服务端已有该请求且正在运行或已完成，直接复用状态，不重复调用 create
        if (oldReqId) {
          try {
            const existing = await studioHttpApi().workflowContext.creation(activeThread.projectId, reqId)
            if (existing && (existing.state === 'running' || existing.state === 'rendered')) {
              idemKeyRef.current = null
              idemTextRef.current = null
              if (isSubmissionVisible()) chat.setDraft('')
              /* 这条分支同样要登记「这段文字已发出」再清草稿 ——
                 它清草稿后直接 return，不走下面的成功路径；
                 漏登记的话输入框的迟来 flush 会把原文写回草稿
                 （探针实测：markDraftSent 从未被调用，草稿却已被清空）。 */
              markDraftSent(activeThread.projectId, sessionId, text)
              /* 只清「这次发出去的那份」：用户若已输入新内容则保留。
                 附件也交给同一个函数判断 —— 无条件 setAttachments([]) 会把
                 用户在等待期间新加的附件一起清掉。 */
              clearSentPartsOnly(activeThread.projectId, sessionId, sentSnapshot)
              if (isSubmissionVisible()) chat.appendMessage(saved)
              return
            }
          } catch {
            // 未找到历史任务，继续执行发起
          }
        }

        try {
          const outcome = await submitCreation({
            projectId: activeThread.projectId, intent:text.trim(), references:creationReferences as any,
            previewImage:validPreviewImg, baseVersion:targetSnapshot?.version ?? undefined,
            correction:correctionText, requestId:reqId, sessionId, userMessageId:saved.id,
            selection:{harness:selectedHarness?.id ?? harnessId,model:effectiveModel,reasoningEffort:effectiveEffort ?? undefined},
          })
          /* 从**对话区**发起的创作：结果要落两处，缺一处界面就会说谎。
             1. AI 回复写进会话 —— 工作台一直是显式 sendMessage 落库的，
                对话区此前没有这一步，于是「发起后当场看不到回复，
                刷新一次才出现」。实测确认。
             2. 轮次结论写进共享 store —— 此前只有工作台写、对话区只读。

             身份核对与工作台同一口径：
             · 会话：用**这次请求自己带的 sessionId**（发起这轮创作的就是它），
               不拿别的会话顶替；
             · 消息：后端回显的 userMessageId 必须等于这次落库的用户消息 id，
               不等就说明不是这一轮，宁可不写。 */
          if (outcome.reply && outcome.state !== 'failed') {
            try {
              const savedAi = await props.threads.sendMessage(sessionId, outcome.reply, {
                role: 'assistant',
                taskId: saved.id,
                idempotencyKey: `idem-reply-${saved.id}`,
              })
              /* 用服务端返回的真实消息 id 追加，别自造一个本地 id ——
                 刷新后同一条会以另一个 id 再出现一次。 */
              if (isSubmissionVisible()) chat.appendMessage({
                id: savedAi.id,
                role: 'ai',
                text: outcome.reply,
                projectId: activeThread.projectId,
                sessionId,
                /* 带上触发这条回复的用户消息 id：两处界面都按它查轮次结论 */
                taskId: saved.id,
                at: Date.now(),
              })
            } catch (replyErr) {
              /* 【保存失败 ≠ 一定没保存】后端可能在返回前就已自动落库
                 （或这次请求其实成功、只是响应没回来）。所以不能凭这一个异常
                 断言结果，必须回头核对服务端**实际**有没有这条回复。
                 未确认落库时，界面要明确标出「没存进会话」并给重试入口 ——
                 像正常回复一样显示，用户就无从判断，也无从补救。 */
              const cause = replyErr instanceof Error ? replyErr.message : String(replyErr)
              const lookup = await findStoredReply(sessionId, saved.id, outcome.reply)
              const saveState = resolveReplySaveState(lookup)
              if (saveState === 'saved' && lookup.kind === 'found') {
                /* 服务端确实有：用真实 id 显示，不标失败 */
                if (isSubmissionVisible()) chat.appendMessage({
                  id: lookup.messageId,
                  role: 'ai',
                  text: lookup.text,
                  projectId: activeThread.projectId,
                  sessionId,
                  taskId: saved.id,
                  at: Date.now(),
                })
              } else {
                /* 未保存(absent) 或 结果未知(unknown)：都要显示可见状态 + 重试，
                   但文案必须不同 —— unknown 时不能说「没有存进会话」。 */
                const localId = `m-ai-${saved.id}`
                console.warn(`[Conversation] 创作回复保存状态=${saveState}:`, cause)
                if (isSubmissionVisible()) chat.appendMessage({
                  id: localId,
                  role: 'ai',
                  text: outcome.reply,
                  projectId: activeThread.projectId,
                  sessionId,
                  taskId: saved.id,
                  at: Date.now(),
                  failed: replySaveNotice(saveState, cause.slice(0, 80)) ?? undefined,
                })
                if (isSubmissionVisible()) setReplySaveRetry({
                  sessionId,
                  userMessageId: saved.id,
                  reply: outcome.reply,
                  localId,
                })
              }
            }
          }
          if (outcome.state === 'awaiting_info' && outcome.userMessageId
              && outcome.userMessageId === saved.id) {
            recordRoundOutcome(activeThread.projectId, sessionId, {
              reply: outcome.reply ?? '',
              userMessageId: outcome.userMessageId,
              ...(outcome.requestId ? { requestId: outcome.requestId } : {}),
            })
            /* 本页刚产生了新轮次：缓存里的时间点已经旧了，主动失效。
               不失效的话，切走再切回来会因为「缓存没过期」而不再拉取，
               别的窗口/后台刚写入的结果也就一直看不到。 */
            invalidateBackfill(activeThread.projectId, sessionId)
          }
          if (outcome.state === 'failed') {
            const errText = outcome.reply || '视频修改任务未能成功执行'
            showSubmissionError(errText)
            sessionDraft.updateDraft({
              pendingSubmission: {
                requestId: reqId,
                /* 存真实消息请求身份；创作身份单独记一份，便于核对
                   「新消息是否错配到旧任务」。 */
                promptKey: messageIdFp,
                messageFingerprint: messageIdFp,
                creationFingerprint: creationIdFp,
                idempotencyKey: key,
                sessionId,
                userMessageId: saved.id,
                createdAt: Date.now(),
                error: errText,
                targetSnapshot,
              }
            })
            return
          }
        } catch (taskErr: unknown) {
          const msg = taskErr instanceof Error ? taskErr.message : String(taskErr)
          showSubmissionError(`消息已送达会话，制作结果尚未完成确认：${msg}`)
          sessionDraft.updateDraft({
            pendingSubmission: {
              requestId: reqId,
              /* 存完整指纹而不是「会话+项目+文字」：
                   重试身份要按整份请求判定，只记文字会让
                   「改了目标/附件但文字没变」被误认成同一请求。 */
                promptKey: messageIdFp,
              messageFingerprint: messageIdFp,
              creationFingerprint: creationIdFp,
              idempotencyKey: key,
              sessionId,
              userMessageId: saved.id,
              createdAt: Date.now(),
              error: msg,
              targetSnapshot,
            }
          })
          return
        }
      }

      /* 【一次发送尝试到此结束】清空幂等键。
         幂等键保护的是「同一次尚未确认的发送」，不是「同一段文字」：
         用户上一轮成功后**主动再发同一句话**，那是两次发送，必须产生两条消息。
         若像早先那样「内容相同就永远复用同一把键」，这两次会被服务端当成一次，
         用户第二次的话就静默丢失了。
         失败/结果未知的路径不会走到这里（那之前就 return 了），
         所以「原样重试复用旧键」由 pendingSubmission 负责，与这里互不冲突。 */
      idemKeyRef.current = null
      idemTextRef.current = null
      if (isSubmissionVisible()) chat.setDraft('')
      /* 先登记「这段文字已发出」，再清草稿：
         输入框的 blur 回调稍后还会 flush 一次原文，不拦就会被写回草稿。 */
      markDraftSent(activeThread?.projectId, sessionId, text)
      /* 只清「这次发出去的那份」：用户若已输入新内容则保留（含附件）。 */
      clearSentPartsOnly(activeThread?.projectId, sessionId, sentSnapshot)
      if (isSubmissionVisible()) chat.appendMessage(saved)
      if (!isModifyIntent && isSubmissionVisible()) {
        /* 先登记再起流：下面的自动起流 effect 也会因为「最后一条是用户消息」
           尝试 startServerReply。若这里不先登记，effect 会在 stream 注册完成前
           看到 has()===false，于是起第二条流 —— 实测表现为早停时出现两条 stream
           和两次 /stop。登记后 effect 的 servedRef 守卫能立刻生效。 */
        servedRef.add(saved.id)
        startServerReply()
      }
    } catch (cause) {
      // 没有发出去：消息不显示、草稿保留、给出原因；幂等键保留以便原样重试
      showSubmissionError(sendErrorText(cause))
    } finally {
      submissionInFlight.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }

  /**
   * 重试这一轮：把最后一条用户消息原样再发一次。
   *
   * 为什么不是「重新请求服务端生成」：本项目的回复来自一轮真实的 Agent 执行，
   * 后端不支持断点续读（Last-Event-ID 只校验格式），所以「接着刚才那条继续」
   * 做不到。能做的是把同一句话再发一遍 —— 幂等键保证服务端不会重复落库。
   */
  /**
   * 核对服务端是否**真的**存下了这一轮的回复 —— 返回三态。
   *
   * <p>判据是「会话里存在一条 taskId 等于这条用户消息 id 的助手消息」——
   * 这正是保存时写入的归属字段，比比对文本可靠（文本可能被截断/改写）。</p>
   *
   * <p>三态缺一不可：把「查完了确实没有」和「没查成」都返回 null，
   * 界面就会在断网时断言「回复没有存进会话」—— 而那时后端很可能已经
   * 自动保存好了。翻页上限被触及也算「没查完」，同样不能当作确实没有。</p>
   */
  const findStoredReply = async (
    sid: string,
    userMessageId: string,
    fallbackText: string,
  ): Promise<ReplyLookup> => {
    try {
      /* 跟游标翻页：只读第一页会在长会话里漏掉刚存的那条，
         从而把「其实存好了」误判成「没存」。 */
      let cursor: string | undefined
      for (let page = 0; page < 20; page += 1) {
        const res = await studioHttpApi().chat.listMessages(sid, {
          limit: 80,
          ...(cursor ? { cursor } : {}),
        })
        for (const m of res.items ?? []) {
          if (m.role === 'assistant' && m.taskId === userMessageId) {
            return { kind: 'found', messageId: m.id, text: m.text ?? fallbackText }
          }
        }
        cursor = res.nextCursor ?? undefined
        if (!cursor) return { kind: 'absent' }
      }
      /* 翻到上限还没到末页：**没有查完**，不能断言不存在 */
      return { kind: 'unknown', reason: '会话消息过多，未能查完' }
    } catch (err) {
      /* 核对本身失败：结果未知，绝不当作「没有保存」 */
      return {
        kind: 'unknown',
        reason: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /** 补存这条创作回复：失败标记清掉，重新写一次会话。 */
  const retrySaveReply = useCallback(async () => {
    const target = replySaveRetry
    if (!target) return
    setReplySaveRetry(null)
    try {
      const savedAi = await props.threads.sendMessage(target.sessionId, target.reply, {
        role: 'assistant',
        taskId: target.userMessageId,
        idempotencyKey: `idem-reply-${target.userMessageId}`,
      })
      /* 换成服务端 id 并清掉失败标记：重试用的是同一把幂等键，
         服务端不会因为补存而多出一条。
         没有 replaceMessage，用「先移除本地占位、再追加服务端那条」实现 ——
         顺序不能反，否则 appendMessage 的去重会按 id 判定，两条都在。 */
      chat.removeMessage(target.localId)
      chat.appendMessage({
        id: savedAi.id,
        role: 'ai',
        text: target.reply,
        taskId: target.userMessageId,
        sessionId: target.sessionId,
        at: Date.now(),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSendError(`回复仍未存进会话（${msg.slice(0, 80)}）。刷新后这条会消失，请再试一次。`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replySaveRetry, chat, props.threads])

  const retryLastRound = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser || pending) return
    /* 用户主动重试：清掉失败标记，否则自动路径与手动路径都被挡住 */
    MODULE_FAILED_IDS.delete(lastUser.id)
    servedRef.delete(lastUser.id)
    send(lastUser.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, pending])

  /* 输入框换成官方组件后文字由它自己持有，这里接收它交上来的正文 */
  const submit = (text?: string) => {
    send(text ?? chat.draft)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) el.style.height = 'auto'
    })
  }

  /* ── 输入区派生值 ── */
  const harness = HARNESSES.find((h) => h.id === harnessId) ?? HARNESSES[0]
  const prefKey = prefsKey(harnessId, model)
  const currentPrefs: ModelPrefs = prefs[prefKey] ?? DEFAULT_PREFS
  void currentPrefs
  const setPref = (patch: Partial<ModelPrefs>) => {
    setPrefs((all) => {
      const next = { ...all, [prefKey]: { ...(all[prefKey] ?? DEFAULT_PREFS), ...patch } }
      savePrefs(next)
      return next
    })
  }
  void setPref
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
  void harnessState
  const stateOf = (id: string) => availabilityOf(probe, id)
  void stateOf
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
  const selectedHarness = matchHarness(probe.harnesses, harnessId)

  const composerHarnesses = useMemo(() => probe.harnesses.map((h) => ({
    id: h.id,
    name: HARNESSES.find((item) => item.id === (h.id === 'dsh-sdk' ? 'deepseek' : h.id))?.name ?? h.name,
    iconUrl: HARNESSES.find((item) => item.id === (h.id === 'dsh-sdk' ? 'deepseek' : h.id))?.icon ?? './assets/brand/deepseek.svg',
    available: h.status === 'available',
    models: (probe.modelsByHarness[h.id] ?? []).map((m) => ({ id: m.id, name: m.label || m.id, reasoningEfforts: m.reasoningEfforts })),
  })), [probe.harnesses, probe.modelsByHarness, probe.access])
  const backendModels = modelsOfHarness(selectedHarness?.id ?? harnessId).models
  const effectiveModel =
    backendModels.length === 0 || backendModels.some((m) => m.id === model)
      ? model
      : (backendModels.find((m) => m.default) ?? backendModels[0]).id
  /**
   * 五档强度始终可选，后端负责映射到模型真正支持的档位（不支持就逐级降级）。
   * 所以这里不做「模型是否支持该档」的拦截 —— 那会让用户以为选不了。
   */
  const effectiveEffort = thinking
  /**
   * 当前模型的上下文窗口（分母），来自后端模型目录。
   *
   * 这条兜底是必需的：DSH 只在 provider/model/窗口**变化时**才发一次
   * `request/context`，所以续接老会话时那一帧根本不会来（实测：全新会话有，
   * 续接会话没有）。只靠流里的帧，老会话的占用率永远不显示。
   * 模型目录里的 contextWindow 与流里那份是同一个值，可以直接用。
   */
  const modelContextWindow = backendModels.find((m) => m.id === effectiveModel)?.contextWindow

  /*
   * 组装官方输入框圆圈要的上下文快照。
   *
   * 字段名与形状照抄官方 hse 组件（contextUsage / context_window / blocks），
   * 不是我们自创的 —— 名字对不上官方会静默当作 null，圆圈恒显示 0%。
   *
   * 数据取「最后一条带 usage 的 AI 消息」：那是落库的持久事实，刷新后仍在；
   * 流式状态只在刚发完这一轮时存在，单独用会让圆圈一刷新就归零。
   */
  const lastUsageMsg = [...messages].reverse().find((m) => m.role === 'ai' && m.usage)?.usage
  const composerPromptTokens = lastUsageMsg?.promptTokens ?? contextUsed ?? null
  const composerWindow =
    lastUsageMsg?.contextWindow ?? contextWindow ?? modelContextWindow ?? 0
  const composerBreakdown = lastUsageMsg?.breakdown ?? breakdown ?? null
  /*
   * 上下文构成分档 —— 消息区那张卡片（.cv3-ctxmeter）的数据源。
   *
   * 原先它挂在输入框圆环上：圆环点开才看得到；现在圆环撤掉，
   * 卡片直接贴在每轮回复末尾，和 token 用量同一档辅助信息。
   *
   * 原版语义：k 是千 token，窗口也是千 token，一个点 = 1K。
   * resultsTokens（bash 回显等工具输出）并进 Tools —— 两者都是工具开销，
   * 且组件的 React key 与配色都要求 id 唯一。
   *
   * 没有真实数据（一次对话都没开始）时不渲染：画一个 0% 的空卡
   * 比不画更容易让人以为读数坏了。
   */
  const messageMeterKinds: Kind[] = composerBreakdown
    ? [
        { id: 'sys', name: 'System', k: composerBreakdown.systemTokens / 1000 },
        { id: 'tools', name: 'Tools', k: ((toolsTokens ?? 0) + composerBreakdown.resultsTokens) / 1000 },
        { id: 'files', name: 'Files', k: composerBreakdown.filesTokens / 1000 },
        { id: 'chat', name: 'Chat', k: composerBreakdown.chatTokens / 1000 },
        { id: 'mem', name: 'Memory', k: composerBreakdown.memoryTokens / 1000 },
      ]
    : []

  /* ⚠️ 必须等到**真的有实测 token 数**才给快照。
     只看窗口大小是不够的：窗口来自模型目录，任何状态下都有值，
     于是「一次对话都没开始」也会传出一个 projected_request_tokens: 0 的快照，
     官方圆圈据此画出 1%、并弹出「预计下一次请求 8k / 1M」的空面板 ——
     那正是用户看到的空状态 bug。没有数据就什么都不传，官方自己不渲染。 */
  const composerContextUsage: ContextUsageSnapshot | null =
    composerWindow > 0 && composerPromptTokens !== null && composerPromptTokens > 0
      ? {
          context_window: composerWindow,
          /* 官方自己会排序、算「其他/未归类」，渲染成列表，
             所以我们只按它的 kind/source/name/tokens 约定给原始分档。 */
          blocks: composerBreakdown
            ? [
                { kind: 'system', source: 'prompt', name: '系统提示', tokens: composerBreakdown.systemTokens },
                { kind: 'memory', source: 'rules', name: '记忆与规则', tokens: composerBreakdown.memoryTokens },
                { kind: 'files', source: 'files', name: '附件与文件', tokens: composerBreakdown.filesTokens },
                { kind: 'results', source: 'tools', name: '工具输出', tokens: composerBreakdown.resultsTokens },
                { kind: 'chat', source: 'turns', name: '对话', tokens: composerBreakdown.chatTokens },
              ].filter((b) => b.tokens > 0)
            : [],
          projected_request_tokens: composerPromptTokens,
        }
      : null

  /* 圆环点开的内容：Bencho 的 ContextMeter（点阵 + 分段条）。 */
  const composerMeterPanel =
    messageMeterKinds.length > 0 && composerWindow > 0 ? (
      <ContextMeter
        kinds={messageMeterKinds}
        windowK={Math.round(composerWindow / 1000)}
        style="Bar"
      />
    ) : null

  /**
   * 消息区卡片要不要画：必须**两个数都有**。
   *
   * 分子优先读落库的 promptTokens（刷新后仍在）；刚发完、消息还没落库那一瞬
   * 落库值为空，退回流里的实时水位 contextUsed —— 否则卡片会「发完就消失一帧」。
   * 分母同理：优先落库，其次流，最后模型目录（续接老会话时 DSH 不发那一帧）。
   */
  const messagePromptTokens = lastUsageMsg?.promptTokens ?? contextUsed ?? null
  /* 卡片画在列表末尾、每条回复的收尾处，属于当前这条回复。
     末尾不是 AI 回复时不画 —— 详见 shouldShowMessageMeter 的说明。 */
  const showMessageMeter = shouldShowMessageMeter({
    messages,
    hasBreakdown: messageMeterKinds.length > 0,
    window: composerWindow,
    promptTokens: messagePromptTokens,
  })
  const addFiles = (files: File[], forced?: 'file' | 'image' | 'video', done?: () => void) => {
    if (files.length > 0) {
      const picked = files.slice(0, 6).map((f) => {
        const kind = (forced ?? (f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'file')) as 'file' | 'image' | 'video'
        return {
          file: f,
          uploadId: crypto.randomUUID(),
          name: f.name,
          size: f.size,
          kind,
          mimeType: f.type,
          uploading: true,
          /* 图片直接给本地 object URL 做缩略图：卡片上显示真实画面，
             用户才能确认「选的是不是这张」。
             其他类型不需要，不创建以免多占内存。 */
          previewUrl: kind === 'image' ? URL.createObjectURL(f) : undefined,
        }
      })
      /* 先在界面里占位（显示「上传中」），再逐个上传。
         选完就传、而不是等发送时再传：用户能看到进度，发送时也不用等。 */
      setAttachments((prev) => [...prev, ...picked].slice(0, 6))

      for (const item of picked) {
        // 走真实后端的 /api/uploads（studioHttpApi），不是演示适配器 chatApi ——
        // 后者是本地 mock，没有上传能力。
        void studioHttpApi().chat.uploadAttachment(item.file, {
          /* 真实进度：图块上的环按它走动，角落显示百分比。
             到 100 就不再传 —— 后面等服务器回 201 的那一小段
             环已经画满，不会出现「满格却还在转」的怪状态。 */
          onProgress: (percent: number) => {
            if (!mountedRef.current) return
            setAttachments((prev) => prev.map((a) => (
              a.uploadId === item.uploadId ? { ...a, progress: percent } : a
            )))
          },
        })
          .then((uploaded: { fileId: string; mimeType: string }) => {
            if (!mountedRef.current) return
            setAttachments((prev) => prev.map((a) => (
              a.uploadId === item.uploadId && a.uploading
                ? { ...a, fileId: uploaded.fileId, mimeType: uploaded.mimeType, uploading: false, uploadError: undefined, progress: undefined }
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
      {drawer && <button type="button" aria-label="关闭项目栏" className="cv3-backdrop" onClick={() => setSideExpanded(false)} />}

      {/* 收起时整块不渲染：不留 56px 竖条（那是 dsh 的「图标轨」，本产品收起后
          左栏里没有任何还需要常驻的图标，留一条空轨道只是视觉噪音）。 */}
      {!rail && <aside className="cv3-side" data-drawer={drawer || undefined} aria-label="项目与对话">
        {/* 左栏标题与项目/对话操作同层，视图选项靠近下面的列表。 */}
        <div className="cv3-side-top">
          <span className="cv3-side-title">项目与对话</span>
          {/* 搜索并进这一排：收起时和旁边的图标按钮同款，点开时占满整条，
              同排其他按钮随即隐去，收起后再回来（见 conversation.css）。 */}
          <SeekSearch value={query} onChange={setQuery} width={248} size={28}
                      placeholder="搜索对话名称" ariaLabel="搜索对话" />
          <div className="cv3-top-actions">
          {props.onOverviewChange && <button type="button" className="cv3-icon-btn" aria-label="查看全部项目" title="查看全部项目" aria-pressed={props.overviewOpen ?? false} data-on={props.overviewOpen || undefined} onClick={() => props.onOverviewChange?.(true)}><LayoutGrid size={15}/></button>}
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
            /* 当前项目默认展开，其他项目默认收起：
               左栏挂着所有项目的会话，全展开时用户要滚过几十个别人的项目才能看到自己的。
               用户手动展开过的项目按用户的选择来（collapsedGroups 里记的是显式切换）。 */
            const isCurrentGroup = !isUng && !flat && g.projectId === props.openProject
            const collapsed = collapsedGroups.has(g.key)
              ? true
              : (collapsedGroups.has(`__open:${g.key}`) ? false : !isCurrentGroup && g.sessions.length > 0)
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
                              /* 点项目头 = 选中并展开该项目。
                                 为什么选中时强制展开：用户切到某个项目，就是要看它的会话；
                                 若这个项目上次被手动折叠过，切过去只看到一行项目名，
                                 会以为会话没了。折叠只在「已经在这个项目里」时生效。 */
                              const switchingIn = !isUng && proj && props.openProject !== proj.id
                              if (!isUng && proj) props.onSelectProject(proj.id)
                              setCollapsedGroups((prev) => {
                                const next = new Set(prev)
                                if (switchingIn) {
                                  /* 切进来：一律展开，并记下显式展开，覆盖之前的折叠。 */
                                  next.delete(g.key)
                                  next.add(`__open:${g.key}`)
                                } else if (collapsed) {
                                  next.delete(g.key)
                                  next.add(`__open:${g.key}`)
                                } else {
                                  next.delete(`__open:${g.key}`)
                                  next.add(g.key)
                                }
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
                             props.onOverviewChange?.(false)
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
                            {/* 标题走共享规则：空白标题的兜底必须与侧栏一致，
                                否则同一个会话在两处可能显示成不同的名字。 */}
                            <span className="cv3-session-name">{sessionDisplayTitle(t)}</span>
                            {t.archived
                              ? <span className="cv3-session-flag">已归档</span>
                              : t.origin === 'local'
                                ? <span className="cv3-session-flag" title={t.localNote ?? '未保存到服务端'}>仅本页</span>
                                : (
                                  /* 悬停给完整时间：列表里为紧凑用了相对时间，
                                     但用户要能核对准确时刻。 */
                                  <span className="cv3-session-time num" title={sessionTimeFull(t.updatedAt)}>
                                    {fmtAgo(t.updatedAt)}
                                  </span>
                                )}
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

      {props.overviewOpen && props.projectOverview}
      <div className="cv3-main" style={props.overviewOpen ? { display: 'none' } : undefined}>
        <header className="cv3-head">
          <div className="cv3-title-row">
            <button type="button" className="cv3-icon-btn" aria-label={sideExpanded ? '收起项目栏' : '展开项目栏'} title={sideExpanded ? '收起项目栏' : '展开项目栏'} onClick={() => setSideExpanded((o) => !o)}>
              <PanelLeft size={16} />
            </button>
            {/* 子代理徽标：紧贴标题左侧。「派了个分身去干活」和「跑条 bash」
                不是一个量级的事 —— 前者可能几十秒不回来，不标出来用户会以为卡住。 */}
            <SubagentBadge tools={activeSubagentTools} />
            <div className="cv3-crumb" title={title}>{title}</div>
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
              {userMessages.length === 0 && !activeIsServer && sessionDraft.draft.intentAction !== 'query' && (
                <div className="cv3-start-empty">
                  <h2>把想法做成视频</h2>
                  <p>从一句需求开始，也可以带上素材或参考片。</p>
                  <div>
                    <Button disabled={projectPending || props.projectsLoading} onClick={() => void startCreationFromEmpty()}>{projectPending ? '正在准备项目…' : props.openProject ? '在当前项目开始制作' : '新建项目开始制作'}</Button>
                    <Button variant="ghost" disabled={projectPending} onClick={() => { sessionDraft.updateDraft({ intentAction: 'query' }); setEntryNote({ sessionId: props.activeSessionId, text: '先在本页梳理想法，不制作视频；对话刷新后不保留。' }) }}>先聊想法</Button>
                  </div>
                </div>
              )}
              {entryNote?.sessionId === props.activeSessionId && userMessages.length === 0 && <p className="cv3-entry-note" role="status">{entryNote.text}</p>}
              {/* 本页草稿：明确「不在服务端」。服务端会话已在上面说明，不重复。 */}
              {activeThread?.origin === 'local' && (
                <p className="cv3-local-note" role="note">
                  {activeThread.projectId
                    ? `${activeThread.localNote ?? '这条对话尚未保存到服务端。'} 未接入 Agent 的回复仅用于梳理需求，不代表已经执行。`
                    : '这条对话没有归属项目，仅保存在本页，刷新后不会保留。未接入 Agent 的回复仅用于梳理需求，不代表已经执行。'}
                </p>
              )}

              {activeThread?.projectId && <ProjectResourceEvidence key={`${activeThread.projectId}:${props.activeSessionId}:${messages.filter(m=>!m.streaming).length}`} projectId={activeThread.projectId}/>}

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
                <div key={m.id} className="cv3-ai-block" data-streaming={m.streaming || undefined}>
                  {/* 「本轮未改动工程」按**轮次**显示：用这条回复的 taskId
                      （= 触发它的用户消息 id）查共享 store。
                      与工作台侧栏读同一份数据，取不到就不显示。 */}
                  {(() => {
                    const outcome = getRoundOutcome(m.taskId)
                    if (!outcome) return null
                    return (
                      <p className="cv3-demo-note" role="status" data-round-outcome="">
                        本轮未改动工程 · 没有新版本
                        <button
                          type="button"
                          onClick={() => clearRoundOutcome(activeThread?.projectId, props.activeSessionId, outcome.userMessageId)}
                          aria-label="关闭"
                          style={{ marginLeft: 6, opacity: 0.7 }}
                        >
                          ×
                        </button>
                      </p>
                    )
                  })()}
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
                      ...(m.thinking ? [{ title: '思考', icon: ThinkingIcon, steps: [{ label: m.thinking, multiline: true }] }] : []),
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
                      表格/多级列表/代码块全都走样 —— 那等于把结构信息丢了。

                      正文里还可能夹着 `<question-form>` 表单（模型提问的唯一方式，
                      见 components/chat/questionForm.ts 的说明）。只在**流式结束后**
                      解析：流到一半时 JSON 还没闭合，提前解析会得到半张表。 */}
                  {m.text ? (
                    <AnswerBody>
                      {(() => {
                        if (m.streaming) return <MarkdownText text={m.text} />
                        const segs = splitQuestionForms(m.text)
                        /* 没有表单就走原路径，不为「可能有」付额外渲染成本 */
                        if (segs.length === 1 && segs[0].kind === 'text') {
                          return <MarkdownText text={segs[0].text} />
                        }
                        return segs.map((seg, i) =>
                          seg.kind === 'text'
                            ? (seg.text.trim() ? <MarkdownText key={i} text={seg.text} /> : null)
                            : (
                              <QuestionFormCard
                                key={i}
                                form={seg.form}
                                interactive={!pending && m.id === messages[messages.length - 1]?.id}
                                onSubmit={(msg) => {
                                  /* 答案走普通用户消息 —— 这是绕开 dsh 工具应答通道的关键。
                                     直接调 send 而不是 submit：send 收文本参数，
                                     submit 是从输入框草稿里取的，这里不该污染草稿。 */
                                  void send(msg)
                                }}
                              />
                            ),
                        )
                      })()}
                    </AnswerBody>
                  ) : null}

                  {/* 失败 / 演示标记：必须可见，不能只靠别处说明 */}
                  {m.failed ? (
                    <p className="cm-failed" role="alert">
                      这条回复没有完成：{m.failed}
                      {replySaveRetry && replySaveRetry.localId === m.id ? (
                        <button
                          type="button"
                          className="cm-failed-retry"
                          data-reply-save-retry=""
                          onClick={() => void retrySaveReply()}
                        >
                          重试补存
                        </button>
                      ) : null}
                    </p>
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
                  {/* 文件改动：这条回复动过哪些文件。放在产物之前 ——
                      先「改了什么」再「交付了什么」，符合读的顺序。 */}
                  {(() => {
                    const fc = collectFileChanges(m.executedTools)
                    return fc.length > 0 ? <FileChanges changes={fc} /> : null
                  })()}
                  {/* 交付的产物：模型主动 present 的文件。
                      放在回复最末 —— 「说了什么」之后才是「东西在哪」。 */}
                  {m.deliverables && m.deliverables.length > 0 && (
                    <Deliverables files={m.deliverables} />
                  )}
                </div>
              ))}

              <CreationProgress projectId={activeThread?.projectId} sessionId={props.activeSessionId} />

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
                      ...((streamingThinking || lastThinking) ? [{ title: '思考', runningTitle: '正在思考', icon: ThinkingIcon, steps: [{ label: streamingThinking || lastThinking, multiline: true }] }] : []),
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
              {/* 过程诊断：压缩 / token 上限 / 重试。
                  只在真发生过时出现；不带正文，不看也不影响阅读，
                  但它解释「为什么这次答复不对劲」，藏起来等于没有。 */}
              {(() => {
                const last = [...messages].reverse().find((x) => x.role === 'ai')
                const diags = last?.diagnostics
                if (!diags || diags.length === 0) return null
                return (
                  <p className="cv3-diagnostic">
                    {diags.map((d, i) => (
                      <span key={`${d.kind}-${i}`} data-kind={d.kind}>
                        {d.kind === 'max-tokens' ? <AlertTriangle size={12} />
                          : d.kind === 'compaction' ? <Minimize2 size={12} />
                          : d.kind === 'retry' ? <RotateCcw size={12} />
                          : <CircleSlash size={12} />}
                        {d.detail ?? DIAGNOSTIC_LABEL[d.kind]}
                      </span>
                    ))}
                  </p>
                )
              })()}
              {/* 上下文占用：这是**唯一**的入口（输入框里的圆环已撤掉）。
                  只有拿到真实分子和分母才画 —— 画一个没有分母的进度条不如不画。
                  数据取「最后一条带 usage 的 AI 消息」的落库值（composerPromptTokens /
                  composerWindow），与输入框同源；分档口径见 composerMeterKinds：
                  system / tools / files / chat / memory 五档相加正好等于实测 prompt 大小。 */}
              {showMessageMeter && (
                <div className="cv3-ctxmeter">
                  <ContextMeter kinds={messageMeterKinds} windowK={Math.round(composerWindow / 1000)} style="Bar" />
                </div>
              )}
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
            {/* 任务清单抽屉：停靠在输入框上方，与输入框同宽。
                数据取「最后一条有 todos 的 AI 消息」—— todo_write 是整表替换，
                最后一份就是当前状态。 */}
            {(() => {
              const lastTodos = [...messages].reverse().find((m) => m.todos && m.todos.length > 0)?.todos
              if (!lastTodos) return null
              return (
                <div className="cv3-todo-dock">
                  <ChecklistDrawer items={lastTodos} defaultOpen={!pending} />
                </div>
              )
            })()}
            <div className="cv3-compose">
            {/* 居中盒：宽度约束与正文列 .cv3-col 同源（见 conversation.css 的 --cv-compose-w），
                否则输入框会比正文宽出一截，看上去被「拉长」且左右对不齐。 */}
            <div className="lbx-compose-box">
            {/* 始终显示：用户在看到输入框时就该知道这句话发出去会走哪条路。
                显示内容由 resolveSendPlan 决定，与真实发送是同一个判定 ——
                不再「有目标才显示」，也不再让组件默认值把普通对话画成修改工程。 */}
            {(
              <TargetSummaryPill
                layoutMode="normal"
                targetSnapshot={sessionDraft.draft.targetSnapshot}
                draftIntent={sessionDraft.draft.intentAction}
                continuationScopeMode={sessionDraft.draft.continuationScopeMode}
                hasProject={Boolean(activeThread?.projectId)}
                isServerSession={Boolean(activeIsServer)}
                /* 目标版本来源：胶囊据此决定是否可与工程版本比较 */
                versionSeries={
                  sessionDraft.draft.targetSnapshot?.version !== undefined
                    && sessionDraft.draft.targetSnapshot?.version !== null
                    ? 'scene'
                    : null
                }
                /* 工程版本读不到时传 null + unconfirmed，让胶囊降级措辞 */
                stageLeadVersion={stageLeadVersion}
                versionUnconfirmed={stageLeadVersion === null}
                onIntentChange={(intent) => {
                  /* 与工作台同一套写入：意图既进目标快照，也独立存一份，
                     免得某天这里的目标被清空后意图跟着丢失。 */
                  sessionDraft.updateDraft({
                    intentAction: intent,
                    ...(sessionDraft.draft.targetSnapshot
                      ? { targetSnapshot: { ...sessionDraft.draft.targetSnapshot, intentAction: intent } }
                      : {}),
                  })
                }}
                onRemoveTarget={() => sessionDraft.updateDraft({ targetSnapshot: null })}
                onViewLead={() => {
                  if (activeThread?.projectId) {
                    props.onOpenWorkbench(props.activeSessionId)
                  }
                }}
              />
            )}
            {sessionDraft.draft.continuationScopeMode === 'target_required' && !sessionDraft.draft.targetSnapshot && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 mb-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-500">
                <span className="flex-1">继续调整尚未选定修改目标。可在工作台圈定画面/时间，或直接整片提交：</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded bg-blue-500/15 hover:bg-blue-500/25 text-blue-500 font-medium transition-colors"
                    onClick={() => {
                      if (activeThread?.projectId) {
                        props.onOpenWorkbench(props.activeSessionId)
                      }
                    }}
                  >
                    返回工作台选目标
                  </button>
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 font-medium transition-colors"
                    onClick={() => {
                      sessionDraft.updateDraft({ continuationScopeMode: 'whole_confirmed' })
                      setSendError(null)
                    }}
                  >
                    确认整片修改
                  </button>
                </div>
              </div>
            )}
            {/* 输入框整体使用 LeiBox 官方「Agent 对话输入框」原版实现：
                内部是官方打包产物（自带 React / GSAP / 图标与全部动效），
                不再保留任何自研元素。
                contextUsage 是官方圆圈（以及它自带的「上下文组成」面板）的数据源：
                传进去圆圈才显示真实百分比，而不是恒定的 0%。 */}
            <ComposerAttachments
              items={attachments.map((item) => ({
                name: item.name,
                kind: item.kind === 'image' ? 'image' : 'file',
                src: item.previewUrl,
                progress: item.progress,
                error: item.uploadError,
                note: item.note,
                caption: item.purpose && item.purpose !== 'unspecified' ? PURPOSE_LABEL[item.purpose as AssetPurpose] : item.kind === 'video' ? '视频' : undefined,
              }))}
              onRemove={(index) => setAttachments((old) => {
                const item = old[index]
                if (item?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
                return old.filter((_, i) => i !== index)
              })}
            />
            <LeiBoxComposer
              harnesses={composerHarnesses}
              harness={selectedHarness?.id}
              onHarnessChange={setHarnessId}
              selectedModel={backendModels.length ? effectiveModel : undefined}
              onModelChange={setModel}
              onThinkingChange={setThinking}
              busy={pending || stopping || submitting || projectPending}
              /* 对话区的 busy 只表示回复流，能停就是能停。
                 停止结果未回时仍保留停止键：用户可以再点一次重试。 */
              canStop={pending}
              stopping={stopping}
              onStop={() => streamStopRef.current?.()}
              contextUsage={composerContextUsage}
              contextUsageFallbackTokens={composerPromptTokens ?? undefined}
              contextPanel={composerMeterPanel}
              draft={sessionDraft.draft.text}
              onDraftChange={(text) => sessionDraft.updateDraft({ text })}
              onFlush={(text) => sessionDraft.flushText(text)}
              /* 用户真实输入时作废「刚发送」标记：
                 否则他主动重新输入同一句话会被当成迟来回调而存不进草稿。 */
              onUserInput={() => noteDraftInput(activeThread?.projectId, props.activeSessionId)}
              onSubmit={(payload) => {
                if (payload.text.trim()) submit(payload.text)
              }}
            />
            {/* 发送失败提示：官方组件只负责输入与提交，
                发送结果（网络/校验失败）仍由本页判断并显示。 */}
            {sendError ? (
              <p className="cv3-compose-note" role="alert" data-error="">
                <AlertCircle size={12} /> {sendError}
              </p>
            ) : null}
            </div>
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

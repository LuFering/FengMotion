import { type SearchCall } from '@/features/chat/components/WebSearchTrace'
import { type TaskItem, type TaskStepChip } from '@/features/chat/components'
import { ToolIcon } from '@/features/chat/components/ToolIcons'
import { FileKindIcon } from '@/features/chat/components/FileKindIcon'
import { isKnownFileName } from '@/features/chat/model/fileKind'

/** 一行里最多直接显示几个文件，其余收成「+N」 */
const MAX_CHIPS = 3

/**
 * 把工具调用转成 TaskList 的任务。
 *
 * ⚠️ 只处理**非搜索类**调用：网页搜索有自己的一套轨迹（WebSearchTrace），
 * 它回答的是「去查了什么来源」，和「执行了哪些命令」不是一件事。
 * 混在一张任务列表里，两类信息会互相稀释。
 *
 * 按时间顺序归组：只把**相邻**的同名调用并成一组（bash、bash、read、bash → bash·2、read·1、bash·1）。
 * 不跨时间合并同名调用 —— 那会把后发生的命令挪到前面，执行顺序就乱了。
 * 组和步骤都带稳定 id（取首个调用的 callId）：新调用到达时只在组底部长出新的一行，
 * 不会因为标题里的次数变了而整组重建、所有行重新生长一遍。
 */
export function toolCallsToTasks(calls: SearchCall[], running: boolean): TaskItem[] {
  return groupAdjacent(calls).map(({ name, list, start }) => {
    const failed = list.filter((c) => c.isError).length
    const done = list.filter((c) => c.done === true).length
    const allDone = done === list.length
    const current = [...list].reverse().find((c) => c.done !== true)
    const detail = current?.arguments ? shortArgs(current.arguments) : ''
    return {
      id: list[0].callId ?? `${name}-${start}`,
      title: `${name} · ${list.length} 次${failed > 0 ? ` · ${failed} 失败` : ''}`,
      /* 运行中的标题带上正在执行的那一条的说明，让人一眼知道它此刻在干什么 */
      runningTitle: running && !allDone ? `正在执行 ${name}${detail ? ` · ${detail.length > 48 ? `${detail.slice(0, 48)}…` : detail}` : ''}` : undefined,
      /* 每类工具一个图标：bash / read / write / web_fetch 之间要能一眼分开。
         ⚠️ 必须把 className 透传下去：TaskList 用它挂 .tl-task-icon
         （16px 盒 + --dim 颜色）。不透传的话图标会按 SVG 默认尺寸与继承色渲染，
         尺寸和颜色都与网页搜索的图标对不上。 */
      icon: function Icon({ className }: { className?: string }) {
        return <ToolIcon name={name} className={className} />
      },
      steps: list.map((call, i) => {
        const chips = call.arguments ? toolChips(call.arguments) : []
        return {
          id: call.callId ?? `${name}-${start + i}`,
          /* 没参数（或参数是 `{}`）时依次兜底：
             中文说明 > 工具名。直接写「无参数」占一整行却什么也没说。 */
          label: (call.arguments && shortArgs(call.arguments)) || NO_ARG_HINT[name] || name,
          /* 还没收到结果帧的那一条在跑：这一行扫光 */
          running: running && call.done !== true,
          /* 失败标记优先：出错时最该看到的是「失败了」，不是它碰了哪个文件 */
          chips: call.isError ? [{ label: '失败', tone: 'error' as const }] : (chips.length > 0 ? chips : undefined),
        }
      }),
    }
  })
}

/** 相邻的同名调用归成一组；start 是组内首个调用在原列表里的位置。 */
function groupAdjacent(calls: SearchCall[]): { name: string; list: SearchCall[]; start: number }[] {
  const groups: { name: string; list: SearchCall[]; start: number }[] = []
  calls.forEach((call, index) => {
    const last = groups.at(-1)
    if (last && last.name === call.name) last.list.push(call)
    else groups.push({ name: call.name, list: [call], start: index })
  })
  return groups
}

/**
 * TaskList 的 revealed 是「单元数」：每个任务 1 个标题单元 + 每步 1 个单元。
 * 按真实到达数算，不编造进度。分组口径必须与 toolCallsToTasks 一致。
 */
export function toolCallsRevealed(calls: SearchCall[]): number {
  return groupAdjacent(calls).reduce((total, g) => total + 1 + g.list.length, 0)
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
export function toolChips(args: string): TaskStepChip[] {
  let parsed: Record<string, unknown> | null = null
  try {
    const v = JSON.parse(args)
    if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>
  } catch {
    /* 非 JSON：下面按命令文本找 */
  }

  const paths: string[] = []
  if (parsed) {
    for (const k of ['file_path', 'path', 'file', 'target', 'filename']) {
      const v = parsed[k]
      if (typeof v === 'string' && v.trim()) paths.push(v.trim())
    }
  }
  /* 命令里出现的文件：只认常见扩展名的词，去掉引号与结尾标点；纯参数、URL、通配符不算 */
  if (paths.length === 0) {
    const text = parsed ? String(parsed.command ?? '') : args
    for (const raw of text.split(/[\s|;&<>()]+/)) {
      const word = raw.replace(/^["'`]+|["'`,:]+$/g, '')
      if (!word || word.startsWith('-') || /^[a-z]+:\/\//i.test(word) || /[*?{}$]/.test(word)) continue
      const base = word.split('/').pop() ?? ''
      if (isKnownFileName(base)) paths.push(word)
    }
  }

  /* 同一个文件只出一次；同名不同目录的带上父目录区分（两个 index.tsx 不能长得一模一样） */
  const unique = [...new Set(paths)]
  const baseOf = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p
  const counts = new Map<string, number>()
  for (const p of unique) counts.set(baseOf(p), (counts.get(baseOf(p)) ?? 0) + 1)
  const labelOf = (p: string) => {
    const base = baseOf(p)
    if ((counts.get(base) ?? 0) < 2) return base
    const parts = p.replace(/\/+$/, '').split('/')
    return parts.length > 1 ? `${parts[parts.length - 2]}/${base}` : base
  }

  const shown = unique.slice(0, MAX_CHIPS).map((p) => ({ label: labelOf(p), title: p, icon: <FileKindIcon name={baseOf(p)} /> }))
  const rest = unique.slice(MAX_CHIPS)
  return rest.length > 0 ? [...shown, { label: `+${rest.length}`, title: rest.join('\n') }] : shown
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
export const NO_ARG_HINT: Record<string, string> = {
  list_agents: '查看子代理列表',
  list_tasks: '查看任务列表',
  list_jobs: '查看后台任务',
  exit_plan_mode: '退出计划模式',
  get_goal: '查看当前目标',
}

export function shortArgs(args: string): string {
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

export function truncate(t: string): string {
  const oneLine = t.replace(/\s+/g, ' ').trim()
  return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine
}

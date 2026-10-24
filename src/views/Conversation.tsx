import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AtSign, ChevronDown, Clapperboard, LoaderCircle, PanelLeft, Plus, Send } from 'lucide-react'
import type { ChatState } from '../shell/useChat'
import { workflowService } from '../services/workflowService'
import { GENOMES } from '../data/genomes'
import type { NewProjectInput } from '../shell/useProjects'
import type { WfPath } from '../data/workflowTemplates'
import { SegmentedControl } from '../components/ui/segmented-control'
import { REFERENCE_VIDEOS } from '../data/referenceLibrary'
import { FX_TECHNIQUES } from '../data/fxTechniques'
import '../styles/conversation.css'

/**
 * 项目 agent 对话视图（第三版：照抄 dsh 对话界面源码）。
 *
 * 抄自 deepseek-ai/deepseek-harness（dsh）Web UI 源码的实际结构与数值
 * （只抄版式与交互，不抄品牌、模型名、吉祥物、dsh 字样）：
 *   - 壳：AppFrame 三栏（会话栏 280，可拖范围 264–420；收起为 56 轨；
 *     1024 以下自动收轨，手动展开为覆盖式抽屉）→ 本视图在应用壳 68px
 *     图标栏右侧 pane 内，只抄内侧会话栏这一栏。
 *   - 会话栏：SidebarRoot（padding 6/12，14px；新会话条 38px 高、12px 圆角、
 *     0.5px 边框；会话行 32px 高、12px 圆角、标题 14/20、时间 10/16）。
 *   - 顶栏：ConversationRoot header（最小高 76px，padding 10/28/0/20，
 *     0.5px 底边；标题行 30px；标题为 14/20 500 的面包屑；tab 行
 *     margin-top 10px、gap 32px，tab 13/16 500，激活为品牌蓝 + 2px 下划线）。
 *   - 消息流：ChatView（滚动区 padding 16 + 两侧各 16；内容列
 *     clamp(680, 列宽×0.64, 920)；流间距默认 4px，回复 12px）+
 *     AssistantMarkdown（正文 14/24，块间距 16）+
 *     ReasoningRow（思考行 24px，摘要 13/20 三级色，展开体缩进 22px）+
 *     UserMessageBubble（用户气泡 20px 圆角，padding 10/16，14/22）。
 *   - 输入框：InputBar（卡片 28px 圆角、输入面填充、柔和投影；
 *     文本 14/24，padding 4/8/0/14，停靠态最小高 36，最高 336；
 *     工具行 padding 2/8/6，gap 12；+ 钮 28px 圆；权限/模型 chip
 *     28px 高、13/20；发送钮 34px 圆、品牌蓝底白字，空态 0.4）。
 *   - @// 菜单：MenuView（卡片内绝对定位，bottom 100%+4px，padding 4px；
 *     行最小高 34px，padding 6/8，12px 圆角，13/20；分组标题 11/16 500）。
 *   - 状态条：StatsPills（12px，三级色，等宽数字，pill padding 1/8，8px 圆角）。
 *   - 圆角：sm 8 / md 12 / lg 16 / xl 20 / panel 28；缓动 cubic-bezier(0.4,0,0.2,1)。
 *
 * 对话视图与工作台是同一个 agent 会话的两种呈现，可随时彼此切换：
 *   对话视图 = 完整的思考过程（消息 + 思考 + 工具调用 + 方案 + 改了什么）
 *   工作台   = 完整的制作过程（场景 / 时间线 / 产物 / 任务状态）
 * 两边共用 App 的 useChat 会话：首页那句需求就是首条用户消息，
 * 工作台右栏的对话 tab 看到的是同一份消息（它只渲染 text）。
 *
 * 诚实边界（不假装真实 Agent，不加死按钮）：
 *   - agent 回复是本地演示生成，未连接 Agent；思考与工具调用均为演示内容。
 *   - 会话栏只放真实会话（当前会话 + 新会话入口），不编造历史会话。
 *   - 状态条只写真实内容（消息数、演示模式、会话仅内存），不编 tok/s 与 token 量。
 *   - @ 只从真实库数据（参考片标题、特效名）里选，插入为文本提及；
 *     / 菜单只放真实可用的 /new（开新会话）。
 *   - 轨迹 tab 只列本会话真实的工具调用与方案事件，没有则为空态。
 *   - “改了什么”表只列开始制作时真实创建的项目与工作流，不编造文件改动。
 *   - dsh 有、FengMotion 暂无真实功能的控件（智能体团队 / 创造模式 /
 *     权限 / 模型 / 附件 +）：照抄其可见形态，点开是明确标注演示的说明卡，
 *     不是点了没反应的死按钮；真实功能接通后再替换。
 *   - 开始制作复用 StartCreation 的同一套创建逻辑（建项目 + createFromPath + 落工作台），
 *     只是把“填表”换成了“聊完再点按钮”；StartCreation 本体保留未删。
 *   - 会话只在内存里，刷新即失；会话持久化与真实思考事件流是接后端后的事。
 */

interface DemoReply {
  text: string
  thinking: string
  toolCalls: { label: string; detail: string }[]
  plan?: string[]
}

const GENERIC_PLAN = [
  '开场：先立一个问题钩子，让观众有理由往下看',
  '中段：分 2–3 个点讲清核心，每点配一个画面',
  '结尾：回到观众自己的场景收束，留一个可带走的结论',
]

const TOKEN_PLAN = [
  '开场：一个问题钩子，先把 Token 的陌生感立起来',
  '中段：用生活类比讲清 Token 是什么、以及怎么计费',
  '结尾：回到观众自己的使用场景，留一个可复用的结论',
]

function demoReply(userText: string, turn: number): DemoReply {
  if (turn === 0) {
    const aboutToken = /token/i.test(userText)
    return {
      text: aboutToken
        ? '收到，这条我理解为一支 Token 科普短片。先跟你对三个点：\n1. 讲给谁听\n2. 想做到多长\n3. 想要什么感觉\n你先回其中任何一点，我再往下细化方案。'
        : '收到。先跟你对三个点：\n1. 这条片子讲给谁听\n2. 想做到多长\n3. 想要什么感觉\n你先回其中任何一点，我再往下细化方案。',
      thinking: '先拆这条需求：受众、时长、感觉、结构。受众和时长还没给，我先按默认假设出方案，错了你直接改，不用重说整段需求。',
      toolCalls: [
        { label: '检索参考片库', detail: '沙漠公路 · 多莉变焦：人物居中、背景纵深拉伸，可作开场情绪锚点' },
        { label: '检索特效库', detail: '多莉变焦：主体大小恒定、背景剧烈伸缩，适合揭示时刻' },
      ],
      plan: aboutToken ? TOKEN_PLAN : GENERIC_PLAN,
    }
  }
  const snippet = userText.trim().slice(0, 24)
  return {
    text: `收到，你刚补的“${snippet}”我并进了方案。没提到的部分保持上一版，你再补一点，或者直接点开始制作。`,
    thinking: '按你刚补的信息调整方案里对应的点；没提到的部分保持上一版，不推翻重来。',
    toolCalls: [{ label: '更新方案', detail: '把你刚说的点并入方案要点' }],
  }
}

/* 与 StartCreation 同口径：首行过短 / 只有数字标点时不直接当名字 */
function usableName(text: string): string {
  const first = text.trim().split('\n')[0] ?? ''
  return first.length >= 2 && !/^[\d\s\p{P}]+$/u.test(first) ? first : ''
}

function fmtTime(at?: number): string {
  if (!at) return '—'
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
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

/* @ 提及候选：全部来自真实库数据，不编造 */
const MENTIONS: { label: string; kind: string }[] = [
  ...REFERENCE_VIDEOS.map((v) => ({ label: v.title, kind: '参考片' })),
  ...FX_TECHNIQUES.map((f) => ({ label: f.name, kind: '特效' })),
]

interface TraceEntry {
  key: string
  time: string
  kind: 'user' | 'tool' | 'plan' | 'launch'
  title: string
  detail?: string
}

type DemoNoteKey = 'team' | 'mode' | 'perm' | 'model' | 'attach'

const DEMO_NOTE: Record<DemoNoteKey, string> = {
  team: '智能体团队：演示占位。FengMotion 暂无多智能体团队功能，接通 Agent 后这里会显示真实团队。',
  mode: '创造模式：演示占位。FengMotion 暂无创造模式切换，接通 Agent 后这里会显示真实模式。',
  perm: '完全权限：演示占位。演示模式下不执行真实操作，权限选择待 Agent 接通后生效。',
  model: '演示模型：演示占位。未连接真实模型，回复均为本地演示生成。',
  attach: '添加附件：演示占位。演示模式下不支持真实附件上传，接通 Agent 后可用。',
}

export function Conversation(props: {
  chat: ChatState
  onCreateProject: (input: NewProjectInput) => { id: string }
  openProject: string | null
  onLaunch: (r: { workflowId: string; projectId: string | null; autoRun: boolean }) => void
  onOpenWorkbench: () => void
}) {
  const { chat } = props
  const [proPath, setProPath] = useState<WfPath>('prompt-first')
  const [pending, setPending] = useState(false)
  const [tab, setTab] = useState<'chat' | 'trace'>('chat')
  /* dsh 响应式：1024 以下会话栏自动收为 56px 轨，手动展开为覆盖式抽屉 */
  const [narrow, setNarrow] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 1024))
  const [sideExpanded, setSideExpanded] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024))
  const [mentionIdx, setMentionIdx] = useState(0)
  const [inputFocused, setInputFocused] = useState(false)
  const [demoNote, setDemoNote] = useState<DemoNoteKey | null>(null)
  const repliedRef = useRef(new Set<string>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1024)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /* 工作台对话 tab 的 intro 免责句不属于创作会话，对话视图里滤掉 */
  const messages = useMemo(() => chat.messages.filter((m) => m.id !== 'intro'), [chat.messages])
  const userMessages = useMemo(() => messages.filter((m) => m.role === 'user'), [messages])
  const firstBrief = userMessages[0]?.text ?? ''
  const title = usableName(firstBrief).slice(0, 14) || '未命名创作'
  const launched = props.openProject !== null
  const drawer = narrow && sideExpanded
  const rail = !sideExpanded

  /* @ 提及：光标前 @xxx（xxx 不含空白）时弹出真实库候选 */
  const mention = useMemo(() => {
    const el = inputRef.current
    if (!el || !inputFocused) return null
    const before = chat.draft.slice(0, el.selectionStart ?? chat.draft.length)
    const m = before.match(/(?:^|\s)@([^\s@]*)$/)
    if (!m) return null
    const query = m[1]
    const start = before.length - query.length - 1
    const items = MENTIONS.filter((it) => it.label.includes(query)).slice(0, 8)
    return { query, start, items }
  }, [chat.draft, inputFocused])

  /* / 菜单：整行就是 /xxx 时才出现，只放真实可用的 /new */
  const slashMenu = useMemo(() => {
    if (!/^\/[^\s]*$/.test(chat.draft)) return null
    return chat.draft === '/' || '/new'.startsWith(chat.draft) ? [{ cmd: '/new', desc: '开新会话' }] : []
  }, [chat.draft])

  /* 轨迹 tab：只列本会话真实的工具调用与方案事件，没有则为空态 */
  const trace = useMemo<TraceEntry[]>(() => {
    const entries: TraceEntry[] = []
    messages.forEach((m) => {
      if (m.role === 'user') {
        entries.push({ key: m.id, time: fmtTime(m.at), kind: 'user', title: '用户消息', detail: usableName(m.text) || m.text.slice(0, 24) })
      } else {
        ;(m.toolCalls ?? []).forEach((t, i) => {
          entries.push({ key: `${m.id}-t${i}`, time: fmtTime(m.at), kind: 'tool', title: t.label, detail: t.detail })
        })
        if (m.plan) entries.push({ key: `${m.id}-plan`, time: fmtTime(m.at), kind: 'plan', title: '制作方案已生成（演示）', detail: `${m.plan.length} 个要点` })
        if (m.changes) entries.push({ key: `${m.id}-changes`, time: fmtTime(m.at), kind: 'launch', title: '制作已开始', detail: `${m.changes.length} 项已创建` })
      }
    })
    /* 不补 app 级 fallback：制作记录只属于产生它的那次会话，/new 开新会话后轨迹应为空 */
    return entries
  }, [messages])

  /* 有新用户消息且还没回：演示 agent 900ms 后回一条（原型延迟，非真实推理耗时） */
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'user' || repliedRef.current.has(last.id)) return
    repliedRef.current.add(last.id)
    setPending(true)
    const t = window.setTimeout(() => {
      chat.addAiMessage(demoReply(last.text, userMessages.length - 1))
      setPending(false)
    }, 900)
    return () => window.clearTimeout(t)
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

  const newSession = () => {
    chat.clearChat()
    setTab('chat')
  }

  const insertMention = (label: string) => {
    if (!mention) return
    const el = inputRef.current
    const cursor = el?.selectionStart ?? chat.draft.length
    const next = `${chat.draft.slice(0, mention.start)}@${label} ${chat.draft.slice(cursor)}`
    chat.setDraft(next)
    requestAnimationFrame(() => {
      el?.focus()
      const pos = mention.start + label.length + 2
      el?.setSelectionRange(pos, pos)
      growInput()
    })
  }

  const insertAtSign = () => {
    const el = inputRef.current
    const cursor = el?.selectionStart ?? chat.draft.length
    const next = `${chat.draft.slice(0, cursor)}@${chat.draft.slice(cursor)}`
    chat.setDraft(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(cursor + 1, cursor + 1)
      growInput()
    })
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && mention.items.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % mention.items.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i - 1 + mention.items.length) % mention.items.length); return }
      if (e.key === 'Enter') { e.preventDefault(); insertMention(mention.items[Math.min(mentionIdx, mention.items.length - 1)].label); return }
      if (e.key === 'Escape') { e.preventDefault(); inputRef.current?.blur(); return }
    }
    if (slashMenu && slashMenu.length > 0) {
      if (e.key === 'Enter') { e.preventDefault(); newSession(); return }
      if (e.key === 'Escape') { e.preventDefault(); inputRef.current?.blur(); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  /* 开始制作：与 StartCreation 同一套创建逻辑（建项目 + createFromPath + 落工作台）；
     先把真实创建的项目与工作流记进“改了什么”表，再切工作台 */
  const launch = (quick: boolean) => {
    const brief = firstBrief
    if (!brief.trim()) return
    const name = usableName(brief)
    const project = props.onCreateProject({
      name: name.slice(0, 14) || '未命名创作',
      genome: GENOMES[0]?.id ?? 'explainer',
      targetDuration: 180,
    })
    const wf = workflowService.createFromPath(quick ? 'prompt-first' : proPath, 'general', name.slice(0, 24) || '未命名创作', {
      projectId: project.id,
      seedPrompt: brief,
    })
    chat.addAiMessage({
      text: '制作已开始，已创建以下内容：',
      changes: [
        { file: `项目 / ${project.id}`, change: '新增' },
        { file: `工作流 / ${wf.name}`, change: '新增' },
      ],
    })
    props.onLaunch({ workflowId: wf.id, projectId: project.id, autoRun: quick })
  }

  const demoPop = (key: DemoNoteKey) => (
    <div className="cv3-pop" role="note">
      <p>{DEMO_NOTE[key]}</p>
      <button type="button" onClick={() => setDemoNote(null)}>知道了</button>
    </div>
  )

  return (
    <div className="cv3">
      {drawer && <button type="button" aria-label="关闭会话栏" className="cv3-backdrop" onClick={() => setSideExpanded(false)} />}

      <aside className="cv3-side" data-rail={rail || undefined} data-drawer={drawer || undefined} aria-label="会话栏">
        <div className="cv3-side-top">
          <button type="button" className="cv3-icon-btn" aria-label={sideExpanded ? '收起会话栏' : '展开会话栏'} onClick={() => setSideExpanded((o) => !o)}>
            <PanelLeft size={16} />
          </button>
        </div>
        <button type="button" className="cv3-new" onClick={newSession} title="新会话">
          <Plus size={15} /><span className="cv3-new-label">新会话</span>
        </button>
        <div className="cv3-panel-list">
          <button type="button" className="cv3-panel-row" disabled={!launched} onClick={props.onOpenWorkbench}
                  title={launched ? '进入工作台查看完整制作过程' : '开始制作后可进入工作台'}>
            <span className="cv3-panel-ico"><Clapperboard size={16} /></span>
            <span className="cv3-panel-row-label">工作台</span>
          </button>
        </div>
        <div className="cv3-side-sec">会话</div>
        <div className="cv3-side-list">
          {userMessages.length > 0 ? (
            <div className="cv3-session" aria-current="true">
              <span className="cv3-session-title">{title}</span>
              <span className="cv3-session-time">{fmtTime(userMessages[0].at)}</span>
            </div>
          ) : (
            <p className="cv3-side-hint">还没有会话，发送第一条消息后出现在这里。</p>
          )}
        </div>
        <p className="cv3-side-note">演示模式 · 未连接 Agent。会话只在内存里，刷新即失。</p>
      </aside>

      <div className="cv3-main">
        <header className="cv3-head">
          <div className="cv3-title-row">
            <button type="button" className="cv3-icon-btn" aria-label={sideExpanded ? '收起会话栏' : '展开会话栏'} onClick={() => setSideExpanded((o) => !o)}>
              <PanelLeft size={16} />
            </button>
            <div className="cv3-crumb" title={title}>{title}</div>
            <span className="cv3-demo-pill">演示模式</span>
            <div className="cv3-head-actions">
              <div className="cv3-chip-wrap">
                <button type="button" className="cv3-chip" aria-expanded={demoNote === 'team'} onClick={() => setDemoNote(demoNote === 'team' ? null : 'team')}>
                  智能体团队<ChevronDown size={12} />
                </button>
                {demoNote === 'team' && demoPop('team')}
              </div>
              <div className="cv3-chip-wrap">
                <button type="button" className="cv3-chip" aria-expanded={demoNote === 'mode'} onClick={() => setDemoNote(demoNote === 'mode' ? null : 'mode')}>
                  创造模式<ChevronDown size={12} />
                </button>
                {demoNote === 'mode' && demoPop('mode')}
              </div>
            </div>
            <div className="cv3-switch" role="group" aria-label="对话与工作台切换">
              <button type="button" data-on aria-current="page">对话</button>
              <button type="button" disabled={!launched} onClick={props.onOpenWorkbench}
                      title={launched ? '进入工作台查看完整制作过程' : '开始制作后可进入工作台'}>
                工作台
              </button>
            </div>
          </div>
          <div className="cv3-tabs" role="tablist" aria-label="对话与轨迹">
            <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>对话</button>
            <button type="button" role="tab" aria-selected={tab === 'trace'} onClick={() => setTab('trace')}>轨迹</button>
          </div>
        </header>

        <div className="cv3-scroll" ref={scrollRef}>
          <div className="cv3-view">
            {tab === 'chat' ? (
              <div className="cv3-col">
                {userMessages.length === 0 && (
                  <p className="cv3-ai-intro">说说你想做的片子——讲给谁、讲什么、想要什么感觉。先聊清楚，再开始制作。</p>
                )}

                {messages.map((m) => m.role === 'user' ? (
                  <p key={m.id} className="cv3-user">{m.text}</p>
                ) : (
                  <div key={m.id} className="cv3-ai-block">
                    <div className="cv3-rich">{renderRich(m.text)}</div>
                    {m.thinking && (
                      <details className="cv3-think">
                        <summary>
                          <ChevronDown size={14} className="cv3-think-chev" />
                          <span className="cv3-think-title">思考过程</span>
                          <i className="cv3-think-sep" />
                          <span className="cv3-think-sum">{m.thinking}</span>
                        </summary>
                        <p>{m.thinking}</p>
                      </details>
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
                        <b className="cv3-changes-title">改了什么</b>
                        <table>
                          <thead><tr><th>文件</th><th>改动</th></tr></thead>
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
                        <b className="cv3-plan-title">制作方案（演示）</b>
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
                              <button type="button" className="cv3-primary" onClick={() => launch(true)}>开始制作（快速，自动运行）</button>
                              <button type="button" className="cv3-secondary" onClick={() => launch(false)}>创建并进入工作台（不自动运行）</button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {pending && (
                  <p className="cv3-pending"><LoaderCircle className="cv3-spin" size={14} /> 正在思考…（演示）</p>
                )}
              </div>
            ) : (
              <div className="cv3-col">
                {trace.length === 0 ? (
                  <div className="cv3-trace-empty">
                    <b>暂无任务事件</b>
                    <p>发一条消息，agent 的工具调用会按时间出现在这里。演示模式下不产生真实任务。</p>
                  </div>
                ) : (
                  <ol className="cv3-timeline">
                    {trace.map((e) => (
                      <li key={e.key} className={`cv3-tl cv3-tl-${e.kind}`}>
                        <span className="cv3-tl-time">{e.time}</span>
                        <i className="cv3-tl-dot" />
                        <div className="cv3-tl-body">
                          <b>{e.title}</b>
                          {e.detail && <span>{e.detail}</span>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>

          <div className="cv3-seat">
            <form className="cv3-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
              <div className="cv3-card">
                {mention && mention.items.length > 0 && (
                  <div className="cv3-picker" role="listbox" aria-label="引用参考片或特效">
                    {mention.items.map((it, i) => (
                      <button key={it.label} type="button" role="option" aria-selected={i === mentionIdx}
                              data-active={i === mentionIdx || undefined}
                              onMouseEnter={() => setMentionIdx(i)}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => insertMention(it.label)}>
                        <b>{it.label}</b><span>{it.kind}</span>
                      </button>
                    ))}
                  </div>
                )}
                {slashMenu && slashMenu.length > 0 && (
                  <div className="cv3-picker" role="listbox" aria-label="指令">
                    {slashMenu.map((it) => (
                      <button key={it.cmd} type="button" role="option" aria-selected
                              onClick={newSession}>
                        <b>{it.cmd}</b><span>{it.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
                {demoNote === 'perm' && demoPop('perm')}
                {demoNote === 'model' && demoPop('model')}
                {demoNote === 'attach' && demoPop('attach')}
                <textarea className="cv3-input" rows={1} ref={inputRef}
                          value={chat.draft}
                          onChange={(e) => { chat.setDraft(e.target.value); setMentionIdx(0); growInput() }}
                          onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}
                          onKeyDown={onInputKeyDown}
                          placeholder="发消息或创建任务，/ 调用指令，@ 文件或对话" />
                <div className="cv3-row">
                  <div className="cv3-tools-left">
                    <button type="button" className="cv3-add" title="添加附件（演示）" aria-label="添加附件（演示）"
                            onClick={() => setDemoNote(demoNote === 'attach' ? null : 'attach')}>
                      <Plus size={16} />
                    </button>
                    <button type="button" className="cv3-at" title="引用参考片或特效" onClick={insertAtSign}>
                      <AtSign size={15} />
                    </button>
                    <button type="button" className="cv3-chip" aria-expanded={demoNote === 'perm'}
                            onClick={() => setDemoNote(demoNote === 'perm' ? null : 'perm')}>
                      完全权限<ChevronDown size={12} />
                    </button>
                  </div>
                  <div className="cv3-trailing">
                    <button type="button" className="cv3-chip cv3-chip-model" aria-expanded={demoNote === 'model'}
                            onClick={() => setDemoNote(demoNote === 'model' ? null : 'model')}>
                      演示模型<ChevronDown size={12} />
                    </button>
                    <button className="cv3-send" type="submit" disabled={!chat.draft.trim() || pending} aria-label="发送">
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </form>
            <footer className="cv3-status">
              <span className="cv3-pill">{messages.length} 条消息</span>
              <span className="cv3-sep">·</span>
              <span className="cv3-pill">演示模式</span>
              <span className="cv3-sep">·</span>
              <span className="cv3-pill">未连接 Agent</span>
              <span className="cv3-sep">·</span>
              <span className="cv3-pill">会话仅内存</span>
              {launched && (<><span className="cv3-sep">·</span><span className="cv3-pill">制作已开始</span></>)}
            </footer>
          </div>
        </div>
      </div>
    </div>
  )
}

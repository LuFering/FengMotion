import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AtSign, LoaderCircle, PanelLeft, Plus, Send } from 'lucide-react'
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
 * 项目 agent 对话视图（完整常驻界面，第二版）。
 *
 * 版式参照开源项目 deepseek-harness 的 Web UI 交互结构（只抄版式与交互模式，
 * 不抄品牌、模型名、吉祥物与假功能）：内侧会话栏 + 顶栏（标题 / 对话·轨迹 tab /
 * 对话·工作台切换器）+ 消息流 + 底部输入框 + 状态条。对话视图与工作台是同一个
 * agent 会话的两种呈现，可随时彼此切换：
 *   对话视图 = 完整的思考过程（消息 + 思考 + 工具调用 + 方案）
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
  const [sideOpen, setSideOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 640))
  const [mentionIdx, setMentionIdx] = useState(0)
  const [inputFocused, setInputFocused] = useState(false)
  const repliedRef = useRef(new Set<string>())
  const streamRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  /* 工作台对话 tab 的 intro 免责句不属于创作会话，对话视图里滤掉 */
  const messages = useMemo(() => chat.messages.filter((m) => m.id !== 'intro'), [chat.messages])
  const userMessages = useMemo(() => messages.filter((m) => m.role === 'user'), [messages])
  const firstBrief = userMessages[0]?.text ?? ''
  const title = usableName(firstBrief).slice(0, 14) || '未命名创作'
  const launched = props.openProject !== null

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
      }
    })
    if (launched) entries.push({ key: 'launch', time: '—', kind: 'launch', title: '制作已开始', detail: '已进入工作台流程，可切换到工作台查看' })
    return entries
  }, [messages, launched])

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
    const el = streamRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  const submit = () => {
    const v = chat.draft.trim()
    if (!v || pending) return
    chat.addUserMessage(v)
    chat.setDraft('')
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

  /* 开始制作：与 StartCreation 同一套创建逻辑（建项目 + createFromPath + 落工作台） */
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
    props.onLaunch({ workflowId: wf.id, projectId: project.id, autoRun: quick })
  }

  return (
    <div className="cv2">
      {sideOpen && <button type="button" aria-label="关闭会话栏" className="cv2-backdrop" onClick={() => setSideOpen(false)} />}

      <aside className="cv2-side" data-open={sideOpen} aria-label="会话栏">
        <button type="button" className="cv2-new" onClick={newSession}>
          <Plus size={15} />新会话
        </button>
        <div className="cv2-side-sec">会话</div>
        {userMessages.length > 0 ? (
          <div className="cv2-session" aria-current="true">
            <b>{title}</b>
            <span>{userMessages.length} 条消息 · {fmtTime(userMessages[0].at)}</span>
          </div>
        ) : (
          <p className="cv2-side-hint">还没有会话，发送第一条消息后出现在这里。</p>
        )}
        <p className="cv2-side-note">会话只在内存里，刷新即失（原型）。演示模式 · 未连接 Agent。</p>
      </aside>

      <div className="cv2-main">
        <header className="cv2-top">
          <button type="button" className="cv2-menu" aria-label="切换会话栏" onClick={() => setSideOpen((o) => !o)}>
            <PanelLeft size={16} />
          </button>
          <div className="cv2-top-title">
            <b>{title}</b>
            <span className="cv2-demo">演示模式 · 未连接 Agent</span>
          </div>
          <div className="cv2-tabs" role="tablist" aria-label="对话与轨迹">
            <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>对话</button>
            <button type="button" role="tab" aria-selected={tab === 'trace'} onClick={() => setTab('trace')}>轨迹</button>
          </div>
          <div className="cv2-switch" role="group" aria-label="对话与工作台切换">
            <button type="button" data-on aria-current="page">对话</button>
            <button type="button" disabled={!launched} onClick={props.onOpenWorkbench}
                    title={launched ? '进入工作台查看完整制作过程' : '开始制作后可进入工作台'}>
              工作台
            </button>
          </div>
        </header>

        {tab === 'chat' ? (
          <div className="cv2-stream" ref={streamRef}>
            <div className="cv2-col">
              {userMessages.length === 0 && (
                <div className="cv2-ai">
                  <span className="cv2-avatar">AI</span>
                  <p>说说你想做的片子——讲给谁、讲什么、想要什么感觉。先聊清楚，再开始制作。</p>
                </div>
              )}

              {messages.map((m) => m.role === 'user' ? (
                <p key={m.id} className="cv2-user">{m.text}</p>
              ) : (
                <div key={m.id} className="cv2-ai-block">
                  <div className="cv2-ai">
                    <span className="cv2-avatar">AI</span>
                    <div className="cv2-rich">{renderRich(m.text)}</div>
                  </div>
                  {m.thinking && (
                    <details className="cv2-think">
                      <summary>思考过程（演示）</summary>
                      <p>{m.thinking}</p>
                    </details>
                  )}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="cv2-tools">
                      {m.toolCalls.map((t, i) => (
                        <div key={i} className="cv2-tool">
                          <i className="cv2-tool-dot" />
                          <b>{t.label}</b>
                          <span>{t.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.plan && (
                    <div className="cv2-plan">
                      <b className="cv2-plan-title">制作方案（演示）</b>
                      <ol>
                        {m.plan.map((p, i) => <li key={i}>{p}</li>)}
                      </ol>
                      {!launched && (
                        <>
                          <div className="cv2-plan-path">
                            <span>专业制作路径</span>
                            <SegmentedControl value={proPath}
                                              onChange={(v) => setProPath(v as WfPath)}
                                              ariaLabel="专业制作路径"
                                              options={[{ value: 'prompt-first', label: 'Prompt-first' }, { value: 'structured', label: 'Structured' }]} />
                          </div>
                          <div className="cv2-plan-actions">
                            <button type="button" className="cv2-primary" onClick={() => launch(true)}>开始制作（快速，自动运行）</button>
                            <button type="button" className="cv2-secondary" onClick={() => launch(false)}>创建并进入工作台（不自动运行）</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {pending && (
                <div className="cv2-ai">
                  <span className="cv2-avatar">AI</span>
                  <p className="cv2-pending"><LoaderCircle className="cv2-spin" size={14} /> 正在思考…（演示）</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="cv2-trace">
            <div className="cv2-col">
              {trace.length === 0 ? (
                <div className="cv2-trace-empty">
                  <b>暂无任务事件</b>
                  <p>发一条消息，agent 的工具调用会按时间出现在这里。演示模式下不产生真实任务。</p>
                </div>
              ) : (
                <ol className="cv2-timeline">
                  {trace.map((e) => (
                    <li key={e.key} className={`cv2-tl cv2-tl-${e.kind}`}>
                      <span className="cv2-tl-time">{e.time}</span>
                      <i className="cv2-tl-dot" />
                      <div className="cv2-tl-body">
                        <b>{e.title}</b>
                        {e.detail && <span>{e.detail}</span>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        <form className="cv2-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <div className="cv2-sheet">
            {mention && mention.items.length > 0 && (
              <div className="cv2-picker" role="listbox" aria-label="引用参考片或特效">
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
              <div className="cv2-picker" role="listbox" aria-label="指令">
                {slashMenu.map((it) => (
                  <button key={it.cmd} type="button" role="option" aria-selected
                          onClick={newSession}>
                    <b>{it.cmd}</b><span>{it.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea className="cv2-input" rows={3} ref={inputRef}
                      value={chat.draft} onChange={(e) => { chat.setDraft(e.target.value); setMentionIdx(0) }}
                      onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}
                      onKeyDown={onInputKeyDown}
                      placeholder="发消息或创建任务，/ 调用指令，@ 引用参考片或特效" />
            <div className="cv2-sheet-foot">
              <div className="cv2-foot-left">
                <button type="button" className="cv2-at" title="引用参考片或特效" onClick={insertAtSign}>
                  <AtSign size={15} />
                </button>
                <span className="cv2-foot-hint">Enter 发送，Shift+Enter 换行</span>
              </div>
              <button className="cv2-send" type="submit" disabled={!chat.draft.trim() || pending}>
                <Send size={14} />发送
              </button>
            </div>
          </div>
        </form>

        <footer className="cv2-status">
          {messages.length} 条消息 · 演示模式 · 未连接 Agent · 会话仅内存{launched ? ' · 制作已开始' : ''}
        </footer>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, LoaderCircle, PanelLeft, Plus, Send } from 'lucide-react'
import type { ChatState } from '../shell/useChat'
import { workflowService } from '../services/workflowService'
import { GENOMES } from '../data/genomes'
import type { NewProjectInput } from '../shell/useProjects'
import type { WfPath } from '../data/workflowTemplates'
import { SegmentedControl } from '../components/ui/segmented-control'
import { ViewSwitch } from '../components/ViewSwitch'
import { fmtDuration } from '../shell/status'
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
 * 演示口径：Agent 未连接，回复是本地演示生成；会话与项目都在内存里，刷新即失。
 */

interface DemoReply {
  text: string
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
    toolCalls: [{ label: '更新方案', detail: '把你刚说的点并入方案要点' }],
  }
}

/* 与 StartCreation 同口径：首行过短 / 只有数字标点时不直接当名字 */
function usableName(text: string): string {
  const first = text.trim().split('\n')[0] ?? ''
  return first.length >= 2 && !/^[\d\s\p{P}]+$/u.test(first) ? first : ''
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
}) {
  const { chat } = props
  const [proPath, setProPath] = useState<WfPath>('prompt-first')
  const [pending, setPending] = useState(false)
  /* dsh 响应式：1024 以下左栏自动收为 56px 轨，手动展开为覆盖式抽屉 */
  const [narrow, setNarrow] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 1024))
  const [sideExpanded, setSideExpanded] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024))
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

  const newSession = () => {
    /* 开新会话时把未落地的演示回复一起取消，否则旧对话的回复会插进新会话 */
    if (replyTimer.current !== null) {
      window.clearTimeout(replyTimer.current)
      replyTimer.current = null
    }
    setPending(false)
    chat.clearChat()
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

  return (
    <div className="cv3">
      {drawer && <button type="button" aria-label="关闭项目栏" className="cv3-backdrop" onClick={() => setSideExpanded(false)} />}

      <aside className="cv3-side" data-rail={rail || undefined} data-drawer={drawer || undefined} aria-label="我的项目">
        <div className="cv3-side-top">
          <button type="button" className="cv3-icon-btn" aria-label={sideExpanded ? '收起项目栏' : '展开项目栏'} title={sideExpanded ? '收起项目栏' : '展开项目栏'} onClick={() => setSideExpanded((o) => !o)}>
            <PanelLeft size={16} />
          </button>
        </div>
        <button type="button" className="cv3-new" onClick={newSession} title="清空当前对话">
          <Plus size={15} /><span className="cv3-new-label">新对话</span>
        </button>

        <div className="cv3-side-sec">
          我的项目<span className="cv3-side-count num">{props.projects.length}</span>
        </div>
        <div className="cv3-side-list">
          {props.projects.length === 0 ? (
            <p className="cv3-side-hint">还没有项目。发第一条消息开始聊，或点下面的新建。</p>
          ) : props.projects.map((p) => (
            <button key={p.id} type="button" className="cv3-project"
                    data-current={p.id === props.openProject || undefined}
                    onClick={() => props.onSelectProject(p.id)} title={p.name}>
              <span className="cv3-project-name">{p.name}</span>
              <span className="cv3-project-meta num">
                {p.planned ? '待制作' : `${p.doneClips}/${p.totalClips} 场 · ${fmtDuration(p.duration)}`}
              </span>
              {p.id === props.openProject && <Check size={13} className="cv3-project-check" aria-label="当前项目" />}
            </button>
          ))}
        </div>
        <button type="button" className="cv3-side-add" onClick={props.onNewProject}>
          <Plus size={14} />新建项目
        </button>
        <p className="cv3-side-note">演示模式 · 未连接 Agent。项目与对话都在内存里，刷新即失。</p>
      </aside>

      <div className="cv3-main">
        <header className="cv3-head">
          <div className="cv3-title-row">
            <button type="button" className="cv3-icon-btn" aria-label={sideExpanded ? '收起项目栏' : '展开项目栏'} title={sideExpanded ? '收起项目栏' : '展开项目栏'} onClick={() => setSideExpanded((o) => !o)}>
              <PanelLeft size={16} />
            </button>
            <div className="cv3-crumb" title={title}>{title}</div>
            <span className="cv3-demo-pill">演示模式</span>
            <ViewSwitch current="conversation" workbenchDisabled={props.openProject === null}
                        onSwitch={(target) => { if (target === 'workbench') props.onOpenWorkbench() }} />
          </div>
        </header>

        <div className="cv3-scroll" ref={scrollRef}>
          <div className="cv3-view">
            <div className="cv3-col">
              {userMessages.length === 0 && (
                <p className="cv3-ai-intro">说说你想做的片子——讲给谁、讲什么、想要什么感觉。先聊清楚，再开始制作。</p>
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
                      <b className="cv3-changes-title">已创建</b>
                      <table>
                        <thead><tr><th>对象</th><th>改动</th></tr></thead>
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
              <span className="cv3-pill">{messages.length} 条消息</span>
              <span className="cv3-sep">·</span>
              <span className="cv3-pill">演示模式</span>
              <span className="cv3-sep">·</span>
              <span className="cv3-pill">未连接 Agent</span>
              {launched && (<><span className="cv3-sep">·</span><span className="cv3-pill">制作已开始</span></>)}
            </footer>
          </div>
        </div>
      </div>
    </div>
  )
}

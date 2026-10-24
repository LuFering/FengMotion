import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, Send } from 'lucide-react'
import type { ChatState } from '../shell/useChat'
import { workflowService } from '../services/workflowService'
import { GENOMES } from '../data/genomes'
import type { NewProjectInput } from '../shell/useProjects'
import type { WfPath } from '../data/workflowTemplates'
import { SegmentedControl } from '../components/ui/segmented-control'
import '../styles/conversation.css'

/**
 * 项目 agent 对话视图（原型）——首页与工作台之间的会话层。
 *
 * 定位：对话视图与工作台是同一个 agent 会话的两种呈现。
 *   对话视图 = 完整的思考过程（消息 + 思考 + 工具调用 + 方案）
 *   工作台   = 完整的制作过程（场景 / 时间线 / 产物 / 任务状态）
 * 两边共用 App 的 useChat 会话：首页那句需求就是首条用户消息，
 * 工作台右栏的对话 tab 看到的是同一份消息（它只渲染 text）。
 *
 * 原型边界（诚实标注，不假装真实 Agent）：
 *   - agent 回复是本地演示生成，未连接 Agent；思考与工具调用均为演示内容。
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
        ? '收到，这条我理解为一支 Token 科普短片。先跟你对三个点：讲给谁听、想做到多长、想要什么感觉——你先回其中任何一点，我再往下细化方案。'
        : '收到。先跟你对三个点：这条片子讲给谁听、想做到多长、想要什么感觉——你先回其中任何一点，我再往下细化方案。',
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
  const repliedRef = useRef(new Set<string>())
  const streamRef = useRef<HTMLDivElement>(null)

  /* 工作台对话 tab 的 intro 免责句不属于创作会话，对话视图里滤掉 */
  const messages = useMemo(() => chat.messages.filter((m) => m.id !== 'intro'), [chat.messages])
  const userMessages = useMemo(() => messages.filter((m) => m.role === 'user'), [messages])
  const firstBrief = userMessages[0]?.text ?? ''
  const title = usableName(firstBrief).slice(0, 14) || '未命名创作'
  const planMessage = messages.find((m) => m.role === 'ai' && m.plan)
  const launched = props.openProject !== null

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
    <div className="cv">
      <header className="cv-head">
        <div className="cv-head-main">
          <b className="cv-title">{title}</b>
          <span className="cv-demo">演示模式 · 未连接 Agent，回复为本地演示</span>
        </div>
        <div className="cv-switch" role="group" aria-label="对话与工作台切换">
          <button type="button" data-on aria-current="page">对话</button>
          <button type="button" disabled={!launched} onClick={props.onOpenWorkbench}
                  title={launched ? '进入工作台查看完整制作过程' : '开始制作后可进入工作台'}>
            工作台
          </button>
        </div>
      </header>

      {launched && (
        <div className="cv-launched">
          制作已开始
          <button type="button" onClick={props.onOpenWorkbench}>进入工作台查看完整制作过程 →</button>
        </div>
      )}

      <div className="cv-stream" ref={streamRef}>
        <div className="cv-col">
          {userMessages.length === 0 && (
            <div className="cv-ai">
              <span className="cv-avatar">AI</span>
              <p>说说你想做的片子——讲给谁、讲什么、想要什么感觉。先聊清楚，再开始制作。</p>
            </div>
          )}

          {messages.map((m) => m.role === 'user' ? (
            <p key={m.id} className="cv-user">{m.text}</p>
          ) : (
            <div key={m.id} className="cv-ai-block">
              <div className="cv-ai">
                <span className="cv-avatar">AI</span>
                <p>{m.text}</p>
              </div>
              {m.thinking && (
                <details className="cv-think">
                  <summary>思考过程（演示）</summary>
                  <p>{m.thinking}</p>
                </details>
              )}
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="cv-tools">
                  {m.toolCalls.map((t, i) => (
                    <div key={i} className="cv-tool">
                      <i className="cv-tool-dot" />
                      <b>{t.label}</b>
                      <span>{t.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.plan && (
                <div className="cv-plan">
                  <b className="cv-plan-title">制作方案（演示）</b>
                  <ol>
                    {m.plan.map((p, i) => <li key={i}>{p}</li>)}
                  </ol>
                  {!launched && (
                    <>
                      <div className="cv-plan-path">
                        <span>专业制作路径</span>
                        <SegmentedControl value={proPath}
                                          onChange={(v) => setProPath(v as WfPath)}
                                          ariaLabel="专业制作路径"
                                          options={[{ value: 'prompt-first', label: 'Prompt-first' }, { value: 'structured', label: 'Structured' }]} />
                      </div>
                      <div className="cv-plan-actions">
                        <button type="button" className="cv-primary" onClick={() => launch(true)}>开始制作（快速，自动运行）</button>
                        <button type="button" className="cv-secondary" onClick={() => launch(false)}>创建并进入工作台（不自动运行）</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          {pending && (
            <div className="cv-ai">
              <span className="cv-avatar">AI</span>
              <p className="cv-pending"><LoaderCircle className="cv-spin" size={14} /> 正在思考…（演示）</p>
            </div>
          )}
        </div>
      </div>

      {!launched && planMessage && (
        <div className="cv-startrow">
          <span>方案就绪</span>
          <button type="button" onClick={() => launch(true)}>开始制作（快速，自动运行）</button>
          <button type="button" onClick={() => launch(false)}>进入专业制作（不自动运行）</button>
        </div>
      )}

      <form className="cv-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="cv-sheet">
          <textarea className="cv-input" rows={3}
                    value={chat.draft} onChange={(e) => chat.setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                    placeholder="继续聊灵感、风格、结构…（Enter 发送，Shift+Enter 换行）" />
          <div className="cv-sheet-foot">
            <span>对话只在内存里，刷新即失（原型）</span>
            <button className="cv-send" type="submit" disabled={!chat.draft.trim() || pending}>
              <Send size={14} />发送
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

/**
 * AI 回复的结构 —— 按 dsh 的 ChatView 组装。
 *
 * 来源：`@deepseek-ai/dsh-client-ui-chat` 的 lib/client.js（从安装包 app.asar 解出）。
 * 它在一次 assistant 回复里按固定顺序放这几块，本文件照它的结构做：
 *
 *   turn-process（过程区）
 *     ├─ reasoning      思考折叠块  .NpTkMG_root（收起高 24px，展开显示正文）
 *     ├─ tool-calls     工具调用    .aDgvMW_callRow / .cxT0Bq_root
 *     └─ running        运行指示    .dM7RPG_running（正文到达前）
 *   answer（正文）
 *     └─ .xPs6ua_root → .xPs6ua_body（gap 16px）
 *   actions（操作条）  .xPs6ua_actions（margin-top 16px, margin-left -6px）
 *
 * 关键尺寸（全部取自 dsh 的 CSS 模块，不是目测）：
 *   · 正文容器      字号 14px / 行高 24px，块间距 16px
 *   · 操作条        margin-top 16px，左移 6px 与文字对齐
 *   · 思考折叠      收起高 24px；正文内缩 22px
 *   · 工具调用行    圆角 radius-sm；子调用左边线 .5px、缩进 22px + 8px
 *   · 工具结果面板  边线 .5px、圆角 radius-lg、最大高 320px、项内边距 10/14
 *   · 运行指示      字号 13px、行高 22px、图标 14px、gap 6px
 */

import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import './ai-turn.css'

/* ── 思考折叠块 ────────────────────────────────────────────── */

export function ReasoningBlock({
  text,
  streaming,
  /** 秒数；有值就在标题后显示耗时 */
  seconds,
  defaultOpen = false,
}: {
  text: string
  streaming?: boolean
  seconds?: number
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  /* 收起态固定 24px：dsh 用 contain:size + height 定死，
     这样思考过程在「进行中 ↔ 完成」之间切换时不会把正文顶动。 */
  return (
    <div className="ai-reason" data-expanded={open || undefined}>
      <button
        type="button"
        className="ai-reason-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={14} className="ai-reason-caret" aria-hidden />
        <span className="ai-reason-title">{streaming ? '正在思考' : '思考过程'}</span>
        {seconds !== undefined ? <span className="ai-reason-sep" aria-hidden /> : null}
        {seconds !== undefined ? <span className="ai-reason-time">{Math.round(seconds)}s</span> : null}
        {!open && text ? (
          <>
            <span className="ai-reason-sep" aria-hidden />
            <span className="ai-reason-summary" data-streaming={streaming || undefined}>
              {text}
            </span>
          </>
        ) : null}
      </button>
      {open ? <div className="ai-reason-body">{text}</div> : null}
    </div>
  )
}

/* ── 工具调用 ──────────────────────────────────────────────── */

export interface ToolCallItem {
  name: string
  /** 人话摘要（命令、文件路径、查询词…） */
  summary: string
  done?: boolean
  isError?: boolean
  /** 工具输出（展开时显示在结果面板里） */
  result?: string
  /** 子调用（并行工具） */
  children?: ToolCallItem[]
}

export function ToolCallRow({ call }: { call: ToolCallItem }) {
  const [open, setOpen] = useState(false)
  const status = call.isError ? '失败' : call.done ? '完成' : '执行中'
  const hasDetail = !!call.children?.length || !!call.result

  return (
    <div className="ai-call" data-state={call.isError ? 'failed' : call.done ? 'done' : 'running'}>
      <button type="button" className="ai-call-head" aria-expanded={open}
              disabled={!hasDetail} onClick={() => setOpen((v) => !v)}>
        <span className="ai-call-dot" aria-hidden />
        <span className="ai-call-name">{call.name}</span>
        <span className="ai-call-summary">{call.summary}</span>
        <span className="ai-call-status">{status}</span>
      </button>
      {open ? (
        <>
          {call.result ? <ToolResultPanel title="结果" body={call.result} /> : null}
          {call.children?.length ? (
            <div className="ai-call-sub">
              {call.children.map((c, i) => (
                <ToolCallRow key={`${c.name}-${i}`} call={c} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export function ToolCalls({ calls }: { calls: ToolCallItem[] }) {
  if (calls.length === 0) return null
  return (
    <div className="ai-calls">
      {calls.map((c, i) => (
        <ToolCallRow key={`${c.name}-${i}`} call={c} />
      ))}
    </div>
  )
}

/* ── 运行指示 ────────────────────────────────────────────────
   dsh 这里是一个 14px 的鲸鱼图标 + 文案 + 耗时。
   本项目用 ThinkingOrbs（20px）替代图标 —— 尺寸略大，但状态语义一致。 */

export function RunningRow({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <div className="ai-running">
      {icon ? <span className="ai-running-icon">{icon}</span> : null}
      <span className="ai-running-text">{label}</span>
    </div>
  )
}

/* ── 正文容器 ──────────────────────────────────────────────── */

export function AnswerBody({ children }: { children: ReactNode }) {
  return (
    <div className="ai-answer">
      <div className="ai-answer-body">{children}</div>
    </div>
  )
}

/* ── 操作条 ────────────────────────────────────────────────── */

export function AnswerActions({ children }: { children: ReactNode }) {
  return <div className="ai-actions">{children}</div>
}


/* ── 工具结果面板 ──────────────────────────────────────────────
   dsh 的 .cxT0Bq_root：.5px 边线、radius-lg、代码块底色、
   列表最大高 320px、项内边距 10/14。 */

export function ToolResultPanel({ title, body }: { title?: string; body: string }) {
  return (
    <div className="ai-result">
      {title ? <div className="ai-result-caption">{title}</div> : null}
      <pre className="ai-result-body">{body}</pre>
    </div>
  )
}

/* ── 运行分隔线 ────────────────────────────────────────────────
   dsh 的 .dM7RPG_runningDivider：0.5px 线、margin 8px 0 10px。
   它只在「上一块不是用户消息」时出现，用来把「过程」和「回答」分开。 */

export function RunningDivider() {
  return <div className="ai-running-divider" aria-hidden />
}

/* ── 整轮折叠卡 ────────────────────────────────────────────────
   dsh 的 .rHOitW_root：.5px 边线、radius-xl、header padding 12/16、
   图标 + 标题 + 右上时间 + 展开箭头。
   用途：一轮结束很久之后，把「过程」整轮收起来，只留这张卡。 */

export function TurnTrigger({
  title,
  time,
  open,
  onToggle,
  children,
}: {
  title: string
  time?: string
  open: boolean
  onToggle: () => void
  children?: ReactNode
}) {
  return (
    <div className="ai-turn-card">
      <button type="button" className="ai-turn-head" aria-expanded={open} onClick={onToggle}>
        <span className="ai-turn-icon" aria-hidden>
          <ChevronRight size={15} className={open ? 'ai-turn-caret is-open' : 'ai-turn-caret'} />
        </span>
        <span className="ai-turn-title">{title}</span>
        {time ? <span className="ai-turn-time">{time}</span> : null}
      </button>
      {open && children ? <div className="ai-turn-body">{children}</div> : null}
    </div>
  )
}

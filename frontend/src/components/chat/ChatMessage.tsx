/**
 * ChatMessage —— 一条对话消息。
 *
 * 行为取自 BoardUI 免费聊天模板（`agent-chat-message.tsx`，源码可下载）：
 *   · 用户消息：右侧、宽度上限 75%、圆角 2xl、padding 3/11px
 *   · AI 回复：左侧、无气泡、逐行 blur-in 生长（不是整段一起淡入）
 *   · 操作条「始终挂载、悬停或聚焦时显现」——
 *     不能只在 hover 时才渲染：那样键盘用户永远够不到，
 *     而且指针扫过时布局会跳。
 *   · 复制后 1.6s 回到原图标
 *
 * 本项目的两处必要改动（都在下面标了原因）：
 *   · 正文换成 Markdown（上游是 whitespace-pre-wrap 纯文本）
 *   · 追加「重试 / 编辑重发」两个上游没有的操作 —— 本项目的回复
 *     会真实失败（Agent 未接入、流中断），用户需要能重来
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Check, Copy, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { MarkdownText } from './MarkdownText'
import './chat-message.css'

export interface ChatMessageProps {
  role: 'user' | 'ai'
  text: string
  /** 正在流式接收：操作条先藏起来，时间也不显示 */
  streaming?: boolean
  /** 到达时间（ms），用于悬停时的时间戳 */
  at?: number
  /** 失败原因；有值 = 这条回复没完成，界面不得当作成功 */
  failed?: string
  /** 演示回复标记 */
  demo?: boolean
  /** 附件名列表（用户消息上显示） */
  attachments?: string[]
  /** 重试这一轮（仅 AI 且失败/演示时给） */
  onRetry?: () => void
  /** 编辑并重发对应的用户消息 */
  onEditResend?: (text: string) => void
  /** 用户消息下方的附加块（排队状态、请求快照等） */
  below?: ReactNode
  /** AI 消息头像槽（工作台用 EyeTracker，对话界面不传） */
  avatar?: ReactNode
}

/* ── 相对时间（与左栏会话列表同一套口径）──────────────────── */

function formatAgo(at: number): string {
  const sec = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (sec < 45) return '刚刚'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.round(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.round(hour / 24)
  return `${day} 天前`
}

/* ── 逐行生长 ────────────────────────────────────────────────
   上游的做法：按 \n 切行，每行首次挂载时 blur-in，之后只增长不重播。
   为什么不按词动画：token 到达时是碎片，模糊动画作用在碎片上，
   碎片再变成完整单词时没有过渡，看起来是「卡一下」。
   行只挂载一次，所以不会重播也不会跳。 */

const LINE_HIDDEN = { opacity: 0, filter: 'blur(5px)', y: 4 }
const LINE_SHOWN = { opacity: 1, filter: 'blur(0px)', y: 0 }
const LINE_TRANSITION = { duration: 0.42, ease: [0.22, 0.61, 0.36, 1] as const }

function StreamedLines({ text, animate }: { text: string; animate: boolean }) {
  const lines = useMemo(() => text.split('\n').filter((l) => l.trim() !== ''), [text])
  return (
    <div className="cm-lines">
      {lines.map((line, i) => (
        <motion.p
          key={i}
          initial={animate ? LINE_HIDDEN : false}
          animate={LINE_SHOWN}
          transition={LINE_TRANSITION}
          className="cm-line"
        >
          {line}
        </motion.p>
      ))}
    </div>
  )
}

/* ── 操作按钮 ──────────────────────────────────────────────── */

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="cm-action">
      {children}
    </button>
  )
}

/* ── AI 操作条 ──────────────────────────────────────────────── */

function MessageActions({
  text,
  at,
  hidden,
  onRetry,
}: {
  text: string
  at?: number
  hidden: boolean
  onRetry?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  /* 朗读在组件卸载后仍会继续，所以卸载时必须取消 —— 否则它会在下一屏继续念 */
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
    }
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      /* 剪贴板可能被拒（非安全源、权限拒绝）。图标不变比抛错好 */
    }
  }

  const toggleSpeech = () => {
    const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis
    if (!synth) return
    if (speaking) {
      synth.cancel()
      setSpeaking(false)
      return
    }
    const utter = new SpeechSynthesisUtterance(text)
    utter.onend = () => setSpeaking(false)
    utter.onerror = () => setSpeaking(false)
    synth.cancel()
    synth.speak(utter)
    setSpeaking(true)
  }

  return (
    <div className={`cm-actions${hidden ? ' is-hidden' : ''}`}>
      <ActionButton label={copied ? '已复制' : '复制这条回复'} onClick={copy}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </ActionButton>

      <ActionButton label={speaking ? '停止朗读' : '朗读这条回复'} onClick={toggleSpeech}>
        {speaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </ActionButton>

      {onRetry ? (
        <ActionButton label="重试这一轮" onClick={onRetry}>
          <RotateCcw size={14} />
        </ActionButton>
      ) : null}

      {at ? (
        <time dateTime={new Date(at).toISOString()} className="cm-time">
          {formatAgo(at)}
        </time>
      ) : null}
    </div>
  )
}

/* ── 对外组件 ──────────────────────────────────────────────── */

export function ChatMessage({
  role,
  text,
  streaming = false,
  at,
  failed,
  demo,
  attachments,
  onRetry,
  onEditResend,
  below,
  avatar,
}: ChatMessageProps) {
  const reduce = useReducedMotion() ?? false
  if (!text && !attachments?.length) return null

  if (role === 'user') {
    return (
      <div className="cm cm-user-wrap">
        <div className="cm-user">
          {text}
          {attachments?.length ? (
            <span className="cm-user-attachments">
              {attachments.map((name, i) => (
                <span key={`${name}-${i}`} className="cm-user-attachment">
                  {name}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        {onEditResend && !streaming ? (
          <div className="cm-user-actions">
            <ActionButton label="编辑并重发" onClick={() => onEditResend(text)}>
              <RotateCcw size={12} />
            </ActionButton>
          </div>
        ) : null}
        {below}
      </div>
    )
  }

  return (
    <div className="cm cm-ai">
      {avatar ? <div className="cm-avatar">{avatar}</div> : null}
      <div className="cm-ai-body">
        {/* 流式期间用逐行生长；结束后走 Markdown（含代码高亮）。
            两者不能同时用：Markdown 会把行合并成段落，逐行动画就没有落点了。 */}
        {streaming ? <StreamedLines text={text} animate={!reduce} /> : <MarkdownText text={text} />}

        {demo && !streaming && !failed ? <p className="cm-note">演示回复 · 未连接 Agent</p> : null}
        {failed ? (
          <p className="cm-failed" role="alert">
            这条回复没有完成：{failed}
          </p>
        ) : null}

        <MessageActions text={text} at={at} hidden={streaming} onRetry={onRetry} />
      </div>
    </div>
  )
}

export default ChatMessage

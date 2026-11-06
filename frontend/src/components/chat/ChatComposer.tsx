/**
 * ChatComposer —— 对话输入框。
 *
 * 几何取自 BoardUI 免费聊天模板（`agent-composer.tsx`，源码可下载）：
 *   · 胶囊高 52px、内边距 8px、圆钮 36px、行内间距 10px
 *   · 附件钮、输入区、模型标签、发送/停止切换
 *   · 底部 26px 状态行
 *
 * 与上游的两处差异（都标了原因）：
 *   · 输入用 textarea 而非 input：中文长句需要换行查看，
 *     单行 input 会横向滚动，用户看不到自己前半句写了什么
 *   · 加载态换成项目已有的 ComposerLoader 等价实现（见 chat-composer.css
 *     里的环绕光带），因为原组件依赖 BoardUI 的 SVG 渐变体系
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowUp, Paperclip, Square } from 'lucide-react'
import './chat-composer.css'

export interface ChatComposerProps {
  value: string
  onValueChange: (v: string) => void
  onSubmit: () => void
  /** 正在生成时提供：点它停止 */
  onStop?: () => void
  /** 生成中：胶囊显示环绕光带、主按钮变停止 */
  busy?: boolean
  placeholder?: string
  /** 附件按钮（上游是空位；本项目接了真实上传时传这个） */
  onAttach?: () => void
  /** 模型选择器等右侧控件（工作台那栏复用对话界面同一套） */
  trailing?: ReactNode
  /** 左侧额外控件（权限模式等） */
  leading?: ReactNode
  /** 输入框上方的附件卡片区 */
  above?: ReactNode
  /** 输入框下方的错误提示 */
  error?: ReactNode
  /** 底部状态行左侧/右侧文案 */
  statusLeft?: ReactNode
  statusRight?: ReactNode
  disabled?: boolean
  /**
   * 只拦「发送」、不拦「输入」。
   *
   * 与 disabled 分开的原因：引擎不可用时，用户仍然应该能把想法写下来
   * （写完了等引擎接上再发），把整个输入框锁死等于让人白打一遍字。
   */
  sendBlocked?: boolean
  /** 自动增高上限（px），超过则内部滚动 */
  maxHeight?: number
}

export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  busy = false,
  placeholder = '说说你想做的片子…',
  onAttach,
  trailing,
  leading,
  above,
  error,
  statusLeft,
  statusRight,
  disabled = false,
  sendBlocked = false,
  maxHeight = 168,
}: ChatComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  /* 自动增高：先归零再按 scrollHeight 设，否则删字时高度不会回落 */
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [value, maxHeight])

  const canSend = value.trim().length > 0 && !disabled && !sendBlocked

  return (
    <div className="cc">
      {above}

      <div className={`cc-pill${busy ? ' is-busy' : ''}`}>
        {/* 环绕光带：生成中才亮，与上游 ComposerLoader 的观感一致 */}
        {busy ? <span className="cc-glow" aria-hidden /> : null}

        {leading}

        {onAttach ? (
          <button type="button" className="cc-attach" aria-label="添加附件" title="添加附件" onClick={onAttach}>
            <Paperclip size={16} />
          </button>
        ) : null}

        <textarea
          ref={inputRef}
          rows={1}
          className="cc-input"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="创作要求或修改意见"
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            /* Enter 发送、Shift+Enter 换行；输入法组字期间不拦
               （否则中文选字时按 Enter 会把半截拼音发出去） */
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (canSend) onSubmit()
            }
          }}
        />

        {trailing}

        <div className="cc-send-wrap">
          {busy && onStop ? (
            <button type="button" className="cc-stop" aria-label="停止生成" title="停止生成" onClick={onStop}>
              <Square size={14} />
            </button>
          ) : (
            <button
              type="submit"
              className="cc-send"
              aria-label="发送"
              title="发送"
              disabled={!canSend}
              onClick={(e) => {
                e.preventDefault()
                if (canSend) onSubmit()
              }}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>

      {error}

      {statusLeft || statusRight ? (
        <div className="cc-status">
          <div className="cc-status-left">{statusLeft}</div>
          <div className="cc-status-right">{statusRight}</div>
        </div>
      ) : null}
    </div>
  )
}

export default ChatComposer

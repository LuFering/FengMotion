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

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { ArrowUp, Square } from '@untitledui/icons'
import { useSpringPress } from './useSpringPress'
import '@/features/chat/styles/components/chat-composer.css'

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
  /**
   * 自定义的「加号」动作区。
   *
   * 点了不该直接弹系统文件框 —— 参考组件里先弹一个「添加」菜单
   * （文件和文件夹 / 目标 / 计划模式 / 文件 / 电子表格 / 演讲 / 代码块）。
   * 传了这个就由调用方自己渲染触发器与菜单，样式仍由 .cc-attach 提供。
   */
  attachMenu?: ReactNode
  /** 模型选择器等右侧控件（工作台那栏复用对话界面同一套） */
  trailing?: ReactNode
  /** 左侧额外控件（权限模式等） */
  leading?: ReactNode
  /**
   * 胶囊下方的次级动作行（例如工作台的「演示」）。
   *
   * ⚠️ 不要把这些动作塞进胶囊：工作台那栏只有 313px 宽，
   * 一个 48px 的按钮会把输入区压到 191px，占位文字换行后被裁掉
   * （真机测量确认）。也不要塞进 26px 的状态行 —— 32px 的按钮会溢出。
   * 动作放在胶囊外、状态行上方，与原来 .fw-sheet 的行布局一致。
   */
  footer?: ReactNode
  /**
   * 最小行数。
   *
   * textarea 的自动高度只按 value 算，占位文字换行不会撑高它，
   * 窄栏里就会出现「占位文字第二行被裁掉」。给窄栏（工作台 313px）
   * 传 2 行即可；对话界面 680px 宽，1 行足够。
   */
  minRows?: number
  /**
   * 输入框上方的附加区（在胶囊**外面**）。
   *
   * 曾经用来放待发送附件；现在附件改到胶囊内部（见 {@link insideTop}），
   * 这个插槽留给「任务清单抽屉」这类确实该压在输入框上的整块面板。
   */
  above?: ReactNode
  /**
   * 胶囊**内部**顶部的附加区：待发送附件卡片放这里。
   *
   * 为什么放进胶囊：附件和输入的文字是同一件事的两半
   * （「给这张图写个说明」），分在外外两块会让眼睛来回跳；
   * 放进胶囊后它们共享同一个白色容器与同一圈圆角，
   * 视觉上读作「这块区域就是我在编辑的消息」。
   */
  insideTop?: ReactNode
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

/**
 * 窄栏里把 minRows 降下来。
 *
 * <p>调用方给的 minRows 是按「宽栏、占位文字会被折行」算的；两层布局之后
 * 底栏自己占了一行，再保 2 行文字区就会在胶囊里空出一大片。这里按实际
 * 宽度判断：容器窄于 380px 时至少降到 1 行。</p>
 */
function useNarrowRows(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  minRows: number,
): number {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const host = el.closest('.cc')
    if (!host) return
    const ro = new ResizeObserver(([entry]) => {
      setNarrow(entry.contentRect.width < 380)
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [ref])
  return narrow ? 1 : minRows
}

export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  busy = false,
  placeholder = '说说你想做的片子…',
  onAttach,
  attachMenu,
  trailing,
  leading,
  footer,
  minRows = 1,
  above,
  insideTop,
  error,
  statusLeft,
  statusRight,
  disabled = false,
  sendBlocked = false,
  maxHeight = 168,
}: ChatComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /* 发送钮与加号同一套按压弹簧 —— 原版所有圆钮都有这个反馈 */
  const sendPressRef = useSpringPress<HTMLButtonElement>()

  /* 自动增高：先归零再按 scrollHeight 设，否则删字时高度不会回落。
     窄栏里 minRows 会按容器宽度自动降级（见下），所以这里读 effectiveRows。 */
  const effectiveRows = useNarrowRows(inputRef, minRows)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const line = 22 /* 13.5px × 1.6 行高，与 .cc-input 的 line-height 对应 */
    const floor = effectiveRows * line
    el.style.height = `${Math.min(Math.max(el.scrollHeight, floor), maxHeight)}px`
  }, [value, maxHeight, effectiveRows])

  const canSend = value.trim().length > 0 && !disabled && !sendBlocked
  /* 底栏只有「发送」时不该单独占一行 —— 那会在胶囊底部留出一条空白带。
     工作台那栏没有附件钮、没有模型选择器，正好是这种情况：此时退回单行，
     发送钮直接贴在文字右侧。 */
  const hasBarContent = Boolean(onAttach || attachMenu || leading || trailing)

  return (
    <div className="cc">
      {above}

      {/* 两层结构：上排只有文字，下排放控件。
          原先所有控件挤在一行，680px 里要同时塞下权限、附件、模型、发送，
          模型选择器被压到 197px（长模型名直接撑满），文字区只剩中间一小段。
          参考 Deep Agent Composer 的做法：文字独占一行，控件沉到底栏，
          文字区因此能拿到整行宽度，模型选择器也不必再压。 */}
      <div className={`cc-pill${busy ? ' is-busy' : ''}`}>
        {/* 环绕光带：生成中才亮，与上游 ComposerLoader 的观感一致 */}
        {busy ? <span className="cc-glow" aria-hidden /> : null}

        {/* 附件卡片：胶囊内部顶部，位于输入文字之上 */}
        {insideTop ? <div className="cc-inside-top">{insideTop}</div> : null}

        <textarea
          ref={inputRef}
          rows={minRows}
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

        <div className="cc-bar" data-compact={hasBarContent ? undefined : ''}>
          <div className="cc-bar-left">
            {attachMenu ?? (onAttach ? (
              <button type="button" className="cc-attach" aria-label="添加附件" title="添加附件" onClick={onAttach}>
                <UiIcon icon={SemIcons.plus} size="md" />
              </button>
            ) : null)}
            {leading}
          </div>

          <div className="cc-bar-right">
            {trailing}
            <div className="cc-send-wrap">
              {busy && onStop ? (
                <button type="button" className="cc-stop" aria-label="停止生成" title="停止生成" onClick={onStop}>
                  <UiIcon icon={Square} size="sm" />
                </button>
              ) : (
                <button
                  ref={sendPressRef}
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
                  <UiIcon icon={ArrowUp} size="md" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {footer ? <div className="cc-footer">{footer}</div> : null}

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

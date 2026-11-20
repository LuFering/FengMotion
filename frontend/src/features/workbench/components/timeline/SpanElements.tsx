import { useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { ArrowUp } from '@untitledui/icons'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { CATEGORY_ICON, clipLabel, clipTime, spanPrompt } from '@/features/workbench/components/timeline/timelineDisplay'
import type { SpanElement } from '@/features/workbench/model/timelineGroups'
import { shortSrc } from '@/features/workbench/model/liveEdit'

/**
 * 时间选区里有哪些元素：选区胶囊上的「N 个元素」，点开列出来，
 * 点一个就跳过去选中它；实时模式下还能直接把这段连同元素清单交给 AI。
 *
 * <p>弹层挂在 #pane-flow 里，才能用工作台的颜色和主题（挂到 body 上就读不到）。</p>
 */
export function SpanElements({ span, elements, fps, onPick, onAsk, busy }: {
  span: { start: number; end: number }
  elements: SpanElement[]
  fps: number | undefined
  onPick: (element: SpanElement) => void
  onAsk?: (prompt: string) => Promise<boolean>
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [ask, setAsk] = useState('')
  const [sending, setSending] = useState(false)
  const host = typeof document !== 'undefined' ? document.getElementById('pane-flow') : null

  const send = async () => {
    const text = ask.trim()
    if (!text || sending || busy || !onAsk) return
    setSending(true)
    const ok = await onAsk(spanPrompt(span, elements, fps, text))
    setSending(false)
    if (ok) { setAsk(''); setOpen(false) }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" className="wb-tl-action-btn primary" aria-label={`选区里有 ${elements.length} 个元素`}>
          {elements.length} 个元素
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal container={host ?? undefined}>
        <PopoverPrimitive.Content className="wb-tl-span-pop" side="bottom" align="center" sideOffset={8} collisionPadding={12}>
          <div className="wb-tl-span-pop-head">
            <span>{clipTime(span.start, fps)} – {clipTime(span.end, fps)}</span>
            <em>{elements.length} 个元素</em>
          </div>
          <ul className="wb-tl-span-list">
            {elements.length === 0 && <li className="wb-tl-span-none">这段时间里没有识别到元素</li>}
            {elements.map((e) => {
              const Icon = CATEGORY_ICON[e.category]
              const { lead, sub } = clipLabel(e)
              return (
                <li key={e.key}>
                  <button type="button" data-cat={e.category} onClick={() => { onPick(e); setOpen(false) }}>
                    <Icon size={12} />
                    <span className="wb-tl-span-name">{lead}{sub ? <small>{sub}</small> : null}</span>
                    <span className="wb-tl-span-at">{e.src ? shortSrc(e.src) : clipTime(e.start, fps)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {onAsk && (
            <div className="wb-tl-span-ask">
              <textarea value={ask} rows={2} placeholder="让 AI 改这一段…" disabled={sending}
                        onChange={(e) => setAsk(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
                        }} />
              <button type="button" aria-label="交给 AI" disabled={!ask.trim() || sending || busy} onClick={() => void send()}>
                {sending ? <UiIcon icon={SemIcons.loading} size="xs" className="wb-tl-spin" /> : <UiIcon icon={ArrowUp} size="xs" />}
              </button>
            </div>
          )}
          {onAsk && <p className="wb-tl-span-hint">时间范围和元素清单会一起交过去{busy ? '；有任务正在进行，稍后再发' : ''}</p>}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

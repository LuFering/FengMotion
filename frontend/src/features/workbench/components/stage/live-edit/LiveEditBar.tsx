import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, ChevronDown, Code02, Copy01, DotsHorizontal, FlipBackward, LayersTwo01, Stars02, Type01, XClose } from '@untitledui/icons'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import type { LivePreview } from '@/features/workbench/hooks/stage/useLivePreview'
import {
  fieldState, hexOf, joinUnit, levelName, pxOf, shortSrc, splitUnit, styleTarget, styleTargetFor, textTarget, toTimecode, type FieldState, type StyleTarget,
} from '@/features/workbench/model/liveEdit'
import { ColorField, ParamRow, ScrubNumber, Segmented, Slider } from '@/features/workbench/components/stage/live-edit/fields'
import '@/features/workbench/styles/workbench/live-edit.css'

export type DrawerId = 'layers' | 'text' | 'type' | 'color' | 'ai' | 'more'

/** 工具条与选中框之间、与画面边缘之间的距离 */
const GAP = 8

/**
 * 实时画面里选中元素后贴在选中框旁边的微型工具条，点一项展开它的抽屉（第二级），
 * 「更多」抽屉里的几块再按需展开（第三级）。
 *
 * <p>挂在工作台 #pane-flow 里（fixed 定位），直接用工作台的颜色、圆角、阴影和主题。
 * 能改的值来自预览服务读出的源码字面量；拖动只改画面，松手写回源码（见 useLivePreview.commitEdit）。</p>
 */
export function LiveEditBar({ live, drawer, setDrawer, onAskAi, busy }: {
  live: LivePreview
  drawer: DrawerId | null
  setDrawer: (d: DrawerId | null) => void
  onAskAi: (prompt: string) => Promise<boolean>
  busy: boolean
}) {
  const sel = live.selection
  const host = typeof document !== 'undefined' ? document.getElementById('pane-flow') ?? document.body : null
  if (!sel || !host) return null
  return createPortal(<Bar live={live} drawer={drawer} setDrawer={setDrawer} onAskAi={onAskAi} busy={busy} />, host)
}

function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>{text}</TooltipContent>
    </Tooltip>
  )
}

function Bar({ live, drawer, setDrawer, onAskAi, busy }: Parameters<typeof LiveEditBar>[0]) {
  const sel = live.selection!
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null)
  const el = sel.kind === 'element' ? sel.element : null
  const stale = Boolean(sel.stale) || live.commit.pending

  /* 摆位置：优先选中框上方，放不下放下方；抽屉朝远离元素的一侧展开；不出实时画面 */
  const box = sel.box
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const place = () => {
      const frame = live.frameRect()
      const bounds = frame ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight }
      const bar = node.querySelector('.lve-bar') as HTMLElement | null
      const w = node.offsetWidth
      const barH = bar?.offsetHeight ?? 32
      const totalH = node.offsetHeight
      const left = Math.min(Math.max(bounds.left + GAP, box.left), Math.max(bounds.left + GAP, bounds.right - w - GAP))
      const spaceAbove = box.top - GAP - (bounds.top + GAP)
      const spaceBelow = bounds.bottom - GAP - (box.top + box.height + GAP)
      /* 整组（工具条 + 抽屉）放得进上方就放上方、抽屉朝上开；放不进就整组挪到元素下方、抽屉朝下开；
         两边都放不下时选空间大的一侧贴边 —— 无论哪种，工具条都不压在元素上 */
      if (totalH <= spaceAbove) setPos({ left, top: box.top - GAP - totalH, up: true })
      else if (totalH <= spaceBelow) setPos({ left, top: box.top + box.height + GAP, up: false })
      else if (spaceAbove >= spaceBelow && barH <= spaceAbove) setPos({ left, top: Math.max(bounds.top + GAP, box.top - GAP - totalH), up: true })
      else setPos({ left, top: Math.min(box.top + box.height + GAP, Math.max(bounds.top + GAP, bounds.bottom - GAP - totalH)), up: false })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(node)
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place) }
  }, [box.left, box.top, box.width, box.height, live, drawer])

  /* Esc：先收抽屉，再取消选中 */
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const editing = (e.target as HTMLElement | null)?.closest?.('textarea, input')
      if (editing) return
      if (drawer) setDrawer(null)
      else live.clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer, setDrawer, live])

  const toggle = (id: DrawerId) => setDrawer(drawer === id ? null : id)
  const textT = el ? textTarget(el) : null
  const styleT = el ? styleTarget(el) : null
  const name = el ? levelName(el.chain, el.level, el.text) : '框选区域'
  const fontPx = el ? pxOf(el.style.fontSize) : null
  const fs = fieldState(el ? styleTargetFor(el, 'fontSize') : null, 'fontSize')
  const fontValue = fs.mode === 'literal' ? splitUnit(fs.value)?.n ?? fontPx : fontPx
  const colorHex = el ? hexOf(el.style.color) : null
  const hasText = Boolean(el?.text)

  return (
    <div ref={ref} className="lve" data-up={pos?.up || undefined} data-stale={stale || undefined}
         style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
         onPointerDown={(e) => e.stopPropagation()}>
      <div className="lve-bar" role="toolbar" aria-label={`${name} 的编辑工具`}>
        {el && (
          <Tip text="选择层级">
            <button type="button" className="lve-btn lve-name" aria-pressed={drawer === 'layers'} onClick={() => toggle('layers')}>
              <UiIcon icon={LayersTwo01} size="xs" />
              <span>{name}</span>
              <UiIcon icon={ChevronDown} size="xs" className="lve-caret" />
            </button>
          </Tip>
        )}
        {el && <i className="lve-sep" aria-hidden="true" />}
        {textT && (
          <Tip text={`文字 · ${textT.label}`}>
            <button type="button" className="lve-btn" aria-label="编辑文字" aria-pressed={drawer === 'text'} onClick={() => toggle('text')}>
              <UiIcon icon={Type01} size="xs" />
            </button>
          </Tip>
        )}
        {el && hasText && (
          <Tip text="字号与排版">
            <button type="button" className="lve-btn lve-val" aria-label="字号与排版" aria-pressed={drawer === 'type'} onClick={() => toggle('type')}>
              <span className="lve-glyph">Aa</span>
              {fontValue != null && <span className="num">{Number(fontValue.toFixed(1))}</span>}
            </button>
          </Tip>
        )}
        {el && (hasText || styleT) && (
          <Tip text="颜色">
            <button type="button" className="lve-btn" aria-label="颜色" aria-pressed={drawer === 'color'} onClick={() => toggle('color')}>
              <i className="lve-dot" style={{ background: el.style.color }} />
              {colorHex && <span className="num lve-hexmini">{colorHex.slice(1)}</span>}
            </button>
          </Tip>
        )}
        {el && <i className="lve-sep" aria-hidden="true" />}
        <Tip text="交给 AI">
          <button type="button" className="lve-btn lve-ai" aria-label="交给 AI" aria-pressed={drawer === 'ai'} onClick={() => toggle('ai')}>
            <UiIcon icon={Stars02} size="xs" />
          </button>
        </Tip>
        {el && (
          <Tip text="详情">
            <button type="button" className="lve-btn" aria-label="详情" aria-pressed={drawer === 'more'} onClick={() => toggle('more')}>
              <UiIcon icon={DotsHorizontal} size="xs" />
            </button>
          </Tip>
        )}
        {live.edits > 0 && (
          <Tip text="撤销上一处修改（⌘Z）">
            <button type="button" className="lve-btn" aria-label="撤销" disabled={stale} onClick={live.undo}>
              <UiIcon icon={FlipBackward} size="xs" />
            </button>
          </Tip>
        )}
        <Tip text="取消选中（Esc）">
          <button type="button" className="lve-btn lve-x" aria-label="取消选中" onClick={live.clearSelection}>
            <UiIcon icon={XClose} size="xs" />
          </button>
        </Tip>
        {stale && <UiIcon icon={SemIcons.loading} size="xs" className="lve-spin" aria-label="正在写回源码" />}
      </div>

      {live.commit.error && (
        <div className="lve-msg" role="alert">
          <span>{live.commit.error.message}</span>
          <button type="button" onClick={live.dismissCommitError} aria-label="知道了"><UiIcon icon={XClose} size="xs" /></button>
        </div>
      )}

      {drawer && (
        <div className="lve-drawer" key={drawer}>
          {drawer === 'layers' && el && <LayersDrawer live={live} />}
          {drawer === 'text' && textT && <TextDrawer live={live} target={textT} disabled={stale} />}
          {drawer === 'type' && el && <TypeDrawer live={live} disabled={stale} onAi={() => setDrawer('ai')} />}
          {drawer === 'color' && el && <ColorDrawer live={live} disabled={stale} onAi={() => setDrawer('ai')} />}
          {drawer === 'ai' && <AiDrawer live={live} onAskAi={onAskAi} busy={busy} />}
          {drawer === 'more' && el && <MoreDrawer live={live} />}
        </div>
      )}
    </div>
  )
}

/* ── 第二级：层级 ── */
function LayersDrawer({ live }: { live: LivePreview }) {
  const el = live.selection?.kind === 'element' ? live.selection.element : null
  if (!el) return null
  const rows = el.chain.map((item, i) => ({ item, i })).reverse()
  return (
    <>
      <div className="lve-head">层级 <span>外 → 内</span></div>
      <div className="lve-list" role="listbox" aria-label="组件层级">
        {rows.map(({ item, i }) => (
          <button key={i} type="button" role="option" aria-selected={i === el.level} className="lve-item"
                  style={{ paddingLeft: 8 + Math.min(rows.length - 1 - rows.findIndex((r) => r.i === i), 6) * 8 }}
                  onClick={() => live.selectLevel(i)}>
            <span className="lve-item-name">{item.name}</span>
            <span className="lve-item-src num">{shortSrc(item.src)}</span>
          </button>
        ))}
      </div>
    </>
  )
}

/* ── 第二级：文字 ── */
function TextDrawer({ live, target, disabled }: { live: LivePreview; target: NonNullable<ReturnType<typeof textTarget>>; disabled: boolean }) {
  const [text, setText] = useState(target.value)
  const changed = text !== target.value
  const apply = () => { if (changed) live.commitEdit({ src: target.src, path: target.path, value: text, expect: target.value, fileHash: target.fileHash }) }
  return (
    <>
      <div className="lve-head">文字 <span>{target.label}</span></div>
      <textarea className="lve-text" value={text} rows={Math.min(5, Math.max(2, text.split('\n').length))} disabled={disabled}
                autoFocus onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); apply() } }} />
      <div className="lve-actions">
        <span className="lve-hint">⌘↵ 应用 · 写回 {shortSrc(target.src)}</span>
        <button type="button" className="lve-ghost" disabled={!changed || disabled} onClick={() => setText(target.value)}>还原</button>
        <button type="button" className="lve-primary" disabled={!changed || disabled} onClick={apply}>应用</button>
      </div>
    </>
  )
}

/** 计算出来的值（变量）：先说明来源，用户确认后才换成固定值 */
function ExprNote({ state, onFix, onAi }: { state: FieldState; onFix?: () => void; onAi?: () => void }) {
  if (state.mode === 'expr') return (
    <span className="lve-expr">
      <code>{state.code}</code>
      {onFix && <button type="button" onClick={onFix}>只改这一处</button>}
      {onAi && <button type="button" onClick={onAi}>交给 AI</button>}
    </span>
  )
  if (state.mode === 'none') return <span className="lve-expr">源码里没有可写的位置{onAi && <button type="button" onClick={onAi}>交给 AI</button>}</span>
  return null
}

/** 一个数值样式：滑杆 + 数字框，按源码里的单位读写 */
function StyleNumber({ live, el, prop, label, computed, range, disabled, onAi }: {
  live: LivePreview; el: NonNullable<ReturnType<typeof elOf>>; prop: string; label: string
  /** 源码里没有时用的计算值，以及它的单位 */
  computed: { n: number; unit: string } | null
  range: Record<string, { min: number; max: number; step: number }>
  disabled: boolean; onAi: () => void
}) {
  const target = styleTargetFor(el, prop)
  const state = fieldState(target, prop)
  const [fixed, setFixed] = useState(false)
  const original = state.mode === 'literal' ? state.value : null
  const parsed = state.mode === 'literal' ? splitUnit(state.value) : computed
  const unit = parsed?.unit ?? ''
  const r = range[unit] ?? range[''] ?? { min: 0, max: 100, step: 1 }
  const editable = Boolean(target) && Boolean(parsed) && (state.mode === 'literal' || state.mode === 'insert' || (state.mode === 'expr' && fixed))
  const n = parsed?.n ?? 0
  const toValue = (v: number) => joinUnit(v, unit, original ?? (unit ? '' : null))
  const preview = (v: number) => { if (target) live.previewStyle(target.level, prop, toValue(v)) }
  const commit = (v: number) => {
    if (!target) return
    const value = toValue(v)
    if (state.mode === 'literal') live.commitEdit({ src: target.src, path: ['style', prop], value, expect: state.value, fileHash: target.fileHash })
    else if (state.mode === 'insert') live.commitEdit({ src: target.src, path: ['style', prop], value, expect: null, fileHash: target.fileHash })
    else if (state.mode === 'expr') live.commitEdit({ src: target.src, path: ['style', prop], value, expect: null, expectCode: state.code, fileHash: target.fileHash })
  }
  return (
    <ParamRow label={label} disabled={!editable}
              note={state.mode === 'expr' && !fixed ? <ExprNote state={state} onFix={() => setFixed(true)} onAi={onAi} /> : state.mode === 'none' || !target ? <ExprNote state={{ mode: 'none' }} onAi={onAi} /> : null}>
      <Slider label={label} value={n} min={Math.min(r.min, n)} max={Math.max(r.max, n)} step={r.step} disabled={disabled || !editable} onInput={preview} onCommit={commit} />
      <ScrubNumber label={label} value={n} min={Math.min(r.min, n)} max={Math.max(r.max, n)} step={r.step} unit={unit || (prop === 'fontSize' ? 'px' : undefined)}
                   disabled={disabled || !editable} onInput={preview} onCommit={commit} />
    </ParamRow>
  )
}

const elOf = (live: LivePreview) => (live.selection?.kind === 'element' ? live.selection.element : null)

/* ── 第二级：字号与排版 ── */
function TypeDrawer({ live, disabled, onAi }: { live: LivePreview; disabled: boolean; onAi: () => void }) {
  const el = elOf(live)
  if (!el) return null
  const target = styleTargetFor(el, 'fontSize')
  const fontPx = pxOf(el.style.fontSize)
  const lhPx = pxOf(el.style.lineHeight)
  const lsPx = pxOf(el.style.letterSpacing)
  const weightTarget = styleTargetFor(el, 'fontWeight')
  const weight = fieldState(weightTarget, 'fontWeight')
  const weightValue = weight.mode === 'literal' ? Number(weight.value) : Number(el.style.fontWeight) || 400
  const weightEditable = Boolean(weightTarget) && weight.mode !== 'none' && weight.mode !== 'expr'
  const commitWeight = (w: number) => {
    if (!weightTarget) return
    if (weight.mode === 'literal') live.commitEdit({ src: weightTarget.src, path: ['style', 'fontWeight'], value: typeof weight.value === 'string' ? String(w) : w, expect: weight.value, fileHash: weightTarget.fileHash })
    else live.commitEdit({ src: weightTarget.src, path: ['style', 'fontWeight'], value: w, expect: null, fileHash: weightTarget.fileHash })
  }
  return (
    <>
      <div className="lve-head">字号与排版 {target ? <span>写回 {target.label}</span> : <span>只读</span>}</div>
      <StyleNumber live={live} el={el} prop="fontSize" label="字号" disabled={disabled} onAi={onAi}
                   computed={fontPx != null ? { n: fontPx, unit: '' } : null}
                   range={{ '': { min: 8, max: 300, step: 1 }, px: { min: 8, max: 300, step: 1 }, em: { min: 0.2, max: 8, step: 0.05 }, rem: { min: 0.2, max: 8, step: 0.05 } }} />
      <StyleNumber live={live} el={el} prop="lineHeight" label="行高" disabled={disabled} onAi={onAi}
                   computed={lhPx != null && fontPx ? { n: Number((lhPx / fontPx).toFixed(2)), unit: '' } : { n: 1.2, unit: '' }}
                   range={{ '': { min: 0.6, max: 3, step: 0.01 }, px: { min: 4, max: 400, step: 1 }, em: { min: 0.6, max: 3, step: 0.01 } }} />
      <StyleNumber live={live} el={el} prop="letterSpacing" label="字距" disabled={disabled} onAi={onAi}
                   computed={{ n: lsPx ?? 0, unit: 'px' }}
                   range={{ em: { min: -0.2, max: 0.5, step: 0.005 }, px: { min: -20, max: 60, step: 0.5 }, '': { min: -20, max: 60, step: 0.5 } }} />
      <ParamRow label="字重" disabled={!weightEditable} note={weight.mode === 'expr' ? <ExprNote state={weight} onAi={onAi} /> : null}>
        <Segmented label="字重" value={weightValue} disabled={disabled || !weightEditable} onChange={commitWeight}
                   options={[300, 400, 500, 600, 700, 800].map((w) => ({ value: w, label: <span className="num">{w}</span>, title: `字重 ${w}` }))} />
      </ParamRow>
    </>
  )
}

/* ── 第二级：颜色 ── */
function ColorDrawer({ live, disabled, onAi }: { live: LivePreview; disabled: boolean; onAi: () => void }) {
  const el = elOf(live)
  if (!el) return null
  const target = styleTargetFor(el, 'color')
  const rows: { prop: string; label: string; computed: string }[] = [{ prop: 'color', label: '文字', computed: el.style.color }]
  if (!/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(el.style.backgroundColor)) rows.push({ prop: 'backgroundColor', label: '底色', computed: el.style.backgroundColor })
  return (
    <>
      <div className="lve-head">颜色 {target ? <span>写回 {target.label}</span> : <span>只读</span>}</div>
      {rows.map((row) => <ColorRow key={row.prop} live={live} target={styleTargetFor(el, row.prop)} {...row} disabled={disabled} onAi={onAi} />)}
    </>
  )
}

function ColorRow({ live, target, prop, label, computed, disabled, onAi }: { live: LivePreview; target: StyleTarget | null; prop: string; label: string; computed: string; disabled: boolean; onAi: () => void }) {
  const state = fieldState(target, prop)
  const [fixed, setFixed] = useState(false)
  const literal = state.mode === 'literal' && typeof state.value === 'string' ? hexOf(state.value) ?? state.value : null
  const value = literal ?? hexOf(computed) ?? computed
  const editable = Boolean(target) && (state.mode === 'literal' || state.mode === 'insert' || (state.mode === 'expr' && fixed))
  const commit = (hex: string) => {
    if (!target) return
    if (state.mode === 'literal') live.commitEdit({ src: target.src, path: ['style', prop], value: hex, expect: state.value, fileHash: target.fileHash })
    else if (state.mode === 'insert') live.commitEdit({ src: target.src, path: ['style', prop], value: hex, expect: null, fileHash: target.fileHash })
    else if (state.mode === 'expr') live.commitEdit({ src: target.src, path: ['style', prop], value: hex, expect: null, expectCode: state.code, fileHash: target.fileHash })
  }
  return (
    <ParamRow label={label} disabled={!editable}
              note={state.mode === 'expr' && !fixed ? <ExprNote state={state} onFix={() => setFixed(true)} onAi={onAi} /> : state.mode === 'none' || !target ? <ExprNote state={{ mode: 'none' }} onAi={onAi} /> : null}>
      <ColorField label={label} value={value} disabled={disabled || !editable}
                  onInput={(hex) => { if (target) live.previewStyle(target.level, prop, hex) }} onCommit={commit} />
    </ParamRow>
  )
}

/* ── 第二级：交给 AI ── */
function AiDrawer({ live, onAskAi, busy }: { live: LivePreview; onAskAi: (prompt: string) => Promise<boolean>; busy: boolean }) {
  const sel = live.selection!
  const [ask, setAsk] = useState('')
  const [sending, setSending] = useState(false)
  const el = sel.kind === 'element' ? sel.element : null
  const fps = live.fps
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const textT = el ? textTarget(el) : null
  const where = el
    ? [
        `画面元素「${levelName(el.chain, el.level, el.text)}」`,
        el.chain[el.level]?.src ? `源码 ${el.chain[el.level]!.src}` : null,
        textT ? `文字来自 ${textT.src} 的 ${textT.path[0] === '#children' ? '元素内文字' : textT.path[0]}「${textT.value}」` : el.text ? `当前文字「${el.text.slice(0, 120)}」` : null,
        el.sequence ? `所在片段 ${el.sequence.name}（${toTimecode(el.sequence.from, fps)}–${toTimecode(el.sequence.from + el.sequence.duration, fps)}）` : `第 ${el.frame} 帧`,
      ].filter(Boolean).join('，')
    : sel.kind === 'region' ? `画面 ${toTimecode(sel.frame, fps)} 的框选区域（x ${pct(sel.rect.x)}、y ${pct(sel.rect.y)}、宽 ${pct(sel.rect.w)}、高 ${pct(sel.rect.h)}）` : ''
  const send = async () => {
    const text = ask.trim()
    if (!text || sending || busy) return
    setSending(true)
    const ok = await onAskAi(`修改${where}。要求：${text}`)
    setSending(false)
    if (ok) live.clearSelection()
  }
  return (
    <>
      <div className="lve-head">交给 AI <span>{el ? `${levelName(el.chain, el.level, el.text)} · ${shortSrc(el.chain[el.level]?.src)}` : '框选区域'}</span></div>
      <div className="lve-ask">
        <textarea value={ask} rows={2} placeholder="告诉 AI 怎么改…" autoFocus disabled={sending}
                  onChange={(e) => setAsk(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
        <button type="button" aria-label="交给 AI" disabled={!ask.trim() || sending || busy} onClick={() => void send()}>
          {sending ? <UiIcon icon={SemIcons.loading} size="xs" className="lve-spin" /> : <UiIcon icon={ArrowUp} size="xs" />}
        </button>
      </div>
      <p className="lve-hint">源码位置和所在片段会一起交过去；{busy ? '有任务正在进行，稍后再发' : '回车发送，Shift+回车换行'}</p>
    </>
  )
}

/** 详情里的一块（第三级）：标题行带摘要值，点开才展开内容 */
function MoreSection({ title, value, children, open, onToggle }: { id: string; title: string; value: ReactNode; children: ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <div className="lve-sec" data-open={open || undefined}>
      <button type="button" className="lve-sec-head" aria-expanded={open} onClick={onToggle}>
        <span>{title}</span><span className="lve-sec-v">{value}</span><UiIcon icon={ChevronDown} size="xs" className="lve-caret" />
      </button>
      {open && <div className="lve-sec-body">{children}</div>}
    </div>
  )
}

/* ── 第二级：详情；里面每一块是第三级，点开才展开 ── */
function MoreDrawer({ live }: { live: LivePreview }) {
  const el = live.selection?.kind === 'element' ? live.selection.element : null
  const [open, setOpen] = useState<string | null>('time')
  const [copied, setCopied] = useState(false)
  if (!el) return null
  const fps = live.fps
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const src = el.chain[el.level]?.src ?? el.src
  const textT = textTarget(el)
  const copy = () => { if (src) void navigator.clipboard?.writeText(src).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200) }) }
  const toggle = (id: string) => setOpen(open === id ? null : id)
  return (
    <>
      <div className="lve-head">详情</div>
      <MoreSection id="time" open={open === 'time'} onToggle={() => toggle('time')} title="时间" value={<span className="num">{el.sequence ? toTimecode(el.sequence.from, fps) : toTimecode(el.frame, fps)}</span>}>
        {el.sequence ? (
          <dl className="lve-dl">
            <div><dt>片段</dt><dd>{el.sequence.name}</dd></div>
            <div><dt>范围</dt><dd className="num">{toTimecode(el.sequence.from, fps)} – {toTimecode(el.sequence.from + el.sequence.duration, fps)}</dd></div>
            <div><dt>当前</dt><dd className="num">{toTimecode(el.frame, fps)} · 第 {el.frame} 帧</dd></div>
          </dl>
        ) : <p className="lve-hint">不在任何片段里 · 第 {el.frame} 帧</p>}
        {el.sequence && <button type="button" className="lve-ghost lve-wide" onClick={() => live.seekFrame(el.sequence!.from)}>跳到片段开头</button>}
      </MoreSection>
      <MoreSection id="box" open={open === 'box'} onToggle={() => toggle('box')} title="位置" value={<span className="num">{pct(el.rect.x)}, {pct(el.rect.y)}</span>}>
        <dl className="lve-dl lve-grid">
          <div><dt>X</dt><dd className="num">{pct(el.rect.x)}</dd></div>
          <div><dt>Y</dt><dd className="num">{pct(el.rect.y)}</dd></div>
          <div><dt>宽</dt><dd className="num">{pct(el.rect.w)}</dd></div>
          <div><dt>高</dt><dd className="num">{pct(el.rect.h)}</dd></div>
        </dl>
      </MoreSection>
      <MoreSection id="src" open={open === 'src'} onToggle={() => toggle('src')} title="源码" value={<span className="num">{shortSrc(src)}</span>}>
        <dl className="lve-dl">
          <div><dt>位置</dt><dd><button type="button" className="lve-link num" onClick={copy}>{src}<UiIcon icon={copied ? SemIcons.check : Copy01} size="xs" /></button></dd></div>
          {textT && textT.src !== src && <div><dt>文字</dt><dd className="num">{textT.label} · {shortSrc(textT.src)}</dd></div>}
          <div><dt>标签</dt><dd className="num">&lt;{el.tag}&gt;</dd></div>
        </dl>
      </MoreSection>
      <MoreSection id="css" open={open === 'css'} onToggle={() => toggle('css')} title="计算样式" value={<UiIcon icon={Code02} size="xs" />}>
        <dl className="lve-dl">
          <div><dt>字体</dt><dd>{el.style.fontFamily.split(',')[0].replace(/"/g, '')}</dd></div>
          <div><dt>字号</dt><dd className="num">{el.style.fontSize} · {el.style.fontWeight}</dd></div>
          <div><dt>行高</dt><dd className="num">{el.style.lineHeight}</dd></div>
          <div><dt>透明</dt><dd className="num">{el.style.opacity}</dd></div>
        </dl>
      </MoreSection>
    </>
  )
}

/**
 * 实时编辑抽屉里的参数控件（工作台规范 §8.6）：参数行小卡、可拖动的数字框、滑杆、分段、取色。
 *
 * <p>拖动 / 滑动时只调 onInput（画面即时预览，不写源码），松手、回车或失焦才调 onCommit。
 * 逐帧、擦洗这类高频操作不加过渡（规范 §7）。</p>
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

/** 参数行：标签 52px 定宽 + 控件 + 数值 */
export function ParamRow({ label, children, note, disabled }: { label: string; children: ReactNode; note?: ReactNode; disabled?: boolean }) {
  return (
    <div className="lve-row" data-disabled={disabled || undefined}>
      <span className="lve-row-k">{label}</span>
      <div className="lve-row-v">{children}</div>
      {note && <div className="lve-row-note">{note}</div>}
    </div>
  )
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const decimals = (step: number) => (String(step).split('.')[1]?.length ?? 0)

/**
 * 数字框：按住左右拖动擦洗（2px = 1 步，按住 Shift ×10），也能直接输入；等宽数字。
 */
export function ScrubNumber({ value, min, max, step, unit, onInput, onCommit, disabled, label }: {
  value: number; min: number; max: number; step: number; unit?: string
  onInput: (n: number) => void; onCommit: (n: number) => void; disabled?: boolean; label: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  /* 草稿也记在 ref 里：回车提交后紧接着失焦，state 还没更新，不能再提交一次 */
  const draftRef = useRef<string | null>(null)
  const drag = useRef<{ x: number; start: number; moved: boolean; last: number } | null>(null)
  const dp = decimals(step)
  const shown = draft ?? value.toFixed(dp)

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (disabled || e.button !== 0 || document.activeElement === e.currentTarget) return
    drag.current = { x: e.clientX, start: value, moved: false, last: value }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 3) return
    d.moved = true
    e.preventDefault()
    const next = clamp(Number((d.start + Math.round(dx / 2) * step * (e.shiftKey ? 10 : 1)).toFixed(dp)), min, max)
    if (next !== d.last) { d.last = next; onInput(next) }
  }
  const onPointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) { onCommit(d.last); e.currentTarget.blur() }
    else e.currentTarget.focus()
  }
  const commitDraft = () => {
    const text = draftRef.current
    if (text === null) return
    draftRef.current = null
    setDraft(null)
    const n = Number(text)
    if (Number.isFinite(n) && n !== value) onCommit(clamp(n, min, max))
  }

  return (
    <label className="lve-num" data-disabled={disabled || undefined}>
      <input
        className="num" aria-label={label} inputMode="decimal" value={shown} disabled={disabled}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onChange={(e) => { draftRef.current = e.target.value; setDraft(e.target.value) }}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitDraft(); e.currentTarget.blur() }
          else if (e.key === 'Escape') { draftRef.current = null; setDraft(null); e.currentTarget.blur() }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const next = clamp(Number((value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)).toFixed(dp)), min, max)
            onCommit(next)
          }
        }}
      />
      {unit && <span className="lve-num-unit">{unit}</span>}
    </label>
  )
}

/** 滑杆：拖动时即时预览，松手写回 */
export function Slider({ value, min, max, step, onInput, onCommit, disabled, label }: {
  value: number; min: number; max: number; step: number
  onInput: (n: number) => void; onCommit: (n: number) => void; disabled?: boolean; label: string
}) {
  const [local, setLocal] = useState<number | null>(null)
  const shown = local ?? value
  const pct = ((clamp(shown, min, max) - min) / (max - min || 1)) * 100
  return (
    <input
      type="range" className="lve-slider" aria-label={label} min={min} max={max} step={step} value={shown} disabled={disabled}
      style={{ '--lve-pct': `${pct}%` } as React.CSSProperties}
      onChange={(e) => { const n = Number(e.target.value); setLocal(n); onInput(n) }}
      onPointerUp={() => { if (local !== null) { onCommit(local); setLocal(null) } }}
      onKeyUp={(e) => { if (local !== null && /Arrow|Page|Home|End/.test(e.key)) { onCommit(local); setLocal(null) } }}
    />
  )
}

/** 分段控件（胶囊）：选中段浮起面 + 轻阴影 + 字重 600 */
export function Segmented<T extends string | number>({ options, value, onChange, disabled, label }: {
  options: { value: T; label: ReactNode; title?: string }[]; value: T | null; onChange: (v: T) => void; disabled?: boolean; label: string
}) {
  return (
    <div className="lve-seg" role="radiogroup" aria-label={label} data-disabled={disabled || undefined}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title}
                disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 取色：色块（点开系统取色器）+ 十六进制输入；取色器拖动时即时预览，关掉或回车写回 */
export function ColorField({ value, onInput, onCommit, disabled, label }: {
  value: string; onInput: (hex: string) => void; onCommit: (hex: string) => void; disabled?: boolean; label: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const picking = useRef<string | null>(null)
  const pickerRef = useRef<HTMLInputElement>(null)
  /* 系统取色器的 change 事件在关闭时才触发：用它写回，input 事件只做预览 */
  useEffect(() => {
    const el = pickerRef.current
    if (!el) return
    const onChange = () => { if (picking.current) { onCommit(picking.current.toUpperCase()); picking.current = null } }
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [onCommit])
  const commitDraft = () => {
    const text = draftRef.current
    if (text === null) return
    draftRef.current = null
    setDraft(null)
    const v = text.trim().replace(/^([0-9a-f]{6})$/i, '#$1')
    if (/^#[0-9a-f]{6}$/i.test(v) && v.toUpperCase() !== value.toUpperCase()) onCommit(v.toUpperCase())
  }
  return (
    <div className="lve-color" data-disabled={disabled || undefined}>
      <label className="lve-swatch" style={{ background: value }} title="打开取色器">
        <input ref={pickerRef} type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#000000'} disabled={disabled}
               onInput={(e) => { picking.current = e.currentTarget.value; onInput(e.currentTarget.value.toUpperCase()) }} />
      </label>
      <input className="lve-hex num" aria-label={`${label}（十六进制）`} value={draft ?? value} disabled={disabled} spellCheck={false}
             onChange={(e) => { draftRef.current = e.target.value; setDraft(e.target.value) }} onBlur={commitDraft}
             onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDraft(); e.currentTarget.blur() } if (e.key === 'Escape') { draftRef.current = null; setDraft(null); e.currentTarget.blur() } }} />
    </div>
  )
}

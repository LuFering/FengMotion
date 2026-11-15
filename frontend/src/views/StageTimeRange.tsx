import { MediaIcon } from '@/components/icons/MediaIcon'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Scissors, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  clampSpan, formatTimecode, parseSpan, spanLengthLabel, type TimeSpan,
} from '@/data/timeRange'

/**
 * 画面内的「按时间段修改」。
 *
 * <p><strong>为什么不做成弹出表单</strong>：这张卡要回答的是「改哪几秒」，
 * 而「这几秒」只有看着画面才指得准。弹层一盖，用户先失去参照，
 * 再在一个和画面无关的输入框里凭空写数字 —— 那是在填表，不是在改片。
 * 所以把两个动作都搬到画面上：<br>
 * 1. 拖：在画面里横向拖出一条时间选区，左右把手可再调；<br>
 * 2. 说：选区下方就地浮出一个小气泡写要求，回车就发。</p>
 *
 * <p><strong>这里是借用画面宽度当时间轴</strong>：画面本来是二维的（宽×高），
 * 选区左右边界直接对应秒数，拖动时实时显示时间码 —— 眼睛不用离开画面。
 * 第一版不做完整时间线编辑器，也不识别画面里有什么元素。</p>
 *
 * <p><strong>不改片段本身</strong>：选区只是「要求 agent 改哪里」的参数，
 * 本地不剪、不跳时间线。若看起来像剪辑操作，用户会以为画面已经变了。</p>
 */

/** 选段状态：开着但还没拖出区间、或已经有一段。 */
export function useStageTimeRange(duration: number) {
  const [active, setActive] = useState(false)
  const [span, setSpan] = useState<TimeSpan | null>(null)
  const limit = duration > 0 ? duration : 0
  const effective = span && limit > 0 ? clampSpan(span, limit) : span
  const reset = useCallback(() => { setActive(false); setSpan(null) }, [])
  return { active, span: effective, limit, setActive, setSpan, reset }
}

/**
 * 覆盖在画面上的选段层。
 *
 * <p>挂在 .fw-stage-frame 里（该元素已是 position: relative），只覆盖画面矩形。
 * 用 absolute 而不是 fixed：画面会随窗口宽度与左栏拖拽而变，
 * fixed 定位一旦滚动或改宽就对不上。</p>
 */
export function StageRangeOverlay({ duration, span, currentTime, onChange, onDone, onCancel }: {
  duration: number
  span: TimeSpan | null
  /** 播放头位置（秒），画一条参考线方便判断「我正看的那一帧在哪」 */
  currentTime: number
  onChange: (span: TimeSpan | null) => void
  /** 拖完/调完，通知上层把气泡定位到这个区间 */
  onDone: (span: TimeSpan) => void
  onCancel: () => void
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ anchor: number } | null>(null)
  const handleRef = useRef<{ edge: 'start' | 'end' } | null>(null)
  const [dragging, setDragging] = useState(false)
  const limit = duration > 0 ? duration : 0

  /** 指针横坐标换算成秒：整幅画面宽度就是整条时间轴。 */
  const secondsAt = (clientX: number): number => {
    const layer = layerRef.current
    if (!layer || limit <= 0) return 0
    const rect = layer.getBoundingClientRect()
    if (rect.width <= 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round(ratio * limit * 1000) / 1000
  }

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (limit <= 0) return
    /* 按在把手上时交给把手处理：否则调左边界会变成「重新拖一个新选区」，
       把用户刚选好的区间冲掉。 */
    if ((e.target as HTMLElement).dataset.handle) return
    /* 指针捕获挂在**层**上，并且只在拖动期间存在。
       早期版本让把手也各自捕获指针：选区一出现，把手正好落在指针下方，
       它把后续 pointermove 抢走，主拖动在半途断掉 —— 实测拖 280px 只走到 22%。
       现在把手只在自己被按下时才捕获（那是另一个用户意图，不冲突）。 */
    e.currentTarget.setPointerCapture(e.pointerId)
    const at = secondsAt(e.clientX)
    dragRef.current = { anchor: at }
    setDragging(true)
    onChange({ start: at, end: at })
  }

  /** 按「锚点 + 当前指针」算选区。拖动与松开都走这一条，避免两处算出不同结果。 */
  const spanFrom = (anchor: number, at: number): TimeSpan => {
    const start = Math.min(anchor, at)
    let end = Math.max(anchor, at)
    /* 最小 0.1 秒：零长度选区既看不见，也不能当修改目标交给 agent。 */
    if (end - start < 0.1) end = Math.min(limit || start + 0.1, start + 0.1)
    return { start, end }
  }

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const anchor = dragRef.current?.anchor
    if (anchor === undefined) return
    onChange(spanFrom(anchor, secondsAt(e.clientX)))
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const anchor = dragRef.current?.anchor
    if (anchor === undefined) return
    dragRef.current = null
    setDragging(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 指针已释放 */ }
    /* 以松开那一刻的坐标定稿，而不是读 state：
       最后一次 pointermove 可能被浏览器丢掉，读 state 会差几个像素。 */
    const final = spanFrom(anchor, secondsAt(e.clientX))
    onChange(final)
    onDone(final)
  }

  /**
   * 把一侧边界挪到指针处。
   *
   * <p>把手只动自己那一侧、并给对面留 0.1 秒，避免左边界越过右边界
   * 把选区长度压成负数。</p>
   */
  const edgeSpan = (edge: 'start' | 'end', at: number): TimeSpan | null => {
    if (!span) return null
    if (edge === 'start') return { start: Math.max(0, Math.min(at, span.end - 0.1)), end: span.end }
    return { start: span.start, end: Math.min(limit || at, Math.max(at, span.start + 0.1)) }
  }

  /* 把手用「window 上的临时监听」而不是 pointer capture：
     早期版本让把手在按下时捕获指针，而选区一出现把手正好落在指针下方，
     后续 move 全被把手吃掉，主拖动在中途断掉（实测拖 280px 只走到 22%）。
     现在把手只在自己真的被按下时才接管，且接管期间不再冒泡给选区层。 */
  const beginHandle = (e: React.PointerEvent<HTMLSpanElement>, edge: 'start' | 'end') => {
    if (!span) return
    e.stopPropagation()
    e.preventDefault()
    handleRef.current = { edge }
    const move = (event: PointerEvent) => {
      const next = edgeSpan(edge, secondsAt(event.clientX))
      if (next) onChange(next)
    }
    const up = (event: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      handleRef.current = null
      const next = edgeSpan(edge, secondsAt(event.clientX))
      if (next && next.end > next.start) onDone(next)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  /* Esc 退出选段：选了又被别处吸引时，直接按掉最省事。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const pct = (seconds: number) => (limit > 0 ? Math.min(1, Math.max(0, seconds / limit)) : 0)
  const hasSpan = Boolean(span && span.end > span.start && limit > 0)

  return (
    <div ref={layerRef} className="wb-sel-layer" data-dragging={dragging || undefined}
         onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
         onPointerCancel={() => { dragRef.current = null; handleRef.current = null; setDragging(false) }}>
      {/* 播放头参考线：让人看得出「我现在看到的是第几秒」，
          选区边界才有参照，而不是对着纯色画面猜位置。 */}
      {limit > 0 && (
        <span className="wb-sel-playhead" style={{ left: `${pct(currentTime) * 100}%` }} aria-hidden="true" />
      )}
      {hasSpan && span && (
        <div className="wb-sel-range" style={{ left: `${pct(span.start) * 100}%`, width: `${(pct(span.end) - pct(span.start)) * 100}%` }}>
          <span className="wb-sel-handle" data-handle="start" role="separator" aria-label="选区开始"
                onPointerDown={(e) => beginHandle(e, 'start')} />
          <span className="wb-sel-handle" data-handle="end" role="separator" aria-label="选区结束"
                onPointerDown={(e) => beginHandle(e, 'end')} />
        </div>
      )}
      {!hasSpan && !dragging && (
        <span className="wb-sel-hint">在画面上左右拖动，选出要改的几秒</span>
      )}
    </div>
  )
}

/**
 * 选区上方的就地输入气泡。
 *
 * <p>为什么不复用侧栏那个输入框：侧栏那条是「对整条片子提意见」，
 * 这里说的是「只改这几秒」。共用一个输入框，用户永远分不清
 * 刚打的那句话作用到全片还是这一小段。</p>
 */
export function StageRangeBubble({ span, duration, baseVersion, baseFile, busy, onSubmit, onCancel, onNudge }: {
  span: TimeSpan
  duration: number
  baseVersion?: number | null
  baseFile?: string | null
  busy: boolean
  onSubmit: (requirement: string) => void
  onCancel: () => void
  /** 用文字直接改选区（有些时间码手写比拖得准） */
  onNudge: (span: TimeSpan) => void
}) {
  const [requirement, setRequirement] = useState('')
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  /* 选区一出现就聚焦：用户刚拖完，手还在鼠标上，这时该能直接打字。 */
  useEffect(() => { inputRef.current?.focus() }, [])

  const applyText = () => {
    const parsed = parseSpan(text)
    if (!parsed.span) { setProblem(parsed.problem); return }
    const clamped = duration > 0 ? clampSpan(parsed.span, duration) : parsed.span
    if (!clamped) { setProblem(`这段时间超出当前画面（${formatTimecode(duration)}），请重新写。`); return }
    onNudge(clamped)
    setProblem(null)
  }

  const send = () => {
    if (!requirement.trim()) { setProblem('写下这几秒要改成什么样。'); return }
    onSubmit(requirement.trim())
  }

  return (
    <div className="wb-sel-bubble" role="dialog" aria-label="这几秒要改成什么">
      <header className="wb-sel-bubble-head">
        <Scissors size={13} />
        <b>{formatTimecode(span.start, true)} – {formatTimecode(span.end, true)}</b>
        <small>{spanLengthLabel(span)}</small>
        <button type="button" className="wb-sel-close" onClick={onCancel} aria-label="取消这次选段"><X size={13} /></button>
      </header>

      <textarea ref={inputRef} className="wb-sel-input" rows={2}
                placeholder="这几秒要改成什么样（回车发送）"
                value={requirement}
                onChange={(e) => { setRequirement(e.target.value); setProblem(null) }}
                onKeyDown={(e) => {
                  /* 回车发送、Shift+回车换行：一句话的要求通常一行就够，
                     要求多按一次回车才能发，会让这个「快速改一段」的入口变慢。 */
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                }} />

      <div className="wb-sel-fine">
        <input className="wb-sel-code" value={text} inputMode="text" placeholder="或写精确时间码，如 0:03–0:06"
               onChange={(e) => setText(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyText() } }}
               onBlur={() => { if (text.trim()) applyText() }} />
        <button type="button" className="wb-sel-apply" disabled={!text.trim()} onClick={applyText}>用这个</button>
      </div>

      {problem && <p className="wb-sel-problem" role="alert">{problem}</p>}

      <footer className="wb-sel-bubble-foot">
        <span className="wb-sel-base" title={baseFile ?? undefined}>
          {baseVersion != null ? `v${baseVersion}` : '当前版本'}
          {baseFile ? ` · ${baseFile}` : ''}
          {busy && <em> · 有修改在进行</em>}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="wb-sel-submit" disabled={busy || !requirement.trim()} onClick={send}>
              修改这段 <CornerDownLeft size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {busy ? '有修改正在进行，等它跑完再发。' : '把这段的时间与要求交给 agent，只改这一段。'}
          </TooltipContent>
        </Tooltip>
      </footer>
    </div>
  )
}

/**
 * 工具栏上的选段入口：单图标 + 悬浮注释。
 *
 * <p>画面上方已有标题、状态和「查看 / 版本对比」，再并一排文字按钮
 * 会把这条横带挤成按钮墙，反而看不出哪个是「改这几秒」。</p>
 */
export function StageRangeTrigger({ active, disabled, onToggle }: {
  active: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="wb-tr-trigger" aria-label="按时间段修改"
                aria-pressed={active} data-active={active || undefined}
                disabled={disabled} onClick={onToggle}>
          <Scissors size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {active ? '退出选段（Esc）' : '按时间段修改：在画面上拖出要改的几秒'}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * 版本切换：在「改之前 / 改之后」之间来回看。
 *
 * <p>不塞进「版本 / 对比」那个已有入口：那边是完整历史与回退，
 * 用户刚改完一段只想确认这几秒对不对，不该被迫先读一遍全部历史。</p>
 */
export function StageVersionSwitch({ versions, currentId, onPick }: {
  versions: { id: string; label: string }[]
  currentId: string
  onPick: (id: string) => void
}) {
  if (versions.length < 2) return null
  const index = versions.findIndex((v) => v.id === currentId)
  if (index < 0) return null
  const next = versions[(index + 1 + versions.length) % versions.length]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="wb-tr-trigger" aria-label="切换修改前后的版本"
                onClick={() => { if (next) onPick(next.id) }}>
          <MediaIcon name="replay" size={18} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        切换修改前后的版本{next ? `：当前 ${versions[index]?.label ?? ''} → ${next.label}` : ''}
      </TooltipContent>
    </Tooltip>
  )
}

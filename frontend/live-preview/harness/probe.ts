/**
 * 预览窗口里的探针：悬停描边、点选、框选，读出真实元素信息报给工作台。
 *
 * 选中框画在预览窗口自己里面（而不是工作台那层）：元素会动、会缩放旋转，
 * 只有在同一个页面里逐帧量 getBoundingClientRect 才对得齐。
 *
 * 元素 → 源码：每个 JSX 元素打包时都被标上 data-fm-src（见 ../annotate.mjs）。
 * 自定义组件收到的同名 prop 留在 React 组件树里，沿 fiber 往上读就是整条「谁调用了谁」的链。
 */
import type { PlayerRef } from '@remotion/player'
import type { LiveChainItem, LiveCommand, LiveElementInfo, LiveRect, LiveSourceInfo } from '../../src/features/workbench/model/livePreviewProtocol'
import { CANVAS_ATTR, SAMPLE_ATTR, post } from './bridge'
import * as registry from './registry'

const DRAG_THRESHOLD = 5
const ACC = '#3b8cf8'

/* React 内部字段：DOM 节点上挂着它对应的 fiber。React 17–19 都是这个前缀 */
export type Fiber = {
  type: unknown
  memoizedProps: Record<string, unknown> | null
  return: Fiber | null
  child: Fiber | null
  sibling: Fiber | null
  stateNode: unknown
}
export function fiberOf(node: Element): Fiber | null {
  const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'))
  return key ? ((node as unknown as Record<string, Fiber>)[key] ?? null) : null
}
/** 可交互组件的显示名是 withInteractivitySchema(AbsoluteFillInner)：还原成用户写的 AbsoluteFill */
function cleanName(name: string): string {
  const inner = /^withInteractivitySchema\((.+)\)$/.exec(name)?.[1] ?? name
  return inner.replace(/^<(.+)>$/, '$1').replace(/Inner$/, '') || name
}
export function nameOf(type: unknown): string {
  return cleanName(rawName(type))
}
function rawName(type: unknown): string {
  if (typeof type === 'string') return type
  const t = type as { displayName?: string; name?: string; render?: { displayName?: string; name?: string }; type?: unknown } | null
  if (!t) return 'Component'
  return t.displayName || t.name || t.render?.displayName || t.render?.name || (t.type ? rawName(t.type) : 'Component')
}
function primitives(props: Record<string, unknown> | null): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  if (!props) return out
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('data-') || key.startsWith('aria-') || /^on[A-Z]/.test(key) || key === 'key' || key === 'ref' || key === 'className') continue
    if (typeof value === 'string') out[key] = value.length > 300 ? `${value.slice(0, 300)}…` : value
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
  }
  return out
}

/**
 * 片段里装的是哪个组件：从片段的外层节点往下找第一个「项目源码里写的」组件（跳过 AbsoluteFill 这类包装）。
 * 片段不在当前时间范围内时没有节点，返回 null，等它出现时再补。
 */
export function componentNameInside(host: Element | null | undefined): string | null {
  if (!host) return null
  const start = fiberOf(host)
  const queue: Fiber[] = start?.child ? [start.child] : []
  let guard = 0
  while (queue.length && guard++ < 300) {
    const f = queue.shift()!
    const src = f.memoizedProps?.['data-fm-src']
    if (src && typeof f.type !== 'string') {
      const name = nameOf(f.type)
      if (name && !/^(AbsoluteFill|Sequence|Series|Fragment|Component)$/.test(name)) return name
    }
    if (f.child) queue.push(f.child)
    if (f.sibling) queue.push(f.sibling)
  }
  return null
}

/**
 * 片段名：沿组件树找到每个 <Sequence>，取它唯一子元素的组件名（<Sequence><Hook/></Sequence> → Hook）。
 * 不在当前时间范围内的片段不渲染子节点，但 props.children 里的元素一直在，所以不用等播到它。
 * 按「局部起点 : 时长」建索引，对应到登记的片段上。
 */
export function sequenceNamesFromTree(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const root = canvas()
  const start = root ? fiberOf(root) : null
  const stack: Fiber[] = start?.child ? [start.child] : []
  let guard = 0
  while (stack.length && guard++ < 8000) {
    const f = stack.pop()!
    if (typeof f.type !== 'string' && /^(Sequence|Series\.Sequence)$/.test(nameOf(f.type))) {
      const props = f.memoizedProps ?? {}
      const child = props.children as { type?: unknown } | null | undefined
      const name = child && typeof child === 'object' && !Array.isArray(child) && child.type && typeof child.type !== 'string'
        ? nameOf(child.type) : null
      if (name && !/^(AbsoluteFill|Sequence|Series|Fragment|Component)$/.test(name)) {
        const key = `${Number(props.from ?? 0)}:${Number(props.durationInFrames ?? Infinity)}`
        out.set(key, [...(out.get(key) ?? []), name])
      }
    }
    if (f.sibling) stack.push(f.sibling)
    if (f.child) stack.push(f.child)
  }
  return out
}

/** 组件链上的一层：fiber + 它在页面上的元素（组件取它最外层的那些 DOM 节点） */
export interface Level { item: LiveChainItem; fiber: Fiber }

export function chainOf(node: Element): Level[] {
  const levels: Level[] = []
  let fiber = fiberOf(node)
  let guard = 0
  while (fiber && guard++ < 400) {
    const props = fiber.memoizedProps
    if (props && (CANVAS_ATTR in props || SAMPLE_ATTR in props)) break
    const src = typeof props?.['data-fm-src'] === 'string' ? (props['data-fm-src'] as string) : null
    if (src && fiber.type && (typeof fiber.type === 'string' || typeof fiber.type === 'function' || typeof fiber.type === 'object')) {
      const prev = levels[levels.length - 1]
      /* 同一处源码可能对应好几层 fiber（forwardRef、memo 包装）：只留最外的 */
      if (prev && prev.item.src === src) {
        prev.fiber = fiber
        if (typeof fiber.type !== 'string') { prev.item.kind = 'component'; prev.item.name = nameOf(fiber.type) }
        Object.assign(prev.item.props, primitives(props))
      } else {
        levels.push({ fiber, item: { name: nameOf(fiber.type), kind: typeof fiber.type === 'string' ? 'host' : 'component', src, props: primitives(props) } })
      }
    }
    fiber = fiber.return
  }
  return levels
}

/** 组件在页面上占的元素：往下找最外层的 DOM 节点（组件可能渲染好几个并列节点） */
export function hostsOf(fiber: Fiber): Element[] {
  if (fiber.stateNode instanceof Element) return [fiber.stateNode]
  const out: Element[] = []
  const walk = (f: Fiber | null) => {
    for (let c = f; c; c = c.sibling) {
      if (c.stateNode instanceof Element) out.push(c.stateNode)
      else walk(c.child)
      if (out.length > 50) return
    }
  }
  walk(fiber.child)
  return out
}

function unionRect(elements: Element[]): DOMRect | null {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
  for (const el of elements) {
    const box = el.getBoundingClientRect()
    if (box.width <= 0 && box.height <= 0) continue
    l = Math.min(l, box.left); t = Math.min(t, box.top); r = Math.max(r, box.right); b = Math.max(b, box.bottom)
  }
  return Number.isFinite(l) ? new DOMRect(l, t, r - l, b - t) : null
}

const canvas = () => document.querySelector(`[${CANVAS_ATTR}]`) as HTMLElement | null

/* ── 预览服务的源码接口（同源 + 令牌，见 ../server.mjs） ── */
const TOKEN = (window as unknown as { __fmToken?: string }).__fmToken ?? ''
async function callApi<T>(route: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fm-token': TOKEN }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error
    throw Object.assign(new Error(err?.message || '源码接口出错'), { code: err?.code ?? 'internal' })
  }
  return data as T
}

/** 刷新后要选回的元素：记最里层的源码位置和层级（源码改了之后，同一个元素的位置不变） */
const RESTORE_KEY = 'fm-live-selection'

/* React 的单位规则：这些样式写数字时不带单位，其余数字按 px */
const UNITLESS = new Set(['lineHeight', 'fontWeight', 'opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'order', 'scale', 'zoom'])
const cssName = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/**
 * 点中的是哪个元素：最近的带源码位置的节点；落在行内小片段上（逐字动画的单个字）时，
 * 往上找到第一个块级的那层 —— 点一个字选中一个字没有意义，用户要的是那一行标题。
 */
function pickElement(target: Element): Element | null {
  const root = canvas()
  let el = target.closest('[data-fm-src]')
  if (!el || !root || !root.contains(el)) return null
  for (let guard = 0; guard < 20; guard++) {
    const display = getComputedStyle(el).display
    const parent: Element | null = el.parentElement?.closest('[data-fm-src]') ?? null
    if (!parent || !root.contains(parent) || !display.startsWith('inline')) break
    if ((parent.textContent ?? '').trim().length > 400) break
    el = parent
  }
  return el
}

function normalize(box: DOMRect): LiveRect | null {
  const root = canvas()?.getBoundingClientRect()
  if (!root || root.width <= 0 || root.height <= 0) return null
  return { x: (box.left - root.left) / root.width, y: (box.top - root.top) / root.height, w: box.width / root.width, h: box.height / root.height }
}

/** 包住元素的最内层片段 */
function sequenceOf(el: Element) {
  let best: registry.SequenceEntry | null = null
  let bestDepth = -1
  for (const seq of registry.getSequences().values()) {
    if (!registry.isTimelineSequence(seq)) continue
    const host = seq.refForOutline?.current
    if (!host || !host.contains(el)) continue
    let depth = 0
    for (let n: Element | null = host; n; n = n.parentElement) depth++
    if (depth > bestDepth) { best = seq; bestDepth = depth }
  }
  return best && { id: best.id, parent: best.parent, name: registry.displayNameOf(best.id) ?? registry.sequenceName(best), type: best.type, from: registry.absoluteFrom(best), duration: best.duration }
}

/* ── 叠加层：悬停框、选中框、框选 ── */
function makeOverlay() {
  const style = document.createElement('style')
  style.textContent = `
.fmp-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none}
.fmp-box{position:fixed;box-sizing:border-box;border-radius:3px;display:none}
.fmp-hover{border:1px dashed rgba(255,255,255,.85);box-shadow:0 0 0 1px rgba(0,0,0,.35);background:rgba(255,255,255,.05)}
.fmp-sel{border:1.5px solid ${ACC};background:rgba(59,140,248,.08);box-shadow:0 0 0 1px rgba(0,0,0,.3),0 0 0 4px rgba(59,140,248,.18)}
.fmp-sel i{position:absolute;width:7px;height:7px;border:1.5px solid ${ACC};border-radius:1.5px;background:#fff}
.fmp-sel i:nth-child(1){top:-4.5px;left:-4.5px}.fmp-sel i:nth-child(2){top:-4.5px;right:-4.5px}
.fmp-sel i:nth-child(3){bottom:-4.5px;left:-4.5px}.fmp-sel i:nth-child(4){bottom:-4.5px;right:-4.5px}
.fmp-tag{position:absolute;bottom:calc(100% + 4px);left:-1px;max-width:260px;overflow:hidden;padding:1px 6px;border-radius:4px;background:rgba(15,16,20,.85);color:#fff;font:500 11px/16px Inter,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;white-space:nowrap;text-overflow:ellipsis}
.fmp-sel .fmp-tag{background:${ACC}}
.fmp-region{border:1.5px dashed ${ACC};background:rgba(59,140,248,.1)}
.fmp-hint{position:fixed;top:10px;left:10px;padding:3px 9px;border-radius:999px;background:rgba(15,16,20,.66);color:rgba(255,255,255,.92);font:11px/16px Inter,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;opacity:0;transition:opacity .16s}
html:hover .fmp-hint.on{opacity:1}`
  document.head.appendChild(style)
  const layer = document.createElement('div')
  layer.className = 'fmp-layer'
  const hover = document.createElement('div'); hover.className = 'fmp-box fmp-hover'
  const hoverTag = document.createElement('span'); hoverTag.className = 'fmp-tag'; hover.appendChild(hoverTag)
  const sel = document.createElement('div'); sel.className = 'fmp-box fmp-sel'
  sel.innerHTML = '<i></i><i></i><i></i><i></i>'
  const region = document.createElement('div'); region.className = 'fmp-box fmp-region'
  const hint = document.createElement('div'); hint.className = 'fmp-hint'; hint.textContent = '点选元素编辑 · 拖拽框选区域'
  layer.append(hover, sel, region, hint)
  document.body.appendChild(layer)
  const place = (el: HTMLElement, box: DOMRect | null) => {
    if (!box || box.width <= 0 || box.height <= 0) { el.style.display = 'none'; return }
    el.style.display = 'block'
    el.style.left = `${box.left}px`; el.style.top = `${box.top}px`
    el.style.width = `${box.width}px`; el.style.height = `${box.height}px`
  }
  return { layer, hover, hoverTag, sel, region, hint, place, style }
}

/** 选中框上的名字：最近的组件名，后面跟一小段文字 */
function labelOf(levels: Level[], level: number, el: Element | null) {
  const item = levels[level]?.item
  const comp = levels.slice(level).find((l) => l.item.kind === 'component')?.item
  const name = item?.kind === 'component' ? item.name : comp?.name ?? item?.name ?? el?.tagName.toLowerCase() ?? '元素'
  const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text ? `${name} · ${text.length > 18 ? `${text.slice(0, 18)}…` : text}` : name
}

export function installProbe({ player, fps, durationInFrames }: { player: PlayerRef; fps: number; durationInFrames: number }) {
  const ui = makeOverlay()
  let press: { x: number; y: number; pointerId: number; dragging: boolean; startNorm: { x: number; y: number } } | null = null
  /* 当前选中：组件链 + 选中的层级；每帧重新量位置 */
  let selection: { levels: Level[]; level: number; host: Element } | null = null
  let raf = 0

  const playing = () => player.isPlaying()
  ui.hint.classList.toggle('on', !playing())

  const describe = (levels: Level[], level: number, host: Element): LiveElementInfo | null => {
    const fiber = levels[level]?.fiber
    const hosts = fiber ? hostsOf(fiber) : [host]
    const box = unionRect(hosts.length ? hosts : [host])
    const rect = box && normalize(box)
    if (!rect) return null
    const first = (hosts[0] ?? host) as HTMLElement
    const cs = getComputedStyle(first)
    const text = hosts.map((h) => h.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim()
    return {
      src: levels[level]?.item.src ?? host.getAttribute('data-fm-src'),
      tag: first.tagName.toLowerCase(),
      chain: levels.map((l) => l.item),
      text: text.length > 400 ? `${text.slice(0, 400)}…` : text,
      style: {
        fontSize: cs.fontSize, fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, color: cs.color,
        lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, opacity: cs.opacity, textAlign: cs.textAlign,
        backgroundColor: cs.backgroundColor,
      },
      rect,
      box: { x: box!.left, y: box!.top, w: box!.width, h: box!.height },
      level,
      sequence: sequenceOf(first),
      frame: player.getCurrentFrame(),
    }
  }

  /** 读出组件链上每一层在源码里写死的属性，挂到链上 */
  const withSource = async (levels: Level[]) => {
    const srcs = [...new Set(levels.map((l) => l.item.src).filter((s): s is string => Boolean(s)))]
    if (srcs.length === 0) return
    try {
      const { elements } = await callApi<{ elements: Record<string, LiveSourceInfo | null> }>('inspect', { srcs })
      for (const l of levels) l.item.source = l.item.src ? elements[l.item.src] ?? null : null
    } catch { /* 读不到就只能看、不能改 */ }
  }

  let lastBox = ''
  const track = () => {
    cancelAnimationFrame(raf)
    const step = () => {
      if (selection) {
        const fiber = selection.levels[selection.level]?.fiber
        const hosts = fiber ? hostsOf(fiber) : [selection.host]
        const box = unionRect(hosts.length ? hosts : [selection.host])
        ui.place(ui.sel, box)
        if (box) {
          const key = `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}`
          if (key !== lastBox) { lastBox = key; post({ type: 'selection-box', box: { x: box.left, y: box.top, w: box.width, h: box.height } }) }
        }
        raf = requestAnimationFrame(step)
      }
    }
    raf = requestAnimationFrame(step)
  }

  let selectSeq = 0
  const select = async (host: Element, clientX: number, clientY: number, level = 0) => {
    resetPreview()
    const levels = chainOf(host)
    const mine = ++selectSeq
    selection = { levels, level: Math.min(level, Math.max(0, levels.length - 1)), host }
    ui.hover.style.display = 'none'
    lastBox = ''
    track()
    await withSource(levels)
    if (mine !== selectSeq || !selection) return
    const info = describe(levels, selection.level, host)
    if (!info) { clear(); return }
    remember()
    post({ type: 'select', element: info, client: { x: clientX, y: clientY } })
  }

  const remember = () => {
    if (!selection) { sessionStorage.removeItem(RESTORE_KEY); return }
    const src = selection.levels[0]?.item.src ?? selection.host.getAttribute('data-fm-src')
    if (src) sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ src, level: selection.level }))
  }

  /* ── 拖动中的即时预览：直接改那几个节点的行内样式，松手写回源码后整页刷新 ── */
  const overrides = new Map<HTMLElement, Map<string, string>>()
  const previewStyle = (level: number, key: string, value: string | number) => {
    if (!selection) return
    const fiber = selection.levels[level]?.fiber
    const hosts = (fiber ? hostsOf(fiber) : [selection.host]) as HTMLElement[]
    const css = cssName(key)
    const text = typeof value === 'number' && !UNITLESS.has(key) ? `${value}px` : String(value)
    for (const el of hosts) {
      if (!(el instanceof HTMLElement)) continue
      let saved = overrides.get(el)
      if (!saved) { saved = new Map(); overrides.set(el, saved) }
      if (!saved.has(css)) saved.set(css, el.style.getPropertyValue(css))
      el.style.setProperty(css, text)
    }
  }
  const resetPreview = () => {
    for (const [el, saved] of overrides) for (const [css, value] of saved) {
      if (value) el.style.setProperty(css, value); else el.style.removeProperty(css)
    }
    overrides.clear()
  }

  const commit = async (cmd: Extract<LiveCommand, { type: 'commit' }>) => {
    try {
      const result = await callApi<{ edits: number; changed: boolean }>('edit', {
        src: cmd.src, path: cmd.path, value: cmd.value, expect: cmd.expect, expectCode: cmd.expectCode ?? null, fileHash: cmd.fileHash,
      })
      remember()
      /* 源码变了预览服务会重建并通知刷新；没变化就把预览撤掉 */
      if (!result.changed) resetPreview()
      post({ type: 'commit-result', ok: true, edits: result.edits, changed: result.changed })
    } catch (error) {
      resetPreview()
      const e = error as { code?: string; message?: string }
      post({ type: 'commit-result', ok: false, code: e.code, message: e.message, edits: -1 })
    }
  }
  const undo = async () => {
    try {
      const result = await callApi<{ edits: number }>('undo', {})
      remember()
      post({ type: 'commit-result', ok: true, edits: result.edits, changed: true })
    } catch (error) {
      const e = error as { code?: string; message?: string }
      post({ type: 'commit-result', ok: false, code: e.code, message: e.message, edits: -1 })
    }
  }
  void callApi<{ edits: number }>('state', {}).then((r) => post({ type: 'edits', edits: r.edits })).catch(() => undefined)

  /* 刷新后选回刚才的元素：源码改完整页刷新，用户不该每改一次都要重新点一遍 */
  const restore = () => {
    const saved = sessionStorage.getItem(RESTORE_KEY)
    if (!saved) return
    let target: { src: string; level: number }
    try { target = JSON.parse(saved) } catch { return }
    let tries = 0
    const attempt = () => {
      const el = document.querySelector(`[data-fm-src="${CSS.escape(target.src)}"]`)
      if (el && el.getBoundingClientRect().width > 0) {
        const box = el.getBoundingClientRect()
        void select(el, box.right, box.top, target.level)
        return
      }
      if (tries++ < 40) requestAnimationFrame(attempt)
    }
    requestAnimationFrame(attempt)
  }
  restore()

  const clear = (silent = false) => {
    resetPreview()
    selectSeq++
    selection = null
    sessionStorage.removeItem(RESTORE_KEY)
    cancelAnimationFrame(raf)
    ui.sel.style.display = 'none'
    ui.region.style.display = 'none'
    if (!silent) post({ type: 'deselect' })
  }

  const inCanvas = (x: number, y: number) => {
    const box = canvas()?.getBoundingClientRect()
    return Boolean(box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)
  }
  const normAt = (x: number, y: number) => {
    const box = canvas()!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (x - box.left) / box.width)), y: Math.min(1, Math.max(0, (y - box.top) / box.height)) }
  }

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    if (!inCanvas(e.clientX, e.clientY)) { if (selection) clear(); return }
    e.preventDefault()
    e.stopPropagation()
    press = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false, startNorm: normAt(e.clientX, e.clientY) }
    /* 拿不到指针（极少数合成事件）也不影响点选 */
    try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch { /* 忽略 */ }
  }
  const onMove = (e: PointerEvent) => {
    if (press && press.pointerId === e.pointerId) {
      if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD) {
        press.dragging = true
        if (playing()) player.pause()
        clear(true)
        ui.hover.style.display = 'none'
      }
      if (press.dragging) {
        ui.place(ui.region, new DOMRect(Math.min(press.x, e.clientX), Math.min(press.y, e.clientY), Math.abs(e.clientX - press.x), Math.abs(e.clientY - press.y)))
      }
      return
    }
    if (playing() || !inCanvas(e.clientX, e.clientY)) { ui.hover.style.display = 'none'; return }
    const target = document.elementFromPoint(e.clientX, e.clientY)
    const el = target ? pickElement(target) : null
    if (!el || (selection && selection.host === el && selection.level === 0)) { ui.hover.style.display = 'none'; return }
    ui.hoverTag.textContent = labelOf(chainOf(el), 0, el)
    ui.place(ui.hover, el.getBoundingClientRect())
  }
  const onUp = (e: PointerEvent) => {
    const p = press
    if (!p || p.pointerId !== e.pointerId) return
    press = null
    e.preventDefault()
    e.stopPropagation()
    if (playing()) player.pause()
    if (p.dragging) {
      const end = normAt(e.clientX, e.clientY)
      const rect = { x: Math.min(p.startNorm.x, end.x), y: Math.min(p.startNorm.y, end.y), w: Math.abs(end.x - p.startNorm.x), h: Math.abs(end.y - p.startNorm.y) }
      if (rect.w < 0.01 || rect.h < 0.01) { ui.region.style.display = 'none'; return }
      post({ type: 'region', rect, frame: player.getCurrentFrame(), client: { x: e.clientX, y: e.clientY } })
      return
    }
    ui.region.style.display = 'none'
    /* 选择框盖在画面上，量的时候先让它让开 */
    ui.layer.style.display = 'none'
    const target = document.elementFromPoint(e.clientX, e.clientY)
    ui.layer.style.display = ''
    const el = target ? pickElement(target) : null
    if (el) select(el, e.clientX, e.clientY)
    else clear()
  }
  const onClick = (e: MouseEvent) => { if (inCanvas(e.clientX, e.clientY)) { e.preventDefault(); e.stopPropagation() } }
  const onLeave = () => { ui.hover.style.display = 'none' }

  const onKey = (e: KeyboardEvent) => {
    const editing = (e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')
    if (editing) return
    if (e.key === 'Escape') { clear(); post({ type: 'escape' }); return }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); void undo(); return }
    if (e.code === 'Space') { e.preventDefault(); player.toggle(); return }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const step = (e.shiftKey ? Math.round(fps) : 1) * (e.key === 'ArrowLeft' ? -1 : 1)
      player.pause()
      player.seekTo(Math.max(0, Math.min(durationInFrames - 1, player.getCurrentFrame() + step)))
    }
  }

  const onState = () => {
    const isPlaying = playing()
    ui.hint.classList.toggle('on', !isPlaying)
    if (isPlaying) { ui.hover.style.display = 'none'; if (selection) clear() }
  }

  const onMessage = (e: MessageEvent) => {
    if (e.source !== window.parent) return
    const cmd = e.data as LiveCommand
    if (!cmd || cmd.fm !== 'live') return
    if (cmd.type === 'clear-selection') clear(true)
    else if (cmd.type === 'select-level' && selection) {
      resetPreview()
      selection.level = Math.max(0, Math.min(cmd.level, selection.levels.length - 1))
      const info = describe(selection.levels, selection.level, selection.host)
      if (!info) return
      lastBox = ''
      remember()
      post({ type: 'select', element: info, client: { x: info.box.x + info.box.w, y: info.box.y } })
    }
    else if (cmd.type === 'preview-style') previewStyle(cmd.level, cmd.key, cmd.value)
    else if (cmd.type === 'preview-reset') resetPreview()
    else if (cmd.type === 'commit') void commit(cmd)
    else if (cmd.type === 'undo') void undo()
    else if (cmd.type === 'select-src') {
      /* 从轨道选元素：跳到它出现的那一帧，等画面更新后找到它（组件调用处没有自己的节点，就找链上含它的那个） */
      player.pause()
      player.seekTo(Math.max(0, Math.min(durationInFrames - 1, cmd.frame)))
      let tries = 0
      const find = () => {
        const root = canvas()
        const direct = root?.querySelector(`[data-fm-src="${CSS.escape(cmd.src)}"]`)
        let el: Element | null = direct && direct.getBoundingClientRect().width > 0 ? direct : null
        let level = 0
        if (!el && root) {
          for (const node of root.querySelectorAll('[data-fm-src]')) {
            if (node.getBoundingClientRect().width <= 0) continue
            const i = chainOf(node).findIndex((l) => l.item.src === cmd.src)
            if (i >= 0) { el = node; level = i; break }
          }
        }
        if (el) {
          const box = el.getBoundingClientRect()
          void select(el, box.right, box.top, level)
          return
        }
        if (tries++ < 12) requestAnimationFrame(find)
      }
      requestAnimationFrame(() => requestAnimationFrame(find))
    }
  }

  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('pointermove', onMove, true)
  document.addEventListener('pointerup', onUp, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('pointerleave', onLeave)
  window.addEventListener('keydown', onKey)
  window.addEventListener('message', onMessage)
  player.addEventListener('play', onState)
  player.addEventListener('pause', onState)
  return () => {
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('pointermove', onMove, true)
    document.removeEventListener('pointerup', onUp, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('pointerleave', onLeave)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('message', onMessage)
    player.removeEventListener('play', onState)
    player.removeEventListener('pause', onState)
    cancelAnimationFrame(raf)
    ui.layer.remove()
    ui.style.remove()
  }
}

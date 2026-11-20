/**
 * 实时画面元素编辑的纯计算：选中的元素哪些属性能改、改动写回源码哪一层、数值和单位怎么拆。
 *
 * <p>依据预览服务读出的「源码里写死了什么」（LiveSourceInfo）：只有字面量能直接改；
 * 样式写在组件链上第一层带 style 对象字面量的地方（例如 coffee 的标题，样式写在调用处
 * `<Chars style={{ fontSize: 106 }}>`，而不是 Chars 内部的 div）。</p>
 */
import type { LiveChainItem, LiveElementInfo, LiveSourceInfo, LiveSourceValue } from '@/features/workbench/model/livePreviewProtocol'

export interface TextTarget {
  level: number
  src: string
  /** ['text'] 之类的属性，或 ['#children'] = 元素里的文字 */
  path: string[]
  value: string
  fileHash: string
  /** 给人看的出处：「Chars 的 text」 */
  label: string
}

export interface StyleTarget {
  level: number
  src: string
  props: Record<string, LiveSourceValue | null>
  fileHash: string
  label: string
}

const norm = (s: string) => s.replace(/\s+/g, '')

/**
 * 文字写在哪：从当前层往外找，第一个「写死的字符串属性，且就是画面上那段字」的地方；
 * 找不到再看元素里是不是只有一段纯文字。
 */
export function textTarget(el: LiveElementInfo, from = el.level): TextTarget | null {
  const shown = norm(el.text)
  for (let i = from; i < el.chain.length; i++) {
    const item = el.chain[i]
    const source = item.source
    if (!source || !item.src) continue
    for (const [key, value] of Object.entries(source.attrs)) {
      if (value.kind !== 'string' || /^(className|id|src|href|key|style)$/.test(key)) continue
      const text = norm(value.value)
      if (text && shown && (shown.includes(text) || text.includes(shown))) {
        return { level: i, src: item.src, path: [key], value: value.value, fileHash: source.fileHash, label: `${item.name} 的 ${key}` }
      }
    }
    if (source.children && norm(source.children.value) && shown.includes(norm(source.children.value))) {
      return { level: i, src: item.src, path: ['#children'], value: source.children.value, fileHash: source.fileHash, label: `${item.name} 里的文字` }
    }
  }
  return null
}

function styleAt(el: LiveElementInfo, i: number): StyleTarget | null {
  const item = el.chain[i]
  const style = item?.source?.attrs.style
  if (!item?.src || !item.source || style?.kind !== 'object') return null
  return { level: i, src: item.src, props: style.props, fileHash: item.source.fileHash, label: `${item.name} 的 style` }
}

/**
 * 某一项样式写在哪：
 * 1. 从当前层往外，第一层 style 对象里已经有这一项的 —— 改它；
 * 2. 都没有就新增：优先写在「组件的调用处」（例如 <Chars style={{…}}>），
 *    而不是组件定义内部的节点 —— 那里改一下，所有用到这个组件的地方都会变；
 * 3. 再没有，才落到最近一层带 style 对象的页面节点。
 */
export function styleTargetFor(el: LiveElementInfo, key: string, from = el.level): StyleTarget | null {
  for (let i = from; i < el.chain.length; i++) {
    const t = styleAt(el, i)
    if (t && key in t.props) return t
  }
  for (let i = from; i < el.chain.length; i++) {
    if (el.chain[i].kind !== 'component') continue
    const t = styleAt(el, i)
    if (t) return t
  }
  for (let i = from; i < el.chain.length; i++) {
    const t = styleAt(el, i)
    if (t) return t
  }
  return null
}

/** 有没有任何一层能写样式（决定工具条上颜色、排版按钮可不可改） */
export function styleTarget(el: LiveElementInfo, from = el.level): StyleTarget | null {
  return styleTargetFor(el, 'fontSize', from)
}

export type FieldState =
  /** 写死的值：直接改 */
  | { mode: 'literal'; value: string | number }
  /** style 对象里没有这一项：改了就新增 */
  | { mode: 'insert' }
  /** 计算出来的（变量、表达式）：可以选择换成固定值 */
  | { mode: 'expr'; code: string }
  /** 没有能写的地方：只能看，或交给 AI */
  | { mode: 'none' }

export function fieldState(target: StyleTarget | null, key: string): FieldState {
  if (!target) return { mode: 'none' }
  const v = target.props[key]
  if (v === undefined) return { mode: 'insert' }
  if (!v) return { mode: 'none' }
  if (v.kind === 'string' || v.kind === 'number') return { mode: 'literal', value: v.value }
  if (v.kind === 'expr') return { mode: 'expr', code: v.code }
  return { mode: 'none' }
}

/** '-0.01em' → { n: -0.01, unit: 'em' }；106 → { n: 106, unit: '' }；拆不开返回 null */
export function splitUnit(value: string | number): { n: number; unit: string } | null {
  if (typeof value === 'number') return Number.isFinite(value) ? { n: value, unit: '' } : null
  const m = /^\s*(-?\d*\.?\d+)\s*(px|em|rem|%|vw|vh)?\s*$/.exec(value)
  return m ? { n: Number(m[1]), unit: m[2] ?? '' } : null
}

/** 计算样式的像素值（'106px'）→ 数字 */
export function pxOf(value: string): number | null {
  const m = /^(-?\d*\.?\d+)px$/.exec(value.trim())
  return m ? Number(m[1]) : null
}

/** 写回时的值：原来是数字就写数字；带单位的字符串保留单位 */
export function joinUnit(n: number, unit: string, original: string | number | null): string | number {
  const rounded = Number(n.toFixed(4))
  if (typeof original === 'number' || (!unit && original === null)) return rounded
  return `${rounded}${unit}`
}

/** rgb(244, 238, 228) / #f4eee4 → #F4EEE4；带透明度的返回 null */
export function hexOf(color: string): string | null {
  const s = color.trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase()
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s.slice(1).split('').map((c) => c + c).join('')}`.toUpperCase()
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(s)
  if (!m || (m[4] !== undefined && Number(m[4]) < 1)) return null
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** 帧号 → MM:SS:FF（工作台规范的时间码） */
export function toTimecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame))
  const rate = Math.max(1, Math.round(fps))
  const totalSeconds = Math.floor(f / rate)
  const ff = f % rate
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`
}

/** 只管排版、分段的壳组件：当名字没有意义 */
const STRUCTURAL = /^(AbsoluteFill|Sequence|Series|Fragment|Freeze|Loop)$/

/**
 * 工具条上的名字：这一层是组件就用组件名；是页面节点时，外面最近的「有意义的」组件名，
 * 中间隔着排版壳（AbsoluteFill）时改用节点里的文字 —— 「30 ml」比「AbsoluteFill」好认。
 */
export function levelName(chain: LiveChainItem[], level: number, text = ''): string {
  const item = chain[level]
  if (!item) return '元素'
  if (item.kind === 'component') return item.name
  for (const c of chain.slice(level + 1)) {
    if (c.kind !== 'component') continue
    if (STRUCTURAL.test(c.name)) break
    return c.name
  }
  const t = text.replace(/\s+/g, ' ').trim()
  return t ? (t.length > 12 ? `${t.slice(0, 12)}…` : t) : item.name
}

/** 这一层的源码位置写成短的：Coffee.tsx:170 */
export function shortSrc(src: string | null | undefined): string {
  if (!src) return ''
  const m = /([^/\\]+):(\d+):\d+$/.exec(src)
  return m ? `${m[1]}:${m[2]}` : src
}

export type { LiveSourceInfo }

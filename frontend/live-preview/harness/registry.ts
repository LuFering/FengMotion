/**
 * 预览壳的登记处：项目入口调用的 registerRoot、Root 里渲染的 <Composition>、
 * 播放时登记的片段（Sequence），都记在这里，供预览壳与探针读取。
 *
 * 由 remotion 薄壳（server.mjs 里的 fm:remotion-shim）与预览壳共用；只有这一个实例。
 */
import type { ComponentType } from 'react'

type Listener = () => void
const listeners = new Set<Listener>()
const notify = () => { for (const fn of listeners) fn() }
export function subscribe(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn) } }

/* ── 根组件 ── */
let root: ComponentType | null = null
export function setRoot(component: ComponentType) { root = component; notify() }
export function getRoot() { return root }

/* ── Composition ── */
export interface CompositionEntry {
  id: string
  component?: ComponentType<Record<string, unknown>>
  lazyComponent?: () => Promise<{ default: ComponentType<Record<string, unknown>> }>
  durationInFrames?: number
  fps?: number
  width?: number
  height?: number
  defaultProps?: Record<string, unknown>
  calculateMetadata?: (args: { defaultProps: Record<string, unknown>; props: Record<string, unknown>; abortSignal: AbortSignal; compositionId: string }) => Promise<Record<string, unknown>> | Record<string, unknown>
}
let compositions = new Map<string, CompositionEntry>()
export function registerComposition(props: CompositionEntry) {
  const prev = compositions.get(props.id)
  /* 按内容去重：Root 每次重渲染都会再登记一遍，内容没变就不通知，免得来回刷新 */
  if (prev && prev.component === props.component && prev.lazyComponent === props.lazyComponent
    && prev.durationInFrames === props.durationInFrames && prev.fps === props.fps
    && prev.width === props.width && prev.height === props.height
    && prev.defaultProps === props.defaultProps && prev.calculateMetadata === props.calculateMetadata) return
  compositions = new Map(compositions).set(props.id, { ...props })
  notify()
}
export function unregisterComposition(id: string) {
  if (!compositions.has(id)) return
  compositions = new Map(compositions)
  compositions.delete(id)
  notify()
}
export function getCompositions() { return compositions }

/* ── 片段（播放时由 Sequence 登记，探针用它找「这个元素属于哪一段」） ── */
export interface SequenceEntry {
  id: string
  parent: string | null
  displayName?: string
  type: string
  from: number
  duration: number
  refForOutline?: { current: HTMLElement | null } | null
  showInTimeline?: boolean
  singleChildComponent?: { displayName?: string; name?: string } | null
}
const sequences = new Map<string, SequenceEntry>()
const sequenceListeners = new Set<Listener>()
export function onSequencesChange(fn: Listener) { sequenceListeners.add(fn); return () => { sequenceListeners.delete(fn) } }
export function registerSequence(seq: SequenceEntry) { sequences.set(seq.id, seq); for (const fn of sequenceListeners) fn() }
export function unregisterSequence(id: string) { sequences.delete(id); for (const fn of sequenceListeners) fn() }
export function getSequences() { return sequences }

/**
 * 是不是用户意义上的「片段」：Remotion 4.0.519 的可交互组件（<AbsoluteFill>、<Interactive.Div>…）
 * 也会登记成 sequence，供 Studio 选中描边用；它们不是时间上的分段，不进轨道。媒体（视频、音频、图片）保留。
 */
export function isTimelineSequence(seq: SequenceEntry): boolean {
  if (seq.showInTimeline === false) return false
  if (seq.type !== 'sequence') return true
  return !(seq.displayName ?? '').startsWith('<')
}

/** 片段名：没起名字的用它唯一的子组件名（<Sequence><Hook/></Sequence> → Hook），同出片时的轨道采集 */
export function sequenceName(seq: SequenceEntry): string {
  return seq.displayName || seq.singleChildComponent?.displayName || seq.singleChildComponent?.name || '片段'
}

/* 补到的片段名（来自组件树，见 probe.sequenceNamesFromTree）：轨道与属性小窗共用 */
const names = new Map<string, string>()
export function setDisplayName(id: string, name: string) { names.set(id, name) }
export function displayNameOf(id: string) { return names.get(id) }

/** 片段的绝对起点：Remotion 登记的 from 相对父片段，要沿父链累加 */
export function absoluteFrom(seq: SequenceEntry): number {
  let from = seq.from
  let parent = seq.parent ? sequences.get(seq.parent) : undefined
  let guard = 0
  while (parent && guard++ < 50) {
    from += parent.from
    parent = parent.parent ? sequences.get(parent.parent) : undefined
  }
  return from
}

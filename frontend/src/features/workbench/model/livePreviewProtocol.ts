/**
 * 工作台 ⇄ 实时预览窗口（iframe）之间的消息格式。
 *
 * <p>预览窗口在另一个来源里运行项目源码，两边只靠 postMessage 说话。
 * 消息都带 `fm: 'live'` 标记，别的来源发来的消息一律忽略。
 * 预览壳（frontend/live-preview/harness）只以类型方式引用本文件，不打包它。</p>
 */

/** 画布归一化矩形：相对整个画面，0–1 */
export interface LiveRect { x: number; y: number; w: number; h: number }

/** 源码里一个值的样子：字面量可以直接改；表达式（变量、计算）只能看 */
export type LiveSourceValue =
  | { kind: 'string'; value: string; quote?: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'expr'; code: string }
  | { kind: 'object'; props: Record<string, LiveSourceValue | null>; code: string }

/** 这一层在源码里写死了什么（预览服务按 data-fm-src 读出来） */
export interface LiveSourceInfo {
  /** 元素名（div / Chars） */
  name: string
  attrs: Record<string, LiveSourceValue>
  /** 元素里只有一段文字时 */
  children: { kind: 'text'; value: string } | null
  file: string
  /** 读的时候文件的指纹，写回时带上，文件变了就拒绝 */
  fileHash: string
}

/** 组件链上的一层：从选中的页面元素往上，到画面根为止 */
export interface LiveChainItem {
  /** 标签名（div / span）或组件名（Chars / Hook） */
  name: string
  kind: 'host' | 'component'
  /** 这一层在源码里的位置，形如 src/Coffee.tsx:171:6；第三方组件没有 */
  src: string | null
  /** 这一层写死的简单属性（字符串、数字、布尔），用来显示「传进来的文字」等 */
  props: Record<string, string | number | boolean>
  /** 源码里写死的属性；读不到（第三方组件、文件已变）为 null */
  source?: LiveSourceInfo | null
}

/** 一个片段（Remotion Sequence）：起止已换算成整片的绝对帧 */
export interface LiveSequence {
  id: string
  parent: string | null
  name: string
  type: string
  from: number
  duration: number
}

/** 点选后预览窗口报上来的元素信息 */
export interface LiveElementInfo {
  /** 选中的页面元素在源码里的位置 */
  src: string | null
  tag: string
  /** 页面元素 → 外层组件 → … → 画面根 */
  chain: LiveChainItem[]
  /** 元素里的文字（已去掉首尾空白，过长截断） */
  text: string
  /** 计算后的样式：属性小窗显示的真实值 */
  style: {
    fontSize: string
    fontFamily: string
    fontWeight: string
    color: string
    lineHeight: string
    letterSpacing: string
    opacity: string
    textAlign: string
    backgroundColor: string
  }
  rect: LiveRect
  /** 选中框在预览窗口里的像素位置（工作台据此摆工具条） */
  box: { x: number; y: number; w: number; h: number }
  /** 选中的是组件链上的第几层 */
  level: number
  /** 包住它的最近一个片段 */
  sequence: LiveSequence | null
  frame: number
}

/** 元素轨上的一个元素：由源码写出来、在画面上真正出现过的东西，以及它出现的帧段 [起, 止) */
export interface LiveLayerItem {
  /** 元素的源码位置（组件调用处或页面节点）；同一处被渲染多次（循环）合成一个 */
  key: string
  src: string
  name: string
  kind: 'text' | 'shape' | 'image' | 'video'
  ranges: [number, number][]
  /** 元素里的文字（截断），用于搜索 */
  text?: string
  /** 铺满画面且画了东西：背景 */
  full?: boolean
}

export interface LiveCompositionMeta {
  id: string
  width: number
  height: number
  fps: number
  durationInFrames: number
}

/** 预览窗口 → 工作台 */
export type LiveEvent =
  | { fm: 'live'; type: 'ready'; composition: LiveCompositionMeta; frame: number }
  | { fm: 'live'; type: 'frame'; frame: number }
  | { fm: 'live'; type: 'playing'; playing: boolean }
  | { fm: 'live'; type: 'tracks'; sequences: LiveSequence[] }
  /** client 是 iframe 视口里的坐标（工作台加上 iframe 的位置再摆小窗） */
  | { fm: 'live'; type: 'select'; element: LiveElementInfo; client: { x: number; y: number } }
  | { fm: 'live'; type: 'region'; rect: LiveRect; frame: number; client: { x: number; y: number } }
  | { fm: 'live'; type: 'deselect' }
  | { fm: 'live'; type: 'escape' }
  | { fm: 'live'; type: 'reloading' }
  | { fm: 'live'; type: 'build-error'; message: string | null }
  | { fm: 'live'; type: 'runtime-error'; message: string }
  | { fm: 'live'; type: 'no-composition'; available: string[] }
  /** 选中框移动了（拖动时间、动画）：工具条跟着走 */
  | { fm: 'live'; type: 'selection-box'; box: { x: number; y: number; w: number; h: number } }
  /** 写回 / 撤销的结果；edits = 这次预览期间累计改了几处（可撤销的步数） */
  | { fm: 'live'; type: 'commit-result'; ok: boolean; code?: string; message?: string; edits: number; changed?: boolean }
  | { fm: 'live'; type: 'edits'; edits: number }
  /** 后台逐帧采集到的元素出现时间（每次源码刷新后重采）；step = 采样间隔帧数 */
  | { fm: 'live'; type: 'layers'; items: LiveLayerItem[]; step: number; fps: number }

/** 工作台 → 预览窗口 */
export type LiveCommand =
  | { fm: 'live'; type: 'play' }
  | { fm: 'live'; type: 'pause' }
  | { fm: 'live'; type: 'toggle' }
  | { fm: 'live'; type: 'seek'; frame: number }
  | { fm: 'live'; type: 'clear-selection' }
  /** 在组件链里换一层选中（0 = 页面元素本身） */
  | { fm: 'live'; type: 'select-level'; level: number }
  /** 拖动中：直接改画面上那几个节点的样式，不写源码（level = 样式写在组件链的哪一层） */
  | { fm: 'live'; type: 'preview-style'; level: number; key: string; value: string | number }
  | { fm: 'live'; type: 'preview-reset' }
  /** 写回源码：只改一个值；expect / expectCode 核对原值（见 live-preview/source-edit.mjs） */
  | { fm: 'live'; type: 'commit'; src: string; path: string[]; value: string | number | boolean; expect: string | number | boolean | null; expectCode?: string | null; fileHash?: string }
  | { fm: 'live'; type: 'undo' }
  /** 从轨道选元素：跳到这一帧并选中源码位置为 src 的元素（组件调用处也行） */
  | { fm: 'live'; type: 'select-src'; src: string; frame: number }

export function isLiveEvent(data: unknown): data is LiveEvent {
  return typeof data === 'object' && data !== null && (data as { fm?: unknown }).fm === 'live'
    && typeof (data as { type?: unknown }).type === 'string'
}

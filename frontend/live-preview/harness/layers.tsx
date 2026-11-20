/**
 * 元素轨采集：在看不见的缩略画面里逐帧走一遍，记下「每个由源码写出来的元素」真正出现在画面上的帧段，
 * 报给工作台排成元素轨（同时出现的元素分到不同的轨上 —— PRODUCT.md：同时出现的内容需要分轨）。
 *
 * 为什么不用 <Sequence> 登记：coffee 这类工程里的标题、标签、图表是靠帧数算透明度和位移做动画的，
 * 根本没有 Sequence，只看登记的话轨道上只剩几个场景。这里看的是渲染出来的真实页面。
 *
 * 用 Remotion 的 <Thumbnail> 单独渲染（不包片段登记那一层，不会污染轨道登记），放在屏幕外，
 * 用户看到的实时画面不受影响。每次源码刷新后重新采集。
 */
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Thumbnail } from '@remotion/player'
import { post, SAMPLE_ATTR } from './bridge'
import { chainOf, fiberOf, hostsOf, type Level } from './probe'

/** 最多采这么多帧：30 秒 / 30fps 的片子隔 2 帧采一次 */
const MAX_SAMPLES = 450
/** 这些组件只是排版或分段用的壳，不当成元素 */
const STRUCTURAL = /^(AbsoluteFill|Sequence|Series|Fragment|Component|Freeze|Loop|Folder)$/
const MEDIA = new Set(['img', 'video', 'canvas', 'svg', 'picture'])

export interface LayerItem {
  key: string
  src: string
  name: string
  kind: 'text' | 'shape' | 'image' | 'video'
  ranges: [number, number][]
  text?: string
  full?: boolean
}

interface Owner { key: string; src: string; name: string; kind: LayerItem['kind']; text?: string; full?: boolean }

const snippet = (t: string) => {
  const s = t.replace(/\s+/g, ' ').trim()
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

/** 节点自己画了东西：底色、渐变 / 背景图、边框，或者本身是图片、视频、图形 */
function paints(el: Element): boolean {
  if (MEDIA.has(el.tagName.toLowerCase())) return true
  const cs = getComputedStyle(el)
  return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0
}

/** 组件收的 children 是元素（不是一段文字）：它是个包内容的壳 */
function isWrapper(props: Record<string, unknown> | null): boolean {
  const children = props?.children
  if (children == null || typeof children === 'string' || typeof children === 'number') return false
  return true
}

function hasOwnText(el: Element) {
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim()) return true
  return false
}

/**
 * 一个页面节点算哪个元素：组件链上第一个「项目源码里写的、不是排版壳」的组件；
 * 但如果那个组件铺满整个画面（场景、包装层）而这个节点只是其中一小块，就把节点自己当元素 ——
 * 否则一整个场景里直接写的标签、横线都会被并成一个「Scene」。
 */
function ownerOf(el: Element, levels: Level[], root: DOMRect, sceneNames: Set<string>): Owner | null {
  const area = root.width * root.height
  const host = levels[0]
  if (!host?.item.src) return null
  const box = el.getBoundingClientRect()
  const hostFull = box.width * box.height >= area * 0.9
  for (const level of levels) {
    if (level.item.kind !== 'component' || !level.item.src) continue
    if (STRUCTURAL.test(level.item.name)) continue
    if (sceneNames.has(level.item.name)) break
    /* 包内容的壳（<In><div>单份浓缩</div></In>）：内容是在调用处写的，算内容自己，不算壳 */
    if (isWrapper(level.fiber.memoizedProps)) break
    const comp = hostsOf(level.fiber)
    const r = comp[0]?.getBoundingClientRect()
    const compFull = r ? r.width * r.height >= area * 0.9 : false
    if (compFull && !hostFull) break
    /* 铺满画面的组件只有真的画了东西（底色、渐变、图片）才算元素，例如背景；纯排版的场景壳不算 */
    if (compFull && !paints(el)) return null
    const text = snippet(comp.map((h) => h.textContent ?? '').join(' '))
    return { key: level.item.src, src: level.item.src, name: level.item.name, kind: text ? 'text' : 'shape', ...(text ? { text } : {}), ...(compFull ? { full: true } : {}) }
  }
  /* 没有合适的组件：节点本身是「叶子」（有文字、是媒体、或者画了底色 / 边框）才算元素 */
  const tag = el.tagName.toLowerCase()
  const painted = paints(el)
  if (MEDIA.has(tag)) return { key: host.item.src, src: host.item.src, name: tag === 'img' ? '图片' : tag === 'video' ? '视频' : '图形', kind: tag === 'img' ? 'image' : tag === 'video' ? 'video' : 'shape' }
  if (hasOwnText(el)) {
    const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    return { key: host.item.src, src: host.item.src, name: t.length > 14 ? `${t.slice(0, 14)}…` : t, kind: 'text', text: snippet(t) }
  }
  if (painted && !hostFull) return { key: host.item.src, src: host.item.src, name: '形状', kind: 'shape' }
  return null
}

/** 节点在这一帧看不看得见：有大小、在画面里、自身与所有上层的透明度乘积不为 0、没被隐藏 */
function visible(el: Element, root: Element, rootBox: DOMRect, opacity: Map<Element, number>): boolean {
  const box = el.getBoundingClientRect()
  if (box.width < 1 || box.height < 1) return false
  if (box.right <= rootBox.left || box.left >= rootBox.right || box.bottom <= rootBox.top || box.top >= rootBox.bottom) return false
  const effective = (n: Element): number => {
    const cached = opacity.get(n)
    if (cached !== undefined) return cached
    const cs = getComputedStyle(n)
    let v = cs.visibility === 'hidden' || cs.display === 'none' ? 0 : parseFloat(cs.opacity || '1')
    if (n !== root && n.parentElement && v > 0) v *= effective(n.parentElement)
    opacity.set(n, v)
    return v
  }
  return effective(el) > 0.03
}

function yieldOnce() {
  return new Promise<void>((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => { ch.port1.close(); resolve() }
    ch.port2.postMessage(null)
  })
}
const yieldTwice = () => yieldOnce().then(yieldOnce)

export function LayerSampler({ component, props, width, height, fps, durationInFrames, sceneNames, onDone }: {
  component: ComponentType<Record<string, unknown>>
  props: Record<string, unknown>
  width: number
  height: number
  fps: number
  durationInFrames: number
  sceneNames: () => Set<string>
  onDone?: () => void
}) {
  const step = Math.max(1, Math.ceil(durationInFrames / MAX_SAMPLES))
  const [frame, setFrame] = useState(0)
  const hostRef = useRef<HTMLDivElement>(null)
  const seen = useRef(new Map<string, { owner: Owner; frames: number[] }>())
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    let cancelled = false
    /* 让出两次再量：缩略画面换帧是在它自己的 effect 里提交的，同一轮里读到的还是上一帧。
       不用 requestAnimationFrame —— 窗口没有焦点时它会被限到每秒一次，采一遍要好几分钟；
       MessageChannel 不受这个限制，读布局本身会强制把样式算完。 */
    void yieldTwice().then(() => {
      if (cancelled) return
      {
        const root = hostRef.current?.querySelector(`[${SAMPLE_ATTR}]`) as HTMLElement | null
        if (root) {
          const rootBox = root.getBoundingClientRect()
          const opacity = new Map<Element, number>()
          const owners = new Map<Element, Owner | null>()
          const scenes = sceneNames()
          const hit = new Set<string>()
          for (const el of root.querySelectorAll('[data-fm-src]')) {
            if (!visible(el, root, rootBox, opacity)) continue
            let owner = owners.get(el)
            if (owner === undefined) {
              owner = fiberOf(el) ? ownerOf(el, chainOf(el), rootBox, scenes) : null
              owners.set(el, owner)
            }
            if (!owner || hit.has(owner.key)) continue
            hit.add(owner.key)
            const entry = seen.current.get(owner.key) ?? { owner, frames: [] }
            entry.frames.push(frame)
            seen.current.set(owner.key, entry)
          }
        }
        const next = frame + step
        if (next < durationInFrames) { setFrame(next); return }
        done.current = true
        /* 采到的帧连成段：相邻两次采样之间都在就算连着 */
        const items: LayerItem[] = [...seen.current.values()].slice(0, 160).map(({ owner, frames }) => {
          const ranges: [number, number][] = []
          for (const f of frames) {
            const last = ranges[ranges.length - 1]
            if (last && f - last[1] <= step) last[1] = f + step
            else ranges.push([f, f + step])
          }
          for (const r of ranges) r[1] = Math.min(r[1], durationInFrames)
          return { ...owner, ranges }
        })
        post({ type: 'layers', items, step, fps })
        onDone?.()
      }
    })
    return () => { cancelled = true }
  }, [frame, step, durationInFrames, fps, sceneNames, onDone])

  /* 缩小渲染省工夫：只量相对位置和可见性，尺寸无所谓 */
  const scale = Math.min(1, 480 / width)
  return (
    <div ref={hostRef} aria-hidden="true"
         style={{ position: 'fixed', left: -100000, top: 0, width: width * scale, height: height * scale, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <Thumbnail
        component={SampleRoot}
        inputProps={{ __fmInner: component, __fmProps: props }}
        frameToDisplay={frame}
        durationInFrames={durationInFrames}
        fps={fps}
        compositionWidth={width}
        compositionHeight={height}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}

/** 采样画面的根：带上 data-fm-sample，探针沿 fiber 往上找组件链时在这里停 */
function SampleRoot({ __fmInner: Inner, __fmProps }: { __fmInner: ComponentType<Record<string, unknown>>; __fmProps: Record<string, unknown> }) {
  return (
    <div {...{ [SAMPLE_ATTR]: '' }} style={{ position: 'absolute', inset: 0 }}>
      <Inner {...__fmProps} />
    </div>
  )
}

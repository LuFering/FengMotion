import type { EditorLayer, LayerKeyframe } from './types'

/** 可加关键帧的数值属性。文字内容这类离散属性不做插值，所以不在列表里。 */
export const KEYFRAME_PROPERTIES = [
  ['x', '水平位置'],
  ['y', '垂直位置'],
  ['rotation', '旋转'],
  ['opacity', '不透明度'],
  ['scale', '缩放'],
] as const

export type KeyframeProperty = (typeof KEYFRAME_PROPERTIES)[number][0]

const baseValue = (layer: EditorLayer, property: KeyframeProperty): number => {
  if (property === 'scale') return layer.zoom
  return layer[property] as number
}

/**
 * 取图层在某一时刻的属性值。
 *
 * 没有关键帧时直接用静态属性；有关键帧时在相邻两帧之间线性插值。
 * 时间用「相对入点」计算：整体拖动图层时画面动效不会被拉走。
 */
export function valueAt(layer: EditorLayer, property: KeyframeProperty, absoluteSeconds: number): number {
  const frames = (layer.keyframes ?? []).filter((k) => k.property === property).sort((a, b) => a.time - b.time)
  if (!frames.length) return baseValue(layer, property)
  const t = absoluteSeconds - layer.start
  if (t <= frames[0].time) return frames[0].value
  if (t >= frames[frames.length - 1].time) return frames[frames.length - 1].value
  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i], b = frames[i + 1]
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time
      if (span <= 0) return b.value
      return a.value + ((t - a.time) / span) * (b.value - a.value)
    }
  }
  return baseValue(layer, property)
}

export const makeKeyframe = (property: KeyframeProperty, time: number, value: number): LayerKeyframe => ({
  id: crypto.randomUUID(),
  property,
  time: Math.max(0, Number(time.toFixed(2))),
  value,
})

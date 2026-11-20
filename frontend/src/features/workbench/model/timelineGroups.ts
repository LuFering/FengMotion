/**
 * 时间线的轨道分组：同一类别的轨道收进一个抽屉，避免元素一多轨道铺满整屏。
 *
 * <p>类别优先用轨道自带的 category（实时模式按元素采集结果给出），
 * 成片清单没有就按轨道名和片段类型推断；推断不出的归「图形」。</p>
 *
 * <p>这里全是纯函数：分组、疏密条、切点、搜索、选区里的元素，都能单独测。</p>
 */
import type { SequenceEntry, SequenceTrack, TrackCategory } from '@/features/workbench/model/sequenceManifest'

export const CATEGORY_ORDER: TrackCategory[] = ['scene', 'text', 'shape', 'background', 'media', 'audio']

export const CATEGORY_LABEL: Record<TrackCategory, string> = {
  scene: '场景',
  text: '文字',
  shape: '图形',
  background: '背景',
  media: '图片与视频',
  audio: '音频',
}

export function categoryOf(track: SequenceTrack): TrackCategory {
  if (track.category) return track.category
  const name = track.name
  if (/场景|scene|成片|composition/i.test(name)) return 'scene'
  if (/音频|音乐|配音|audio|music|sound|voice/i.test(name)) return 'audio'
  if (/背景|底图|background/i.test(name)) return 'background'
  if (/字幕|文字|标题|caption|subtitle|text/i.test(name)) return 'text'
  if (/视频|图片|画面|素材|video|image/i.test(name)) return 'media'
  const kind = track.clips[0]?.kind
  if (kind === 'text') return 'text'
  if (kind === 'audio') return 'audio'
  if (kind === 'image' || kind === 'video') return 'media'
  return 'shape'
}

export interface TrackGroup {
  category: TrackCategory
  label: string
  tracks: SequenceTrack[]
  /** 不同元素的个数（同一元素出现多段只算一个）；没有元素信息时按片段数 */
  count: number
}

/** 片段对应的「元素」：同一元素的多段共用源码位置 */
export const elementOf = (clip: SequenceEntry) => clip.src ?? clip.id

export function groupTracks(tracks: SequenceTrack[]): TrackGroup[] {
  const by = new Map<TrackCategory, SequenceTrack[]>()
  for (const t of tracks) {
    const c = categoryOf(t)
    by.set(c, [...(by.get(c) ?? []), t])
  }
  return CATEGORY_ORDER.filter((c) => by.has(c)).map((category) => {
    const list = by.get(category)!
    const elements = new Set<string>()
    for (const t of list) for (const clip of t.clips) elements.add(elementOf(clip))
    return { category, label: CATEGORY_LABEL[category], tracks: list, count: elements.size }
  })
}

/** 默认展开：场景层总是展开；超过 2 条轨的类别收起，少的直接摊开 */
export const defaultCollapsed = (group: TrackGroup) => group.category !== 'scene' && group.tracks.length > 2

/** 疏密条：把视野切成若干格，数每格里同时出现的片段数 */
export function densityBins(group: TrackGroup, viewStart: number, viewEnd: number, bins: number): number[] {
  const out = new Array<number>(bins).fill(0)
  const width = viewEnd - viewStart
  if (!(width > 0) || bins <= 0) return out
  for (const t of group.tracks) for (const clip of t.clips) {
    const a = Math.max(clip.start, viewStart)
    const b = Math.min(clip.start + clip.duration, viewEnd)
    if (b <= a) continue
    const first = Math.floor(((a - viewStart) / width) * bins)
    const last = Math.min(bins - 1, Math.ceil(((b - viewStart) / width) * bins) - 1)
    for (let i = Math.max(0, first); i <= last; i++) out[i]++
  }
  return out
}

/**
 * 收起的抽屉里点某个时间：选这一刻这一类里最显眼的片段 ——
 * 正在出现的里面最晚出现的那个（刚进场的通常是这一刻的主角），同时进场取持续更长的；
 * 这一刻什么都没有就取离得最近的。
 */
export function prominentClipAt(group: TrackGroup, t: number): { track: SequenceTrack; clip: SequenceEntry } | null {
  let best: { track: SequenceTrack; clip: SequenceEntry } | null = null
  let nearest: { track: SequenceTrack; clip: SequenceEntry; d: number } | null = null
  for (const track of group.tracks) for (const clip of track.clips) {
    const end = clip.start + clip.duration
    if (t >= clip.start && t < end) {
      if (!best || clip.start > best.clip.start + 1e-6 || (Math.abs(clip.start - best.clip.start) <= 1e-6 && clip.duration > best.clip.duration)) best = { track, clip }
      continue
    }
    const d = t < clip.start ? clip.start - t : t - end
    if (!nearest || d < nearest.d) nearest = { track, clip, d }
  }
  return best ?? (nearest ? { track: nearest.track, clip: nearest.clip } : null)
}

/** 所有片段的起止点（切点），排好序、去重 */
export function cutPoints(tracks: SequenceTrack[], limit: number): number[] {
  const set = new Set<number>()
  for (const t of tracks) for (const clip of t.clips) {
    for (const v of [clip.start, clip.start + clip.duration]) if (v >= 0 && v <= limit) set.add(Math.round(v * 1000) / 1000)
  }
  return [...set].sort((a, b) => a - b)
}

/** 前一个 / 后一个切点；没有就返回 null */
export function adjacentCut(points: number[], t: number, direction: -1 | 1): number | null {
  const eps = 1e-3
  if (direction > 0) return points.find((p) => p > t + eps) ?? null
  for (let i = points.length - 1; i >= 0; i--) if (points[i] < t - eps) return points[i]
  return null
}

/** 吸附：落在某个切点的容差内就贴到切点上 */
export function snapTo(points: number[], t: number, tolerance: number): number {
  let best = t
  let d = tolerance
  for (const p of points) {
    const dd = Math.abs(p - t)
    if (dd <= d) { d = dd; best = p }
  }
  return best
}

/** 搜索：名称、文字、源码位置里有这几个字（不分大小写，空格分开的词都要命中） */
export function clipMatches(clip: SequenceEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return false
  const hay = `${clip.name} ${clip.text ?? ''} ${clip.src ?? ''}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

export interface ClipRef { track: SequenceTrack; clip: SequenceEntry }

/** 命中的片段，按时间先后排 */
export function searchClips(tracks: SequenceTrack[], query: string): ClipRef[] {
  const out: ClipRef[] = []
  for (const track of tracks) for (const clip of track.clips) if (clipMatches(clip, query)) out.push({ track, clip })
  return out.sort((a, b) => a.clip.start - b.clip.start || a.clip.duration - b.clip.duration)
}

export interface SpanElement {
  key: string
  name: string
  category: TrackCategory
  src?: string
  text?: string
  start: number
  end: number
}

/** 时间选区里出现过的元素（场景、媒体也算），同一元素只列一次，按出现先后排 */
export function elementsInSpan(tracks: SequenceTrack[], span: { start: number; end: number }): SpanElement[] {
  const by = new Map<string, SpanElement>()
  for (const track of tracks) {
    const category = categoryOf(track)
    for (const clip of track.clips) {
      const end = clip.start + clip.duration
      if (end <= span.start + 1e-6 || clip.start >= span.end - 1e-6) continue
      const key = `${category}:${elementOf(clip)}`
      const prev = by.get(key)
      if (prev) { prev.start = Math.min(prev.start, clip.start); prev.end = Math.max(prev.end, end); continue }
      by.set(key, { key, name: clip.name, category, src: clip.src, text: clip.text, start: clip.start, end })
    }
  }
  return [...by.values()].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.start - b.start)
}

import { Film01, Image01, TextInput, LayersThree01, MusicNote01, Square, Type01, Clapperboard } from '@untitledui/icons'
import { type SequenceTrack, type TrackCategory } from '@/features/workbench/model/sequenceManifest'
import { formatTimecode } from '@/features/workbench/model/timeRange'
import { toTimecode } from '@/features/workbench/model/liveEdit'
import { CATEGORY_LABEL, type SpanElement } from '@/features/workbench/model/timelineGroups'

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export const tickLabel = (seconds: number, step: number) => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (step >= 1) return `${m}:${String(Math.round(s)).padStart(2, '0')}`
  const digits = step < 0.2 ? 2 : 1
  return `${m}:${s.toFixed(digits).padStart(digits + 3, '0')}`
}

export const KIND_ICON = { text: Type01, image: Image01, video: Film01, audio: MusicNote01, shape: Square } as const

export const TRACK_ICON = {
  text: TextInput,
  video: Film01,
  background: LayersThree01,
  image: Image01,
  audio: MusicNote01,
  shape: Square,
} as const

export type TrackVisualKind = keyof typeof TRACK_ICON

export const trackVisualKind = (track: SequenceTrack): TrackVisualKind => {
  const label = `${track.name} ${track.clips[0]?.kind ?? ''}`
  if (/字幕|文字|标题|caption|subtitle|text/i.test(label)) return 'text'
  if (/音频|音乐|audio|music|sound/i.test(label)) return 'audio'
  if (/背景|底图|background/i.test(track.name)) return 'background'
  if (/画面|视频|video/i.test(label)) return 'video'
  const kind = track.clips[0]?.kind
  return kind && kind in TRACK_ICON ? kind : 'background'
}

export const CATEGORY_ICON: Record<TrackCategory, typeof Film01> = {
  scene: Clapperboard,
  text: Type01,
  shape: Square,
  background: LayersThree01,
  media: Image01,
  audio: MusicNote01,
}

/** 时间线上的时间：知道帧率就按 MM:SS:FF（规范 §6），不知道就退回到毫秒 */
export const clipTime = (seconds: number, fps: number | undefined) =>
  fps ? toTimecode(seconds * fps, fps) : formatTimecode(seconds, true)

/**
 * 成片轨道采集不到组件名时，后端统一填「序列」（backend/remotion/timeline.mjs），
 * 场景轨上就是一排同名的「序列」。场景轨按序号称呼成「场景 N」，只改显示：
 * 元素匹配（WorkbenchTimeline）和交给 AI 的修改说明仍用原名。
 */
const GENERIC_CLIP_NAME = '序列'
export function displayClip<T extends { name: string }>(clip: T, sceneIndex?: number): T {
  return sceneIndex !== undefined && clip.name === GENERIC_CLIP_NAME ? { ...clip, name: `场景 ${sceneIndex}` } : clip
}

/**
 * 片段 / 元素怎么称呼：文字类先写画面上的字（「单份浓缩」比组件名「Chars」好认），组件名退成副标；
 * 名称本来就是文字截出来的（「每杯 95mg…」）就不再重复一遍文字。
 */
export function clipLabel(item: { name: string; text?: string; kind?: string; category?: string }): { lead: string; sub: string } {
  const text = item.text?.trim() ?? ''
  const fromText = !!text && (text === item.name || (item.name.endsWith('…') && text.startsWith(item.name.slice(0, -1))))
  if (!text || fromText) return { lead: fromText ? text : item.name, sub: '' }
  const textFirst = item.kind === 'text' || item.category === 'text'
  return textFirst ? { lead: text, sub: item.name } : { lead: item.name, sub: text }
}

/** 交给 AI 的那句话：时间范围、帧号、范围里每个元素的名称 / 文字 / 源码位置一起带上 */
export function spanPrompt(span: { start: number; end: number }, elements: SpanElement[], fps: number | undefined, ask: string) {
  const range = `${clipTime(span.start, fps)}–${clipTime(span.end, fps)}${fps ? `（第 ${Math.round(span.start * fps)}–${Math.round(span.end * fps)} 帧）` : ''}`
  const list = elements.map((e) => {
    const { lead, sub } = clipLabel(e)
    return `${CATEGORY_LABEL[e.category]}「${lead}」${sub ? `（${sub}）` : ''}${e.src ? `，源码 ${e.src}` : ''}`
  })
  return `修改 ${range} 这段时间里的画面。${list.length ? `这段里出现的元素：${list.join('、')}。` : ''}只改这段时间里的内容，其余时间保持不变。要求：${ask}`
}

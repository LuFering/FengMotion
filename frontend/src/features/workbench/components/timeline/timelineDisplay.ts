import { Film01, Image01, TextInput, LayersThree01, MusicNote01, Square, Type01 } from '@untitledui/icons'
import { type SequenceTrack } from '@/features/workbench/model/sequenceManifest'

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

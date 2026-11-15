/**
 * 时间线上的编辑操作：把「用户想怎么改」变成一条可描述、可提交、可撤销的记录。
 *
 * <p><strong>为什么做成数据而不是回调</strong>：删除、拆分、复制、移动最终都要落到工程代码上，
 * 而且都要能撤销。把这些操作描述成对象，界面只负责产生它们，提交与撤销由上层统一处理 ——
 * 否则每个手势各自维护一套状态，很快就会出现「撤销撤错东西」。</p>
 *
 * <p><strong>拆分对齐同轨不重叠的约束</strong>：一段片段在时间中点切开后，两半必须首尾相接、
 * 且各自仍在原片段覆盖的区间内。这不是界面逻辑，是数据不变量，所以放在这里并有测试口径。</p>
 */

import type { SequenceEntry, SequenceTrack } from './sequenceManifest'

export type TimelineEditOp =
  /** 移动整段：起点变、时长不变。 */
  | { kind: 'move'; clipId: string; start: number }
  /** 改起点：右端固定。 */
  | { kind: 'trim-start'; clipId: string; start: number }
  /** 改终点：左端固定。 */
  | { kind: 'trim-end'; clipId: string; duration: number }
  /** 从工程里删掉这一段。 */
  | { kind: 'remove'; clipId: string }
  /** 在时间点把一段切成两段。 */
  | { kind: 'split'; clipId: string; at: number }
  /** 复制一段到新的起点。 */
  | { kind: 'duplicate'; clipId: string; start: number }
  /** 轨道开关：隐藏 / 静音 / 锁定。 */
  | { kind: 'track'; trackId: string; field: 'hidden' | 'locked'; value: boolean }

/** 最短片段：比这个更短的片段既点不中也看不清。 */
export const MIN_CLIP_SECONDS = 0.1

/**
 * 在 `at` 处切分一段片段。
 *
 * <p>切点必须严格落在片段内部：端点不切（切了也没有第二段）。
 * 两半的 id 由调用方给，保证可撤销时能对上同一对片段。</p>
 *
 * @returns 两半；切点不在内部时返回 null
 */
export function splitClip(
  clip: SequenceEntry,
  at: number,
  rightId: string,
): { left: SequenceEntry; right: SequenceEntry } | null {
  const end = clip.start + clip.duration
  // 端点不切；同时保证两半都不短于最小值
  if (!(at > clip.start + MIN_CLIP_SECONDS / 2 && at < end - MIN_CLIP_SECONDS / 2)) return null
  const leftDuration = Math.round((at - clip.start) * 1000) / 1000
  const rightDuration = Math.round((end - at) * 1000) / 1000
  if (leftDuration < MIN_CLIP_SECONDS || rightDuration < MIN_CLIP_SECONDS) return null
  return {
    left: { ...clip, duration: leftDuration },
    /* 右半是同一段内容的后半截，名字加「· 2」以便在轨道上区分。 */
    right: {
      ...clip,
      id: rightId,
      name: clip.name.length > 40 ? clip.name : `${clip.name} · 2`,
      start: Math.round((clip.start + leftDuration) * 1000) / 1000,
      duration: rightDuration,
    },
  }
}

/**
 * 复制一段到指定起点。
 *
 * <p><strong>落点冲突时找最近空位，而不是硬叠上去</strong>：同轨不重叠是硬约束，
 * 叠起来的片段会让后续拆分、吸附、边缘夹取全部算错。所以：
 * 落点空着就放落点；被占就从落点向后找第一个放得下的位置，
 * 再往前找；两边都没有就返回 null，由界面告诉用户放不下。</p>
 *
 * @returns 新片段；整条轨道没有空位时返回 null
 */
export function duplicateClip(
  track: SequenceTrack,
  clip: SequenceEntry,
  start: number,
  limit: number,
): { clip: SequenceEntry; moved: boolean } | null {
  /* 源片段仍然占着它原来的位置，新片段不能和它重叠 ——
     所以这里要检查轨道上「全部」片段，包括源片段自己。 */
  const fits = (at: number) =>
    at >= 0 &&
    at + clip.duration <= limit + 0.001 &&
    !track.clips.some(
      (other) =>
        at < other.start + other.duration - 0.002 &&
        at + clip.duration > other.start + 0.002,
    )
  /* 落点本身必须落在片长内：越界的落点说明调用方算错了，
     往前后找空位只会把错误藏起来。 */
  if (!(start >= 0 && start + clip.duration <= limit + 0.001)) return null
  /* 从落点往后找，再往前找：先给「紧接着原片段」的机会，再看空白处。 */
  const candidates: number[] = []
  const step = MIN_CLIP_SECONDS / 2
  for (let at = start; at + clip.duration <= limit + 0.001; at += step) candidates.push(Math.round(at * 1000) / 1000)
  for (let at = start - step; at >= 0; at -= step) candidates.push(Math.round(at * 1000) / 1000)
  const found = candidates.find(fits)
  if (found === undefined) return null
  return {
    clip: {
      ...clip,
      id: `${clip.id}-copy-${Math.random().toString(36).slice(2, 8)}`,
      name: clip.name.length > 44 ? clip.name : `${clip.name} 副本`,
      start: found,
    },
    moved: Math.abs(found - start) > 0.001,
  }
}

/** 删除一段：只按 id 删，不按位置删 —— 位置会随其它改动变化。 */
export function removeClip(tracks: SequenceTrack[], clipId: string): SequenceTrack[] {
  return tracks.map((track) =>
    track.clips.some((c) => c.id === clipId)
      ? { ...track, clips: track.clips.filter((c) => c.id !== clipId) }
      : track,
  )
}

/** 按 id 找到片段所在的轨道。 */
export function trackOfClip(tracks: SequenceTrack[], clipId: string): SequenceTrack | null {
  return tracks.find((t) => t.clips.some((c) => c.id === clipId)) ?? null
}

/** 按 id 找到片段本身。 */
export function clipById(tracks: SequenceTrack[], clipId: string): SequenceEntry | null {
  for (const track of tracks) {
    const found = track.clips.find((c) => c.id === clipId)
    if (found) return found
  }
  return null
}

/**
 * 把一条操作翻译成给 AI 的修改要求。
 *
 * <p>界面不直接改代码，所以每条操作都要能说清「改谁、改成什么」。
 * 文案要具体到时间，否则 AI 只能猜。</p>
 */
export function describeEdit(op: TimelineEditOp, name: string): string {
  const clock = (s: number) => {
    const m = Math.floor(Math.max(0, s) / 60)
    const sec = Math.max(0, s) % 60
    return `${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`
  }
  switch (op.kind) {
    case 'move':
      return `把「${name}」移到 ${clock(op.start)} 开始，时长不变；其余内容不动。`
    case 'trim-start':
      return `把「${name}」的起点改到 ${clock(op.start)}，终点不动；其余内容不动。`
    case 'trim-end':
      /* trim-end 只带新的时长，起点由调用方知道；这里只描述「时长变成多少」。 */
      return `把「${name}」的时长改成 ${op.duration.toFixed(2)} 秒，起点不动；其余内容不动。`
    case 'remove':
      return `删掉「${name}」这一整段，其余内容与时间不变。`
    case 'split':
      return `在 ${clock(op.at)} 把「${name}」切成两段，切点前后内容连续，总时长不变。`
    case 'duplicate':
      return `把「${name}」复制一份，放到 ${clock(op.start)} 开始，原片段保留。`
    case 'track':
      return op.field === 'hidden'
        ? `${op.value ? '隐藏' : '显示'}轨道「${name}」。`
        : `${op.value ? '锁定' : '解锁'}轨道「${name}」。`
    default:
      return ''
  }
}

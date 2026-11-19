/**
 * 序列清单：一条片子里有哪些轨道，每条轨道上有哪些片段。
 *
 * <p><strong>为什么是两级</strong>：Remotion 的 {@code <Track>} 把片段放在同一行，
 * 同一行里的片段不允许重叠；同时出现的内容要拆到不同轨道。所以轨道是容器，
 * 片段才是时间对象 —— 与 Studio 的时间线同构，也和主流剪辑软件一致。</p>
 *
 * <p><strong>为什么清单和代码并存</strong>：元素仍写成 {@code <Track>} + {@code <Sequence>}，
 * 动画留在代码里；清单只记录「哪条轨、哪个片段、从几秒到几秒」。
 * 清单由代码生成，是代码的投影，不是第二份事实。</p>
 *
 * <p><strong>不伪造</strong>：清单缺失、格式不对或与当前版本对不上时返回 null，
 * 界面只显示成片轨，不从源码里猜。</p>
 */

export type SequenceKind = 'text' | 'image' | 'video' | 'audio' | 'shape'

/** 片段 ID 只在所属轨道内唯一。 */
export const sequenceClipKey = (trackId: string, clipId: string): string => JSON.stringify([trackId, clipId])

export interface SequenceEntry {
  id: string
  name: string
  kind: SequenceKind
  /** 在成片里的起始秒数。 */
  start: number
  /** 持续秒数，必须大于 0。 */
  duration: number
  hidden?: boolean
}

export interface SequenceTrack {
  id: string
  name: string
  /** 同一轨道内的片段，按时间排序，互不重叠。 */
  clips: SequenceEntry[]
  /** 隐藏：整条轨不参与渲染（画面与声音都不出现）。 */
  hidden?: boolean
  /** 静音：保留画面，只关掉这条轨的声音。 */
  muted?: boolean
  /** 锁定：禁止移动、裁剪、删除这条轨上的片段。 */
  locked?: boolean
  /** 折叠：轨道头收成细条，为其他轨腾出高度。 */
  collapsed?: boolean
}

export interface SequenceManifest {
  schemaVersion: 2
  /** 清单描述的是这条片子的哪一版；与渲染快照的 sourceHash 对应。 */
  sourceHash?: string
  fps: number
  durationSeconds: number
  tracks: SequenceTrack[]
}

const KINDS: ReadonlySet<string> = new Set(['text', 'image', 'video', 'audio', 'shape'])
const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const OVERLAP_EPS = 0.002

/**
 * 校验一份清单。任何一处不合格就整份作废 —— 只画一半的轨道比不画更误导。
 *
 * @param input 来自项目文件或任务结果的原始值
 * @returns 通过校验的清单；不合格返回 null
 */
export function parseSequenceManifest(input: unknown): SequenceManifest | null {
  const raw = input as Partial<SequenceManifest>
  if (!raw || raw.schemaVersion !== 2) return null
  if (!isNum(raw.fps, 1, 240) || !isNum(raw.durationSeconds, 0.01, 36000)) return null
  if (!Array.isArray(raw.tracks) || raw.tracks.length === 0 || raw.tracks.length > 60) return null
  const trackIds = new Set<string>()
  const tracks: SequenceTrack[] = []
  let clipTotal = 0
  for (const track of raw.tracks) {
    if (!track || typeof track.id !== 'string' || !track.id || trackIds.has(track.id)) return null
    if (typeof track.name !== 'string' || !track.name.trim()) return null
    if (!Array.isArray(track.clips)) return null
    clipTotal += track.clips.length
    if (clipTotal > 400) return null
    const clipIds = new Set<string>()
    const clips: SequenceEntry[] = []
    for (const clip of track.clips) {
      if (!clip || typeof clip.id !== 'string' || !clip.id || clipIds.has(clip.id)) return null
      if (typeof clip.name !== 'string' || !clip.name.trim()) return null
      if (!KINDS.has(clip.kind)) return null
      if (!isNum(clip.start, 0, raw.durationSeconds)) return null
      if (!isNum(clip.duration, 0.001, raw.durationSeconds)) return null
      if (clip.start + clip.duration > raw.durationSeconds + 0.05) return null
      clipIds.add(clip.id)
      clips.push({
        id: clip.id,
        name: clip.name.slice(0, 80),
        kind: clip.kind,
        start: clip.start,
        duration: clip.duration,
        ...(clip.hidden === true ? { hidden: true } : {}),
      })
    }
    // 同一轨道上的片段不能重叠：那是数据本身有错，不能画成两条交叠的条
    clips.sort((a, b) => a.start - b.start)
    for (let i = 1; i < clips.length; i++) {
      if (clips[i].start < clips[i - 1].start + clips[i - 1].duration - OVERLAP_EPS) return null
    }
    trackIds.add(track.id)
    tracks.push({
      id: track.id,
      name: track.name.slice(0, 60),
      clips,
      ...(track.hidden === true ? { hidden: true } : {}),
      ...(track.muted === true ? { muted: true } : {}),
      ...(track.locked === true ? { locked: true } : {}),
      ...(track.collapsed === true ? { collapsed: true } : {}),
    })
  }
  const sourceHash = typeof raw.sourceHash === 'string' && raw.sourceHash ? raw.sourceHash : undefined
  return { schemaVersion: 2, ...(sourceHash ? { sourceHash } : {}), fps: raw.fps, durationSeconds: raw.durationSeconds, tracks }
}

/**
 * 判断清单是否描述的就是当前这条片子。
 *
 * <p>同样时长的不同版本可能包含不同元素；缺少任一哈希时无法确认归属。</p>
 */
export function manifestMatches(
  manifest: SequenceManifest | null,
  media: { sourceHash?: string | null; duration: number },
): manifest is SequenceManifest {
  if (!manifest) return false
  return !!manifest.sourceHash && !!media.sourceHash && manifest.sourceHash === media.sourceHash && Math.abs(manifest.durationSeconds - media.duration) <= 0.1
}

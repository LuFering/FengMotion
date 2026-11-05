/**
 * 参考片库的**服务端**数据源（替代演示常量 + localStorage）。
 *
 * 为什么要这一层：
 *   1. 视图用本地模型（`start`/`end` 是秒、集合叫 `segmentIds`），后端用契约模型
 *      （`startMs`/`endMs`、集合成员单独存）。单位与命名的转换只在这里做 ——
 *      契约 README §6 明确「界面的秒不落库」。
 *   2. **分析值必须原样透传**：`pending` 的维度不能补默认值，`source` 不能改写。
 *      这一层的职责是搬运，不是美化。
 *
 * 硬约束（与后端一致）：
 *   - `observation`（看得到的）与 `inference`（模型推断）是两件事，不合并；
 *   - `pending=true` 的维度界面显示「未解析」，不显示 0 或空结论；
 *   - 自动分析未接入前，不假装「已分析」。
 */
import { studioHttpApi } from '@/services/api'
import type { AnalysisKey, ReferenceStatus } from '@/data/referenceLibrary'

/** 服务端视频。 */
export interface ServerVideo {
  id: string
  title: string
  durationMs: number
  source: string
  description: string
  tags: string[]
  assetId: string | null
  /** 可播放地址；null 表示本机没有文件，界面应显示「仅静帧」而不是播放器。 */
  fileUrl: string | null
  thumbnailUrl: string | null
  status: ReferenceStatus
  segmentCount: number
  createdAt: string
  demo: boolean
}

/** 服务端单维分析值。 */
export interface ServerAnalysisValue {
  value: string
  source: 'measured' | 'model' | 'user' | null
  confidence: number | null
  evidence: string
  pending: boolean
}

/** 服务端片段。 */
export interface ServerSegment {
  id: string
  videoId: string
  index: number
  startMs: number
  endMs: number
  durationMs: number
  status: ReferenceStatus
  tags: string[]
  observation: string
  inference: string
  suggestion: string
  analysis: Record<string, ServerAnalysisValue>
  extraAnalysis: Record<string, ServerAnalysisValue>
}

/** 视图用的片段模型：时间回退成秒，与页面既有逻辑一致。 */
export interface LocalSegment {
  id: string
  videoId: string
  index: number
  start: number
  end: number
  status: ReferenceStatus
  tags: string[]
  observation: string
  inference: string
  suggestion: string
  /** 六维分析，原样透传（含 pending 与 source）。 */
  analysis: Record<AnalysisKey, ServerAnalysisValue>
  /** 后端额外保存的维度；界面默认不展示。 */
  extraAnalysis: Record<string, ServerAnalysisValue>
}

const ANALYSIS_KEYS: AnalysisKey[] = [
  'cameraMove', 'rhythm', 'lighting', 'composition', 'transition', 'reusable',
]

function toLocalSegment(s: ServerSegment): LocalSegment {
  const analysis = {} as Record<AnalysisKey, ServerAnalysisValue>
  for (const key of ANALYSIS_KEYS) {
    // 缺哪个维度就补一个 pending 的空值 —— 不能让界面少显示一行，
    // 那看起来像「这一项不需要分析」。
    analysis[key] = s.analysis[key] ?? {
      value: '', source: null, confidence: null, evidence: '', pending: true,
    }
  }
  return {
    id: s.id,
    videoId: s.videoId,
    index: s.index,
    // 契约用毫秒，界面用秒（README §6 的单位差异在适配层转换）。
    start: s.startMs / 1000,
    end: s.endMs / 1000,
    status: s.status,
    tags: s.tags ?? [],
    observation: s.observation ?? '',
    inference: s.inference ?? '',
    suggestion: s.suggestion ?? '',
    analysis,
    extraAnalysis: s.extraAnalysis ?? {},
  }
}

/** 列出全部参考片。 */
export async function listReferenceVideos(): Promise<ServerVideo[]> {
  // limit 由客户端内部固定为 200，调用方不必重复指定。
  const rows = await studioHttpApi().library.reference.listVideos()
  return rows.map(fixVideoUrls)
}

/**
 * 把服务端给的**相对路径**补成完整 URL。
 *
 * <p>后端只返回 {@code /api/assets/{id}/content} 这样的相对路径（它不知道自己被
 * 挂在哪个端口上），而 {@code <video src>} 是浏览器直接加载的 —— 相对路径会打到
 * 前端 dev server 上而不是后端，表现为「视频永远播不出来」。
 * 缩略图此前踩过同一个坑。</p>
 */
function fixVideoUrls(video: ServerVideo): ServerVideo {
  const base = studioHttpApi().library.reference
  return {
    ...video,
    fileUrl: base.absoluteUrl(video.fileUrl),
    thumbnailUrl: base.absoluteUrl(video.thumbnailUrl),
  }
}

/** 列出全部片段（可限定视频）。 */
export async function listSegments(videoId?: string): Promise<LocalSegment[]> {
  const api = studioHttpApi().library.reference
  const rows = await api.listSegments({ videoId, limit: 200 })
  return rows.map(toLocalSegment)
}

/** 上传视频作为参考片。 */
export async function uploadReferenceVideo(file: File, title?: string): Promise<ServerVideo> {
  const api = studioHttpApi().library.reference
  return api.uploadVideo(file, title)
}

/** 新建片段。时间用秒传入，转成毫秒发给服务端。 */
export async function addSegment(
  videoId: string,
  startSec: number,
  endSec: number,
  tags: string[] = [],
): Promise<LocalSegment> {
  const api = studioHttpApi().library.reference
  const created = await api.addSegment(videoId, {
    startMs: Math.round(startSec * 1000),
    endMs: Math.round(endSec * 1000),
    tags,
  })
  return toLocalSegment(created)
}

/** 更新片段（标签、观察、建议、时间范围）。推断不在可改范围内。 */
export async function updateSegment(
  segmentId: string,
  patch: { startSec?: number; endSec?: number; tags?: string[]; observation?: string; suggestion?: string },
): Promise<LocalSegment> {
  const api = studioHttpApi().library.reference
  const updated = await api.updateSegment(segmentId, {
    startMs: patch.startSec === undefined ? undefined : Math.round(patch.startSec * 1000),
    endMs: patch.endSec === undefined ? undefined : Math.round(patch.endSec * 1000),
    tags: patch.tags,
    observation: patch.observation,
    suggestion: patch.suggestion,
  })
  return toLocalSegment(updated)
}

/** 删除片段。 */
export async function deleteSegment(segmentId: string): Promise<void> {
  await studioHttpApi().library.reference.deleteSegment(segmentId)
}

/** 收藏 / 取消收藏。收藏只是个人标记，不代表「已采用」。 */
export async function setFavorite(segmentId: string, favorited: boolean): Promise<void> {
  await studioHttpApi().library.reference.updatePreferences({ segmentId, favorited })
}

/** 记一次浏览。失败不抛：浏览记录不该阻断用户。 */
export async function touchRecent(segmentId: string): Promise<void> {
  try {
    await studioHttpApi().library.reference.updatePreferences({ segmentId, viewed: true })
  } catch {
    /* 静默 */
  }
}

/** 读取偏好（收藏与最近浏览）。 */
export async function loadPreferences(): Promise<{ favorites: string[]; recent: string[] }> {
  return studioHttpApi().library.reference.getPreferences()
}

/** 集合。 */
export async function listCollections(): Promise<Array<{
  id: string; name: string; note: string; segmentIds: string[]
}>> {
  return studioHttpApi().library.reference.listCollections()
}

export async function createCollection(
  name: string,
  note: string,
  segmentIds: string[],
): Promise<{ id: string; name: string; note: string; segmentIds: string[] }> {
  return studioHttpApi().library.reference.createCollection({ name, note, segmentIds })
}

export async function updateCollection(
  id: string,
  patch: { name?: string; note?: string; segmentIds?: string[] },
): Promise<void> {
  await studioHttpApi().library.reference.updateCollection(id, patch)
}

export async function deleteCollection(id: string): Promise<void> {
  await studioHttpApi().library.reference.deleteCollection(id)
}

/**
 * 发起自动分析。
 *
 * <p>后端当前如实返回 422 `capability_unavailable`。这里**不吞掉**这个结果 ——
 * 调用方需要据此告诉用户「还没接入」，而不是显示「分析中」然后永远没有结果。</p>
 */
export async function analyzeVideo(videoId: string): Promise<void> {
  await studioHttpApi().library.reference.analyzeVideo(videoId)
}

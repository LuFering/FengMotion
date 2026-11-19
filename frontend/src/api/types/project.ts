/** API 契约 · 项目。纯类型，规则见 api/contracts.ts 文件头。 */
import type { DemoFlag, Id, IsoDateTime, PageQuery } from './common'

/* ============================ 项目 ============================ */

export type ProjectStage = 'idea' | 'draft' | 'editing' | 'rendering' | 'done'

export interface ProjectCounts {
  scenes: number
  /** 定稿场景数。 */
  doneScenes: number
  /** 分镜表规划段数。 */
  storyboardSegments: number
  /** 已生成的合成文件数。 */
  compositions: number
  /** 当前成片时间轴片段数。 */
  timelineClips: number
}

export interface ProjectSummary {
  id: Id
  name: string
  /** 一句话：这片子讲什么。 */
  tagline: string
  stage: ProjectStage
  /** 片型画像 ID（六选一），未定为 null。 */
  genomeId: string | null
  /** 当前成片时长；未排完时为 0。 */
  durationMs: number
  /** 目标时长；未定目标时字段不出现。 */
  targetDurationMs?: number
  counts: ProjectCounts
  coverUrl: string | null
  /** 项目根目录绝对路径，用于「在文件管理器中打开」。 */
  rootPath: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  /** true = 只存在于本次会话、尚未落盘。UI 必须标「仅本次会话有效」。 */
  planned?: true
  etag: string
  demo?: DemoFlag
}

export interface ProjectSettings {
  width: number
  height: number
  fps: number
  targetDurationMs: number
  genomeId: string | null
}

export interface ProjectDetail extends ProjectSummary {
  settings: ProjectSettings
}

export interface ProjectCreateRequest {
  name: string
  genomeId?: string
  targetDurationMs?: number
  /** 不传则用 workspaceRoot 下的默认目录。 */
  rootPath?: string
}

/** 条件更新：请求头带 `If-Match: <etag>`，不匹配返回 `precondition_failed`。 */
export interface ProjectUpdateRequest {
  name?: string
  tagline?: string
  stage?: ProjectStage
  genomeId?: string | null
  targetDurationMs?: number
}

export interface ProjectListQuery extends PageQuery {
  stage?: ProjectStage
  q?: string
  sort?: 'updated_desc' | 'updated_asc' | 'name_asc'
}

/** 成片时间轴的一段。时间单位毫秒，`startMs` 相对成片零点。 */
export interface TimelineClip {
  id: Id
  sceneId: Id
  startMs: number
  durationMs: number
  track: number
  title: string
  /** 可直接播放的媒体 URL；没有可播放来源时不出现。 */
  sourceUrl?: string
}

export interface Timeline {
  projectId: Id
  fps: number
  width: number
  height: number
  /** 成片总时长（毫秒）。 */
  durationMs: number
  clips: TimelineClip[]
  /** assembly = 真实组装时间轴；demo = 演示数据。 */
  source: 'assembly' | 'demo'
  etag: string
}

export type SceneStatus = 'done' | 'running' | 'waiting' | 'failed' | 'idle' | 'untracked'

/** 场景（通用层叫法）。范式层的「镜头」在 05 期前仍可能出现在实现内部，不进口径。 */
export interface Scene {
  id: Id
  projectId: Id
  /** 从 1 开始的展示序号。 */
  index: number
  /** 卡片短名（如 s01）。 */
  label: string
  title: string
  durationMs: number
  /** 在成片时间轴上的起点；未入时间轴为 null。 */
  startMs: number | null
  thumbnailUrl: string | null
  status: SceneStatus
  note: string
  /** 合成页 URL；没有合成文件为 null。 */
  compositionUrl: string | null
  storyboardId: Id | null
  inTimeline: boolean
  /** false = 时长只是估算，UI 必须标注「未实测」。 */
  timingKnown: boolean
}

export interface StoryboardEntry {
  id: Id
  projectId: Id
  /** 段号（如「第 12 段」）。 */
  segment: string
  /** 原始时间码文本，保持分镜表原样，不解析成数值。 */
  timecode: string
  /** 原始时长文本。 */
  duration: string
  narration: string
  visual: string
  motion: string
  transition: string
  act: string
}

export type ShotMotion = 'rise' | 'fade' | 'slide' | 'none'
export type ShotAlign = 'left' | 'center' | 'right'

/** 场景内可编辑的字幕/版式参数，按项目持久化。 */
export interface ShotSettings {
  title: string
  subtitle: string
  accent: string
  fontScale: number
  motion: ShotMotion
  align: ShotAlign
  durationSeconds: number
}

export interface ShotOverride {
  projectId: Id
  sceneId: Id
  settings: ShotSettings
  updatedAt: IsoDateTime
  etag: string
}

export type ArtifactType = 'content-contract' | 'lookdev' | 'film-plan' | 'qa'
export type ArtifactStatus = 'confirmed' | 'draft' | 'needs-review'

/** 工作台产物：可审阅、可引用的版本化文档。 */
export interface WorkbenchArtifact {
  id: Id
  projectId: Id
  type: ArtifactType
  title: string
  /** 展示版本号（如 v3），与 WorkflowDefinition.version 无关。 */
  version: string
  status: ArtifactStatus
  updatedAt: IsoDateTime
  summary: string
  body: string
  relatedSceneIds: Id[]
  etag: string
  demo?: DemoFlag
}

/** 项目版本/来源。restorable=false 表示只读来源，恢复动作必须禁用。 */
export interface ProjectVersion {
  id: Id
  projectId: Id
  name: string
  /** 来源描述（文件名、分支、快照 ID）。 */
  source: string
  kind: 'render' | 'storyboard' | 'snapshot'
  createdAt: IsoDateTime
  summary: string
  restorable: boolean
  demo?: DemoFlag
}

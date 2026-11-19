/** API 契约 · 任务。纯类型，规则见 api/contracts.ts 文件头。 */
import type { DemoFlag, Id, IsoDateTime, PageQuery } from './common'

/* ============================ 任务 ============================ */

/**
 * 任务种类。undo/redo/restore 是对已发生变更的反向操作，同样走任务通道。
 * check / analyze 是 06 期与参考片解析的入口；能力未接入时后端返回 capability_unavailable。
 */
export type TaskKind = 'modify' | 'render' | 'check' | 'analyze' | 'undo' | 'redo' | 'restore'

/**
 * 任务状态（产品可见口径，由 WorkflowRunStatus 派生，不独立演进）。
 * building 是 running 的子阶段：编译/构建阶段仍属运行中，只是提示更具体。
 */
export type TaskStatus = 'queued' | 'running' | 'building' | 'completed' | 'failed' | 'cancelled'

/** 事件种类与状态迁移一一对应，事件是状态迁移的唯一可观察出口。 */
export type TaskEventKind = 'accepted' | 'progress' | 'build' | 'complete' | 'error' | 'cancelled'

export interface ModificationConstraints {
  preserveCamera: boolean
  preserveCaptions: boolean
  limitToSelection: boolean
  reuseExistingComponents: boolean
  durationSeconds?: number
  resolution?: '1080p' | '1440p' | '4k'
}

/**
 * 结构化引用：Agent 修改的对象 + 它需要读取的上下文。
 * 位置一律用稳定 ID / 精确帧 / 归一化区域 / 产物版本表示，不让模型从「这里/这段」猜。
 */
export type AgentReference =
  | { id: string; role: 'target' | 'context'; kind: 'project'; projectId: Id; label: string; action?: string }
  | { id: string; role: 'target' | 'context'; kind: 'scene'; sceneId: Id; label: string; action?: string }
  | { id: string; role: 'target' | 'context'; kind: 'frame'; sceneId: Id; frame: number; timecode: string; label: string; snapshotId?: Id }
  | { id: string; role: 'target' | 'context'; kind: 'range'; sceneId: Id; startFrame: number; endFrame: number; timecode: string; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'region'; sceneId: Id; frame: number; bbox: { x: number; y: number; w: number; h: number }; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'artifact'; artifactId: Id; version: string; label: string }
  /*
   * 三库资源引用（素材 / 参考片 / 特效）。
   *
   * 与上面的项目、场景、帧同属「用户明确指给 agent 的东西」，所以放在同一个
   * 联合里而不是另开一套 —— agent 侧只需要认一种结构。
   *
   * 三者必须能区分：素材是「这份文件要用在画面里」，参考片是「借鉴这段的手法
   * （可能明确不要用它的画面）」，特效是「按这种技法做」。把它们压成同一种
   * `kind: 'file'` 会让 agent 只能猜用户到底要哪一种。
   */
  | {
      id: string
      role: 'target' | 'context'
      kind: 'asset'
      assetId: Id
      /**
       * 用户选定的用途。取值与界面层的 `AssetPurpose` 一致，但契约层不反向
       * 依赖界面模块，所以在这里内联声明。
       */
      purpose?: 'unspecified' | 'visual' | 'reference' | 'audio' | 'information'
      /** 用户对这份素材的补充说明。 */
      note?: string
      label: string
    }
  | {
      id: string
      role: 'target' | 'context'
      kind: 'reference'
      segmentId: Id
      /** 所属参考片；只说「片段 2」agent 不知道是哪段视频的。 */
      videoId?: Id
      /** 时间范围（毫秒，与项目侧时间口径一致）。 */
      startMs?: number
      endMs?: number
      /** 用户想借鉴或明确要避开的内容。 */
      wants?: string
      avoid?: string
      label: string
    }
  | {
      id: string
      role: 'target' | 'context'
      kind: 'technique'
      techniqueId: Id
      /** 技法版本；未记录时省略，不编一个。 */
      version?: string
      /** 用户是否希望按这种技法执行，还是只作参考。 */
      intent?: 'apply' | 'reference'
      label: string
    }

export interface TaskAttachment {
  name: string
  mimeType: string
  sizeBytes: number
  /** 已上传文件的 ID；仅元信息时为 undefined。 */
  fileId?: Id
}

export type TaskScope = 'project' | 'scene' | 'selection'

/** 渲染参数。 */
export interface RenderPreset {
  resolution: '1080p' | '1440p' | '4k'
  fps: number
  format: 'mp4' | 'webm'
  quality: 'draft' | 'standard' | 'high'
}

/**
 * 任务请求。任务创建挂在项目路径下（`POST /projects/{projectId}/tasks`），
 * 因此请求体不再重复携带 projectId。
 */
export interface TaskRequest {
  kind: TaskKind
  prompt: string
  scope: TaskScope
  sceneIds: Id[]
  references: AgentReference[]
  constraints: ModificationConstraints
  attachments: TaskAttachment[]
  /** kind=render 时必填。 */
  render?: { preset: RenderPreset; range?: { startMs: number; endMs: number } }
  /** kind=check 时必填：检查哪个产物版本。 */
  check?: { renderId: Id; categories?: string[] }
  /** kind=analyze 时必填：解析哪个参考片。 */
  analyze?: { referenceVideoId: Id }
  /** kind=restore 时必填。 */
  restore?: { versionId: Id }
}

export interface TaskError {
  code: string
  message: string
  retryable: boolean
}

export interface AgentTask {
  id: Id
  projectId: Id
  kind: TaskKind
  status: TaskStatus
  title: string
  /** 0–100；后端无法给出可信进度时不出现，不用假百分比。 */
  progress?: number
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  /** 仅 failed 存在。 */
  error?: TaskError
  demo?: DemoFlag
}

/**
 * 任务事件。`seq` 单调递增，断线重连以 `Last-Event-ID`（上一事件的 seq）续传；
 * `message` 只描述可观察操作，不得包含模型推理过程。
 */
export interface TaskEvent {
  id: Id
  seq: number
  taskId: Id
  kind: TaskEventKind
  status: TaskStatus
  message: string
  at: IsoDateTime
  /** 事件附带的机器可读信息（如变更文件数、当前节点），形状由 kind 决定。 */
  data?: Record<string, unknown>
  demo?: DemoFlag
}

export interface ChangeSetFile {
  path: string
  summary: string
  additions: number
  deletions: number
}

export interface ChangeSet {
  taskId: Id
  /** 一句话概括本次改动；无改动时为「无文件变更」。 */
  summary: string
  files: ChangeSetFile[]
  buildStatus: 'not-run' | 'passed' | 'failed'
  demo?: DemoFlag
}

/** 任务创建成功后的关联句柄，避免前端再发三次请求。 */
export interface TaskAcceptedResponse {
  task: AgentTask
  runId?: Id
  checkRunId?: Id
  renderId?: Id
}

export interface TaskListQuery extends PageQuery {
  status?: TaskStatus
  kind?: TaskKind
  sort?: 'created_desc' | 'created_asc'
}

/** API 契约 · 知识库。纯类型，规则见 api/contracts.ts 文件头。 */
import type { DemoFlag, Id, IsoDateTime, PageQuery } from './common'

/* ============================ 知识库 ============================ */

export type FxCategory = 'camera' | 'transition' | 'lighting' | 'particles' | 'compositing' | 'stylize' | 'typography'
export type FxExecType = 'runnable' | 'composable' | 'reference'
export type FxImpl = 'realtime' | 'offline' | 'ai' | 'composite'
export type FxInputKind = 'image' | 'video' | 'audio' | 'text'

export interface FxParam {
  key: string
  label: string
  /** 源库默认值，已带单位。 */
  value: string
  hint: string
}

/**
 * 本机真实可执行状态（对账决定 D）。与 `execType` **完全不同**：
 * `execType` 是源库声明的能力标签，`executionStatus` 才回答「这台机器现在能不能跑」。
 * 默认全部 `not-implemented`；只有适配器与依赖真实存在才可标 `available`。
 * 界面不得因 `execType=runnable` 就显示「可执行」。
 */
export type FxExecutionStatus = 'declared' | 'not-implemented' | 'available'

/** 特效的用户状态（对账决定 D）：独立管理，不放进参考片偏好。 */
export interface FxUserState {
  favorited: boolean
  /** 最近浏览时间；从未浏览时不存在。 */
  lastViewedAt?: IsoDateTime
}

export interface FxTechnique {
  id: Id
  name: string
  nameEn: string
  aliases: string[]
  keywords: string[]
  intent: string
  category: FxCategory
  categoryLabel: string
  scenes: string[]
  antiScenes: string[]
  execType: FxExecType
  execLabel: string
  impl: FxImpl
  implLabel: string
  /** 1–5，源库口径。 */
  complexity: number
  inputKinds: FxInputKind[]
  inputLabels: string[]
  inputRequirement: string
  output: string
  dependencies: string[]
  steps: string[]
  compatibility: string[]
  limitations: string[]
  failures: string[]
  params: FxParam[]
  previewImageUrl: string
  previewVideoUrl: string | null
  previewCaption: string
  related: Id[]
  alternatives: Id[]
  featured: boolean
  version: string
  updatedAt: IsoDateTime
  /** 本机真实可执行状态；与 `execType` 无关，默认 not-implemented。 */
  executionStatus: FxExecutionStatus
  /** 用户收藏与最近浏览；独立于参考片偏好。 */
  userState?: FxUserState
  demo?: DemoFlag
}

export interface FxFacet {
  id: string
  label: string
  count: number
}

export interface FxFacets {
  categories: FxFacet[]
  execTypes: FxFacet[]
  impls: FxFacet[]
  inputKinds: FxFacet[]
}

export interface MethodStep {
  /** 卡面上只留这几个字。 */
  k: string
  /** 完整名字（悬停 / 无障碍用）。 */
  name: string
  judge: string
  star?: boolean
}

/** 一套做法：片型不同，做法不同。 */
export interface Method {
  name: string
  lead: string
  steps: MethodStep[]
}

/** 片型画像：对某类作品的抽象描述，不得冒充「已解析视频」。 */
export interface Genome {
  id: Id
  name: string
  from: '实测' | '规格'
  persona: string
  /** 可量指纹。 */
  fingerprint: Array<{ key: string; value: string }>
  traits: string[]
  note: string
  /** 该型的判据图（项目卡封面）。 */
  imageUrl?: string
  method: Method
  demo?: DemoFlag
}

export type ReferenceStatus = 'analyzed' | 'partial' | 'pending'

export interface ReferenceVideo {
  id: Id
  title: string
  durationMs: number
  source: string
  description: string
  tags: string[]
  thumbnailUrl?: string
  /** 视频级解析状态；镜头段各有自己的 status。 */
  status: ReferenceStatus
  createdAt: IsoDateTime
  demo?: DemoFlag
}

/**
 * 分析来源三分（对账决定 E）：`measured` 实测（切点/时长/亮度等可计算量）、
 * `model` 模型判断、`user` 用户填写。界面必须可区分，不得把模型判断显示成实测事实。
 */
export type AnalysisSource = 'measured' | 'model' | 'user'

/**
 * 单维分析值。
 *
 * 「不编造置信度和证据」不等于「不要证据」：有真实可追溯的帧/时间段/人工标注就存下来，
 * 没有就留空并置 pending，不填默认值冒充结果。
 */
export interface AnalysisValue {
  value: string
  /** 该值的来源；三分，界面必须可区分。 */
  source: AnalysisSource
  /** 0–1；无置信度时为 null，不用 0 冒充「确定」。 */
  confidence: number | null
  /** 可追溯依据：时间范围 `00:02-00:04`、帧号或人工标注原文。无依据时为空串，不许编造。 */
  evidence: string
  /** true = 该维度尚未解析；不得用默认值填充。 */
  pending: boolean
}

/**
 * 界面默认展示的六项（对账决定 E）。
 *
 * 后端允许保存有依据的其他技术维度，但：不强制模型填满、不强制界面全部展示、
 * 不作为工作流门槛。`reusable`（可借鉴什么及限制）与 `suggestion`（对当前创作的具体用法）
 * 语义不同，暂不合并。
 */
export type AnalysisKey =
  | 'cameraMove' | 'rhythm' | 'lighting' | 'composition' | 'transition' | 'reusable'

/** 后端可额外保存、界面默认不展示的技术维度；仅在确有依据时存在。 */
export type AnalysisExtraKey =
  | 'scale' | 'subjectMove' | 'color' | 'narrative' | 'shotType'

export interface ReferenceShot {
  id: Id
  videoId: Id
  index: number
  startMs: number
  endMs: number
  status: ReferenceStatus
  tags: string[]
  /** 观察事实（只写看得到的）。 */
  observation: string
  /** 模型推断（必须与观察分开呈现）。 */
  inference: string
  /**
   * 对当前这条创作的具体用法建议。与 `analysis.reusable` 语义不同：
   * `reusable` 说「可以借鉴什么及限制」，本字段说「这里具体怎么用」。缺依据就留空。
   */
  suggestion: string
  /** 界面默认展示的六项。 */
  analysis: Record<AnalysisKey, AnalysisValue>
  /**
   * 后端可额外保存、界面默认不展示的技术维度（对账决定 E）。
   * 仅在确有依据时存在，不强制模型填满，也不作为工作流门槛。
   */
  extraAnalysis?: Partial<Record<AnalysisExtraKey, AnalysisValue>>
}

export interface ReferenceCollection {
  id: Id
  name: string
  note: string
  shotIds: Id[]
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

/** 参考片库的个人偏好：收藏、最近浏览、集合成员关系。跨项目共享。 */
export interface ReferencePreference {
  favorites: Id[]
  recent: Id[]
  /** collectionId → shotIds */
  memberships: Record<Id, Id[]>
  etag: string
}

export interface ReferencePreferenceUpdate {
  favorites?: Id[]
  recent?: Id[]
  memberships?: Record<Id, Id[]>
}

export interface ReferenceShotQuery extends PageQuery {
  videoId?: Id
  status?: ReferenceStatus
  q?: string
  tags?: string[]
  sort?: 'source' | 'index' | 'duration_desc' | 'duration_asc'
}

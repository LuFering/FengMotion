/** API 契约 · 渲染与交付。纯类型，规则见 api/contracts.ts 文件头。 */
import type { DemoFlag, Id, IsoDateTime } from './common'
import type { RenderPreset, TaskError } from './task'

/* ============================ 渲染与交付 ============================ */

export type RenderStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface RenderOutput {
  fileId: Id
  url: string
  thumbnailUrl?: string
  durationMs: number
  sizeBytes: number
  width: number
  height: number
  fps: number
  createdAt: IsoDateTime
}

export interface RenderJob {
  renderId: Id
  projectId: Id
  taskId: Id
  status: RenderStatus
  preset: RenderPreset
  /** 仅 completed 存在。 */
  output?: RenderOutput
  error?: TaskError
  startedAt: IsoDateTime
  completedAt?: IsoDateTime
  demo?: DemoFlag
}

export interface RenderCreateRequest {
  preset: RenderPreset
  /** 只渲染某段；不传 = 全片。 */
  range?: { startMs: number; endMs: number }
}

/**
 * 交付状态。未组装/缺件时不得给下载入口，只能列出缺什么。
 * assembling 只是渲染/检查进行中，不等于可交付。
 */
export type DeliveryStatus =
  | 'unassembled'
  | 'assembling'
  | 'deliverable'
  | 'delivered'
  | 'missing'
  | 'acceptance_failed'

export interface DeliveryMissingItem {
  kind: 'scene' | 'render' | 'check' | 'asset' | 'acceptance'
  refId?: Id
  label: string
  /** 一句人话：缺什么、为什么。 */
  reason: string
}

export interface DeliveryState {
  projectId: Id
  status: DeliveryStatus
  /** 当前候选产物；尚未渲染时不出现。 */
  renderId?: Id
  missing: DeliveryMissingItem[]
  acceptance?: AcceptanceRecord
  updatedAt: IsoDateTime
  demo?: DemoFlag
}

export type AcceptanceDecision = 'accepted' | 'rejected'

export interface AcceptanceRecord {
  acceptanceId: Id
  projectId: Id
  renderId: Id
  decision: AcceptanceDecision
  note?: string
  /** 验收人标识（本地用户 ID，不是姓名）。 */
  decidedBy: string
  decidedAt: IsoDateTime
}

export interface AcceptanceRequest {
  decision: AcceptanceDecision
  note?: string
}

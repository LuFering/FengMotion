/** API 契约 · 素材。纯类型，规则见 api/contracts.ts 文件头。 */
import type { DemoFlag, Id, IsoDateTime, PageQuery } from './common'
import type { ResourceAvailability, ResourceProcessingStatus, ResourceRef, ResourceReviewStatus, ResourceSourceType } from './resource'

/* ============================ 素材 ============================ */

export type MediaType = 'image' | 'video' | 'audio' | 'font' | 'doc'

export type LicenseStatus = 'allowed' | 'attribution_required' | 'restricted' | 'unknown'

/**
 * 素材。授权状态与审核状态是两个独立字段：
 * 审核只改审核，不推断授权；无可靠授权信息一律 unknown。
 */
export interface Asset {
  id: Id
  name: string
  mediaType: MediaType
  mimeType: string
  sizeBytes: number
  sourceType: ResourceSourceType
  processingStatus: ResourceProcessingStatus
  /** 仅 processingStatus=failed 时存在。 */
  processingError?: string
  reviewStatus: ResourceReviewStatus
  availability: ResourceAvailability
  licenseStatus: LicenseStatus
  licenseDetails?: string
  width?: number
  height?: number
  durationMs?: number
  tags: string[]
  folderId: Id | null
  /** 归属项目；null 为未归属。归属只有一个，「被哪些项目用到」看 refs。 */
  projectId?: Id | null
  refs: ResourceRef[]
  /** 原始文件访问地址；需要鉴权时由后端签发短期 URL。 */
  fileUrl: string
  thumbnailUrl?: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  lastUsedAt?: IsoDateTime
  etag: string
  contentHash?: string
  demo?: DemoFlag
}

/**
 * 素材筛选面计数（`GET /assets/facets`）。
 *
 * 口径：**不受当前筛选影响**的全量计数。跟着筛选变的话，用户永远看不到
 * 其他分类还有多少东西，也就没机会切过去。
 *
 * 未出现的取值后端补 0，所以这些映射始终包含全部枚举值。
 */
export interface AssetFacets {
  total: number
  mediaTypes: Record<string, number>
  sourceTypes: Record<string, number>
  reviewStatus: Record<string, number>
  availability: Record<string, number>
  licenseStatus: Record<string, number>
  /** 归属项目 → 条数，只含至少有一条素材的项目。 */
  projects?: Record<string, number>
  unassigned?: number
}

export interface AssetFolder {
  id: Id
  name: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

/** 上传会话：分片上传，逐片确认；完成后生成 Asset。 */
export interface UploadSession {
  uploadId: Id
  fileName: string
  mimeType: string
  sizeBytes: number
  chunkSizeBytes: number
  receivedBytes: number
  status: 'created' | 'uploading' | 'completed' | 'failed' | 'cancelled'
  expiresAt: IsoDateTime
}

export interface AssetUpdateRequest {
  name?: string
  tags?: string[]
  folderId?: Id | null
  /** 三态：省略不改；空串改为未归属；非空归属该项目。 */
  projectId?: Id | null
  licenseStatus?: LicenseStatus
  licenseDetails?: string
  reviewStatus?: ResourceReviewStatus
  /** 停用/弃用由人显式操作；弃用不可逆。 */
  availability?: ResourceAvailability
}

export interface AssetListQuery extends PageQuery {
  mediaType?: MediaType
  sourceType?: ResourceSourceType
  folderId?: Id
  /** 项目 ID；传 `unassigned` 只看未归属。 */
  projectId?: string
  q?: string
  tags?: string[]
  sort?: 'recent' | 'name' | 'size' | 'created'
  include?: 'refs'
}

export interface AssetBatchUpdateRequest {
  ids: Id[]
  /** 省略表示不改；空串表示移回根目录；非空表示移入目标文件夹 */
  folderId?: Id | null
  /** 省略表示不改；空串改为未归属；非空归属该项目 */
  projectId?: Id | null
  addTags?: string[]
  removeTags?: string[]
}

export interface AssetBatchUpdateItemResult {
  id: Id
  ok: boolean
  asset?: Asset | null
  error?: string
}

export interface AssetBatchUpdateResult {
  results: AssetBatchUpdateItemResult[]
}

export interface AssetImportRequest {
  /** 桌面端按绝对路径导入（不经过浏览器上传）。 */
  filePath: string
  folderId?: Id
}

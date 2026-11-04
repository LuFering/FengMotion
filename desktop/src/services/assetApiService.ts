/**
 * 素材库的**服务端**数据源（替代 IndexedDB）。
 *
 * 为什么单独一层，而不是让视图直接调 `studioHttpApi().assets`：
 *   1. 视图用的是本地模型 `MyAsset`（`createdAt` 是毫秒数、有 `filePath`/`builtin` 等字段），
 *      后端用的是契约模型 `Asset`（ISO 8601、`fileUrl`/`demo`）。转换只在这里做一次，
 *      视图不必知道两套模型的差异，也不必到处补默认值。
 *   2. 转换里的每个「补默认值」都是风险点。这里的原则是：**读不到就如实留空/报错**，
 *      不把 0 或空串伪装成真实值 —— 否则「时长 0 秒」和「时长未知」在界面上无法区分。
 *
 * 与旧 `assetService.ts`（IndexedDB）的关系：两者接口形状刻意保持一致（`listAssets` 等），
 * 迁移完成前可以并存；迁移后 IndexedDB 只读保留，不再写入。
 */
import { studioHttpApi } from '@/services/api'
import type { Asset as ServerAsset, AssetUpdateRequest } from '@/types/contracts'
import type { LicenseStatus, MediaType, MyAsset, ReviewStatus, SourceType } from '@/data/myAssets'

/** 视图用的文件夹形状（与旧 IndexedDB 的 `FolderRow` 对齐，`createdAt` 仍是毫秒数）。 */
export interface FolderRow {
  id: string
  name: string
  createdAt: number
}

/** 后端审核状态与本地模型完全同名（五值），这里只做类型收窄，不映射取值。 */
function asReviewStatus(value: string): ReviewStatus {
  switch (value) {
    case 'none':
    case 'pending':
    case 'needs_review':
    case 'approved':
    case 'rejected':
      return value
    default:
      // 后端新增了本地还没跟上的取值：不猜，落在「未提审」而不是「已通过」。
      return 'none'
  }
}

function asSourceType(value: string): SourceType {
  // 契约有 sample，本地模型没有；演示标记由 demo 单独承载，来源仍按「内置」处理。
  if (value === 'imported') return 'imported'
  if (value === 'generated') return 'generated'
  return 'builtin'
}

function asLicenseStatus(value: string): LicenseStatus {
  switch (value) {
    case 'allowed':
    case 'attribution_required':
    case 'restricted':
    case 'unknown':
      return value
    default:
      return 'unknown'
  }
}

function asMediaType(value: string): MediaType {
  switch (value) {
    case 'image':
    case 'video':
    case 'audio':
    case 'font':
    case 'doc':
      return value
    default:
      return 'doc'
  }
}

/**
 * 把服务端素材转成视图模型。
 *
 * 时间：后端是 ISO 8601，视图用毫秒数（契约 README §6 的单位差异，在适配层转换）。
 * 文件地址：后端给的是相对路径，这里补成完整 URL —— `<video src>` / `<img src>`
 * 直接加载，打包态后端端口是动态的，拼相对路径会打到前端 dev server 上。
 */
function toMyAsset(asset: ServerAsset): MyAsset {
  return {
    id: asset.id,
    name: asset.name,
    // 视图用 filePath 走「内置素材」的直接路径分支；导入素材必须走 fileUrl，
    // 所以这里只在内置时填路径，导入时留空，由 getFileURL 提供真实地址。
    filePath: asset.sourceType === 'builtin' ? asset.fileUrl : '',
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    mediaType: asMediaType(asset.mediaType),
    thumbnailPath: asset.thumbnailUrl ?? undefined,
    // 后端没解析出时长时是 null：不填 0，否则界面会显示「0:00」而不是「未知」。
    duration: asset.durationMs == null ? undefined : asset.durationMs / 1000,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
    tags: asset.tags ?? [],
    folderId: asset.folderId ?? null,
    sourceType: asSourceType(asset.sourceType),
    licenseStatus: asLicenseStatus(asset.licenseStatus),
    licenseDetails: asset.licenseDetails ?? undefined,
    reviewStatus: asReviewStatus(asset.reviewStatus),
    createdAt: Date.parse(asset.createdAt),
    lastUsedAt: asset.lastUsedAt == null ? undefined : Date.parse(asset.lastUsedAt),
    refs: (asset.refs ?? []).map((ref) => ({
      kind: ref.kind === 'scene' ? 'project' : ref.kind,
      id: ref.id,
      label: ref.label,
    })),
    // 「内置」在视图里表示「种子素材，删除后不恢复」；服务端用 sourceType 表达来源，
    // 演示标记另有 demo 字段，这里按来源判断，不混同。
    builtin: asset.sourceType === 'builtin',
  }
}

/** 后端素材的完整访问地址（供 `<video>` / `<img>` 直接使用）。 */
export function assetContentUrl(assetId: string): string {
  return studioHttpApi().assets.contentUrl(assetId)
}

/** 素材内容地址缺失时的回退（内置种子素材可能只有外链）。 */
export function assetThumbUrl(assetId: string): string {
  return studioHttpApi().assets.thumbnailUrl(assetId)
}

/** 列出全部素材（分页取完）。 */
export async function listAssets(): Promise<MyAsset[]> {
  const api = studioHttpApi().assets
  const all: MyAsset[] = []
  let cursor: string | null | undefined
  // 逐页取完：素材库可能上百条，只取第一页会让界面少显示且没有任何提示。
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await api.list({ cursor: cursor ?? undefined, limit: 200 })
    for (const item of page.items) all.push(toMyAsset(item))
    cursor = page.nextCursor
    if (!cursor) break
  }
  return all
}

/** 文件夹列表。 */
export async function listFolders(): Promise<FolderRow[]> {
  const folders = await studioHttpApi().assets.folders.listFolders()
  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    createdAt: Date.parse(folder.createdAt),
  }))
}

/**
 * 更新素材。
 *
 * 视图传的是本地补丁（`{ tags }` / `{ folderId }` / `{ lastUsedAt }` 等），
 * 这里翻译成契约请求。**注意 `folderId: null` 表示「移回根目录」，不是「不改」**，
 * 所以只有补丁里真的带了 folderId 才转发。
 */
export async function updateAsset(id: string, patch: Partial<MyAsset>): Promise<void> {
  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.tags !== undefined) body.tags = patch.tags
  if (patch.folderId !== undefined) body.folderId = patch.folderId ?? ''
  if (patch.licenseStatus !== undefined) body.licenseStatus = patch.licenseStatus
  if (patch.licenseDetails !== undefined) body.licenseDetails = patch.licenseDetails
  if (patch.reviewStatus !== undefined) body.reviewStatus = patch.reviewStatus
  // 处理状态正常由解析任务写；迁移场景需要把「旧版已解析完的素材」标为 ready，
  // 否则它的审核状态永远无法写入（契约要求先 ready 才能通过审核）。
  if ((patch as { processingStatus?: string }).processingStatus !== undefined) {
    body.processingStatus = (patch as { processingStatus?: string }).processingStatus
  }
  // 「最近使用」由服务端按 touchLastUsed 置为当前时间，不接受客户端指定时刻。
  if (patch.lastUsedAt !== undefined) body.touchLastUsed = true
  if (Object.keys(body).length === 0) return

  const api = studioHttpApi().assets
  // 乐观锁必须带当前 etag：不带就会用旧状态覆盖别处的修改。
  const current = await api.get(id)
  await api.update(id, body as AssetUpdateRequest, current.etag)
}

/** 批量删除：逐项结果由服务端返回，这里只把失败的原因抛出给调用方展示。 */
export async function removeAssets(ids: string[]): Promise<{ failed: { id: string; error: string }[] }> {
  const result = await studioHttpApi().assets.batchRemove(ids)
  const failed = result.results
    .filter((item) => !item.ok)
    .map((item) => ({ id: item.id, error: item.error ?? '删除失败' }))
  return { failed }
}

/**
 * 导入文件。
 *
 * 走单请求 multipart（后端 `POST /assets`）。进度按「第几个文件」报告而不是百分比：
 * 服务端不返回单请求上传的中间进度，编一个百分比不如如实说「正在读取第 2 / 5 个」。
 *
 * 命中去重时后端返回已有素材且 `deduped=true`，这里不额外提示 —— 由调用方按
 * 「本次导入 N 个，其中 M 个已存在」的方式展示。
 */
export interface ImportFailure {
  name: string
  error: string
}

/**
 * 导入文件。
 *
 * 走单请求 multipart（后端 `POST /assets`）。进度按「第几个文件」报告而不是百分比：
 * 服务端不返回单请求上传的中间进度，编一个百分比不如如实说「正在读取第 2 / 5 个」。
 *
 * **失败不抛出，而是通过回调与返回值一并报告**：界面上一个文件失败不该让整批中断。
 * 但调用方必须能看到失败原因 —— 迁移场景需要它，否则失败会被报成含糊的
 * 「服务端未返回素材」，掩盖真正原因（例如类型不支持、连接失败）。
 */
export async function importFiles(
  files: File[],
  onEvent: (e: { phase: 'queued' | 'reading' | 'done' | 'error'; name: string; index: number; error?: string }) => void,
): Promise<{ created: MyAsset[]; failed: ImportFailure[] }> {
  const api = studioHttpApi().assets
  const created: MyAsset[] = []
  const failed: ImportFailure[] = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    onEvent({ phase: 'reading', name: file.name, index })
    try {
      // uploadFile 只回传 uploadId/assetId，完整对象要再取一次。
      // assetId 为 null 说明服务端没生成素材（例如去重未命中且合并失败），如实报错。
      const result = await api.uploadFile(file)
      if (!result.assetId) {
        throw new Error('服务端未返回素材 ID')
      }
      const asset = await api.get(result.assetId)
      created.push(toMyAsset(asset))
      onEvent({ phase: 'done', name: file.name, index })
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败'
      failed.push({ name: file.name, error: message })
      onEvent({ phase: 'error', name: file.name, index, error: message })
    }
  }
  return { created, failed }
}

/** 新建文件夹。 */
export async function createFolder(name: string): Promise<FolderRow> {
  const folder = await studioHttpApi().assets.folders.createFolder(name)
  return { id: folder.id, name: folder.name, createdAt: Date.parse(folder.createdAt) }
}

/** 重命名文件夹。 */
export async function renameFolder(id: string, name: string): Promise<void> {
  await studioHttpApi().assets.folders.renameFolder(id, name)
}

/** 删除文件夹；返回被移回根目录的素材数。 */
export async function deleteFolder(id: string): Promise<void> {
  // 后端会把文件夹内的素材移回根目录并返回 movedAssets；
  // 客户端契约未冻结该响应，这里不依赖它的具体字段。
  await studioHttpApi().assets.folders.removeFolder(id)
}

/** 打开素材本体所需的地址（`<video>` / `<img>` / 新窗口打开共用）。 */
export async function getFileURL(id: string): Promise<string | null> {
  return assetContentUrl(id)
}

/** 缩略图地址；没有缩略图时返回 null，界面回退到类型图标。 */
export async function getThumbURL(id: string): Promise<string | null> {
  try {
    const asset = await studioHttpApi().assets.get(id)
    return asset.thumbnailUrl ? assetThumbUrl(id) : null
  } catch {
    return null
  }
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`
}

export function formatDur(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 内置种子已由后端提供，前端不再往库里种数据。保留空实现让调用方无需分支。 */
export async function initLibrary(): Promise<void> {
  // 服务端素材库无需客户端初始化；这里刻意留空而不是删掉调用点，
  // 因为迁移期两个数据源可能并存，调用点保持统一形状更容易替换。
}

/** 采集内置素材海报：服务端已提供 thumbnail，前端不再截帧。 */
export async function captureBuiltinPoster(): Promise<string | null> {
  return null
}

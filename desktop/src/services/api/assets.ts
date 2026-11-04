/**
 * 素材域客户端：素材列表/详情/更新/删除、文件夹、分片上传。
 *
 * 依据：`docs/contracts/asset.md`（§2 字段、§3 端点、§4 文件访问）与
 * `docs/contracts/README.md`（§2.5 分页、§2.7 并发与幂等、§2.8 文件与上传、§3.7 端点总表）。
 *
 * 三条不能让步的规则（集中写在这里，避免每个调用方各理解一遍）：
 * 1. **进度只认服务端**：分片大小只能用会话返回的 `chunkSizeBytes`，已收字节只能用
 *    会话/分片响应里的 `receivedBytes`（README §2.8）；客户端不假设分片大小、不估算百分比。
 * 2. **删除不静默级联**：素材被项目/工作流引用时服务端返回 409 并列出引用方（README §2.7），
 *    本层如实抛出 `ApiError`（引用方在 `details` 里），不吞错、不假装成功。
 * 3. **能力未接就是未接**：路径导入等桌面端能力在远程后端返回 422 `capability_unavailable`
 *    （asset.md §3.3），原样抛出，不换成空结果或演示数据。
 */
import type { HttpClient } from './http'
import type { UploadOptions, UploadProgress, UploadResult } from './types'
import type {
  Asset,
  AssetFolder,
  AssetImportRequest,
  AssetListQuery,
  AssetUpdateRequest,
  Page,
  UploadSession,
} from '@/types/contracts'
import { ApiError } from './errors'
import { asPage } from './pagination'

/* ============================ 本地传输类型 ============================ */

/** 建会话请求体：形状取自 asset.md §3.2；`src/types/contracts.ts` 只冻结了响应 `UploadSession`。 */
export interface UploadSessionCreateRequest {
  fileName: string
  mimeType: string
  sizeBytes: number
  folderId?: string | null
}

/** `PUT .../chunks/{index}` 的选项。`Content-Range` 由调用方给出：本层不替服务端决定分片大小。 */
export interface UploadChunkOptions {
  contentRange: string
  signal?: AbortSignal
}

/** 批量删除的逐项结果。契约 asset.md §3.4 只约定「207 + 逐项结果」，字段名未冻结。 */
export interface AssetBatchRemoveItemResult {
  id: string
  ok: boolean
  error?: string
}

export interface AssetBatchRemoveResult {
  results: AssetBatchRemoveItemResult[]
  /** true 仅当确实「有成功项且也有失败项」；全成功、全失败、读不出逐项结果都为 false。 */
  partial: boolean
}

/** 分片响应里能读到的服务端确认信息；读不到就是 `null`，绝不用 0 或估算值顶替。 */
interface UploadChunkAck {
  receivedBytes: number | null
  chunkSizeBytes: number | null
}

/* ============================ 响应解析（保守：读不出就不认） ============================ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const raw = record[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

function readText(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const raw = record[key]
    if (typeof raw === 'string' && raw.trim() !== '') return raw
  }
  return null
}

function readFlag(record: Record<string, unknown>, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    const raw = record[key]
    if (typeof raw === 'boolean') return raw
  }
  return null
}

function readStringList(record: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const raw = record[key]
    if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string')
  }
  return []
}

/**
 * 读分片响应里的「服务端已确认字节数」。
 *
 * 契约没有冻结该响应的字段名（asset.md §3.2 只说 `Content-Range` 与逐片确认），
 * 所以按最保守的方式依次认三种形状：响应体自身、`{ upload: {...} }`、`{ session: {...} }`；
 * 都读不到返回 `null`，由调用方决定退化策略 —— 不折算成 0，也不估算。
 */
function parseChunkAck(payload: unknown): UploadChunkAck {
  if (!isRecord(payload)) return { receivedBytes: null, chunkSizeBytes: null }
  const candidates: Record<string, unknown>[] = [payload]
  for (const key of ['upload', 'session', 'uploadSession']) {
    const nested = payload[key]
    if (isRecord(nested)) candidates.push(nested)
  }
  for (const candidate of candidates) {
    const receivedBytes = readNumber(candidate, 'receivedBytes')
    const chunkSizeBytes = readNumber(candidate, 'chunkSizeBytes')
    if (receivedBytes !== null || chunkSizeBytes !== null) return { receivedBytes, chunkSizeBytes }
  }
  return { receivedBytes: null, chunkSizeBytes: null }
}

/** 从 207/200 的响应体里抽出「每个 id 的结果」；抽不出返回 null（由调用方按状态码决策）。 */
function extractPerItemResults(payload: unknown): Map<string, AssetBatchRemoveItemResult> | null {
  if (!isRecord(payload)) return null
  const collected = new Map<string, AssetBatchRemoveItemResult>()

  // 形状一（首选）：{ results: [{ id, ok | deleted | success, error? }] }
  const results = payload.results
  if (Array.isArray(results)) {
    for (const raw of results) {
      if (!isRecord(raw)) continue
      const id = readText(raw, ['id', 'assetId'])
      if (id === null) continue
      const okFlag = readFlag(raw, ['ok', 'success', 'deleted', 'removed'])
      const errorText = readText(raw, ['error', 'message', 'reason'])
      if (errorText !== null) {
        collected.set(id, { id, ok: false, error: errorText })
        continue
      }
      if (okFlag !== null) {
        collected.set(id, { id, ok: okFlag })
        continue
      }
      // 既没有成功标记也没有失败原因：不能当成功（会漏报失败），标记为未确认
      collected.set(id, { id, ok: false, error: '服务端该项结果里既没有成功标记也没有失败原因。' })
    }
    return collected.size > 0 ? collected : null
  }

  // 形状二：{ deleted|succeeded: [id], failed|errors: [{ id, error } | id] }
  const okIds = readStringList(payload, ['deleted', 'succeeded', 'removed', 'ok'])
  const failedRaw = payload.failed ?? payload.errors
  if (okIds.length > 0 || Array.isArray(failedRaw)) {
    for (const id of okIds) collected.set(id, { id, ok: true })
    if (Array.isArray(failedRaw)) {
      for (const raw of failedRaw) {
        if (typeof raw === 'string') {
          collected.set(raw, { id: raw, ok: false, error: '服务端没有给出这项的失败原因。' })
          continue
        }
        if (!isRecord(raw)) continue
        const id = readText(raw, ['id', 'assetId'])
        if (id === null) continue
        collected.set(id, {
          id,
          ok: false,
          error: readText(raw, ['error', 'message', 'reason']) ?? '服务端没有给出这项的失败原因。',
        })
      }
    }
    return collected.size > 0 ? collected : null
  }

  return null
}

/**
 * 组装批量删除结果。
 *
 * `207 Multi-Status` 在 fetch 里算 2xx（`response.ok` 为 true），所以「部分失败」必须由本层
 * 从响应体里读出来，不能只看状态码。三种情况分开处理，任何一种都不许只报成功：
 * - 有逐项结果 → 按项如实返回；请求里出现但响应里没有的 id 记为未确认失败（不静默算成功）；
 * - 无逐项结果且非 207 → HTTP 层已确认整批成功（4xx/5xx 在 http.ts 里抛错），全部记成功；
 * - 无逐项结果但是 207 → 服务端说「部分失败」却没给细节，只能整体记为未确认失败。
 */
function buildBatchRemoveResult(
  payload: unknown,
  status: number,
  ids: readonly string[],
): AssetBatchRemoveResult {
  const perItem = extractPerItemResults(payload)
  const results: AssetBatchRemoveItemResult[] = perItem
    ? ids.map(
        (id): AssetBatchRemoveItemResult =>
          perItem.get(id) ?? { id, ok: false, error: '服务端没有返回这项的结果。' },
      )
    : ids.map((id): AssetBatchRemoveItemResult => ({
        id,
        ok: status !== 207,
        ...(status === 207
          ? { error: '服务端返回 207（部分失败），但响应里没有可解析的逐项结果。' }
          : {}),
      }))
  return { results, partial: results.some((item) => item.ok) && results.some((item) => !item.ok) }
}

/* ============================ 上传编排工具 ============================ */

function readPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const int = Math.floor(value)
  return int > 0 ? int : null
}

/** Blob 没有文件名，只有 File 有。缺名时用 MIME 推一个后缀，绝不编造本机路径。 */
function resolveFileName(file: Blob & { name?: string }): string {
  const name = typeof file.name === 'string' ? file.name.trim() : ''
  if (name !== '') return name
  const mime = file.type.toLowerCase()
  const ext = mime.includes('png')
    ? '.png'
    : mime.includes('jpeg')
      ? '.jpg'
      : mime.includes('webm')
        ? '.webm'
        : mime.includes('mp4')
          ? '.mp4'
          : mime.includes('wav')
            ? '.wav'
            : mime.includes('mpeg')
              ? '.mp3'
              : ''
  return `upload-${Date.now()}${ext}`
}

/**
 * 把服务端确认的字节数向下对齐到分片边界。
 *
 * 中断时最后一片可能只收了一半：若从「半片」继续，`Content-Range` 会与已收内容错位，
 * 所以续传从该分片的**起点**重传（README §2.8 要求按会话返回的分片大小切片）。
 * 同时夹到文件大小以内，避免服务端数字异常导致越界切片。
 */
function alignReceivedBytes(raw: unknown, chunkSizeBytes: number, sizeBytes: number): number {
  const value = readPositiveInt(raw)
  if (value === null) return 0
  const clamped = Math.min(value, sizeBytes)
  return Math.floor(clamped / chunkSizeBytes) * chunkSizeBytes
}

/* ============================ 资源 ============================ */

export function createAssetsResource(http: HttpClient) {
  function assetPath(assetId: string): string {
    return `/assets/${encodeURIComponent(assetId)}`
  }

  function uploadPath(uploadId: string): string {
    return `/assets/uploads/${encodeURIComponent(uploadId)}`
  }

  /* ---------------- 上传：分片写入与确认读取 ---------------- */

  /**
   * 发送一片并读回服务端确认信息。
   *
   * 为什么内部留一个「带确认」的版本、而公开的 `uploads.uploadChunk` 返回 `void`：
   * 编排需要的 `receivedBytes` 只能来自服务端（README §2.8），所以这里返回解析结果；
   * 对外的单次分片接口保持无返回，避免调用方误以为可以自己算进度。
   */
  async function putChunk(
    uploadId: string,
    index: number,
    chunk: Blob,
    options: UploadChunkOptions,
  ): Promise<UploadChunkAck> {
    const response = await http.request<unknown>('PUT', `${uploadPath(uploadId)}/chunks/${index}`, {
      body: chunk,
      headers: {
        // asset.md §3.2：分片固定二进制流 + Content-Range 标明范围
        'Content-Type': 'application/octet-stream',
        'Content-Range': options.contentRange,
      },
      signal: options.signal,
    })
    return parseChunkAck(response.data)
  }

  /**
   * 读上传会话（断点续传的唯一入口）。
   *
   * ⚠️ **契约缺口（需评审）**：README §3.7 的上传端点只有「建会话 / PUT 分片 / complete / DELETE」，
   * 没有「读会话状态」；而续传必须拿到服务端权威的 `chunkSizeBytes` 与 `receivedBytes`
   * （README §2.8 禁止客户端假设分片大小）。这里用只读、无副作用的
   * `GET /assets/uploads/{uploadId}`，并在 `docs/dev/前后端协议.md` 的本地扩展节登记待回写契约。
   * 服务端没有该端点时如实抛 404/405，**不静默改成「新建会话」** —— 那会把续传变成重复上传。
   */
  function readUploadSession(uploadId: string, signal?: AbortSignal): Promise<UploadSession> {
    return http.get<UploadSession>(uploadPath(uploadId), { signal })
  }

  /* ---------------- uploadFile 编排 ---------------- */

  /**
   * 端到端分片上传：建会话（或复用 `options.uploadId` 续传）→ 按服务端分片大小逐片上传 → 完成。
   *
   * 进度与续传都不许造假（README §2.8、asset.md §3.2）：
   * - 分片大小只用会话返回的 `chunkSizeBytes`；读不到就如实失败，不自定一个；
   * - `onProgress` 只回传服务端已确认的字节数：优先用分片响应里的 `receivedBytes`，
   *   响应没带该字段时退化为「本次 2xx 已确认的分片区间上界」（这一段是服务端确认收到的），
   *   两者都没有则请求根本没成功，会先抛错；
   * - 续传从服务端 `receivedBytes` 之后、落在分片边界上继续；
   * - 若服务端确认字节数不前进（重复接收同一片），立即停止并报错，不做死循环重传。
   */
  async function uploadFile(
    file: Blob & { name?: string },
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    const sizeBytes = file.size
    const fileName = resolveFileName(file)
    const mimeType = file.type !== '' ? file.type : 'application/octet-stream'

    const session = options.uploadId
      ? await readUploadSession(options.uploadId, options.signal)
      : await uploads.createUploadSession({
          fileName,
          mimeType,
          sizeBytes,
          folderId: options.folderId ?? null,
        })

    const uploadId = session.uploadId
    const chunkSizeBytes = readPositiveInt(session.chunkSizeBytes)
    if (chunkSizeBytes === null) {
      throw ApiError.transport(
        'internal_error',
        '服务端没有返回可用的分片大小（chunkSizeBytes），为避免客户端擅自切片，已停止上传。',
      )
    }

    let receivedBytes = alignReceivedBytes(session.receivedBytes, chunkSizeBytes, sizeBytes)
    let lastChunkIndex = receivedBytes > 0 ? Math.floor((receivedBytes - 1) / chunkSizeBytes) : -1

    const report = (): void => {
      const progress: UploadProgress = { uploadId, receivedBytes, sizeBytes, lastChunkIndex }
      options.onProgress?.(progress)
    }
    // 先报一次服务端水位（可能是 0），让界面从一开始显示的就是真实值而不是本地猜测
    report()

    while (receivedBytes < sizeBytes) {
      const index = Math.floor(receivedBytes / chunkSizeBytes)
      const start = index * chunkSizeBytes
      if (start >= sizeBytes) break // 防御：理论不可达，避免任何情况下死循环
      const end = Math.min(start + chunkSizeBytes, sizeBytes) - 1
      const chunk = file.slice(start, end + 1)

      const ack = await putChunk(uploadId, index, chunk, {
        contentRange: `bytes ${start}-${end}/${sizeBytes}`,
        signal: options.signal,
      })

      const confirmed = ack.receivedBytes ?? end + 1
      if (confirmed <= receivedBytes) {
        throw ApiError.transport(
          'internal_error',
          `第 ${index} 片已被服务端接收，但服务端确认的已收字节数没有前进（${receivedBytes} → ${confirmed}），已停止以避免重复上传同一分片。`,
        )
      }
      // 夹到文件大小：服务端报数偏大属于服务端异常，这里只保证本地进度不越界，不掩盖 complete 的真实结果
      receivedBytes = Math.min(confirmed, sizeBytes)
      lastChunkIndex = index
      report()
    }

    const asset = await uploads.completeUpload(uploadId, { signal: options.signal })
    return { uploadId, assetId: asset?.id ?? null }
  }

  /* ---------------- 文件夹 ---------------- */

  const folders = {
    /**
     * `GET /asset-folders`：返回数组而不是 `Page<T>` —— asset.md §3.5 没有游标参数，
     * 按「文档给了 cursor 才分页」处理（README §2.5）。服务端可能附带素材计数 `assetCount`，
     * 契约类型 `AssetFolder` 未冻结该字段，本层不另立第二个类型。
     */
    listFolders(): Promise<AssetFolder[]> {
      return http.get<AssetFolder[]>('/asset-folders')
    },

    /** `POST /asset-folders`：同名返回 409 conflict（asset.md §3.5），由调用方提示改名。 */
    createFolder(name: string): Promise<AssetFolder> {
      return http.post<AssetFolder>('/asset-folders', { name })
    },

    /**
     * `PATCH /asset-folders/{folderId}`：改名。
     * 不带 `If-Match` —— `AssetFolder` 没有 `etag` 字段，README §2.7 的可变资源清单也未列文件夹。
     */
    renameFolder(folderId: string, name: string): Promise<AssetFolder> {
      return http.patch<AssetFolder>(`/asset-folders/${encodeURIComponent(folderId)}`, { name })
    },

    /** `DELETE /asset-folders/{folderId}`：文件夹里的素材被移回根目录，不级联删除（asset.md §3.5）。 */
    async removeFolder(folderId: string): Promise<void> {
      await http.del(`/asset-folders/${encodeURIComponent(folderId)}`)
    },
  }

  /* ---------------- 上传端点（单步） ---------------- */

  const uploads = {
    /**
     * `POST /assets/uploads` → `201` + `UploadSession`（asset.md §3.2）。
     * 只认返回的 `chunkSizeBytes`，不假设分片大小；`expiresAt` 过期后必须重建会话。
     */
    createUploadSession(body: UploadSessionCreateRequest): Promise<UploadSession> {
      return http.post<UploadSession>('/assets/uploads', body)
    },

    /**
     * `PUT /assets/uploads/{uploadId}/chunks/{index}`：单次分片上传（asset.md §3.2）。
     * 返回 `void` 是刻意的：逐片确认信息由 `uploadFile` 内部读取，调用方不该在这里自己算进度。
     */
    async uploadChunk(
      uploadId: string,
      index: number,
      chunk: Blob,
      options: UploadChunkOptions,
    ): Promise<void> {
      await putChunk(uploadId, index, chunk, options)
    },

    /** `POST .../complete` → `201` + `Asset`（`processingStatus=pending`，asset.md §3.2）。 */
    completeUpload(uploadId: string, options: { signal?: AbortSignal } = {}): Promise<Asset> {
      return http.post<Asset>(`${uploadPath(uploadId)}/complete`, undefined, {
        signal: options.signal,
      })
    },

    /** `DELETE /assets/uploads/{uploadId}`：取消会话并清理已收分片（asset.md §3.2）。 */
    async cancelUpload(uploadId: string): Promise<void> {
      await http.del(uploadPath(uploadId))
    },
  }

  /* ---------------- 素材 ---------------- */

  return {
    /**
     * 素材本体的可访问 URL。
     *
     * 返回完整地址而不是相对路径：`<video src>` / `<img src>` 直接加载，
     * 打包态后端端口是动态的，拼相对路径会打到前端 dev server 上。
     */
    contentUrl(assetId: string): string {
      return http.url(`${assetPath(assetId)}/content`)
    },

    /** 缩略图 URL。素材没有缩略图时该地址会 404，调用方应先看 `thumbnailUrl` 是否存在。 */
    thumbnailUrl(assetId: string): string {
      return http.url(`${assetPath(assetId)}/thumbnail`)
    },

    /**
     * `GET /assets`：筛选/搜索/排序按 asset.md §3.1；`tags` 以重复参数表达（见 config.ts）。
     *
     * 列表形状交给 `asPage` 归一：契约里「列表」有两种口径（README §2.3 游标分页、project.md 有限集合裸数组），
     * 直接 `http.get<Page<Asset>>` 遇到裸数组会让调用方读到 `undefined` 的 items 却不报错。
     * 归一后认不出的形状会抛错，不把「没读到」显示成「没有数据」。
     */
    async list(query: AssetListQuery = {}): Promise<Page<Asset>> {
      const path = '/assets'
      const payload = await http.get<unknown>(path, { query: { ...query } })
      return asPage<Asset>(payload, { source: `GET ${path}` })
    },

    /** `GET /assets/{assetId}`：详情含 `refs`（asset.md §3.4）。 */
    get(assetId: string): Promise<Asset> {
      return http.get<Asset>(assetPath(assetId))
    },

    /**
     * `PATCH /assets/{assetId}`：改名/标签/文件夹/授权/审核/可用性，必须带 `If-Match`。
     * 不匹配返回 `412 precondition_failed`（README §2.7）—— 调用方应提示「已被其他窗口修改」
     * 并重新 `get()` 拿新 etag，不要用旧 etag 重试覆盖。
     */
    update(
      assetId: string,
      body: AssetUpdateRequest,
      etag: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<Asset> {
      return http.patch<Asset>(assetPath(assetId), body, {
        ifMatch: etag,
        signal: options.signal,
      })
    },

    /**
     * `DELETE /assets/{assetId}`：被引用时返回 `409 conflict`，引用方在 `ApiError.details`（asset.md §3.4）。
     * 这里如实抛出：调用方读 `error.details` 展示「被谁用着」，不得静默级联删除。
     */
    async remove(assetId: string): Promise<void> {
      await http.del(assetPath(assetId))
    },

    /**
     * `POST /assets/batch-delete`：服务端**部分失败返回 207**，逐项结果如实返回
     * （asset.md §3.4）。注意 207 在 fetch 里算 2xx，所以不能只看状态码；
     * 也绝不把整批当失败或只报成功 —— 具体判定见 `buildBatchRemoveResult`。
     */
    async batchRemove(ids: string[]): Promise<AssetBatchRemoveResult> {
      // 空数组直接返回：不发一次注定被 400 拒绝的请求，也不假装有过删除动作
      if (ids.length === 0) return { results: [], partial: false }
      const response = await http.request<unknown>('POST', '/assets/batch-delete', {
        body: { ids },
      })
      return buildBatchRemoveResult(response.data, response.status, ids)
    },

    /**
     * `POST /assets/import`：桌面端按本机绝对路径导入（asset.md §3.3）。
     * - 远程后端返回 `422 capability_unavailable`，原样抛出（README §2.4 铁律：能力未接不得伪造成功）；
     * - 文件不存在 404；路径越界 403（`validation_error` + `details.reason=path_not_allowed`）；
     * - 重复导入返回已有 `Asset`（200），所以「拿到 Asset」不等于「这次真的复制了新文件」。
     */
    importByPath(body: AssetImportRequest): Promise<Asset> {
      return http.post<Asset>('/assets/import', body)
    },

    folders,

    uploads,

    /** 分片上传的完整编排，见上方 `uploadFile` 注释。 */
    uploadFile,
  }
}

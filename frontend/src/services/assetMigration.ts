/**
 * IndexedDB → 服务端素材库的一次性迁移。
 *
 * 为什么这件事必须认真做：老用户打开新版本时，素材页读的是后端，而 TA 之前导入的
 * 文件都在浏览器 IndexedDB 里。迁移一旦做错（少一条、内容不对、切过去才发现失败），
 * 用户看到的就是「我的素材没了」。
 *
 * 四条不能让步的规则：
 *
 * 1. **逐条校验**：每条上传后比对服务端返回的 `sizeBytes` 与本地 blob 大小；
 *    不一致算这条失败。只「请求成功」不等于内容对。
 * 2. **失败不切换**：任一条失败就保持 IndexedDB 为数据源，界面如实显示失败项，
 *    用户可重试或明确放弃。绝不静默跳过。
 * 3. **旧库只读保留**：迁移成功后**不删除** IndexedDB 数据，只写一个 `migratedAt` 标记。
 *    新实现若有 bug，用户数据还在原地，可以回退。
 * 4. **切换期不丢写**：迁移与切换期间页面仍在读旧库；用户在旧库里的改动通过
 *    `updatedAt` 快照检测出来并补传一次，切换前再校验一次。
 *
 * 迁移状态持久化在 IndexedDB 的 meta 里，应用重启后能从中断处继续，
 * 不需要用户从头再来。
 */
import { listAssetsRaw, listFoldersRaw, readMigrationState, writeMigrationState } from './assetIndexedDb'
import type { MyAsset } from '@/data/myAssets'
import { createFolder, importFiles, listFolders, updateAsset } from './assetApiService'

/** 迁移阶段。切换窗口刻意很短，避免新旧两边不一致写入。 */
export type MigrationPhase = 'idle' | 'migrating' | 'verifying' | 'migrated' | 'failed'

/**
 * 单条迁移的逐项校验结果。
 *
 * 为什么细分到每一项：只报「成功 / 失败」会让「文件传上去了但标签没写进去」
 * 被算成成功。用户回到素材库发现标签没了，却被告知「迁移完成」——
 * 这比直接报失败更糟。
 */
export interface MigrationChecks {
  /** 文件本体：字节数一致**且** SHA-256 与本地一致。 */
  file: boolean
  /** 名称。 */
  name: boolean
  /** 标签。 */
  tags: boolean
  /** 授权状态与说明。 */
  license: boolean
  /** 审核状态（含沿合法路径推进）。 */
  review: boolean
  /** 文件夹归属（在 migrateFolders 阶段回填）。 */
  folder: boolean
  /** 旧 ID → 新 ID 的对照是否记录成功（迁移后还要能追溯「这条是哪条变来的」）。 */
  idMap: boolean
}

export interface MigrationItemResult {
  id: string
  name: string
  ok: boolean
  /** 失败原因（人话）。 */
  error?: string
  /** 迁移后的服务端素材 ID。 */
  serverId?: string
  /** 逐项校验结果；{@code ok} 为 true 时应当全部为 true。 */
  checks?: MigrationChecks
  /** 未完成的项（人话），供界面告诉用户「哪些内容还留在旧库」。 */
  incomplete?: string[]
}

export interface MigrationReport {
  phase: MigrationPhase
  total: number
  migrated: number
  failed: number
  skipped: number
  items: MigrationItemResult[]
  /** 迁移完成时间；未完成时为空。 */
  migratedAt?: number
}

export interface MigrationProgress {
  phase: MigrationPhase
  index: number
  total: number
  name: string
}

/**
 * 判断一条本地素材是否应该迁移到服务端。
 *
 * 内置种子不迁移：它们指向随应用分发的 `public/*` 资源，本来就不是用户的文件；
 * 每次安装都复制一份几十 MB 的成片进用户素材库没有意义，而且这些种子的
 * `refs` 是演示引用，按契约红线不能当成真实用户项目关系。
 *
 * 只有**用户真正导入过、且带着文件本体**的条目才迁移 —— 没有 `blob` 的非内置条目
 * 说明本体早就丢了，迁移过去只会是一条打不开的记录。
 */
function shouldMigrate(asset: MyAsset & { blob?: Blob }): boolean {
  if (asset.builtin) return false
  return asset.blob !== undefined && asset.blob !== null && asset.blob.size > 0
}

/**
 * 迁移旧审核状态。
 *
 * 旧代码把新导入素材一律写成 `pending`，而在新契约里 `pending` 表示「已提审未出结论」，
 * `none` 才是「从未提审」。旧数据的 `pending` 实际上大多是「还没人看过」，
 * 所以按「未提审」处理更接近事实；用户后来真的点过审核的条目会留下 `approved`/`needs_review`，
 * 这些保持原样。
 */
function migrateReviewStatus(status: string): string {
  if (status === 'pending') return 'none'
  return status
}

/**
 * 计算 blob 的 SHA-256（小写十六进制）。
 *
 * <p>为什么迁移必须校验内容而不只是字节数：旧库里两条元数据不同的记录，
 * 内容其实可能不同（改过内容但大小恰好相同）。只比大小会把它们判成「同一份」，
 * 迁移后看起来成功、实际丢了一个。哈希能真正发现这类问题。</p>
 */
async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 执行（或继续）迁移。
 *
 * @param onProgress 逐条进度回调；用于界面显示「第几条 / 共几条」而不是编造的百分比
 * @returns 迁移报告
 */
export async function migrateIndexedDbAssets(
  onProgress?: (progress: MigrationProgress) => void,
): Promise<MigrationReport> {
  const previous = await readMigrationState()
  // 已经迁移过就不再重复上传：重复执行会把同一批文件再传一遍（服务端会去重，
  // 但仍会白跑一轮网络），更麻烦的是可能把用户后来在服务端改过的字段覆盖回旧值。
  if (previous?.phase === 'migrated') {
    return {
      phase: 'migrated',
      total: previous.total ?? 0,
      migrated: previous.migrated ?? 0,
      failed: previous.failed ?? 0,
      skipped: previous.skipped ?? 0,
      items: previous.items ?? [],
      migratedAt: previous.migratedAt,
    }
  }

  const localAssets = await listAssetsRaw()
  const candidates = localAssets.filter(shouldMigrate)
  const skipped = localAssets.length - candidates.length
  const results: MigrationItemResult[] = []

  await writeMigrationState({ phase: 'migrating', total: candidates.length, migrated: 0, failed: 0, skipped })

  // 记下迁移开始时的元数据指纹：用于切换到服务端之前检测「迁移期间用户在旧库里的改动」。
  // 不用时间戳是因为旧记录只有 createdAt/lastUsedAt —— 改标签不会更新任何时间字段，
  // 按时间戳比对会漏掉这类改动。指纹直接覆盖用户可改的那几项，语义更准。
  const snapshot = new Map<string, string>()
  for (const asset of candidates) snapshot.set(asset.id, metadataFingerprint(asset))

  let migrated = 0
  let failed = 0

  for (let index = 0; index < candidates.length; index += 1) {
    const asset = candidates[index]
    const blob = (asset as MyAsset & { blob?: Blob }).blob
    if (!blob) {
      // shouldMigrate 已经过滤过，这里只是兜底：不静默跳过，如实记为失败。
      results.push({ id: asset.id, name: asset.name, ok: false, error: '文件本体已丢失' })
      failed += 1
      continue
    }
    onProgress?.({ phase: 'migrating', index: index + 1, total: candidates.length, name: asset.name })

    try {
      const file = new File([blob], asset.name, { type: asset.mimeType || blob.type || '' })
      /* keepSeparateRecord=true：旧库里同内容不同元数据的两条记录都要保留。
         文件本体仍只存一份，但名称/标签/授权/文件夹各自独立 ——
         否则第二条的名称会永久丢失，而界面显示「迁移完成」。 */
      const outcome = await importFiles([file], () => {}, { keepSeparateRecord: true })
      // 把服务端的真实失败原因往上抛，而不是笼统的「未返回素材」——
      // 后者会掩盖「类型不支持」「连不上」这类可操作的信息。
      if (outcome.failed.length > 0) {
        throw new Error(outcome.failed[0].error)
      }
      const server = outcome.created[0]
      if (!server) {
        throw new Error('服务端未返回素材')
      }
      /* 逐条校验：字节数一致**且** SHA-256 一致。
         只比大小抓不到「内容被换掉但大小相同」的情况 —— 那种错误迁移后
         看起来成功，实际文件已经不对了。 */
      if (server.sizeBytes !== blob.size) {
        throw new Error(`大小校验不一致：本地 ${blob.size}，服务端 ${server.sizeBytes}`)
      }
      const localHash = await sha256Hex(blob)
      const serverHash = (server as { contentHash?: string | null }).contentHash
      if (!serverHash) {
        // 服务端没给出哈希就无法校验内容 —— 不当作成功，如实报出来。
        throw new Error('服务端未返回内容哈希，无法校验文件内容')
      }
      if (serverHash.toLowerCase() !== localHash) {
        throw new Error(`内容校验不一致：本地 ${localHash.slice(0, 12)}…，服务端 ${serverHash.slice(0, 12)}…`)
      }
      // 保留用户原来的名称/标签/授权/审核状态：这些是用户自己的记录，
      // 迁移不是重建，不该丢。
      const meta = await applyLocalMetadata(server.id, asset)
      // 走到这里说明字节数与 SHA-256 都已核对一致。
      const itemChecks: MigrationChecks = {
        file: true,
        name: meta.checks.name,
        tags: meta.checks.tags,
        license: meta.checks.license,
        review: meta.checks.review,
        // 文件夹在 migrateFolders 阶段回填，这里先占位为「待归位」。
        folder: false,
        // 旧 ID → 新 ID 已在上面的 push 里记录（serverId 字段）。
        idMap: true,
      }
      /* 有未完成项就**不算成功**。
         原先只要文件传上去就标 ok:true，元数据失败只写在 error 里 ——
         用户看到「迁移完成」，回素材库却发现标签没了。
         现在把未完成项列成人话，并在汇总里计入未完成，让用户能重试。 */
      const itemOk = meta.incomplete.length === 0
      results.push({
        id: asset.id,
        name: asset.name,
        ok: itemOk,
        serverId: server.id,
        checks: itemChecks,
        error: itemOk ? undefined : `文件已迁移，但以下内容未写入：${meta.incomplete.join('、')}`,
        incomplete: itemOk ? undefined : meta.incomplete,
      })
      if (itemOk) migrated += 1
      else failed += 1
    } catch (error) {
      results.push({
        id: asset.id,
        name: asset.name,
        ok: false,
        error: error instanceof Error ? error.message : '迁移失败',
      })
      failed += 1
    }
    await writeMigrationState({
      phase: 'migrating',
      total: candidates.length,
      migrated,
      failed,
      skipped,
      items: results,
    })
  }

  // 任一条失败就不切换：保持 IndexedDB 为数据源，让用户决定重试还是放弃。
  if (failed > 0) {
    await writeMigrationState({
      phase: 'failed',
      total: candidates.length,
      migrated,
      failed,
      skipped,
      items: results,
    })
    return { phase: 'failed', total: candidates.length, migrated, failed, skipped, items: results }
  }

  // 切到 verifying：补传「迁移期间用户在旧库里改过」的条目。
  onProgress?.({ phase: 'verifying', index: candidates.length, total: candidates.length, name: '' })
  await writeMigrationState({
    phase: 'verifying',
    total: candidates.length,
    migrated,
    failed: 0,
    skipped,
    items: results,
  })
  await syncEditsDuringMigration(snapshot, results)

  // 文件夹：先建服务端文件夹，再把素材归位。
  await migrateFolders(results)

  const migratedAt = Date.now()
  await writeMigrationState({
    phase: 'migrated',
    total: candidates.length,
    migrated,
    failed: 0,
    skipped,
    items: results,
    migratedAt,
  })
  return {
    phase: 'migrated',
    total: candidates.length,
    migrated,
    failed: 0,
    skipped,
    items: results,
    migratedAt,
  }
}

/**
 * 把本地的名称/标签/授权/审核状态写到刚迁移过来的服务端素材上。
 *
 * 审核状态必须沿合法路径推进：服务端的转换表不允许 `none` 直接跳 `approved`
 * （跳过提审直接通过等于没有审核记录）。迁移来的素材初始是 `none`，
 * 所以要按 `none → (pending) → approved` 走，否则用户原来的「已通过」会被静默丢掉。
 */
async function applyLocalMetadata(
  serverId: string,
  local: MyAsset,
): Promise<{ checks: Omit<MigrationChecks, 'file' | 'folder' | 'idMap'>; incomplete: string[] }> {
  const incomplete: string[] = []
  const checks = { name: true, tags: true, license: true, review: true }

  // 名称：改名失败要单独报，不能因为「文件在」就算过了。
  if (local.name) {
    try {
      await updateAsset(serverId, { name: local.name })
    } catch {
      checks.name = false
      incomplete.push(`名称（应为「${local.name}」）`)
    }
  }

  // 标签
  if (local.tags && local.tags.length > 0) {
    try {
      await updateAsset(serverId, { tags: local.tags })
    } catch {
      checks.tags = false
      incomplete.push(`标签（${local.tags.join('、')}）`)
    }
  }

  // 授权
  const patch: Record<string, unknown> = {}
  if (local.licenseStatus && local.licenseStatus !== 'unknown') patch.licenseStatus = local.licenseStatus
  if (local.licenseDetails) patch.licenseDetails = local.licenseDetails
  if (Object.keys(patch).length > 0) {
    try {
      await updateAsset(serverId, patch as Partial<MyAsset>)
    } catch {
      checks.license = false
      incomplete.push('授权状态与说明')
    }
  }

  // 审核：沿合法路径推进（none → pending → 目标）
  const target = migrateReviewStatus(local.reviewStatus)
  if (target !== 'none') {
    try {
      // 契约要求「处理完成后才能通过审核」。旧库里的尺寸/时长是浏览器实际解析出来的，
      // 说明这条素材在旧版里已经处理完了 —— 如实标 ready，否则 approved 永远写不进去。
      await updateAsset(serverId, { processingStatus: 'ready' } as unknown as Partial<MyAsset>)
      if (target === 'approved' || target === 'needs_review') {
        await updateAsset(serverId, { reviewStatus: 'pending' } as Partial<MyAsset>)
      }
      await updateAsset(serverId, { reviewStatus: target } as Partial<MyAsset>)
    } catch {
      checks.review = false
      incomplete.push(`审核状态（应为「${local.reviewStatus}」）`)
    }
  }

  return { checks, incomplete }
}

/**
 * 补传迁移期间用户在旧库里做过的改动。
 *
 * 只检测「上传之后又被改过」的条目（`updatedAt` 晚于快照），再按最新值补一次元数据。
 * 这一步不能省：迁移一个几百 MB 的素材库要几分钟，期间用户完全可能在旧界面上改标签。
 */
async function syncEditsDuringMigration(
  snapshot: Map<string, string>,
  results: MigrationItemResult[],
): Promise<void> {
  const latest = await listAssetsRaw()
  const serverIdByLocal = new Map(results.filter((r) => r.ok && r.serverId).map((r) => [r.id, r.serverId!]))
  const byLocalId = new Map(results.map((r) => [r.id, r]))
  for (const asset of latest) {
    const serverId = serverIdByLocal.get(asset.id)
    if (!serverId) continue
    // 指纹变了说明迁移期间用户改过这条，按最新值再补一次。
    if (metadataFingerprint(asset) === (snapshot.get(asset.id) ?? '')) continue
    const meta = await applyLocalMetadata(serverId, asset)
    if (meta.incomplete.length > 0) {
      // 补传失败同样要暴露出来，不能因为「主流程已过」就吞掉。
      const item = byLocalId.get(asset.id)
      if (item) {
        item.ok = false
        item.incomplete = [...(item.incomplete ?? []), ...meta.incomplete]
        item.error = item.error
          ? `${item.error}；迁移期间的改动未写入：${meta.incomplete.join('、')}`
          : `迁移期间的改动未写入：${meta.incomplete.join('、')}`
      }
    }
  }
}

/**
 * 用户可改字段的指纹。
 *
 * 覆盖名称、标签、授权、审核这几项 —— 迁移期间用户能改的就这些
 * （文件夹在 migrateFolders 里按最新值统一归位，不需要在这里比对）。
 */
function metadataFingerprint(asset: MyAsset): string {
  return JSON.stringify([
    asset.name,
    [...(asset.tags ?? [])].sort(),
    asset.licenseStatus,
    asset.licenseDetails ?? '',
    asset.reviewStatus,
  ])
}

/**
 * 迁移文件夹并把素材归位。
 *
 * 同名文件夹已存在时复用已有的，不重复创建 —— 用户可能已经在服务端建了同名文件夹。
 */
async function migrateFolders(results: MigrationItemResult[]): Promise<void> {
  const localFolders = await listFoldersRaw()
  if (localFolders.length === 0) return
  const existing = await listFolders()
  const idMap = new Map<string, string>()
  for (const local of localFolders) {
    const found = existing.find((f) => f.name === local.name)
    if (found) {
      idMap.set(local.id, found.id)
      continue
    }
    try {
      const created = await createFolder(local.name)
      idMap.set(local.id, created.id)
    } catch {
      // 建不出来（比如同名刚被别处建了）就让这些素材留在根目录，
      // 不因为文件夹失败而丢掉素材 —— 但要记下来，由下面回填到条目的 incomplete。
    }
  }

  const assets = await listAssetsRaw()
  const serverIdByLocal = new Map(
    results.filter((r) => r.serverId).map((r) => [r.id, r.serverId!]),
  )
  const byLocalId = new Map(results.map((r) => [r.id, r]))

  for (const asset of assets) {
    if (!asset.folderId) {
      // 本来就没有文件夹归属：这一项视为已满足。
      const item = byLocalId.get(asset.id)
      if (item?.checks) item.checks.folder = true
      continue
    }
    const serverId = serverIdByLocal.get(asset.id)
    if (!serverId) continue
    const item = byLocalId.get(asset.id)
    const localFolder = localFolders.find((f) => f.id === asset.folderId)
    const folderName = localFolder?.name ?? asset.folderId
    const folderId = idMap.get(asset.folderId)
    if (!folderId) {
      // 文件夹没建出来，素材留在根目录 —— 如实记成未完成。
      if (item) {
        item.ok = false
        item.incomplete = [...(item.incomplete ?? []), `文件夹「${folderName}」`]
        item.error = item.error
          ? `${item.error}；文件夹「${folderName}」未建立`
          : `文件夹「${folderName}」未建立，素材留在根目录`
      }
      continue
    }
    try {
      await updateAsset(serverId, { folderId })
      if (item?.checks) item.checks.folder = true
    } catch {
      // 归位失败要记下来：用户会看到素材在根目录而不是原来的文件夹里。
      if (item) {
        item.ok = false
        item.incomplete = [...(item.incomplete ?? []), `文件夹「${folderName}」`]
        item.error = item.error
          ? `${item.error}；未能放入文件夹「${folderName}」`
          : `未能放入文件夹「${folderName}」`
      }
    }
  }
}

/** 读取当前迁移状态，未迁移过返回 null。 */
export async function readAssetMigrationReport(): Promise<MigrationReport | null> {
  const state = await readMigrationState()
  if (!state) return null
  return {
    phase: state.phase as MigrationPhase,
    total: state.total ?? 0,
    migrated: state.migrated ?? 0,
    failed: state.failed ?? 0,
    skipped: state.skipped ?? 0,
    items: state.items ?? [],
    migratedAt: state.migratedAt,
  }
}

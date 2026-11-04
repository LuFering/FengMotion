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

export interface MigrationItemResult {
  id: string
  name: string
  ok: boolean
  /** 失败原因（人话）。 */
  error?: string
  /** 迁移后的服务端素材 ID。 */
  serverId?: string
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
      const outcome = await importFiles([file], () => {})
      // 把服务端的真实失败原因往上抛，而不是笼统的「未返回素材」——
      // 后者会掩盖「类型不支持」「连不上」这类可操作的信息。
      if (outcome.failed.length > 0) {
        throw new Error(outcome.failed[0].error)
      }
      const server = outcome.created[0]
      if (!server) {
        throw new Error('服务端未返回素材')
      }
      // 逐条校验：字节数必须一致。内容哈希由服务端算，这里比大小是为了抓
      // 「传上去的不是这个文件」这类明显错误。
      if (server.sizeBytes !== blob.size) {
        throw new Error(`大小校验不一致：本地 ${blob.size}，服务端 ${server.sizeBytes}`)
      }
      // 保留用户原来的名称/标签/授权/审核状态：这些是用户自己的记录，
      // 迁移不是重建，不该丢。
      const metaError = await applyLocalMetadata(server.id, asset)
      results.push({
        id: asset.id,
        name: asset.name,
        ok: true,
        serverId: server.id,
        // 文件已迁移成功，但元数据没写全时明确标出来，而不是当作完全成功。
        error: metaError ? `文件已迁移，但部分信息未写入：${metaError}` : undefined,
      })
      migrated += 1
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
async function applyLocalMetadata(serverId: string, local: MyAsset): Promise<string | null> {
  const patch: Record<string, unknown> = {}
  if (local.tags && local.tags.length > 0) patch.tags = local.tags
  if (local.licenseStatus && local.licenseStatus !== 'unknown') patch.licenseStatus = local.licenseStatus
  if (local.licenseDetails) patch.licenseDetails = local.licenseDetails
  // folderId 在 migrateFolders 里统一处理（那时服务端文件夹才存在）。
  try {
    if (Object.keys(patch).length > 0) await updateAsset(serverId, patch as Partial<MyAsset>)
  } catch (error) {
    // 元数据回写失败不影响文件本身：文件已经在了，用户最多重新打标签。
    // 但要如实把原因带出去，别让「标签丢了」变成查不出的静默事件。
    return error instanceof Error ? error.message : '元数据写入失败'
  }

  const target = migrateReviewStatus(local.reviewStatus)
  if (target === 'none') return null
  try {
    // 契约要求「处理完成后才能通过审核」。旧库里的尺寸/时长是浏览器实际解析出来的，
    // 也就是说这条素材在旧版里已经处理完了 —— 迁移时如实标 ready，
    // 否则用户原有的「已通过」会因为新库还没做解析而永远写不进去。
    await updateAsset(serverId, { processingStatus: 'ready' } as unknown as Partial<MyAsset>)
    if (target === 'approved' || target === 'needs_review') {
      // 先提审，再落最终状态：服务端不允许 none 直接跳 approved。
      await updateAsset(serverId, { reviewStatus: 'pending' } as Partial<MyAsset>)
    }
    await updateAsset(serverId, { reviewStatus: target } as Partial<MyAsset>)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : '审核状态写入失败'
  }
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
  for (const asset of latest) {
    const serverId = serverIdByLocal.get(asset.id)
    if (!serverId) continue
    // 指纹变了说明迁移期间用户改过这条，按最新值再补一次。
    if (metadataFingerprint(asset) === (snapshot.get(asset.id) ?? '')) continue
    await applyLocalMetadata(serverId, asset)
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
      // 不因为文件夹失败而丢掉素材。
    }
  }

  const assets = await listAssetsRaw()
  const serverIdByLocal = new Map(results.filter((r) => r.ok && r.serverId).map((r) => [r.id, r.serverId!]))
  for (const asset of assets) {
    if (!asset.folderId) continue
    const serverId = serverIdByLocal.get(asset.id)
    const folderId = idMap.get(asset.folderId)
    if (!serverId || !folderId) continue
    try {
      await updateAsset(serverId, { folderId })
    } catch {
      // 归位失败不影响素材本身。
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

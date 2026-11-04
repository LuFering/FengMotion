/**
 * 只读访问旧的 IndexedDB 素材索引（迁移专用）。
 *
 * 为什么把读取单独拆出来，而不是直接用 `assetService`：
 *   · `assetService` 会写入（`importFiles`/`updateAsset`/`initLibrary`），迁移期间
 *     再往里写会让「迁移的是哪份数据」变得说不清；
 *   · 迁移只需要读到**原始记录**（含 `blob` 本体与 `thumbBlob`），而 `assetService`
 *     对外返回的是去掉 blob 的干净对象。
 *
 * 这个模块**只读不写**（除了迁移状态本身），旧库要保持原样：
 * 迁移成功后数据仍留在原处，供回退使用。
 */
import type { MediaType, MyAsset } from '@/data/myAssets'

const DB_NAME = 'fengmotion-assets'
const DB_VERSION = 1
const STORE = 'assets'
const META = 'meta'
const MIGRATION_KEY = 'assetMigration'

/** IndexedDB 里保存的原始记录：比 MyAsset 多出两个 blob 字段。 */
export interface StoredAssetRecord extends MyAsset {
  /** 导入文件的本体；内置素材没有（走 public 路径）。 */
  blob?: Blob
  /** 图片缩略图 / 视频海报。 */
  thumbBlob?: Blob
}

/** 旧库里的文件夹记录。 */
export interface StoredFolderRecord {
  id: string
  name: string
  createdAt: number
}

/** 迁移状态（持久化在 meta 里，应用重启后能从中断处继续）。 */
export interface StoredMigrationState {
  phase: string
  total?: number
  migrated?: number
  failed?: number
  skipped?: number
  items?: Array<{ id: string; name: string; ok: boolean; error?: string; serverId?: string }>
  migratedAt?: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'k' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDB()
  return dbPromise
}

function read<T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, 'readonly')
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

function write(store: string, fn: (s: IDBObjectStore) => IDBRequest): Promise<void> {
  return db().then(
    (d) =>
      new Promise<void>((resolve, reject) => {
        const t = d.transaction(store, 'readwrite')
        fn(t.objectStore(store))
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
      }),
  )
}

/**
 * 旧库里是否根本不存在数据。
 *
 * 首次安装的用户没有这个库，迁移应当直接跳过而不是报错 ——
 * 把「没有可迁移的数据」显示成「迁移失败」会吓到用户。
 */
export async function hasLegacyData(): Promise<boolean> {
  try {
    const all = await read<StoredAssetRecord[]>(STORE, (s) => s.getAll() as IDBRequest<StoredAssetRecord[]>)
    return all.length > 0
  } catch {
    // 数据库打不开（例如浏览器禁用了存储）说明没有可迁移的数据。
    return false
  }
}

/** 读出全部原始记录（含 blob）。 */
export async function listAssetsRaw(): Promise<StoredAssetRecord[]> {
  try {
    return await read<StoredAssetRecord[]>(STORE, (s) => s.getAll() as IDBRequest<StoredAssetRecord[]>)
  } catch {
    return []
  }
}

/** 读出旧库的文件夹列表。 */
export async function listFoldersRaw(): Promise<StoredFolderRecord[]> {
  try {
    const row = await read<{ k: string; v: StoredFolderRecord[] } | undefined>(META, (s) =>
      s.get('folders') as IDBRequest<{ k: string; v: StoredFolderRecord[] } | undefined>,
    )
    return row?.v ?? []
  } catch {
    return []
  }
}

/** 读迁移状态。 */
export async function readMigrationState(): Promise<StoredMigrationState | null> {
  try {
    const row = await read<{ k: string; v: StoredMigrationState } | undefined>(META, (s) =>
      s.get(MIGRATION_KEY) as IDBRequest<{ k: string; v: StoredMigrationState } | undefined>,
    )
    return row?.v ?? null
  } catch {
    return null
  }
}

/** 写迁移状态（这是本模块唯一的写入，且只写 meta，不碰素材记录）。 */
export async function writeMigrationState(state: StoredMigrationState): Promise<void> {
  try {
    await write(META, (s) => s.put({ k: MIGRATION_KEY, v: state }))
  } catch {
    // 状态写失败不影响本条迁移结果；下次进入会重新走一遍（服务端有去重，不会产生重复素材）。
  }
}

/** 供测试与诊断：按媒体类型分组统计旧库条目。 */
export function groupByMediaType(assets: StoredAssetRecord[]): Record<MediaType, number> {
  const counts: Record<MediaType, number> = { image: 0, video: 0, audio: 0, font: 0, doc: 0 }
  for (const asset of assets) counts[asset.mediaType] += 1
  return counts
}

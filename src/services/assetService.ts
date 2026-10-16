/**
 * 素材索引服务 —— 真实文件的本地持久化（IndexedDB）。
 *
 * 边界（如实）：
 *   · 索引与导入文件的本体都存浏览器 IndexedDB（刷新 / 重启后仍在）；
 *   · 「落盘到系统目录的素材库」属 Electron 阶段，当前未接入（界面不提供该承诺）；
 *   · 导入进度是真实的逐文件状态（读取 → 解析元数据 → 入库），不编造百分比。
 */
import { BUILTIN_ASSETS, mediaTypeOf, type MediaType, type MyAsset } from '@/data/myAssets'

const DB_NAME = 'fengmotion-assets'
const DB_VERSION = 1
const STORE = 'assets'
const META = 'meta'

interface StoredAsset extends MyAsset {
  /** 导入文件的本体（内置素材不存 blob，走路径） */
  blob?: Blob
  /** 视频海报 / 图片缩略（导入或懒生成） */
  thumbBlob?: Blob
}

interface FolderRow { id: string; name: string; createdAt: number }

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

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode,
              fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let dbP: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbP) dbP = openDB()
  return dbP
}

/** 首次运行：把内置种子写入索引（之后用户对内置素材的改名/删除同样持久） */
export async function initLibrary(): Promise<void> {
  const d = await db()
  const seeded = await tx<{ k: string; v: boolean } | undefined>(d, META, 'readonly',
    (s) => s.get('seeded') as IDBRequest<{ k: string; v: boolean } | undefined>)
  if (seeded?.v) return
  const t = d.transaction(STORE, 'readwrite')
  const store = t.objectStore(STORE)
  for (const a of BUILTIN_ASSETS) store.put(a)
  await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error) })
  // 标记写入 meta（assets store 的 keyPath 是 id，不能混写）
  await tx(d, META, 'readwrite', (s) => s.put({ k: 'seeded', v: true }))
}

export async function listAssets(): Promise<MyAsset[]> {
  const d = await db()
  const rows = await tx<StoredAsset[]>(d, STORE, 'readonly', (s) => s.getAll() as IDBRequest<StoredAsset[]>)
  return rows.map(({ blob: _b, thumbBlob: _t, ...rest }) => rest)
}

export async function updateAsset(id: string, patch: Partial<MyAsset>): Promise<void> {
  const d = await db()
  const row = await tx<StoredAsset | undefined>(d, STORE, 'readonly', (s) => s.get(id) as IDBRequest<StoredAsset | undefined>)
  if (!row) return
  await tx(d, STORE, 'readwrite', (s) => s.put({ ...row, ...patch, id }))
}

export async function removeAssets(ids: string[]): Promise<void> {
  const d = await db()
  const t = d.transaction(STORE, 'readwrite')
  const store = t.objectStore(STORE)
  for (const id of ids) store.delete(id)
  await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error) })
  for (const id of ids) {
    const u = urlCache.get(id)
    if (u) { URL.revokeObjectURL(u); urlCache.delete(id) }
  }
}

// ── 文件夹（轻量：存在 meta 里）──
export async function listFolders(): Promise<FolderRow[]> {
  const d = await db()
  const row = await tx<{ k: string; v: FolderRow[] } | undefined>(d, META, 'readonly',
    (s) => s.get('folders') as IDBRequest<{ k: string; v: FolderRow[] } | undefined>)
  return row?.v ?? []
}
export async function saveFolders(folders: FolderRow[]): Promise<void> {
  const d = await db()
  await tx(d, META, 'readwrite', (s) => s.put({ k: 'folders', v: folders }))
}

// ── 对象 URL 缓存（预览 / 缩略）──
const urlCache = new Map<string, string>()

export async function getFileURL(id: string): Promise<string | null> {
  if (urlCache.has(id)) return urlCache.get(id)!
  const d = await db()
  const row = await tx<StoredAsset | undefined>(d, STORE, 'readonly', (s) => s.get(id) as IDBRequest<StoredAsset | undefined>)
  if (!row) return null
  if (row.blob) {
    const u = URL.createObjectURL(row.blob)
    urlCache.set(id, u)
    return u
  }
  return row.filePath // 内置素材直接用真实路径
}

export async function getThumbURL(id: string): Promise<string | null> {
  const d = await db()
  const row = await tx<StoredAsset | undefined>(d, STORE, 'readonly', (s) => s.get(id) as IDBRequest<StoredAsset | undefined>)
  if (!row) return null
  if (row.thumbBlob) {
    const key = `thumb:${id}`
    if (!urlCache.has(key)) urlCache.set(key, URL.createObjectURL(row.thumbBlob))
    return urlCache.get(key)!
  }
  return row.thumbnailPath ?? null
}

// ── 元数据解析（真实读取）──
async function readImageMeta(file: File): Promise<{ width: number; height: number; thumb: Blob }> {
  const bmp = await createImageBitmap(file)
  const { width, height } = bmp
  const scale = Math.min(1, 480 / Math.max(width, height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(width * scale))
  c.height = Math.max(1, Math.round(height * scale))
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const thumb = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.82))
  bmp.close()
  return { width, height, thumb }
}

async function readVideoMeta(file: File): Promise<{ width: number; height: number; duration: number; thumb: Blob | null }> {
  const url = URL.createObjectURL(file)
  try {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'metadata'
    v.src = url
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res()
      v.onerror = () => rej(new Error('无法读取视频元数据'))
    })
    const width = v.videoWidth, height = v.videoHeight, duration = v.duration
    // 取 10% 处一帧当海报（避开片头黑场）
    let thumb: Blob | null = null
    try {
      v.currentTime = duration < 10 ? duration * 0.5 : Math.min(8, duration * 0.1)
      await new Promise<void>((res, rej) => { v.onseeked = () => res(); v.onerror = () => rej(new Error('seek')); setTimeout(res, 2500) })
      const scale = Math.min(1, 480 / Math.max(width, height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(width * scale))
      c.height = Math.max(1, Math.round(height * scale))
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
      thumb = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.82))
    } catch { /* 海报失败不阻塞导入 */ }
    return { width, height, duration, thumb }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function readAudioMeta(file: File): Promise<{ duration: number }> {
  const url = URL.createObjectURL(file)
  try {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    a.src = url
    await new Promise<void>((res, rej) => {
      a.onloadedmetadata = () => res()
      a.onerror = () => rej(new Error('无法读取音频元数据'))
    })
    return { duration: a.duration }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── 导入 ──
export type ImportPhase = 'queued' | 'reading' | 'done' | 'error'
export interface ImportEvent {
  fileIndex: number
  fileName: string
  phase: ImportPhase
  error?: string
}

/** 逐文件导入；返回成功入库的素材。onEvent 汇报真实状态（无假进度）。 */
export async function importFiles(files: File[], onEvent: (e: ImportEvent) => void): Promise<MyAsset[]> {
  const d = await db()
  const imported: MyAsset[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    onEvent({ fileIndex: i, fileName: file.name, phase: 'queued' })
    const mediaType = mediaTypeOf(file)
    if (!mediaType) {
      onEvent({ fileIndex: i, fileName: file.name, phase: 'error', error: '不支持的文件类型' })
      continue
    }
    onEvent({ fileIndex: i, fileName: file.name, phase: 'reading' })
    try {
      const record: StoredAsset = {
        id: `u-${crypto.randomUUID()}`,
        name: file.name,
        filePath: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        mediaType,
        tags: [],
        folderId: null,
        sourceType: 'imported',
        licenseStatus: 'unknown',
        licenseDetails: '导入文件未提供授权信息',
        reviewStatus: 'pending',
        createdAt: Date.now(),
        refs: [],
        builtin: false,
        blob: file,
      }
      if (mediaType === 'image') {
        const m = await readImageMeta(file)
        record.width = m.width; record.height = m.height
        record.thumbBlob = m.thumb
        record.thumbnailPath = undefined
      } else if (mediaType === 'video') {
        const m = await readVideoMeta(file)
        record.width = m.width; record.height = m.height; record.duration = Math.round(m.duration * 10) / 10
        if (m.thumb) record.thumbBlob = m.thumb
      } else if (mediaType === 'audio') {
        const m = await readAudioMeta(file)
        record.duration = Math.round(m.duration * 10) / 10
      }
      await tx(d, STORE, 'readwrite', (s) => s.put(record))
      const { blob: _b, thumbBlob: _t, ...clean } = record
      imported.push(clean)
      onEvent({ fileIndex: i, fileName: file.name, phase: 'done' })
    } catch (e) {
      onEvent({ fileIndex: i, fileName: file.name, phase: 'error', error: e instanceof Error ? e.message : '读取失败' })
    }
  }
  return imported
}

/** 内置视频的懒海报：截一帧存进索引（真实帧，不造假） */
export async function captureBuiltinPoster(id: string): Promise<string | null> {
  const d = await db()
  const row = await tx<StoredAsset | undefined>(d, STORE, 'readonly', (s) => s.get(id) as IDBRequest<StoredAsset | undefined>)
  if (!row || row.thumbBlob || row.mediaType !== 'video') return null
  try {
    const v = document.createElement('video')
    v.muted = true; v.preload = 'metadata'; v.src = row.filePath
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error('meta')); setTimeout(res, 4000)
    })
    const dur = v.duration || 10
    v.currentTime = dur < 10 ? dur * 0.5 : Math.min(8, dur * 0.1)
    await new Promise<void>((res) => { v.onseeked = () => res(); setTimeout(res, 2500) })
    const scale = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(v.videoWidth * scale))
    c.height = Math.max(1, Math.round(v.videoHeight * scale))
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
    const thumb = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.82))
    await tx(d, STORE, 'readwrite', (s) => s.put({ ...row, thumbBlob: thumb }))
    return await getThumbURL(id)
  } catch {
    return null
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatDur(sec?: number): string {
  if (sec == null) return '—'
  const s = Math.round(sec)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export type { FolderRow }
export type { MediaType }

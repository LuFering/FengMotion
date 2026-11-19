import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LICENSE_LABEL, MEDIA_LABEL, SOURCE_LABEL, type MediaType, type MyAsset } from '@/features/assets/model/myAssets'
// 素材库数据源：服务端（原 IndexedDB 已由 assetApiService 替代）。
// 接口形状与旧 assetService 一致，视图逻辑不必改写。
import { captureBuiltinPoster, createFolder, formatBytes, getThumbURL, importFiles, initLibrary, listAssets, listFolders, removeAssets, updateAsset, assetThumbUrl, type FolderRow } from '@/features/assets/services/assetApiService'
import { hasLegacyData } from '@/features/assets/services/assetIndexedDb'
import { migrateIndexedDbAssets, readAssetMigrationReport, type MigrationReport } from '@/features/assets/services/assetMigration'
import { isAssetDrag, usePendingAssets } from '@/features/assets/hooks/usePendingAssets'
import { toast as emitToast } from '@/shared/lib/toast'
import { Icon } from '@/features/assets/components/AssetIcon'
import { type SortKey } from '@/features/assets/model/assetDisplay'
import { AssetInspector } from '@/features/assets/components/AssetInspector'
import { AssetCanvas } from '@/features/assets/components/AssetCanvas'
import { AssetsHeader } from '@/features/assets/components/AssetsHeader'

export type NodeId = 'all' | 'favorites' | 'recent' | 'project' | 'imported' | 'generated' | 'builtin'
  | 'review:pending' | 'review:needs_review' | 'license:unknown' | 'license:restricted'
  | 'refs:none' | `type:${MediaType}` | `folder:${string}` | `tag:${string}` | `proj:${string}`
type TreeEntry = { id: NodeId; label: string; icon: string; count: number }

/** 标签色点调色板（数据色点，非主题色） */
const TAG_COLORS = ['#f5b83d', '#4caf7d', '#3B8CF8', '#e06c75', '#b48cf2', '#4cc2ff', '#f28cb1', '#9ece6a']
function tagColor(t: string): string {
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0
  return TAG_COLORS[h % TAG_COLORS.length]
}

/** 当前分类的中文名（工具条 / 组织栏共用） */
function nodeLabel(id: NodeId, folders: FolderRow[]): string {
  if (id.startsWith('type:')) return MEDIA_LABEL[id.slice(5) as MediaType]
  if (id.startsWith('folder:')) return folders.find((f) => f.id === id.slice(7))?.name ?? '文件夹'
  if (id.startsWith('tag:')) return id.slice(4)
  if (id.startsWith('proj:')) return id.slice(5).split('|')[1] ?? '项目'
  switch (id) {
    case 'favorites': return '收藏'
    case 'recent': return '最近使用'
    case 'project': return '本项目素材'
    case 'imported': return '导入素材'
    case 'generated': return '生成结果'
    case 'builtin': return '内置素材'
    case 'review:pending': return '待审核'
    case 'review:needs_review': return '需复核'
    case 'license:unknown': return '授权未知'
    case 'license:restricted': return '限制使用'
    case 'refs:none': return '未被引用'
    default: return '全部素材'
  }
}

export function Assets({ projectName }: { projectName?: string } = {}) {
  const [assets, setAssets] = useState<MyAsset[]>([])
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  /* 旧版素材在浏览器 IndexedDB 里。新版本读服务端，若不提示并迁移，
     老用户打开就会看到空库 —— 那是「文件丢了」的观感，必须在界面上给出口。 */
  const [legacyPending, setLegacyPending] = useState(false)
  const [migration, setMigration] = useState<MigrationReport | null>(null)
  const [migrating, setMigrating] = useState(false)
  const [migrationDone, setMigrationDone] = useState(0)
  const [loadVersion, setLoadVersion] = useState(0)
  const [node, setNode] = useState<NodeId>('all')
  const [typeFilter, setTypeFilter] = useState<MediaType | 'all'>('all')
  const [pop, setPop] = useState<'type' | 'sort' | null>(null)
  const [orgOpen, setOrgOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('recent')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /* 待发送：素材库是「挑素材」的地方，这里只负责把选中项交给那份全局清单。
     加入 ≠ 发送，也不改素材本身的任何字段。 */
  const pending = usePendingAssets()
  const addToPending = (ids: string[]) => {
    const n = pending.add(ids)
    emitToast(n > 0 ? `已添加 ${n} 个素材` : '已在待发送中')
    return n
  }
  /* 「选择素材」模式 —— 作者要的是一个实在的按钮：点下去整库进入可选中状态，
     选完点确认一键进购物车。
     和原来那套「先勾复选框、再在批量栏里找操作」的差别：
       · 进入模式前复选框是**隐藏的**（要 hover 才出现），没人知道能多选；
       · 进入后每张卡都有明确的选中框和选中态，目标只有一个：挑素材。
     退出方式三种：确认、取消、Esc。 */
  const [pickMode, setPickMode] = useState(false)
  const enterPick = () => { setPickMode(true); setSelected(new Set()); setDetailId(null) }
  const exitPick = () => { setPickMode(false); setSelected(new Set()) }
  const confirmPick = () => {
    if (selected.size === 0) { exitPick(); return }
    addToPending([...selected])
    exitPick()
  }
  const [detailId, setDetailId] = useState<string | null>(null)
  const [hoveredVideo, setHoveredVideo] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState<MyAsset | null>(null)
  const [renameText, setRenameText] = useState('')
  const [tagText, setTagText] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)

  const dragDepth = useRef(0)
  /* 本次拖拽是不是「在我们自己的界面里起手」的。
     见下面导入监听的注释 —— 这是唯一可靠的判据。 */
  const ownDrag = useRef(false)

  // ── 加载 ──
  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(false)
    ;(async () => {
      try {
        await initLibrary()
        const [list, fl] = await Promise.all([listAssets(), listFolders()])
        if (!alive) return
        setAssets(list.sort((a, b) => b.createdAt - a.createdAt))
        setFolders(fl)
        setLoading(false)
        // 检测旧库：有数据且尚未迁移过才提示。已经迁移过的不再打扰。
        const [legacy, report] = await Promise.all([hasLegacyData(), readAssetMigrationReport()])
        if (!alive) return
        setMigration(report)
        setLegacyPending(legacy && report?.phase !== 'migrated')
      } catch {
        if (!alive) return
        setLoadError(true)
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [loadVersion])

  // ── 缩略图解析（内置图片直接用路径；视频懒截真实帧）──
  useEffect(() => {
    let alive = true
    ;(async () => {
      for (const a of assets) {
        if (!alive) return
        // 列表响应里已经带了 thumbnailUrl，直接拼地址即可 ——
        // 逐条再 get 一次会变成 N+1 请求（素材多时明显变慢），而这里拿到的信息是同一份。
        const u = a.thumbnailPath ? assetThumbUrl(a.id) : await getThumbURL(a.id)
        if (u) setThumbs((m) => (m[a.id] === u ? m : { ...m, [a.id]: u }))
      }
      // 内置视频：懒截一帧当海报（真实帧；小文件先出图）
      const vids = assets.filter((x) => x.mediaType === 'video').sort((x, y) => x.sizeBytes - y.sizeBytes)
      for (const a of vids) {
        if (!alive) return
        {
          const u = await captureBuiltinPoster()
          if (u && alive) setThumbs((m) => ({ ...m, [a.id]: u }))
        }
      }
    })()
    return () => { alive = false }
  }, [assets])

  // Esc 关闭检查器 / 浮层 / 重命名（输入框自己也会处理）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setPop(null)
      setDetailId(null)
      setRenaming(null)
      /* Esc 也能退出选择模式 —— 否则进了模式只能找那个按钮才能出来 */
      setPickMode(false)
      setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const detail = useMemo(() => assets.find((a) => a.id === detailId) ?? null, [assets, detailId])

  // ── 可见集合（统计/筛选共用同一份）──
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = assets.filter((a) => {
      if (node === 'favorites') return a.tags.includes('★')
      if (node === 'recent') return (a.lastUsedAt ?? 0) > 0
      if (node === 'project') return !!projectName && a.refs.some((r) => r.kind === 'project' && r.label === projectName)
      if (node === 'imported') return a.sourceType === 'imported'
      if (node === 'generated') return a.sourceType === 'generated'
      if (node === 'builtin') return a.sourceType === 'builtin'
      if (node === 'review:pending') return a.reviewStatus === 'pending'
      if (node === 'review:needs_review') return a.reviewStatus === 'needs_review'
      if (node === 'license:unknown') return a.licenseStatus === 'unknown'
      if (node === 'license:restricted') return a.licenseStatus === 'restricted'
      if (node === 'refs:none') return a.refs.length === 0
      if (node.startsWith('proj:')) { const pid = node.slice(5).split('|')[0]; return a.refs.some((r) => r.kind === 'project' && r.id === pid) }
      if (node.startsWith('type:')) return a.mediaType === node.slice(5)
      if (node.startsWith('folder:')) return a.folderId === node.slice(7)
      if (node.startsWith('tag:')) return a.tags.includes(node.slice(4))
      return true
    })
    if (typeFilter !== 'all') list = list.filter((a) => a.mediaType === typeFilter)
    if (q) {
      list = list.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)) ||
        (a.licenseDetails ?? '').toLowerCase().includes(q) ||
        SOURCE_LABEL[a.sourceType].includes(q))
    }
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'name': return a.name.localeCompare(b.name)
        case 'size': return b.sizeBytes - a.sizeBytes
        case 'duration': return (b.duration ?? 0) - (a.duration ?? 0)
        case 'used': return (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt)
        default: return b.createdAt - a.createdAt
      }
    })
  }, [assets, node, typeFilter, search, sortKey, projectName])

  const counts = useMemo(() => ({
    all: assets.length,
    favorites: assets.filter((a) => a.tags.includes('★')).length,
    recent: assets.filter((a) => (a.lastUsedAt ?? 0) > 0).length,
    imported: assets.filter((a) => a.sourceType === 'imported').length,
    generated: assets.filter((a) => a.sourceType === 'generated').length,
    builtin: assets.filter((a) => a.sourceType === 'builtin').length,
    project: assets.filter((a) => !!projectName && a.refs.some((r) => r.kind === 'project' && r.label === projectName)).length,
    pending: assets.filter((a) => a.reviewStatus === 'pending').length,
    needsReview: assets.filter((a) => a.reviewStatus === 'needs_review').length,
    licenseUnknown: assets.filter((a) => a.licenseStatus === 'unknown').length,
    restricted: assets.filter((a) => a.licenseStatus === 'restricted').length,
    refsNone: assets.filter((a) => a.refs.length === 0).length,
    totalBytes: assets.reduce((s, a) => s + a.sizeBytes, 0),
    type: (t: MediaType) => assets.filter((a) => a.mediaType === t).length,
    folder: (id: string) => assets.filter((a) => a.folderId === id).length,
  }), [assets, projectName])

  /** 项目划分（组织栏）：从 refs 里真实存在的项目关联合并计数，按素材数降序 */
  const projectList = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>()
    for (const a of assets) {
      const seen = new Set<string>()
      for (const r of a.refs) {
        if (r.kind !== 'project' || seen.has(r.id)) continue
        seen.add(r.id)
        const cur = m.get(r.id) ?? { label: r.label, count: 0 }
        cur.count++
        m.set(r.id, cur)
      }
    }
    return [...m.entries()].map(([id, v]) => ({ id, label: v.label, count: v.count }))
      .sort((x, y) => y.count - x.count)
  }, [assets])

  /** 标签云（组织栏）：按素材数降序，取前 10 */
  const tagList = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of assets) for (const t of a.tags) if (t !== '★') m.set(t, (m.get(t) ?? 0) + 1)
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)
  }, [assets])

  // ── 导入 ──
  /* 导入：不再弹「导入队列」面板（作者要求删掉）。但过程不能一声不响 ——
     逐个文件导入要读尺寸/时长/抽缩略图，十个文件可能等好几秒。
     所以用已有的全局 toast 汇报结果：成功入库 N 个，失败的指出名字。 */
  /**
   * 把旧版浏览器素材迁移到服务端。
   *
   * 界面只做两件事：显示真实进度、迁移完刷新。规则都在 assetMigration 里：
   * 逐条校验、失败不切换、旧库只读保留。
   */
  const runMigration = useCallback(async () => {
    if (migrating) return
    setMigrating(true)
    try {
      const report = await migrateIndexedDbAssets((progress) => {
        setMigrationDone(progress.index)
      })
      setMigration(report)
      if (report.phase === 'migrated') {
        setLegacyPending(false)
        emitToast(`已迁移 ${report.migrated} 个素材到素材库`)
        setLoadVersion((v) => v + 1)
      } else {
        // 失败时不切换数据源，旧数据仍在浏览器里，用户可以重试。
        emitToast(`迁移未完成：${report.failed} 个失败，原有素材仍然保留`)
      }
    } catch (error) {
      emitToast(error instanceof Error ? error.message : '迁移失败')
    } finally {
      setMigrating(false)
    }
  }, [migrating])

  const runImport = useCallback(async (files: File[]) => {
    if (!files.length) return
    const failed: string[] = []
    const outcome = await importFiles(files, (e) => {
      if (e.phase === 'error') failed.push(e.name)
    })
    const ok = outcome.created
    if (ok.length) setAssets((prev) => [...ok, ...prev])
    if (ok.length > 0 && failed.length === 0) {
      emitToast(ok.length === 1 ? `已导入「${ok[0].name}」` : `已导入 ${ok.length} 个素材`)
    } else if (ok.length > 0) {
      emitToast(`导入 ${ok.length} 个，${failed.length} 个失败：${failed.slice(0, 2).join('、')}${failed.length > 2 ? ' 等' : ''}`)
    } else if (failed.length > 0) {
      emitToast(`导入失败：${failed.slice(0, 2).join('、')}${failed.length > 2 ? ' 等' : ''}`)
    }
  }, [])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    void runImport(files)
  }

  useEffect(() => {
    /* 只负责「把系统文件拖进来就导入」这个行为本身。原来那个铺满画布的
       「松手导入到我的素材」浮层已按作者要求删掉 —— 导入不需要这么大的提示，
       而那个浮层还会和「待发送」的拖拽提示混淆。

       ⚠️ 判定「是不是外部文件」不能只看 dataTransfer.files ——
       应用内拖一张**真实路径**的图片（内置素材缩略图就是 ./frames/film/s06.jpg）
       时，Chrome 按原生图片拖拽处理，照样往 files 里塞一个名字为 s06.jpg 的 File。
       于是用户只是想拖进待发送，松手却成了「导入」，还多出一张重复卡片。

       可靠判据是**拖拽起点**：系统拖入不会在本页触发 dragstart，
       应用内任何拖拽（卡片、缩略图、详情大图）都会冒泡到 window。
       所以：本页起手的拖拽一律不导入，只有真正的系统文件才走导入。 */
    const enter = (e: DragEvent) => {
      if (ownDrag.current || isAssetDrag(e.dataTransfer)) return
      if (e.dataTransfer?.types.includes('Files')) { dragDepth.current++ }
    }
    const over = (e: DragEvent) => {
      if (ownDrag.current || isAssetDrag(e.dataTransfer)) return
      e.preventDefault()
    }
    const leave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1) }
    const drop = (e: DragEvent) => {
      const mine = ownDrag.current || isAssetDrag(e.dataTransfer)
      ownDrag.current = false          // 兜底复位：某些路径下 dragend 可能不到
      if (mine) return
      e.preventDefault()
      dragDepth.current = 0
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) void runImport(files)
    }
    /* 记录拖拽起点。dragstart 只在「拖拽源在本页」时触发 —— 这正是我们要的判据。 */
    const markOwn = () => { ownDrag.current = true }
    const clearOwn = () => { ownDrag.current = false }
    window.addEventListener('dragstart', markOwn, true)
    window.addEventListener('dragend', clearOwn, true)
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragstart', markOwn, true)
      window.removeEventListener('dragend', clearOwn, true)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [runImport])

  // ── 操作 ──
  const openDetail = (a: MyAsset) => {
    setDetailId(a.id)
    if (!a.lastUsedAt || Date.now() - a.lastUsedAt > 60_000) {
      const t = Date.now()
      void updateAsset(a.id, { lastUsedAt: t })
      setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, lastUsedAt: t } : x)))
    }
  }

  const toggleFav = (a: MyAsset) => {
    const tags = a.tags.includes('★') ? a.tags.filter((t) => t !== '★') : [...a.tags, '★']
    void updateAsset(a.id, { tags })
    setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, tags } : x)))
  }

  const applyPatch = (id: string, patch: Partial<MyAsset>) => {
    void updateAsset(id, patch)
    setAssets((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  const doRename = () => {
    if (!renaming) return
    const name = renameText.trim()
    if (name && name !== renaming.name) applyPatch(renaming.id, { name })
    setRenaming(null)
  }

  const doDelete = (ids: string[]) => {
    const refd = assets.filter((a) => ids.includes(a.id) && a.refs.length > 0)
    const msg = refd.length
      ? `以下素材仍被引用：\n${refd.map((a) => `· ${a.name} ← ${a.refs.map((r) => r.label).join('、')}`).join('\n')}\n\n服务端会拒绝删除被引用的素材；仍要尝试删除 ${ids.length} 项？`
      : `从素材库移除 ${ids.length} 项？文件会一并删除，不可恢复。`
    if (!window.confirm(msg)) return
    // 等服务端真实结果再更新界面：被引用的素材服务端会 409 拒绝，
    // 若先乐观从列表里移除，用户会以为删掉了，刷新后又冒出来。
    void removeAssets(ids).then(({ failed }) => {
      const failedIds = new Set(failed.map((f) => f.id))
      const removed = ids.filter((id) => !failedIds.has(id))
      if (removed.length > 0) {
        setAssets((prev) => prev.filter((a) => !removed.includes(a.id)))
        setSelected((s) => { const n = new Set(s); removed.forEach((i) => n.delete(i)); return n })
        if (detailId && removed.includes(detailId)) setDetailId(null)
      }
      if (failed.length > 0) {
        emitToast(`有 ${failed.length} 项未删除：${failed[0].error}`)
      }
    }).catch((error: unknown) => {
      emitToast(error instanceof Error ? error.message : '删除失败')
    })
  }

  const copyPath = async (a: MyAsset) => {
    try { await navigator.clipboard.writeText(a.filePath) } catch { /* 剪贴板不可用时静默 */ }
  }

  const exportList = (ids: string[]) => {
    const rows = assets.filter((a) => ids.includes(a.id)).map((a) => ({
      name: a.name, mediaType: a.mediaType, sizeBytes: a.sizeBytes,
      duration: a.duration, width: a.width, height: a.height,
      source: SOURCE_LABEL[a.sourceType], license: LICENSE_LABEL[a.licenseStatus],
      tags: a.tags.join(' '), path: a.filePath,
    }))
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = 'my-assets.json'; link.click()
    URL.revokeObjectURL(url)
  }

  const addFolder = () => {
    const name = window.prompt('新建文件夹名称')
    if (!name?.trim()) return
    // 文件夹由服务端建：同名会返回 409，所以这里等结果再更新界面，
    // 不能先乐观插一条再用服务端的覆盖 —— 失败时界面会多出一个不存在的文件夹。
    void createFolder(name.trim())
      .then((f) => setFolders((prev) => [...prev, f]))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '新建文件夹失败'
        emitToast(message)
      })
  }

  const moveToFolder = (ids: string[], folderId: string | null) => {
    for (const id of ids) void updateAsset(id, { folderId })
    setAssets((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, folderId } : a)))
  }

  const toggleSelect = (id: string) => {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const clearFilter = () => { setNode('all'); setSearch(''); setTypeFilter('all') }

  /** 网格方向键导航：移动焦点并同步打开检查器（G 键盘口径） */
  const onGridKeys = (e: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    const grid = e.currentTarget as HTMLElement
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.mya-card'))
    if (!cards.length) return
    const idx = cards.indexOf(document.activeElement as HTMLElement)
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length)
    let next = idx
    if (idx === -1) next = 0
    else if (e.key === 'ArrowRight') next = idx + 1
    else if (e.key === 'ArrowLeft') next = idx - 1
    else if (e.key === 'ArrowDown') next = idx + cols
    else next = idx - cols
    next = Math.min(Math.max(next, 0), cards.length - 1)
    if (next === idx) return
    e.preventDefault()
    cards[next].focus()
    const a = visible[next]
    if (a) openDetail(a)
  }

  // ── 渲染 ──
  const coreNodes: TreeEntry[] = [
    { id: 'all', label: '全部素材', icon: 'layout-grid', count: counts.all },
    { id: 'favorites', label: '收藏', icon: 'star', count: counts.favorites },
    { id: 'recent', label: '最近使用', icon: 'history', count: counts.recent },
  ]
  const projectNodes: TreeEntry[] = projectList.map((p) => ({
    id: `proj:${p.id}|${p.label}`, label: p.label, icon: 'clapperboard', count: p.count,
  }))
  const sourceNodes: TreeEntry[] = [
    { id: 'imported', label: '导入素材', icon: 'download', count: counts.imported },
    { id: 'generated', label: '生成结果', icon: 'sparkles', count: counts.generated },
    { id: 'builtin', label: '内置素材', icon: 'box', count: counts.builtin },
  ]
  const smartNodes: TreeEntry[] = [
    { id: 'review:pending', label: '待审核', icon: 'loader-circle', count: counts.pending },
    { id: 'review:needs_review', label: '需复核', icon: 'circle-alert', count: counts.needsReview },
    { id: 'license:unknown', label: '授权未知', icon: 'circle-help', count: counts.licenseUnknown },
    { id: 'license:restricted', label: '限制使用', icon: 'lock-keyhole', count: counts.restricted },
    { id: 'refs:none', label: '未被引用', icon: 'link', count: counts.refsNone },
  ]
  const activeLabel = nodeLabel(node, folders)

  const renderNav = (t: TreeEntry) => (
    <button key={t.id} type="button" className="mya-org-row" data-on={node === t.id || undefined}
            aria-pressed={node === t.id}
            onClick={() => setNode(t.id)}>
      <Icon name={t.icon} />
      <span className="mya-org-label">{t.label}</span>
      <em>{t.count}</em>
    </button>
  )

  return (
    <div className="mya">
      <AssetsHeader
        activeLabel={activeLabel}
        assets={assets}
        clearFilter={clearFilter}
        counts={counts}
        enterPick={enterPick}
        inputRef={inputRef}
        node={node}
        orgOpen={orgOpen}
        pickMode={pickMode}
        pop={pop}
        search={search}
        setOrgOpen={setOrgOpen}
        setPop={setPop}
        setSearch={setSearch}
        setSortKey={setSortKey}
        setTypeFilter={setTypeFilter}
        setViewMode={setViewMode}
        sortKey={sortKey}
        typeFilter={typeFilter}
        viewMode={viewMode}
      />
      <input ref={inputRef} type="file" multiple hidden onChange={onPick} />

      <div className="mya-body">
        {orgOpen && (
          <aside className="mya-org" aria-label="素材组织">
            <div className="mya-org-head">
              <span>组织</span>
              <button type="button" className="mya-org-toggle" onClick={() => setOrgOpen(false)}
                      title="收起组织栏" aria-label="收起组织栏">
                <Icon name="panel-left-close" />
              </button>
            </div>
            <div className="mya-org-scroll">
              <div className="mya-org-sec">库</div>
              {coreNodes.map(renderNav)}
              <div className="mya-org-sec">来源</div>
              {sourceNodes.map(renderNav)}
              {projectNodes.length > 0 && (
                <>
                  <div className="mya-org-sec">项目</div>
                  {projectNodes.map(renderNav)}
                </>
              )}
              <div className="mya-org-sec">智能文件夹</div>
              {smartNodes.map(renderNav)}
              <div className="mya-org-sec">文件夹</div>
              {folders.map((f) => renderNav({ id: `folder:${f.id}`, label: f.name, icon: 'folder-open', count: counts.folder(f.id) }))}
              <button type="button" className="mya-org-add" onClick={addFolder}>
                <Icon name="folder-plus" /><span>新建文件夹</span>
              </button>
              {tagList.length > 0 && (
                <>
                  <div className="mya-org-sec">标签</div>
                  {tagList.map(([t, c]) => (
                    <button key={t} type="button" className="mya-org-row" data-on={node === `tag:${t}` || undefined}
                            aria-pressed={node === `tag:${t}`}
                            onClick={() => setNode(`tag:${t}`)}>
                      <span className="mya-tagdot" style={{ background: tagColor(t) }} />
                      <span className="mya-org-label">{t}</span>
                      <em>{c}</em>
                    </button>
                  ))}
                </>
              )}
            </div>
            <div className="mya-org-foot">
              <Icon name="cylinder" />
              <span className="mono">{formatBytes(counts.totalBytes)}</span>
              <span>· 素材库 {counts.all} 项</span>
            </div>
          </aside>
        )}

        <div className="mya-main">
          {/* 搜索与「网格 / 列表 / 类型 / 排序」已并入页头，顶部不再叠两层空白。
              这条工具条只在选择模式或批量操作时出现，用来放临时的操作行。 */}
          {(pickMode || selected.size > 0) && (
            <div className="mya-toolbar">
              {pickMode ? (
                <div className="mya-toolbar-pick">
                  <Icon name="square-check" />
                  <b>选择素材</b>
                  <span>点卡片选中，选完点底部「确认加入待发送」</span>
                </div>
              ) : (
              <div className="mya-batch" role="region" aria-label="批量操作">
                <span className="mya-batch-n">已选 {selected.size} 项</span>
                {/* 加入待发送放在最前：多选之后最常做的是"这次就用这几个" */}
                <button type="button" className="mya-batch-pending"
                        onClick={() => { addToPending([...selected]); setSelected(new Set()) }}>
                  加入待发送
                </button>
                <button type="button" onClick={() => setSelected(new Set(visible.map((a) => a.id)))}>全选当前</button>
                <button type="button" onClick={() => setSelected(new Set())}>清除选择</button>
                <span className="mya-batch-sep" />
                <button type="button" onClick={() => { for (const a of assets) if (selected.has(a.id) && !a.tags.includes('★')) toggleFav(a) }}>收藏</button>
                <button type="button" onClick={() => { const t = window.prompt('给选中素材添加标签'); if (t?.trim()) { for (const a of assets) if (selected.has(a.id)) applyPatch(a.id, { tags: [...new Set([...a.tags, t.trim()])] }) } }}>加标签</button>
                <button type="button" onClick={() => { const f = window.prompt('移动到文件夹（输入名称，留空=移出）'); if (f === null) return; const target = f.trim() ? folders.find((x) => x.name === f.trim()) ?? null : null; if (f.trim() && !target) { window.alert('没有这个文件夹，先在组织栏新建'); return } moveToFolder([...selected], target?.id ?? null) }}>移动</button>
                <button type="button" onClick={() => exportList([...selected])}>导出清单</button>
                <button type="button" className="mya-danger" onClick={() => doDelete([...selected])}>删除</button>
              </div>
              )}
            </div>
          )}
          {pop && <div className="mya-popshade" onClick={() => setPop(null)} />}

          <AssetCanvas
            addToPending={addToPending}
            assets={assets}
            clearFilter={clearFilter}
            detailId={detailId}
            hoveredVideo={hoveredVideo}
            inputRef={inputRef}
            legacyPending={legacyPending}
            loadError={loadError}
            loading={loading}
            migrating={migrating}
            migration={migration}
            migrationDone={migrationDone}
            node={node}
            onGridKeys={onGridKeys}
            openDetail={openDetail}
            pending={pending}
            pickMode={pickMode}
            runMigration={runMigration}
            selected={selected}
            setHoveredVideo={setHoveredVideo}
            setLoadVersion={setLoadVersion}
            sortKey={sortKey}
            thumbs={thumbs}
            toggleFav={toggleFav}
            toggleSelect={toggleSelect}
            typeFilter={typeFilter}
            viewMode={viewMode}
            visible={visible}
          />

        </div>

        {detail && (
          <AssetInspector
            addToPending={addToPending}
            applyPatch={applyPatch}
            copyPath={copyPath}
            detail={detail}
            doDelete={doDelete}
            pending={pending}
            setDetailId={setDetailId}
            setRenameText={setRenameText}
            setRenaming={setRenaming}
            setTagText={setTagText}
            tagText={tagText}
            thumbs={thumbs}
            toggleFav={toggleFav}
          />
        )}
      </div>

      {/* 选择模式的确认条：浮在底部中央。整库进入可选中状态后，
          这里只做三件事 —— 报数、全选、确认。 */}
      {pickMode && (
        <div className="mya-pickbar" role="region" aria-label="选择素材">
          <span className="mya-pickbar-n">
            {selected.size > 0 ? `已选 ${selected.size} 项` : '点素材卡片选择'}
          </span>
          <button type="button" className="mya-pickbar-all"
                  onClick={() => setSelected(new Set(visible.map((a) => a.id)))}>
            全选当前 {visible.length} 项
          </button>
          <span className="mya-pickbar-sep" />
          <button type="button" onClick={exitPick}>取消</button>
          <button type="button" className="mya-primary" disabled={selected.size === 0}
                  onClick={confirmPick}>
            <Icon name="square-check" />
            确认加入待发送{selected.size > 0 ? `（${selected.size}）` : ''}
          </button>
        </div>
      )}

      {renaming && (
        <div className="mya-modal" onClick={() => setRenaming(null)}>
          <div className="mya-modal-card" onClick={(e) => e.stopPropagation()}>
            <h4>重命名</h4>
            <input value={renameText} autoFocus onChange={(e) => setRenameText(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRenaming(null) }} />
            <div className="mya-modal-acts">
              <button type="button" onClick={() => setRenaming(null)}>取消</button>
              <button type="button" className="mya-primary" onClick={doRename}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

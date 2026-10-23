import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LICENSE_LABEL, MEDIA_ICON, MEDIA_LABEL, REVIEW_LABEL, SOURCE_LABEL,
  type LicenseStatus, type MediaType, type MyAsset, type ReviewStatus,
} from '@/data/myAssets'
import {
  captureBuiltinPoster, formatBytes, formatDur, getFileURL, getThumbURL,
  importFiles, initLibrary, listAssets, listFolders, removeAssets, saveFolders,
  updateAsset, type FolderRow, type ImportEvent,
} from '@/services/assetService'
import { EmptyState } from '@/components/fm/EmptyState'
import { ErrorState } from '@/components/fm/ErrorState'
import { LoadingState } from '@/components/fm/LoadingState'

/**
 * 我的素材 —— 原生多媒体素材管理器。
 *
 * 职责：管理**真实文件**的索引与元数据 —— 用户导入的文件、工作流输入与生成结果；
 * 不负责镜头分析（参考片库），不负责技法定义（特效库）。
 *
 * 数据真实性：
 *   · 内置种子 = 仓库真实文件（实测元数据）；导入 = 真实读取（尺寸/时长/缩略图），
 *     本体存 IndexedDB，刷新/重启仍在；「落盘到系统目录」未接入（不承诺）。
 *   · 授权（licenseStatus）与审核（reviewStatus）分离；未确认授权一律 unknown。
 *   · 删除前检查引用；被项目引用的素材给出警告。批量操作全部真实生效。
 *
 * 视觉：A2 云端岛屿 V3（三层浮岛）。基岛 = 顶栏/状态栏，中岛 = 左素材栏/右检查器，
 * 主岛 = 素材画布。全部颜色/圆角/阴影/动效来自 myassets.css 的 V3 token；
 * 本文件不写任何色值。字号只用 13 / 12.5 / 11.5 / 11 / 10.5，数字一律等宽。
 */

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`/assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

type NodeId = 'all' | 'favorites' | 'recent' | 'project' | 'imported' | 'generated' | 'builtin'
  | 'review:pending' | 'review:needs_review' | 'license:unknown' | 'license:restricted'
  | `type:${MediaType}` | `folder:${string}`
type SortKey = 'recent' | 'used' | 'name' | 'size' | 'duration'
type TreeEntry = { id: NodeId; label: string; icon: string; count: number }

const SORT_LABEL: Record<SortKey, string> = {
  recent: '最近导入', used: '最近使用', name: '名称', size: '大小', duration: '时长',
}

const TYPE_IDS: MediaType[] = ['image', 'video', 'audio', 'font', 'doc']

/** 当前分类的中文名（顶栏 / 左栏 / 命令条共用） */
function nodeLabel(id: NodeId, folders: FolderRow[]): string {
  if (id.startsWith('type:')) return MEDIA_LABEL[id.slice(5) as MediaType]
  if (id.startsWith('folder:')) return folders.find((f) => f.id === id.slice(7))?.name ?? '文件夹'
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
    default: return '全部素材'
  }
}

/**
 * 网格里只显示「需要有人处理」的异常状态。
 * 待审核是生成结果的默认状态，不逐格重复；它在列表审核列、右栏和状态栏里可见。
 */
function assetFlag(a: MyAsset): { label: string; tone: 'warn' | 'bad' } | null {
  if (a.licenseStatus === 'restricted') return { label: LICENSE_LABEL.restricted, tone: 'bad' }
  if (a.licenseStatus === 'unknown') return { label: LICENSE_LABEL.unknown, tone: 'warn' }
  if (a.reviewStatus === 'needs_review') return { label: REVIEW_LABEL.needs_review, tone: 'warn' }
  if (a.licenseStatus === 'attribution_required') return { label: LICENSE_LABEL.attribution_required, tone: 'warn' }
  return null
}

/** 卡片第二行：媒体属性优先（时长 / 尺寸），来源留给列表和右栏 */
function cardSpec(a: MyAsset): string {
  if (a.mediaType === 'video') {
    return [a.duration != null ? formatDur(a.duration) : null,
            a.width != null ? `${a.width}×${a.height}` : null].filter(Boolean).join(' · ')
  }
  if (a.mediaType === 'audio') return a.duration != null ? `音频 · ${formatDur(a.duration)}` : '音频'
  if (a.mediaType === 'image') {
    return [a.width != null ? `${a.width}×${a.height}` : null, formatBytes(a.sizeBytes)]
      .filter(Boolean).join(' · ')
  }
  return `${MEDIA_LABEL[a.mediaType]} · ${formatBytes(a.sizeBytes)}`
}

function listSpec(a: MyAsset): string {
  if (a.mediaType === 'video' || a.mediaType === 'audio') return formatDur(a.duration)
  if (a.width != null && a.height != null) return `${a.width}×${a.height}`
  return '—'
}

function fullMeta(a: MyAsset): string {
  const dims = a.width != null ? ` · ${a.width}×${a.height}` : ''
  return `${a.name}\n${SOURCE_LABEL[a.sourceType]} · ${formatBytes(a.sizeBytes)}${dims}\n授权：${LICENSE_LABEL[a.licenseStatus]} · 审核：${REVIEW_LABEL[a.reviewStatus]}`
}

interface QueueRow extends ImportEvent { file: File }

export function Assets({ projectName }: { projectName?: string } = {}) {
  const [assets, setAssets] = useState<MyAsset[]>([])
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [loadVersion, setLoadVersion] = useState(0)
  const [node, setNode] = useState<NodeId>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('recent')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [queue, setQueue] = useState<QueueRow[] | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [renaming, setRenaming] = useState<MyAsset | null>(null)
  const [renameText, setRenameText] = useState('')
  const [tagText, setTagText] = useState('')
  const [filterOverflow, setFilterOverflow] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)

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
        const u = await getThumbURL(a.id)
        if (u) setThumbs((m) => (m[a.id] === u ? m : { ...m, [a.id]: u }))
      }
      // 内置视频：懒截一帧当海报（真实帧；小文件先出图）
      const vids = assets.filter((x) => x.mediaType === 'video').sort((x, y) => x.sizeBytes - y.sizeBytes)
      for (const a of vids) {
        if (!alive) return
        {
          const u = await captureBuiltinPoster(a.id)
          if (u && alive) setThumbs((m) => ({ ...m, [a.id]: u }))
        }
      }
    })()
    return () => { alive = false }
  }, [assets])

  // Esc 关闭详情 / 重命名（输入框自己也会处理）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setDetailId(null)
      setRenaming(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 筛选条溢出时才显示“查看更多”与渐隐，避免在 1920 下无谓出现
  useEffect(() => {
    const el = filtersRef.current
    if (!el) return
    const check = () => setFilterOverflow(el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    window.addEventListener('resize', check)
    return () => { ro.disconnect(); window.removeEventListener('resize', check) }
  }, [assets, folders, search, node])

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
      if (node.startsWith('type:')) return a.mediaType === node.slice(5)
      if (node.startsWith('folder:')) return a.folderId === node.slice(7)
      return true
    })
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
  }, [assets, node, search, sortKey, projectName])

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
    type: (t: MediaType) => assets.filter((a) => a.mediaType === t).length,
    folder: (id: string) => assets.filter((a) => a.folderId === id).length,
  }), [assets, projectName])

  // ── 导入 ──
  const runImport = useCallback(async (files: File[]) => {
    if (!files.length) return
    const rows: QueueRow[] = files.map((file) => ({ file, fileIndex: 0, fileName: file.name, phase: 'queued' }))
    setQueue(rows)
    const ok = await importFiles(files, (e) => {
      setQueue((qs) => qs ? qs.map((r, i) => (i === e.fileIndex ? { ...r, ...e, file: r.file } : r)) : qs)
    })
    if (ok.length) setAssets((prev) => [...ok, ...prev])
  }, [])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    void runImport(files)
  }

  useEffect(() => {
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth.current++; setDragOver(true) } }
    const over = (e: DragEvent) => { e.preventDefault() }
    const leave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragOver(false) }
    const drop = (e: DragEvent) => {
      e.preventDefault(); dragDepth.current = 0; setDragOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) void runImport(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
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
      ? `以下素材仍被引用：\n${refd.map((a) => `· ${a.name} ← ${a.refs.map((r) => r.label).join('、')}`).join('\n')}\n\n确定从素材库移除 ${ids.length} 项？`
      : `从素材库移除 ${ids.length} 项？（本地索引删除，可重新导入）`
    if (!window.confirm(msg)) return
    void removeAssets(ids)
    setAssets((prev) => prev.filter((a) => !ids.includes(a.id)))
    setSelected((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n })
    if (detailId && ids.includes(detailId)) setDetailId(null)
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
    const f: FolderRow = { id: `f-${crypto.randomUUID()}`, name: name.trim(), createdAt: Date.now() }
    const next = [...folders, f]
    setFolders(next)
    void saveFolders(next)
  }

  const moveToFolder = (ids: string[], folderId: string | null) => {
    for (const id of ids) void updateAsset(id, { folderId })
    setAssets((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, folderId } : a)))
  }

  const toggleSelect = (id: string) => {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const clearFilter = () => { setNode('all'); setSearch('') }

  // ── 渲染 ──
  const TREE: TreeEntry[] = [
    { id: 'all', label: '全部素材', icon: 'layout-grid', count: counts.all },
    ...(projectName ? [{ id: 'project' as NodeId, label: '本项目素材', icon: 'folder-open', count: counts.project }] : []),
    { id: 'favorites', label: '收藏', icon: 'star', count: counts.favorites },
    { id: 'recent', label: '最近使用', icon: 'history', count: counts.recent },
    { id: 'imported', label: '导入素材', icon: 'download', count: counts.imported },
    { id: 'generated', label: '生成结果', icon: 'sparkles', count: counts.generated },
    { id: 'builtin', label: '内置素材', icon: 'box', count: counts.builtin },
  ]
  const coreNodes = TREE.filter((t) => t.id === 'all' || t.id === 'project' || t.id === 'favorites' || t.id === 'recent')
  const sourceNodes = TREE.filter((t) => t.id === 'imported' || t.id === 'generated' || t.id === 'builtin')
  const typeNodes: TreeEntry[] = TYPE_IDS.map((t) => ({
    id: `type:${t}`, label: MEDIA_LABEL[t], icon: MEDIA_ICON[t], count: counts.type(t),
  }))
  const reviewNodes: TreeEntry[] = [
    { id: 'review:pending', label: '待审核', icon: 'loader-circle', count: counts.pending },
    { id: 'review:needs_review', label: '需复核', icon: 'circle-alert', count: counts.needsReview },
    { id: 'license:unknown', label: '授权未知', icon: 'circle-help', count: counts.licenseUnknown },
    { id: 'license:restricted', label: '限制使用', icon: 'lock-keyhole', count: counts.restricted },
  ]
  const activeLabel = nodeLabel(node, folders)

  const renderChip = (t: TreeEntry) => (
    <button key={t.id} type="button" className="mya-chip" data-on={node === t.id || undefined}
            aria-pressed={node === t.id}
            onClick={() => setNode(t.id)}>
      <span>{t.label}</span><em>{t.count}</em>
    </button>
  )

  return (
    <div className="mya">
      <header className="mya-cmd">
        <span className="mya-logo"><Icon name="image" /></span>
        <h1 className="mya-title">我的素材</h1>
        <span className="mya-meta">{projectName ? `${projectName} · ` : ''}{assets.length} 项</span>
        <span className="mya-spacer" />
        <label className="mya-search">
          <Icon name="search" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
                 placeholder="搜索名称、标签、来源" aria-label="搜索素材" />
          {search && <button type="button" className="mya-search-x" onClick={() => setSearch('')} title="清除搜索" aria-label="清除搜索"><Icon name="x" /></button>}
        </label>
        <div className="mya-seg" role="group" aria-label="视图模式">
          <button type="button" className={viewMode === 'grid' ? 'on' : undefined}
                  aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')}>
            <Icon name="layout-grid" />网格
          </button>
          <button type="button" className={viewMode === 'list' ? 'on' : undefined}
                  aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}>
            <Icon name="list" />列表
          </button>
        </div>
        <button type="button" className="mya-primary" onClick={() => inputRef.current?.click()}>
          <Icon name="import" />导入素材
        </button>
        <input ref={inputRef} type="file" multiple hidden onChange={onPick} />
      </header>

      <div className="mya-filterbar">
        {selected.size > 0 ? (
          <div className="mya-batch" role="region" aria-label="批量操作">
            <span className="mya-batch-n">已选 {selected.size} 项</span>
            <button type="button" onClick={() => setSelected(new Set(visible.map((a) => a.id)))}>全选当前</button>
            <button type="button" onClick={() => setSelected(new Set())}>清除选择</button>
            <span className="mya-batch-sep" />
            <button type="button" onClick={() => { for (const a of assets) if (selected.has(a.id) && !a.tags.includes('★')) toggleFav(a) }}>收藏</button>
            <button type="button" onClick={() => { const t = window.prompt('给选中素材添加标签'); if (t?.trim()) { for (const a of assets) if (selected.has(a.id)) applyPatch(a.id, { tags: [...new Set([...a.tags, t.trim()])] }) } }}>加标签</button>
            <button type="button" onClick={() => { const f = window.prompt('移动到文件夹（输入名称，留空=移出）'); if (f === null) return; const target = f.trim() ? folders.find((x) => x.name === f.trim()) ?? null : null; if (f.trim() && !target) { window.alert('没有这个文件夹，先在左侧新建'); return } moveToFolder([...selected], target?.id ?? null) }}>移动</button>
            <button type="button" onClick={() => exportList([...selected])}>导出清单</button>
            <button type="button" className="mya-danger" onClick={() => doDelete([...selected])}>删除</button>
          </div>
        ) : (
          <>
            <div className="mya-filters" ref={filtersRef} data-more={filterOverflow || undefined} role="toolbar" aria-label="素材筛选">
              <span className="mya-filter-label">库</span>
              {coreNodes.map(renderChip)}
              <span className="mya-filter-group">
                <span className="mya-filter-label">来源</span>
                {sourceNodes.map(renderChip)}
              </span>
              <span className="mya-filter-group">
                <span className="mya-filter-label">类型</span>
                {typeNodes.map(renderChip)}
              </span>
              <span className="mya-filter-group">
                <span className="mya-filter-label">审核</span>
                {reviewNodes.map(renderChip)}
              </span>
              <span className="mya-filter-group">
                <span className="mya-filter-label">文件夹</span>
                {folders.map((f) => (
                  <button key={f.id} type="button" className="mya-chip" data-on={node === `folder:${f.id}` || undefined}
                          aria-pressed={node === `folder:${f.id}`}
                          onClick={() => setNode(`folder:${f.id}`)}>
                    <span>{f.name}</span><em>{counts.folder(f.id)}</em>
                  </button>
                ))}
                <button type="button" className="mya-chip mya-chip-add" onClick={addFolder} title="新建文件夹" aria-label="新建文件夹">
                  <Icon name="folder-plus" /><span>新建</span>
                </button>
              </span>
            </div>
            {filterOverflow && (
              <button type="button" className="mya-filter-more"
                      onClick={() => {
                        const el = filtersRef.current
                        if (!el) return
                        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
                        if (atEnd) el.scrollTo({ left: 0, behavior: 'smooth' })
                        else el.scrollBy({ left: 260, behavior: 'smooth' })
                      }}
                      title="查看更多筛选" aria-label="查看更多筛选">
                <Icon name="chevron-right" />
              </button>
            )}
            <div className="mya-filter-end">
              <span className="mya-result-count">{activeLabel} · {visible.length} 项</span>
              {(node !== 'all' || search) && <button type="button" className="mya-link" onClick={clearFilter}>清除筛选</button>}
              <label className="mya-sort">
                排序
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="排序方式">
                  {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
                </select>
              </label>
            </div>
          </>
        )}
      </div>

      <main className="mya-canvas">
        <div className="mya-scroll">
          {loading ? (
            <LoadingState variant="grid" rows={8} />
          ) : loadError ? (
            <ErrorState
              body="素材索引读取失败，可能是本地存储暂时不可用。请重试。"
              onRetry={() => setLoadVersion((v) => v + 1)}
            />
          ) : visible.length === 0 ? (
            assets.length === 0 ? (
              <EmptyState
                icon="image"
                title="素材库还是空的"
                body={'把图片、视频、音频、字体拖进来，或点右上角「导入素材」。\n文件本体保存在本地索引，刷新后仍在。'}
                action={{ label: '导入素材', onClick: () => inputRef.current?.click() }}
              />
            ) : (
              <EmptyState
                icon="image"
                title="没有符合当前筛选的素材"
                body="换个分类，或清除搜索条件。"
                action={{ label: '清除筛选', onClick: clearFilter }}
              />
            )
          ) : viewMode === 'grid' ? (
            <div className="mya-grid">
              {visible.map((a) => {
                const flag = assetFlag(a)
                return (
                  <div key={a.id} className="mya-card"
                       data-on={detailId === a.id || undefined}
                       data-picked={selected.has(a.id) || undefined}
                       role="option" aria-selected={detailId === a.id} tabIndex={0}
                       title={fullMeta(a)}
                       onClick={() => openDetail(a)}
                       onKeyDown={(e) => {
                         if (e.target !== e.currentTarget) return
                         if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(a) }
                       }}>
                    <div className="mya-thumb">
                      {thumbs[a.id]
                        ? <img src={thumbs[a.id]} alt="" loading="lazy" />
                        : <span className="mya-thumb-ph"><Icon name={MEDIA_ICON[a.mediaType]} /></span>}
                      {a.duration != null && (a.mediaType === 'video' || a.mediaType === 'audio') &&
                        <span className="mya-dur mono">{formatDur(a.duration)}</span>}
                      <label className="mya-check" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)}
                               aria-label={`选择 ${a.name}`} />
                      </label>
                      <button type="button" className="mya-star" data-on={a.tags.includes('★') || undefined}
                              aria-label={a.tags.includes('★') ? `取消收藏 ${a.name}` : `收藏 ${a.name}`}
                              onClick={(e) => { e.stopPropagation(); toggleFav(a) }}>
                        <Icon name="star" />
                      </button>
                    </div>
                    <div className="mya-card-body">
                      <div className="mya-card-name">{a.name}</div>
                      <div className="mya-card-meta">
                        <span className="mya-card-spec mono">{cardSpec(a)}</span>
                        {flag && <span className="mya-flag" data-tone={flag.tone}>{flag.label}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mya-list">
              <div className="mya-list-head">
                <span className="mya-col-check" />
                <span className="mya-col-name">名称</span>
                <span className="mya-col-type">类型</span>
                <span className="mya-col-dim">时长 / 尺寸</span>
                <span className="mya-col-size">大小</span>
                <span className="mya-col-src">来源</span>
                <span className="mya-col-lic">授权</span>
                <span className="mya-col-rev">审核</span>
              </div>
              {visible.map((a) => (
                <div key={a.id} className="mya-row"
                     data-on={detailId === a.id || undefined}
                     data-picked={selected.has(a.id) || undefined}
                     role="option" aria-selected={detailId === a.id} tabIndex={0}
                     onClick={() => openDetail(a)}
                     onKeyDown={(e) => {
                       if (e.target !== e.currentTarget) return
                       if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(a) }
                     }}>
                  <span className="mya-col-check" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)}
                           aria-label={`选择 ${a.name}`} />
                  </span>
                  <span className="mya-col-name">
                    <span className="mya-row-thumb">
                      {thumbs[a.id] ? <img src={thumbs[a.id]} alt="" loading="lazy" />
                                    : <Icon name={MEDIA_ICON[a.mediaType]} />}
                    </span>
                    <span className="mya-row-name" title={a.name}>{a.name}</span>
                    {a.tags.includes('★') && <Icon name="star" className="mya-row-star" />}
                  </span>
                  <span className="mya-col-type">{MEDIA_LABEL[a.mediaType]}</span>
                  <span className="mya-col-dim mono">{listSpec(a)}</span>
                  <span className="mya-col-size mono">{formatBytes(a.sizeBytes)}</span>
                  <span className="mya-col-src">{SOURCE_LABEL[a.sourceType]}</span>
                  <span className="mya-col-lic"><span className="mya-status-pill" data-s={a.licenseStatus}>{LICENSE_LABEL[a.licenseStatus]}</span></span>
                  <span className="mya-col-rev"><span className="mya-status-pill" data-s={a.reviewStatus}>{REVIEW_LABEL[a.reviewStatus]}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <div className="mya-status">
        <span className="mya-pill"><i className="mya-dot" />就绪</span>
        <span className="mya-pill">{assets.length} 项</span>
        {selected.size > 0 && <span className="mya-pill">{selected.size} 已选</span>}
        <span className="mya-pill">{counts.pending} 待审核</span>
        <span className="mya-spacer" />
        <span className="mya-status-note">本地索引 · 刷新后仍在</span>
      </div>

      {detail && (
        <div className="mya-overlay" onClick={() => setDetailId(null)}>
          <aside className="mya-drawer" role="dialog" aria-modal="true" aria-label="素材详情"
                 onClick={(e) => e.stopPropagation()}>
            <div className="mya-drawer-head">
              <div className="mya-drawer-title-wrap">
                <span className="mya-drawer-title" title={detail.name}>{detail.name}</span>
                <span className="mya-drawer-meta">{MEDIA_LABEL[detail.mediaType]} · {SOURCE_LABEL[detail.sourceType]}</span>
              </div>
              <button type="button" className="mya-iconbtn" onClick={() => setDetailId(null)} title="关闭详情" aria-label="关闭详情"><Icon name="x" /></button>
            </div>

            <div className="mya-drawer-body">
              <div className="mya-preview">
                <Preview asset={detail} poster={thumbs[detail.id]} />
              </div>

              <div className="mya-actrow">
                <button type="button" onClick={() => { setRenaming(detail); setRenameText(detail.name) }}><Icon name="pencil" />重命名</button>
                <button type="button" onClick={() => toggleFav(detail)} data-on={detail.tags.includes('★') || undefined}><Icon name="star" />{detail.tags.includes('★') ? '已收藏' : '收藏'}</button>
                <button type="button" onClick={() => void copyPath(detail)}><Icon name="copy" />复制路径</button>
                <button type="button" className="mya-danger" onClick={() => doDelete([detail.id])}><Icon name="trash-2" />删除</button>
              </div>

              <div className="mya-sec">文件</div>
              <div className="mya-facts">
                <div className="mya-fact mya-fact-wide"><span>类型</span><b title={`${MEDIA_LABEL[detail.mediaType]} · ${detail.mimeType}`}>{MEDIA_LABEL[detail.mediaType]} · {detail.mimeType}</b></div>
                <div className="mya-fact"><span>大小</span><b className="mono">{formatBytes(detail.sizeBytes)}</b></div>
                {detail.width != null && <div className="mya-fact"><span>尺寸</span><b className="mono">{detail.width} × {detail.height}</b></div>}
                {detail.duration != null && <div className="mya-fact"><span>时长</span><b className="mono">{formatDur(detail.duration)}</b></div>}
                <div className="mya-fact"><span>最近使用</span><b className="mono">{detail.lastUsedAt ? new Date(detail.lastUsedAt).toLocaleDateString('zh-CN') : '—'}</b></div>
                <div className="mya-fact mya-fact-wide"><span>路径</span><b className="mono" title={detail.filePath}>{detail.filePath}</b></div>
              </div>

              <div className="mya-sec">标签</div>
              <div className="mya-tags">
                {detail.tags.filter((t) => t !== '★').map((t) => (
                  <span key={t} className="mya-tag">{t}
                    <button type="button" onClick={() => applyPatch(detail.id, { tags: detail.tags.filter((x) => x !== t) })} title="移除" aria-label={`移除标签 ${t}`}><Icon name="x" /></button>
                  </span>
                ))}
                <input className="mya-tag-input" value={tagText} placeholder="+ 标签"
                       onChange={(e) => setTagText(e.target.value)}
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && tagText.trim()) {
                           applyPatch(detail.id, { tags: [...new Set([...detail.tags, tagText.trim()])] })
                           setTagText('')
                         }
                       }} />
              </div>

              <div className="mya-sec">来源与授权</div>
              <div className="mya-param">
                <span className="mya-plabel">授权</span>
                <select className="mya-select" value={detail.licenseStatus} aria-label="授权状态"
                        onChange={(e) => applyPatch(detail.id, { licenseStatus: e.target.value as LicenseStatus })}>
                  {(Object.keys(LICENSE_LABEL) as LicenseStatus[]).map((k) => <option key={k} value={k}>{LICENSE_LABEL[k]}</option>)}
                </select>
              </div>
              <div className="mya-param">
                <span className="mya-plabel">审核</span>
                <select className="mya-select" value={detail.reviewStatus} aria-label="审核状态"
                        onChange={(e) => applyPatch(detail.id, { reviewStatus: e.target.value as ReviewStatus })}>
                  {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((k) => <option key={k} value={k}>{REVIEW_LABEL[k]}</option>)}
                </select>
              </div>
              {detail.licenseDetails && <p className="mya-detail-note">{detail.licenseDetails}</p>}
              <p className="mya-note">授权与审核相互独立：审核只改审核状态，不会替你推断授权。</p>

              <div className="mya-sec">引用</div>
              {detail.refs.length ? (
                <div className="mya-refs">
                  {detail.refs.map((r, i) => (
                    <div key={i} className="mya-ref">
                      <Icon name={r.kind === 'project' ? 'folder-open' : r.kind === 'workflow' ? 'workflow' : 'play'} />
                      <span>{r.label}</span>
                      <em>{r.kind === 'project' ? '项目' : r.kind === 'workflow' ? '工作流' : '任务'}</em>
                    </div>
                  ))}
                </div>
              ) : <p className="mya-dim">未被任何项目或工作流引用。</p>}
            </div>
          </aside>
        </div>
      )}

      {queue && (
        <div className="mya-queue">
          <div className="mya-queue-head">
            <span>导入队列</span>
            <span className="mya-queue-count">
              {queue.filter((r) => r.phase === 'done').length}/{queue.length} 完成
              {queue.some((r) => r.phase === 'error') && ` · ${queue.filter((r) => r.phase === 'error').length} 失败`}
            </span>
            <button type="button" className="mya-iconbtn" onClick={() => setQueue(null)} title="关闭" aria-label="关闭导入队列"><Icon name="x" /></button>
          </div>
          <div className="mya-queue-list">
            {queue.map((r, i) => (
              <div key={i} className="mya-queue-row" data-s={r.phase}>
                <span className="mya-queue-name" title={r.fileName}>{r.fileName}</span>
                <span className="mya-queue-st">
                  {r.phase === 'queued' && '排队中'}
                  {r.phase === 'reading' && '读取中…'}
                  {r.phase === 'done' && '已入库'}
                  {r.phase === 'error' && (r.error ?? '失败')}
                </span>
                {r.phase === 'error' && (
                  <button type="button" className="mya-queue-retry" onClick={() => { void runImport([r.file]) }}>重试</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {dragOver && (
        <div className="mya-drop">
          <div className="mya-drop-card">
            <Icon name="import" />
            <strong>松手导入到「我的素材」</strong>
            <span>支持图片 / 视频 / 音频 / 字体 / 文档</span>
          </div>
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

/** 类型化预览：图片/视频/音频真实播放，字体真字样，文档给打开入口 */
function Preview({ asset, poster }: { asset: MyAsset; poster?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (asset.mediaType === 'video' || asset.mediaType === 'audio' || asset.sourceType === 'imported') {
      void getFileURL(asset.id).then((u) => { if (alive) setUrl(u) })
    }
    return () => { alive = false }
  }, [asset])
  if (asset.mediaType === 'image') {
    const src = asset.sourceType === 'imported' ? url : asset.filePath
    return src ? <img src={src} alt={asset.name} /> : <span className="mya-preview-ph"><Icon name="image" /></span>
  }
  if (asset.mediaType === 'video') {
    return url ? <video src={url} controls muted playsInline preload="metadata" poster={poster} />
               : <span className="mya-preview-ph"><Icon name="film" /></span>
  }
  if (asset.mediaType === 'audio') {
    return (
      <div className="mya-audio">
        <Icon name="audio-lines" />
        {url ? <audio src={url} controls preload="metadata" /> : <span className="mya-dim">读取中…</span>}
      </div>
    )
  }
  if (asset.mediaType === 'font') {
    return <FontPreview asset={asset} />
  }
  return (
    <div className="mya-doc">
      <Icon name="file-text" />
      <p>{asset.name}</p>
      <a href={url ?? asset.filePath} target="_blank" rel="noreferrer">打开文件</a>
    </div>
  )
}

function FontPreview({ asset }: { asset: MyAsset }) {
  const [family, setFamily] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const src = asset.sourceType === 'imported' ? await getFileURL(asset.id) : asset.filePath
        if (!src) throw new Error('no url')
        const fam = `mya-${asset.id}`
        const face = new FontFace(fam, `url(${src})`)
        await face.load()
        document.fonts.add(face)
        if (alive) setFamily(fam)
      } catch { if (alive) setFailed(true) }
    })()
    return () => { alive = false }
  }, [asset])
  if (failed || !family) return <span className="mya-preview-ph"><Icon name="pilcrow" /></span>
  return (
    <div className="mya-font" style={{ fontFamily: family }}>
      <div className="mya-font-big">风动影随 Aa 0123</div>
      <div className="mya-font-sm">The quick brown fox jumps over the lazy dog. 字幕字幕字幕</div>
    </div>
  )
}

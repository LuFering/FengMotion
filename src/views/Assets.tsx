import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LICENSE_LABEL, MEDIA_ICON, MEDIA_LABEL, REVIEW_LABEL, SOURCE_LABEL,
  type LicenseStatus, type MediaType, type MyAsset, type ReviewStatus,
} from '@/data/myAssets'
import {
  captureBuiltinPoster, formatBytes, formatDur, getFileURL, getThumbURL,
  importFiles, initLibrary, listAssets, listFolders, removeAssets, saveFolders,
  updateAsset, type FolderRow,
} from '@/services/assetService'
import { isAssetDrag, setAssetDragData, usePendingAssets } from '@/shell/usePendingAssets'
import { toast as emitToast } from '@/shell/toast'
import { clearDragGhost, setDragGhost } from '@/shell/dragGhost'
import { EmptyState } from '@/components/fm/EmptyState'
import { ErrorState } from '@/components/fm/ErrorState'
import { LoadingState } from '@/components/fm/LoadingState'
import { SilentVideoPreview } from '@/components/SilentVideoPreview'
import { PageHeader } from '@/components/PageHeader'
import { SearchField } from '@/components/SearchField'

/**
 * 我的素材 —— 原生多媒体素材管理器（G 深度优化版落地）。
 *
 * 职责：管理**真实文件**的索引与元数据 —— 用户导入的文件、工作流输入与生成结果；
 * 不负责镜头分析（参考片库），不负责技法定义（特效库）。
 *
 * 布局（与应用外壳图标栏共存，不再自带第二套导航语义）：
 *   页头岛（标题/搜索/视图/导入）通栏；其下三列 —— 左 = 组织岛（库 / 来源 /
 *   项目 / 智能文件夹 / 文件夹 / 标签，216px 岛屿面板，可收起），中 = 工具条（当前
 *   范围 + 类型/排序浮层，渐进披露）+ 素材画布 + 状态栏，右 = 检查器岛
 *   （选中才出现，含引用关系与内联审核，真实写回索引）。
 *
 * 数据真实性：
 *   · 内置种子 = 仓库真实文件（实测元数据）；导入 = 真实读取（尺寸/时长/缩略图），
 *     本体存 IndexedDB，刷新/重启仍在；「落盘到系统目录」未接入（不承诺）。
 *   · 授权（licenseStatus）与审核（reviewStatus）分离；未确认授权一律 unknown。
 *   · 引用（refs）只写数据里真实存在的关联；无生成溯源字段，不展示不编造。
 *   · 删除前检查引用；被项目引用的素材给出警告。批量操作全部真实生效。
 *
 * 视觉：A2 云端岛屿 V3。全部颜色/圆角/阴影/动效来自 myassets.css 的 V3 token；
 * 本文件不写任何色值（标签色点除外：数据色点，取自文件内固定调色板）。
 */

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

type NodeId = 'all' | 'favorites' | 'recent' | 'project' | 'imported' | 'generated' | 'builtin'
  | 'review:pending' | 'review:needs_review' | 'license:unknown' | 'license:restricted'
  | 'refs:none' | `type:${MediaType}` | `folder:${string}` | `tag:${string}` | `proj:${string}`
type SortKey = 'recent' | 'used' | 'name' | 'size' | 'duration'
type TreeEntry = { id: NodeId; label: string; icon: string; count: number }

const SORT_LABEL: Record<SortKey, string> = {
  recent: '最近导入', used: '最近使用', name: '名称', size: '大小', duration: '时长',
}

const TYPE_IDS: MediaType[] = ['image', 'video', 'audio', 'font', 'doc']

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

/**
 * 网格里只显示「需要有人处理」的异常状态。
 * 待审核是生成结果的默认状态，不逐格重复；它在组织栏、列表审核列、检查器和状态栏里可见。
 */
function assetFlag(a: MyAsset): { label: string; tone: 'warn' | 'bad' } | null {
  if (a.licenseStatus === 'restricted') return { label: LICENSE_LABEL.restricted, tone: 'bad' }
  if (a.licenseStatus === 'unknown') return { label: LICENSE_LABEL.unknown, tone: 'warn' }
  if (a.reviewStatus === 'needs_review') return { label: REVIEW_LABEL.needs_review, tone: 'warn' }
  if (a.licenseStatus === 'attribution_required') return { label: LICENSE_LABEL.attribution_required, tone: 'warn' }
  return null
}

/** 卡片第二行：媒体属性优先（时长 / 尺寸），来源留给列表和检查器 */
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


export function Assets({ projectName }: { projectName?: string } = {}) {
  const [assets, setAssets] = useState<MyAsset[]>([])
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
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
  const runImport = useCallback(async (files: File[]) => {
    if (!files.length) return
    const failed: string[] = []
    const ok = await importFiles(files, (e) => {
      if (e.phase === 'error') failed.push(e.fileName)
    })
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
      <PageHeader
        title="我的素材"
        meta={projectName ? <span className="mya-heading-project">{projectName}</span> : undefined}
        actions={
          <>
            {!pickMode && (
              <button type="button" className="mya-pickbtn" onClick={enterPick}>
                <Icon name="square-check" />选择素材
              </button>
            )}
            <button type="button" className="mya-primary" onClick={() => inputRef.current?.click()}>
              <Icon name="import" />导入素材
            </button>
          </>
        }
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
              <span>· 本地索引 {counts.all} 项</span>
            </div>
          </aside>
        )}

        <div className="mya-main">
          <div className="mya-toolbar">
            {/* 选择模式下不显示这条旧批量栏：底部已经有确认条了，
                两套"已选 N 项"同屏出现会让人不知道该看哪个。 */}
            {pickMode ? (
              <div className="mya-toolbar-pick">
                <Icon name="square-check" />
                <b>选择素材</b>
                <span>点卡片选中，选完点底部「确认加入待发送」</span>
              </div>
            ) : selected.size > 0 ? (
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
            ) : (
              <>
                {!orgOpen && (
                  <button type="button" className="mya-toolbtn" onClick={() => setOrgOpen(true)}
                          title="展开组织栏" aria-label="展开组织栏">
                    <Icon name="panel-left-open" />组织
                  </button>
                )}
                <div className="mya-content-search">
                  <SearchField
                    value={search}
                    onChange={setSearch}
                    placeholder="搜索名称、标签、来源"
                    ariaLabel="搜索素材"
                    onClear={() => setSearch('')}
                  />
                </div>
                <span className="mya-crumb" hidden={node === 'all' && typeFilter === 'all'}>
                  <b>{node === 'all' ? '全部素材' : activeLabel}</b>
                  {typeFilter !== 'all' && <>{' / '}<b>{MEDIA_LABEL[typeFilter]}</b></>}
                </span>
                <span className="mya-spacer" />
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
                {(node !== 'all' || search || typeFilter !== 'all') && (
                  <button type="button" className="mya-clearbtn mya-clearbtn-sm" onClick={clearFilter}>清除筛选</button>
                )}
                <div className="mya-tool-wrap">
                  <button type="button" className="mya-toolbtn" data-on={typeFilter !== 'all' || undefined}
                          aria-haspopup="listbox" aria-expanded={pop === 'type'}
                          onClick={() => setPop(pop === 'type' ? null : 'type')}>
                    <Icon name="layers" />类型
                    {typeFilter !== 'all' && <em>{MEDIA_LABEL[typeFilter]}</em>}
                    <Icon name="chevron-down" />
                  </button>
                  {pop === 'type' && (
                    <div className="mya-pop" role="listbox" aria-label="按类型筛选">
                      <button type="button" className="mya-poprow" data-on={typeFilter === 'all' || undefined}
                              onClick={() => { setTypeFilter('all'); setPop(null) }}>
                        <span>全部类型</span><span className="mya-pop-n mono">{assets.length}</span>
                        {typeFilter === 'all' && <Icon name="check" />}
                      </button>
                      {TYPE_IDS.map((t) => (
                        <button key={t} type="button" className="mya-poprow" data-on={typeFilter === t || undefined}
                                onClick={() => { setTypeFilter(t); setPop(null) }}>
                          <Icon name={MEDIA_ICON[t]} />
                          <span>{MEDIA_LABEL[t]}</span><span className="mya-pop-n mono">{counts.type(t)}</span>
                          {typeFilter === t && <Icon name="check" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mya-tool-wrap">
                  <button type="button" className="mya-toolbtn"
                          aria-haspopup="listbox" aria-expanded={pop === 'sort'}
                          onClick={() => setPop(pop === 'sort' ? null : 'sort')}>
                    <Icon name="list-ordered" />排序<em>{SORT_LABEL[sortKey]}</em>
                    <Icon name="chevron-down" />
                  </button>
                  {pop === 'sort' && (
                    <div className="mya-pop" role="listbox" aria-label="排序方式">
                      {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                        <button key={k} type="button" className="mya-poprow" data-on={sortKey === k || undefined}
                                onClick={() => { setSortKey(k); setPop(null) }}>
                          <span>{SORT_LABEL[k]}</span>
                          {sortKey === k && <Icon name="check" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {pop && <div className="mya-popshade" onClick={() => setPop(null)} />}

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
                <div className="mya-grid" key={`${node}|${typeFilter}|${sortKey}`} onKeyDown={onGridKeys}>
                  {visible.map((a) => {
                    const flag = assetFlag(a)
                    return (
                      <div key={a.id} className="mya-card"
                           onMouseEnter={() => { if (a.mediaType === 'video') setHoveredVideo(a.id) }}
                           onMouseLeave={() => setHoveredVideo((id) => id === a.id ? null : id)}
                           onFocus={() => { if (a.mediaType === 'video') setHoveredVideo(a.id) }}
                           onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredVideo((id) => id === a.id ? null : id) }}
                           data-on={detailId === a.id || undefined}
                           data-picked={selected.has(a.id) || undefined}
                           data-pending={pending.has(a.id) || undefined}
                           role="option" aria-selected={detailId === a.id} tabIndex={0}
                           title={fullMeta(a)}
                           draggable
                           onDragStart={(e) => {
                             /* 多选时拖一个等于拖全部 —— 用户选了 4 个再拖，
                                预期是把这 4 个一起放进待发送。 */
                             const ids = selected.has(a.id) && selected.size > 1 ? [...selected] : [a.id]
                             setAssetDragData(e.dataTransfer, ids)
                             /* 拖影缩成一小块：默认拖影是整张卡片快照，
                                举在鼠标边会盖住落点，看不清要放到哪。 */
                             const ghostEl = setDragGhost({
                               thumb: thumbs[a.id], label: a.name, count: ids.length,
                             })
                             e.dataTransfer.setDragImage(ghostEl, 28, 28)
                           }}
                           onDragEnd={clearDragGhost}
                           data-pickmode={pickMode || undefined}
                           onClick={() => (pickMode ? toggleSelect(a.id) : openDetail(a))}
                           onKeyDown={(e) => {
                             if (e.target !== e.currentTarget) return
                             if (e.key === 'Enter' || e.key === ' ') {
                               e.preventDefault()
                               if (pickMode) toggleSelect(a.id); else openDetail(a)
                             }
                           }}>
                        <div className="mya-thumb">
                          {a.mediaType === 'video'
                            ? <AssetVideoThumb assetId={a.id} poster={thumbs[a.id]} active={hoveredVideo === a.id && !pickMode && !detailId} />
                            : thumbs[a.id]
                              ? <img src={thumbs[a.id]} alt="" loading="lazy" draggable={false} />
                              : <span className="mya-thumb-ph"><Icon name={MEDIA_ICON[a.mediaType]} /></span>}
                          <label className="mya-check" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)}
                                   aria-label={`选择 ${a.name}`} />
                          </label>
                          <button type="button" className="mya-star" data-on={a.tags.includes('★') || undefined}
                                  aria-label={a.tags.includes('★') ? `取消收藏 ${a.name}` : `收藏 ${a.name}`}
                                  onClick={(e) => { e.stopPropagation(); toggleFav(a) }}>
                            <Icon name="star" />
                          </button>
                          {/* 加入待发送：拖拽之外的常驻入口 —— 拖拽不能是唯一方式。
                              已加入的显示勾，点了不重复加（store 按 ID 去重）。 */}
                          <button type="button" className="mya-pending-btn"
                                  data-added={pending.has(a.id) || undefined}
                                  aria-label={pending.has(a.id) ? `${a.name} 已在待发送` : `把 ${a.name} 加入待发送`}
                                  title={pending.has(a.id) ? '已在待发送' : '加入待发送'}
                                  onClick={(e) => { e.stopPropagation(); addToPending([a.id]) }}>
                            {pending.has(a.id) ? <Icon name="square-check" /> : <Icon name="plus" />}
                          </button>
                        </div>
                        <div className="mya-card-head">
                          <span className="mya-media-kind"><Icon name={MEDIA_ICON[a.mediaType]} />{MEDIA_LABEL[a.mediaType]}</span>
                          {a.mediaType === 'video' && a.duration != null && <span className="mya-media-duration num">{formatDur(a.duration)}</span>}
                        </div>
                        <div className="mya-card-body">
                          <div className="mya-card-title-row">
                            <div className="mya-card-name">{a.name}</div>
                            {flag && <span className="mya-card-warning" data-tone={flag.tone} title={flag.label} aria-label={flag.label}><Icon name="info" /></span>}
                          </div>
                          <div className="mya-card-meta">
                            <span className="mya-card-spec">{a.mediaType === 'video'
                              ? [a.width != null ? `${a.width} × ${a.height}` : null, formatBytes(a.sizeBytes)].filter(Boolean).join(' · ')
                              : cardSpec(a)}</span>
                            {a.refs.length > 0 && <span className="mya-refs-badge" title={`${a.refs.length} 处引用`}><Icon name="link" />{a.refs.length}</span>}
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
                    <span className="mya-col-refs">引用</span>
                    <span className="mya-col-lic">授权</span>
                    <span className="mya-col-rev">审核</span>
                  </div>
                  {visible.map((a) => (
                    <div key={a.id} className="mya-row"
                         data-on={detailId === a.id || undefined}
                         data-picked={selected.has(a.id) || undefined}
                         data-pending={pending.has(a.id) || undefined}
                         role="option" aria-selected={detailId === a.id} tabIndex={0}
                         draggable
                         onDragStart={(e) => {
                           const ids = selected.has(a.id) && selected.size > 1 ? [...selected] : [a.id]
                           setAssetDragData(e.dataTransfer, ids)
                           const ghostEl = setDragGhost({
                             thumb: thumbs[a.id], label: a.name, count: ids.length,
                           })
                           e.dataTransfer.setDragImage(ghostEl, 28, 28)
                         }}
                         onDragEnd={clearDragGhost}
                         data-pickmode={pickMode || undefined}
                         onClick={() => (pickMode ? toggleSelect(a.id) : openDetail(a))}
                         onKeyDown={(e) => {
                           if (e.target !== e.currentTarget) return
                           if (e.key === 'Enter' || e.key === ' ') {
                             e.preventDefault()
                             if (pickMode) toggleSelect(a.id); else openDetail(a)
                           }
                         }}>
                      <span className="mya-col-check" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)}
                               aria-label={`选择 ${a.name}`} />
                      </span>
                      <span className="mya-col-name">
                        <span className="mya-row-thumb">
                          {thumbs[a.id] ? <img src={thumbs[a.id]} alt="" loading="lazy" draggable={false} />
                                        : <Icon name={MEDIA_ICON[a.mediaType]} />}
                        </span>
                        <span className="mya-row-name" title={a.name}>{a.name}</span>
                        {a.tags.includes('★') && <Icon name="star" className="mya-row-star" />}
                      </span>
                      <span className="mya-col-type">{MEDIA_LABEL[a.mediaType]}</span>
                      <span className="mya-col-dim mono">{listSpec(a)}</span>
                      <span className="mya-col-size mono">{formatBytes(a.sizeBytes)}</span>
                      <span className="mya-col-src">{SOURCE_LABEL[a.sourceType]}</span>
                      <span className="mya-col-refs mono">{a.refs.length > 0 ? a.refs.length : '—'}</span>
                      <span className="mya-col-lic"><span className="mya-status-pill" data-s={a.licenseStatus}>{LICENSE_LABEL[a.licenseStatus]}</span></span>
                      <span className="mya-col-rev"><span className="mya-status-pill" data-s={a.reviewStatus}>{REVIEW_LABEL[a.reviewStatus]}</span></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>

        </div>

        {detail && (
          <aside className="mya-inspector" aria-label="素材详情">
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

              {detail.reviewStatus !== 'approved' && (
                <div className="mya-review-acts">
                  <button type="button" className="mya-review-pass"
                          onClick={() => applyPatch(detail.id, { reviewStatus: 'approved' })}>
                    <Icon name="circle-check" />通过审核
                  </button>
                  <button type="button"
                          onClick={() => applyPatch(detail.id, { reviewStatus: 'needs_review' })}>
                    <Icon name="undo-2" />退回复核
                  </button>
                </div>
              )}

              {/* 「如何使用」排在管理动作之前：用户打开详情多半是为了决定
                  这个素材要不要用于这次任务，重命名/删除是次要动作。 */}
              <div className="mya-actrow mya-actrow-use">
                <button type="button" className="mya-use-btn" data-added={pending.has(detail.id) || undefined}
                        onClick={() => addToPending([detail.id])}>
                  <Icon name={pending.has(detail.id) ? 'square-check' : 'plus'} />
                  {pending.has(detail.id) ? '已在待发送' : '加入待发送'}
                </button>
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

              <div className="mya-sec">引用关系</div>
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

/** 类型化预览：图片/视频/音频真实播放，字体真字样，文档给打开入口 */
function AssetVideoThumb({ assetId, poster, active }: { assetId: string; poster?: string; active: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    void getFileURL(assetId).then((src) => { if (alive) setUrl(src) }).catch(() => { /* 静帧保留。 */ })
    return () => { alive = false }
  }, [assetId, active])
  return <SilentVideoPreview key={assetId} src={url} poster={poster} active={active} label="素材静音预览" />
}

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

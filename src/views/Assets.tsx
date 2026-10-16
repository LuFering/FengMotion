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

/**
 * 我的素材 —— 原生多媒体素材管理器（不再用 iframe 复刻页）。
 *
 * 职责：管理**真实文件**的索引与元数据 —— 用户导入的文件、工作流输入与生成结果；
 * 不负责镜头分析（参考片库），不负责技法定义（特效库）。
 *
 * 数据真实性：
 *   · 内置种子 = 仓库真实文件（实测元数据）；导入 = 真实读取（尺寸/时长/缩略图），
 *     本体存 IndexedDB，刷新/重启仍在；「落盘到系统目录」未接入（不承诺）。
 *   · 授权（licenseStatus）与审核（reviewStatus）分离；未确认授权一律 unknown。
 *   · 删除前检查引用；被项目引用的素材给出警告。批量操作全部真实生效。
 */

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`/assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

type NodeId = 'all' | 'favorites' | 'recent' | 'project' | 'imported' | 'generated' | 'builtin' | `type:${MediaType}` | `folder:${string}`
type SortKey = 'recent' | 'used' | 'name' | 'size' | 'duration'

const SORT_LABEL: Record<SortKey, string> = {
  recent: '最近导入', used: '最近使用', name: '名称', size: '大小', duration: '时长',
}

interface QueueRow extends ImportEvent { file: File }

export function Assets({ projectName }: { projectName?: string } = {}) {
  const [assets, setAssets] = useState<MyAsset[]>([])
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [loading, setLoading] = useState(true)
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
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  // ── 加载 ──
  useEffect(() => {
    let alive = true
    ;(async () => {
      await initLibrary()
      const [list, fl] = await Promise.all([listAssets(), listFolders()])
      if (!alive) return
      setAssets(list.sort((a, b) => b.createdAt - a.createdAt))
      setFolders(fl)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

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

  // ── 渲染 ──
  const TREE: { id: NodeId; label: string; icon: string; count: number }[] = [
    { id: 'all', label: '全部素材', icon: 'layout-grid', count: counts.all },
    ...(projectName ? [{ id: 'project' as NodeId, label: '本项目素材', icon: 'folder-open', count: counts.project }] : []),
    { id: 'favorites', label: '收藏', icon: 'star', count: counts.favorites },
    { id: 'recent', label: '最近使用', icon: 'history', count: counts.recent },
    { id: 'imported', label: '导入素材', icon: 'download', count: counts.imported },
    { id: 'generated', label: '生成结果', icon: 'sparkles', count: counts.generated },
    { id: 'builtin', label: '内置素材', icon: 'box', count: counts.builtin },
  ]
  const TYPE_IDS: MediaType[] = ['image', 'video', 'audio', 'font', 'doc']

  return (
    <div className="mya">
      <header className="mya-head">
        <div className="mya-head-copy">
          <span className="mya-eyebrow">FENGMOTION / MEDIA</span>
          <h2>我的素材</h2>
          <p>管理导入素材、生成结果和创作文件 —— 文件本体存本地索引，刷新后仍在</p>
        </div>
        <div className="mya-head-acts">
          <label className="mya-search">
            <Icon name="search" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="搜索文件名、标签、来源…" />
            {search && <button type="button" className="mya-search-x" onClick={() => setSearch('')} title="清除搜索"><Icon name="x" /></button>}
          </label>
          <button type="button" className="mya-import" onClick={() => inputRef.current?.click()}>
            <Icon name="import" /> 导入素材
          </button>
          <input ref={inputRef} type="file" multiple hidden onChange={onPick} />
        </div>
      </header>

      <div className="mya-body">
        <aside className="mya-tree">
          <div className="mya-tree-group">
            {TREE.map((t) => (
              <button key={t.id} type="button" className="mya-node" data-on={node === t.id || undefined}
                      onClick={() => setNode(t.id)}>
                <Icon name={t.icon} /><span className="mya-node-label">{t.label}</span>
                <span className="mya-node-count">{t.count}</span>
              </button>
            ))}
          </div>
          <div className="mya-tree-group">
            <div className="mya-tree-title">类型</div>
            {TYPE_IDS.map((t) => (
              <button key={t} type="button" className="mya-node" data-on={node === `type:${t}` || undefined}
                      onClick={() => setNode(`type:${t}`)}>
                <Icon name={MEDIA_ICON[t]} /><span className="mya-node-label">{MEDIA_LABEL[t]}</span>
                <span className="mya-node-count">{counts.type(t)}</span>
              </button>
            ))}
          </div>
          <div className="mya-tree-group">
            <div className="mya-tree-title">文件夹 <button type="button" className="mya-folder-add" onClick={addFolder} title="新建文件夹"><Icon name="folder-plus" /></button></div>
            {folders.map((f) => (
              <button key={f.id} type="button" className="mya-node" data-on={node === `folder:${f.id}` || undefined}
                      onClick={() => setNode(`folder:${f.id}`)}>
                <Icon name="folder-open" /><span className="mya-node-label">{f.name}</span>
                <span className="mya-node-count">{counts.folder(f.id)}</span>
              </button>
            ))}
            {folders.length === 0 && <p className="mya-tree-empty">还没有文件夹</p>}
          </div>
        </aside>

        <main className="mya-center">
          <div className="mya-toolbar">
            <label className="mya-sort">
              排序
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
              </select>
            </label>
            <span className="mya-count">{visible.length} 项</span>
            <span className="mya-spacer" />
            <button type="button" className="mya-tool" data-on={viewMode === 'grid' || undefined} onClick={() => setViewMode('grid')} title="网格视图"><Icon name="layout-grid" /></button>
            <button type="button" className="mya-tool" data-on={viewMode === 'list' || undefined} onClick={() => setViewMode('list')} title="列表视图"><Icon name="list" /></button>
          </div>

          {selected.size > 0 && (
            <div className="mya-batch">
              <span className="mya-batch-n">{selected.size} 项已选</span>
              <button type="button" onClick={() => setSelected(new Set(visible.map((a) => a.id)))}>全选当前</button>
              <button type="button" onClick={() => setSelected(new Set())}>清除选择</button>
              <span className="mya-batch-sep" />
              <button type="button" onClick={() => { for (const a of assets) if (selected.has(a.id) && !a.tags.includes('★')) toggleFav(a) }}>收藏</button>
              <button type="button" onClick={() => { const t = window.prompt('给选中素材添加标签'); if (t?.trim()) { for (const a of assets) if (selected.has(a.id)) applyPatch(a.id, { tags: [...new Set([...a.tags, t.trim()])] }) } }}>加标签</button>
              <button type="button" onClick={() => { const f = window.prompt('移动到文件夹（输入名称，留空=移出）'); if (f === null) return; const target = f.trim() ? folders.find((x) => x.name === f.trim()) ?? null : null; if (f.trim() && !target) { window.alert('没有这个文件夹，先在左侧新建'); return } moveToFolder([...selected], target?.id ?? null) }}>移动</button>
              <button type="button" onClick={() => exportList([...selected])}>导出清单</button>
              <button type="button" className="mya-danger" onClick={() => doDelete([...selected])}>删除</button>
            </div>
          )}

          {loading ? (
            <div className="mya-state"><span className="mya-spin" /> 正在读取本地素材索引…</div>
          ) : visible.length === 0 ? (
            <div className="mya-state mya-empty">
              <Icon name="image" className="mya-empty-icon" />
              {assets.length === 0 ? (
                <>
                  <h3>素材库还是空的</h3>
                  <p>把图片、视频、音频、字体拖进来，或点右上角「导入素材」。<br />文件本体保存在本地索引，刷新后仍在。</p>
                  <button type="button" className="mya-import" onClick={() => inputRef.current?.click()}><Icon name="import" /> 导入素材</button>
                </>
              ) : (
                <>
                  <h3>没有符合当前筛选的素材</h3>
                  <p>换个分类，或清除搜索条件。</p>
                  <button type="button" className="mya-tool" onClick={() => { setNode('all'); setSearch('') }}>清除筛选</button>
                </>
              )}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="mya-grid">
              {visible.map((a) => (
                <div key={a.id} className="mya-card" data-on={detailId === a.id || undefined}
                     onClick={() => openDetail(a)}>
                  <div className="mya-thumb">
                    {thumbs[a.id]
                      ? <img src={thumbs[a.id]} alt="" loading="lazy" />
                      : <span className="mya-thumb-ph"><Icon name={MEDIA_ICON[a.mediaType]} /></span>}
                    <span className="mya-badge">{MEDIA_LABEL[a.mediaType]}{a.duration != null ? ` · ${formatDur(a.duration)}` : ''}</span>
                    <label className="mya-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} />
                    </label>
                    <button type="button" className="mya-star" data-on={a.tags.includes('★') || undefined}
                            onClick={(e) => { e.stopPropagation(); toggleFav(a) }} title="收藏">
                      <Icon name="star" />
                    </button>
                  </div>
                  <div className="mya-card-body">
                    <div className="mya-card-name" title={a.name}>{a.name}</div>
                    <div className="mya-card-meta">
                      <span>{SOURCE_LABEL[a.sourceType]}</span>
                      <span>·</span>
                      <span>{formatBytes(a.sizeBytes)}</span>
                      {a.width != null && <><span>·</span><span>{a.width}×{a.height}</span></>}
                    </div>
                    <div className="mya-card-foot">
                      <span className="mya-lic" data-s={a.licenseStatus}>{LICENSE_LABEL[a.licenseStatus]}</span>
                      <span className="mya-rev" data-s={a.reviewStatus}>{REVIEW_LABEL[a.reviewStatus]}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mya-list">
              <div className="mya-list-head">
                <span className="mya-col-check" />
                <span className="mya-col-name">名称</span>
                <span className="mya-col-type">类型</span>
                <span className="mya-col-size">大小</span>
                <span className="mya-col-dim">尺寸 / 时长</span>
                <span className="mya-col-src">来源</span>
                <span className="mya-col-lic">授权</span>
              </div>
              {visible.map((a) => (
                <div key={a.id} className="mya-row" data-on={detailId === a.id || undefined} onClick={() => openDetail(a)}>
                  <span className="mya-col-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} />
                  </span>
                  <span className="mya-col-name">
                    <span className="mya-row-ic"><Icon name={MEDIA_ICON[a.mediaType]} /></span>
                    <span className="mya-row-name" title={a.name}>{a.name}</span>
                    {a.tags.includes('★') && <Icon name="star" className="mya-row-star" />}
                  </span>
                  <span className="mya-col-type">{MEDIA_LABEL[a.mediaType]}</span>
                  <span className="mya-col-size num">{formatBytes(a.sizeBytes)}</span>
                  <span className="mya-col-dim num">{a.mediaType === 'video' || a.mediaType === 'audio' ? formatDur(a.duration) : a.width != null ? `${a.width}×${a.height}` : '—'}</span>
                  <span className="mya-col-src">{SOURCE_LABEL[a.sourceType]}</span>
                  <span className="mya-col-lic"><span className="mya-lic" data-s={a.licenseStatus}>{LICENSE_LABEL[a.licenseStatus]}</span></span>
                </div>
              ))}
            </div>
          )}
        </main>

        {detail && (
          <aside className="mya-drawer">
            <div className="mya-drawer-head">
              <span className="mya-drawer-title" title={detail.name}>{detail.name}</span>
              <button type="button" className="mya-tool" onClick={() => setDetailId(null)} title="关闭"><Icon name="x" /></button>
            </div>
            <div className="mya-preview">
              <Preview asset={detail} poster={thumbs[detail.id]} />
            </div>
            <div className="mya-drawer-acts">
              <button type="button" onClick={() => { setRenaming(detail); setRenameText(detail.name) }}><Icon name="pencil" /> 重命名</button>
              <button type="button" onClick={() => toggleFav(detail)} data-on={detail.tags.includes('★') || undefined}><Icon name="star" /> {detail.tags.includes('★') ? '已收藏' : '收藏'}</button>
              <button type="button" onClick={() => void copyPath(detail)}><Icon name="copy" /> 复制路径</button>
              <button type="button" className="mya-danger" onClick={() => doDelete([detail.id])}><Icon name="trash-2" /> 删除</button>
            </div>

            <section className="mya-sec">
              <h4>文件信息</h4>
              <dl className="mya-kv">
                <dt>类型</dt><dd>{MEDIA_LABEL[detail.mediaType]} · {detail.mimeType}</dd>
                <dt>大小</dt><dd className="num">{formatBytes(detail.sizeBytes)}</dd>
                {detail.width != null && <><dt>尺寸</dt><dd className="num">{detail.width} × {detail.height}</dd></>}
                {detail.duration != null && <><dt>时长</dt><dd className="num">{formatDur(detail.duration)}</dd></>}
                <dt>路径</dt><dd className="mya-mono">{detail.filePath}</dd>
                <dt>导入时间</dt><dd className="num">{new Date(detail.createdAt).toLocaleString('zh-CN', { hour12: false })}</dd>
                <dt>最近使用</dt><dd className="num">{detail.lastUsedAt ? new Date(detail.lastUsedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</dd>
              </dl>
            </section>

            <section className="mya-sec">
              <h4>标签</h4>
              <div className="mya-tags">
                {detail.tags.filter((t) => t !== '★').map((t) => (
                  <span key={t} className="mya-tag">{t}
                    <button type="button" onClick={() => applyPatch(detail.id, { tags: detail.tags.filter((x) => x !== t) })} title="移除"><Icon name="x" /></button>
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
            </section>

            <section className="mya-sec">
              <h4>来源与授权</h4>
              <dl className="mya-kv">
                <dt>来源</dt><dd>{SOURCE_LABEL[detail.sourceType]}{detail.sourceType === 'imported' ? '（本次导入）' : ''}</dd>
                <dt>授权</dt><dd>
                  <select className="mya-select" value={detail.licenseStatus}
                          onChange={(e) => applyPatch(detail.id, { licenseStatus: e.target.value as LicenseStatus })}>
                    {(Object.keys(LICENSE_LABEL) as LicenseStatus[]).map((k) => <option key={k} value={k}>{LICENSE_LABEL[k]}</option>)}
                  </select>
                </dd>
                <dt>审核</dt><dd>
                  <select className="mya-select" value={detail.reviewStatus}
                          onChange={(e) => applyPatch(detail.id, { reviewStatus: e.target.value as ReviewStatus })}>
                    {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((k) => <option key={k} value={k}>{REVIEW_LABEL[k]}</option>)}
                  </select>
                </dd>
                {detail.licenseDetails && <><dt>备注</dt><dd className="mya-dim">{detail.licenseDetails}</dd></>}
              </dl>
              <p className="mya-note">授权与审核相互独立：审核只改审核状态，不会替你推断授权。</p>
            </section>

            <section className="mya-sec">
              <h4>引用</h4>
              {detail.refs.length ? (
                <ul className="mya-refs">
                  {detail.refs.map((r, i) => (
                    <li key={i}><Icon name={r.kind === 'project' ? 'folder-open' : r.kind === 'workflow' ? 'workflow' : 'play'} /> {r.label}<span className="mya-dim">（{r.kind === 'project' ? '项目' : r.kind === 'workflow' ? '工作流' : '任务'}）</span></li>
                  ))}
                </ul>
              ) : <p className="mya-dim">未被任何项目或工作流引用。</p>}
            </section>
          </aside>
        )}
      </div>

      {queue && (
        <div className="mya-queue">
          <div className="mya-queue-head">
            <span>导入队列</span>
            <span className="mya-dim">
              {queue.filter((r) => r.phase === 'done').length}/{queue.length} 完成
              {queue.some((r) => r.phase === 'error') && ` · ${queue.filter((r) => r.phase === 'error').length} 失败`}
            </span>
            <button type="button" className="mya-tool" onClick={() => setQueue(null)} title="关闭"><Icon name="x" /></button>
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
              <button type="button" className="mya-import" onClick={doRename}>确定</button>
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

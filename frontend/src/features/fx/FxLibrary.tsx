import { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Clock, Star01 } from '@untitledui/icons'
import { type FxCategory, type FxExecType, type FxImpl, type FxInputKind, type FxTechnique } from '@/features/fx/model/fxTechniques'
import {
  importLegacyFavorites, listTechniques, loadUserState, markViewed, searchTechniqueIds, setFavorite,
} from '@/features/fx/services/fxApiService'
import { PROJECTS, STAGE_LABEL } from '@/features/project/model/projects'
import { usePendingAssets, type PendingFxCard } from '@/features/assets/hooks/usePendingAssets'
import { usePickMode } from '@/shared/pick-mode/usePickMode'
import { PickBar, PickButton } from '@/shared/pick-mode/PickModeUI'
import { toast as emitToast } from '@/shared/lib/toast'
import { Dialog } from '@/shared/ui/dialog'
import { CapabilityImportDialog } from '@/features/fx/components/CapabilityImportDialog'
import { FxDetailDialog } from '@/features/fx/components/FxDetailDialog'
import { FxContent } from '@/features/fx/components/FxContent'
import { FxMetaBar } from '@/features/fx/components/FxMetaBar'

/** 拖拽时按特效 ID 暂存参数包（DataTransfer 只能传字符串） */
const FX_STASH_KEY = 'fm-fx-card-stash-v1'
const LIB_KEY = 'fm-fx-library-v1'
const OUTBOX_KEY = 'fm-fx-usage-outbox-v1'

export type SortKey = 'cat' | 'name' | 'complexity' | 'updated'
export type Scope = 'all' | 'featured' | 'favorites' | 'recent'

export interface FxLibState {
  favorites: string[]
  recent: string[]
}

/** 服务端技法目录。加载前为空数组，界面据此显示「正在读取」而不是「技法库是空的」。 */
const EMPTY_TECHNIQUES: FxTechnique[] = []

function loadLibState(): FxLibState {
  try {
    const raw = localStorage.getItem(LIB_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FxLibState>
      return {
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      }
    }
  } catch {
    /* 存档不可用时以空状态起步 */
  }
  return { favorites: [], recent: [] }
}

/** 搜索范围：技法名 / 英文名 / 别名 / 关键词 / 意图 / 场景 / 分类 / 能力标签 */
function searchBlob(t: FxTechnique) {
  return [
    t.name,
    t.nameEn,
    ...t.aliases,
    ...t.keywords,
    t.intent,
    ...t.scenes,
    ...t.antiScenes,
    t.categoryLabel,
    t.execLabel,
    t.implLabel,
    ...t.inputLabels,
  ]
    .join(' ')
    .toLowerCase()
}

/** 复制配方：纯文本，含参数 + 制作步骤 + 调用配置（输入/输出），页首写明语义 */
function copyText(t: FxTechnique) {
  const params = t.params.map((p) => `- ${p.label}：${p.value}${p.hint ? `（${p.hint}）` : ''}`).join('\n')
  const steps = t.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const limits = t.limitations.map((s) => `- ${s}`).join('\n')
  return [
    `特效技法：${t.name}（${t.nameEn}）`,
    `源库能力标签：${t.execLabel}（本页只读，不触发执行）`,
    `类别：${t.categoryLabel} · 实现：${t.implLabel} · 复杂度：${t.complexity}/5`,
    `一句话：${t.intent}`,
    `适用场景：${t.scenes.join(' / ') || '—'}`,
    `不适用：${t.antiScenes.join(' / ') || '—'}`,
    `输入：${t.inputRequirement || '—'}；输出：${t.output || '—'}`,
    '',
    '参数',
    params || '—',
    '',
    '制作步骤',
    steps || '—',
    '',
    '已知限制',
    limits || '—',
    '',
    `源库：${t.id} · v${t.version} · 更新 ${t.updatedAt}`,
  ].join('\n')
}

export function FxLibrary() {
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [cat, setCat] = useState<FxCategory | 'all'>('all')
  const [exec, setExec] = useState<FxExecType | 'all'>('all')
  const [inputKind, setInputKind] = useState<FxInputKind | 'all'>('all')
  const [impl, setImpl] = useState<FxImpl | 'all'>('all')
  const [maxComplexity, setMaxComplexity] = useState(5)
  const [previewKind, setPreviewKind] = useState<'all' | 'motion' | 'still'>('all')
  const [sort, setSort] = useState<SortKey>('cat')
  const [filtersOpen, setFiltersOpen] = useState(false)
  /* 「从 GitHub 导入技能」弹窗。入口是页头的一个按钮，不常驻任何内容。 */
  const [importOpen, setImportOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [hoveredPreviewId, setHoveredPreviewId] = useState<string | null>(null)
  const [focusedPreviewId, setFocusedPreviewId] = useState<string | null>(null)
  const [originalPosters, setOriginalPosters] = useState<Record<string, { file: string; frame: number; frameSource: string; checksum: string }>>({})
  useEffect(() => {
    const abort = new AbortController()
    void fetch(`${import.meta.env.BASE_URL}fx-original-posters/manifest.json?t=${Date.now()}`, { signal: abort.signal })
      .then((response) => response.ok ? response.json() : {})
      .then((data) => { if (!abort.signal.aborted) setOriginalPosters(data) })
      .catch(() => { /* 尚未生成静态预览时保留原状态 */ })
    return () => abort.abort()
  }, [])
  const pick = usePickMode()
  const pendingStore = usePendingAssets()
  const fxInPending = (id: string) => pendingStore.has(id)

  /* 特效 → 待发送条目。特效不是文件，带过去的是「做法」本身：
     分类、用途、实现方式、复杂度。这些正是 AI 照着复现所需的最小信息。
     只丢一个名字过去，等于让 AI 重新猜一遍。 */
  const toFxCard = (t: FxTechnique): PendingFxCard => ({
    fxId: t.id,
    name: t.name,
    intent: t.intent,
    categoryLabel: t.categoryLabel,
    execLabel: t.execLabel,
    complexity: t.complexity,
    impl: t.implLabel,
    poster: t.previewImage,
  })

  const stashFxCard = (t: FxTechnique) => {
    try {
      const raw = sessionStorage.getItem(FX_STASH_KEY)
      const map = raw ? JSON.parse(raw) as Record<string, PendingFxCard> : {}
      map[t.id] = toFxCard(t)
      sessionStorage.setItem(FX_STASH_KEY, JSON.stringify(map))
    } catch { /* 存储不可用时忽略 */ }
  }

  const addFxToPending = (list: FxTechnique[]) => {
    const n = pendingStore.addFx(list.map(toFxCard))
    emitToast(n > 0 ? `已加入待发送 ${n} 个特效` : '已在待发送中')
  }
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [workflowFor, setWorkflowFor] = useState<FxTechnique | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [lib, setLib] = useState<FxLibState>(loadLibState)
  /* 技法目录与用户状态都来自服务端（原先是静态常量 + localStorage）。
     分开两个 state：目录加载失败时，界面仍可以显示「读取失败」而不是把
     收藏也一起清空。 */
  const [techniques, setTechniques] = useState<FxTechnique[]>(EMPTY_TECHNIQUES)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  /* 语义检索给出的候选排序。null 表示「还没查过或查询为空」，
     此时沿用原本的目录顺序；空数组表示「查过但没有语义命中」。 */
  const [semanticOrder, setSemanticOrder] = useState<string[] | null>(null)
  /* 检索状态：只有 degraded 为 true 时才需要在界面上说明「这是字面匹配」。 */
  const [semanticNote, setSemanticNote] = useState<{ degraded: boolean; reason?: string } | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const copyTimer = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)

  /* 首次加载：拉技法目录与用户状态。
     旧版收藏存在 localStorage，先批量推到服务端再清空本地标记 ——
     用户收藏过的技法不该因为换存储而消失。 */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = await listTechniques()
        if (!alive) return
        setTechniques(list)
        setCatalogError(null)

        const legacy = loadLibState()
        if (legacy.favorites.length > 0) {
          const pushed = await importLegacyFavorites(legacy.favorites)
          if (pushed > 0) {
            // 推成功才清本地，失败时保留，下次再试。
            try {
              localStorage.removeItem(LIB_KEY)
            } catch {
              /* 清不掉也不影响使用 */
            }
          }
        }
        const state = await loadUserState()
        if (!alive) return
        setLib({ favorites: [...state.favorited], recent: state.recent })
      } catch (error) {
        if (!alive) return
        setCatalogError(error instanceof Error ? error.message : '读取技法库失败')
      } finally {
        if (alive) setCatalogLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }

  /**
   * 切换收藏。
   *
   * 以服务端返回为准而不是本地取反：多开窗口时，另一边可能已经改过。
   * 失败时不假装成功 —— 界面保持原状并提示。
   */
  function toggleFavorite(id: string) {
    const next = !lib.favorites.includes(id)
    // 先乐观更新让点击有即时反馈，失败再回滚。
    setLib((prev) => ({
      ...prev,
      favorites: next ? [id, ...prev.favorites] : prev.favorites.filter((f) => f !== id),
    }))
    void setFavorite(id, next)
      .then((actual) => {
        setLib((prev) => ({
          ...prev,
          favorites: actual
            ? prev.favorites.includes(id) ? prev.favorites : [id, ...prev.favorites]
            : prev.favorites.filter((f) => f !== id),
        }))
      })
      .catch(() => {
        // 回滚到点击前的状态
        setLib((prev) => ({
          ...prev,
          favorites: next ? prev.favorites.filter((f) => f !== id) : [id, ...prev.favorites],
        }))
        showToast('收藏失败，请稍后重试')
      })
  }

  function pushRecent(id: string) {
    setLib((prev) => ({
      ...prev,
      recent: [id, ...prev.recent.filter((r) => r !== id)].slice(0, 12),
    }))
    // 服务端记一次浏览；失败不打断用户看详情。
    void markViewed(id)
  }

  /* 语义检索：查询变化后延迟发起，避免每敲一个字都打一次接口。
     结果只用来排序，不做过滤 —— 过滤仍由下面的分面逻辑负责，
     否则「搜索一次就丢掉了分类/复杂度等筛选」会让人莫名其妙。 */
  useEffect(() => {
    const key = query.trim()
    if (!key) {
      setSemanticOrder(null)
      setSemanticNote(null)
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      void (async () => {
        const found = await searchTechniqueIds(key)
        if (!alive) return
        setSemanticOrder(found.usable ? found.ids : null)
        setSemanticNote(found.degraded ? { degraded: true, reason: found.reason } : null)
      })()
    }, 320)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query])

  /** 只应用搜索：分类/范围的计数不受其它分面影响，避免数字塌陷 */
  const searched = useMemo(() => {
    const key = query.trim().toLowerCase()
    if (!key) return techniques
    /* 检索命中的优先，其余本地字面命中的排在后面。
       两者都要保留：语义检索可能漏掉用户精确输入的名字（例如刚入库、
       还没进索引的技法），把它们直接过滤掉会让用户以为搜索坏了。 */
    const literal = techniques.filter((t) => searchBlob(t).includes(key))
    if (!semanticOrder || semanticOrder.length === 0) return literal
    const semantic = semanticOrder
      .map((id) => techniques.find((t) => t.id === id))
      .filter((t): t is FxTechnique => !!t)
    const semanticIds = new Set(semantic.map((t) => t.id))
    const rest = literal.filter((t) => !semanticIds.has(t.id))
    return [...semantic, ...rest]
  }, [query, techniques, semanticOrder])

  const scoped = useMemo(() => {
    if (scope === 'featured') return searched.filter((t) => t.featured)
    if (scope === 'favorites') return searched.filter((t) => lib.favorites.includes(t.id))
    if (scope === 'recent') {
      const order = new Map(lib.recent.map((id, i) => [id, i]))
      return searched
        .filter((t) => order.has(t.id))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    }
    return searched
  }, [searched, scope, lib])

  const sources = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of techniques) {
      const name = item.sourceProject?.trim() || (item.sourceKind === 'builtin' ? '内置技法' : '来源未记录')
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN'))
  }, [techniques])

  const visible = useMemo(
    () =>
      scoped.filter(
        (t) =>
          (!sourceFilter || (t.sourceProject?.trim() || (t.sourceKind === 'builtin' ? '内置技法' : '来源未记录')) === sourceFilter) &&
          (cat === 'all' || t.category === cat) &&
          (exec === 'all' || t.execType === exec) &&
          (inputKind === 'all' || t.inputKinds.includes(inputKind)) &&
          (impl === 'all' || t.impl === impl) &&
          t.complexity <= maxComplexity &&
          (previewKind === 'all' || (previewKind === 'motion' ? !!t.previewVideo : !t.previewVideo)),
      ),
    [scoped, sourceFilter, cat, exec, inputKind, impl, maxComplexity, previewKind],
  )

  /* 可见技法的能力标签全部相同时（目前 379 项都是「知识参考」），每张卡都写一遍只是噪声；
     能力仍在详情抽屉和筛选里。出现不同能力时卡片上的标签自动回来，用来区分。 */
  const uniformExec = useMemo(() => visible.length > 0 && visible.every((t) => t.execType === visible[0].execType), [visible])

  const current = selectedId ? techniques.find((t) => t.id === selectedId) ?? null : null

  const sorted = useMemo(() => {
    const arr = [...visible]
    if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    if (sort === 'complexity') {
      arr.sort((a, b) => a.complexity - b.complexity || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    }
    if (sort === 'updated') arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return arr
  }, [visible, sort])

  const counts = useMemo(() => {
    const category = new Map<FxCategory, number>()
    for (const t of searched) category.set(t.category, (category.get(t.category) ?? 0) + 1)
    return {
      category,
      featured: searched.filter((t) => t.featured).length,
      favorites: searched.filter((t) => lib.favorites.includes(t.id)).length,
      recent: searched.filter((t) => lib.recent.includes(t.id)).length,
    }
  }, [searched, lib])

  const techActiveCount =
    (exec !== 'all' ? 1 : 0) +
    (inputKind !== 'all' ? 1 : 0) +
    (impl !== 'all' ? 1 : 0) +
    (maxComplexity < 5 ? 1 : 0) +
    (previewKind !== 'all' ? 1 : 0)
  const activeCount = techActiveCount + (cat !== 'all' ? 1 : 0) + (sourceFilter ? 1 : 0)

  const playing = current !== null && playingId === current.id
  function resetTechFilters() {
    setExec('all')
    setInputKind('all')
    setImpl('all')
    setMaxComplexity(5)
    setPreviewKind('all')
  }

  /** 清空全部筛选（含分类），不清搜索词与范围 */
  function clearFilters() {
    resetTechFilters()
    setCat('all')
    setSourceFilter('')
  }

  function resetAll() {
    resetTechFilters()
    setCat('all')
    setSourceFilter('')
    setScope('all')
    setQuery('')
  }

  function openDrawer(id: string) {
    setSelectedId(id)
    setDrawerOpen(true)
    pushRecent(id)
  }

  function closeDrawer() {
    const id = selectedId
    setDrawerOpen(false)
    window.requestAnimationFrame(() => {
      if (id) document.querySelector<HTMLElement>(`[data-fx-id="${id}"]`)?.focus()
    })
  }

  /**
   * 弹窗打开时把焦点放到关闭键。
   * Esc 关闭、Tab 焦点圈、滚动锁定都交给 radix Dialog 自己处理 ——
   * 之前抽屉是自绘的才需要手写这套，现在再写一遍会变成双重响应。
   */
  useEffect(() => {
    if (!drawerOpen) return
    window.requestAnimationFrame(() => closeRef.current?.focus())
  }, [drawerOpen])

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  /** / 聚焦搜索；Esc 清搜索。抽屉打开时交给抽屉自己的键盘处理 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
      if (e.key === '/' && !typing && !drawerOpen) {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (e.key === 'Escape' && !drawerOpen && document.activeElement === searchRef.current) {
        if (query) setQuery('')
        else searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, drawerOpen])

  /** 筛选浮层：Esc 关闭 */
  useEffect(() => {
    if (!filtersOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtersOpen])

  async function copyRecipe() {
    if (!current) return
    try {
      await navigator.clipboard.writeText(copyText(current))
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied('idle'), 1800)
  }

  function recordWorkflowIntent(projectId: string, projectName: string) {
    if (!workflowFor) return
    try {
      const raw = localStorage.getItem(OUTBOX_KEY)
      const list = raw ? (JSON.parse(raw) as unknown[]) : []
      list.push({
        techniqueId: workflowFor.id,
        techniqueName: workflowFor.name,
        projectId,
        projectName,
        at: new Date().toISOString(),
      })
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(list))
    } catch {
      /* 记录失败不阻塞 */
    }
    setWorkflowFor(null)
    showToast(`已记入意向清单：${workflowFor.name} → ${projectName}（调用链未接入，不会执行）`)
  }

  const SCOPES: Array<{ id: Scope; label: string; count: number; icon: React.ReactNode }> = [
    { id: 'all', label: '全部', count: searched.length, icon: null },
    { id: 'featured', label: '精选', count: counts.featured, icon: null },
    { id: 'favorites', label: '收藏', count: counts.favorites, icon: <UiIcon icon={Star01} size="xs" aria-hidden="true" /> },
    { id: 'recent', label: '最近使用', count: counts.recent, icon: <UiIcon icon={Clock} size="xs" aria-hidden="true" /> },
  ]

  return (
    <div className="fxlib">
      <CapabilityImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={() => {
        void listTechniques().then((list) => { setTechniques(list); setCatalogError(null) })
          .catch(() => setCatalogError('刷新技法库失败'))
      }} />
      <section className="fx-panel" aria-label="特效技法库" inert={drawerOpen || workflowFor ? true : undefined}>
        <div className="fx-cmd">
          <div className="fx-heading-group"><h1 className="fx-cmd-title">特效技法库</h1></div>
          {!pick.active && <PickButton onClick={pick.enter} label="特效" />}
          {/* 入口：粘贴 GitHub 仓库地址，识别其中的技能后导入。 */}
          <button type="button" className="fx-toolbtn" onClick={() => setImportOpen(true)}>导入来源</button>
        </div>

        {/* 去 AI 味：整行图例删除——组件不再解释自己；能力与复杂度直接写进卡片元信息行 */}
        <FxMetaBar SCOPES={SCOPES} activeCount={activeCount} cat={cat} clearFilters={clearFilters} counts={counts} exec={exec} filtersOpen={filtersOpen} impl={impl} inputKind={inputKind} maxComplexity={maxComplexity} previewKind={previewKind} query={query} scope={scope} searchRef={searchRef} searched={searched} semanticNote={semanticNote} setCat={setCat} setExec={setExec} setFiltersOpen={setFiltersOpen} setImpl={setImpl} setInputKind={setInputKind} setMaxComplexity={setMaxComplexity} setPreviewKind={setPreviewKind} setQuery={setQuery} setScope={setScope} setSort={setSort} setSourceFilter={setSourceFilter} sort={sort} sourceFilter={sourceFilter} sources={sources} visible={visible} />

        <FxContent activeCount={activeCount} addFxToPending={addFxToPending} catalogError={catalogError} catalogLoading={catalogLoading} drawerOpen={drawerOpen} focusedPreviewId={focusedPreviewId} fxInPending={fxInPending} hoveredPreviewId={hoveredPreviewId} lib={lib} openDrawer={openDrawer} originalPosters={originalPosters} pick={pick} query={query} resetAll={resetAll} scope={scope} setFocusedPreviewId={setFocusedPreviewId} setHoveredPreviewId={setHoveredPreviewId} setScope={setScope} sorted={sorted} stashFxCard={stashFxCard} toggleFavorite={toggleFavorite} uniformExec={uniformExec} visible={visible} workflowFor={workflowFor} />

        {pick.active && (
          <PickBar
            count={pick.selected.size}
            total={sorted.length}
            noun="个特效"
            onSelectAll={() => pick.selectAll(sorted.map((x) => x.id))}
            onCancel={pick.exit}
            onConfirm={() => pick.confirm((ids) => {
              const list = ids.map((id) => techniques.find((x) => x.id === id)).filter((x): x is FxTechnique => !!x)
              addFxToPending(list)
            })}
          />
        )}
      </section>

      {/* ── 详情弹窗：预览 → 用途 → 实现方法 → 参数 → 调用方式 ──
          用项目统一的 Dialog（radix）而不是自绘抽屉：遮罩、焦点陷阱、
          Esc 关闭、滚动锁定都由组件负责，样式与「导入来源」等弹窗一致。 */}
      <Dialog open={drawerOpen && !!current} onOpenChange={(o) => { if (!o) closeDrawer() }}>
        <FxDetailDialog closeDrawer={closeDrawer} closeRef={closeRef} copied={copied} copyRecipe={copyRecipe} current={current} lib={lib} modalRef={modalRef} openDrawer={openDrawer} playing={playing} setPlayingId={setPlayingId} setWorkflowFor={setWorkflowFor} techniques={techniques} toggleFavorite={toggleFavorite} />
      </Dialog>

      {/* ── 用于工作流：目标选择（调用链未接入，只记意向） ── */}
      {workflowFor && (
        <div
          className="fx-scrim fx-scrim-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setWorkflowFor(null)
          }}
        >
          <div className="fx-dialog" role="dialog" aria-modal="true" aria-labelledby="fx-dialog-title">
            <div className="fx-dialog-head">
              <h3 id="fx-dialog-title">将「{workflowFor.name}」用于项目</h3>
              <button type="button" className="fx-dialog-close" onClick={() => setWorkflowFor(null)} aria-label="关闭">
                <UiIcon icon={SemIcons.close} size="sm" aria-hidden="true" />
              </button>
            </div>
            <p className="fx-dialog-note">
              <UiIcon icon={SemIcons.info} size="xs" aria-hidden="true" />
              工作流调用链尚未接入。选择目标后只会把意向记入本地清单，不会真正插入或执行。
            </p>
            <div className="fx-dialog-list">
              {PROJECTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="fx-dialog-item"
                  onClick={() => recordWorkflowIntent(p.id, p.name)}
                >
                  <span className="fx-dialog-item-main">
                    <b>{p.name}</b>
                    <em>{STAGE_LABEL[p.stage]}</em>
                  </span>
                  <UiIcon icon={SemIcons.expand} size="xs" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fx-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}

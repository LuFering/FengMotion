import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Clock, Dataflow04, Star01, SwitchVertical01 } from '@untitledui/icons'
import {
  FX_CATEGORIES,
  FX_EXEC_TYPES,
  FX_IMPLS,
  FX_INPUT_TYPES,
  type FxCategory,
  type FxExecType,
  type FxImpl,
  type FxInputKind,
  type FxTechnique,
} from '@/features/fx/model/fxTechniques'
import {
  importLegacyFavorites, listTechniques, loadUserState, markViewed, searchTechniqueIds, setFavorite,
} from '@/features/fx/services/fxApiService'
import { SilentVideoPreview } from '@/shared/components/SilentVideoPreview'
import { PROJECTS, STAGE_LABEL } from '@/features/project/model/projects'
import { EmptyState } from '@/shared/components/fm/EmptyState'
import { setAssetDragData, usePendingAssets, type PendingFxCard } from '@/features/assets/hooks/usePendingAssets'
import { clearDragGhost, setDragGhost } from '@/shared/pick-mode/dragGhost'
import { usePickMode } from '@/shared/pick-mode/usePickMode'
import { PickBar, PickButton, PickCheck } from '@/shared/pick-mode/PickModeUI'
import { toast as emitToast } from '@/shared/lib/toast'
import { SearchField } from '@/shared/components/SearchField'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { CapabilityImportDialog } from './components/CapabilityImportDialog'
import { originalSceneLoader } from '@/features/fx/components/fxOriginalRegistry'

const FxOriginalWavesPreview = lazy(() => import('@/features/fx/components/FxOriginalWavesPreview'))
class FxPreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <span className="fxc-media-empty">原始画面加载失败</span> : this.props.children }
}

/**
 * 特效技法库 —— 按《前端下一步开发计划》§4.4（04-B）落地：
 *
 * 结构：页头（标题 + 搜索）→ 工具栏（范围 / 更多筛选 / 排序 / 视图切换）
 *       → 分类 chips →（有技术筛选时）已选条件 chips → 效果预览卡片网格
 *       （紧凑列表为可选视图）→ 点卡打开右侧详情抽屉（overlay，不常驻）。
 *
 * 与旧版的差别：三组技术筛选（执行状态 / 输入 / 实现 / 复杂度）不再常驻，
 * 收进「更多筛选」展开带，已选条件以可逐项移除的 chips 显示；
 * 分类按效果用途组织；详情抽屉按 预览 → 用途 → 实现方法 → 参数 → 调用方式 分层。
 *
 * 排版定稿（2026-10-23 与 ChatGPT 两轮对话定案，见 goals 文档《三库排版优化定案》）：
 * 单行命令条（标题+搜索+筛选按钮）+ 一行元信息（计数/已选条件/范围/排序）+ 海报墙；
 * 分类与技术条件全部收进锚定筛选按钮的浮层，即时生效；不设常驻分类条与底部状态栏。
 *
 * 能力语义：可直接执行 / 可组合 / 知识参考是**源库元数据**，逐字保留；
 * 本页不提供执行器。「用于工作流」打开目标选择弹窗：调用链未接入，
 * 选择只记入本地意向清单（fm-fx-usage-outbox-v1），不假装插入成功。
 * 收藏 / 最近使用存本地（fm-fx-library-v1）。
 *
 * 视觉只共享 A2 云端岛屿 V3 的 token（含浅白 / 触感主题根），不共享工作台骨架。
 */

const CATEGORY_IDS = FX_CATEGORIES.map((c) => c.id)
const EXEC_IDS = Object.keys(FX_EXEC_TYPES) as FxExecType[]
const IMPL_IDS = Object.keys(FX_IMPLS) as FxImpl[]
const INPUT_IDS = Object.keys(FX_INPUT_TYPES) as FxInputKind[]
const COMPLEXITY_STEPS = [1, 2, 3, 4, 5]

const categoryLabel = (id: FxCategory) => FX_CATEGORIES.find((c) => c.id === id)?.label ?? id
const execLabel = (id: FxExecType) => FX_EXEC_TYPES[id].label
const implLabel = (id: FxImpl) => FX_IMPLS[id]
const inputLabel = (id: FxInputKind) => FX_INPUT_TYPES[id]

/** 拖拽时按特效 ID 暂存参数包（DataTransfer 只能传字符串） */
const FX_STASH_KEY = 'fm-fx-card-stash-v1'
const LIB_KEY = 'fm-fx-library-v1'
const OUTBOX_KEY = 'fm-fx-usage-outbox-v1'

type SortKey = 'cat' | 'name' | 'complexity' | 'updated'
type Scope = 'all' | 'featured' | 'favorites' | 'recent'

interface FxLibState {
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
        <div className="fx-meta">
          <nav className="fx-meta-scope" aria-label="范围">
            {SCOPES.map((s) => (
              <button key={s.id} type="button" data-on={scope === s.id ? '' : undefined} aria-pressed={scope === s.id} onClick={() => setScope(s.id)}>
                {s.label}<em className="num">{s.count}</em>
              </button>
            ))}
          </nav>
          <label className="fx-source-select">
              <span>来源</span>
              <select aria-label="按来源筛选技法" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                <option value="">全部来源</option>
                {sources.map(([name, count]) => <option key={name} value={name}>{name}（{count}）</option>)}
              </select>
          </label>
          <div className="fx-cmd-search">
            <SearchField
              inputRef={searchRef}
              value={query}
              onChange={setQuery}
              placeholder="搜索名称、用途或实现方式"
              shortcutHint="/"
              ariaLabel="搜索技法"
            />
            {/* 检索降级时必须明说：不标注的话，用户会把字面匹配当成语义命中，
                据此判断「库里只有这些」。这是库内最容易误导人的一处。 */}
            {query.trim() && semanticNote?.degraded && (
              <p className="fx-search-note" role="status">
                语义检索暂不可用，以下按关键词字面匹配
              </p>
            )}
          </div>
          <div className="fx-filterwrap">
            <button
              type="button"
              className="fx-toolbtn"
              aria-expanded={filtersOpen}
              data-on={filtersOpen || activeCount > 0 ? '' : undefined}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <UiIcon icon={SemIcons.sliders} size="sm" />
              筛选
              {activeCount > 0 && <b className="fx-badge num">{activeCount}</b>}
              <UiIcon icon={SemIcons.collapse} size="xs" className={filtersOpen ? 'fx-chev is-open' : 'fx-chev'} />
            </button>
            {filtersOpen && (
              <>
                <div className="fx-pop-backdrop" onClick={() => setFiltersOpen(false)} />
                <div className="fx-pop" role="dialog" aria-label="筛选条件">
                  <div className="fx-filtergroup">
                    <span className="fx-filterlabel" id="fx-fg-cat">分类</span>
                    <div className="fx-chips" role="group" aria-labelledby="fx-fg-cat">
                      <button type="button" className="fx-chip" aria-pressed={cat === 'all'} data-on={cat === 'all' ? '' : undefined} onClick={() => setCat('all')}>
                        全部<em className="num">{searched.length}</em>
                      </button>
                      {CATEGORY_IDS.map((id) => (
                        <button key={id} type="button" className="fx-chip" aria-pressed={cat === id} data-on={cat === id ? '' : undefined} onClick={() => setCat(cat === id ? 'all' : id)}>
                          {categoryLabel(id)}<em className="num">{counts.category.get(id) ?? 0}</em>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fx-filtergroup">
                    <span className="fx-filterlabel" id="fx-fg-exec">源库能力</span>
                    <div className="fx-chips" role="group" aria-labelledby="fx-fg-exec">
                      <button type="button" className="fx-chip" aria-pressed={exec === 'all'} data-on={exec === 'all' ? '' : undefined} onClick={() => setExec('all')}>全部</button>
                      {EXEC_IDS.map((id) => (
                        <button key={id} type="button" className="fx-chip" aria-pressed={exec === id} data-on={exec === id ? '' : undefined} onClick={() => setExec(exec === id ? 'all' : id)}>
                          <i className="fx-dot" data-cap={id} aria-hidden="true" />{execLabel(id)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fx-filtergroup">
                    <span className="fx-filterlabel" id="fx-fg-preview">预览类型</span>
                    <div className="fx-chips" role="group" aria-labelledby="fx-fg-preview">
                      {([['all', '全部'], ['motion', '有动态预览'], ['still', '静态海报']] as const).map(([id, label]) => (
                        <button key={id} type="button" className="fx-chip" aria-pressed={previewKind === id} data-on={previewKind === id ? '' : undefined} onClick={() => setPreviewKind(id)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fx-filtergroup">
                    <span className="fx-filterlabel" id="fx-fg-impl">实现方式</span>
                    <div className="fx-chips" role="group" aria-labelledby="fx-fg-impl">
                      <button type="button" className="fx-chip" aria-pressed={impl === 'all'} data-on={impl === 'all' ? '' : undefined} onClick={() => setImpl('all')}>全部</button>
                      {IMPL_IDS.map((id) => (
                        <button key={id} type="button" className="fx-chip" aria-pressed={impl === id} data-on={impl === id ? '' : undefined} onClick={() => setImpl(impl === id ? 'all' : id)}>
                          {implLabel(id)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fx-filtergroup">
                    <span className="fx-filterlabel" id="fx-fg-input">输入素材</span>
                    <div className="fx-chips" role="group" aria-labelledby="fx-fg-input">
                      <button type="button" className="fx-chip" aria-pressed={inputKind === 'all'} data-on={inputKind === 'all' ? '' : undefined} onClick={() => setInputKind('all')}>全部</button>
                      {INPUT_IDS.map((id) => (
                        <button key={id} type="button" className="fx-chip" aria-pressed={inputKind === id} data-on={inputKind === id ? '' : undefined} onClick={() => setInputKind(inputKind === id ? 'all' : id)}>
                          {inputLabel(id)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fx-filtergroup">
                    <span className="fx-filterlabel" id="fx-fg-cx">实现复杂度 ≤</span>
                    <div className="fx-chips" role="group" aria-labelledby="fx-fg-cx">
                      {COMPLEXITY_STEPS.map((n) => (
                        <button key={n} type="button" className="fx-chip num" aria-pressed={maxComplexity === n} data-on={maxComplexity === n ? '' : undefined} onClick={() => setMaxComplexity(n)}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fx-pop-foot">
                    <span>选择即生效</span>
                    <button type="button" className="fx-textbtn" onClick={clearFilters} disabled={activeCount === 0}>
                      清空筛选
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          {cat !== 'all' && (
            <span className="fx-activechip">
              分类 · {categoryLabel(cat)}
              <button type="button" aria-label="移除分类筛选" onClick={() => setCat('all')}><UiIcon icon={SemIcons.close} size="xs" /></button>
            </span>
          )}
          {exec !== 'all' && (
            <span className="fx-activechip">
              能力 · {execLabel(exec)}
              <button type="button" aria-label="移除能力筛选" onClick={() => setExec('all')}><UiIcon icon={SemIcons.close} size="xs" /></button>
            </span>
          )}
          {previewKind !== 'all' && (
            <span className="fx-activechip">
              预览 · {previewKind === 'motion' ? '有动态预览' : '静态海报'}
              <button type="button" aria-label="移除预览类型筛选" onClick={() => setPreviewKind('all')}><UiIcon icon={SemIcons.close} size="xs" /></button>
            </span>
          )}
          {impl !== 'all' && (
            <span className="fx-activechip">
              实现 · {implLabel(impl)}
              <button type="button" aria-label="移除实现方式筛选" onClick={() => setImpl('all')}><UiIcon icon={SemIcons.close} size="xs" /></button>
            </span>
          )}
          {inputKind !== 'all' && (
            <span className="fx-activechip">
              输入 · {inputLabel(inputKind)}
              <button type="button" aria-label="移除输入素材筛选" onClick={() => setInputKind('all')}><UiIcon icon={SemIcons.close} size="xs" /></button>
            </span>
          )}
          {maxComplexity < 5 && (
            <span className="fx-activechip">
              复杂度 ≤ {maxComplexity}
              <button type="button" aria-label="移除复杂度筛选" onClick={() => setMaxComplexity(5)}><UiIcon icon={SemIcons.close} size="xs" /></button>
            </span>
          )}
          <span className="fx-spacer" />
          {(query.trim() || activeCount > 0) && <span className="fx-result-summary" role="status">找到 {visible.length} 项技法</span>}

          <label className="fx-sort">
            <UiIcon icon={SwitchVertical01} size="xs" aria-hidden="true" />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="排序方式">
              <option value="cat">按分类</option>
              <option value="name">名称</option>
              <option value="complexity">复杂度</option>
              <option value="updated">最近更新</option>
            </select>
          </label>
        </div>

        <div className="fx-content">
          {catalogLoading ? (
            /* 加载中与「没有技法」必须分开：技法目录来自服务端，
               还没读到时显示「空的」会让用户以为库是空的。 */
            <EmptyState icon="loader" title="正在读取技法库" body="从本地服务读取技法目录…" />
          ) : catalogError ? (
            <EmptyState
              icon="alert-triangle"
              title="技法库读取失败"
              body={catalogError}
            />
          ) : visible.length === 0 ? (
            scope === 'favorites' && !query && activeCount === 0 ? (
              <EmptyState
                icon="star"
                title="还没有收藏的技法"
                body="在卡片或详情里点星标，常用的技法会收进这里。"
                action={{ label: '去看全部技法', onClick: () => setScope('all') }}
              />
            ) : scope === 'recent' && !query && activeCount === 0 ? (
              <EmptyState
                icon="film"
                title="还没有最近使用"
                body="打开任意技法的详情，它就会出现在这里。"
                action={{ label: '去看全部技法', onClick: () => setScope('all') }}
              />
            ) : (
              <EmptyState
                icon="search"
                title="没有匹配的技法"
                body="换个词，或清除分类 / 状态 / 输入 / 实现 / 复杂度筛选。"
                action={{ label: '清除搜索与筛选', onClick: resetAll }}
              />
            )
          ) : (
            <div className="fx-grid">
              {sorted.map((t) => {
                const fav = lib.favorites.includes(t.id)
                const hasOriginal = Boolean(originalSceneLoader(t.sourceProject, t.sourcePath))
                const previewActive = !drawerOpen && !workflowFor && (focusedPreviewId ?? hoveredPreviewId) === t.id
                const originalPoster = hasOriginal && t.sourcePath ? originalPosters[t.sourcePath] : undefined
                const poster = originalPoster && /^[a-f0-9]{20}\.jpg$/.test(originalPoster.file)
                  ? `${import.meta.env.BASE_URL}fx-original-posters/${originalPoster.file}?v=${encodeURIComponent(originalPoster.checksum || '')}` : t.previewImage
                return (
                  <article
                    key={t.id}
                    className="fxc fxc-poster"
                    data-fx-id={t.id}
                    data-original={hasOriginal || undefined}
                    data-preview-active={(previewActive && (hasOriginal || Boolean(t.previewVideo))) || undefined}
                    data-added={fxInPending(t.id) || undefined}
                    data-pickmode={pick.active || undefined}
                    data-picked={(pick.active && pick.has(t.id)) || undefined}
                    onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHoveredPreviewId(t.id) }}
                    onPointerLeave={() => setHoveredPreviewId((id) => id === t.id ? null : id)}
                    onFocusCapture={() => setFocusedPreviewId(t.id)}
                    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedPreviewId((id) => id === t.id ? null : id) }}
                    draggable={!pick.active}
                    onDragStart={(e) => {
                      /* 与素材库/参考片库同一套：同一个 DataTransfer 类型，
                         待发送那边不用改就能接住；拖动时把整卡快照换成 56px 小块，
                         否则卡片举在鼠标边会盖住落点。 */
                      stashFxCard(t)
                      setAssetDragData(e.dataTransfer, [t.id])
                      const ghostEl = setDragGhost({
                        thumb: t.previewImage,
                        label: t.name,
                        count: 1,
                      })
                      e.dataTransfer.setDragImage(ghostEl, 28, 28)
                    }}
                    onDragEnd={clearDragGhost}
                  >
                    <div className="fxc-media" data-original-preview={hasOriginal || undefined}>
                      <SilentVideoPreview src={t.previewVideo} poster={poster}
                        active={previewActive}
                        mountOnlyWhenActive showFailure label={`${t.name} 动态预览`} />
                      {hasOriginal && previewActive && t.sourcePath && t.sourceProject && (
                        <FxPreviewBoundary>
                          <Suspense fallback={<span className="fxc-media-empty">正在加载…</span>}>
                            <FxOriginalWavesPreview sourceProject={t.sourceProject} sourcePath={t.sourcePath} playing={previewActive} />
                          </Suspense>
                        </FxPreviewBoundary>
                      )}
                      {!poster && !t.previewVideo && !previewActive && (
                        <span className="fxc-media-empty"><span>暂无预览</span></span>
                      )}
                      {pick.active && <PickCheck checked={pick.has(t.id)} />}
                      {t.previewVideo && <span className="fxc-preview-label"><UiIcon icon={SemIcons.play} size="xs" aria-hidden="true" />动态预览</span>}
                      {/* 加入待发送：与素材库/参考片库同一位置、同一规格 */}
                      {!pick.active && <button
                        type="button"
                        className="fxc-add"
                        data-added={fxInPending(t.id) || undefined}
                        aria-label={fxInPending(t.id) ? `${t.name} 已在待发送` : `把 ${t.name} 加入待发送`}
                        title={fxInPending(t.id) ? '已在待发送' : '加入待发送'}
                        onClick={(e) => { e.stopPropagation(); addFxToPending([t]) }}
                      >
                        {fxInPending(t.id) ? <UiIcon icon={SemIcons.check} size="sm" /> : <UiIcon icon={SemIcons.plus} size="sm" />}
                      </button>}
                      <button
                        type="button"
                        className="fxc-fav"
                        data-on={fav ? '' : undefined}
                        aria-pressed={fav}
                        aria-label={fav ? `取消收藏 ${t.name}` : `收藏 ${t.name}`}
                        onClick={() => toggleFavorite(t.id)}
                      >
                        <UiIcon icon={Star01} size="sm" fill={fav ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    {/* 覆盖层只负责"点开详情"。它是 <button> 且铺满整卡，
                        从它上面起手拖拽时，浏览器会把"这个按钮"当成拖拽源，
                        卡片上的 onDragStart 永远不触发 —— 拖拽因而失效。
                        关掉它自身的可拖性，让拖拽落到父级 article 上。 */}
                    <button type="button" className="fxc-hit" draggable={false}
                            aria-label={pick.active ? `${pick.has(t.id) ? '取消选择' : '选择'} ${t.name}` : `查看技法：${t.name}`}
                            onClick={() => { if (pick.active) pick.toggle(t.id); else openDrawer(t.id) }} />
                    <div className="fxc-body">
                      <span className="fxc-category">{categoryLabel(t.category)}</span>
                      <h3 className="fxc-title">{t.name}</h3>
                      <p className="fxc-intent">{t.intent}</p>
                      <div className="fxc-meta">
                        {!uniformExec && <span>{execLabel(t.execType)}</span>}
                        {t.inputLabels.length > 0 && <span className="fxc-inputs">{t.inputLabels.join(' / ')}</span>}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>

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
        <DialogContent className="fx-modal" showCloseButton={false}>
          {/* 关闭键挂在弹窗根部而不是预览图里：条目没有预览图时，
              放在预览里的按钮会跟着一起消失，用户就只能靠 Esc 关闭。 */}
          <button
            ref={closeRef}
            type="button"
            className="fx-modal-close"
            onClick={closeDrawer}
            aria-label="关闭技法详情"
            title="关闭（Esc）"
          >
            <UiIcon icon={SemIcons.close} size="sm" aria-hidden="true" />
          </button>
          {current && (
            <div ref={modalRef} className="fx-modal-scroll">
              {current.previewImage ? <div className="fx-preview">
                <img
                  src={current.previewImage}
                  alt=""
                  onError={(e) => e.currentTarget.classList.add('is-broken')}
                />
                {playing && current.previewVideo && (
                  <video
                    key={current.id}
                    className="fx-preview-video"
                    src={current.previewVideo}
                    poster={current.previewImage}
                    muted
                    loop
                    playsInline
                    autoPlay
                    onError={() => setPlayingId(null)}
                  />
                )}
                {current.previewVideo && (
                  <button
                    type="button"
                    className="fx-preview-toggle"
                    onClick={() => setPlayingId((p) => (p === current.id ? null : current.id))}
                    aria-label={playing ? '暂停动作预览' : '播放动作预览'}
                    title={playing ? '暂停动作预览' : '播放动作预览'}
                  >
                    {playing ? <UiIcon icon={SemIcons.pause} size="sm" aria-hidden="true" /> : <UiIcon icon={SemIcons.play} size="sm" aria-hidden="true" />}
                  </button>
                )}
                <span className={`fx-cap fx-cap-${current.execType} fx-preview-cap`} title={FX_EXEC_TYPES[current.execType].hint}>
                  {current.execLabel}
                </span>
                {current.previewCaption && <span className="fx-preview-caption">{current.previewCaption}</span>}
              </div> : null}

              <div className="fx-drawer-body">
                {/* 打开卡片的意图：先认清「这是什么效果」，再决定「用不用得上」，
                    最后才是「怎么拿走」。所以顺序是 名称 → 一句话说明 → 操作 → 用处 → 细节，
                    技术元数据（复杂度/依赖/来源/版本）收进折叠区，不跟主信息抢位置。 */}

                <header className="fxm-head">
                  <div className="fxm-head-main">
                    <h2 id="fx-drawer-title">{current.name}</h2>
                    {current.nameEn && <span className="fxm-nameen">{current.nameEn}</span>}
                  </div>
                  <button
                    type="button"
                    className="fx-favbtn"
                    data-on={lib.favorites.includes(current.id) ? '' : undefined}
                    aria-pressed={lib.favorites.includes(current.id)}
                    onClick={() => toggleFavorite(current.id)}
                  >
                    <UiIcon icon={Star01} size="xs" fill={lib.favorites.includes(current.id) ? 'currentColor' : 'none'} aria-hidden="true" />
                    {lib.favorites.includes(current.id) ? '已收藏' : '收藏'}
                  </button>
                </header>

                <p className="fxm-intent">{current.intent}</p>

                {/* 主操作紧跟说明：读懂了就能立刻拿走，不用滚到底部去找。
                    状态标签（能否一键运行）就放在按钮旁边，避免读完正文才发现用不了。 */}
                <div className="fxm-actions">
                  <button type="button" className="fx-btn fx-btn-primary" onClick={copyRecipe}>
                    {copied === 'ok' ? <UiIcon icon={SemIcons.check} size="sm" aria-hidden="true" /> : <UiIcon icon={SemIcons.copy} size="sm" aria-hidden="true" />}
                    {copied === 'ok' ? '已复制' : copied === 'fail' ? '复制失败' : '复制配方'}
                  </button>
                  <button type="button" className="fx-btn" onClick={() => setWorkflowFor(current)}>
                    <UiIcon icon={Dataflow04} size="sm" aria-hidden="true" />
                    用于工作流
                  </button>
                  <span className={`fxm-mode fx-cap-${current.execType}`} title={FX_EXEC_TYPES[current.execType].hint}>
                    {current.execLabel}
                  </span>
                </div>

                {/* 用处：只有真填了才显示。外部导入的条目往往没有 antiScenes，
                    以前会留一个空的「不适用」标题，看起来像内容加载失败。 */}
                {(current.scenes.length > 0 || current.antiScenes.length > 0) && (
                  <section className="fxm-sec">
                    <h3 className="fxm-label">用在哪</h3>
                    {current.scenes.length > 0 && (
                      <p className="fxm-useline"><span className="fxm-useok">适合</span>{current.scenes.join('、')}</p>
                    )}
                    {current.antiScenes.length > 0 && (
                      <p className="fxm-useline"><span className="fxm-useno">不适合</span>{current.antiScenes.join('、')}</p>
                    )}
                  </section>
                )}

                {/* 制作步骤：只有真写了步骤才成节。
                    没有步骤时「实现方式：AI 生成」这种一行信息并入技术细节，
                    不在正文里单独立一个只有五个字的标题。 */}
                {current.steps.length > 0 && (
                  <section className="fxm-sec">
                    <h3 className="fxm-label">怎么做</h3>
                    <ol className="fxm-steps">
                      {current.steps.map((step, i) => (
                        <li key={i}><span className="fxm-stepno num">{i + 1}</span><span>{step}</span></li>
                      ))}
                    </ol>
                  </section>
                )}

                {/* 参数：空数组时整节不出现（以前会留一个空标题） */}
                {current.params.length > 0 && (
                  <section className="fxm-sec">
                    <h3 className="fxm-label">参数</h3>
                    <ul className="fxm-params">
                      {current.params.map((param) => (
                        <li key={param.key}>
                          <span className="fxm-param-label">{param.label}</span>
                          <b className="num">{param.value}</b>
                          {param.hint && <em title={param.hint}>{param.hint}</em>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* 限制与失败：这是「用了会踩坑」的预警，属于主信息，不折叠 */}
                {current.limitations.length > 0 && (
                  <section className="fxm-sec">
                    <h3 className="fxm-label">注意</h3>
                    <ul className="fxm-warns">
                      {current.limitations.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                    {current.failures.length > 0 && (
                      <ul className="fxm-warns fxm-warns-sub">
                        {current.failures.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    )}
                  </section>
                )}

                {current.related.length > 0 && (
                  <section className="fxm-sec">
                    <h3 className="fxm-label">同类技法</h3>
                    <div className="fxm-related">
                      {[...current.related, ...current.alternatives].map((id) => {
                        const rel = techniques.find((t) => t.id === id)
                        if (!rel) return null
                        return (
                          <button key={id} type="button" className="fx-relchip" onClick={() => openDrawer(id)}>
                            {rel.name}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )}

                {/* 技术细节：复杂度、依赖、兼容、输入输出、来源许可、版本。
                    这些是「要不要用/出了事查」的信息，不是打开卡片就想看的，
                    折起来让主内容一屏能读完。 */}
                <details className="fxm-details">
                  <summary>技术细节</summary>
                  <dl className="fx-io">
                    <div><dt>分类</dt><dd>{current.categoryLabel}</dd></div>
                    <div><dt>实现</dt><dd>{current.implLabel}</dd></div>
                    <div><dt>复杂度</dt><dd className="num">{current.complexity} / 5</dd></div>
                    {current.inputRequirement && <div><dt>输入</dt><dd>{current.inputRequirement}</dd></div>}
                    {current.output && <div><dt>输出</dt><dd>{current.output}</dd></div>}
                    {current.dependencies.length > 0 && <div><dt>依赖</dt><dd>{current.dependencies.join('；')}</dd></div>}
                    {current.compatibility.length > 0 && <div><dt>兼容</dt><dd>{current.compatibility.join('；')}</dd></div>}
                    {current.sourceProject && <div><dt>来源</dt><dd>{current.sourceProject}</dd></div>}
                    {current.sourceUrl && (
                      <div><dt>链接</dt><dd><a href={current.sourceUrl} target="_blank" rel="noreferrer">{current.sourceUrl}</a></dd></div>
                    )}
                    {current.licenseCode && <div><dt>代码许可</dt><dd>{current.licenseCode}</dd></div>}
                    {current.licensePreview && <div><dt>预览许可</dt><dd>{current.licensePreview}</dd></div>}
                    <div><dt>版本</dt><dd className="num">v{current.version}</dd></div>
                  </dl>
                  {current.attribution && <p className="fxm-note">{current.attribution}</p>}
                  {/* 有源码不等于能一键跑 —— 这句必须留，否则用户会以为点了就生成 */}
                  {current.sourceKind && current.sourceKind !== 'builtin' && (
                    <p className="fxm-note">该条目仅提供说明与源码参考，尚未接入执行适配器，不能一键运行。</p>
                  )}
                </details>
              </div>
            </div>
          )}
        </DialogContent>
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

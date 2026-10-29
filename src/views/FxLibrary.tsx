import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Info,
  Pause,
  Play,
  Plus,
  SlidersHorizontal,
  Star,
  Workflow,
  X,
} from 'lucide-react'
import {
  FX_CATEGORIES,
  FX_EXEC_TYPES,
  FX_IMPLS,
  FX_INPUT_TYPES,
  FX_TECHNIQUES,
  type FxCategory,
  type FxExecType,
  type FxImpl,
  type FxInputKind,
  type FxTechnique,
} from '@/data/fxTechniques'
import { SilentVideoPreview } from '@/components/SilentVideoPreview'
import { PROJECTS, STAGE_LABEL } from '@/data/projects'
import { EmptyState } from '@/components/fm/EmptyState'
import { setAssetDragData, usePendingAssets, type PendingFxCard } from '@/shell/usePendingAssets'
import { clearDragGhost, setDragGhost } from '@/shell/dragGhost'
import { usePickMode } from '@/shell/usePickMode'
import { PickBar, PickButton, PickCheck } from '@/shell/PickModeUI'
import { toast as emitToast } from '@/shell/toast'
import { SearchField } from '@/components/SearchField'

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
  const [scope, setScope] = useState<Scope>('all')
  const [cat, setCat] = useState<FxCategory | 'all'>('all')
  const [exec, setExec] = useState<FxExecType | 'all'>('all')
  const [inputKind, setInputKind] = useState<FxInputKind | 'all'>('all')
  const [impl, setImpl] = useState<FxImpl | 'all'>('all')
  const [maxComplexity, setMaxComplexity] = useState(5)
  const [previewKind, setPreviewKind] = useState<'all' | 'motion' | 'still'>('all')
  const [sort, setSort] = useState<SortKey>('cat')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
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

  const searchRef = useRef<HTMLInputElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const copyTimer = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(LIB_KEY, JSON.stringify(lib))
    } catch {
      /* 持久化失败不阻塞页面 */
    }
  }, [lib])

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }

  function toggleFavorite(id: string) {
    setLib((prev) => ({
      ...prev,
      favorites: prev.favorites.includes(id)
        ? prev.favorites.filter((f) => f !== id)
        : [id, ...prev.favorites],
    }))
  }

  function pushRecent(id: string) {
    setLib((prev) => ({
      ...prev,
      recent: [id, ...prev.recent.filter((r) => r !== id)].slice(0, 12),
    }))
  }

  /** 只应用搜索：分类/范围的计数不受其它分面影响，避免数字塌陷 */
  const searched = useMemo(() => {
    const key = query.trim().toLowerCase()
    if (!key) return FX_TECHNIQUES
    return FX_TECHNIQUES.filter((t) => searchBlob(t).includes(key))
  }, [query])

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

  const visible = useMemo(
    () =>
      scoped.filter(
        (t) =>
          (cat === 'all' || t.category === cat) &&
          (exec === 'all' || t.execType === exec) &&
          (inputKind === 'all' || t.inputKinds.includes(inputKind)) &&
          (impl === 'all' || t.impl === impl) &&
          t.complexity <= maxComplexity &&
          (previewKind === 'all' || (previewKind === 'motion' ? !!t.previewVideo : !t.previewVideo)),
      ),
    [scoped, cat, exec, inputKind, impl, maxComplexity, previewKind],
  )

  const current = selectedId ? FX_TECHNIQUES.find((t) => t.id === selectedId) ?? null : null

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
  const activeCount = techActiveCount + (cat !== 'all' ? 1 : 0)

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
  }

  function resetAll() {
    resetTechFilters()
    setCat('all')
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

  /** 抽屉：Esc 关闭 + 焦点圈在抽屉内；打开时焦点落在关闭键 */
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDrawer()
        return
      }
      if (e.key !== 'Tab') return
      const el = drawerRef.current
      if (!el) return
      const nodes = [...el.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )]
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    window.requestAnimationFrame(() => closeRef.current?.focus())
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    { id: 'favorites', label: '收藏', count: counts.favorites, icon: <Star size={12} aria-hidden="true" /> },
    { id: 'recent', label: '最近使用', count: counts.recent, icon: <Clock size={12} aria-hidden="true" /> },
  ]

  return (
    <div className="fxlib">
      <section className="fx-panel" aria-label="特效技法库" inert={drawerOpen || workflowFor ? true : undefined}>
        <div className="fx-cmd">
          <div className="fx-heading-group"><h1 className="fx-cmd-title">特效技法库</h1></div>
          {!pick.active && <PickButton onClick={pick.enter} label="特效" />}
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
          <div className="fx-cmd-search">
            <SearchField
              inputRef={searchRef}
              value={query}
              onChange={setQuery}
              placeholder="搜索名称、用途或实现方式"
              shortcutHint="/"
              ariaLabel="搜索技法"
            />
          </div>
          <div className="fx-filterwrap">
            <button
              type="button"
              className="fx-toolbtn"
              aria-expanded={filtersOpen}
              data-on={filtersOpen || activeCount > 0 ? '' : undefined}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <SlidersHorizontal size={14} strokeWidth={2} />
              筛选
              {activeCount > 0 && <b className="fx-badge num">{activeCount}</b>}
              <ChevronDown size={13} strokeWidth={2} className={filtersOpen ? 'fx-chev is-open' : 'fx-chev'} />
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
              <button type="button" aria-label="移除分类筛选" onClick={() => setCat('all')}><X size={11} strokeWidth={2.4} /></button>
            </span>
          )}
          {exec !== 'all' && (
            <span className="fx-activechip">
              能力 · {execLabel(exec)}
              <button type="button" aria-label="移除能力筛选" onClick={() => setExec('all')}><X size={11} strokeWidth={2.4} /></button>
            </span>
          )}
          {previewKind !== 'all' && (
            <span className="fx-activechip">
              预览 · {previewKind === 'motion' ? '有动态预览' : '静态海报'}
              <button type="button" aria-label="移除预览类型筛选" onClick={() => setPreviewKind('all')}><X size={11} strokeWidth={2.4} /></button>
            </span>
          )}
          {impl !== 'all' && (
            <span className="fx-activechip">
              实现 · {implLabel(impl)}
              <button type="button" aria-label="移除实现方式筛选" onClick={() => setImpl('all')}><X size={11} strokeWidth={2.4} /></button>
            </span>
          )}
          {inputKind !== 'all' && (
            <span className="fx-activechip">
              输入 · {inputLabel(inputKind)}
              <button type="button" aria-label="移除输入素材筛选" onClick={() => setInputKind('all')}><X size={11} strokeWidth={2.4} /></button>
            </span>
          )}
          {maxComplexity < 5 && (
            <span className="fx-activechip">
              复杂度 ≤ {maxComplexity}
              <button type="button" aria-label="移除复杂度筛选" onClick={() => setMaxComplexity(5)}><X size={11} strokeWidth={2.4} /></button>
            </span>
          )}
          <span className="fx-spacer" />
          {(query.trim() || activeCount > 0) && <span className="fx-result-summary" role="status">找到 {visible.length} 项技法</span>}

          <label className="fx-sort">
            <ArrowUpDown size={12} strokeWidth={2} aria-hidden="true" />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="排序方式">
              <option value="cat">按分类</option>
              <option value="name">名称</option>
              <option value="complexity">复杂度</option>
              <option value="updated">最近更新</option>
            </select>
          </label>
        </div>

        <div className="fx-content">
          {visible.length === 0 ? (
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
                return (
                  <article
                    key={t.id}
                    className="fxc fxc-poster"
                    data-fx-id={t.id}
                    data-added={fxInPending(t.id) || undefined}
                    data-pickmode={pick.active || undefined}
                    data-picked={(pick.active && pick.has(t.id)) || undefined}
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
                    <div className="fxc-media">
                      <SilentVideoPreview src={t.previewVideo} poster={t.previewImage}
                        active={!drawerOpen && !workflowFor} label={`${t.name} 动态预览`} />
                      {pick.active && <PickCheck checked={pick.has(t.id)} />}
                      {t.previewVideo && <span className="fxc-preview-label"><Play size={10} aria-hidden="true" />动态预览</span>}
                      {/* 加入待发送：与素材库/参考片库同一位置、同一规格 */}
                      {!pick.active && <button
                        type="button"
                        className="fxc-add"
                        data-added={fxInPending(t.id) || undefined}
                        aria-label={fxInPending(t.id) ? `${t.name} 已在待发送` : `把 ${t.name} 加入待发送`}
                        title={fxInPending(t.id) ? '已在待发送' : '加入待发送'}
                        onClick={(e) => { e.stopPropagation(); addFxToPending([t]) }}
                      >
                        {fxInPending(t.id) ? <Check size={14} strokeWidth={2.4} /> : <Plus size={14} strokeWidth={2.4} />}
                      </button>}
                      <button
                        type="button"
                        className="fxc-fav"
                        data-on={fav ? '' : undefined}
                        aria-pressed={fav}
                        aria-label={fav ? `取消收藏 ${t.name}` : `收藏 ${t.name}`}
                        onClick={() => toggleFavorite(t.id)}
                      >
                        <Star size={14} strokeWidth={2} fill={fav ? 'currentColor' : 'none'} />
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
                        <span>{execLabel(t.execType)}</span>
                        <span className="fxc-inputs">{t.inputLabels.join(' / ')}</span>
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
              const list = ids.map((id) => FX_TECHNIQUES.find((x) => x.id === id)).filter((x): x is FxTechnique => !!x)
              addFxToPending(list)
            })}
          />
        )}
      </section>

      {/* ── 详情抽屉：预览 → 用途 → 实现方法 → 参数 → 调用方式 ── */}
      {drawerOpen && current && (
        <div
          className="fx-scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDrawer()
          }}
        >
          <aside
            ref={drawerRef}
            className="fx-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fx-drawer-title"
          >
            <div className="fx-drawer-scroll">
              <div className="fx-preview">
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
                    {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                  </button>
                )}
                <button
                  ref={closeRef}
                  type="button"
                  className="fx-drawer-close"
                  onClick={closeDrawer}
                  aria-label="关闭技法详情"
                  title="关闭（Esc）"
                >
                  <X size={15} aria-hidden="true" />
                </button>
                <span className={`fx-cap fx-cap-${current.execType} fx-preview-cap`} title={FX_EXEC_TYPES[current.execType].hint}>
                  {current.execLabel}
                </span>
                {current.previewCaption && <span className="fx-preview-caption">{current.previewCaption}</span>}
              </div>

              <div className="fx-drawer-body">
                <div className="fx-drawer-title">
                  <h2 id="fx-drawer-title">{current.name}</h2>
                  <span>{current.nameEn}</span>
                  {current.featured && (
                    <em className="fx-featured">
                      源库精选
                    </em>
                  )}
                  <button
                    type="button"
                    className="fx-favbtn"
                    data-on={lib.favorites.includes(current.id) ? '' : undefined}
                    aria-pressed={lib.favorites.includes(current.id)}
                    onClick={() => toggleFavorite(current.id)}
                  >
                    <Star
                      size={12}
                      fill={lib.favorites.includes(current.id) ? 'currentColor' : 'none'}
                      aria-hidden="true"
                    />
                    {lib.favorites.includes(current.id) ? '已收藏' : '收藏'}
                  </button>
                </div>
                <p className="fx-detail-intent">{current.intent}</p>

                {/* 去 AI 味：能力 pill 与说明句重复，合成一行普通文字；分类放进这行，不再与英文名用“·”拼标题 */}
                <p className="fx-detail-capline">
                  {current.categoryLabel} · {current.execLabel}：{FX_EXEC_TYPES[current.execType].hint}
                </p>

                <section className="fx-dsec">
                  <h3 className="fx-label">用途</h3>
                  <p className="fx-use-line"><b>适用</b>{current.scenes.join('、')}</p>
                  <p className="fx-use-line"><b>不适用</b>{current.antiScenes.join('、')}</p>
                </section>

                <section className="fx-dsec">
                  <h3 className="fx-label">实现方法</h3>
                  <ol className="fx-steps">
                    {current.steps.map((s, i) => (
                      <li key={i}>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                  <dl className="fx-io">
                    <div><dt>实现方式</dt><dd>{current.implLabel}</dd></div>
                    <div><dt>复杂度</dt><dd className="num">{current.complexity} / 5</dd></div>
                    {current.dependencies.length > 0 && (
                      <div><dt>依赖</dt><dd>{current.dependencies.join('；')}</dd></div>
                    )}
                    {current.compatibility.length > 0 && (
                      <div><dt>兼容</dt><dd>{current.compatibility.join('；')}</dd></div>
                    )}
                  </dl>
                </section>

                {current.limitations.length > 0 && (
                  <section className="fx-dsec">
                    <h3 className="fx-label">已知限制</h3>
                    <ul className="fx-bullets fx-bullets-warn">
                      {current.limitations.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                    {current.failures.length > 0 && (
                      <>
                        <p className="fx-subhead">常见失败</p>
                        <ul className="fx-bullets">
                          {current.failures.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </section>
                )}

                <section className="fx-dsec">
                  <h3 className="fx-label">参数</h3>
                  <ul className="fx-params">
                    {current.params.map((p) => (
                      <li key={p.key}>
                        <span>{p.label}</span>
                        <b className="num">{p.value}</b>
                        {p.hint && <em title={p.hint}>{p.hint}</em>}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="fx-dsec">
                  <h3 className="fx-label">调用方式</h3>
                  <dl className="fx-io">
                    <div><dt>输入</dt><dd>{current.inputRequirement || '—'}</dd></div>
                    <div><dt>输出</dt><dd>{current.output || '—'}</dd></div>
                  </dl>
                  <div className="fx-callacts">
                    <button type="button" className="fx-btn fx-btn-primary" onClick={copyRecipe}>
                      {copied === 'ok' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                      {copied === 'ok' ? '已复制配方' : copied === 'fail' ? '复制失败' : '复制配方'}
                    </button>
                    <button type="button" className="fx-btn" onClick={() => setWorkflowFor(current)}>
                      <Workflow size={13} aria-hidden="true" />
                      用于工作流
                    </button>
                  </div>
                  <p className="fx-actions-note">
                    <Info size={11} aria-hidden="true" />
                    复制的是配方文本（参数 + 制作步骤 + 调用配置）。执行与工作流插入尚未接入，选目标只记意向。
                  </p>
                </section>

                {(current.related.length > 0 || current.alternatives.length > 0) && (
                  <section className="fx-dsec">
                    <h3 className="fx-label">相关技法</h3>
                    <div className="fx-related">
                      {[...current.related, ...current.alternatives].map((id) => {
                        const rel = FX_TECHNIQUES.find((t) => t.id === id)
                        if (!rel) return null
                        return (
                          <button
                            key={id}
                            type="button"
                            className="fx-relchip"
                            onClick={() => openDrawer(id)}
                          >
                            {rel.name}
                            <ChevronRight size={11} aria-hidden="true" />
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )}

                <div className="fx-source">
                  <span className="num">v{current.version}</span>
                  <span>更新 {current.updatedAt}</span>
                  <span className="num">{current.id}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

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
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <p className="fx-dialog-note">
              <Info size={12} aria-hidden="true" />
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
                  <ChevronRight size={13} aria-hidden="true" />
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

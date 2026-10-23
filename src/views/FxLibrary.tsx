import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Copy,
  Info,
  LayoutGrid,
  Pause,
  Play,
  RotateCcw,
  Rows3,
  SlidersHorizontal,
  Sparkles,
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
import { PROJECTS, STAGE_LABEL } from '@/data/projects'
import { EmptyState } from '@/components/fm/EmptyState'
import { PageHeader } from '@/components/PageHeader'
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

const LIB_KEY = 'fm-fx-library-v1'
const OUTBOX_KEY = 'fm-fx-usage-outbox-v1'

type SortKey = 'cat' | 'name' | 'complexity' | 'updated'
type Scope = 'all' | 'featured' | 'favorites' | 'recent'
/** 排版选版中：三种布局语法同页切换，用户定版后收敛为一种 */
type Mode = 'cinema' | 'gallery' | 'shelves'

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
  const [sort, setSort] = useState<SortKey>('cat')
  const [mode, setMode] = useState<Mode>('cinema')
  const [stageId, setStageId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
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
          t.complexity <= maxComplexity,
      ),
    [scoped, cat, exec, inputKind, impl, maxComplexity],
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

  const groups = useMemo(() => {
    if (sort !== 'cat') return [{ id: 'flat', label: '结果', items: sorted }]
    return FX_CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      items: sorted.filter((t) => t.category === c.id),
    })).filter((g) => g.items.length > 0)
  }, [sorted, sort])

  /** 影院版舞台当前技法：跟随筛选结果，选中的不在结果内时回落第一项 */
  const stage = useMemo(() => {
    if (visible.length === 0) return null
    return visible.find((t) => t.id === stageId) ?? visible[0]
  }, [visible, stageId])

  function stepStage(dir: 1 | -1) {
    if (!stage || visible.length < 2) return
    const at = visible.findIndex((t) => t.id === stage.id)
    const next = visible[(at + dir + visible.length) % visible.length]
    setStageId(next.id)
    pushRecent(next.id)
  }

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
    (maxComplexity < 5 ? 1 : 0)
  const activeCount = techActiveCount + (cat !== 'all' ? 1 : 0)

  const lastUpdated = useMemo(() => FX_TECHNIQUES.map((t) => t.updatedAt).sort().at(-1) ?? '', [])
  const playing = current !== null && playingId === current.id

  function resetTechFilters() {
    setExec('all')
    setInputKind('all')
    setImpl('all')
    setMaxComplexity(5)
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

  /** 影院版：←/→ 切舞台技法（抽屉/弹窗打开时不劫持） */
  useEffect(() => {
    if (mode !== 'cinema' || drawerOpen || workflowFor) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      if (e.key === 'ArrowRight') { e.preventDefault(); stepStage(1) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepStage(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
    { id: 'featured', label: '精选', count: counts.featured, icon: <Sparkles size={12} aria-hidden="true" /> },
    { id: 'favorites', label: '收藏', count: counts.favorites, icon: <Star size={12} aria-hidden="true" /> },
    { id: 'recent', label: '最近使用', count: counts.recent, icon: <Clock size={12} aria-hidden="true" /> },
  ]

  return (
    <div className="fxlib">
      <section className="fx-panel" aria-label="特效技法库" inert={drawerOpen || workflowFor ? true : undefined}>
        <PageHeader
          title="特效技法库"
          meta={
            <>
              视频视觉技法 · 源库 <b className="num">{FX_TECHNIQUES.length}</b> 项 ·{' '}
              <b className="num">{FX_CATEGORIES.length}</b> 类
            </>
          }
          actions={
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="搜索技法 / 意图 / 场景 / 别名"
              ariaLabel="搜索技法"
              onClear={() => setQuery('')}
              inputRef={searchRef}
              shortcutHint="/"
            />
          }
        />

        <div className="fx-toolbar">
          <div className="fx-scope" role="tablist" aria-label="范围">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={scope === s.id}
                className="fx-scope-btn"
                data-on={scope === s.id ? '' : undefined}
                onClick={() => setScope(s.id)}
              >
                {s.icon}
                {s.label}
                <em className="num">{s.count}</em>
              </button>
            ))}
          </div>

          <span className="fx-spacer" />

          <button
            type="button"
            className="fx-toolbtn"
            aria-expanded={filtersOpen}
            data-on={filtersOpen || techActiveCount > 0 ? '' : undefined}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal size={13} aria-hidden="true" />
            更多筛选
            {techActiveCount > 0 && <b className="fx-badge num">{techActiveCount}</b>}
          </button>

          <label className="fx-sort">
            <ArrowUpDown size={12} aria-hidden="true" />
            <span>排序</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="排序方式">
              <option value="cat">按分类</option>
              <option value="name">按名称</option>
              <option value="complexity">按复杂度</option>
              <option value="updated">按最近更新</option>
            </select>
          </label>

          <div className="fx-viewtoggle fx-modetoggle" role="group" aria-label="排版切换（选版中）">
            <button
              type="button"
              aria-pressed={mode === 'cinema'}
              data-on={mode === 'cinema' ? '' : undefined}
              onClick={() => setMode('cinema')}
              title="影院：全幅预览 + 底部片单"
            >
              <Clapperboard size={13} aria-hidden="true" />
              影院
            </button>
            <button
              type="button"
              aria-pressed={mode === 'gallery'}
              data-on={mode === 'gallery' ? '' : undefined}
              onClick={() => setMode('gallery')}
              title="画册：海报墙大图网格"
            >
              <LayoutGrid size={13} aria-hidden="true" />
              画册
            </button>
            <button
              type="button"
              aria-pressed={mode === 'shelves'}
              data-on={mode === 'shelves' ? '' : undefined}
              onClick={() => setMode('shelves')}
              title="货架：精选横幅 + 分类横滚行"
            >
              <Rows3 size={13} aria-hidden="true" />
              货架
            </button>
          </div>
        </div>

        <div className="fx-cats" aria-label="按分类筛选">
          <button
            type="button"
            className="fx-cat-tab"
            aria-pressed={cat === 'all'}
            onClick={() => setCat('all')}
          >
            全部 <em className="num">{searched.length}</em>
          </button>
          {CATEGORY_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="fx-cat-tab"
              aria-pressed={cat === id}
              onClick={() => setCat(id)}
            >
              {FX_CATEGORIES.find((c) => c.id === id)?.label}{' '}
              <em className="num">{counts.category.get(id) ?? 0}</em>
            </button>
          ))}
          <span className="fx-tab-total">
            当前 <b className="num">{visible.length}</b> / {FX_TECHNIQUES.length}
          </span>
        </div>

        {techActiveCount > 0 && (
          <div className="fx-activechips" aria-label="已选技术筛选">
            <span className="fx-activechips-label">已选</span>
            {exec !== 'all' && (
              <button type="button" className="fx-activechip" onClick={() => setExec('all')}>
                执行：{FX_EXEC_TYPES[exec].label} <X size={11} aria-hidden="true" />
              </button>
            )}
            {inputKind !== 'all' && (
              <button type="button" className="fx-activechip" onClick={() => setInputKind('all')}>
                输入：{FX_INPUT_TYPES[inputKind]} <X size={11} aria-hidden="true" />
              </button>
            )}
            {impl !== 'all' && (
              <button type="button" className="fx-activechip" onClick={() => setImpl('all')}>
                实现：{FX_IMPLS[impl]} <X size={11} aria-hidden="true" />
              </button>
            )}
            {maxComplexity < 5 && (
              <button type="button" className="fx-activechip" onClick={() => setMaxComplexity(5)}>
                复杂度 ≤{maxComplexity} <X size={11} aria-hidden="true" />
              </button>
            )}
            <button type="button" className="fx-textbtn" onClick={resetTechFilters}>
              清除全部
            </button>
          </div>
        )}

        {filtersOpen && (
          <div className="fx-morefilters" aria-label="更多筛选">
            <div className="fx-filtergroup">
              <span className="fx-filterlabel">执行状态</span>
              <div className="fx-chips">
                <button type="button" className="fx-chip" aria-pressed={exec === 'all'} onClick={() => setExec('all')}>
                  全部
                </button>
                {EXEC_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="fx-chip"
                    aria-pressed={exec === id}
                    title={FX_EXEC_TYPES[id].hint}
                    onClick={() => setExec(exec === id ? 'all' : id)}
                  >
                    <i className={`fx-dot fx-dot-${id}`} aria-hidden="true" />
                    {FX_EXEC_TYPES[id].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="fx-filtergroup">
              <span className="fx-filterlabel">输入</span>
              <div className="fx-chips">
                <button type="button" className="fx-chip" aria-pressed={inputKind === 'all'} onClick={() => setInputKind('all')}>
                  全部
                </button>
                {INPUT_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="fx-chip"
                    aria-pressed={inputKind === id}
                    onClick={() => setInputKind(inputKind === id ? 'all' : id)}
                  >
                    {FX_INPUT_TYPES[id]}
                  </button>
                ))}
              </div>
            </div>
            <div className="fx-filtergroup">
              <span className="fx-filterlabel">实现</span>
              <div className="fx-chips">
                <button type="button" className="fx-chip" aria-pressed={impl === 'all'} onClick={() => setImpl('all')}>
                  全部
                </button>
                {IMPL_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="fx-chip"
                    aria-pressed={impl === id}
                    onClick={() => setImpl(impl === id ? 'all' : id)}
                  >
                    {FX_IMPLS[id]}
                  </button>
                ))}
              </div>
            </div>
            <div className="fx-filtergroup">
              <span className="fx-filterlabel">复杂度</span>
              <div className="fx-complexity" role="group" aria-label="复杂度上限">
                {COMPLEXITY_STEPS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="num"
                    aria-pressed={maxComplexity === n}
                    onClick={() => setMaxComplexity(n)}
                  >
                    ≤{n}
                  </button>
                ))}
              </div>
            </div>
            <span className="fx-spacer" />
            <button type="button" className="fx-textbtn" onClick={resetTechFilters} disabled={techActiveCount === 0}>
              <RotateCcw size={12} aria-hidden="true" />
              重置
            </button>
            <button type="button" className="fx-toolbtn" onClick={() => setFiltersOpen(false)}>
              完成
            </button>
          </div>
        )}

        <div className={mode === 'cinema' ? 'fx-content is-cinema' : 'fx-content'}>
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
          ) : mode === 'cinema' && stage ? (
            <div className="fxs">
              <div className="fxs-stage">
                <img
                  key={stage.id}
                  className="fxs-media"
                  src={stage.previewImage}
                  alt=""
                  onError={(e) => e.currentTarget.classList.add('is-broken')}
                />
                {stage.previewVideo && (
                  <video
                    key={stage.id + '-v'}
                    className="fxs-media"
                    src={stage.previewVideo}
                    poster={stage.previewImage}
                    muted
                    loop
                    playsInline
                    autoPlay
                  />
                )}
                <div className="fxs-scrim-t" aria-hidden="true" />
                <div className="fxs-scrim-b" aria-hidden="true" />
                <div className="fxs-head">
                  <span className="fxs-eyebrow">
                    {stage.categoryLabel} · {stage.execLabel} · {visible.findIndex((t) => t.id === stage.id) + 1} / {visible.length}
                  </span>
                  <h2>{stage.name}</h2>
                  <p>{stage.intent}</p>
                  <div className="fxs-chips">
                    <span className="fxs-chip">{stage.previewVideo ? '动态预览' : '静帧预览'}</span>
                    <span className="fxs-chip">复杂度 {stage.complexity}/5</span>
                    <span className="fxs-chip">{stage.implLabel}</span>
                    <span className="fxs-chip">{stage.inputLabels.join(' / ')}</span>
                    {stage.featured && <span className="fxs-chip">源库精选</span>}
                  </div>
                </div>
                <div className="fxs-actions">
                  <button
                    type="button"
                    className="fxs-act"
                    data-on={lib.favorites.includes(stage.id) ? '' : undefined}
                    aria-pressed={lib.favorites.includes(stage.id)}
                    onClick={() => toggleFavorite(stage.id)}
                  >
                    <Star size={13} fill={lib.favorites.includes(stage.id) ? 'currentColor' : 'none'} aria-hidden="true" />
                    {lib.favorites.includes(stage.id) ? '已收藏' : '收藏'}
                  </button>
                  <button type="button" className="fxs-act" onClick={() => setWorkflowFor(stage)}>
                    <Workflow size={13} aria-hidden="true" />
                    用于工作流
                  </button>
                  <button type="button" className="fxs-act fxs-act-primary" onClick={() => openDrawer(stage.id)}>
                    打开完整配方
                  </button>
                </div>
                <button type="button" className="fxs-nav fxs-nav-prev" onClick={() => stepStage(-1)} aria-label="上一个技法">
                  <ChevronLeft size={17} aria-hidden="true" />
                </button>
                <button type="button" className="fxs-nav fxs-nav-next" onClick={() => stepStage(1)} aria-label="下一个技法">
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
              </div>
              <div className="fxs-strip" aria-label="技法片单">
                {visible.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="fxs-thumb"
                    data-on={t.id === stage.id ? '' : undefined}
                    aria-pressed={t.id === stage.id}
                    onClick={() => { setStageId(t.id); pushRecent(t.id) }}
                  >
                    <span className="fxs-thumb-media">
                      <img src={t.previewImage} alt="" loading="lazy" onError={(e) => e.currentTarget.classList.add('is-broken')} />
                    </span>
                    <span className="fxs-thumb-name">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : mode === 'shelves' ? (
            <div className="fxh">
              {(() => {
                const hero = visible.find((t) => t.featured) ?? visible[0]
                return (
                  <div className="fxh-hero">
                    <img src={hero.previewImage} alt="" onError={(e) => e.currentTarget.classList.add('is-broken')} />
                    <div className="fxh-hero-shade" aria-hidden="true" />
                    <div className="fxh-hero-body">
                      <span className="fxs-eyebrow">精选 · {hero.categoryLabel} · {hero.execLabel}</span>
                      <h2>{hero.name}</h2>
                      <p>{hero.intent}</p>
                      <div className="fxh-hero-acts">
                        <button type="button" className="fx-btn fx-btn-primary" onClick={() => openDrawer(hero.id)}>
                          打开完整配方
                        </button>
                        <button type="button" className="fx-btn" onClick={() => setWorkflowFor(hero)}>
                          <Workflow size={13} aria-hidden="true" />
                          用于工作流
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })()}
              {groups.map((group) => (
                <section key={group.id} className="fxh-sec" aria-label={group.label}>
                  <h3 className="fx-group-head">
                    <span>{group.label}</span>
                    <em className="num">{group.items.length}</em>
                    <i aria-hidden="true" />
                  </h3>
                  <div className="fxh-row">
                    {group.items.map((t) => {
                      const fav = lib.favorites.includes(t.id)
                      return (
                        <article key={t.id} className="fxc fxh-card" data-fx-id={t.id}>
                          <div className="fxc-media">
                            <img src={t.previewImage} alt="" loading="lazy" decoding="async" onError={(e) => e.currentTarget.classList.add('is-broken')} />
                            <span className={`fx-cap fx-cap-${t.execType}`} title={FX_EXEC_TYPES[t.execType].hint}>
                              {t.execLabel}
                            </span>
                            <button
                              type="button"
                              className="fxc-fav"
                              data-on={fav ? '' : undefined}
                              aria-pressed={fav}
                              aria-label={fav ? `取消收藏 ${t.name}` : `收藏 ${t.name}`}
                              onClick={() => toggleFavorite(t.id)}
                            >
                              <Star size={13} fill={fav ? 'currentColor' : 'none'} aria-hidden="true" />
                            </button>
                          </div>
                          <div className="fxc-body">
                            <div className="fxc-title">
                              <b>{t.name}</b>
                              <em>{t.nameEn}</em>
                            </div>
                            <p className="fxc-intent">{t.intent}</p>
                          </div>
                          <button type="button" className="fxc-hit" aria-label={`打开 ${t.name} 详情`} onClick={() => openDrawer(t.id)} />
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.id} className="fx-group" aria-label={group.label}>
                {sort === 'cat' && (
                  <h2 className="fx-group-head">
                    <span>{group.label}</span>
                    <em className="num">{group.items.length}</em>
                    <i aria-hidden="true" />
                  </h2>
                )}
                <div className="fx-grid">
                  {group.items.map((t) => {
                    const fav = lib.favorites.includes(t.id)
                    const isPlaying = playingId === t.id
                    return (
                      <article
                        key={t.id}
                        className="fxc fxc-poster"
                        data-fx-id={t.id}
                        onMouseEnter={() => t.previewVideo && setPlayingId(t.id)}
                        onMouseLeave={() => setPlayingId((p) => (p === t.id ? null : p))}
                      >
                        <div className="fxc-media">
                          <img
                            src={t.previewImage}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={(e) => e.currentTarget.classList.add('is-broken')}
                          />
                          {isPlaying && t.previewVideo && (
                            <video
                              className="fxc-video"
                              src={t.previewVideo}
                              poster={t.previewImage}
                              muted
                              loop
                              playsInline
                              autoPlay
                              onError={() => setPlayingId(null)}
                            />
                          )}
                          <span className={`fx-cap fx-cap-${t.execType}`} title={FX_EXEC_TYPES[t.execType].hint}>
                            {t.execLabel}
                          </span>
                          <button
                            type="button"
                            className="fxc-fav"
                            data-on={fav ? '' : undefined}
                            aria-pressed={fav}
                            aria-label={fav ? `取消收藏 ${t.name}` : `收藏 ${t.name}`}
                            onClick={() => toggleFavorite(t.id)}
                          >
                            <Star size={13} fill={fav ? 'currentColor' : 'none'} aria-hidden="true" />
                          </button>
                          <span className="fxc-actions">
                            <span className="fxc-open-hint">打开详情</span>
                            <button
                              type="button"
                              className="fxc-wf"
                              onClick={() => setWorkflowFor(t)}
                            >
                              <Workflow size={12} aria-hidden="true" />
                              用于工作流
                            </button>
                          </span>
                        </div>
                        <div className="fxc-body">
                          <div className="fxc-title">
                            <b>{t.name}</b>
                            <em>{t.nameEn}</em>
                            {t.featured && <Sparkles size={11} className="fxc-spark" aria-label="源库精选" />}
                          </div>
                          <p className="fxc-intent">{t.intent}</p>
                          <div className="fxc-meta">
                            <span>{t.categoryLabel}</span>
                            <span className="fxc-dots" title={`复杂度 ${t.complexity}/5`} aria-label={`复杂度 ${t.complexity}/5`}>
                              {COMPLEXITY_STEPS.map((n) => (
                                <i key={n} data-on={n <= t.complexity ? '' : undefined} />
                              ))}
                            </span>
                            <span>{t.inputLabels.join(' / ')}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="fxc-hit"
                          aria-label={`打开 ${t.name} 详情`}
                          onClick={() => openDrawer(t.id)}
                        />
                      </article>
                    )
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <footer className="fx-status" aria-label="状态">
          <span className="fx-status-item">
            <i className="fx-dot fx-dot-ok" aria-hidden="true" />
            本地源库
          </span>
          <span className="fx-status-sep" aria-hidden="true" />
          <span className="fx-status-item">
            <b className="num">{FX_TECHNIQUES.length}</b> 项 · 可见 <b className="num">{visible.length}</b>
          </span>
          {activeCount > 0 && (
            <span className="fx-status-item">
              筛选 <b className="num">{activeCount}</b> 项
            </span>
          )}
          {query && <span className="fx-status-item">搜索 “{query}”</span>}
          <span className="fx-spacer" />
          <span className="fx-status-note">能力标签为源库元数据 · 本页不触发执行</span>
          {lastUpdated && <span className="fx-status-note num">最后更新 {lastUpdated}</span>}
        </footer>
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
                  <span>{current.nameEn} · {current.categoryLabel}</span>
                  {current.featured && (
                    <em className="fx-featured">
                      <Sparkles size={9} aria-hidden="true" />
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

                <div className="fx-detail-cap">
                  <span className={`fx-cap fx-cap-${current.execType}`} title={FX_EXEC_TYPES[current.execType].hint}>
                    {current.execLabel}
                  </span>
                  <span>{FX_EXEC_TYPES[current.execType].hint}</span>
                </div>

                <section className="fx-dsec">
                  <h3 className="fx-label">用途</h3>
                  <div className="fx-taggroup">
                    <span className="fx-taggroup-label">适用</span>
                    <div className="fx-taglist">
                      {current.scenes.map((s) => (
                        <span key={s} className="fx-tag">{s}</span>
                      ))}
                    </div>
                  </div>
                  <div className="fx-taggroup">
                    <span className="fx-taggroup-label">不适用</span>
                    <div className="fx-taglist">
                      {current.antiScenes.map((s) => (
                        <span key={s} className="fx-tag fx-tag-mute">{s}</span>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="fx-dsec">
                  <h3 className="fx-label">实现方法 <em className="num">{current.steps.length}</em></h3>
                  <ol className="fx-steps">
                    {current.steps.map((s, i) => (
                      <li key={i}>
                        <i className="num">{String(i + 1).padStart(2, '0')}</i>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                  <dl className="fx-io">
                    <div><dt>实现</dt><dd>{current.implLabel}</dd></div>
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
                    <h3 className="fx-label">已知限制 <em className="num">{current.limitations.length}</em></h3>
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
                  <h3 className="fx-label">参数 <em className="num">{current.params.length}</em></h3>
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

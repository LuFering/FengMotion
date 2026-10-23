import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ArrowUpDown,
  Check,
  ChevronRight,
  Copy,
  Info,
  Pause,
  Play,
  RotateCcw,
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
import { EmptyState } from '@/components/fm/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { SearchField } from '@/components/SearchField'

/**
 * 特效技法库 —— 技法库自己的布局，不是 Workbench 的三栏骨架。
 *
 * 结构：顶部标题/搜索 → 分类页签 → 筛选条 → 全宽技法索引（表格式行）
 *       → 点任意技法打开右侧配方抽屉（overlay，不常驻）。
 *
 * 与 Workbench 的关系：只共享 A2 云端岛屿 V3 的视觉 token（颜色/字号/圆角/阴影/动效/主题），
 * 不共享它的三栏布局、监看器、时间线或状态栏语义。
 *
 * 能力语义：可直接执行 / 可组合 / 知识参考逐字保留，但它们是**源库元数据**；
 * 本页不提供执行、渲染或插入动作，抽屉底部与状态栏写明这一点。
 */

const CATEGORY_IDS = FX_CATEGORIES.map((c) => c.id)
const EXEC_IDS = Object.keys(FX_EXEC_TYPES) as FxExecType[]
const IMPL_IDS = Object.keys(FX_IMPLS) as FxImpl[]
const INPUT_IDS = Object.keys(FX_INPUT_TYPES) as FxInputKind[]
const COMPLEXITY_STEPS = [1, 2, 3, 4, 5]

type SortKey = 'cat' | 'name' | 'complexity'

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
  const [cat, setCat] = useState<FxCategory | 'all'>('all')
  const [exec, setExec] = useState<FxExecType | 'all'>('all')
  const [inputKind, setInputKind] = useState<FxInputKind | 'all'>('all')
  const [impl, setImpl] = useState<FxImpl | 'all'>('all')
  const [maxComplexity, setMaxComplexity] = useState(5)
  const [sort, setSort] = useState<SortKey>('cat')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')

  const searchRef = useRef<HTMLInputElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const copyTimer = useRef<number | null>(null)

  /** 只应用搜索：分类/状态的计数不受其它分面影响，避免数字塌陷 */
  const searched = useMemo(() => {
    const key = query.trim().toLowerCase()
    if (!key) return FX_TECHNIQUES
    return FX_TECHNIQUES.filter((t) => searchBlob(t).includes(key))
  }, [query])

  const visible = useMemo(
    () =>
      searched.filter(
        (t) =>
          (cat === 'all' || t.category === cat) &&
          (exec === 'all' || t.execType === exec) &&
          (inputKind === 'all' || t.inputKinds.includes(inputKind)) &&
          (impl === 'all' || t.impl === impl) &&
          t.complexity <= maxComplexity,
      ),
    [searched, cat, exec, inputKind, impl, maxComplexity],
  )

  const current = selectedId ? visible.find((t) => t.id === selectedId) ?? null : null

  /** 筛选把已选技法藏起来时，收起抽屉并清掉选中，避免高亮和详情对不上 */
  useEffect(() => {
    if (selectedId && !visible.some((t) => t.id === selectedId)) {
      setSelectedId(null)
      setDrawerOpen(false)
    }
  }, [visible, selectedId])

  const sorted = useMemo(() => {
    const arr = [...visible]
    if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    if (sort === 'complexity') {
      arr.sort((a, b) => a.complexity - b.complexity || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    }
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

  const counts = useMemo(() => {
    const by = <T extends string>(get: (t: FxTechnique) => T) => {
      const map = new Map<T, number>()
      for (const t of searched) {
        const k = get(t)
        map.set(k, (map.get(k) ?? 0) + 1)
      }
      return map
    }
    return {
      category: by((t) => t.category),
      exec: by((t) => t.execType),
    }
  }, [searched])

  const activeCount =
    (cat !== 'all' ? 1 : 0) +
    (exec !== 'all' ? 1 : 0) +
    (inputKind !== 'all' ? 1 : 0) +
    (impl !== 'all' ? 1 : 0) +
    (maxComplexity < 5 ? 1 : 0)

  const lastUpdated = useMemo(() => FX_TECHNIQUES.map((t) => t.updatedAt).sort().at(-1) ?? '', [])
  const flatIndex = useMemo(() => visible.map((t) => t.id), [visible])
  const playing = current !== null && playingId === current.id

  function resetFilters() {
    setCat('all')
    setExec('all')
    setInputKind('all')
    setImpl('all')
    setMaxComplexity(5)
  }

  function resetAll() {
    resetFilters()
    setQuery('')
  }

  function openDrawer(id: string) {
    setSelectedId(id)
    setDrawerOpen(true)
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
    // closeDrawer 读取的是本次渲染的 selectedId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen])

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
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

  function moveSelection(id: string, dir: 1 | -1 | 'home' | 'end') {
    if (!flatIndex.length) return
    const at = flatIndex.indexOf(id)
    let next = at
    if (dir === 'home') next = 0
    else if (dir === 'end') next = flatIndex.length - 1
    else next = Math.max(0, Math.min(flatIndex.length - 1, at + dir))
    const nextId = flatIndex[next]
    if (!nextId) return
    setSelectedId(nextId)
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-fx-id="${nextId}"]`)?.focus()
    })
  }

  function onRowKey(e: ReactKeyboardEvent<HTMLButtonElement>, id: string) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(id, 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(id, -1) }
    else if (e.key === 'Home') { e.preventDefault(); moveSelection(id, 'home') }
    else if (e.key === 'End') { e.preventDefault(); moveSelection(id, 'end') }
  }

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

  return (
    <div className="fxlib" data-mode="dark">
      {/* 一个库面板：控件在上，索引铺满，详情走抽屉 */}
      <section className="fx-panel" aria-label="特效技法库" inert={drawerOpen ? true : undefined}>
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

        <div className="fx-tabs">
          <div className="fx-tabs-scroll" aria-label="按分类筛选">
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
                {FX_CATEGORIES.find((c) => c.id === id)?.label} <em className="num">{counts.category.get(id) ?? 0}</em>
              </button>
            ))}
          </div>
          <span className="fx-tab-total">
            当前 <b className="num">{visible.length}</b> / {FX_TECHNIQUES.length}
          </span>
        </div>

        <div className="fx-filterbar" aria-label="筛选">
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

          <button type="button" className="fx-textbtn" onClick={resetFilters} disabled={activeCount === 0}>
            <RotateCcw size={12} aria-hidden="true" />
            重置{activeCount > 0 && <b className="num"> {activeCount}</b>}
          </button>

          <span className="fx-spacer" />

          <label className="fx-sort">
            <ArrowUpDown size={12} aria-hidden="true" />
            <span>排序</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="排序方式">
              <option value="cat">按分类</option>
              <option value="name">按名称</option>
              <option value="complexity">按复杂度</option>
            </select>
          </label>
        </div>

        <div className="fx-colhead" aria-hidden="true">
          <span />
          <span>技法 / 意图</span>
          <span className="fx-col-scenes">适用场景</span>
          <span className="fx-col-input">输入</span>
          <span className="fx-col-impl">实现</span>
          <span className="fx-col-complexity">复杂度</span>
          <span>能力</span>
          <span />
        </div>

        <div className="fx-list" role="listbox" aria-label="技法列表">
          {visible.length === 0 ? (
            <EmptyState
              icon="search"
              title="没有匹配的技法"
              body="换个词，或清除分类 / 状态 / 输入 / 实现 / 复杂度筛选。"
              action={{ label: '清除搜索与筛选', onClick: resetAll }}
            />
          ) : (
            groups.map((group) => (
              <section key={group.id} className="fx-group" role="group" aria-label={group.label}>
                {sort === 'cat' && (
                  <h2 className="fx-group-head">
                    <span>{group.label}</span>
                    <em className="num">{group.items.length}</em>
                    <i aria-hidden="true" />
                  </h2>
                )}
                {group.items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={current?.id === t.id}
                    data-fx-id={t.id}
                    className="fx-row"
                    onClick={() => openDrawer(t.id)}
                    onKeyDown={(e) => onRowKey(e, t.id)}
                    title={`${t.name} · ${t.execLabel} · 复杂度 ${t.complexity}/5`}
                  >
                    <span className="fx-row-thumb">
                      <img
                        src={t.previewImage}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(e) => e.currentTarget.classList.add('is-broken')}
                      />
                      {t.previewVideo && (
                        <span className="fx-thumb-motion" aria-hidden="true">
                          <Play size={8} fill="currentColor" />
                        </span>
                      )}
                    </span>
                    <span className="fx-row-main">
                      <span className="fx-row-title">
                        <b>{t.name}</b>
                        <em>{t.nameEn}</em>
                        {t.featured && <Star size={10} className="fx-star" aria-label="源库精选" />}
                      </span>
                      <span className="fx-row-intent">{t.intent}</span>
                    </span>
                    <span className="fx-row-scenes fx-col-scenes" title={t.scenes.join(' / ')}>
                      {t.scenes.slice(0, 2).join(' · ')}
                    </span>
                    <span className="fx-row-meta fx-col-input">{t.inputLabels.join(' / ')}</span>
                    <span className="fx-row-meta fx-col-impl">{t.implLabel}</span>
                    <span
                      className="fx-row-complexity fx-col-complexity"
                      title={`复杂度 ${t.complexity}/5`}
                      aria-label={`复杂度 ${t.complexity}/5`}
                    >
                      {COMPLEXITY_STEPS.map((n) => (
                        <i key={n} data-on={n <= t.complexity ? '' : undefined} />
                      ))}
                    </span>
                    <span
                      className={`fx-cap fx-cap-${t.execType}`}
                      title={FX_EXEC_TYPES[t.execType].hint}
                    >
                      {t.execLabel}
                    </span>
                    <ChevronRight size={13} className="fx-row-chev" aria-hidden="true" />
                  </button>
                ))}
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

      {/* ── 配方抽屉（overlay，不常驻）──────────────────────── */}
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
                    onClick={() => setPlayingId((p) => (current && p === current.id ? null : current?.id ?? null))}
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
                <span
                  className={`fx-cap fx-cap-${current.execType} fx-preview-cap`}
                  title={FX_EXEC_TYPES[current.execType].hint}
                >
                  {current.execLabel}
                </span>
                {current.previewCaption && <span className="fx-preview-caption">{current.previewCaption}</span>}
              </div>

              <div className="fx-drawer-body">
                <div className="fx-drawer-title" aria-live="polite">
                  <h2 id="fx-drawer-title">{current.name}</h2>
                  <span>{current.nameEn} · {current.categoryLabel}</span>
                  {current.featured && (
                    <em className="fx-featured">
                      <Star size={9} aria-hidden="true" />
                      源库精选
                    </em>
                  )}
                </div>
                <p className="fx-detail-intent">{current.intent}</p>

                <div className="fx-detail-cap">
                  <span
                    className={`fx-cap fx-cap-${current.execType}`}
                    title={FX_EXEC_TYPES[current.execType].hint}
                  >
                    {current.execLabel}
                  </span>
                  <span>{FX_EXEC_TYPES[current.execType].hint}</span>
                </div>

                <section className="fx-dsec">
                  <h3 className="fx-label">适用 / 不适用</h3>
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
                  <h3 className="fx-label">输入 / 输出</h3>
                  <dl className="fx-io">
                    <div><dt>输入</dt><dd>{current.inputRequirement || '—'}</dd></div>
                    <div><dt>输出</dt><dd>{current.output || '—'}</dd></div>
                    <div><dt>实现</dt><dd>{current.implLabel}</dd></div>
                    <div><dt>复杂度</dt><dd className="num">{current.complexity} / 5</dd></div>
                  </dl>
                </section>

                <section className="fx-dsec">
                  <h3 className="fx-label">制作步骤 <em className="num">{current.steps.length}</em></h3>
                  <ol className="fx-steps">
                    {current.steps.map((s, i) => (
                      <li key={i}>
                        <i className="num">{String(i + 1).padStart(2, '0')}</i>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                </section>

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

                {(current.dependencies.length > 0 || current.compatibility.length > 0) && (
                  <section className="fx-dsec">
                    <h3 className="fx-label">前置 / 交付</h3>
                    <ul className="fx-bullets">
                      {current.dependencies.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                      {current.compatibility.map((s) => (
                        <li key={s} className="fx-bullet-dim">{s}</li>
                      ))}
                    </ul>
                  </section>
                )}

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

                <div className="fx-source">
                  <span className="num">v{current.version}</span>
                  <span>更新 {current.updatedAt}</span>
                  <span className="num">{current.id}</span>
                </div>
              </div>
            </div>

            <div className="fx-actions">
              <button type="button" className="fx-btn fx-btn-primary" onClick={copyRecipe}>
                {copied === 'ok' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                {copied === 'ok' ? '已复制配方' : copied === 'fail' ? '复制失败' : '复制配方'}
              </button>
              <button
                type="button"
                className="fx-btn"
                disabled
                title="工作流插入尚未接入；本页不会执行、渲染或插入任何内容"
              >
                <Workflow size={13} aria-hidden="true" />
                加入工作流
              </button>
              <p className="fx-actions-note">
                <Info size={11} aria-hidden="true" />
                只读源库；执行与工作流插入尚未接入。
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

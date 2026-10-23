import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ANALYSIS_FIELDS,
  REFERENCE_COLLECTIONS,
  REFERENCE_SHOTS,
  REFERENCE_VIDEOS,
  STATUS_META,
  VIDEO_BY_ID,
  formatTimecode,
  type AnalysisKey,
  type ReferenceShot,
  type ReferenceStatus,
  type ReferenceVideo,
} from '@/data/referenceLibrary'
import { EmptyState } from '@/components/fm/EmptyState'

/**
 * 参考片库 —— 搜索/筛选 + 全宽镜头接触表 + 抽屉详情。
 *
 * A2「云端岛屿 V3」只提供视觉 token（颜色、字号、圆角、阴影、动效、深色主题），
 * 不照搬 Workbench 的三栏工作台骨架。参考库的主任务是“扫镜头 → 看分析”，
 * 所以详情只在选中后以抽屉浮层出现，不常驻占据左右栏。
 *
 * 口径：只展示现有演示数据；待分析字段保持「待分析」；视觉检索未接入，
 * 不提供任何假入口。
 */

type LibraryView = 'all' | 'favorites' | 'recent' | 'collections'
type Density = 'sheet' | 'table'
type SortKey = 'source' | 'timecode' | 'status'
type StatusFilter = ReferenceStatus | 'all'

interface Filters {
  scale: string
  cameraMove: string
  narrative: string
  status: StatusFilter
}

interface StoredLibrary {
  favorites: string[]
  recent: string[]
  memberships: Record<string, string[]>
}

const STORE_KEY = 'fm-reference-library-v1'
const SHOT_BY_ID = new Map(REFERENCE_SHOTS.map((shot) => [shot.id, shot]))
const SHOT_ORDER = new Map(REFERENCE_SHOTS.map((shot, index) => [shot.id, index + 1]))
const VIDEO_ORDER = new Map(REFERENCE_VIDEOS.map((video, index) => [video.id, index]))

const VIEW_ITEMS: Array<{ id: LibraryView; label: string }> = [
  { id: 'all', label: '全部镜头' },
  { id: 'favorites', label: '收藏' },
  { id: 'recent', label: '最近浏览' },
  { id: 'collections', label: '参考集合' },
]

const SORT_ITEMS: Array<{ value: SortKey; label: string }> = [
  { value: 'source', label: '按来源' },
  { value: 'timecode', label: '按时间码' },
  { value: 'status', label: '按状态' },
]

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`/assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

/** 卡片与分镜表只显示短语；完整值（含「不适用（…）」）保留在抽屉里。 */
function shortValue(value: string): string {
  const wrapped = value.match(/^不适用（(.+)）$/)
  return wrapped ? wrapped[1] : value
}

function defaultMemberships(): Record<string, string[]> {
  return Object.fromEntries(REFERENCE_COLLECTIONS.map((collection) => [collection.id, [...collection.shotIds]]))
}

function defaultStored(): StoredLibrary {
  return { favorites: [], recent: [], memberships: defaultMemberships() }
}

function readStored(): StoredLibrary {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return defaultStored()
    const parsed = JSON.parse(raw) as Partial<StoredLibrary>
    const valid = (ids: unknown) =>
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && SHOT_BY_ID.has(id)) : []
    return {
      favorites: valid(parsed.favorites),
      recent: valid(parsed.recent),
      memberships: { ...defaultMemberships(), ...(parsed.memberships ?? {}) },
    }
  } catch {
    return defaultStored()
  }
}

/** 顶部筛选控件：原生 select 承载长枚举，外观按 A2 小控件处理。 */
function FilterRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (next: string) => void
}) {
  const active = value !== 'all'
  return (
    <label className={`rfl-filter${active ? ' is-active' : ''}`} title={`${label}：${active ? value : '全部'}`}>
      <span>{label}</span>
      <span className="rfl-select">
        <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={`按${label}筛选`}>
          <option value="all">全部</option>
          {options.map((option) => (
            <option value={option} key={option}>
              {option}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" />
      </span>
    </label>
  )
}

function StatusLine({ status, pending = 0 }: { status: ReferenceStatus; pending?: number }) {
  return (
    <span className="rfl-state" data-s={status}>
      <i />
      {STATUS_META[status].label}
      {pending > 0 ? <span className="rfl-state-extra">· {pending} 项待分析</span> : null}
    </span>
  )
}

function ShotCard({
  shot,
  selected,
  onSelect,
}: {
  shot: ReferenceShot
  selected: boolean
  onSelect: (id: string) => void
}) {
  const video = VIDEO_BY_ID.get(shot.videoId)
  const scale = shot.analysis.scale
  const move = shot.analysis.cameraMove
  return (
    <button
      type="button"
      className="rfl-card"
      aria-pressed={selected}
      onClick={() => onSelect(shot.id)}
      title={`${video?.title ?? shot.videoId} · 镜头 ${shot.index + 1}`}
    >
      <span className="rfl-thumb">
        <img src={`/reference/shots/${shot.id}.webp`} alt="" loading="lazy" decoding="async" />
        <span className="rfl-thumb-idx num">{String(SHOT_ORDER.get(shot.id) ?? 0).padStart(2, '0')}</span>
        <span className="rfl-thumb-tc num">{formatTimecode(shot.start)}</span>
      </span>
      <span className="rfl-card-body">
        <span className="rfl-card-title">{video?.title ?? shot.videoId}</span>
        <span className="rfl-card-meta">
          <span>{scale.pending ? '景别待分析' : shortValue(scale.value)}</span>
          <span className="rfl-sep">·</span>
          <span className="rfl-card-move">{move.pending ? '运镜待分析' : shortValue(move.value)}</span>
        </span>
        <span className="rfl-card-foot">
          <StatusLine status={shot.status} />
          <span className="rfl-card-dur num">{shot.end - shot.start}s</span>
        </span>
      </span>
    </button>
  )
}

function ShotTable({
  shots,
  selectedId,
  onSelect,
}: {
  shots: ReferenceShot[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="rfl-table-wrap">
      <table className="rfl-table" aria-label="参考镜头分镜表">
        <thead>
          <tr>
            <th scope="col">镜头 / 来源</th>
            <th scope="col" className="rfl-col-time">
              入点
            </th>
            <th scope="col" className="rfl-col-scale">
              景别
            </th>
            <th scope="col" className="rfl-col-move">
              运镜
            </th>
            <th scope="col" className="rfl-col-narrative">
              叙事功能
            </th>
            <th scope="col" className="rfl-col-status">
              状态
            </th>
          </tr>
        </thead>
        <tbody>
          {shots.map((shot) => {
            const video = VIDEO_BY_ID.get(shot.videoId)
            const selected = shot.id === selectedId
            return (
              <tr
                key={shot.id}
                aria-selected={selected}
                tabIndex={0}
                onClick={() => onSelect(shot.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(shot.id)
                  }
                }}
              >
                <td>
                  <span className="rfl-td-main">
                    <img src={`/reference/shots/${shot.id}.webp`} alt="" loading="lazy" />
                    <span className="rfl-td-copy">
                      <b>{video?.title ?? shot.videoId}</b>
                      <em>
                        {video?.source ?? '来源未知'} · 镜头 {String(shot.index + 1).padStart(2, '0')}
                      </em>
                    </span>
                  </span>
                </td>
                <td className="num rfl-col-time">{formatTimecode(shot.start)}</td>
                <td className="rfl-col-scale">
                  {shot.analysis.scale.pending ? '待分析' : shortValue(shot.analysis.scale.value)}
                </td>
                <td className="rfl-col-move">
                  {shot.analysis.cameraMove.pending ? '待分析' : shortValue(shot.analysis.cameraMove.value)}
                </td>
                <td className="rfl-col-narrative">
                  {shot.analysis.narrative.pending ? '待分析' : shot.analysis.narrative.value}
                </td>
                <td className="rfl-col-status">
                  <StatusLine status={shot.status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function LibraryEmptyState({
  view,
  query,
  filtersActive,
  onReset,
}: {
  view: LibraryView
  query: string
  filtersActive: boolean
  onReset: () => void
}) {
  let title = '没有可用镜头'
  let body = '调整搜索或筛选后重试。'
  if (query.trim() || filtersActive) {
    title = '没有匹配的镜头'
    body = '调整搜索关键词或筛选条件，或清除后查看全部镜头。'
  } else if (view === 'favorites') {
    title = '还没有收藏镜头'
    body = '打开任意镜头详情并点击星标，收藏会出现在这里。'
  } else if (view === 'recent') {
    title = '还没有最近浏览'
    body = '打开任意镜头详情后，这里会按最近查看顺序记录。'
  } else if (view === 'collections') {
    title = '这个集合还是空的'
    body = '在镜头详情里把镜头加入集合，集合会自动更新。'
  }
  const showReset = Boolean(query.trim() || filtersActive)
  return (
    <EmptyState
      icon="film"
      title={title}
      body={body}
      action={showReset ? { label: '清除搜索与筛选', onClick: onReset } : undefined}
    />
  )
}

function ShotDrawer({
  shot,
  video,
  order,
  favorite,
  memberships,
  onClose,
  onToggleFavorite,
  onToggleMembership,
}: {
  shot: ReferenceShot
  video: ReferenceVideo
  order: number
  favorite: boolean
  memberships: Record<string, string[]>
  onClose: () => void
  onToggleFavorite: () => void
  onToggleMembership: (collectionId: string, shotId: string) => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const pending = ANALYSIS_FIELDS.filter((field) => shot.analysis[field.key].pending).length
  const analyzed = ANALYSIS_FIELDS.length - pending

  return (
    <aside
      className="rfl-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rfl-drawer-title"
      data-shot={shot.id}
    >
      <div className="rfl-drawer-hd">
        <b>镜头检查</b>
        <span className="num">#{String(order).padStart(2, '0')}</span>
        <span className="rfl-spacer" />
        <button
          type="button"
          className="rfl-iconbtn"
          aria-pressed={favorite}
          aria-label={favorite ? '取消收藏' : '收藏镜头'}
          title={favorite ? '取消收藏' : '收藏镜头'}
          onClick={onToggleFavorite}
        >
          <Icon name="star" />
        </button>
        <button
          type="button"
          className="rfl-iconbtn"
          ref={closeRef}
          aria-label="关闭镜头详情"
          title="关闭（Esc）"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </div>

      <div className="rfl-drawer-scroll">
        <div className="rfl-preview">
          <img src={`/reference/shots/${shot.id}.webp`} alt={`${video.title} 镜头 ${shot.index + 1}`} />
          <span className="rfl-preview-tc num">
            {formatTimecode(shot.start)} – {formatTimecode(shot.end)}
          </span>
        </div>

        <div className="rfl-drawer-title">
          <b id="rfl-drawer-title">{video.title}</b>
          <span>
            镜头 {String(shot.index + 1).padStart(2, '0')} · {video.source} · {video.duration}s
          </span>
        </div>
        <div className="rfl-statusline">
          <StatusLine status={shot.status} pending={pending} />
        </div>

        <section className="rfl-section">
          <div className="rfl-section-hd">
            <b>镜头语言</b>
            <span className="num">
              {analyzed}/{ANALYSIS_FIELDS.length}
            </span>
          </div>
          <dl className="rfl-fields">
            {ANALYSIS_FIELDS.map((field) => {
              const value = shot.analysis[field.key]
              return (
                <div className="rfl-field" key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>
                    <span className="rfl-field-value">
                      {value.pending ? <em>待分析</em> : value.value}
                      {!value.pending && value.confidence != null && (
                        <span className="rfl-conf num" data-low={value.confidence < 70}>
                          {value.confidence}%
                        </span>
                      )}
                    </span>
                    {value.pending ? (
                      <span className="rfl-field-ev">尚未分析</span>
                    ) : value.evidence ? (
                      <span className="rfl-field-ev">{value.evidence}</span>
                    ) : null}
                  </dd>
                </div>
              )
            })}
          </dl>
        </section>

        <section className="rfl-section">
          <div className="rfl-section-hd">
            <b>观察 · 推断 · 复用</b>
          </div>
          <div className="rfl-notes">
            <div className="rfl-note">
              <span>观察</span>
              <p>{shot.observation || '—'}</p>
            </div>
            <div className="rfl-note">
              <span>推断</span>
              <p>{shot.inference || '—'}</p>
            </div>
            <div className="rfl-note">
              <span>复用建议</span>
              <p>{shot.suggestion || '—'}</p>
            </div>
          </div>
        </section>

        <section className="rfl-section">
          <div className="rfl-section-hd">
            <b>标签</b>
          </div>
          <div className="rfl-tags">
            {shot.tags.map((tag) => (
              <span className="rfl-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </section>

        <section className="rfl-section">
          <div className="rfl-section-hd">
            <b>参考集合</b>
            <span>点击加入 / 移出</span>
          </div>
          <div className="rfl-colchips">
            {REFERENCE_COLLECTIONS.map((item) => (
              <button
                type="button"
                key={item.id}
                className="rfl-colchip"
                aria-pressed={(memberships[item.id] ?? []).includes(shot.id)}
                onClick={() => onToggleMembership(item.id, shot.id)}
                title={item.note}
              >
                {item.name}
              </button>
            ))}
          </div>
        </section>

        <section className="rfl-section">
          <div className="rfl-section-hd">
            <b>视觉相似检索</b>
            <span>未接入</span>
          </div>
          <p className="rfl-vision-note">需要后端向量服务；当前仅支持标签与语义搜索，不提供相似镜头结果。</p>
          <div className="rfl-vision-actions">
            <button type="button" disabled title="需要后端向量服务，当前未接入">
              <Icon name="image" />
              以图搜镜头
            </button>
            <button type="button" disabled title="需要后端向量服务，当前未接入">
              <Icon name="film" />
              以视频搜镜头
            </button>
          </div>
        </section>
      </div>
    </aside>
  )
}

export function RefLibrary() {
  const searchRef = useRef<HTMLInputElement>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)
  const stored = useRef<StoredLibrary | null>(null)
  if (stored.current === null) stored.current = readStored()

  const [view, setView] = useState<LibraryView>('all')
  const [collection, setCollection] = useState<string | null>(REFERENCE_COLLECTIONS[0]?.id ?? null)
  const [density, setDensity] = useState<Density>('sheet')
  const [sortKey, setSortKey] = useState<SortKey>('source')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>({
    scale: 'all',
    cameraMove: 'all',
    narrative: 'all',
    status: 'all',
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [favorites, setFavorites] = useState<string[]>(stored.current.favorites)
  const [recent, setRecent] = useState<string[]>(stored.current.recent)
  const [memberships, setMemberships] = useState<Record<string, string[]>>(stored.current.memberships)

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ favorites, recent, memberships }))
    } catch {
      /* 本地存储不可用时不影响使用 */
    }
  }, [favorites, recent, memberships])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (drawerOpen) {
          event.preventDefault()
          setDrawerOpen(false)
          requestAnimationFrame(() => lastFocusRef.current?.focus())
          return
        }
        if (document.activeElement === searchRef.current) {
          setQuery('')
          searchRef.current?.blur()
        }
        return
      }
      if (event.key === '/' && !drawerOpen) {
        const target = event.target as HTMLElement | null
        if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const statusCounts = useMemo(() => {
    const counts = { analyzed: 0, partial: 0, pending: 0 }
    for (const shot of REFERENCE_SHOTS) counts[shot.status] += 1
    return counts
  }, [])

  const filterOptions = useMemo(() => {
    const collect = (key: AnalysisKey) =>
      Array.from(
        new Set(
          REFERENCE_SHOTS.map((shot) => shot.analysis[key].value).filter(
            (value) => value !== '待分析' && value.trim().length > 0,
          ),
        ),
      ).sort((a, b) => a.localeCompare(b, 'zh-CN'))
    return {
      scale: collect('scale'),
      cameraMove: collect('cameraMove'),
      narrative: collect('narrative'),
    }
  }, [])

  const activeFilterCount = [filters.scale, filters.cameraMove, filters.narrative, filters.status].filter(
    (value) => value !== 'all',
  ).length

  const visibleShots = useMemo(() => {
    let list: ReferenceShot[] = REFERENCE_SHOTS.slice()
    if (view === 'favorites') {
      list = list.filter((shot) => favoriteSet.has(shot.id))
    } else if (view === 'recent') {
      list = recent.map((id) => SHOT_BY_ID.get(id)).filter((shot): shot is ReferenceShot => Boolean(shot))
    } else if (view === 'collections') {
      const ids = collection ? memberships[collection] ?? [] : []
      list = list.filter((shot) => ids.includes(shot.id))
    }

    const needle = query.trim().toLowerCase()
    if (needle) {
      list = list.filter((shot) => {
        const video = VIDEO_BY_ID.get(shot.videoId)
        const haystack = [
          video?.title,
          video?.description,
          video?.source,
          shot.observation,
          shot.inference,
          shot.suggestion,
          ...shot.tags,
          ...Object.values(shot.analysis).map((value) => value.value),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(needle)
      })
    }

    if (filters.scale !== 'all') list = list.filter((shot) => shot.analysis.scale.value === filters.scale)
    if (filters.cameraMove !== 'all') {
      list = list.filter((shot) => shot.analysis.cameraMove.value === filters.cameraMove)
    }
    if (filters.narrative !== 'all') {
      list = list.filter((shot) => shot.analysis.narrative.value === filters.narrative)
    }
    if (filters.status !== 'all') list = list.filter((shot) => shot.status === filters.status)

    const statusOrder: Record<ReferenceStatus, number> = { analyzed: 0, partial: 1, pending: 2 }
    list.sort((a, b) => {
      if (sortKey === 'timecode') {
        return (
          a.start - b.start ||
          (VIDEO_ORDER.get(a.videoId) ?? 0) - (VIDEO_ORDER.get(b.videoId) ?? 0)
        )
      }
      if (sortKey === 'status') {
        return (
          statusOrder[a.status] - statusOrder[b.status] ||
          (VIDEO_ORDER.get(a.videoId) ?? 0) - (VIDEO_ORDER.get(b.videoId) ?? 0)
        )
      }
      return (
        (VIDEO_ORDER.get(a.videoId) ?? 0) - (VIDEO_ORDER.get(b.videoId) ?? 0) || a.index - b.index
      )
    })
    return list
  }, [favoriteSet, filters, memberships, query, recent, sortKey, view, collection])

  const selectedShot = selectedId ? SHOT_BY_ID.get(selectedId) ?? null : null
  const selectedVideo = selectedShot ? VIDEO_BY_ID.get(selectedShot.videoId) : null
  const activeCollection = REFERENCE_COLLECTIONS.find((item) => item.id === collection) ?? null

  function selectShot(id: string) {
    if (document.activeElement instanceof HTMLElement) lastFocusRef.current = document.activeElement
    setSelectedId(id)
    setDrawerOpen(true)
    setRecent((previous) => [id, ...previous.filter((item) => item !== id)].slice(0, 10))
  }

  function closeDrawer() {
    setDrawerOpen(false)
    requestAnimationFrame(() => lastFocusRef.current?.focus())
  }

  function openView(next: LibraryView) {
    setView(next)
    if (next === 'collections' && !collection) setCollection(REFERENCE_COLLECTIONS[0]?.id ?? null)
  }

  function clearFilters() {
    setQuery('')
    setFilters({ scale: 'all', cameraMove: 'all', narrative: 'all', status: 'all' })
  }

  function toggleFavorite(id: string) {
    setFavorites((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]))
  }

  function toggleMembership(collectionId: string, shotId: string) {
    setMemberships((previous) => {
      const current = previous[collectionId] ?? []
      const next = current.includes(shotId) ? current.filter((id) => id !== shotId) : [...current, shotId]
      return { ...previous, [collectionId]: next }
    })
  }

  const viewTitle =
    view === 'all'
      ? '全部镜头'
      : view === 'favorites'
        ? '收藏'
        : view === 'recent'
          ? '最近浏览'
          : activeCollection?.name ?? '参考集合'

  return (
    <div className="rfl" data-mode="dark">
      <div className="rfl-page" inert={drawerOpen}>
        <header className="rfl-head">
          <div className="rfl-brand">
            <span className="rfl-brand-mark">
              <Icon name="film" />
            </span>
            <span className="rfl-brand-copy">
              <b>参考片库</b>
              <span>
                {REFERENCE_SHOTS.length} 镜头 · {REFERENCE_VIDEOS.length} 部参考片
              </span>
            </span>
          </div>

          <label className="rfl-search">
            <Icon name="search" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索镜头、运镜、叙事功能…"
              aria-label="搜索参考镜头"
              spellCheck={false}
            />
            {query ? (
              <button type="button" className="rfl-search-clear" onClick={() => setQuery('')} aria-label="清空搜索">
                <Icon name="x" />
              </button>
            ) : (
              <kbd className="rfl-kbd">/</kbd>
            )}
          </label>

          <span className="rfl-chip is-off" title="需要后端向量服务，当前未接入">
            <Icon name="scan-face" />
            视觉检索未接入
          </span>
        </header>

        <section className="rfl-toolbar" aria-label="浏览范围与筛选">
          <div className="rfl-toolbar-main">
            <nav className="rfl-views" aria-label="资料库视图">
              {VIEW_ITEMS.map((item) => {
                const count =
                  item.id === 'all'
                    ? REFERENCE_SHOTS.length
                    : item.id === 'favorites'
                      ? favorites.length
                      : item.id === 'recent'
                        ? recent.length
                        : REFERENCE_COLLECTIONS.length
                return (
                  <button
                    type="button"
                    key={item.id}
                    className="rfl-view"
                    aria-pressed={view === item.id}
                    onClick={() => openView(item.id)}
                  >
                    <span>{item.label}</span>
                    <em className="num">{count}</em>
                  </button>
                )
              })}
            </nav>

            <span className="rfl-spacer" />

            <div className="rfl-seg" role="group" aria-label="视图密度">
              <button
                type="button"
                aria-pressed={density === 'sheet'}
                onClick={() => setDensity('sheet')}
                title="胶片接触表"
              >
                <Icon name="layout-grid" />
                胶片
              </button>
              <button
                type="button"
                aria-pressed={density === 'table'}
                onClick={() => setDensity('table')}
                title="分镜表"
              >
                <Icon name="list" />
                列表
              </button>
            </div>

            <label className="rfl-sort" title="排序">
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                aria-label="排序方式"
              >
                {SORT_ITEMS.map((item) => (
                  <option value={item.value} key={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" />
            </label>
          </div>

          <div className="rfl-toolbar-filters">
            <span className="rfl-filter-caption">筛选</span>
            <FilterRow
              label="景别"
              value={filters.scale}
              options={filterOptions.scale}
              onChange={(next) => setFilters((previous) => ({ ...previous, scale: next }))}
            />
            <FilterRow
              label="运镜"
              value={filters.cameraMove}
              options={filterOptions.cameraMove}
              onChange={(next) => setFilters((previous) => ({ ...previous, cameraMove: next }))}
            />
            <FilterRow
              label="故事功能"
              value={filters.narrative}
              options={filterOptions.narrative}
              onChange={(next) => setFilters((previous) => ({ ...previous, narrative: next }))}
            />
            <label className={`rfl-filter${filters.status !== 'all' ? ' is-active' : ''}`} title="按分析状态筛选">
              <span>分析状态</span>
              <span className="rfl-select">
                <select
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((previous) => ({ ...previous, status: event.target.value as StatusFilter }))
                  }
                  aria-label="按分析状态筛选"
                >
                  <option value="all">全部</option>
                  <option value="analyzed">已分析 ({statusCounts.analyzed})</option>
                  <option value="partial">部分分析 ({statusCounts.partial})</option>
                  <option value="pending">待分析 ({statusCounts.pending})</option>
                </select>
                <Icon name="chevron-down" />
              </span>
            </label>
            {activeFilterCount > 0 && (
              <button type="button" className="rfl-clear" onClick={clearFilters}>
                清除 {activeFilterCount}
              </button>
            )}
            <span className="rfl-spacer" />
            <span className="rfl-result" aria-live="polite">
              <b className="num">{visibleShots.length}</b> / {REFERENCE_SHOTS.length} 镜头
            </span>
          </div>

          {view === 'collections' && (
            <div className="rfl-collections-row">
              <span className="rfl-row-caption">参考集合</span>
              {REFERENCE_COLLECTIONS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="rfl-colchip"
                  aria-pressed={collection === item.id}
                  onClick={() => setCollection(item.id)}
                  title={item.note}
                >
                  {item.name}
                  <em className="num">{(memberships[item.id] ?? []).length}</em>
                </button>
              ))}
              <span className="rfl-spacer" />
              {activeCollection && <span className="rfl-row-note">{activeCollection.note}</span>}
            </div>
          )}
        </section>

        <section className="rfl-content" aria-label="镜头接触表">
          <div className="rfl-content-hd">
            <div className="rfl-content-title">
              <b>{viewTitle}</b>
              <span className="num">{visibleShots.length}</span>
            </div>
            {query.trim() && <span className="rfl-content-note">“{query.trim()}”</span>}
            {activeFilterCount > 0 && <span className="rfl-content-note">已筛选</span>}
            <span className="rfl-spacer" />
            <span className="rfl-content-hint">{density === 'sheet' ? '点击镜头查看分析' : '点击行查看分析'}</span>
          </div>

          <div className="rfl-body">
            {visibleShots.length === 0 ? (
              <LibraryEmptyState view={view} query={query} filtersActive={activeFilterCount > 0} onReset={clearFilters} />
            ) : density === 'sheet' ? (
              <div className="rfl-grid" aria-label="镜头接触表">
                {visibleShots.map((shot) => (
                  <ShotCard
                    key={shot.id}
                    shot={shot}
                    selected={shot.id === selectedId}
                    onSelect={selectShot}
                  />
                ))}
              </div>
            ) : (
              <ShotTable shots={visibleShots} selectedId={selectedId} onSelect={selectShot} />
            )}
          </div>
        </section>

        <footer className="rfl-foot" aria-label="参考片库状态">
          <span className="rfl-foot-item">
            <i className="rfl-dot" data-s="ok" />本地索引 <b className="num">{REFERENCE_SHOTS.length}</b> 镜头
          </span>
          <span className="rfl-foot-item">
            <i className="rfl-dot" data-s="analyzed" />已分析 <b className="num">{statusCounts.analyzed}</b>
          </span>
          <span className="rfl-foot-item">
            <i className="rfl-dot" data-s="partial" />部分分析 <b className="num">{statusCounts.partial}</b>
          </span>
          <span className="rfl-foot-item">
            <i className="rfl-dot" data-s="pending" />待分析 <b className="num">{statusCounts.pending}</b>
          </span>
          {visibleShots.length !== REFERENCE_SHOTS.length && (
            <span className="rfl-foot-item">
              当前 <b className="num">{visibleShots.length}</b> / {REFERENCE_SHOTS.length}
            </span>
          )}
          <span className="rfl-spacer" />
          <span className="rfl-foot-note">本地演示数据</span>
        </footer>
      </div>

      {drawerOpen && selectedShot && selectedVideo && (
        <>
          <div className="rfl-scrim" aria-hidden="true" onClick={closeDrawer} />
          <ShotDrawer
            shot={selectedShot}
            video={selectedVideo}
            order={SHOT_ORDER.get(selectedShot.id) ?? 0}
            favorite={favoriteSet.has(selectedShot.id)}
            memberships={memberships}
            onClose={closeDrawer}
            onToggleFavorite={() => toggleFavorite(selectedShot.id)}
            onToggleMembership={toggleMembership}
          />
        </>
      )}
    </div>
  )
}

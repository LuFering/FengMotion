import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ANALYSIS_FIELDS,
  REFERENCE_COLLECTIONS,
  REFERENCE_SEGMENTS,
  REFERENCE_VIDEOS,
  STATUS_META,
  VIDEO_BY_ID,
  formatTimecode,
  pendingFieldCount,
  type ReferenceSegment,
  type ReferenceStatus,
} from '@/data/referenceLibrary'

/**
 * 参考片库 —— 影院形态（2026-10-23 选型定版：三套排版语法中选「影院」）。
 *
 * 单位口径与项目一致：项目已去除「镜头」单位，本页的分析单位是**片段**
 * （参考片中一段连续时间范围），与工作台的场景以时间范围互相引用。
 *
 * 形态：画面铺满整个内容区，片单、片段段、分析全部以玻璃覆层浮在画面上，
 * 没有分栏。原页的库功能（搜索 / 字段筛选 / 收藏 / 最近 / 集合 / 排序）
 * 全部收进「片库」覆层网格，不丢功能。
 *
 * 数据口径：只展示现有演示数据；参考片没有视频文件，播放是逐帧静帧预览
 * （播放头推进 + 片段自动切换），不伪装真实视频播放；待分析字段保持
 * 「待分析」。「用作参考」把片段写入本地参考清单（localStorage outbox），
 * 工作台 AgentReference 接入后从该清单取用——当前不假装已直达工作台。
 */

type BrowseTab = 'all' | 'favorites' | 'recent' | 'collections'
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
const OUTBOX_KEY = 'fm-reference-outbox-v1'
const SEGMENT_BY_ID = new Map(REFERENCE_SEGMENTS.map((s) => [s.id, s]))
const SEGMENT_ORDER = new Map(REFERENCE_SEGMENTS.map((s, i) => [s.id, i + 1]))
const VIDEO_ORDER = new Map(REFERENCE_VIDEOS.map((v, i) => [v.id, i]))

const TAB_ITEMS: Array<{ id: BrowseTab; label: string }> = [
  { id: 'all', label: '全部片段' },
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
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

/** 网格与覆层只显示短语；完整值（含「不适用（…）」）保留在分析面板里。 */
function shortValue(value: string): string {
  const wrapped = value.match(/^不适用（(.+)）$/)
  return wrapped ? wrapped[1] : value
}

function segmentsOf(videoId: string): ReferenceSegment[] {
  return REFERENCE_SEGMENTS.filter((s) => s.videoId === videoId)
}

function defaultMemberships(): Record<string, string[]> {
  return Object.fromEntries(REFERENCE_COLLECTIONS.map((c) => [c.id, [...c.segmentIds]]))
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
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && SEGMENT_BY_ID.has(id)) : []
    return {
      favorites: valid(parsed.favorites),
      recent: valid(parsed.recent),
      memberships: { ...defaultMemberships(), ...(parsed.memberships ?? {}) },
    }
  } catch {
    return defaultStored()
  }
}

function readOutbox(): string[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && SEGMENT_BY_ID.has(id))
      : []
  } catch {
    return []
  }
}

function StatusPill({ status }: { status: ReferenceStatus }) {
  return (
    <span className="rfc-pill" data-s={status}>
      <i />
      {STATUS_META[status].label}
    </span>
  )
}

function fieldOptions(key: 'scale' | 'cameraMove' | 'narrative'): string[] {
  const seen = new Set<string>()
  for (const s of REFERENCE_SEGMENTS) {
    const a = s.analysis[key]
    if (!a.pending && a.value) seen.add(a.value)
  }
  return [...seen]
}

export function RefLibrary() {
  const [stored, setStored] = useState<StoredLibrary>(readStored)
  const [outbox, setOutbox] = useState<string[]>(readOutbox)
  const [filmId, setFilmId] = useState(REFERENCE_VIDEOS[0].id)
  const [segmentId, setSegmentId] = useState(() => segmentsOf(REFERENCE_VIDEOS[0].id)[0]?.id ?? REFERENCE_SEGMENTS[0].id)
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [collMenuOpen, setCollMenuOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [idle, setIdle] = useState(false)
  const [tab, setTab] = useState<BrowseTab>('all')
  const [collId, setCollId] = useState(REFERENCE_COLLECTIONS[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>({ scale: 'all', cameraMove: 'all', narrative: 'all', status: 'all' })
  const [sortKey, setSortKey] = useState<SortKey>('source')
  const toastTimer = useRef<number | undefined>(undefined)
  const rafRef = useRef<number>(0)
  const lastTsRef = useRef<number>(0)

  const film = VIDEO_BY_ID.get(filmId) ?? REFERENCE_VIDEOS[0]
  const filmSegments = useMemo(() => segmentsOf(film.id), [film.id])
  const segment = SEGMENT_BY_ID.get(segmentId) ?? filmSegments[0]
  const segmentIndex = filmSegments.findIndex((s) => s.id === segment?.id)

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(stored))
    } catch { /* 存储不可用时仅内存生效 */ }
  }, [stored])

  useEffect(() => {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox))
    } catch { /* 同上 */ }
  }, [outbox])

  /** 影院态控件闲置淡出：3 秒无鼠标/键盘活动后淡出头部与操作控件，活动即恢复 */
  useEffect(() => {
    let timer = 0
    const arm = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 3000)
    }
    const wake = () => {
      setIdle(false)
      arm()
    }
    arm()
    window.addEventListener('mousemove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  /** 每次激活片段记入最近浏览（去重、最近在前、上限 12）。 */
  useEffect(() => {
    if (!segment) return
    setStored((prev) => {
      if (prev.recent[0] === segment.id) return prev
      return { ...prev, recent: [segment.id, ...prev.recent.filter((id) => id !== segment.id)].slice(0, 12) }
    })
  }, [segment])

  const showToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2600)
  }

  const selectSegment = (id: string, seek = true) => {
    const seg = SEGMENT_BY_ID.get(id)
    if (!seg) return
    setPlaying(false)
    if (seg.videoId !== filmId) setFilmId(seg.videoId)
    setSegmentId(id)
    if (seek) setPos(seg.start + 0.01)
  }

  const selectFilm = (id: string) => {
    const first = segmentsOf(id)[0]
    if (!first) return
    setPlaying(false)
    setFilmId(id)
    setSegmentId(first.id)
    setPos(0)
  }

  const stepSegment = (delta: number) => {
    const next = filmSegments[Math.min(filmSegments.length - 1, Math.max(0, segmentIndex + delta))]
    if (next) selectSegment(next.id)
  }

  /* 逐帧预览播放：播放头推进，跨片段自动切换，到片尾停。 */
  useEffect(() => {
    if (!playing) return
    lastTsRef.current = performance.now()
    const tick = (now: number) => {
      const dt = (now - lastTsRef.current) / 1000
      lastTsRef.current = now
      setPos((prev) => {
        const next = prev + dt
        if (next >= film.duration) {
          setPlaying(false)
          return film.duration
        }
        const cur = filmSegments.find((s) => next >= s.start && next < s.end)
        if (cur && cur.id !== segmentId) setSegmentId(cur.id)
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, film, filmSegments, segmentId])

  /* 键盘：空格播放/暂停、←/→ 切片段、Esc 关覆层（输入框内不劫持）。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, select, textarea')) return
      if (e.key === 'Escape') {
        if (browseOpen) setBrowseOpen(false)
        else if (collMenuOpen) setCollMenuOpen(false)
        return
      }
      if (browseOpen) return
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowRight') stepSegment(1)
      else if (e.key === 'ArrowLeft') stepSegment(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const toggleFavorite = (id: string) => {
    setStored((prev) => ({
      ...prev,
      favorites: prev.favorites.includes(id) ? prev.favorites.filter((f) => f !== id) : [id, ...prev.favorites],
    }))
  }

  const toggleMembership = (collectionId: string, id: string) => {
    setStored((prev) => {
      const cur = prev.memberships[collectionId] ?? []
      const next = cur.includes(id) ? cur.filter((m) => m !== id) : [...cur, id]
      return { ...prev, memberships: { ...prev.memberships, [collectionId]: next } }
    })
  }

  const toggleReference = (seg: ReferenceSegment) => {
    if (outbox.includes(seg.id)) {
      setOutbox(outbox.filter((id) => id !== seg.id))
      showToast('已移出参考清单')
    } else {
      setOutbox([seg.id, ...outbox])
      showToast('已加入参考清单，工作台场景可引用该片段')
    }
  }

  const browseList = useMemo(() => {
    let list = REFERENCE_SEGMENTS.slice()
    if (tab === 'favorites') list = list.filter((s) => stored.favorites.includes(s.id))
    if (tab === 'recent') list = stored.recent.map((id) => SEGMENT_BY_ID.get(id)).filter((s): s is ReferenceSegment => !!s)
    if (tab === 'collections') {
      const ids = stored.memberships[collId] ?? []
      list = list.filter((s) => ids.includes(s.id))
    }
    if (filters.status !== 'all') list = list.filter((s) => s.status === filters.status)
    if (filters.scale !== 'all') list = list.filter((s) => s.analysis.scale.value === filters.scale)
    if (filters.cameraMove !== 'all') list = list.filter((s) => s.analysis.cameraMove.value === filters.cameraMove)
    if (filters.narrative !== 'all') list = list.filter((s) => s.analysis.narrative.value === filters.narrative)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((s) => {
        const v = VIDEO_BY_ID.get(s.videoId)
        const hay = [v?.title ?? '', v?.source ?? '', ...s.tags, ...Object.values(s.analysis).map((a) => a.value)].join(' ').toLowerCase()
        return hay.includes(q)
      })
    }
    const byStatus = (s: ReferenceSegment) => ({ pending: 0, partial: 1, analyzed: 2 })[s.status]
    if (sortKey === 'source') list.sort((a, b) => (VIDEO_ORDER.get(a.videoId) ?? 0) - (VIDEO_ORDER.get(b.videoId) ?? 0) || a.start - b.start)
    if (sortKey === 'timecode') list.sort((a, b) => a.start - b.start)
    if (sortKey === 'status') list.sort((a, b) => byStatus(a) - byStatus(b))
    return list
  }, [tab, collId, filters, query, sortKey, stored])

  if (!segment) return null
  const isFav = stored.favorites.includes(segment.id)
  const inOutbox = outbox.includes(segment.id)
  const pendingCount = pendingFieldCount(segment)

  const groups = (['画面', '时间'] as const).map((g) => ({
    name: g,
    fields: ANALYSIS_FIELDS.filter((f) => f.group === g),
  }))

  return (
    <div className={idle && !browseOpen ? 'rfc is-idle' : 'rfc'}>
      <div className="rfc-stage">
        <img
          key={segment.id}
          className={`rfc-frame${playing ? ' is-playing' : ''}`}
          src={`./reference/shots/${segment.id}.webp`}
          alt=""
        />
        <div className="rfc-scrim rfc-scrim-t" />
        <div className="rfc-scrim rfc-scrim-b" />

        <header className="rfc-head">
          <div className="rfc-eyebrow">参考片库 · 片段拆解</div>
          <h1 className="rfc-title">{film.title}</h1>
          <p className="rfc-desc">{film.description}</p>
          <div className="rfc-chips">
            <span className="rfc-glass">{film.source}</span>
            <span className="rfc-glass">片段 {segment.index + 1} / {filmSegments.length}</span>
            <StatusPill status={segment.status} />
            {!segment.analysis.scale.pending && <span className="rfc-glass">{shortValue(segment.analysis.scale.value)}</span>}
            {!segment.analysis.cameraMove.pending && <span className="rfc-glass">{shortValue(segment.analysis.cameraMove.value)}</span>}
            {pendingCount > 0 && <span className="rfc-glass warn">{pendingCount} 项待分析</span>}
          </div>
        </header>

        <div className="rfc-actions">
          <button type="button" className="rfc-gbtn" onClick={() => setBrowseOpen(true)}>
            <Icon name="layout-grid" /> 片库
          </button>
          <button
            type="button"
            className={`rfc-gbtn${isFav ? ' is-on' : ''}`}
            onClick={() => toggleFavorite(segment.id)}
            aria-pressed={isFav}
            title={isFav ? '取消收藏' : '收藏片段'}
          >
            <Icon name="star" /> {isFav ? '已收藏' : '收藏'}
          </button>
          <button
            type="button"
            className={`rfc-gbtn${panelOpen ? ' is-on' : ''}`}
            onClick={() => setPanelOpen((v) => !v)}
            aria-pressed={panelOpen}
          >
            <Icon name="panel-right" /> 分析
          </button>
        </div>

        <button type="button" className="rfc-nav prev" onClick={() => stepSegment(-1)} disabled={segmentIndex <= 0} aria-label="上一片段">
          <Icon name="arrow-left" />
        </button>
        <button
          type="button"
          className="rfc-nav next"
          onClick={() => stepSegment(1)}
          disabled={segmentIndex >= filmSegments.length - 1}
          aria-label="下一片段"
        >
          <Icon name="arrow-right" />
        </button>

        {panelOpen && (
          <aside className="rfc-panel" aria-label="片段分析">
            <div className="rfc-panel-head">
              <h2>片段 {segment.index + 1}</h2>
              <StatusPill status={segment.status} />
              <span className="rfc-panel-tc num">
                {formatTimecode(segment.start)} – {formatTimecode(segment.end)} · {segment.end - segment.start}s
              </span>
            </div>
            <div className="rfc-panel-acts">
              <button type="button" className={`rfc-btn primary${inOutbox ? ' is-done' : ''}`} onClick={() => toggleReference(segment)}>
                <Icon name={inOutbox ? 'check' : 'link'} /> {inOutbox ? '已加入参考' : '用作参考'}
              </button>
              <div className="rfc-collwrap">
                <button type="button" className="rfc-btn" onClick={() => setCollMenuOpen((v) => !v)} aria-expanded={collMenuOpen}>
                  <Icon name="layers" /> 收入集合 <Icon name="chevron-down" />
                </button>
                {collMenuOpen && (
                  <div className="rfc-collmenu">
                    {REFERENCE_COLLECTIONS.map((c) => {
                      const has = (stored.memberships[c.id] ?? []).includes(segment.id)
                      return (
                        <button key={c.id} type="button" className="rfc-collitem" onClick={() => toggleMembership(c.id, segment.id)}>
                          <span className={`rfc-checkbox${has ? ' is-on' : ''}`}>{has && <Icon name="check" />}</span>
                          <span className="rfc-collname">{c.name}</span>
                          <span className="rfc-collcount num">{(stored.memberships[c.id] ?? []).length}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            {groups.map((g) => (
              <div key={g.name} className="rfc-fgroup">
                <div className="rfc-fgroup-t">{g.name}</div>
                {g.fields.map((f) => {
                  const a = segment.analysis[f.key]
                  if (a.pending) {
                    return (
                      <div key={f.key} className="rfc-field">
                        <span className="rfc-field-k">{f.label}</span>
                        <span className="rfc-field-v pend">待分析</span>
                      </div>
                    )
                  }
                  return (
                    <div key={f.key} className="rfc-field">
                      <span className="rfc-field-k">{f.label}</span>
                      <span className="rfc-field-v">{a.value}</span>
                      {a.confidence != null && (
                        <span className="rfc-conf">
                          <span className="rfc-confbar"><i style={{ width: `${a.confidence}%` }} /></span>
                          <span className="num">{a.confidence}%</span>
                        </span>
                      )}
                      {a.evidence && <span className="rfc-evidence">{a.evidence}</span>}
                    </div>
                  )
                })}
              </div>
            ))}
            <div className="rfc-notes">
              <div className="rfc-note"><div className="rfc-note-k">观察</div><p>{segment.observation}</p></div>
              <div className="rfc-note"><div className="rfc-note-k">推断</div><p>{segment.inference}</p></div>
              <div className="rfc-note"><div className="rfc-note-k">建议</div><p>{segment.suggestion}</p></div>
            </div>
            {segment.tags.length > 0 && (
              <div className="rfc-tags">
                {segment.tags.map((t) => (
                  <span key={t} className="rfc-tag">{t}</span>
                ))}
              </div>
            )}
          </aside>
        )}

        <div className="rfc-dock">
          <div className="rfc-transport">
            <button
              type="button"
              className="rfc-play"
              onClick={() => {
                if (!playing && pos >= film.duration) setPos(0)
                setPlaying((p) => !p)
              }}
              aria-label={playing ? '暂停' : '播放（逐帧预览）'}
            >
              <Icon name={playing ? 'pause' : 'play'} />
            </button>
            <span className="rfc-time num">
              {formatTimecode(pos)} / {formatTimecode(film.duration)}
            </span>
            <span className="rfc-transport-hint">逐帧预览 · 空格播放/暂停 · ←/→ 切片段</span>
            <span className="rfc-spacer" />
            <button type="button" className="rfc-gbtn" onClick={() => setBrowseOpen(true)}>
              <Icon name="search" /> 搜索与筛选
            </button>
          </div>
          <div className="rfc-segbar" role="tablist" aria-label="片段">
            {filmSegments.map((s) => {
              const fill = pos <= s.start ? 0 : pos >= s.end ? 100 : ((pos - s.start) / (s.end - s.start)) * 100
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={s.id === segment.id}
                  className={`rfc-seg${s.id === segment.id ? ' is-on' : ''}`}
                  style={{ flexGrow: s.end - s.start }}
                  onClick={() => selectSegment(s.id)}
                >
                  <span className="rfc-seg-fill" style={{ width: `${fill}%` }} />
                  <span className="rfc-seg-lb">片段 {s.index + 1}</span>
                  <span className={`rfc-seg-dot st-${s.status}`} />
                </button>
              )
            })}
          </div>
          <div className="rfc-films">
            {REFERENCE_VIDEOS.map((v) => {
              const ss = segmentsOf(v.id)
              const done = ss.filter((s) => s.status === 'analyzed').length
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`rfc-film${v.id === film.id ? ' is-on' : ''}`}
                  onClick={() => selectFilm(v.id)}
                  aria-pressed={v.id === film.id}
                >
                  <img src={`./reference/shots/${ss[0]?.id}.webp`} alt="" loading="lazy" />
                  <span className="rfc-film-lb">
                    <span className="rfc-film-t">{v.title}</span>
                    <span className="rfc-film-m num">{ss.length} 片段 · 已分析 {done}/{ss.length}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {browseOpen && (
          <div className="rfc-browse" role="dialog" aria-label="片库">
            <div className="rfc-browse-head">
              <div className="rfc-tabs">
                {TAB_ITEMS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`rfc-tab${tab === t.id ? ' is-on' : ''}`}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="rfc-browse-count num">{browseList.length} / {REFERENCE_SEGMENTS.length} 片段</span>
              <button type="button" className="rfc-gbtn" onClick={() => setBrowseOpen(false)}>
                <Icon name="x" /> 关闭
              </button>
            </div>
            <div className="rfc-browse-tools">
              <label className="rfc-search">
                <Icon name="search" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索片名、标签、分析值…"
                />
              </label>
              {(
                [
                  ['scale', '景别', fieldOptions('scale')],
                  ['cameraMove', '运镜', fieldOptions('cameraMove')],
                  ['narrative', '叙事', fieldOptions('narrative')],
                ] as const
              ).map(([key, label, options]) => (
                <label key={key} className="rfc-selfield">
                  <span>{label}</span>
                  <select
                    value={filters[key]}
                    onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                    aria-label={`按${label}筛选`}
                  >
                    <option value="all">全部</option>
                    {options.map((o) => (
                      <option key={o} value={o}>{shortValue(o)}</option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="rfc-selfield">
                <span>状态</span>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))}
                  aria-label="按状态筛选"
                >
                  <option value="all">全部</option>
                  <option value="analyzed">已分析</option>
                  <option value="partial">部分分析</option>
                  <option value="pending">待分析</option>
                </select>
              </label>
              <label className="rfc-selfield">
                <span>排序</span>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="排序">
                  {SORT_ITEMS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </label>
            </div>
            {tab === 'collections' && (
              <div className="rfc-collchips">
                {REFERENCE_COLLECTIONS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`rfc-chip${collId === c.id ? ' is-on' : ''}`}
                    onClick={() => setCollId(c.id)}
                  >
                    {c.name} · {(stored.memberships[c.id] ?? []).length}
                  </button>
                ))}
                <span className="rfc-collnote">{REFERENCE_COLLECTIONS.find((c) => c.id === collId)?.note}</span>
              </div>
            )}
            <div className="rfc-grid">
              {browseList.map((s) => {
                const v = VIDEO_BY_ID.get(s.videoId)
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`rfc-card${s.id === segment.id ? ' is-on' : ''}`}
                    onClick={() => {
                      selectSegment(s.id)
                      setBrowseOpen(false)
                    }}
                  >
                    <span className="rfc-card-thumb">
                      <img src={`./reference/shots/${s.id}.webp`} alt="" loading="lazy" />
                      <span className="rfc-card-idx num">{String(SEGMENT_ORDER.get(s.id) ?? 0).padStart(2, '0')}</span>
                      <span className="rfc-card-tc num">{formatTimecode(s.start)}</span>
                      {stored.favorites.includes(s.id) && <span className="rfc-card-fav"><Icon name="star" /></span>}
                    </span>
                    <span className="rfc-card-body">
                      <span className="rfc-card-t">{v?.title} · 片段 {s.index + 1}</span>
                      <span className="rfc-card-m">
                        {s.analysis.scale.pending ? '景别待分析' : shortValue(s.analysis.scale.value)}
                        {' · '}
                        {s.analysis.cameraMove.pending ? '运镜待分析' : shortValue(s.analysis.cameraMove.value)}
                      </span>
                      <span className="rfc-card-f">
                        <StatusPill status={s.status} />
                        <span className="num">{s.end - s.start}s</span>
                      </span>
                    </span>
                  </button>
                )
              })}
              {browseList.length === 0 && (
                <div className="rfc-empty">没有符合条件的片段，试试放宽筛选。</div>
              )}
            </div>
          </div>
        )}

        {toast && <div className="rfc-toast">{toast}</div>}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { importFiles } from '@/services/assetService'
import { setAssetDragData, usePendingAssets, type PendingRefCard } from '@/shell/usePendingAssets'
import { clearDragGhost, setDragGhost } from '@/shell/dragGhost'
import { usePickMode } from '@/shell/usePickMode'
import { PickBar, PickButton, PickCheck } from '@/shell/PickModeUI'
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
  cameraMove: string
  transition: string
  status: StatusFilter
}

interface StoredLibrary {
  favorites: string[]
  recent: string[]
  memberships: Record<string, string[]>
}

const STORE_KEY = 'fm-reference-library-v1'
const OUTBOX_KEY = 'fm-reference-outbox-v1'
/** 拖拽时按片段 ID 暂存参数包（DataTransfer 只能传字符串） */
export const REF_STASH_KEY = 'fm-ref-card-stash-v1'
const SEGMENT_BY_ID = new Map(REFERENCE_SEGMENTS.map((s) => [s.id, s]))
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

function fieldOptions(key: 'cameraMove' | 'transition'): string[] {
  const seen = new Set<string>()
  for (const s of REFERENCE_SEGMENTS) {
    const a = s.analysis[key]
    if (!a.pending && a.value) seen.add(a.value)
  }
  return [...seen]
}

export function RefLibrary() {
  const pick = usePickMode()
  const pendingStore = usePendingAssets()
  const { addRef } = pendingStore
  const refInPending = (id: string) => pendingStore.has(id)
  const [stored, setStored] = useState<StoredLibrary>(readStored)
  const [outbox, setOutbox] = useState<string[]>(readOutbox)
  const [filmId, setFilmId] = useState(REFERENCE_VIDEOS[0].id)
  const [segmentId, setSegmentId] = useState(() => segmentsOf(REFERENCE_VIDEOS[0].id)[0]?.id ?? REFERENCE_SEGMENTS[0].id)
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [collMenuOpen, setCollMenuOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [idle, setIdle] = useState(false)
  const [tab, setTab] = useState<BrowseTab>('all')
  const [collId, setCollId] = useState(REFERENCE_COLLECTIONS[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>({ cameraMove: 'all', transition: 'all', status: 'all' })
  const [sortKey, setSortKey] = useState<SortKey>('source')
  const toastTimer = useRef<number | undefined>(undefined)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const filmsRef = useRef<HTMLDivElement>(null)
  /* 导入：走素材库同一套 importFiles（读尺寸/时长/抽海报），
     不让参考片库自己再写一遍 —— 两处行为必须一致。
     切分与分析交给后端，前端只负责"文件进来了"和"片段回来了"。
     当前没有后端，所以导入后显示"正在分析"，等待后端返回片段。 */
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState<{ name: string; total: number; done: number } | null>(null)

  /* 横向片条：鼠标落在上面时，上下滚轮就左右平移。
     必须用原生监听 —— React 的 onWheel 是 passive 的，preventDefault 会被忽略，
     结果滚轮一边平移片条、一边把整页也滚了。
     用触控板横向滑动（|deltaX| > |deltaY|）时不接管，交给浏览器原生处理。 */
  useEffect(() => {
    const el = filmsRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const film = VIDEO_BY_ID.get(filmId) ?? REFERENCE_VIDEOS[0]
  const hasVideo = !!film.previewVideo && mediaError !== film.id
  const filmSegments = useMemo(() => segmentsOf(film.id), [film.id])
  const segment = SEGMENT_BY_ID.get(segmentId) ?? filmSegments[0]
  const segmentIndex = filmSegments.findIndex((s) => s.id === segment?.id)
  const reusable = !!segment && !segment.analysis.reusable.pending && /可借鉴|可复用/.test(segment.analysis.reusable.value)

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
    const nextFilm = VIDEO_BY_ID.get(seg.videoId)
    setPlaying(!!nextFilm?.previewVideo)
    if (seek && seg.videoId === filmId && videoRef.current) videoRef.current.currentTime = seg.start + 0.01
    if (seg.videoId !== filmId) setFilmId(seg.videoId)
    setSegmentId(id)
    if (seek) setPos(seg.start + 0.01)
  }

  const selectFilm = (id: string) => {
    const first = segmentsOf(id)[0]
    if (!first) return
    setPlaying(!!VIDEO_BY_ID.get(id)?.previewVideo)
    setFilmId(id)
    setSegmentId(first.id)
    setPos(0)
  }

  const playableFilms = REFERENCE_VIDEOS.filter((v) => v.previewVideo && v.id !== mediaError)
  const advanceFilm = () => {
    if (playableFilms.length === 0) return
    const index = playableFilms.findIndex((v) => v.id === film.id)
    selectFilm(playableFilms[(index + 1) % playableFilms.length].id)
  }

  const stepSegment = (delta: number) => {
    const next = filmSegments[Math.min(filmSegments.length - 1, Math.max(0, segmentIndex + delta))]
    if (next) selectSegment(next.id)
  }

  /* 播放头由真实 video 的 currentTime 驱动；打开片库或离开页面时暂停解码。 */
  useEffect(() => {
    const syncPlayback = () => {
      const el = videoRef.current
      if (!el) return
      if (playing && !browseOpen && !document.hidden && hasVideo) {
        void el.play().catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setPlaying(false) })
      } else el.pause()
    }
    syncPlayback()
    document.addEventListener('visibilitychange', syncPlayback)
    return () => document.removeEventListener('visibilitychange', syncPlayback)
  }, [playing, browseOpen, hasVideo, film.id])

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
      if (e.key === ' ' && hasVideo) {
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

  /* 导入视频：复用素材库的 importFiles（它负责读尺寸/时长/抽海报并入库）。
     之后把文件交给后端切分+分析 —— 现在没有后端，所以停在"等待分析"这一步，
     并如实告诉用户"切分与分析由后端完成"，不假装已经分析好了。 */
  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    const videos = files.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(f.name))
    if (videos.length === 0) {
      showToast('请选择视频文件')
      return
    }
    setImporting({ name: videos[0].name, total: videos.length, done: 0 })
    try {
      const ok = await importFiles(videos, (ev) => {
        if (ev.phase === 'done') setImporting((p) => (p ? { ...p, done: p.done + 1 } : p))
      })
      if (ok.length > 0) {
        showToast(`已导入 ${ok.length} 个视频，等待分析`)
      } else {
        showToast('导入失败：文件格式不支持或读取失败')
      }
    } catch {
      showToast('导入失败，请重试')
    } finally {
      setImporting(null)
    }
  }

  /* 片段 → 待发送条目。
     参数一定要跟着走：参考片段的价值是"能借鉴什么"，
     只把视频带过去等于让 AI 重新猜一遍。
     brief 用观察+推断拼成给 AI 的一句话，用户想看可以展开。 */
  const toRefCard = (s: ReferenceSegment): PendingRefCard => {
    const v = VIDEO_BY_ID.get(s.videoId)
    const pick = (k: 'cameraMove' | 'composition' | 'lighting' | 'rhythm' | 'transition' | 'reusable') => {
      const a = s.analysis[k]
      return a.pending ? undefined : a.value
    }
    return {
      segmentId: s.id,
      title: `${v?.title ?? '参考'} · 片段 ${s.index + 1}`,
      start: s.start,
      end: s.end,
      poster: `./reference/shots/${s.id}.webp`,
      params: {
        cameraMove: pick('cameraMove'),
        composition: pick('composition'),
        lighting: pick('lighting'),
        rhythm: pick('rhythm'),
        transition: pick('transition'),
        reusable: pick('reusable'),
      },
      brief: [s.observation, s.inference].filter(Boolean).join(' '),
    }
  }

  /* 拖拽开始前把参数包暂存到 sessionStorage：
     DataTransfer 里只能放字符串，参数包太大不适合塞进去，
     所以只传 ID，落点再按 ID 取回完整参数。 */
  const stashRefCard = (s: ReferenceSegment) => {
    try {
      const raw = sessionStorage.getItem(REF_STASH_KEY)
      const map = raw ? JSON.parse(raw) as Record<string, PendingRefCard> : {}
      map[s.id] = toRefCard(s)
      sessionStorage.setItem(REF_STASH_KEY, JSON.stringify(map))
    } catch { /* 存储不可用时仅内存态可用 */ }
  }

  const addRefToPending = (segs: ReferenceSegment[]) => {
    const n = addRef(segs.map(toRefCard))
    showToast(n > 0 ? `已加入待发送 ${n} 个片段` : '已在待发送中')
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
    if (filters.cameraMove !== 'all') list = list.filter((s) => s.analysis.cameraMove.value === filters.cameraMove)
    if (filters.transition !== 'all') list = list.filter((s) => s.analysis.transition.value === filters.transition)
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

  /* 没有片段时不能白屏：用户导入视频后、或片段被筛掉后都会到这里。
     给一个明确的起点 —— 拖视频进来，或点按钮选文件。 */
  if (!segment) {
    return (
      <div className="rfc rfc-empty-state">
        <div className="rfc-empty-card">
          <div className="rfc-empty-icon" aria-hidden="true"><Icon name="film" /></div>
          <h2 className="rfc-empty-title">把参考视频拖进来</h2>
          <p className="rfc-empty-desc">
            导入后会自动切成片段并分析出可借鉴的点，
            <br />挑中需要的片段放进「待发送」，再带去工作台。
          </p>
          <button type="button" className="rfc-empty-btn" onClick={() => fileInputRef.current?.click()}>
            <Icon name="upload" /> 选择视频
          </button>
          <p className="rfc-empty-hint">支持 mp4 / mov / webm</p>
        </div>
        <input ref={fileInputRef} type="file" accept="video/*" multiple hidden onChange={onPickFiles} />
      </div>
    )
  }
  const isFav = stored.favorites.includes(segment.id)
  const inOutbox = outbox.includes(segment.id)
  const pendingCount = pendingFieldCount(segment)

  return (
    <div className={idle && !browseOpen ? 'rfc is-idle' : 'rfc'} data-previewing={hasVideo && playing && !browseOpen || undefined}>
      <div className="rfc-stage">
        {hasVideo ? <video
          key={film.id}
          ref={videoRef}
          className="rfc-frame rfc-video"
          src={film.previewVideo}
          poster={`./reference/shots/${segment.id}.webp`}
          muted loop={playableFilms.length === 1} playsInline preload="metadata" aria-label={`${film.title} 动态示例`}
          onEnded={advanceFilm}
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = Math.min(pos, Math.max(0, e.currentTarget.duration - 0.01))
            if (playing && !browseOpen && !document.hidden) void e.currentTarget.play().catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setPlaying(false) })
          }}
          onTimeUpdate={(e) => {
            const time = e.currentTarget.currentTime
            setPos(time)
            const cur = filmSegments.find((s) => time >= s.start && time < s.end)
            if (cur && cur.id !== segmentId) setSegmentId(cur.id)
          }}
          onError={() => { setMediaError(film.id); setPlaying(false) }}
        /> : <img className="rfc-frame" src={`./reference/shots/${segment.id}.webp`} alt="" />}
        <div className="rfc-scrim rfc-scrim-t" />
        <div className="rfc-scrim rfc-scrim-b" />
        <div className="rfc-overlays">
        <input ref={fileInputRef} type="file" accept="video/*" multiple hidden onChange={onPickFiles} />

        {/* 导入进度：只报"读到了第几个文件"。分析与切分由后端做，
            所以这里不编造进度百分比，也不假装在"分析"。 */}
        {importing && (
          <div className="rfc-import" role="status">
            <span className="rfc-import-spin" aria-hidden="true" />
            <span className="rfc-import-name">{importing.name}</span>
            <span className="rfc-import-num num">{importing.done}/{importing.total}</span>
          </div>
        )}

        <header className="rfc-head">
          <div className="rfc-eyebrow">参考片库</div>
          <h1 className="rfc-title">{film.title}</h1>
          <p className="rfc-desc">{film.description}</p>
          {/* 去 AI 味：来源 / 进度 / 状态不再做成 pill 标签云，压成一行普通元信息；
              只留真正区分片段的属性（景别、运镜）作标签 */}
          <div className="rfc-meta-line">
            {film.source} · 片段 {segment.index + 1} / {filmSegments.length} · {STATUS_META[segment.status].label}
            {pendingCount > 0 && ` · ${pendingCount} 项待分析`}
          </div>
          <div className="rfc-chips">
            
            {!segment.analysis.cameraMove.pending && <span className="rfc-glass">{shortValue(segment.analysis.cameraMove.value)}</span>}
          </div>
        </header>

        <div className="rfc-actions">
          {/* 导入视频：主入口，放在最左。用实心强调色把它和三个次级按钮区分开。 */}
          <button type="button" className="rfc-gbtn rfc-gbtn-primary" onClick={() => fileInputRef.current?.click()}>
            <Icon name="upload" /> 导入视频
          </button>
          {/* 多选入口：与素材库同一个按钮、同一套逻辑 */}
          {!pick.active && (
            <PickButton onClick={pick.enter} label="片段" />
          )}
          <button type="button" className="rfc-gbtn" onClick={() => setBrowseOpen(true)}>
            <Icon name="layout-grid" /> 片库
          </button>
          {/* Round 3（审计 20）：搜索与筛选由底部传输条移回顶部工具栏，不再贴检查器面板边缘 */}
          <button type="button" className="rfc-gbtn" onClick={() => setBrowseOpen(true)}>
            <Icon name="search" /> 搜索与筛选
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
            </div>
            {/* 不再按「画面 / 时间」分组：总共五项，分两段只是平白多一层打断。
                全部平铺，用户从上往下一眼扫完。 */}
            <div className="rfc-fgroup">
              {ANALYSIS_FIELDS.map((f) => {
                  const a = segment.analysis[f.key]
                  /* 每项只回答两件事：值是什么、这个值哪来的。
                     右侧那枚小徽标区分「实测」（后端量出来的：切点/亮度/运动量）
                     和「模型」（视觉模型判断的）—— 用户该知道哪些数字可追溯。 */
                  return (
                    <div key={f.key} className="rfc-field" data-pending={a.pending || undefined}>
                      <span className="rfc-field-k">
                        {f.label}
                        <i className="rfc-field-hint">{f.hint}</i>
                      </span>
                      {a.pending
                        ? <span className="rfc-field-v pend">待分析</span>
                        : <span className="rfc-field-v">{a.value}</span>}
                      {!a.pending && (
                        <span className="rfc-src" data-src={a.source}>
                          {a.source === 'measured' ? '实测' : '模型'}
                        </span>
                      )}
                    </div>
                  )
              })}
            </div>
            {/* 结论：这条片段到底能不能用。放在所有依据之后、单独一块，
                因为用户看完前五项后只想知道这一个答案。 */}
            <div className="rfc-verdict" data-tone={reusable ? 'ok' : 'no'}>
              <span className="rfc-verdict-k">可复用</span>
              <span className="rfc-verdict-v">
                {segment.analysis.reusable.pending ? '待分析' : segment.analysis.reusable.value}
              </span>
            </div>
            {/* 给 AI 的话：默认折叠。想直接抄作业的用户可以展开，不想被术语干扰的可以不看。 */}
            {(segment.observation || segment.inference) && (
              <details className="rfc-brief">
                <summary>这条片段交给 AI 时附带的话</summary>
                <p>{segment.observation}</p>
                {segment.inference && <p>{segment.inference}</p>}
              </details>
            )}
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
                if (!playing && pos >= film.duration) { setPos(0); if (videoRef.current) videoRef.current.currentTime = 0 }
                setPlaying((p) => !p)
              }}
              disabled={!hasVideo}
              aria-label={hasVideo ? (playing ? '暂停' : '播放') : '暂无视频源'}
            >
              <Icon name={playing ? 'pause' : 'play'} />
            </button>
            {hasVideo && playableFilms.length > 1 && <button type="button" className="rfc-film-next" onClick={advanceFilm} aria-label="下一部参考片" title="下一部参考片"><Icon name="chevron-right" /></button>}
            <span className="rfc-time num">
              {formatTimecode(pos)} / {formatTimecode(film.duration)}
            </span>
            <span className="rfc-transport-hint">{hasVideo ? '动态示例 · 静音连播 · 空格暂停 · ←/→ 切片段' : '仅静帧 · 暂无视频源'}</span>
            <span className="rfc-spacer" />
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
          <div className="rfc-films" ref={filmsRef}>
            {REFERENCE_VIDEOS.map((v) => {
              const ss = segmentsOf(v.id)
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
                    {/* 去 AI 味：分析进度已由片段条上的状态点表达，不再把“已分析 x/y”当副标题 */}
                    <span className="rfc-film-m num">{ss.length} 片段</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {browseOpen && (
          <div className="rfc-browse" role="dialog" aria-label="片库">
            <div className="rfc-browse-head">
              <h2 className="rfc-browse-title">参考片库</h2>
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

                  ['cameraMove', '运镜', fieldOptions('cameraMove')],
                  ['transition', '转场', fieldOptions('transition')],
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
              <span className="rfc-browse-count num" role="status">{browseList.length} 个片段</span>
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
                const added = refInPending(s.id)
                return (
                  /* 外层用 div 而非 button：卡里还要放「加入待发送」按钮，
                     嵌套 button 不合法（点击会串）。role+tabIndex 保留键盘可达。 */
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    className="rfc-card"
                    data-on={s.id === segment.id || undefined}
                    data-added={added || undefined}
                    draggable
                    onDragStart={(e) => {
                      /* 与素材库完全一致的两件事：
                         ① 复用同一个 DataTransfer 类型，待发送那边不用改就能接住；
                         ② 把默认那张整卡快照换成 56px 小块拖影 ——
                            卡片 252×232 举在鼠标边会盖住落点，看不清往哪放。 */
                      stashRefCard(s)
                      setAssetDragData(e.dataTransfer, [s.id])
                      const ghostEl = setDragGhost({
                        thumb: `./reference/shots/${s.id}.webp`,
                        label: v?.title ?? '参考',
                        count: 1,
                      })
                      e.dataTransfer.setDragImage(ghostEl, 28, 28)
                    }}
                    onDragEnd={clearDragGhost}
                    data-pickmode={pick.active || undefined}
                    data-picked={(pick.active && pick.has(s.id)) || undefined}
                    onClick={() => {
                      if (pick.active) { pick.toggle(s.id); return }
                      selectSegment(s.id)
                      setBrowseOpen(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        selectSegment(s.id)
                        setBrowseOpen(false)
                      }
                    }}
                  >
                    <span className="rfc-card-thumb">
                      <img src={`./reference/shots/${s.id}.webp`} alt="" loading="lazy" draggable={false} />
                      <span className="rfc-card-marker">片段 {String(s.index + 1).padStart(2, '0')}<span>{s.end - s.start}s</span></span>
                      {pick.active && <PickCheck checked={pick.has(s.id)} />}
                      {stored.favorites.includes(s.id) && <span className="rfc-card-fav"><Icon name="star" /></span>}
                      {/* 加入待发送：和素材库完全同构 —— 按钮放在缩略图容器内，
                          不是卡片根节点。位置在收藏星标左侧一格。 */}
                      {!pick.active && <button
                        type="button"
                        className="rfc-card-add"
                        data-added={added || undefined}
                        aria-label={added ? `${v?.title} 片段 ${s.index + 1} 已在待发送` : `把片段加入待发送`}
                        title={added ? '已在待发送' : '加入待发送'}
                        onClick={(e) => { e.stopPropagation(); addRefToPending([s]) }}
                      >
                        <Icon name={added ? 'check' : 'plus'} />
                      </button>}
                    </span>
                    <span className="rfc-card-body">
                      <span className="rfc-card-t">{v?.title}</span>
                      <span className="rfc-card-m">
                        {s.analysis.cameraMove.pending ? '运镜待分析' : shortValue(s.analysis.cameraMove.value)}
                      </span>
                      <span className="rfc-card-f">
                        <span className="rfc-card-range num">{formatTimecode(s.start)} — {formatTimecode(s.end)}</span>
                        <span className="rfc-card-status" data-s={s.status}><i />{STATUS_META[s.status].label}</span>
                      </span>
                    </span>
                  </div>
                )
              })}
              {browseList.length === 0 && (
                <div className="rfc-empty">没有符合条件的片段，试试放宽筛选。</div>
              )}
            </div>
          </div>
        )}

        {pick.active && (
          <PickBar
            count={pick.selected.size}
            total={browseList.length}
            noun="个片段"
            onSelectAll={() => pick.selectAll(browseList.map((x) => x.id))}
            onCancel={pick.exit}
            onConfirm={() => pick.confirm((ids) => {
              const segs = ids.map((id) => SEGMENT_BY_ID.get(id)).filter((x): x is ReferenceSegment => !!x)
              addRefToPending(segs)
            })}
          />
        )}

        {toast && <div className="rfc-toast">{toast}</div>}
        </div>
      </div>
    </div>
  )
}

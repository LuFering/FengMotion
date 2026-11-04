import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addSegment as apiAddSegment,
  listCollections,
  listReferenceVideos,
  listSegments,
  loadPreferences,
  setFavorite as apiSetFavorite,
  touchRecent,
  uploadReferenceVideo,
  type LocalSegment,
  type ServerVideo,
} from '@/services/referenceApiService'
import { setAssetDragData, usePendingAssets, type PendingRefCard } from '@/shell/usePendingAssets'
import { clearDragGhost, setDragGhost } from '@/shell/dragGhost'
import { usePickMode } from '@/shell/usePickMode'
import { PickBar, PickButton, PickCheck } from '@/shell/PickModeUI'
import {
  ANALYSIS_FIELDS,
  REFERENCE_COLLECTIONS,
  REFERENCE_SEGMENTS,
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
/* 以下两处原先在模块作用域里，直接绑定到演示常量。
   数据改为服务端加载后，必须变成「按当前数据构建」的函数 ——
   模块级 Map 会在数据到达前就固定成空表，之后永远查不到。 */

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

/** 某视频的片段（按 index 排序）。数据由调用方传入，不再读模块常量。 */
function segmentsOf(all: ReferenceSegment[], videoId: string): ReferenceSegment[] {
  return all.filter((s) => s.videoId === videoId).sort((a, b) => a.index - b.index)
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
    /* 不再在这里校验 ID 是否存在：偏好以服务端为准，
       本地这份只在首屏渲染前充当占位，真实数据随后覆盖。
       用模块级 Map 校验会让「加载中」误判成一堆失效 ID。 */
    const valid = (ids: unknown) =>
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
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
      ? parsed.filter((id): id is string => typeof id === 'string')
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
  /* 视频与片段来自服务端。加载前为空数组，界面据此显示「正在读取」，
     而不是「参考片库是空的」——后者会让人以为数据丢了。 */
  const [videos, setVideos] = useState<ServerVideo[]>([])
  const [segments, setSegments] = useState<LocalSegment[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [filmId, setFilmId] = useState('')
  const [segmentId, setSegmentId] = useState('')
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [collMenuOpen, setCollMenuOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [idle, setIdle] = useState(false)
  const [tab, setTab] = useState<BrowseTab>('all')
  const [collId, setCollId] = useState('')
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

  /* 首次加载：视频、片段、偏好、集合全部从服务端读。
     旧版收藏与最近浏览在 localStorage 里，这里不再迁移 —— 参考片片段是
     服务端生成的 ID，旧演示片段的 ID 在新库里不存在，硬迁移只会产生一堆
     「收藏了但查不到」的孤儿记录。 */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [vs, segs, prefs, colls] = await Promise.all([
          listReferenceVideos(),
          listSegments(),
          loadPreferences(),
          listCollections(),
        ])
        if (!alive) return
        setVideos(vs)
        setSegments(segs)
        setStored({
          favorites: prefs.favorites,
          recent: prefs.recent,
          memberships: Object.fromEntries(colls.map((c) => [c.id, [...c.segmentIds]])),
        })
        // 默认选中第一条视频与它的第一个片段
        const firstVideo = vs[0]
        if (firstVideo) {
          setFilmId(firstVideo.id)
          const firstSeg = segs.find((sg) => sg.videoId === firstVideo.id)
          if (firstSeg) setSegmentId(firstSeg.id)
        }
        if (colls[0]) setCollId(colls[0].id)
        setCatalogError(null)
      } catch (error) {
        if (!alive) return
        setCatalogError(error instanceof Error ? error.message : '读取参考片库失败')
      } finally {
        if (alive) setCatalogLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

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

  /* 当前视频与片段都从服务端数据里解析。
     没有数据时返回 undefined，界面按「空/加载中」处理，不假装有内容。 */
  const film = videos.find((v) => v.id === filmId) ?? videos[0]
  const hasVideo = !!film?.fileUrl && mediaError !== film.id
  const filmSegments = useMemo(() => (film ? segmentsOf(segments, film.id) : []), [segments, film])
  const segmentByIdMap = useMemo(() => new Map(segments.map((sg) => [sg.id, sg])), [segments])
  /** 按 ID 找视频；找不到返回 undefined（片段所属视频可能已被删）。 */
  const filmOf = (videoId: string) => videos.find((v) => v.id === videoId)
  /** 视频在列表里的顺序，用于「按来源」排序。 */
  const videoOrder = useMemo(
    () => new Map(videos.map((v, i) => [v.id, i])),
    [videos],
  )
  const segment = segmentByIdMap.get(segmentId) ?? filmSegments[0]
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
    const seg = segmentByIdMap.get(id)
    if (!seg) return
    const nextFilm = videos.find((v) => v.id === seg.videoId)
    setPlaying(!!nextFilm?.fileUrl)
    if (seek && seg.videoId === filmId && videoRef.current) videoRef.current.currentTime = seg.start + 0.01
    if (seg.videoId !== filmId) setFilmId(seg.videoId)
    setSegmentId(id)
    if (seek) setPos(seg.start + 0.01)
    // 记一次浏览（服务端）；失败不打断用户。
    void touchRecent(id)
  }

  const selectFilm = (id: string) => {
    const first = segmentsOf(segments, id)[0]
    setPlaying(!!videos.find((v) => v.id === id)?.fileUrl)
    setFilmId(id)
    if (first) setSegmentId(first.id)
    setPos(0)
  }

  /* 只有本机真有文件（fileUrl 非空）的参考片才进可播放列表 ——
     没有文件的条目显示「仅静帧」，不假装能播。 */
  const playableFilms = videos.filter((v) => v.fileUrl && v.id !== mediaError)
  const advanceFilm = () => {
    // film 在数据到达前可能不存在（加载中会先返回上面的分支，但这里仍要防御）。
    if (playableFilms.length === 0 || !film) return
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
  }, [playing, browseOpen, hasVideo, film?.id])

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

  /**
   * 收藏 / 取消收藏。
   *
   * 先乐观更新让点击即时响应，失败再回滚 —— 收藏只是个人标记，
   * 但「显示已收藏其实没存上」会让人下次找不到。
   */
  const toggleFavorite = (id: string) => {
    const next = !stored.favorites.includes(id)
    setStored((prev) => ({
      ...prev,
      favorites: next ? [id, ...prev.favorites] : prev.favorites.filter((f) => f !== id),
    }))
    void apiSetFavorite(id, next).catch(() => {
      setStored((prev) => ({
        ...prev,
        favorites: next ? prev.favorites.filter((f) => f !== id) : [id, ...prev.favorites],
      }))
      showToast('收藏失败，请稍后重试')
    })
  }

  /**
   * 在当前播放位置标记一个片段。
   *
   * 默认时长 3 秒；超出视频结尾就截到结尾。切完立刻把新片段设为当前选中，
   * 用户不必再去列表里找刚切出来的那一段。
   */
  const cutSegmentAt = async (videoId: string, atSec: number) => {
    const target = videos.find((v) => v.id === videoId)
    const totalSec = target ? target.durationMs / 1000 : 0
    const start = Math.max(0, Math.min(atSec, Math.max(0, totalSec - 0.5)))
    const end = Math.min(totalSec || start + 3, start + 3)
    if (end <= start) {
      showToast('当前位置太靠近结尾，无法切片')
      return
    }
    try {
      const created = await apiAddSegment(videoId, start, end)
      setSegments((prev) => [...prev, created].sort((a, b) => a.index - b.index))
      setSegmentId(created.id)
      showToast(`已标记片段 ${formatTimecode(start)}–${formatTimecode(end)}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '标记片段失败')
    }
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
      /* 走参考片端点：后端会把文件存成素材再登记参考片，
         同一文件不在素材库与参考片库各存一份。 */
      let imported = 0
      const failures: string[] = []
      for (let i = 0; i < videos.length; i += 1) {
        try {
          await uploadReferenceVideo(videos[i])
          imported += 1
        } catch (error) {
          failures.push(error instanceof Error ? error.message : '导入失败')
        }
        setImporting((p) => (p ? { ...p, done: p.done + 1 } : p))
      }
      if (imported > 0) {
        const [vs, segs] = await Promise.all([listReferenceVideos(), listSegments()])
        setVideos(vs)
        setSegments(segs)
        showToast(`已导入 ${imported} 个视频，可手工标记片段`)
      } else {
        showToast(`导入失败：${failures[0] ?? '文件格式不支持或读取失败'}`)
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
    if (tab === 'recent') list = stored.recent.map((id) => segmentByIdMap.get(id)).filter((s): s is LocalSegment => !!s)
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
    if (sortKey === 'source') list.sort((a, b) => (videoOrder.get(a.videoId) ?? 0) - (videoOrder.get(b.videoId) ?? 0) || a.start - b.start)
    if (sortKey === 'timecode') list.sort((a, b) => a.start - b.start)
    if (sortKey === 'status') list.sort((a, b) => byStatus(a) - byStatus(b))
    return list
  }, [tab, collId, filters, query, sortKey, stored])

  /* 加载中与「没有片段」必须分开：数据还在路上时显示「空的」，
     会让用户以为库丢了。 */
  if (catalogLoading) {
    return (
      <div className="rfc rfc-empty-state">
        <div className="rfc-empty-card">
          <div className="rfc-empty-spinner" aria-hidden="true" />
          <h2 className="rfc-empty-title">正在读取参考片库</h2>
          <p className="rfc-empty-desc">从本地服务加载视频与片段…</p>
        </div>
      </div>
    )
  }

  if (catalogError) {
    return (
      <div className="rfc rfc-empty-state">
        <div className="rfc-empty-card">
          <div className="rfc-empty-icon" aria-hidden="true"><Icon name="film" /></div>
          <h2 className="rfc-empty-title">参考片库读取失败</h2>
          <p className="rfc-empty-desc">{catalogError}</p>
          <button type="button" className="rfc-empty-btn" onClick={() => window.location.reload()}>
            重试
          </button>
        </div>
      </div>
    )
  }

  /* 没有片段或没有视频时不能白屏：用户导入视频后、片段被筛掉后、
     以及数据还没到（空库）都会到这里。
     `film` 与 `segment` 必须同时存在才进入主界面 —— 后面大量代码直接用 film.xxx，
     缺一个就会白屏崩溃。 */
  if (!segment || !film) {
    return (
      <div className="rfc rfc-empty-state">
        <div className="rfc-empty-card">
          <div className="rfc-empty-icon" aria-hidden="true"><Icon name="film" /></div>
          <h2 className="rfc-empty-title">把参考视频拖进来</h2>
          <p className="rfc-empty-desc">
            导入后可播放、可手动标记片段并写下你看到的画面；
            <br />自动切分与视频分析尚未接入，分析项会显示「未解析」。
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
          src={film.fileUrl ?? undefined}
          poster={film.thumbnailUrl ?? undefined}
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
        /> : film.thumbnailUrl
          ? <img className="rfc-frame" src={film.thumbnailUrl} alt="" />
          : <div className="rfc-frame rfc-frame-empty">该参考片没有可显示的静帧</div>}
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
                if (!playing && pos >= film.durationMs / 1000) { setPos(0); if (videoRef.current) videoRef.current.currentTime = 0 }
                setPlaying((p) => !p)
              }}
              disabled={!hasVideo}
              aria-label={hasVideo ? (playing ? '暂停' : '播放') : '暂无视频源'}
            >
              <Icon name={playing ? 'pause' : 'play'} />
            </button>
            {hasVideo && playableFilms.length > 1 && <button type="button" className="rfc-film-next" onClick={advanceFilm} aria-label="下一部参考片" title="下一部参考片"><Icon name="chevron-right" /></button>}
            {/* 标记片段：从当前播放位置切一段。这是本阶段唯一的「切片」方式 ——
                自动切分尚未接入，界面不提供假按钮。 */}
            {film && (
              <button
                type="button"
                className="rfc-film-next"
                onClick={() => void cutSegmentAt(film.id, pos)}
                aria-label="在当前播放位置标记一个片段"
                title="在当前播放位置标记一个片段"
              >
                <Icon name="plus" />
              </button>
            )}
            <span className="rfc-time num">
              {formatTimecode(pos)} / {formatTimecode(film.durationMs / 1000)}
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
            {videos.map((v) => {
              const ss = segmentsOf(segments, v.id)
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`rfc-film${v.id === film.id ? ' is-on' : ''}`}
                  onClick={() => selectFilm(v.id)}
                  aria-pressed={v.id === film.id}
                >
                  {/* 缩略图来自服务端（素材抽帧）。没有缩略图时不放 <img>
                      —— 拿演示静态图路径拼接真实片段 ID 只会得到裂图。 */}
                  {v.thumbnailUrl
                    ? <img src={v.thumbnailUrl} alt="" loading="lazy" />
                    : <span className="rfc-film-ph" aria-hidden="true"><Icon name="film" /></span>}
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
                      filmOf(s.videoId)?.thumbnailUrl
                        ? <img src={filmOf(s.videoId)!.thumbnailUrl!} alt="" loading="lazy" draggable={false} />
                        : <span className="rfc-film-ph" aria-hidden="true"><Icon name="film" /></span>
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
              const segs = ids.map((id) => segmentByIdMap.get(id)).filter((x): x is LocalSegment => !!x)
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

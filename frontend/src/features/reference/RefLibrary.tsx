import { useRef, useState } from 'react'
import { type LocalSegment, type ServerVideo } from '@/features/reference/services/referenceApiService'
import { usePendingAssets } from '@/features/assets/hooks/usePendingAssets'
import { usePickMode } from '@/shared/pick-mode/usePickMode'
import { PickBar } from '@/shared/pick-mode/PickModeUI'
import { pendingFieldCount } from '@/features/reference/model/referenceLibrary'
import { Icon } from '@/features/reference/components/RefIcon'
import { type BrowseTab, type SortKey } from '@/features/reference/model/refBrowse'
import { RefBrowseDialog } from '@/features/reference/components/RefBrowseDialog'
import { RefDock } from '@/features/reference/components/RefDock'
import { RefAnalysisPanel } from '@/features/reference/components/RefAnalysisPanel'
import { type Filters, type StoredLibrary, readStored, readOutbox } from '@/features/reference/model/refLibraryStore'
import { useBrowseList } from '@/features/reference/hooks/library/useBrowseList'
import { useSegmentEditing } from '@/features/reference/hooks/library/useSegmentEditing'
import { useRefPending } from '@/features/reference/hooks/library/useRefPending'
import { useRefImport } from '@/features/reference/hooks/library/useRefImport'
import { useSegmentActions } from '@/features/reference/hooks/library/useSegmentActions'
import { usePlayerNavigation } from '@/features/reference/hooks/library/usePlayerNavigation'
import { useIdleFade } from '@/features/reference/hooks/library/useIdleFade'
import { useLibraryPersistence } from '@/features/reference/hooks/library/useLibraryPersistence'
import { useCurrentSegment } from '@/features/reference/hooks/library/useCurrentSegment'
import { useWheelPan } from '@/features/reference/hooks/library/useWheelPan'
import { useRefCatalogLoad } from '@/features/reference/hooks/library/useRefCatalogLoad'
import { RefActions } from '@/features/reference/components/RefActions'
import { RefFilmHeader } from '@/features/reference/components/RefFilmHeader'
import { RefEmptyLibrary } from '@/features/reference/components/RefEmptyLibrary'
import { RefCatalogError } from '@/features/reference/components/RefCatalogError'
import { RefCatalogLoading } from '@/features/reference/components/RefCatalogLoading'

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
  /* 片段编辑的草稿值。必须放在所有条件返回之前 ——
     hooks 数量在渲染之间不能变化，否则 React 会抛
     「Rendered more hooks than during the previous render」。 */
  const [observationDraft, setObservationDraft] = useState('')
  const [suggestionDraft, setSuggestionDraft] = useState('')
  const [startDraft, setStartDraft] = useState('0')
  const [endDraft, setEndDraft] = useState('0')

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
  useRefCatalogLoad({ setCatalogError, setCatalogLoading, setCollId, setFilmId, setSegmentId, setSegments, setStored, setVideos })

  /* 横向片条：鼠标落在上面时，上下滚轮就左右平移。
     必须用原生监听 —— React 的 onWheel 是 passive 的，preventDefault 会被忽略，
     结果滚轮一边平移片条、一边把整页也滚了。
     用触控板横向滑动（|deltaX| > |deltaY|）时不接管，交给浏览器原生处理。 */
  useWheelPan({ filmsRef })

  /* 当前视频与片段都从服务端数据里解析。
     没有数据时返回 undefined，界面按「空/加载中」处理，不假装有内容。 */
  const { segment, film, filmSegments, hasVideo, segmentByIdMap, segmentIndex, current, hasSegment, videoOrder, reusable, filmOf } = useCurrentSegment({ filmId, mediaError, segmentId, segments, videos })

  useLibraryPersistence({ outbox, segment, setStored, stored })

  /** 影院态控件闲置淡出：3 秒无鼠标/键盘活动后淡出头部与操作控件，活动即恢复 */
  useIdleFade({ setIdle })

  const showToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2600)
  }

  const { playableFilms, advanceFilm, stepSegment, selectFilm, selectSegment } = usePlayerNavigation({ browseOpen, collMenuOpen, film, filmId, filmSegments, hasVideo, mediaError, playing, segmentByIdMap, segmentIndex, segments, setBrowseOpen, setCollMenuOpen, setFilmId, setPlaying, setPos, setSegmentId, videoRef, videos })

  /**
   * 收藏 / 取消收藏。
   *
   * 先乐观更新让点击即时响应，失败再回滚 —— 收藏只是个人标记，
   * 但「显示已收藏其实没存上」会让人下次找不到。
   */
  const { toggleFavorite, cutSegmentAt } = useSegmentActions({ setSegmentId, setSegments, setStored, showToast, stored, videos })

  /* 导入视频：复用素材库的 importFiles（它负责读尺寸/时长/抽海报并入库）。
     之后把文件交给后端切分+分析 —— 现在没有后端，所以停在"等待分析"这一步，
     并如实告诉用户"切分与分析由后端完成"，不假装已经分析好了。 */
  const { onPickFiles } = useRefImport({ setImporting, setSegments, setVideos, showToast })

  /* 片段 → 待发送条目。
     参数一定要跟着走：参考片段的价值是"能借鉴什么"，
     只把视频带过去等于让 AI 重新猜一遍。
     brief 用观察+推断拼成给 AI 的一句话，用户想看可以展开。 */
  const { toggleReference, addRefToPending, stashRefCard } = useRefPending({ addRef, outbox, setOutbox, showToast, videos })

  /**
   * 保存片段的人工改动。
   *
   * 只提交变化的那几项；失败时提示并回读服务端值，避免界面显示一个没存上的结果。
   */
  const { removeSegment, saveSegmentEdits } = useSegmentEditing({ current, film, hasSegment, segments, setEndDraft, setObservationDraft, setSegmentId, setSegments, setStartDraft, setSuggestionDraft, showToast })

  const { browseList } = useBrowseList({ collId, filters, query, segmentByIdMap, segments, sortKey, stored, tab, videoOrder, videos })

  /* 加载中与「没有片段」必须分开：数据还在路上时显示「空的」，
     会让用户以为库丢了。 */
  if (catalogLoading) {
    return <RefCatalogLoading />
  }

  if (catalogError) {
    return <RefCatalogError catalogError={catalogError} />
  }

  /* 空库（一条视频都没有）才显示引导页。
     **有视频但没有片段时必须进入主界面**：后端不会自动切片，新导入的第一条视频
     若因为「还没有片段」被挡在引导页，用户就永远无法播放它、也就点不到「标记片段」
     —— 首次使用直接卡死。
     `segment` 可以为 undefined，主界面对它做了可选访问。 */
  if (!film) {
    return <RefEmptyLibrary fileInputRef={fileInputRef} onPickFiles={onPickFiles} />
  }

  const isFav = hasSegment && stored.favorites.includes(current.id)
  const inOutbox = hasSegment && outbox.includes(current.id)
  const pendingCount = hasSegment ? pendingFieldCount(segment) : 0

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

        <RefFilmHeader current={current} film={film} filmSegments={filmSegments} hasSegment={hasSegment} pendingCount={pendingCount} />

        <RefActions
          current={current}
          fileInputRef={fileInputRef}
          hasSegment={hasSegment}
          isFav={isFav}
          panelOpen={panelOpen}
          pick={pick}
          setBrowseOpen={setBrowseOpen}
          setPanelOpen={setPanelOpen}
          toggleFavorite={toggleFavorite}
        />

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

        {panelOpen && !hasSegment && (
          /* 有视频但没有片段：这是刚导入后的正常状态，不是错误。
             直接告诉用户下一步该做什么 —— 面板若显示一片「待分析」，
             用户会以为分析失败，而不是「还没标记片段」。 */
          <aside className="rfc-panel" aria-label="片段分析">
            <div className="rfc-panel-head">
              <h2>还没有片段</h2>
            </div>
            <p className="rfc-panel-empty">
              播放到想借鉴的位置，点播放条上的 <b>+</b> 标记一个片段，
              之后就能在这里记录你看到的画面、并存进参考集合。
            </p>
          </aside>
        )}

        {panelOpen && hasSegment && (
          <RefAnalysisPanel
            current={current}
            endDraft={endDraft}
            inOutbox={inOutbox}
            observationDraft={observationDraft}
            removeSegment={removeSegment}
            reusable={reusable}
            saveSegmentEdits={saveSegmentEdits}
            segment={segment}
            setEndDraft={setEndDraft}
            setObservationDraft={setObservationDraft}
            setStartDraft={setStartDraft}
            setSuggestionDraft={setSuggestionDraft}
            startDraft={startDraft}
            suggestionDraft={suggestionDraft}
            toggleReference={toggleReference}
          />
        )}

        <RefDock
          advanceFilm={advanceFilm}
          cutSegmentAt={cutSegmentAt}
          film={film}
          filmSegments={filmSegments}
          filmsRef={filmsRef}
          hasVideo={hasVideo}
          playableFilms={playableFilms}
          playing={playing}
          pos={pos}
          segment={segment}
          segments={segments}
          selectFilm={selectFilm}
          selectSegment={selectSegment}
          setPlaying={setPlaying}
          setPos={setPos}
          videoRef={videoRef}
          videos={videos}
        />

        {browseOpen && (
          <RefBrowseDialog
            addRefToPending={addRefToPending}
            browseList={browseList}
            collId={collId}
            filmOf={filmOf}
            filters={filters}
            pick={pick}
            query={query}
            refInPending={refInPending}
            segment={segment}
            segments={segments}
            selectSegment={selectSegment}
            setBrowseOpen={setBrowseOpen}
            setCollId={setCollId}
            setFilters={setFilters}
            setQuery={setQuery}
            setSortKey={setSortKey}
            setTab={setTab}
            sortKey={sortKey}
            stashRefCard={stashRefCard}
            stored={stored}
            tab={tab}
            videos={videos}
          />
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

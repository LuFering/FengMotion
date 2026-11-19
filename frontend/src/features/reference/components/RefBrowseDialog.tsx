import type * as React from 'react'
import { TAB_ITEMS, fieldOptions, shortValue, SORT_ITEMS, type SortKey, type BrowseTab } from '@/features/reference/model/refBrowse'
import { Icon } from '@/features/reference/components/RefIcon'
import { REFERENCE_COLLECTIONS, formatTimecode, STATUS_META, type ReferenceSegment } from '@/features/reference/model/referenceLibrary'
import { setAssetDragData } from '@/features/assets/hooks/usePendingAssets'
import { setDragGhost, clearDragGhost } from '@/shared/pick-mode/dragGhost'
import { PickCheck } from '@/shared/pick-mode/PickModeUI'
import type { LocalSegment, ServerVideo } from '@/features/reference/services/referenceApiService'
import type { Filters, StoredLibrary, StatusFilter } from '@/features/reference/model/refLibraryStore'
import type { PickMode } from '@/shared/pick-mode/usePickMode'

export interface RefBrowseDialogProps {
  addRefToPending: (segs: LocalSegment[]) => void
  browseList: LocalSegment[]
  collId: string
  filmOf: (videoId: string) => ServerVideo | undefined
  filters: Filters
  pick: PickMode
  query: string
  refInPending: (id: string) => boolean
  segment: ReferenceSegment
  segments: LocalSegment[]
  selectSegment: (id: string, seek?: boolean) => void
  setBrowseOpen: React.Dispatch<React.SetStateAction<boolean>>
  setCollId: React.Dispatch<React.SetStateAction<string>>
  setFilters: React.Dispatch<React.SetStateAction<Filters>>
  setQuery: React.Dispatch<React.SetStateAction<string>>
  setSortKey: React.Dispatch<React.SetStateAction<SortKey>>
  setTab: React.Dispatch<React.SetStateAction<BrowseTab>>
  sortKey: SortKey
  stashRefCard: (s: LocalSegment) => void
  stored: StoredLibrary
  tab: BrowseTab
  videos: ServerVideo[]
}

/** 参考片库的片库浮层：按标签页、搜索、筛选和排序浏览片段卡片，可选中播放、多选、拖拽或加入待发送。 */
export function RefBrowseDialog({ addRefToPending, browseList, collId, filmOf, filters, pick, query, refInPending, segment, segments, selectSegment, setBrowseOpen, setCollId, setFilters, setQuery, setSortKey, setTab, sortKey, stashRefCard, stored, tab, videos }: RefBrowseDialogProps) {
  return (
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

            ['cameraMove', '运镜', fieldOptions(segments, 'cameraMove')],
            ['transition', '转场', fieldOptions(segments, 'transition')],
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
          const v = videos.find((x) => x.id === s.videoId)
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
                  // 用视频缩略图；没有就用中性标签（不拼演示静态图路径）。
                  thumb: v?.thumbnailUrl ?? undefined,
                  label: v?.title ?? '参考片',
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
  )
}

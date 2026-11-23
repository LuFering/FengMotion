import type * as React from 'react'
import { TAB_ITEMS, fieldOptions, shortValue, SORT_ITEMS, type SortKey, type BrowseTab } from '@/features/reference/model/refBrowse'
import { Icon } from '@/features/reference/components/RefIcon'
import { formatClock, formatDuration, STATUS_META, type ReferenceSegment, type ReferenceStatus } from '@/features/reference/model/referenceLibrary'
import { setAssetDragData } from '@/features/assets/hooks/usePendingAssets'
import { setDragGhost, clearDragGhost } from '@/shared/pick-mode/dragGhost'
import { PickButton, PickCheck } from '@/shared/pick-mode/PickModeUI'
import { MenuSelect } from '@/shared/components/MenuSelect'
import type { LocalSegment, ServerVideo } from '@/features/reference/services/referenceApiService'
import type { Filters, StoredLibrary, StatusFilter } from '@/features/reference/model/refLibraryStore'
import type { PickMode } from '@/shared/pick-mode/usePickMode'

/** 服务端返回的参考集合（GET /reference-collections） */
export interface RefCollection {
  id: string
  name: string
  note: string
  segmentIds: string[]
}

export interface RefBrowseDialogProps {
  addRefToPending: (segs: LocalSegment[]) => void
  browseList: LocalSegment[]
  collId: string
  collections: RefCollection[]
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

const STATUSES: ReferenceStatus[] = ['analyzed', 'partial', 'pending']

/**
 * 片库覆层：按页签、搜索、筛选、排序浏览片段卡片；可选中播放、多选、拖拽或加入待发送。
 * 筛选下拉用全站共享的 MenuSelect；没有可选值的筛选不出现（契约 §3）。
 */
export function RefBrowseDialog({ addRefToPending, browseList, collId, collections, filmOf, filters, pick, query, refInPending, segment, segments, selectSegment, setBrowseOpen, setCollId, setFilters, setQuery, setSortKey, setTab, sortKey, stashRefCard, stored, tab, videos }: RefBrowseDialogProps) {
  const tabs = TAB_ITEMS.filter((t) => t.id !== 'collections' || collections.length > 0 || tab === 'collections')
  const cameraOpts = fieldOptions(segments, 'cameraMove')
  const transitionOpts = fieldOptions(segments, 'transition')
  const statusCount = (s: ReferenceStatus) => segments.filter((x) => x.status === s).length
  const statusOpts = STATUSES.filter((s) => statusCount(s) > 0 || filters.status === s)
  const filtered = query.trim() !== '' || filters.cameraMove !== 'all' || filters.transition !== 'all' || filters.status !== 'all'
  const clearFilters = () => {
    setQuery('')
    setFilters({ cameraMove: 'all', transition: 'all', status: 'all' })
  }
  const current = collections.find((c) => c.id === collId)

  return (
    <div className="rfc-browse" role="dialog" aria-label="片库">
      <div className="rfc-browse-head">
        <h2 className="rfc-browse-title">参考片库</h2>
        <div className="rfc-tabs" role="tablist" aria-label="浏览范围">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`rfc-tab${tab === t.id ? ' is-on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="rfc-browse-headacts">
          {/* 多选入口：与素材库同一个按钮、同一套逻辑；只在片库里有意义，从顶部工具栏移到这里 */}
          {!pick.active && browseList.length > 0 && <PickButton onClick={pick.enter} label="片段" />}
          <button type="button" className="rfc-gbtn" onClick={() => setBrowseOpen(false)} title="关闭（Esc）">
            <Icon name="x" /> 关闭
          </button>
        </div>
      </div>

      <div className="rfc-browse-tools">
        <label className="rfc-search">
          <Icon name="search" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索片名、标签或分析内容"
            aria-label="搜索片段"
          />
        </label>
        {(cameraOpts.length > 0 || filters.cameraMove !== 'all') && (
          <MenuSelect
            label="运镜"
            ariaLabel="按运镜筛选"
            value={filters.cameraMove}
            allValue="all"
            options={[{ value: 'all', label: '全部运镜' }, ...cameraOpts.map((o) => ({ value: o, label: shortValue(o) }))]}
            onChange={(v) => setFilters((f) => ({ ...f, cameraMove: v }))}
          />
        )}
        {(transitionOpts.length > 0 || filters.transition !== 'all') && (
          <MenuSelect
            label="转场"
            ariaLabel="按转场筛选"
            value={filters.transition}
            allValue="all"
            options={[{ value: 'all', label: '全部转场' }, ...transitionOpts.map((o) => ({ value: o, label: shortValue(o) }))]}
            onChange={(v) => setFilters((f) => ({ ...f, transition: v }))}
          />
        )}
        {(statusOpts.length > 1 || filters.status !== 'all') && (
          <MenuSelect
            label="状态"
            ariaLabel="按分析状态筛选"
            value={filters.status}
            allValue="all"
            options={[
              { value: 'all', label: '全部状态', count: segments.length },
              ...statusOpts.map((s) => ({ value: s, label: STATUS_META[s].label, count: statusCount(s) })),
            ]}
            onChange={(v) => setFilters((f) => ({ ...f, status: v as StatusFilter }))}
          />
        )}
        <span className="rfc-browse-count" role="status">{browseList.length} 个片段</span>
        <MenuSelect
          label=""
          quiet
          align="end"
          ariaLabel="排序方式"
          value={sortKey}
          options={SORT_ITEMS}
          onChange={(v) => setSortKey(v as SortKey)}
        />
      </div>

      {tab === 'collections' && collections.length > 0 && (
        <div className="rfc-collchips">
          {collections.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`rfc-chip${collId === c.id ? ' is-on' : ''}`}
              onClick={() => setCollId(c.id)}
            >
              {c.name} · {(stored.memberships[c.id] ?? c.segmentIds).length}
            </button>
          ))}
          {current?.note && <span className="rfc-collnote">{current.note}</span>}
        </div>
      )}

      <div className="rfc-grid">
        {browseList.map((s) => {
          const v = filmOf(s.videoId) ?? videos.find((x) => x.id === s.videoId)
          const added = refInPending(s.id)
          const camera = s.analysis.cameraMove.pending ? '运镜待分析' : shortValue(s.analysis.cameraMove.value)
          return (
            /* 外层用 div 而非 button：卡里还要放「加入待发送」按钮，嵌套 button 不合法。 */
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              className="rfc-card"
              aria-label={`${v?.title ?? '参考片'} 片段 ${s.index + 1}，${formatClock(s.start)} 到 ${formatClock(s.end)}`}
              data-on={s.id === segment?.id || undefined}
              data-added={added || undefined}
              draggable
              onDragStart={(e) => {
                /* 与素材库一致：同一个 DataTransfer 类型；拖影换成 56px 小块，不盖住落点。 */
                stashRefCard(s)
                setAssetDragData(e.dataTransfer, [s.id])
                const ghostEl = setDragGhost({ thumb: v?.thumbnailUrl ?? undefined, label: v?.title ?? '参考片', count: 1 })
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
                  if (pick.active) { pick.toggle(s.id); return }
                  selectSegment(s.id)
                  setBrowseOpen(false)
                }
              }}
            >
              <span className="rfc-card-thumb">
                {/* 原先这里的三元表达式没包 {}，整段源码被当成文字显示在卡片上 */}
                {v?.thumbnailUrl
                  ? <img src={v.thumbnailUrl} alt="" loading="lazy" draggable={false} />
                  : <span className="rfc-film-ph" aria-hidden="true"><Icon name="film" /></span>}
                <span className="rfc-card-marker">片段 {s.index + 1}<span>{formatDuration(s.end - s.start)}</span></span>
                {pick.active && <PickCheck checked={pick.has(s.id)} />}
                {stored.favorites.includes(s.id) && <span className="rfc-card-fav" aria-label="已收藏"><Icon name="star" /></span>}
                {!pick.active && (
                  <button
                    type="button"
                    className="rfc-card-add"
                    data-added={added || undefined}
                    aria-label={added ? `${v?.title ?? '参考片'} 片段 ${s.index + 1} 已在待发送` : `把 ${v?.title ?? '参考片'} 片段 ${s.index + 1} 加入待发送`}
                    title={added ? '已在待发送' : '加入待发送'}
                    onClick={(e) => { e.stopPropagation(); addRefToPending([s]) }}
                  >
                    <Icon name={added ? 'check' : 'plus'} />
                  </button>
                )}
              </span>
              <span className="rfc-card-body">
                <span className="rfc-card-t">{v?.title ?? '参考片'}</span>
                <span className="rfc-card-m">{formatClock(s.start)} – {formatClock(s.end)} · {camera}</span>
              </span>
              {s.status !== 'analyzed' && (
                <span className="rfc-card-status" data-s={s.status}><i />{STATUS_META[s.status].label}</span>
              )}
            </div>
          )
        })}
        {browseList.length === 0 && (
          <div className="rfc-empty">
            <p>{filtered ? '没有符合条件的片段' : tab === 'favorites' ? '还没有收藏的片段' : tab === 'recent' ? '还没有浏览过片段' : '还没有片段'}</p>
            {filtered && <button type="button" className="rfc-empty-clear" onClick={clearFilters}>清除搜索与筛选</button>}
          </div>
        )}
      </div>
    </div>
  )
}

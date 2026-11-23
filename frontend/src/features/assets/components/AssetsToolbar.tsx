import { Icon } from './AssetIcon'
import { MEDIA_LABEL, type MediaType } from '../model/myAssets'
import { TYPE_IDS, SORT_LABEL, type SortKey } from '../model/assetDisplay'
import { MenuSelect } from '@/shared/components/MenuSelect'

interface Props {
  activeLabel: string
  visibleCount: number
  typeCounts: Record<MediaType | 'all', number>
  typeFilter: MediaType | 'all'
  setTypeFilter: (value: MediaType | 'all') => void
  sortKey: SortKey
  setSortKey: (value: SortKey) => void
  viewMode: 'grid' | 'list'
  setViewMode: (value: 'grid' | 'list') => void
  orgOpen: boolean
  toggleOrg: () => void
  pickMode: boolean
  togglePick: () => void
  hasFilter: boolean
  clearFilter: () => void
  countsState: 'loading' | 'unknown' | 'stale' | 'ready'
}

/** 浏览区工具条：范围标题与结果数、类型筛选、排序、视图切换、选择。一行排下，窄时类型换行。 */
export function AssetsToolbar(p: Props) {
  const countUnknown = p.countsState === 'loading' || p.countsState === 'unknown'
  // 只列出有素材的类型和当前选中的类型；数量未知时全部列出
  const types = TYPE_IDS.filter(t => countUnknown || p.typeCounts[t] > 0 || p.typeFilter === t)
  return (
    <div className="mya-browser-tools">
      <div className="mya-browser-title">
        {!p.orgOpen && <button type="button" className="mya-iconbtn" onClick={p.toggleOrg} aria-label="展开分类" title="展开分类"><Icon name="panel-left-open" /></button>}
        <h2 title={p.activeLabel}>{p.activeLabel}</h2>
        <span className="mya-result-count" role="status">{p.countsState === 'loading' ? '读取中' : p.countsState === 'unknown' ? '数量未知' : `${p.visibleCount} 项${p.countsState === 'stale' ? ' · 未更新' : ''}`}</span>
        {p.hasFilter && <button type="button" className="mya-reset" onClick={p.clearFilter}>清除筛选</button>}
      </div>
      {types.length > 1 || p.typeFilter !== 'all' ? (
        <div className="mya-types" role="group" aria-label="按素材类型筛选">
          <button type="button" aria-pressed={p.typeFilter === 'all'} onClick={() => p.setTypeFilter('all')}>全部</button>
          {types.map(type => <button key={type} type="button" aria-pressed={p.typeFilter === type} onClick={() => p.setTypeFilter(type)}>
            {MEDIA_LABEL[type]}<span>{countUnknown ? '—' : p.typeCounts[type]}</span>
          </button>)}
        </div>
      ) : <span className="mya-types-gap" />}
      <div className="mya-browser-views">
        <MenuSelect className="mya-sort" label="" quiet align="end" ariaLabel="素材排序" value={p.sortKey}
          onChange={(v) => p.setSortKey(v as SortKey)}
          options={(Object.keys(SORT_LABEL) as SortKey[]).map((key) => ({ value: key, label: SORT_LABEL[key] }))} />
        <div className="mya-seg" role="group" aria-label="素材视图">
          {(['grid', 'list'] as const).map(mode => <button key={mode} type="button" aria-label={mode === 'grid' ? '网格视图' : '列表视图'} title={mode === 'grid' ? '网格视图' : '列表视图'} aria-pressed={p.viewMode === mode} className={p.viewMode === mode ? 'on' : ''} onClick={() => p.setViewMode(mode)}><Icon name={mode === 'grid' ? 'layout-grid' : 'list'} /></button>)}
        </div>
        <button type="button" className="mya-pickbtn" disabled={countUnknown} aria-pressed={p.pickMode} data-on={p.pickMode || undefined} onClick={p.togglePick}>
          <Icon name="square-check" /><span>{p.pickMode ? '完成选择' : '选择'}</span>
        </button>
      </div>
    </div>
  )
}

import type * as React from 'react'
import { PageHeader } from '@/shared/components/PageHeader'
import { Icon } from '@/features/assets/components/AssetIcon'
import { SearchField } from '@/shared/components/SearchField'
import { MEDIA_LABEL, MEDIA_ICON, type MyAsset, type MediaType } from '@/features/assets/model/myAssets'
import { TYPE_IDS, SORT_LABEL, type SortKey } from '@/features/assets/model/assetDisplay'
import type { NodeId } from '@/features/assets/model/assetTree'

export interface AssetsHeaderProps {
  activeLabel: string
  assets: MyAsset[]
  clearFilter: () => void
  counts: { all: number; favorites: number; recent: number; imported: number; generated: number; builtin: number; project: number; pending: number; needsReview: number; licenseUnknown: number; restricted: number; refsNone: number; totalBytes: number; type: (t: MediaType) => number; folder: (id: string) => number }
  enterPick: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
  node: NodeId
  orgOpen: boolean
  pickMode: boolean
  pop: 'sort' | 'type' | null
  search: string
  setOrgOpen: React.Dispatch<React.SetStateAction<boolean>>
  setPop: React.Dispatch<React.SetStateAction<'sort' | 'type' | null>>
  setSearch: React.Dispatch<React.SetStateAction<string>>
  setSortKey: React.Dispatch<React.SetStateAction<SortKey>>
  setTypeFilter: React.Dispatch<React.SetStateAction<MediaType | 'all'>>
  setViewMode: React.Dispatch<React.SetStateAction<'grid' | 'list'>>
  sortKey: SortKey
  typeFilter: MediaType | 'all'
  viewMode: 'grid' | 'list'
}

/** 从 Assets.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function AssetsHeader({ activeLabel, assets, clearFilter, counts, enterPick, inputRef, node, orgOpen, pickMode, pop, search, setOrgOpen, setPop, setSearch, setSortKey, setTypeFilter, setViewMode, sortKey, typeFilter, viewMode }: AssetsHeaderProps) {
  return (
    <PageHeader
      title="我的素材"
      actions={
        <>
          {/* 搜索与视图控制放在标题行右侧：原来它们单独占一条工具条，
              于是顶部出现「标题行 + 工具条」两层，中间那行是空的。 */}
          {!orgOpen && (
            <button type="button" className="mya-toolbtn" onClick={() => setOrgOpen(true)}
                    title="展开组织栏" aria-label="展开组织栏">
              <Icon name="panel-left-open" />组织
            </button>
          )}
          <div className="mya-content-search">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="搜索名称、标签、来源"
              ariaLabel="搜索素材"
              onClear={() => setSearch('')}
            />
          </div>
          <span className="mya-crumb" hidden={node === 'all' && typeFilter === 'all'}>
            <b>{node === 'all' ? '全部素材' : activeLabel}</b>
            {typeFilter !== 'all' && <>{' / '}<b>{MEDIA_LABEL[typeFilter]}</b></>}
          </span>
          <span className="mya-spacer" />
          <div className="mya-seg" role="group" aria-label="视图模式">
            <button type="button" className={viewMode === 'grid' ? 'on' : undefined}
                    aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')}>
              <Icon name="layout-grid" />网格
            </button>
            <button type="button" className={viewMode === 'list' ? 'on' : undefined}
                    aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}>
              <Icon name="list" />列表
            </button>
          </div>
          {(node !== 'all' || search || typeFilter !== 'all') && (
            <button type="button" className="mya-clearbtn mya-clearbtn-sm" onClick={clearFilter}>清除筛选</button>
          )}
          <div className="mya-tool-wrap">
            <button type="button" className="mya-toolbtn" data-on={typeFilter !== 'all' || undefined}
                    aria-haspopup="listbox" aria-expanded={pop === 'type'}
                    onClick={() => setPop(pop === 'type' ? null : 'type')}>
              <Icon name="layers" />类型
              {typeFilter !== 'all' && <em>{MEDIA_LABEL[typeFilter]}</em>}
              <Icon name="chevron-down" />
            </button>
            {pop === 'type' && (
              <div className="mya-pop" role="listbox" aria-label="按类型筛选">
                <button type="button" className="mya-poprow" data-on={typeFilter === 'all' || undefined}
                        onClick={() => { setTypeFilter('all'); setPop(null) }}>
                  <span>全部类型</span><span className="mya-pop-n mono">{assets.length}</span>
                  {typeFilter === 'all' && <Icon name="check" />}
                </button>
                {TYPE_IDS.map((t) => (
                  <button key={t} type="button" className="mya-poprow" data-on={typeFilter === t || undefined}
                          onClick={() => { setTypeFilter(t); setPop(null) }}>
                    <Icon name={MEDIA_ICON[t]} />
                    <span>{MEDIA_LABEL[t]}</span><span className="mya-pop-n mono">{counts.type(t)}</span>
                    {typeFilter === t && <Icon name="check" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mya-tool-wrap">
            <button type="button" className="mya-toolbtn"
                    aria-haspopup="listbox" aria-expanded={pop === 'sort'}
                    onClick={() => setPop(pop === 'sort' ? null : 'sort')}>
              <Icon name="list-ordered" />排序<em>{SORT_LABEL[sortKey]}</em>
              <Icon name="chevron-down" />
            </button>
            {pop === 'sort' && (
              <div className="mya-pop" role="listbox" aria-label="排序方式">
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                  <button key={k} type="button" className="mya-poprow" data-on={sortKey === k || undefined}
                          onClick={() => { setSortKey(k); setPop(null) }}>
                    <span>{SORT_LABEL[k]}</span>
                    {sortKey === k && <Icon name="check" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {!pickMode && (
            <button type="button" className="mya-pickbtn" onClick={enterPick}>
              <Icon name="square-check" />选择素材
            </button>
          )}
          <button type="button" className="mya-primary" onClick={() => inputRef.current?.click()}>
            <Icon name="import" />导入素材
          </button>
        </>
      }
    />
  )
}

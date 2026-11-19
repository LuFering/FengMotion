import type * as React from 'react'
import { SearchField } from '@/shared/components/SearchField'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { CATEGORY_IDS, categoryLabel, EXEC_IDS, execLabel, IMPL_IDS, implLabel, INPUT_IDS, inputLabel, COMPLEXITY_STEPS } from '@/features/fx/model/fxFilters'
import { SwitchVertical01 } from '@untitledui/icons'
import type { Scope, SortKey } from '@/features/fx/model/fxLibraryStore'
import type { FxCategory, FxTechnique, FxExecType, FxImpl, FxInputKind } from '@/features/fx/model/fxTechniques'

export interface FxMetaBarProps {
  SCOPES: { id: Scope; label: string; count: number; icon: React.ReactNode }[]
  activeCount: number
  cat: 'all' | FxCategory
  clearFilters: () => void
  counts: { category: Map<FxCategory, number>; featured: number; favorites: number; recent: number }
  exec: 'all' | FxExecType
  filtersOpen: boolean
  impl: 'all' | FxImpl
  inputKind: 'all' | FxInputKind
  maxComplexity: number
  previewKind: 'all' | 'motion' | 'still'
  query: string
  scope: Scope
  searchRef: React.RefObject<HTMLInputElement | null>
  searched: FxTechnique[]
  semanticNote: { degraded: boolean; reason?: string } | null
  setCat: React.Dispatch<React.SetStateAction<'all' | FxCategory>>
  setExec: React.Dispatch<React.SetStateAction<'all' | FxExecType>>
  setFiltersOpen: React.Dispatch<React.SetStateAction<boolean>>
  setImpl: React.Dispatch<React.SetStateAction<'all' | FxImpl>>
  setInputKind: React.Dispatch<React.SetStateAction<'all' | FxInputKind>>
  setMaxComplexity: React.Dispatch<React.SetStateAction<number>>
  setPreviewKind: React.Dispatch<React.SetStateAction<'all' | 'motion' | 'still'>>
  setQuery: React.Dispatch<React.SetStateAction<string>>
  setScope: React.Dispatch<React.SetStateAction<Scope>>
  setSort: React.Dispatch<React.SetStateAction<SortKey>>
  setSourceFilter: React.Dispatch<React.SetStateAction<string>>
  sort: SortKey
  sourceFilter: string
  sources: [string, number][]
  visible: FxTechnique[]
}

/** 从 FxLibrary.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function FxMetaBar({ SCOPES, activeCount, cat, clearFilters, counts, exec, filtersOpen, impl, inputKind, maxComplexity, previewKind, query, scope, searchRef, searched, semanticNote, setCat, setExec, setFiltersOpen, setImpl, setInputKind, setMaxComplexity, setPreviewKind, setQuery, setScope, setSort, setSourceFilter, sort, sourceFilter, sources, visible }: FxMetaBarProps) {
  return (
    <div className="fx-meta">
      <nav className="fx-meta-scope" aria-label="范围">
        {SCOPES.map((s) => (
          <button key={s.id} type="button" data-on={scope === s.id ? '' : undefined} aria-pressed={scope === s.id} onClick={() => setScope(s.id)}>
            {s.label}<em className="num">{s.count}</em>
          </button>
        ))}
      </nav>
      <label className="fx-source-select">
          <span>来源</span>
          <select aria-label="按来源筛选技法" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="">全部来源</option>
            {sources.map(([name, count]) => <option key={name} value={name}>{name}（{count}）</option>)}
          </select>
      </label>
      <div className="fx-cmd-search">
        <SearchField
          inputRef={searchRef}
          value={query}
          onChange={setQuery}
          placeholder="搜索名称、用途或实现方式"
          shortcutHint="/"
          ariaLabel="搜索技法"
        />
        {/* 检索降级时必须明说：不标注的话，用户会把字面匹配当成语义命中，
            据此判断「库里只有这些」。这是库内最容易误导人的一处。 */}
        {query.trim() && semanticNote?.degraded && (
          <p className="fx-search-note" role="status">
            语义检索暂不可用，以下按关键词字面匹配
          </p>
        )}
      </div>
      <div className="fx-filterwrap">
        <button
          type="button"
          className="fx-toolbtn"
          aria-expanded={filtersOpen}
          data-on={filtersOpen || activeCount > 0 ? '' : undefined}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <UiIcon icon={SemIcons.sliders} size="sm" />
          筛选
          {activeCount > 0 && <b className="fx-badge num">{activeCount}</b>}
          <UiIcon icon={SemIcons.collapse} size="xs" className={filtersOpen ? 'fx-chev is-open' : 'fx-chev'} />
        </button>
        {filtersOpen && (
          <>
            <div className="fx-pop-backdrop" onClick={() => setFiltersOpen(false)} />
            <div className="fx-pop" role="dialog" aria-label="筛选条件">
              <div className="fx-filtergroup">
                <span className="fx-filterlabel" id="fx-fg-cat">分类</span>
                <div className="fx-chips" role="group" aria-labelledby="fx-fg-cat">
                  <button type="button" className="fx-chip" aria-pressed={cat === 'all'} data-on={cat === 'all' ? '' : undefined} onClick={() => setCat('all')}>
                    全部<em className="num">{searched.length}</em>
                  </button>
                  {CATEGORY_IDS.map((id) => (
                    <button key={id} type="button" className="fx-chip" aria-pressed={cat === id} data-on={cat === id ? '' : undefined} onClick={() => setCat(cat === id ? 'all' : id)}>
                      {categoryLabel(id)}<em className="num">{counts.category.get(id) ?? 0}</em>
                    </button>
                  ))}
                </div>
              </div>
              <div className="fx-filtergroup">
                <span className="fx-filterlabel" id="fx-fg-exec">源库能力</span>
                <div className="fx-chips" role="group" aria-labelledby="fx-fg-exec">
                  <button type="button" className="fx-chip" aria-pressed={exec === 'all'} data-on={exec === 'all' ? '' : undefined} onClick={() => setExec('all')}>全部</button>
                  {EXEC_IDS.map((id) => (
                    <button key={id} type="button" className="fx-chip" aria-pressed={exec === id} data-on={exec === id ? '' : undefined} onClick={() => setExec(exec === id ? 'all' : id)}>
                      <i className="fx-dot" data-cap={id} aria-hidden="true" />{execLabel(id)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fx-filtergroup">
                <span className="fx-filterlabel" id="fx-fg-preview">预览类型</span>
                <div className="fx-chips" role="group" aria-labelledby="fx-fg-preview">
                  {([['all', '全部'], ['motion', '有动态预览'], ['still', '静态海报']] as const).map(([id, label]) => (
                    <button key={id} type="button" className="fx-chip" aria-pressed={previewKind === id} data-on={previewKind === id ? '' : undefined} onClick={() => setPreviewKind(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fx-filtergroup">
                <span className="fx-filterlabel" id="fx-fg-impl">实现方式</span>
                <div className="fx-chips" role="group" aria-labelledby="fx-fg-impl">
                  <button type="button" className="fx-chip" aria-pressed={impl === 'all'} data-on={impl === 'all' ? '' : undefined} onClick={() => setImpl('all')}>全部</button>
                  {IMPL_IDS.map((id) => (
                    <button key={id} type="button" className="fx-chip" aria-pressed={impl === id} data-on={impl === id ? '' : undefined} onClick={() => setImpl(impl === id ? 'all' : id)}>
                      {implLabel(id)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fx-filtergroup">
                <span className="fx-filterlabel" id="fx-fg-input">输入素材</span>
                <div className="fx-chips" role="group" aria-labelledby="fx-fg-input">
                  <button type="button" className="fx-chip" aria-pressed={inputKind === 'all'} data-on={inputKind === 'all' ? '' : undefined} onClick={() => setInputKind('all')}>全部</button>
                  {INPUT_IDS.map((id) => (
                    <button key={id} type="button" className="fx-chip" aria-pressed={inputKind === id} data-on={inputKind === id ? '' : undefined} onClick={() => setInputKind(inputKind === id ? 'all' : id)}>
                      {inputLabel(id)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fx-filtergroup">
                <span className="fx-filterlabel" id="fx-fg-cx">实现复杂度 ≤</span>
                <div className="fx-chips" role="group" aria-labelledby="fx-fg-cx">
                  {COMPLEXITY_STEPS.map((n) => (
                    <button key={n} type="button" className="fx-chip num" aria-pressed={maxComplexity === n} data-on={maxComplexity === n ? '' : undefined} onClick={() => setMaxComplexity(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fx-pop-foot">
                <span>选择即生效</span>
                <button type="button" className="fx-textbtn" onClick={clearFilters} disabled={activeCount === 0}>
                  清空筛选
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {cat !== 'all' && (
        <span className="fx-activechip">
          分类 · {categoryLabel(cat)}
          <button type="button" aria-label="移除分类筛选" onClick={() => setCat('all')}><UiIcon icon={SemIcons.close} size="xs" /></button>
        </span>
      )}
      {exec !== 'all' && (
        <span className="fx-activechip">
          能力 · {execLabel(exec)}
          <button type="button" aria-label="移除能力筛选" onClick={() => setExec('all')}><UiIcon icon={SemIcons.close} size="xs" /></button>
        </span>
      )}
      {previewKind !== 'all' && (
        <span className="fx-activechip">
          预览 · {previewKind === 'motion' ? '有动态预览' : '静态海报'}
          <button type="button" aria-label="移除预览类型筛选" onClick={() => setPreviewKind('all')}><UiIcon icon={SemIcons.close} size="xs" /></button>
        </span>
      )}
      {impl !== 'all' && (
        <span className="fx-activechip">
          实现 · {implLabel(impl)}
          <button type="button" aria-label="移除实现方式筛选" onClick={() => setImpl('all')}><UiIcon icon={SemIcons.close} size="xs" /></button>
        </span>
      )}
      {inputKind !== 'all' && (
        <span className="fx-activechip">
          输入 · {inputLabel(inputKind)}
          <button type="button" aria-label="移除输入素材筛选" onClick={() => setInputKind('all')}><UiIcon icon={SemIcons.close} size="xs" /></button>
        </span>
      )}
      {maxComplexity < 5 && (
        <span className="fx-activechip">
          复杂度 ≤ {maxComplexity}
          <button type="button" aria-label="移除复杂度筛选" onClick={() => setMaxComplexity(5)}><UiIcon icon={SemIcons.close} size="xs" /></button>
        </span>
      )}
      <span className="fx-spacer" />
      {(query.trim() || activeCount > 0) && <span className="fx-result-summary" role="status">找到 {visible.length} 项技法</span>}

      <label className="fx-sort">
        <UiIcon icon={SwitchVertical01} size="xs" aria-hidden="true" />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="排序方式">
          <option value="cat">按分类</option>
          <option value="name">名称</option>
          <option value="complexity">复杂度</option>
          <option value="updated">最近更新</option>
        </select>
      </label>
    </div>
  )
}

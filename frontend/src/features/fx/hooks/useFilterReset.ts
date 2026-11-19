import type * as React from 'react'
import type { FxCategory, FxExecType, FxImpl, FxInputKind } from '@/features/fx/model/fxTechniques'
import type { Scope } from '@/features/fx/model/fxLibraryStore'

export interface UseFilterResetArgs {
  setCat: React.Dispatch<React.SetStateAction<FxCategory | 'all'>>
  setExec: React.Dispatch<React.SetStateAction<FxExecType | 'all'>>
  setImpl: React.Dispatch<React.SetStateAction<FxImpl | 'all'>>
  setInputKind: React.Dispatch<React.SetStateAction<FxInputKind | 'all'>>
  setMaxComplexity: React.Dispatch<React.SetStateAction<number>>
  setPreviewKind: React.Dispatch<React.SetStateAction<'all' | 'motion' | 'still'>>
  setQuery: React.Dispatch<React.SetStateAction<string>>
  setScope: React.Dispatch<React.SetStateAction<Scope>>
  setSourceFilter: React.Dispatch<React.SetStateAction<string>>
}

/** 技法库筛选的两档复位：只清筛选条件，或连同浏览范围与搜索词一起回到初始状态。 */
export function useFilterReset({ setCat, setExec, setImpl, setInputKind, setMaxComplexity, setPreviewKind, setQuery, setScope, setSourceFilter }: UseFilterResetArgs) {
  function resetTechFilters() {
    setExec('all')
    setInputKind('all')
    setImpl('all')
    setMaxComplexity(5)
    setPreviewKind('all')
  }

  /** 清空全部筛选（含分类），不清搜索词与范围 */
  function clearFilters() {
    resetTechFilters()
    setCat('all')
    setSourceFilter('')
  }

  function resetAll() {
    resetTechFilters()
    setCat('all')
    setSourceFilter('')
    setScope('all')
    setQuery('')
  }
  return { clearFilters, resetAll }
}

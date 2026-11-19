import type * as React from 'react'
import { useEffect } from 'react'
import { searchTechniqueIds } from '@/features/fx/services/fxApiService'

export interface UseSemanticSearchArgs {
  query: string
  setSemanticNote: React.Dispatch<React.SetStateAction<{ degraded: boolean; reason?: string } | null>>
  setSemanticOrder: React.Dispatch<React.SetStateAction<string[] | null>>
}

/** 从 FxLibrary.tsx 的 FxLibrary 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useSemanticSearch({ query, setSemanticNote, setSemanticOrder }: UseSemanticSearchArgs) {
  /* 语义检索：查询变化后延迟发起，避免每敲一个字都打一次接口。
     结果只用来排序，不做过滤 —— 过滤仍由下面的分面逻辑负责，
     否则「搜索一次就丢掉了分类/复杂度等筛选」会让人莫名其妙。 */
  useEffect(() => {
    const key = query.trim()
    if (!key) {
      setSemanticOrder(null)
      setSemanticNote(null)
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      void (async () => {
        const found = await searchTechniqueIds(key)
        if (!alive) return
        setSemanticOrder(found.usable ? found.ids : null)
        setSemanticNote(found.degraded ? { degraded: true, reason: found.reason } : null)
      })()
    }, 320)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query])
  return {  }
}

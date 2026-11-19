import { useMemo } from 'react'
import { searchBlob } from '@/features/fx/model/fxRecipe'
import type { FxTechnique, FxCategory, FxExecType, FxImpl, FxInputKind } from '@/features/fx/model/fxTechniques'
import type { FxLibState, Scope, SortKey } from '@/features/fx/model/fxLibraryStore'

export interface UseFxFilteredListArgs {
  cat: FxCategory | 'all'
  exec: 'all' | FxExecType
  impl: 'all' | FxImpl
  inputKind: 'all' | FxInputKind
  lib: FxLibState
  maxComplexity: number
  previewKind: 'all' | 'motion' | 'still'
  query: string
  scope: Scope
  selectedId: string | null
  semanticOrder: string[] | null
  sort: SortKey
  sourceFilter: string
  techniques: FxTechnique[]
}

/** 按搜索词、浏览范围和各项筛选算出技法库的可见列表、排序结果、分面计数与当前选中的技法。 */
export function useFxFilteredList({ cat, exec, impl, inputKind, lib, maxComplexity, previewKind, query, scope, selectedId, semanticOrder, sort, sourceFilter, techniques }: UseFxFilteredListArgs) {
  /** 只应用搜索：分类/范围的计数不受其它分面影响，避免数字塌陷 */
  const searched = useMemo(() => {
    const key = query.trim().toLowerCase()
    if (!key) return techniques
    /* 检索命中的优先，其余本地字面命中的排在后面。
       两者都要保留：语义检索可能漏掉用户精确输入的名字（例如刚入库、
       还没进索引的技法），把它们直接过滤掉会让用户以为搜索坏了。 */
    const literal = techniques.filter((t) => searchBlob(t).includes(key))
    if (!semanticOrder || semanticOrder.length === 0) return literal
    const semantic = semanticOrder
      .map((id) => techniques.find((t) => t.id === id))
      .filter((t): t is FxTechnique => !!t)
    const semanticIds = new Set(semantic.map((t) => t.id))
    const rest = literal.filter((t) => !semanticIds.has(t.id))
    return [...semantic, ...rest]
  }, [query, techniques, semanticOrder])

  const scoped = useMemo(() => {
    if (scope === 'featured') return searched.filter((t) => t.featured)
    if (scope === 'favorites') return searched.filter((t) => lib.favorites.includes(t.id))
    if (scope === 'recent') {
      const order = new Map(lib.recent.map((id, i) => [id, i]))
      return searched
        .filter((t) => order.has(t.id))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    }
    return searched
  }, [searched, scope, lib])

  const sources = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of techniques) {
      const name = item.sourceProject?.trim() || (item.sourceKind === 'builtin' ? '内置技法' : '来源未记录')
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN'))
  }, [techniques])

  const visible = useMemo(
    () =>
      scoped.filter(
        (t) =>
          (!sourceFilter || (t.sourceProject?.trim() || (t.sourceKind === 'builtin' ? '内置技法' : '来源未记录')) === sourceFilter) &&
          (cat === 'all' || t.category === cat) &&
          (exec === 'all' || t.execType === exec) &&
          (inputKind === 'all' || t.inputKinds.includes(inputKind)) &&
          (impl === 'all' || t.impl === impl) &&
          t.complexity <= maxComplexity &&
          (previewKind === 'all' || (previewKind === 'motion' ? !!t.previewVideo : !t.previewVideo)),
      ),
    [scoped, sourceFilter, cat, exec, inputKind, impl, maxComplexity, previewKind],
  )

  /* 可见技法的能力标签全部相同时（目前 379 项都是「知识参考」），每张卡都写一遍只是噪声；
     能力仍在详情抽屉和筛选里。出现不同能力时卡片上的标签自动回来，用来区分。 */
  const uniformExec = useMemo(() => visible.length > 0 && visible.every((t) => t.execType === visible[0].execType), [visible])

  const current = selectedId ? techniques.find((t) => t.id === selectedId) ?? null : null

  const sorted = useMemo(() => {
    const arr = [...visible]
    if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    if (sort === 'complexity') {
      arr.sort((a, b) => a.complexity - b.complexity || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    }
    if (sort === 'updated') arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return arr
  }, [visible, sort])

  const counts = useMemo(() => {
    const category = new Map<FxCategory, number>()
    for (const t of searched) category.set(t.category, (category.get(t.category) ?? 0) + 1)
    return {
      category,
      featured: searched.filter((t) => t.featured).length,
      favorites: searched.filter((t) => lib.favorites.includes(t.id)).length,
      recent: searched.filter((t) => lib.recent.includes(t.id)).length,
    }
  }, [searched, lib])

  const techActiveCount =
    (exec !== 'all' ? 1 : 0) +
    (inputKind !== 'all' ? 1 : 0) +
    (impl !== 'all' ? 1 : 0) +
    (maxComplexity < 5 ? 1 : 0) +
    (previewKind !== 'all' ? 1 : 0)
  const activeCount = techActiveCount + (cat !== 'all' ? 1 : 0) + (sourceFilter ? 1 : 0)
  return { current, searched, counts, activeCount, sources, visible, sorted, uniformExec }
}

import { categoryLabel } from '@/features/fx/model/fxFilters'
import { FX_CATEGORIES, type FxCategory, type FxTechnique } from '@/features/fx/model/fxTechniques'

/**
 * 来源库自带的二级分类（`ThemeAnimations`、`camera` 这类目录名）。
 * 与中文分类相同或为空时返回 null，界面就不再重复写一遍。
 * 见 docs/contracts/fx-library-ui.md §2。
 */
export function sourceCategory(t: Pick<FxTechnique, 'category' | 'categoryLabel'>): string | null {
  const raw = t.categoryLabel?.trim()
  if (!raw || raw === categoryLabel(t.category)) return null
  /* `camera` 之于「运镜」只是同一分类的英文标识，再写一遍是重复 */
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')
  if (norm(raw) === norm(t.category)) return null
  return raw
}

export interface FxGroup {
  id: FxCategory
  label: string
  items: FxTechnique[]
}

/**
 * 「按分类」时的分段：按 FX_CATEGORIES 的顺序，段内保持传入顺序，空段不出现。
 * 未登记的分类追加在最后，不丢条目。见契约 §6。
 */
export function groupByCategory(list: FxTechnique[]): FxGroup[] {
  const buckets = new Map<FxCategory, FxTechnique[]>()
  for (const t of list) {
    const arr = buckets.get(t.category)
    if (arr) arr.push(t)
    else buckets.set(t.category, [t])
  }
  const known = new Set(FX_CATEGORIES.map((c) => c.id))
  const groups: FxGroup[] = FX_CATEGORIES
    .filter((c) => buckets.has(c.id))
    .map((c) => ({ id: c.id, label: c.label, items: buckets.get(c.id) ?? [] }))
  for (const [id, items] of buckets) {
    if (!known.has(id)) groups.push({ id, label: categoryLabel(id), items })
  }
  return groups
}

/** GitHub 等仓库地址只显示 `host/owner/repo`；完整地址留给 href 与 title。 */
export function shortSourceUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const parts = u.pathname.split('/').filter(Boolean)
    return parts.length >= 2 ? `${host}/${parts[0]}/${parts[1]}` : `${host}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return url
  }
}

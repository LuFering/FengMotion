import { useMemo } from 'react'
import { SOURCE_LABEL, type MediaType, type MyAsset } from '@/features/assets/model/myAssets'
import type { NodeId } from '@/features/assets/model/assetTree'
import type { SortKey } from '@/features/assets/model/assetDisplay'

export interface UseAssetCollectionsArgs {
  assets: MyAsset[]
  detailId: string | null
  node: NodeId
  projectName: string | undefined
  search: string
  sortKey: SortKey
  typeFilter: 'all' | MediaType
}

/** 从 Assets.tsx 的 Assets 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useAssetCollections({ assets, detailId, node, projectName, search, sortKey, typeFilter }: UseAssetCollectionsArgs) {
  const detail = useMemo(() => assets.find((a) => a.id === detailId) ?? null, [assets, detailId])

  // ── 可见集合（统计/筛选共用同一份）──
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = assets.filter((a) => {
      if (node === 'favorites') return a.tags.includes('★')
      if (node === 'recent') return (a.lastUsedAt ?? 0) > 0
      if (node === 'project') return !!projectName && a.refs.some((r) => r.kind === 'project' && r.label === projectName)
      if (node === 'imported') return a.sourceType === 'imported'
      if (node === 'generated') return a.sourceType === 'generated'
      if (node === 'builtin') return a.sourceType === 'builtin'
      if (node === 'review:pending') return a.reviewStatus === 'pending'
      if (node === 'review:needs_review') return a.reviewStatus === 'needs_review'
      if (node === 'license:unknown') return a.licenseStatus === 'unknown'
      if (node === 'license:restricted') return a.licenseStatus === 'restricted'
      if (node === 'refs:none') return a.refs.length === 0
      if (node.startsWith('proj:')) { const pid = node.slice(5).split('|')[0]; return a.refs.some((r) => r.kind === 'project' && r.id === pid) }
      if (node.startsWith('type:')) return a.mediaType === node.slice(5)
      if (node.startsWith('folder:')) return a.folderId === node.slice(7)
      if (node.startsWith('tag:')) return a.tags.includes(node.slice(4))
      return true
    })
    if (typeFilter !== 'all') list = list.filter((a) => a.mediaType === typeFilter)
    if (q) {
      list = list.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)) ||
        (a.licenseDetails ?? '').toLowerCase().includes(q) ||
        SOURCE_LABEL[a.sourceType].includes(q))
    }
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'name': return a.name.localeCompare(b.name)
        case 'size': return b.sizeBytes - a.sizeBytes
        case 'duration': return (b.duration ?? 0) - (a.duration ?? 0)
        case 'used': return (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt)
        default: return b.createdAt - a.createdAt
      }
    })
  }, [assets, node, typeFilter, search, sortKey, projectName])

  const counts = useMemo(() => ({
    all: assets.length,
    favorites: assets.filter((a) => a.tags.includes('★')).length,
    recent: assets.filter((a) => (a.lastUsedAt ?? 0) > 0).length,
    imported: assets.filter((a) => a.sourceType === 'imported').length,
    generated: assets.filter((a) => a.sourceType === 'generated').length,
    builtin: assets.filter((a) => a.sourceType === 'builtin').length,
    project: assets.filter((a) => !!projectName && a.refs.some((r) => r.kind === 'project' && r.label === projectName)).length,
    pending: assets.filter((a) => a.reviewStatus === 'pending').length,
    needsReview: assets.filter((a) => a.reviewStatus === 'needs_review').length,
    licenseUnknown: assets.filter((a) => a.licenseStatus === 'unknown').length,
    restricted: assets.filter((a) => a.licenseStatus === 'restricted').length,
    refsNone: assets.filter((a) => a.refs.length === 0).length,
    totalBytes: assets.reduce((s, a) => s + a.sizeBytes, 0),
    type: (t: MediaType) => assets.filter((a) => a.mediaType === t).length,
    folder: (id: string) => assets.filter((a) => a.folderId === id).length,
  }), [assets, projectName])

  /** 项目划分（组织栏）：从 refs 里真实存在的项目关联合并计数，按素材数降序 */
  const projectList = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>()
    for (const a of assets) {
      const seen = new Set<string>()
      for (const r of a.refs) {
        if (r.kind !== 'project' || seen.has(r.id)) continue
        seen.add(r.id)
        const cur = m.get(r.id) ?? { label: r.label, count: 0 }
        cur.count++
        m.set(r.id, cur)
      }
    }
    return [...m.entries()].map(([id, v]) => ({ id, label: v.label, count: v.count }))
      .sort((x, y) => y.count - x.count)
  }, [assets])

  /** 标签云（组织栏）：按素材数降序，取前 10 */
  const tagList = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of assets) for (const t of a.tags) if (t !== '★') m.set(t, (m.get(t) ?? 0) + 1)
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)
  }, [assets])
  return { visible, counts, projectList, tagList, detail }
}

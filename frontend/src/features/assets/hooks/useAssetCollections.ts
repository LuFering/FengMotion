import { useMemo } from 'react'
import { type MediaType, type MyAsset } from '@/features/assets/model/myAssets'
import type { NodeId, ProjectOption } from '@/features/assets/model/assetTree'
import type { SortKey } from '@/features/assets/model/assetDisplay'

export interface UseAssetCollectionsArgs {
  assets: MyAsset[]
  detailId: string | null
  node: NodeId
  projects: ProjectOption[]
  search: string
  sortKey: SortKey
  typeFilter: 'all' | MediaType
}

/** 我的素材的派生数据：按组织栏节点、类型、搜索与排序得出可见素材，并给组织栏提供各分类计数、项目与标签列表。 */
export function useAssetCollections({ assets, detailId, node, projects, search, sortKey, typeFilter }: UseAssetCollectionsArgs) {
  const detail = useMemo(() => assets.find((a) => a.id === detailId) ?? null, [assets, detailId])

  // ── 可见集合（统计/筛选共用同一份）──
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = assets.filter((a) => {
      if (node === 'favorites') return a.tags.includes('★')
      if (node === 'recent') return (a.lastUsedAt ?? 0) > 0
      if (node === 'unassigned') return !a.projectId
      if (node === 'imported') return a.sourceType === 'imported'
      if (node === 'generated') return a.sourceType === 'generated'
      if (node === 'builtin') return a.sourceType === 'builtin'
      if (node === 'review:pending') return a.reviewStatus === 'pending'
      if (node === 'review:needs_review') return a.reviewStatus === 'needs_review'
      if (node === 'license:unknown') return a.licenseStatus === 'unknown'
      if (node === 'license:restricted') return a.licenseStatus === 'restricted'
      if (node === 'refs:none') return a.refs.length === 0
      // 按归属项目 ID，不按名称匹配：项目改名后仍对得上
      if (node.startsWith('proj:')) return a.projectId === node.slice(5)
      if (node.startsWith('type:')) return a.mediaType === node.slice(5)
      if (node.startsWith('folder:')) return a.folderId === node.slice(7)
      if (node.startsWith('tag:')) return a.tags.includes(node.slice(4))
      return true
    })
    if (q) {
      list = list.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)) ||
        (a.licenseDetails ?? '').toLowerCase().includes(q))
    }
    return list
  }, [assets, node, search])

  const typeCounts = useMemo(() => ({
    all: scoped.length,
    image: scoped.filter(a => a.mediaType === 'image').length,
    video: scoped.filter(a => a.mediaType === 'video').length,
    audio: scoped.filter(a => a.mediaType === 'audio').length,
    font: scoped.filter(a => a.mediaType === 'font').length,
    doc: scoped.filter(a => a.mediaType === 'doc').length,
  }), [scoped])

  const visible = useMemo(() => {
    const list = typeFilter === 'all' ? scoped : scoped.filter(a => a.mediaType === typeFilter)
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'name': return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
        case 'size': return b.sizeBytes - a.sizeBytes
        case 'duration': return (b.duration ?? 0) - (a.duration ?? 0)
        case 'used': return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
        default: return b.createdAt - a.createdAt
      }
    })
  }, [scoped, typeFilter, sortKey])

  const counts = useMemo(() => ({
    all: assets.length,
    favorites: assets.filter((a) => a.tags.includes('★')).length,
    recent: assets.filter((a) => (a.lastUsedAt ?? 0) > 0).length,
    imported: assets.filter((a) => a.sourceType === 'imported').length,
    generated: assets.filter((a) => a.sourceType === 'generated').length,
    builtin: assets.filter((a) => a.sourceType === 'builtin').length,
    unassigned: assets.filter((a) => !a.projectId).length,
    pending: assets.filter((a) => a.reviewStatus === 'pending').length,
    needsReview: assets.filter((a) => a.reviewStatus === 'needs_review').length,
    licenseUnknown: assets.filter((a) => a.licenseStatus === 'unknown').length,
    restricted: assets.filter((a) => a.licenseStatus === 'restricted').length,
    refsNone: assets.filter((a) => a.refs.length === 0).length,
    totalBytes: assets.reduce((s, a) => s + a.sizeBytes, 0),
    type: (t: MediaType) => assets.filter((a) => a.mediaType === t).length,
    folder: (id: string) => assets.filter((a) => a.folderId === id).length,
  }), [assets])

  /** 项目（组织栏）：来自项目列表，没有素材的项目也列出（计数 0），方便把素材移进去 */
  const projectList = useMemo(() => {
    const byProject = new Map<string, number>()
    for (const a of assets) if (a.projectId) byProject.set(a.projectId, (byProject.get(a.projectId) ?? 0) + 1)
    return projects.map((p) => ({ id: p.id, label: p.name, count: byProject.get(p.id) ?? 0 }))
  }, [assets, projects])

  /** 标签云（组织栏）：按素材数降序，取前 10 */
  const tagList = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of assets) for (const t of a.tags) if (t !== '★') m.set(t, (m.get(t) ?? 0) + 1)
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)
  }, [assets])
  return { visible, counts, typeCounts, projectList, tagList, detail }
}

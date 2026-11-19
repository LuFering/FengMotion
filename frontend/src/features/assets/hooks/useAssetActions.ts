import type * as React from 'react'
import { SOURCE_LABEL, LICENSE_LABEL, type MyAsset, type MediaType } from '@/features/assets/model/myAssets'
import { updateAsset, removeAssets, createFolder, type FolderRow } from '@/features/assets/services/assetApiService'
import { toast as emitToast } from '@/shared/lib/toast'
import type { NodeId } from '@/features/assets/model/assetTree'

export interface UseAssetActionsArgs {
  assets: MyAsset[]
  detailId: string | null
  renameText: string
  renaming: MyAsset | null
  setAssets: React.Dispatch<React.SetStateAction<MyAsset[]>>
  setDetailId: React.Dispatch<React.SetStateAction<string | null>>
  setFolders: React.Dispatch<React.SetStateAction<FolderRow[]>>
  setNode: React.Dispatch<React.SetStateAction<NodeId>>
  setRenaming: React.Dispatch<React.SetStateAction<MyAsset | null>>
  setSearch: React.Dispatch<React.SetStateAction<string>>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
  setTypeFilter: React.Dispatch<React.SetStateAction<'all' | MediaType>>
  visible: MyAsset[]
}

/** 我的素材里对素材的各项操作：打开详情、收藏、改字段、重命名、删除、复制路径、导出清单、文件夹归类、多选与网格方向键导航。 */
export function useAssetActions({ assets, detailId, renameText, renaming, setAssets, setDetailId, setFolders, setNode, setRenaming, setSearch, setSelected, setTypeFilter, visible }: UseAssetActionsArgs) {
  // ── 操作 ──
  const openDetail = (a: MyAsset) => {
    setDetailId(a.id)
    if (!a.lastUsedAt || Date.now() - a.lastUsedAt > 60_000) {
      const t = Date.now()
      void updateAsset(a.id, { lastUsedAt: t })
      setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, lastUsedAt: t } : x)))
    }
  }

  const toggleFav = (a: MyAsset) => {
    const tags = a.tags.includes('★') ? a.tags.filter((t) => t !== '★') : [...a.tags, '★']
    void updateAsset(a.id, { tags })
    setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, tags } : x)))
  }

  const applyPatch = (id: string, patch: Partial<MyAsset>) => {
    void updateAsset(id, patch)
    setAssets((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  const doRename = () => {
    if (!renaming) return
    const name = renameText.trim()
    if (name && name !== renaming.name) applyPatch(renaming.id, { name })
    setRenaming(null)
  }

  const doDelete = (ids: string[]) => {
    const refd = assets.filter((a) => ids.includes(a.id) && a.refs.length > 0)
    const msg = refd.length
      ? `以下素材仍被引用：\n${refd.map((a) => `· ${a.name} ← ${a.refs.map((r) => r.label).join('、')}`).join('\n')}\n\n服务端会拒绝删除被引用的素材；仍要尝试删除 ${ids.length} 项？`
      : `从素材库移除 ${ids.length} 项？文件会一并删除，不可恢复。`
    if (!window.confirm(msg)) return
    // 等服务端真实结果再更新界面：被引用的素材服务端会 409 拒绝，
    // 若先乐观从列表里移除，用户会以为删掉了，刷新后又冒出来。
    void removeAssets(ids).then(({ failed }) => {
      const failedIds = new Set(failed.map((f) => f.id))
      const removed = ids.filter((id) => !failedIds.has(id))
      if (removed.length > 0) {
        setAssets((prev) => prev.filter((a) => !removed.includes(a.id)))
        setSelected((s) => { const n = new Set(s); removed.forEach((i) => n.delete(i)); return n })
        if (detailId && removed.includes(detailId)) setDetailId(null)
      }
      if (failed.length > 0) {
        emitToast(`有 ${failed.length} 项未删除：${failed[0].error}`)
      }
    }).catch((error: unknown) => {
      emitToast(error instanceof Error ? error.message : '删除失败')
    })
  }

  const copyPath = async (a: MyAsset) => {
    try { await navigator.clipboard.writeText(a.filePath) } catch { /* 剪贴板不可用时静默 */ }
  }

  const exportList = (ids: string[]) => {
    const rows = assets.filter((a) => ids.includes(a.id)).map((a) => ({
      name: a.name, mediaType: a.mediaType, sizeBytes: a.sizeBytes,
      duration: a.duration, width: a.width, height: a.height,
      source: SOURCE_LABEL[a.sourceType], license: LICENSE_LABEL[a.licenseStatus],
      tags: a.tags.join(' '), path: a.filePath,
    }))
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = 'my-assets.json'; link.click()
    URL.revokeObjectURL(url)
  }

  const addFolder = () => {
    const name = window.prompt('新建文件夹名称')
    if (!name?.trim()) return
    // 文件夹由服务端建：同名会返回 409，所以这里等结果再更新界面，
    // 不能先乐观插一条再用服务端的覆盖 —— 失败时界面会多出一个不存在的文件夹。
    void createFolder(name.trim())
      .then((f) => setFolders((prev) => [...prev, f]))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '新建文件夹失败'
        emitToast(message)
      })
  }

  const moveToFolder = (ids: string[], folderId: string | null) => {
    for (const id of ids) void updateAsset(id, { folderId })
    setAssets((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, folderId } : a)))
  }

  const toggleSelect = (id: string) => {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const clearFilter = () => { setNode('all'); setSearch(''); setTypeFilter('all') }

  /** 网格方向键导航：移动焦点并同步打开检查器（G 键盘口径） */
  const onGridKeys = (e: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    const grid = e.currentTarget as HTMLElement
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.mya-card'))
    if (!cards.length) return
    const idx = cards.indexOf(document.activeElement as HTMLElement)
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length)
    let next = idx
    if (idx === -1) next = 0
    else if (e.key === 'ArrowRight') next = idx + 1
    else if (e.key === 'ArrowLeft') next = idx - 1
    else if (e.key === 'ArrowDown') next = idx + cols
    else next = idx - cols
    next = Math.min(Math.max(next, 0), cards.length - 1)
    if (next === idx) return
    e.preventDefault()
    cards[next].focus()
    const a = visible[next]
    if (a) openDetail(a)
  }
  return { clearFilter, addFolder, toggleFav, applyPatch, moveToFolder, exportList, doDelete, onGridKeys, openDetail, toggleSelect, copyPath, doRename }
}

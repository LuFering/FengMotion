import type * as React from 'react'
import { SOURCE_LABEL, LICENSE_LABEL, type MyAsset, type MediaType } from '@/features/assets/model/myAssets'
import {
  assetContentUrl,
  batchUpdateAssets,
  createFolder,
  deleteFolder,
  registerAssetAsReference,
  removeAssets,
  renameFolder,
  updateAsset,
  type FolderRow,
} from '@/features/assets/services/assetApiService'
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

/** 我的素材里对素材与文件夹的各项操作：详情、收藏、服务端确认更新、文件夹增删改、批量归类/标签、登记参考片、删除与键盘导航。 */
export function useAssetActions({
  assets,
  detailId,
  renameText,
  renaming,
  setAssets,
  setDetailId,
  setFolders,
  setNode,
  setRenaming,
  setSearch,
  setSelected,
  setTypeFilter,
}: UseAssetActionsArgs) {
  const openDetail = (a: MyAsset) => {
    setDetailId(a.id)

  }

  /**
   * 修改素材字段：以服务端返回为准更新状态；
   * 服务端拒绝（如非法审核状态跳转 409、未就绪 409、ETag 冲突）时如实提示，不伪造成功态。
   */
  const applyPatch = (id: string, patch: Partial<MyAsset>) => {
    void updateAsset(id, patch)
      .then((updated) => {
        setAssets((prev) =>
          prev.map((x) => {
            if (x.id !== id) return x
            return updated ? { ...updated, refs: updated.refs.length > 0 ? updated.refs : x.refs } : { ...x, ...patch }
          }),
        )
      })
      .catch((error: unknown) => {
        emitToast(error instanceof Error ? error.message : '修改未能保存')
      })
  }

  const toggleFav = (a: MyAsset) => {
    const tags = a.tags.includes('★') ? a.tags.filter((t) => t !== '★') : [...a.tags, '★']
    applyPatch(a.id, { tags })
  }

  const doRename = (target?: MyAsset, nextName?: string) => {
    const item = target ?? renaming
    const raw = nextName !== undefined ? nextName : renameText
    if (!item) return
    const name = raw.trim()
    if (name && name !== item.name) applyPatch(item.id, { name })
    setRenaming(null)
  }

  const doDelete = (ids: string[], skipConfirm = false) => {
    if (ids.length === 0) return
    if (!skipConfirm) {
      const refd = assets.filter((a) => ids.includes(a.id) && a.refs.length > 0)
      const msg = refd.length
        ? `以下素材仍被引用：\n${refd.map((a) => `· ${a.name} ← ${a.refs.map((r) => r.label).join('、')}`).join('\n')}\n\n服务端会拒绝删除被引用的素材；仍要继续？`
        : `从素材库删除 ${ids.length} 项？文件会一并移除，不可恢复。`
      if (!window.confirm(msg)) return
    }
    void removeAssets(ids)
      .then(({ failed }) => {
        const failedIds = new Set(failed.map((f) => f.id))
        const removed = ids.filter((id) => !failedIds.has(id))
        if (removed.length > 0) {
          setAssets((prev) => prev.filter((a) => !removed.includes(a.id)))
          setSelected((s) => {
            const n = new Set(s)
            removed.forEach((i) => n.delete(i))
            return n
          })
          if (detailId && removed.includes(detailId)) setDetailId(null)
        }
        if (failed.length > 0) {
          emitToast(`有 ${failed.length} 项未删除：${failed[0].error}`)
        } else if (removed.length > 0) {
          emitToast(removed.length === 1 ? '已删除素材' : `已删除 ${removed.length} 项素材`)
        }
      })
      .catch((error: unknown) => {
        emitToast(error instanceof Error ? error.message : '删除失败')
      })
  }

  const copyPath = async (a: MyAsset) => {
    const isStatic = a.filePath && (a.filePath.startsWith('./') || a.filePath.startsWith('/ledger/'))
    const url = isStatic ? a.filePath : assetContentUrl(a.id)
    try {
      await navigator.clipboard.writeText(url)
      emitToast('已复制文件访问地址')
    } catch {
      emitToast('当前环境无法写入剪贴板')
    }
  }

  const exportList = (ids: string[]) => {
    const rows = assets
      .filter((a) => ids.includes(a.id))
      .map((a) => ({
        id: a.id,
        name: a.name,
        mediaType: a.mediaType,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        duration: a.duration,
        width: a.width,
        height: a.height,
        source: SOURCE_LABEL[a.sourceType],
        license: LICENSE_LABEL[a.licenseStatus],
        reviewStatus: a.reviewStatus,
        tags: a.tags.filter((t) => t !== '★'),
        contentHash: a.contentHash,
      }))
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'my-assets.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  /** 内联新建文件夹 */
  const createNewFolder = async (rawName: string): Promise<FolderRow | null> => {
    const name = rawName.trim()
    if (!name) return null
    try {
      const f = await createFolder(name)
      setFolders((prev) => [...prev, f])
      emitToast(`已新建文件夹「${f.name}」`)
      return f
    } catch (error: unknown) {
      emitToast(error instanceof Error ? error.message : '新建文件夹失败')
      return null
    }
  }

  /** 兼容旧签名（若外部直接触发） */
  const addFolder = () => {
    const name = window.prompt('新建文件夹名称')
    if (name?.trim()) void createNewFolder(name)
  }

  /** 内联重命名文件夹 */
  const renameExistingFolder = async (folderId: string, rawName: string): Promise<boolean> => {
    const name = rawName.trim()
    if (!name) return false
    try {
      await renameFolder(folderId, name)
      setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name } : f)))
      emitToast(`文件夹已改名为「${name}」`)
      return true
    } catch (error: unknown) {
      emitToast(error instanceof Error ? error.message : '重命名文件夹失败')
      return false
    }
  }

  /** 内联删除文件夹（素材移回根目录） */
  const removeExistingFolder = async (folderId: string): Promise<boolean> => {
    try {
      await deleteFolder(folderId)
      setFolders((prev) => prev.filter((f) => f.id !== folderId))
      setAssets((prev) => prev.map((a) => (a.folderId === folderId ? { ...a, folderId: null } : a)))
      setNode((cur) => (cur === `folder:${folderId}` ? 'all' : cur))
      emitToast('已删除文件夹，其中素材已移回根目录')
      return true
    } catch (error: unknown) {
      emitToast(error instanceof Error ? error.message : '删除文件夹失败')
      return false
    }
  }

  /** 移动单个或多个素材到目标文件夹（null 表示移回根目录） */
  const moveToFolder = (ids: string[], folderId: string | null, folderName?: string) => {
    if (ids.length === 0) return
    void batchUpdateAssets(ids, { folderId })
      .then(({ updated, failed }) => {
        const byId = new Map(updated.map((u) => [u.id, u]))
        setAssets((prev) =>
          prev.map((a) => {
            const hit = byId.get(a.id)
            if (hit) return { ...hit, refs: hit.refs.length > 0 ? hit.refs : a.refs }
            if (ids.includes(a.id) && failed.every((f) => f.id !== a.id)) return { ...a, folderId }
            return a
          }),
        )
        if (failed.length > 0) {
          emitToast(`有 ${failed.length} 项移动失败：${failed[0].error}`)
        } else {
          emitToast(folderId ? `已移入「${folderName ?? '文件夹'}」` : '已移出文件夹')
        }
      })
      .catch((error: unknown) => {
        emitToast(error instanceof Error ? error.message : '移动文件夹失败')
      })
  }

  /** 移动单个或多个素材到目标项目（null 表示改为未归属）；只按服务端确认结果更新，不先改界面 */
  const moveToProject = (ids: string[], projectId: string | null, projectName?: string) => {
    if (ids.length === 0) return
    void batchUpdateAssets(ids, { projectId })
      .then(({ updated, failed }) => {
        const byId = new Map(updated.map((u) => [u.id, u]))
        setAssets((prev) =>
          prev.map((a) => {
            const hit = byId.get(a.id)
            return hit ? { ...hit, refs: hit.refs.length > 0 ? hit.refs : a.refs } : a
          }),
        )
        if (failed.length > 0) {
          emitToast(`有 ${failed.length} 项移动失败：${failed[0].error}`)
        } else {
          emitToast(projectId ? `已移入项目「${projectName ?? '项目'}」` : '已改为未归属')
        }
      })
      .catch((error: unknown) => {
        emitToast(error instanceof Error ? error.message : '移动到项目失败')
      })
  }

  /** 批量添加标签 */
  const batchAddTag = (ids: string[], rawTag: string) => {
    const tag = rawTag.trim()
    if (!tag || ids.length === 0) return
    void batchUpdateAssets(ids, { addTags: [tag] })
      .then(({ updated, failed }) => {
        const byId = new Map(updated.map((u) => [u.id, u]))
        setAssets((prev) =>
          prev.map((a) => {
            const hit = byId.get(a.id)
            if (hit) return { ...hit, refs: hit.refs.length > 0 ? hit.refs : a.refs }
            if (ids.includes(a.id) && failed.every((f) => f.id !== a.id)) {
              return { ...a, tags: [...new Set([...a.tags, tag])] }
            }
            return a
          }),
        )
        if (failed.length > 0) {
          emitToast(`有 ${failed.length} 项添加标签失败：${failed[0].error}`)
        } else {
          emitToast(`已为 ${ids.length} 项添加标签「${tag}」`)
        }
      })
      .catch((error: unknown) => {
        emitToast(error instanceof Error ? error.message : '添加标签失败')
      })
  }

  /** 把视频素材登记到参考片库 */
  const sendToReference = async (a: MyAsset) => {
    if (a.mediaType !== 'video') return
    try {
      const res = await registerAssetAsReference(a.id, a.name)
      if (res.deduped) {
        emitToast(`「${res.title}」已在参考片库中`)
      } else {
        emitToast(`已登记到参考片库「${res.title}」`)
      }
      setAssets((prev) =>
        prev.map((x) => {
          if (x.id !== a.id) return x
          if (x.refs.some((r) => r.kind === 'reference' && r.id === res.videoId)) return x
          return {
            ...x,
            refs: [...x.refs, { kind: 'reference', id: res.videoId, label: res.title }],
          }
        }),
      )
    } catch (error: unknown) {
      emitToast(error instanceof Error ? error.message : '登记参考片失败')
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const clearFilter = () => {
    setNode('all')
    setSearch('')
    setTypeFilter('all')
  }

  /** 网格方向键导航：移动焦点并同步打开检查器 */
  const onGridKeys = (e: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    const grid = e.currentTarget as HTMLElement
    if (!(e.target as HTMLElement).matches('.mya-card, .mya-row')) return
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.mya-card, .mya-row'))
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

  }

  return {
    clearFilter,
    addFolder,
    createNewFolder,
    renameExistingFolder,
    removeExistingFolder,
    toggleFav,
    applyPatch,
    moveToFolder,
    moveToProject,
    batchAddTag,
    sendToReference,
    exportList,
    doDelete,
    onGridKeys,
    openDetail,
    toggleSelect,
    copyPath,
    doRename,
  }
}

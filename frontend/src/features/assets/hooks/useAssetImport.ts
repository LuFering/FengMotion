import type * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { importFiles, type ImportFailure } from '../services/assetApiService'
import { isAssetDrag } from './usePendingAssets'
import type { MyAsset } from '../model/myAssets'
import { toast } from '@/shared/lib/toast'

interface Args {
  dragDepth: React.RefObject<number>
  ownDrag: React.RefObject<boolean>
  setAssets: React.Dispatch<React.SetStateAction<MyAsset[]>>
  folderId: string | null
  /** 导入时所在的项目分类；素材归属到这个项目 */
  projectId: string | null
}
interface ImportState { index: number; total: number; done: number; name: string; failed: ImportFailure[] }

export function useAssetImport({ dragDepth, ownDrag, setAssets, folderId, projectId }: Args) {
  const [importing, setImporting] = useState(false)
  const [importState, setImportState] = useState<ImportState | null>(null)
  const busy = useRef(false)
  const failedFiles = useRef<File[]>([])
  const targetFolder = useRef<string | null>(null)
  const targetProject = useRef<string | null>(null)
  const runImport = useCallback(async (files: File[], destination: string | null, project: string | null) => {
    if (!files.length) return
    if (busy.current) { toast('正在导入，请等待本批完成'); return }
    busy.current = true
    targetFolder.current = destination
    targetProject.current = project
    setImporting(true)
    setImportState({ index: 1, total: files.length, done: 0, name: files[0].name, failed: [] })
    const failures: File[] = []
    try {
      const result = await importFiles(files, event => {
        if (event.phase === 'error') failures.push(files[event.index])
        setImportState(previous => previous && ({ ...previous, index: event.index + 1, name: event.name,
          done: previous.done + (event.phase === 'done' ? 1 : 0),
          failed: event.phase === 'error' ? [...previous.failed, { name: event.name, error: event.error || '导入失败' }] : previous.failed,
        }))
      }, { folderId: destination, projectId: project })
      setAssets(previous => {
        const merged = new Map(previous.map(asset => [asset.id, asset]))
        for (const asset of result.created) merged.set(asset.id, asset)
        return [...merged.values()]
      })
      failedFiles.current = failures
    } catch (error) {
      failedFiles.current = files
      setImportState(previous => previous && ({ ...previous, failed: [{ name: '本批素材', error: error instanceof Error ? error.message : '导入失败，请重试' }] }))
    } finally {
      busy.current = false
      setImporting(false)
    }
  }, [setAssets])
  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    void runImport(files, folderId, projectId)
  }
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!ownDrag.current && !isAssetDrag(e.dataTransfer) && e.dataTransfer?.types.includes('Files')) dragDepth.current++
    }
    const over = (e: DragEvent) => {
      if (!ownDrag.current && !isAssetDrag(e.dataTransfer) && e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const leave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1) }
    const drop = (e: DragEvent) => {
      const mine = ownDrag.current || isAssetDrag(e.dataTransfer)
      ownDrag.current = false
      if (mine || !e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      dragDepth.current = 0
      void runImport(Array.from(e.dataTransfer.files), folderId, projectId)
    }
    const markOwn = () => { ownDrag.current = true }
    const clearOwn = () => { ownDrag.current = false }
    window.addEventListener('dragstart', markOwn, true)
    window.addEventListener('dragend', clearOwn, true)
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragstart', markOwn, true)
      window.removeEventListener('dragend', clearOwn, true)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [dragDepth, ownDrag, runImport, folderId, projectId])
  return { onPick, importing, importState,
    retryImport: () => void runImport(failedFiles.current, targetFolder.current, targetProject.current),
    dismissImport: () => { if (!busy.current) { failedFiles.current = []; setImportState(null) } },
  }
}

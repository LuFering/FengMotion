import type * as React from 'react'
import { useEffect } from 'react'
import { initLibrary, listAssets, listFolders, type FolderRow } from '@/features/assets/services/assetApiService'
import { hasLegacyData } from '@/features/assets/services/assetIndexedDb'
import { readAssetMigrationReport, type MigrationReport } from '@/features/assets/services/assetMigration'
import type { MyAsset } from '@/features/assets/model/myAssets'

export interface UseAssetLoadArgs {
  loadVersion: number
  setAssets: React.Dispatch<React.SetStateAction<MyAsset[]>>
  setFolders: React.Dispatch<React.SetStateAction<FolderRow[]>>
  setLegacyPending: React.Dispatch<React.SetStateAction<boolean>>
  setLoadError: React.Dispatch<React.SetStateAction<boolean>>
  setLoading: React.Dispatch<React.SetStateAction<boolean>>
  setMigration: React.Dispatch<React.SetStateAction<MigrationReport | null>>
}

/** 从 Assets.tsx 的 Assets 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useAssetLoad({ loadVersion, setAssets, setFolders, setLegacyPending, setLoadError, setLoading, setMigration }: UseAssetLoadArgs) {
  // ── 加载 ──
  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(false)
    ;(async () => {
      try {
        await initLibrary()
        const [list, fl] = await Promise.all([listAssets(), listFolders()])
        if (!alive) return
        setAssets(list.sort((a, b) => b.createdAt - a.createdAt))
        setFolders(fl)
        setLoading(false)
        // 检测旧库：有数据且尚未迁移过才提示。已经迁移过的不再打扰。
        const [legacy, report] = await Promise.all([hasLegacyData(), readAssetMigrationReport()])
        if (!alive) return
        setMigration(report)
        setLegacyPending(legacy && report?.phase !== 'migrated')
      } catch {
        if (!alive) return
        setLoadError(true)
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [loadVersion])
  return {  }
}

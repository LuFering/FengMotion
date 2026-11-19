import type * as React from 'react'
import { useCallback } from 'react'
import { migrateIndexedDbAssets, type MigrationReport } from '@/features/assets/services/assetMigration'
import { toast as emitToast } from '@/shared/lib/toast'

export interface UseAssetMigrationArgs {
  migrating: boolean
  setLegacyPending: React.Dispatch<React.SetStateAction<boolean>>
  setLoadVersion: React.Dispatch<React.SetStateAction<number>>
  setMigrating: React.Dispatch<React.SetStateAction<boolean>>
  setMigration: React.Dispatch<React.SetStateAction<MigrationReport | null>>
  setMigrationDone: React.Dispatch<React.SetStateAction<number>>
}

/** 从 Assets.tsx 的 Assets 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useAssetMigration({ migrating, setLegacyPending, setLoadVersion, setMigrating, setMigration, setMigrationDone }: UseAssetMigrationArgs) {
  // ── 导入 ──
  /* 导入：不再弹「导入队列」面板（作者要求删掉）。但过程不能一声不响 ——
     逐个文件导入要读尺寸/时长/抽缩略图，十个文件可能等好几秒。
     所以用已有的全局 toast 汇报结果：成功入库 N 个，失败的指出名字。 */
  /**
   * 把旧版浏览器素材迁移到服务端。
   *
   * 界面只做两件事：显示真实进度、迁移完刷新。规则都在 assetMigration 里：
   * 逐条校验、失败不切换、旧库只读保留。
   */
  const runMigration = useCallback(async () => {
    if (migrating) return
    setMigrating(true)
    try {
      const report = await migrateIndexedDbAssets((progress) => {
        setMigrationDone(progress.index)
      })
      setMigration(report)
      if (report.phase === 'migrated') {
        setLegacyPending(false)
        emitToast(`已迁移 ${report.migrated} 个素材到素材库`)
        setLoadVersion((v) => v + 1)
      } else {
        // 失败时不切换数据源，旧数据仍在浏览器里，用户可以重试。
        emitToast(`迁移未完成：${report.failed} 个失败，原有素材仍然保留`)
      }
    } catch (error) {
      emitToast(error instanceof Error ? error.message : '迁移失败')
    } finally {
      setMigrating(false)
    }
  }, [migrating])
  return { runMigration }
}

import { UiIcon } from '@/shared/icons/UiIcon'
import { Clock } from '@untitledui/icons'
import type { StageVisual } from '@/features/workbench/model/stageVisual'

export interface HistoryVersionNoticeProps {
  onRestoreVersion: ((version: number) => void) | undefined
  onViewLead: (() => void) | undefined
  preview: StageVisual
  projectVersionAuthoritative: boolean | undefined
  projectVersionNumber: number
}

/** 从 RightPanel.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function HistoryVersionNotice({ onRestoreVersion, onViewLead, preview, projectVersionAuthoritative, projectVersionNumber }: HistoryVersionNoticeProps) {
  return (
    <div className="mb-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs flex items-center justify-between text-amber-300">
      <span className="flex items-center gap-1.5 text-[11px] truncate">
        <UiIcon icon={Clock} size="xs" className="text-amber-400 shrink-0" />
        <span className="truncate">
          {projectVersionAuthoritative
            ? `正在查看历史 v${preview.revision}（修改将基于最新工程 v${projectVersionNumber}）`
            : `正在查看 v${preview.revision}，已知有更新的画面 v${projectVersionNumber}（工程版本未能确认）`}
        </span>
      </span>
      <div className="flex items-center gap-2 shrink-0 text-[11px]">
        <button
          type="button"
          className="text-amber-400 hover:text-white underline cursor-pointer"
          onClick={() => onRestoreVersion?.(preview.revision)}
          title="将工程代码恢复到此版本并作为修改基准"
        >
          恢复至此版
        </button>
        <button
          type="button"
          className="text-[var(--tx2)] hover:text-white cursor-pointer"
          onClick={() => onViewLead?.()}
          title="切回最新版本画面"
        >
          回到最新版
        </button>
      </div>
    </div>
  )
}

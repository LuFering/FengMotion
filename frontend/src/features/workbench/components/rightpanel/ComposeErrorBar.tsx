import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'

export interface ComposeErrorBarProps {
  adjustPendingConfirm: boolean | undefined
  canConfirmWholeProject: boolean | undefined
  onClearRealModifyError: () => void
  onConfirmWholeProject: (() => void) | undefined
  realModifyError: string
}

/** 输入区的修改失败提示条：显示错误并可关闭；需要改为整片修改时额外给出「确认整片修改」。 */
export function ComposeErrorBar({ adjustPendingConfirm, canConfirmWholeProject, onClearRealModifyError, onConfirmWholeProject, realModifyError }: ComposeErrorBarProps) {
  return (
    <div className="wb-compose-error flex items-center justify-between gap-2">
      <span className="flex-1">{realModifyError}</span>
      {(adjustPendingConfirm || canConfirmWholeProject) && (
        <button
          type="button"
          className="px-2 py-0.5 text-xs rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-medium whitespace-nowrap"
          onClick={onConfirmWholeProject}
        >
          确认整片修改
        </button>
      )}
      <button type="button" onClick={onClearRealModifyError} title="关闭"><UiIcon icon={SemIcons.close} className="size-3" /></button>
    </div>
  )
}

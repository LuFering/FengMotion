import { DropdownMenuSeparator, DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { formatMediaTime } from '@/features/workbench/model/previewGeometry'

export interface TopBarInfoContentProps {
  currentTime: number
  currentVersionLabel: string
  naturalHeight: number
  naturalWidth: number
  onOpenBrief: () => void
  projectDuration: number
  projectName: string
  timelineFps: number
}

/** 项目信息：工程设定（时长、帧率）与当前监看媒体（画幅、进度、版本），放在「更多」菜单的子菜单里，不常驻顶栏 */
export function TopBarInfoContent({ currentTime, currentVersionLabel, naturalHeight, naturalWidth, onOpenBrief, projectDuration, projectName, timelineFps }: TopBarInfoContentProps) {
  return (
    <>
      <div className="wb-topbar-info-section">
        <div className="wb-topbar-info-title">工程设定</div>
        <div className="wb-topbar-info-row">
          <span className="wb-topbar-info-key">项目</span>
          <span className="wb-topbar-info-val truncate max-w-[150px]">
            {projectName}
          </span>
        </div>
        <div className="wb-topbar-info-row">
          <span className="wb-topbar-info-key">总时长</span>
          <span className="wb-topbar-info-val">
            {formatMediaTime(projectDuration)}
          </span>
        </div>
        <div className="wb-topbar-info-row">
          <span className="wb-topbar-info-key">目标帧率</span>
          <span className="wb-topbar-info-val">{timelineFps} fps</span>
        </div>
      </div>

      <DropdownMenuSeparator />

      <div className="wb-topbar-info-section">
        <div className="wb-topbar-info-title">当前监看媒体</div>
        <div className="wb-topbar-info-row">
          <span className="wb-topbar-info-key">实测画幅</span>
          <span className="wb-topbar-info-val">
            {naturalWidth > 0 && naturalHeight > 0
              ? `${naturalWidth} × ${naturalHeight}`
              : '检测中...'}
          </span>
        </div>
        <div className="wb-topbar-info-row">
          <span className="wb-topbar-info-key">播放进度</span>
          <span className="wb-topbar-info-val">
            {formatMediaTime(currentTime)}
          </span>
        </div>
        <div className="wb-topbar-info-row">
          <span className="wb-topbar-info-key">当前版本</span>
          <span className="wb-topbar-info-val">
            {currentVersionLabel}
          </span>
        </div>
      </div>

      <DropdownMenuSeparator />
      <DropdownMenuItem className="wb-topbar-menu-item" onClick={onOpenBrief}>
        <span>查看制作诉求与要求</span>
      </DropdownMenuItem>
    </>
  )
}

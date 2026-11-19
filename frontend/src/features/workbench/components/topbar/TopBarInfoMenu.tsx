import type * as React from 'react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/shared/ui/tooltip'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { formatMediaTime } from '@/features/workbench/model/previewGeometry'

export interface TopBarInfoMenuProps {
  currentTime: number
  currentVersionLabel: string
  infoMenuOpen: boolean
  isAnyMenuOpen: boolean
  naturalHeight: number
  naturalWidth: number
  onOpenBrief: () => void
  projectDuration: number
  projectName: string
  setInfoMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  timelineFps: number
}

/** 工作台顶栏的项目信息菜单：列出项目时长、帧率和当前监看媒体的画幅、进度与版本，并可跳到制作要求。 */
export function TopBarInfoMenu({ currentTime, currentVersionLabel, infoMenuOpen, isAnyMenuOpen, naturalHeight, naturalWidth, onOpenBrief, projectDuration, projectName, setInfoMenuOpen, timelineFps }: TopBarInfoMenuProps) {
  return (
    <DropdownMenu open={infoMenuOpen} onOpenChange={setInfoMenuOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="wb-topbar-icon-btn"
              aria-label="项目信息与参数规格"
            >
              <UiIcon icon={SemIcons.info} size="md" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {!isAnyMenuOpen && (
          <TooltipContent side="bottom" sideOffset={6}>
            项目信息与参数规格
          </TooltipContent>
        )}
      </Tooltip>

      <DropdownMenuContent align="end" className="wb-topbar-menu w-64">
        <DropdownMenuLabel className="wb-topbar-menu-label">
          <span>项目信息与规格</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

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
        <DropdownMenuItem
          className="wb-topbar-menu-item text-[var(--acc)]"
          onClick={onOpenBrief}
        >
          <span>查看制作诉求与要求 ›</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

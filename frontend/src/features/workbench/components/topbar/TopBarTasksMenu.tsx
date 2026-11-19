import type * as React from 'react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/shared/ui/tooltip'
import { MediaIcon } from '@/shared/icons/MediaIcon'

export interface TopBarTasksMenuProps {
  activeTaskSummary: { title: string; state: string; error?: string } | null | undefined
  isAnyMenuOpen: boolean
  isTaskRunning: boolean
  onOpenTasks: () => void
  setTasksMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  tasksMenuOpen: boolean
}

/** 工作台顶栏的任务菜单：图标上标出是否有任务在跑，展开显示当前渲染/生成任务的状态，并可打开完整任务面板。 */
export function TopBarTasksMenu({ activeTaskSummary, isAnyMenuOpen, isTaskRunning, onOpenTasks, setTasksMenuOpen, tasksMenuOpen }: TopBarTasksMenuProps) {
  return (
    <DropdownMenu open={tasksMenuOpen} onOpenChange={setTasksMenuOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="wb-topbar-icon-btn relative"
              aria-label="查看渲染任务与生成进度"
            >
              <MediaIcon name="queueList" size={18} />
              {isTaskRunning && (
                <span
                  className="wb-topbar-task-running-dot"
                  aria-label="正在生成中"
                />
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {!isAnyMenuOpen && (
          <TooltipContent side="bottom" sideOffset={6}>
            {isTaskRunning ? '生成任务进行中，点击查看进度' : '查看渲染任务与生成进度'}
          </TooltipContent>
        )}
      </Tooltip>

      <DropdownMenuContent align="end" className="wb-topbar-menu">
        <DropdownMenuLabel className="wb-topbar-menu-label">
          <span>渲染与生成任务</span>
          <span className={isTaskRunning ? 'text-[var(--acc)]' : 'text-[var(--portal-menu-tx3)]'}>
            {isTaskRunning ? '正在执行' : '空闲'}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="wb-topbar-info-section">
          {activeTaskSummary ? (
            <>
              <div className="wb-topbar-info-row">
                <span className="wb-topbar-info-key">当前任务</span>
                <span className="wb-topbar-info-val truncate max-w-[140px]">
                  {activeTaskSummary.title}
                </span>
              </div>
              <div className="wb-topbar-info-row">
                <span className="wb-topbar-info-key">状态</span>
                <span className="wb-topbar-info-val">
                  {activeTaskSummary.state}
                </span>
              </div>
              {activeTaskSummary.error && (
                <div className="text-[11px] text-[var(--bad)] mt-1">
                  {activeTaskSummary.error}
                </div>
              )}
            </>
          ) : (
            <div className="text-[11.5px] text-[var(--portal-menu-tx3)] py-1">
              当前无排队或运行中的渲染任务
            </div>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="wb-topbar-menu-item text-[var(--acc)]"
          onClick={onOpenTasks}
        >
          <span>打开完整任务与日志面板 ›</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

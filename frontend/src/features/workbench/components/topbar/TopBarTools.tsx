import type * as React from 'react'
import { TopBarIconButton } from '@/features/workbench/components/topbar/TopBarIconButton'
import { MediaIcon } from '@/shared/icons/MediaIcon'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem } from '@/shared/ui/dropdown-menu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/shared/ui/tooltip'
import type { CapabilityResult } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import type { OverlayGuidesState } from '@/features/workbench/components/WorkbenchTopBar'

export interface TopBarToolsProps {
  aiModifyTargetCapability: CapabilityResult | undefined
  guidesMenuOpen: boolean
  isAnyMenuOpen: boolean
  isGuidesActive: boolean
  onReferenceFrame: () => void
  onSaveFrame: () => void
  onToggleOverlayGuide: (key: keyof OverlayGuidesState) => void
  onTogglePanel: () => void
  overlayGuides: OverlayGuidesState
  panelOpen: boolean
  previewReady: boolean
  setGuidesMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  /** 存帧按钮的状态；null = 收进了「更多」菜单（窄面板） */
  saveFrame: { disabled: boolean; reason: string } | null
}

/**
 * 工作台顶栏的画面工具组：画面元素列表、引用当前帧、保存当前帧、辅助显示开关和工作台全屏切换。
 *
 * <p>原来的「框选区域」按钮已去掉：暂停后直接在画面上拖拽就是框选，点击就是点选元素，不用先切模式。</p>
 */
export function TopBarTools({ aiModifyTargetCapability, guidesMenuOpen, isAnyMenuOpen, isGuidesActive, onReferenceFrame, onSaveFrame, onToggleOverlayGuide, onTogglePanel, overlayGuides, panelOpen, previewReady, setGuidesMenuOpen, saveFrame }: TopBarToolsProps) {
  return (
    <div className="wb-topbar-tools">

      {/* 引用当前帧：Vidstack comment 图标 */}
      <TopBarIconButton
        icon={<MediaIcon name="comment" size={18} />}
        label="引用当前帧到对话"
        tooltip="引用当前帧到对话"
        disabled={!previewReady || Boolean(aiModifyTargetCapability && !aiModifyTargetCapability.allowed)}
        disabledReason={aiModifyTargetCapability && !aiModifyTargetCapability.allowed ? aiModifyTargetCapability.reason : '画面还在加载'}
        onClick={onReferenceFrame}
        suppressTooltip={isAnyMenuOpen}
      />

      {/* 保存当前帧 */}
      {saveFrame && (
        <TopBarIconButton
          icon={<MediaIcon name="camera" size={18} />}
          label="保存当前画面帧 (PNG)"
          tooltip="保存当前画面帧 (PNG)"
          disabled={saveFrame.disabled}
          disabledReason={saveFrame.reason}
          onClick={onSaveFrame}
          suppressTooltip={isAnyMenuOpen}
        />
      )}

      {/* 极简细分隔线 */}
      <span className="wb-topbar-divider" aria-hidden="true" />

      {/* 辅助显示 ▾：Vidstack 规制 thirdsGrid 图标，微状态点提示 */}
      <DropdownMenu open={guidesMenuOpen} onOpenChange={setGuidesMenuOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`wb-topbar-icon-btn wb-topbar-guides-btn ${isGuidesActive ? 'wb-topbar-icon-btn-active' : ''}`}
                disabled={!previewReady}
                aria-label="画面辅助查看（三分线、安全区、规格）"
              >
                <MediaIcon name="thirdsGrid" size={18} />
                {isGuidesActive && (
                  <span
                    className="wb-topbar-active-dot"
                    aria-hidden="true"
                  />
                )}
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          {!isAnyMenuOpen && (
            <TooltipContent side="bottom" sideOffset={6}>
              画面辅助查看（三分线、安全区、规格）
            </TooltipContent>
          )}
        </Tooltip>

        <DropdownMenuContent align="start" className="wb-topbar-menu">
          <DropdownMenuLabel className="wb-topbar-menu-label">
            画面辅助显示
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={overlayGuides.thirds}
            onCheckedChange={() => onToggleOverlayGuide('thirds')}
            className="wb-topbar-menu-check-item"
          >
            三分构图网格线
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={overlayGuides.safeArea}
            onCheckedChange={() => onToggleOverlayGuide('safeArea')}
            className="wb-topbar-menu-check-item"
          >
            安全区 (90% 动作 / 80% 标题)
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={overlayGuides.mediaFacts}
            onCheckedChange={() => onToggleOverlayGuide('mediaFacts')}
            className="wb-topbar-menu-check-item"
          >
            画面规格信息浮层
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 工作台全屏：Vidstack fullscreen / fullscreenExit 图标 */}
      <TopBarIconButton
        icon={
          <MediaIcon
            name={panelOpen ? 'fullscreen' : 'fullscreenExit'}
            size={18}
          />
        }
        label={panelOpen ? '工作台全屏' : '退出工作台全屏'}
        tooltip={panelOpen ? '进入工作台全屏 (Esc 退出)' : '退出工作台全屏 (Esc)'}
        active={!panelOpen}
        onClick={onTogglePanel}
        suppressTooltip={isAnyMenuOpen}
      />
    </div>
  )
}

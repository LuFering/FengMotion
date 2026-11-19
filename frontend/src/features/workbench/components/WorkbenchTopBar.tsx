import React, { useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
/* 通用图标（下载、信息）用 lucide；media-icons 只留给截帧、引用帧、对比这类媒体语义（第三轮统一）。 */
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { MediaIcon } from '@/shared/icons/MediaIcon'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import { versionBadgeLabel, versionStanding, type ProjectVersionInfo } from '@/features/workbench/model/versionIdentity'
import type { CapabilityResult } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import '@/features/workbench/styles/workbench-topbar.css'
import { TopBarInfoMenu } from '@/features/workbench/components/topbar/TopBarInfoMenu'
import { TopBarTasksMenu } from '@/features/workbench/components/topbar/TopBarTasksMenu'
import { TopBarIconButton } from '@/features/workbench/components/topbar/TopBarIconButton'
import { TopBarTools } from '@/features/workbench/components/topbar/TopBarTools'
import { TopBarVersionMenu } from '@/features/workbench/components/topbar/TopBarVersionMenu'

export interface OverlayGuidesState {
  safeArea: boolean
  thirds: boolean
  mediaFacts: boolean
}

export interface WorkbenchTopBarProps {
  viewedPreview: StageVisual | null
  /**
   * 最新可交付整片：导出只认它，「最新 vN」也只报它。
   *
   * <p>为什么不能复用 stageLead：visuals 按创建时间排序，刚渲染的编辑器试片
   * 会排在最前。试片同样带 revision（第几次导出），拿它当项目版本号会报出
   * 「最新 v2」而场景版本其实是 v4；导出也会因为首项不是整片而被禁用，
   * 项目明明有整片却导不出来。</p>
   */
  deliverableLead?: StageVisual | null
  /**
   * 当前工程版本号（后端权威，可能没有对应的渲染画面）。
   *
   * <p>画面列表只能从「有产物文件」的场景版本里取，工程改到 v17 但还没渲出片时
   * 列表最大仍是 v16。历史判断要用这个数，否则会把当前版本判成最新。</p>
   */
  projectVersionNumber?: number | null
  /**
   * 这个工程版本号是否**权威**（后端明确返回）。
   *
   * <p>后端读不到时会退回「已知画面里最高的一版」—— 那只能说明
   * 「已知画面中它是最高」，不能证明工程没有更新。非权威时界面
   * 不得无条件标「最新工程」。</p>
   */
  projectVersionAuthoritative?: boolean
  /**
   * 当前工程版本对应的那条画面；没有时为空。
   *
   * <p>「回到最新版本」只能跳到它 —— 不能跳最新可下载整片，
   * 那可能是别的来源，或仍是历史的旧版。</p>
   */
  projectVersionVisual?: StageVisual | null
  availableVisuals: StageVisual[]
  previewReady: boolean
  comparison: [StageVisual, StageVisual] | null
  comparablePair: [StageVisual, StageVisual] | null
  regionMode: boolean
  onToggleRegion: () => void
  onReferenceFrame: () => void
  onSaveFrame: () => void
  overlayGuides: OverlayGuidesState
  onToggleOverlayGuide: (key: keyof OverlayGuidesState) => void
  panelOpen: boolean
  onTogglePanel: () => void
  onStartCompare: () => void
  onCloseCompare: () => void
  onSelectVisual: (visual: StageVisual) => void
  onOpenVersionHistory: () => void
  canExport: boolean
  onExport: () => void
  viewSwitchElement: React.ReactNode
  aiModifyTargetCapability?: CapabilityResult

  // 右侧补齐的三项全局功能
  projectName: string
  projectDuration: number
  timelineFps: number
  mediaElement: HTMLVideoElement | HTMLImageElement | null
  currentTime: number
  isTaskRunning: boolean
  activeTaskSummary?: {
    title: string
    state: string
    error?: string
  } | null
  onOpenTasks: () => void
  onResetLayout: () => void
  onOpenBrief: () => void
}

export function WorkbenchTopBar({
  viewedPreview,
  deliverableLead,
  projectVersionNumber,
  projectVersionAuthoritative,
  projectVersionVisual,
  availableVisuals,
  previewReady,
  comparison,
  comparablePair,
  regionMode,
  onToggleRegion,
  onReferenceFrame,
  onSaveFrame,
  overlayGuides,
  onToggleOverlayGuide,
  panelOpen,
  onTogglePanel,
  onStartCompare,
  onCloseCompare,
  onSelectVisual,
  onOpenVersionHistory,
  canExport,
  onExport,
  viewSwitchElement,
  aiModifyTargetCapability,
  projectName,
  projectDuration,
  timelineFps,
  mediaElement,
  currentTime,
  isTaskRunning,
  activeTaskSummary,
  onOpenTasks,
  onResetLayout,
  onOpenBrief,
}: WorkbenchTopBarProps) {
  // 菜单展开状态：展开时自动抑制 Tooltip，避免菜单与悬浮提示重叠
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const [guidesMenuOpen, setGuidesMenuOpen] = useState(false)
  const [tasksMenuOpen, setTasksMenuOpen] = useState(false)
  const [infoMenuOpen, setInfoMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)

  const isAnyMenuOpen =
    versionMenuOpen || guidesMenuOpen || tasksMenuOpen || infoMenuOpen || moreMenuOpen

  /* 「历史」的判断必须**同一条版本序列内**才成立。
     原先是 `deliverableLead ?? stageLead` 的 revision 直接与当前预览比大小 ——
     可场景版本 v4 与编辑器试片第 2 次导出不是同一条编号序列，
     比出来的「试片更旧」是假的：它既不该被标成历史，也不该缺「回到最新」入口。
     现在交给 versionIdentity 判定，跨序列一律 `uncomparable`（不标历史）。 */
  /* 历史判断分两种情况，都不能跨序列比大小：
     · 看的是**场景画面** → 与「当前工程版本号」比。这个数优先取后端权威值
       （projectVersionNumber），因此「工程已到 v17、画面只到 v16」时
       v16 会正确标成历史；只靠画面列表会把它当成最新。
     · 看的是**试片/工作流产物** → 不标历史。它们与工程版本不是同一条序列，
       硬比只会产生假标记。 */
  /* 可信度必须一起判定：后端版本读不到时，「比列表最大值旧」只能说明
     「有更新的画面存在」，不能断言「这是历史版本」。
     非权威时降级为 older_than_known —— 界面据此换文案，且不给
     「回到当前工程版本」这种断言式入口。 */
  const versionInfo: ProjectVersionInfo = {
    version: typeof projectVersionNumber === 'number' ? projectVersionNumber : null,
    source: projectVersionAuthoritative ? 'backend' : (typeof projectVersionNumber === 'number' ? 'visuals' : 'unknown'),
    authoritative: projectVersionAuthoritative === true,
  }
  const standing = versionStanding(viewedPreview, versionInfo)
  /* 「历史」标签只在**权威确认**时出现。非权威时那只是「已知最新画面比它新」，
     标成「历史」会让用户以为工程版本已确定。 */
  const isHistorical = standing === 'historical'
  /* 非权威但确实有更新的画面：给一个措辞更弱的提示 */
  const isOlderThanKnown = standing === 'older_than_known'

  // 没有预览时绝不虚构“v1”，显示为“无版本”
  const hasVersion = Boolean(viewedPreview)
  /* 场景版本写 vN；试片/工作流产物带来源前缀，避免被当成项目版本号 */
  const currentVersionLabel = versionBadgeLabel(viewedPreview)

  const isGuidesActive =
    overlayGuides.safeArea || overlayGuides.thirds || overlayGuides.mediaFacts

  // 测量当前真实视频尺寸
  const naturalWidth = mediaElement
    ? mediaElement instanceof HTMLVideoElement
      ? mediaElement.videoWidth
      : mediaElement.naturalWidth
    : 0
  const naturalHeight = mediaElement
    ? mediaElement instanceof HTMLVideoElement
      ? mediaElement.videoHeight
      : mediaElement.naturalHeight
    : 0

  return (
    <header className="wb-topbar" aria-label="工作台画面控制">
      {/* ── 第一行：[当前版本 ▾] [版本对比] ────── [渲染任务] [导出] │ [对话 | 工作台] ── */}
      <div className="wb-topbar-row wb-topbar-row-primary">
        <div className="wb-topbar-group wb-topbar-left">
          {/* 版本选择器：保留文字与微箭头，不透明弹出层 */}
          <TopBarVersionMenu availableVisuals={availableVisuals} currentVersionLabel={currentVersionLabel} deliverableLead={deliverableLead} hasVersion={hasVersion} isHistorical={isHistorical} isOlderThanKnown={isOlderThanKnown} onOpenVersionHistory={onOpenVersionHistory} onSelectVisual={onSelectVisual} projectVersionAuthoritative={projectVersionAuthoritative} projectVersionNumber={projectVersionNumber} projectVersionVisual={projectVersionVisual} setVersionMenuOpen={setVersionMenuOpen} versionMenuOpen={versionMenuOpen} viewedPreview={viewedPreview} />

          {/* 版本对比：Vidstack 官方 32×32 规制分屏图标 */}
          <TopBarIconButton
            icon={<MediaIcon name="compare" size={18} />}
            label={comparison ? '退出对比 (Esc)' : '对比版本'}
            tooltip={
              comparison
                ? '退出对比模式 (Esc)'
                : comparablePair
                  ? `对比 ${comparablePair[0].tierLabel} 与 ${comparablePair[1].tierLabel}`
                  : '对比版本'
            }
            active={Boolean(comparison)}
            disabled={!comparison && !comparablePair}
            disabledReason="当前只有一个版本，暂无可对比的对照版"
            onClick={comparison ? onCloseCompare : onStartCompare}
            suppressTooltip={isAnyMenuOpen}
          />
        </div>

        <div className="wb-topbar-group wb-topbar-right">
          {/* 渲染任务入口：Vidstack queue-list 图标，进行中带脉冲蓝点 */}
          <TopBarTasksMenu activeTaskSummary={activeTaskSummary} isAnyMenuOpen={isAnyMenuOpen} isTaskRunning={isTaskRunning} onOpenTasks={onOpenTasks} setTasksMenuOpen={setTasksMenuOpen} tasksMenuOpen={tasksMenuOpen} />

          {/* 导出最新版本：Vidstack download 图标 */}
          <TopBarIconButton
            icon={<UiIcon icon={SemIcons.download} size="md" />}
            label="导出最新版本"
            tooltip={
              deliverableLead
                ? `导出最新产出整片（v${deliverableLead.revision} · ${deliverableLead.name}）`
                : '导出最新版本'
            }
            disabled={!canExport}
            disabledReason="这次制作还没有产出整片，没有可导出的文件"
            onClick={onExport}
            suppressTooltip={isAnyMenuOpen}
          />

          {/* 细分隔线 */}
          <span className="wb-topbar-divider" aria-hidden="true" />

          {/* 对话 / 工作台切换器：固定在右上角最右侧 */}
          <div className="wb-topbar-switch-slot">{viewSwitchElement}</div>
        </div>
      </div>

      {/* ── 第二行：[引用] [框选] [保存] │ [辅助 ▾] [专注] ── [项目信息] [更多 ▾] ── */}
      <div className="wb-topbar-row wb-topbar-row-secondary">
        {comparison ? (
          /* 对比模式：精炼版本关系说明，不写死左/右 */
          <div className="wb-topbar-comparison-bar">
            <span className="wb-topbar-comparison-tag">对比模式</span>
            <span className="wb-topbar-comparison-desc">
              正在对比：{comparison[0].tierLabel} ↔ {comparison[1].tierLabel}
            </span>
          </div>
        ) : (
          /* 普通监看模式：左侧主工具 ＋ 右侧项目信息与更多操作 */
          <>
            <TopBarTools aiModifyTargetCapability={aiModifyTargetCapability} guidesMenuOpen={guidesMenuOpen} isAnyMenuOpen={isAnyMenuOpen} isGuidesActive={isGuidesActive} onReferenceFrame={onReferenceFrame} onSaveFrame={onSaveFrame} onToggleOverlayGuide={onToggleOverlayGuide} onTogglePanel={onTogglePanel} onToggleRegion={onToggleRegion} overlayGuides={overlayGuides} panelOpen={panelOpen} previewReady={previewReady} regionMode={regionMode} setGuidesMenuOpen={setGuidesMenuOpen} />

            {/* 第二行右侧：项目信息与设置、更多操作 */}
            <div className="wb-topbar-group wb-topbar-right">
              {/* 项目信息与设置：Vidstack info 图标 */}
              <TopBarInfoMenu currentTime={currentTime} currentVersionLabel={currentVersionLabel} infoMenuOpen={infoMenuOpen} isAnyMenuOpen={isAnyMenuOpen} naturalHeight={naturalHeight} naturalWidth={naturalWidth} onOpenBrief={onOpenBrief} projectDuration={projectDuration} projectName={projectName} setInfoMenuOpen={setInfoMenuOpen} timelineFps={timelineFps} />

              {/* 更多操作：Vidstack menu-horizontal 图标 */}
              <DropdownMenu open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="wb-topbar-icon-btn"
                        aria-label="更多工作台操作"
                      >
                        <MediaIcon name="menuHorizontal" size={18} />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  {!isAnyMenuOpen && (
                    <TooltipContent side="bottom" sideOffset={6}>
                      更多工作台操作
                    </TooltipContent>
                  )}
                </Tooltip>

                <DropdownMenuContent align="end" className="wb-topbar-menu">
                  <DropdownMenuItem
                    className="wb-topbar-menu-item"
                    onClick={onResetLayout}
                  >
                    <span>重置工作台布局</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="wb-topbar-menu-item"
                    onClick={() => {
                      alert('快捷键提示：\n• 空格 (Space)：播放 / 暂停\n• Esc：取消框选 / 退出对比\n• ← / →：逐帧微调\n• [ / ]：标记时间选区')
                    }}
                  >
                    <span>快捷键指南</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="wb-topbar-menu-item text-[var(--portal-menu-tx2)]"
                    onClick={onOpenVersionHistory}
                  >
                    <span>版本审阅台</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </div>
    </header>
  )
}

import React, { useState } from 'react'
import { UiIcon, SemIcons } from '@/components/icons/UiIcon'
/* 通用图标（下载、信息）用 lucide；media-icons 只留给截帧、引用帧、对比这类媒体语义（第三轮统一）。 */
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MediaIcon } from '@/components/icons/MediaIcon'
import type { StageVisual } from '@/data/stageVisual'
import { versionBadgeLabel, versionItemLabel, versionSeriesOf, versionStanding, type ProjectVersionInfo } from '@/data/versionIdentity'
import { formatMediaTime } from '@/data/previewGeometry'
import type { CapabilityResult } from '@/services/workbenchCapabilityEvaluator'
import '@/styles/workbench-topbar.css'

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

/**
 * 统一顶级纯图标按钮组件（32px 点击区域、18px 居中图标、无底色悬停轻灰、开启浅蓝）
 * 内置 Tooltip 与禁用说明，支持在有菜单展开时抑制 Tooltip 避免双层覆盖。
 */
function TopBarIconButton({
  icon,
  label,
  tooltip,
  active,
  disabled,
  disabledReason,
  onClick,
  suppressTooltip,
  className = '',
}: {
  icon: React.ReactNode
  label: string
  tooltip?: string
  active?: boolean
  disabled?: boolean
  disabledReason?: string
  onClick?: () => void
  suppressTooltip?: boolean
  className?: string
}) {
  const tooltipText = disabled ? disabledReason || tooltip || label : tooltip || label

  const button = (
    <button
      type="button"
      className={`wb-topbar-icon-btn ${active ? 'wb-topbar-icon-btn-active' : ''} ${className}`}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      onClick={disabled ? undefined : onClick}
    >
      {icon}
    </button>
  )

  if (suppressTooltip) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span className="inline-flex cursor-not-allowed">{button}</span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  )
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
          <DropdownMenu open={versionMenuOpen} onOpenChange={setVersionMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="wb-topbar-version-pill"
                data-historical={isHistorical || undefined}
                disabled={!hasVersion}
                aria-label={`当前版本 ${currentVersionLabel}`}
              >
                {isHistorical && (
                  <span className="wb-topbar-version-hist-tag">历史</span>
                )}
                <span className="wb-topbar-version-name">
                  {currentVersionLabel}
                </span>
                <MediaIcon name="chevronDown" size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="wb-topbar-menu">
              <DropdownMenuLabel className="wb-topbar-menu-label">
                <span>版本清单</span>
                {/* 【来源必须写明】这里报的是「最新可下载整片」，不是当前工程版本。
                    它可能来自工作流产物，编号与场景版本不是同一序列 ——
                    只写「最新 v3」会让用户把它当成项目版本号。
                    当前工程版本另有一行，两者分开表达。 */}
                {deliverableLead && (
                  <span className="wb-topbar-menu-latest">
                    最新可下载：{versionItemLabel(deliverableLead)}
                  </span>
                )}
              </DropdownMenuLabel>
              {/* 当前工程版本单独一行，与「最新可下载」分开。
                  非权威时明确说「未能确认」—— 不把「已知画面里最高的一版」
                  冒充成当前工程版本。 */}
              <div className="wb-topbar-version-project" data-authoritative={projectVersionAuthoritative ? 'yes' : 'no'}>
                {typeof projectVersionNumber === 'number' ? (
                  projectVersionAuthoritative ? (
                    <span>当前工程版本 v{projectVersionNumber}</span>
                  ) : (
                    <span>
                      当前工程版本未能确认（已知画面最高为 v{projectVersionNumber}，工程可能已更新）
                    </span>
                  )
                ) : (
                  <span>当前工程版本未能确认</span>
                )}
              </div>
              <DropdownMenuSeparator />

              {/* 【回到当前工程版本】只跳到「当前工程版本对应的那条画面」。
                  原先是跳 deliverableLead —— 它可能是工作流产物（另一条序列），
                  也可能在「工程 v17、可下载画面仍是 v16」时把用户带到仍是历史的 v16。
                  没有对应画面时如实说明「尚无对应画面」，不给会跳错的入口。 */}
              {(isHistorical || isOlderThanKnown) && (
                <>
                  {projectVersionVisual ? (
                    <DropdownMenuItem
                      className="wb-topbar-menu-item wb-topbar-menu-item-jump"
                      onClick={() => onSelectVisual(projectVersionVisual)}
                    >
                      {/* 命名必须与可信度一致：
                          权威时才能说「回到当前工程版本」；
                          非权威时那个数字只是「已知画面最高」，只能说「查看已知最新画面」。 */}
                      {isHistorical ? (
                        <span>回到当前工程版本 (v{projectVersionNumber})</span>
                      ) : (
                        <span>查看已知最新画面 (v{projectVersionNumber})</span>
                      )}
                    </DropdownMenuItem>
                  ) : (
                    <div className="wb-topbar-menu-item wb-topbar-menu-item-note">
                      <span>
                        {isHistorical
                          ? `当前工程版本 v${projectVersionNumber} 还没有渲染出的画面，暂无可跳转的版本`
                          : `已知最新画面 v${projectVersionNumber} 不可跳转（工程版本未能确认）`}
                      </span>
                    </div>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}

              {/* 版本列表 */}
              <div className="wb-topbar-version-list">
                {availableVisuals.map((visual) => {
                  const isCurrent = viewedPreview?.id === visual.id
                  /* 「最新」只在**权威工程版本**下才标，且必须是场景序列里版本号
                     完全相等的那一条。两层限制缺一不可：
                     · 版本号来自后端（authoritative）—— 否则只是「已知画面里最高」，
                       不能声称它就是当前工程版本；
                     · 版本号相等 —— 工程已到 v17 但 v17 没渲出片时，列表里
                       没有任何一条等于 v17，于是谁都不标「最新」。
                       这是对的：把 v16 标成最新会让用户以为工程停在那里。 */
                  const isLead = projectVersionAuthoritative === true
                    && versionSeriesOf(visual) === 'scene'
                    && typeof projectVersionNumber === 'number'
                    && visual.revision === projectVersionNumber
                  const dateStr = visual.createdAt
                    ? new Date(visual.createdAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : ''

                  return (
                    <DropdownMenuItem
                      key={visual.id}
                      className="wb-topbar-menu-item"
                      data-current={isCurrent || undefined}
                      onClick={() => onSelectVisual(visual)}
                    >
                      <div className="wb-topbar-item-info">
                        <span className="wb-topbar-item-version">
                          {versionItemLabel(visual)}
                        </span>
                        <span className="wb-topbar-item-name truncate">
                          {visual.tierLabel || visual.name}
                        </span>
                        {isLead && (
                          <span className="wb-topbar-lead-pill">最新</span>
                        )}
                        {dateStr && (
                          <span className="wb-topbar-item-time">{dateStr}</span>
                        )}
                      </div>
                      {isCurrent && (
                        <UiIcon icon={SemIcons.check} size="sm" className="ml-auto text-[var(--acc)]" />
                      )}
                    </DropdownMenuItem>
                  )
                })}
              </div>

              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="wb-topbar-menu-item text-[var(--portal-menu-tx2)]"
                onClick={onOpenVersionHistory}
              >
                <span>查看完整版本历史 ›</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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
            <div className="wb-topbar-tools">
              {/* 引用当前帧：Vidstack comment 图标 */}
              <TopBarIconButton
                icon={<MediaIcon name="comment" size={18} />}
                label="引用当前帧到对话"
                tooltip="引用当前帧到对话"
                disabled={!previewReady || Boolean(aiModifyTargetCapability && !aiModifyTargetCapability.allowed)}
                disabledReason={aiModifyTargetCapability && !aiModifyTargetCapability.allowed ? aiModifyTargetCapability.reason : "预览画面尚未就绪"}
                onClick={onReferenceFrame}
                suppressTooltip={isAnyMenuOpen}
              />

              {/* 框选区域：Vidstack 规制虚线矩形选区图标 */}
              <TopBarIconButton
                icon={<MediaIcon name="dashedBox" size={18} />}
                label="框选画面区域 (Esc 取消)"
                tooltip={regionMode ? '退出框选 (Esc)' : '框选画面区域 (Esc 取消)'}
                active={regionMode}
                disabled={!previewReady || Boolean(aiModifyTargetCapability && !aiModifyTargetCapability.allowed)}
                disabledReason={aiModifyTargetCapability && !aiModifyTargetCapability.allowed ? aiModifyTargetCapability.reason : "预览画面尚未就绪"}
                onClick={onToggleRegion}
                suppressTooltip={isAnyMenuOpen}
              />

              {/* 保存当前帧：Vidstack camera 图标 */}
              <TopBarIconButton
                icon={<MediaIcon name="camera" size={18} />}
                label="保存当前真实画面帧 (PNG)"
                tooltip="保存当前真实画面帧 (PNG)"
                disabled={!previewReady}
                disabledReason="预览画面尚未就绪"
                onClick={onSaveFrame}
                suppressTooltip={isAnyMenuOpen}
              />

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

            {/* 第二行右侧：项目信息与设置、更多操作 */}
            <div className="wb-topbar-group wb-topbar-right">
              {/* 项目信息与设置：Vidstack info 图标 */}
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

import React, { useEffect, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
/* 通用图标（下载、信息）用 lucide；media-icons 只留给截帧、引用帧、对比这类媒体语义（第三轮统一）。 */
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { MediaIcon } from '@/shared/icons/MediaIcon'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import { versionBadgeLabel, versionStanding, type ProjectVersionInfo } from '@/features/workbench/model/versionIdentity'
import type { CapabilityResult } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import '@/features/workbench/styles/workbench-topbar.css'
import { TopBarInfoContent } from '@/features/workbench/components/topbar/TopBarInfoContent'
import { TopBarTasksMenu } from '@/features/workbench/components/topbar/TopBarTasksMenu'
import { TopBarIconButton } from '@/features/workbench/components/topbar/TopBarIconButton'
import { TopBarTools } from '@/features/workbench/components/topbar/TopBarTools'
import { TopBarElements } from '@/features/workbench/components/topbar/TopBarElements'
import { TopBarLiveToggle } from '@/features/workbench/components/topbar/TopBarLiveToggle'
import type { ElementInspector } from '@/features/workbench/hooks/stage/useElementInspector'
import { TopBarVersionMenu } from '@/features/workbench/components/topbar/TopBarVersionMenu'

/** 顶栏宽度低于这个值就进入紧凑模式 */
const COMPACT_BELOW = 600
const EXPORT_DISABLED = '这次制作还没有产出整片，没有可导出的文件'
/** 快捷键表：只列真的接上了的 */
const SHORTCUTS: [string[], string][] = [
  [['空格'], '播放 / 暂停'],
  [['Esc'], '取消选择 / 退出对比'],
  [['←', '→'], '逐帧（时间线获得焦点时）'],
  [['[', ']'], '上一个 / 下一个切点'],
  [['I', 'O'], '设选区起点 / 终点'],
  [['/'], '在轨道上找元素'],
  [['+', '−', '0'], '放大 / 缩小 / 适应整片'],
  [['Shift'], '拖动时不吸附切点'],
]

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
  /** 正在显示实时画面（运行工程源码）：存帧不可用，要说明原因 */
  liveFrame?: boolean
  comparison: [StageVisual, StageVisual] | null
  comparablePair: [StageVisual, StageVisual] | null
  /** 画面元素编辑：顶栏的「元素」列表从这里读 */
  elementInspector: ElementInspector
  /** 「实时 | 成片」切换的状态 */
  live: { on: boolean; available: boolean; status: 'off' | 'starting' | 'ready' | 'unavailable'; message: string; onChange: (on: boolean) => void }
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
  liveFrame = false,
  comparison,
  comparablePair,
  elementInspector,
  live,
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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)

  const isAnyMenuOpen =
    versionMenuOpen || guidesMenuOpen || tasksMenuOpen || moreMenuOpen

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

  /* 顶栏放不下一行时（右侧窄面板），对比、导出、存帧收进「更多」 */
  const headerRef = useRef<HTMLElement>(null)
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const node = headerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < COMPACT_BELOW))
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const exportTip = deliverableLead ? `导出最新整片（v${deliverableLead.revision} · ${deliverableLead.name}）` : '导出最新版本'
  /* 实时画面是网页实时渲染的，存不了真实的帧；存帧只对成片可用 */
  const saveFrame = liveFrame
    ? { disabled: true, reason: '实时画面不能直接存图；切到「成片」可以保存出片的画面', short: '切到成片后可用' }
    : { disabled: !previewReady, reason: '画面还在加载', short: '画面还在加载' }
  const compareButton = (
    <TopBarIconButton
      icon={<MediaIcon name="compare" size={18} />}
      label={comparison ? '退出对比 (Esc)' : '对比版本'}
      tooltip={comparison ? '退出对比 (Esc)' : comparablePair ? `对比 ${comparablePair[0].tierLabel} 与 ${comparablePair[1].tierLabel}` : '对比版本'}
      active={Boolean(comparison)}
      disabled={!comparison && !comparablePair}
      disabledReason="只有一个版本，没有可对比的"
      onClick={comparison ? onCloseCompare : onStartCompare}
      suppressTooltip={isAnyMenuOpen}
    />
  )

  return (
    <header className="wb-topbar" ref={headerRef} data-compact={compact || undefined} aria-label="工作台画面控制">
      {/* 一行：[版本 ▾] [实时|成片] │ 画面工具 ──────── [对比] [任务] [导出] [⋯] │ [对话|工作台] */}
      <div className="wb-topbar-row">
        <div className="wb-topbar-group wb-topbar-left">
          <TopBarVersionMenu
            availableVisuals={availableVisuals}
            currentVersionLabel={currentVersionLabel}
            deliverableLead={deliverableLead}
            hasVersion={hasVersion}
            isHistorical={isHistorical}
            isOlderThanKnown={isOlderThanKnown}
            onOpenVersionHistory={onOpenVersionHistory}
            onSelectVisual={onSelectVisual}
            projectVersionAuthoritative={projectVersionAuthoritative}
            projectVersionNumber={projectVersionNumber}
            projectVersionVisual={projectVersionVisual}
            setVersionMenuOpen={setVersionMenuOpen}
            versionMenuOpen={versionMenuOpen}
            viewedPreview={viewedPreview}
          />

          {comparison ? (
            /* 对比模式：画面工具收起，只说明在对比什么 */
            <div className="wb-topbar-comparison-bar">
              <span className="wb-topbar-comparison-tag">对比</span>
              <span className="wb-topbar-comparison-desc">{comparison[0].tierLabel} ↔ {comparison[1].tierLabel}</span>
            </div>
          ) : (
            <>
              <TopBarLiveToggle live={live.on} available={live.available} status={live.status} message={live.message}
                                onChange={live.onChange} suppressTooltip={isAnyMenuOpen} />
              {/* 元素声明列表属于成片模式；实时模式直接在画面上点选真实元素 */}
              {!live.on && <TopBarElements inspector={elementInspector} fps={timelineFps} suppressTooltip={isAnyMenuOpen} />}
              <span className="wb-topbar-divider" aria-hidden="true" />
              <TopBarTools
                aiModifyTargetCapability={aiModifyTargetCapability}
                guidesMenuOpen={guidesMenuOpen}
                isAnyMenuOpen={isAnyMenuOpen}
                isGuidesActive={isGuidesActive}
                onReferenceFrame={onReferenceFrame}
                onSaveFrame={onSaveFrame}
                onToggleOverlayGuide={onToggleOverlayGuide}
                onTogglePanel={onTogglePanel}
                overlayGuides={overlayGuides}
                panelOpen={panelOpen}
                previewReady={previewReady}
                setGuidesMenuOpen={setGuidesMenuOpen}
                saveFrame={compact ? null : saveFrame}
              />
            </>
          )}
        </div>

        <div className="wb-topbar-group wb-topbar-right">
          {!compact && compareButton}
          <TopBarTasksMenu activeTaskSummary={activeTaskSummary} isAnyMenuOpen={isAnyMenuOpen} isTaskRunning={isTaskRunning} onOpenTasks={onOpenTasks} setTasksMenuOpen={setTasksMenuOpen} tasksMenuOpen={tasksMenuOpen} />
          {!compact && (
            <TopBarIconButton
              icon={<UiIcon icon={SemIcons.download} size="md" />}
              label="导出最新版本"
              tooltip={exportTip}
              disabled={!canExport}
              disabledReason={EXPORT_DISABLED}
              onClick={onExport}
              suppressTooltip={isAnyMenuOpen}
            />
          )}

          {/* 更多：窄面板时对比 / 导出 / 存帧收进来；项目信息、快捷键、布局重置常驻这里 */}
          <DropdownMenu open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="wb-topbar-icon-btn" aria-label="更多工作台操作">
                    <MediaIcon name="menuHorizontal" size={18} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              {!isAnyMenuOpen && <TooltipContent side="bottom" sideOffset={6}>更多</TooltipContent>}
            </Tooltip>

            <DropdownMenuContent align="end" className="wb-topbar-menu">
              {compact && (
                <>
                  <DropdownMenuItem className="wb-topbar-menu-item" disabled={!comparison && !comparablePair}
                                    onClick={comparison ? onCloseCompare : onStartCompare}>
                    <span>{comparison ? '退出对比' : '对比版本'}</span>
                    {!comparison && !comparablePair && <small className="wb-topbar-menu-why">只有一个版本</small>}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="wb-topbar-menu-item" disabled={!canExport} onClick={onExport}>
                    <span>导出最新版本</span>
                    {!canExport && <small className="wb-topbar-menu-why">还没有整片</small>}
                  </DropdownMenuItem>
                  {!comparison && (
                    <DropdownMenuItem className="wb-topbar-menu-item" disabled={saveFrame.disabled} onClick={onSaveFrame}>
                      <span>保存当前帧 (PNG)</span>
                      {saveFrame.disabled && <small className="wb-topbar-menu-why">{saveFrame.short}</small>}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="wb-topbar-menu-item">项目信息</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="wb-topbar-menu w-64">
                  <TopBarInfoContent
                    currentTime={currentTime}
                    currentVersionLabel={currentVersionLabel}
                    naturalHeight={naturalHeight}
                    naturalWidth={naturalWidth}
                    onOpenBrief={onOpenBrief}
                    projectDuration={projectDuration}
                    projectName={projectName}
                    timelineFps={timelineFps}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="wb-topbar-menu-item">快捷键</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="wb-topbar-menu wb-topbar-keys">
                  {SHORTCUTS.map(([keys, what]) => (
                    <div key={what} className="wb-topbar-key-row">
                      <span>{what}</span>
                      <span className="wb-topbar-kbds">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
                    </div>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem className="wb-topbar-menu-item" onClick={onOpenVersionHistory}>
                <span>版本审阅台</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="wb-topbar-menu-item" onClick={onResetLayout}>
                <span>重置工作台布局</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="wb-topbar-divider" aria-hidden="true" />
          <div className="wb-topbar-switch-slot">{viewSwitchElement}</div>
        </div>
      </div>
    </header>
  )
}

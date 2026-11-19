import type * as React from 'react'
import { MonitorProblemsCollapsed, type MonitorProblem } from '@/features/workbench/components/MonitorZones'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { WorkbenchTimeline } from '@/features/workbench/components/WorkbenchTimeline'
import { formatMediaTime } from '@/features/workbench/model/previewGeometry'
import { duplicateClip } from '@/features/workbench/model/timelineEdit'
import { useProjectRender } from '@/features/workbench/hooks/stage/useProjectRender'
import { useTimeRangeTarget } from '@/features/workbench/hooks/target/useTimeRangeTarget'
import { useRegionSelect } from '@/features/workbench/hooks/target/useRegionSelect'
import { useTargetReferences } from '@/features/workbench/hooks/target/useTargetReferences'
import { useTimelineManifest } from '@/features/workbench/hooks/target/useTimelineManifest'
import { useVisualSelection } from '@/features/workbench/hooks/stage/useVisualSelection'
import { useStageTimeRange } from '@/features/workbench/components/StageTimeRange'
import { useWorkbenchReview } from '@/features/workbench/hooks/useWorkbenchReview'
import { useWorkbenchSubmit } from '@/features/workbench/hooks/submit/useWorkbenchSubmit'
import { useRealModify } from '@/features/workbench/hooks/submit/useRealModify'
import type { BackendCapabilityInfo } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import type { SideTab } from '@/features/workbench/model/workbenchConsole'
import type { TaskRecord } from '@/features/creation/hooks/useAgentTasks'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import { MonitorVisual } from '@/features/workbench/components/stage/MonitorVisual'

export interface WorkbenchMonitorProps {
  agentReply: ReturnType<typeof useProjectRender>['agentReply']
  askFix: (p: MonitorProblem) => void
  awaitingActive: ReturnType<typeof useProjectRender>['awaitingActive']
  backendCapability: BackendCapabilityInfo
  chat: WorkbenchProps['chat']
  clearTimeRange: ReturnType<typeof useTimeRangeTarget>['clearTimeRange']
  endRegion: ReturnType<typeof useRegionSelect>['endRegion']
  expandedProblemId: string | null
  filmProject: ReturnType<typeof useProjectRender>['filmProject']
  filmRenderError: ReturnType<typeof useProjectRender>['filmRenderError']
  focusFeedback: ReturnType<typeof useTargetReferences>['focusFeedback']
  liveTask: { label: string; state: string; taskId: string } | null
  locateProblem: (p: MonitorProblem) => void
  loopSpan: boolean
  manifestStatus: ReturnType<typeof useTimelineManifest>['manifestStatus']
  monitorProblems: ReturnType<typeof useVisualSelection>['monitorProblems']
  moveRegion: ReturnType<typeof useRegionSelect>['moveRegion']
  notice: string
  openEdit: () => void
  openReview: (tab: SideTab) => void
  overlayGuides: ReturnType<typeof useProjectRender>['overlayGuides']
  previewDuration: number
  previewLocation: { visualId: string; timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null
  previewMediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>
  previewReady: boolean
  previewSource: ReturnType<typeof useTimeRangeTarget>['previewSource']
  previewTime: number
  projectTask: TaskRecord | null
  range: ReturnType<typeof useStageTimeRange>
  realModifyBusy: boolean
  realRenderBusy: ReturnType<typeof useProjectRender>['realRenderBusy']
  referenceTimeline: ReturnType<typeof useTimelineManifest>['referenceTimeline']
  regionMode: boolean
  regionRect: { x: number; y: number; w: number; h: number } | null
  regionStart: React.RefObject<{ sx: number; sy: number; mx: number; my: number; pointerId: number } | null>
  remoteCreationBusy: boolean
  retryBackendCapability: () => void
  review: ReturnType<typeof useWorkbenchReview>
  sceneFilmMeta: ReturnType<typeof useVisualSelection>['sceneFilmMeta']
  selectSideTab: ReturnType<typeof useTargetReferences>['selectSideTab']
  selectTimeRange: ReturnType<typeof useTimeRangeTarget>['selectTimeRange']
  selectedVisual: ReturnType<typeof useVisualSelection>['selectedVisual']
  sequenceManifest: ReturnType<typeof useTimelineManifest>['sequenceManifest']
  sequenceMovePending: ReturnType<typeof useTimelineManifest>['sequenceMovePending']
  setAgentReply: ReturnType<typeof useProjectRender>['setAgentReply']
  setBottomTab: React.Dispatch<React.SetStateAction<'versions' | 'activity' | 'changes'>>
  setFilmRenderError: ReturnType<typeof useProjectRender>['setFilmRenderError']
  setFocusChatKey: React.Dispatch<React.SetStateAction<number>>
  setLoopSpan: React.Dispatch<React.SetStateAction<boolean>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPreviewDuration: React.Dispatch<React.SetStateAction<number>>
  setPreviewFailed: React.Dispatch<React.SetStateAction<boolean>>
  setPreviewReady: React.Dispatch<React.SetStateAction<boolean>>
  setPreviewTime: React.Dispatch<React.SetStateAction<number>>
  setRegionMode: React.Dispatch<React.SetStateAction<boolean>>
  setRegionRect: React.Dispatch<React.SetStateAction<{ x: number; y: number; w: number; h: number } | null>>
  setSequenceMovePending: ReturnType<typeof useTimelineManifest>['setSequenceMovePending']
  setTargetReference: ReturnType<typeof useTimeRangeTarget>['setTargetReference']
  setTrayOpen: React.Dispatch<React.SetStateAction<boolean>>
  setUsedResources: ReturnType<typeof useProjectRender>['setUsedResources']
  sourceCreationBusy: boolean
  stage: { visuals: StageVisual[]; hasRun: boolean; lastRunStatus: 'none' | 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_info'; requestOnly: boolean }
  stageLead: StageVisual
  stageLive: boolean
  stageRef: React.RefObject<HTMLDivElement | null>
  startRegion: ReturnType<typeof useRegionSelect>['startRegion']
  submit: ReturnType<typeof useWorkbenchSubmit>['submit']
  submitProjectRender: ReturnType<typeof useProjectRender>['submitProjectRender']
  submitRealModify: ReturnType<typeof useRealModify>['submitRealModify']
  timelineFps: ReturnType<typeof useTimelineManifest>['timelineFps']
  timelineManifest: ReturnType<typeof useTimelineManifest>['timelineManifest']
  timelineOpsCapability: ReturnType<typeof useTimelineManifest>['timelineOpsCapability']
  toggleProblem: (id: string) => void
  trackClipCapability: ReturnType<typeof useTimelineManifest>['trackClipCapability']
  usedResources: ReturnType<typeof useProjectRender>['usedResources']
  viewedPreview: ReturnType<typeof useVisualSelection>['viewedPreview']
  workflowRunning: boolean
}

/**
 * 工作台中间的监看器：画面区，视频预览下方的时间线（片段与轨道操作转成待确认的修改请求），
 * 以及提示、进行中任务和问题列表。
 */
export function WorkbenchMonitor({ agentReply, askFix, awaitingActive, backendCapability, chat, clearTimeRange, endRegion, expandedProblemId, filmProject, filmRenderError, focusFeedback, liveTask, locateProblem, loopSpan, manifestStatus, monitorProblems, moveRegion, notice, openEdit, openReview, overlayGuides, previewDuration, previewLocation, previewMediaRef, previewReady, previewSource, previewTime, projectTask, range, realModifyBusy, realRenderBusy, referenceTimeline, regionMode, regionRect, regionStart, remoteCreationBusy, retryBackendCapability, review, sceneFilmMeta, selectSideTab, selectTimeRange, selectedVisual, sequenceManifest, sequenceMovePending, setAgentReply, setBottomTab, setFilmRenderError, setFocusChatKey, setLoopSpan, setNotice, setPreviewDuration, setPreviewFailed, setPreviewReady, setPreviewTime, setRegionMode, setRegionRect, setSequenceMovePending, setTargetReference, setTrayOpen, setUsedResources, sourceCreationBusy, stage, stageLead, stageLive, stageRef, startRegion, submit, submitProjectRender, submitRealModify, timelineFps, timelineManifest, timelineOpsCapability, toggleProblem, trackClipCapability, usedResources, viewedPreview, workflowRunning }: WorkbenchMonitorProps) {
  return (
    <div className="fw-monitor">
      <MonitorVisual
        agentReply={agentReply}
        awaitingActive={awaitingActive}
        backendCapability={backendCapability}
        chat={chat}
        endRegion={endRegion}
        filmProject={filmProject}
        filmRenderError={filmRenderError}
        focusFeedback={focusFeedback}
        liveTask={liveTask}
        loopSpan={loopSpan}
        moveRegion={moveRegion}
        notice={notice}
        openEdit={openEdit}
        openReview={openReview}
        overlayGuides={overlayGuides}
        previewLocation={previewLocation}
        previewMediaRef={previewMediaRef}
        previewTime={previewTime}
        projectTask={projectTask}
        range={range}
        realModifyBusy={realModifyBusy}
        realRenderBusy={realRenderBusy}
        regionMode={regionMode}
        regionRect={regionRect}
        regionStart={regionStart}
        remoteCreationBusy={remoteCreationBusy}
        retryBackendCapability={retryBackendCapability}
        review={review}
        selectedVisual={selectedVisual}
        setAgentReply={setAgentReply}
        setBottomTab={setBottomTab}
        setFilmRenderError={setFilmRenderError}
        setNotice={setNotice}
        setPreviewDuration={setPreviewDuration}
        setPreviewFailed={setPreviewFailed}
        setPreviewReady={setPreviewReady}
        setPreviewTime={setPreviewTime}
        setRegionMode={setRegionMode}
        setRegionRect={setRegionRect}
        setTrayOpen={setTrayOpen}
        setUsedResources={setUsedResources}
        sourceCreationBusy={sourceCreationBusy}
        stage={stage}
        stageLead={stageLead}
        stageLive={stageLive}
        stageRef={stageRef}
        startRegion={startRegion}
        submitProjectRender={submitProjectRender}
        submitRealModify={submitRealModify}
        timelineFps={timelineFps}
        usedResources={usedResources}
        viewedPreview={viewedPreview}
        workflowRunning={workflowRunning}
      />
      {viewedPreview?.media === 'video' && <WorkbenchTimeline
        key={viewedPreview.id} videoUrl={viewedPreview.file}
        duration={previewDuration} currentTime={previewTime} span={range.span}
        fps={timelineFps} tracks={(timelineManifest ?? referenceTimeline)?.tracks ?? []} tracksVerified={!!timelineManifest}
        trackStatus={trackClipCapability && !trackClipCapability.allowed ? trackClipCapability.reason : (manifestStatus === 'loading' ? '正在读取轨道信息' : manifestStatus === 'missing' ? '当前项目没有轨道清单' : manifestStatus === 'invalid' ? '轨道清单格式无效' : manifestStatus === 'error' ? '轨道信息读取失败' : !sequenceManifest?.sourceHash || !sceneFilmMeta?.sourceHash ? '缺少版本校验信息，无法确认轨道归属' : '轨道清单与当前版本不匹配')}
        looping={loopSpan}
        timelineOpsCapability={timelineOpsCapability}
        trackClipCapability={trackClipCapability}
        /* 上限按「能看清单帧」定：最细视野 = 12 帧（30fps 约 0.4 秒），
           一帧约占视野 1/12，足以逐帧对照。原来固定 1.5 秒视野，
           4 秒的片子只能放到 2.7 倍，根本看不到细节。 */
        maxZoom={Math.max(1, Math.min(240, previewDuration * 30 / 12))}
        disabled={!previewReady || realModifyBusy || realRenderBusy || workflowRunning || remoteCreationBusy}
        onToggleLoop={() => {
          const media = previewMediaRef.current
          if (!loopSpan && range.span && media instanceof HTMLVideoElement) {
            if (media.currentTime < range.span.start || media.currentTime >= range.span.end) media.currentTime = range.span.start
            void media.play().catch(() => setNotice('无法播放选区'))
          }
          setLoopSpan((on) => !on)
        }}
        onSeek={(seconds) => { const media = previewMediaRef.current; if (media instanceof HTMLVideoElement) { media.currentTime = seconds; setPreviewTime(seconds) } }}
        onSpanChange={range.setSpan} onSpanCommit={selectTimeRange} onClear={clearTimeRange}
        onClipReference={(clip, track) => {
          if (!viewedPreview) return
          if (!trackClipCapability.allowed) {
            setNotice(trackClipCapability.reason || '当前轨道片段无法作为修改目标')
            return
          }
          const span = { start: clip.start, end: Math.min(previewDuration, clip.start + clip.duration) }
          if (span.end <= span.start) return
          selectTimeRange(span)
          setTargetReference({
            id: `clip:${JSON.stringify([viewedPreview.id, track.id, clip.id])}`,
            role: 'target', kind: 'preview', source: previewSource(viewedPreview),
            timeSeconds: span.start, endTimeSeconds: span.end,
            label: `${viewedPreview.tierLabel} · ${track.name} · ${clip.name} · ${formatMediaTime(span.start)}–${formatMediaTime(span.end)}`,
          })
          selectSideTab('chat')
          setFocusChatKey((key) => key + 1)
        }}
        onClipAction={(action, clip, track) => {
          /* 删除 / 复制 / 拆分同样不直接改代码：转成一条明确的请求，
             由用户确认后交给 AI。复制先按同轨约束算出合法落点。 */
          if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause()
          let brief = ''
          let next = { start: clip.start, duration: clip.duration }
          let intent: 'move' | 'trim-start' | 'trim-end' = 'move'
          if (action === 'remove') {
            brief = `删掉「${track.name}」轨道上的「${clip.name}」这一整段，其余内容与时间不变。`
          } else if (action === 'split') {
            brief = `在 ${formatMediaTime(previewTime)} 把「${track.name}」轨道上的「${clip.name}」切成两段，切点前后内容连续、总时长不变；其余内容不动。`
          } else {
            const placed = track ? duplicateClip(track, clip, clip.start + clip.duration, previewDuration) : null
            if (!placed) { setNotice('这条轨道没有放得下的空位，先挪开别的片段再复制。'); return }
            next = { start: placed.clip.start, duration: placed.clip.duration }
            intent = 'move'
            brief = `把「${track.name}」轨道上的「${clip.name}」复制一份，放到 ${formatMediaTime(placed.clip.start)} 开始，原片段保留；其余内容不动。`
          }
          setSequenceMovePending({ item: clip, next, brief, intent, label: action === 'remove' ? '删除' : action === 'split' ? '拆分' : '复制' })
        }}
        pending={sequenceMovePending}
        onPendingAccept={() => {
          if (!sequenceMovePending) return
          const request = sequenceMovePending
          const span = 'item' in request
            ? { start: request.item.start, end: Math.min(previewDuration, request.item.start + request.item.duration) }
            : null
          void (span && span.end > span.start ? submitRealModify(request.brief, span) : submit(request.brief))
            .then((ok) => { if (ok) setSequenceMovePending((current) => current === request ? null : current) })
        }}
        onPendingDrop={() => setSequenceMovePending(null)}
        onSequenceMove={(item, next, intent, track) => {
          /* 拖动片段不直接改代码，也不假装能写进输入框：
             LeiBox 输入框是官方原版、文本不收外部控制。所以把这次调整
             记成一条「待发送的调整」，由用户确认后提交给 AI。 */
          if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause()
          const from = formatMediaTime(item.start)
          const to = formatMediaTime(next.start)
          const before = (item.duration).toFixed(2)
          const after = (next.duration).toFixed(2)
          const brief = intent === 'trim-start'
            ? `把「${item.name}」的起点从 ${from} 改到 ${to}，时长由 ${before} 秒变为 ${after} 秒；其余元素与节奏不变。`
            : intent === 'trim-end'
              ? `把「${item.name}」的终点改到 ${formatMediaTime(next.start + next.duration)}，时长由 ${before} 秒变为 ${after} 秒；其余元素与节奏不变。`
              : `把「${item.name}」从 ${from} 移到 ${to}，时长保持 ${before} 秒；其余元素与节奏不变。`
          setSequenceMovePending({ item, next, brief: `目标轨道「${track.name}」。${brief}`, intent })
        }}
        onTrackAction={(action, track) => {
          /* 轨道显隐也不直接改代码：生成一条明确的请求，确认后交给 AI。
             这样时间线看到的始终是「工程当前真实版本」，不出现 UI 先行撒谎。 */
          if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause()
          const parts = track.name.split(/\s*[·・]\s*/, 2)
          const title = parts.length > 1 ? parts[1] : track.name
          const brief = action === 'toggle-visibility'
            ? (track.hidden
              ? `把「${title}」这条轨道重新显示出来，其他轨道、元素和时间不变。`
              : `把「${title}」这条轨道隐藏起来（不参与画面），其他轨道、元素和时间不变。`)
            : (track.muted
                ? `取消「${title}」这条轨道的静音，恢复它的声音，画面和其他轨道不变。`
                : `把「${title}」这条轨道静音，保留画面但不发声，其他轨道和元素不变。`)
          const label = action === 'toggle-visibility'
            ? (track.hidden ? '显示轨道' : '隐藏轨道')
            : (track.muted ? '取消静音' : '静音轨道')
          setSequenceMovePending({ brief, label })
        }} />}
      {/* 提示不该只在「没有画面」时出现：轨道操作失败（例如复制放不下）
          也走这里，而那时画面上通常是有内容的。 */}
      {notice && (
        <button type="button" className="fw-mon-notice" onClick={() => setNotice('')}>
          {notice}<UiIcon icon={SemIcons.close} className="ml-1 inline size-3" />
        </button>
      )}

      {/* 缩略条与交付信息行已按要求移除：
          缩略条是「这一档画面有哪几个版本」，和控制台的「场景版本」页签重复；
          交付信息（最终文件 / 输出规格 / 审片 / 检查）属于交付环节，
          挂在监看器下面只是把画面往下挤。画面区只留画面本身。 */}
      {liveTask && (
        <div className="fw-mon-rail">
          <span className="fw-mon-task">
            <span className="fm-dot" data-s="running" />
            {liveTask.state} · {liveTask.label}
          </span>
        </div>
      )}
      <MonitorProblemsCollapsed problems={monitorProblems} expandedId={expandedProblemId}
                                onToggle={toggleProblem} onLocate={locateProblem} onAskFix={askFix} />

    </div>
  )
}

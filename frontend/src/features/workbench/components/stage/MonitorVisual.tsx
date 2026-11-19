import { MonitorMediaPreview } from '@/features/workbench/components/MonitorZones'
import { StageFrame } from '@/features/workbench/components/StageFrame'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { MonitorOverlayGuides } from '@/features/workbench/components/MonitorOverlayGuides'
import { MonitorStageEmpty } from '@/features/workbench/components/MonitorStageEmpty'
import type { WorkbenchMonitorProps } from '@/features/workbench/components/stage/WorkbenchMonitor'

export interface MonitorVisualProps {
  agentReply: WorkbenchMonitorProps['agentReply']
  awaitingActive: WorkbenchMonitorProps['awaitingActive']
  backendCapability: WorkbenchMonitorProps['backendCapability']
  chat: WorkbenchMonitorProps['chat']
  endRegion: WorkbenchMonitorProps['endRegion']
  filmProject: WorkbenchMonitorProps['filmProject']
  filmRenderError: WorkbenchMonitorProps['filmRenderError']
  focusFeedback: WorkbenchMonitorProps['focusFeedback']
  liveTask: WorkbenchMonitorProps['liveTask']
  loopSpan: WorkbenchMonitorProps['loopSpan']
  moveRegion: WorkbenchMonitorProps['moveRegion']
  notice: WorkbenchMonitorProps['notice']
  openEdit: WorkbenchMonitorProps['openEdit']
  openReview: WorkbenchMonitorProps['openReview']
  overlayGuides: WorkbenchMonitorProps['overlayGuides']
  previewLocation: WorkbenchMonitorProps['previewLocation']
  previewMediaRef: WorkbenchMonitorProps['previewMediaRef']
  previewTime: WorkbenchMonitorProps['previewTime']
  projectTask: WorkbenchMonitorProps['projectTask']
  range: WorkbenchMonitorProps['range']
  realModifyBusy: WorkbenchMonitorProps['realModifyBusy']
  realRenderBusy: WorkbenchMonitorProps['realRenderBusy']
  regionMode: WorkbenchMonitorProps['regionMode']
  regionRect: WorkbenchMonitorProps['regionRect']
  regionStart: WorkbenchMonitorProps['regionStart']
  remoteCreationBusy: WorkbenchMonitorProps['remoteCreationBusy']
  retryBackendCapability: WorkbenchMonitorProps['retryBackendCapability']
  review: WorkbenchMonitorProps['review']
  selectedVisual: WorkbenchMonitorProps['selectedVisual']
  setAgentReply: WorkbenchMonitorProps['setAgentReply']
  setBottomTab: WorkbenchMonitorProps['setBottomTab']
  setFilmRenderError: WorkbenchMonitorProps['setFilmRenderError']
  setNotice: WorkbenchMonitorProps['setNotice']
  setPreviewDuration: WorkbenchMonitorProps['setPreviewDuration']
  setPreviewFailed: WorkbenchMonitorProps['setPreviewFailed']
  setPreviewReady: WorkbenchMonitorProps['setPreviewReady']
  setPreviewTime: WorkbenchMonitorProps['setPreviewTime']
  setRegionMode: WorkbenchMonitorProps['setRegionMode']
  setRegionRect: WorkbenchMonitorProps['setRegionRect']
  setTrayOpen: WorkbenchMonitorProps['setTrayOpen']
  setUsedResources: WorkbenchMonitorProps['setUsedResources']
  sourceCreationBusy: WorkbenchMonitorProps['sourceCreationBusy']
  stage: WorkbenchMonitorProps['stage']
  stageLead: WorkbenchMonitorProps['stageLead']
  stageLive: WorkbenchMonitorProps['stageLive']
  stageRef: WorkbenchMonitorProps['stageRef']
  startRegion: WorkbenchMonitorProps['startRegion']
  submitProjectRender: WorkbenchMonitorProps['submitProjectRender']
  submitRealModify: WorkbenchMonitorProps['submitRealModify']
  timelineFps: WorkbenchMonitorProps['timelineFps']
  usedResources: WorkbenchMonitorProps['usedResources']
  viewedPreview: WorkbenchMonitorProps['viewedPreview']
  workflowRunning: WorkbenchMonitorProps['workflowRunning']
}

/**
 * 监看器的画面区：播放选中的素材或当前查看的预览（含框选区域与辅助线），没有画面时显示开始制作的引导；
 * 下方附带本次使用的资源、本轮说明、渲染失败和后端能力不足等提示。
 */
export function MonitorVisual({ agentReply, awaitingActive, backendCapability, chat, endRegion, filmProject, filmRenderError, focusFeedback, liveTask, loopSpan, moveRegion, notice, openEdit, openReview, overlayGuides, previewLocation, previewMediaRef, previewTime, projectTask, range, realModifyBusy, realRenderBusy, regionMode, regionRect, regionStart, remoteCreationBusy, retryBackendCapability, review, selectedVisual, setAgentReply, setBottomTab, setFilmRenderError, setNotice, setPreviewDuration, setPreviewFailed, setPreviewReady, setPreviewTime, setRegionMode, setRegionRect, setTrayOpen, setUsedResources, sourceCreationBusy, stage, stageLead, stageLive, stageRef, startRegion, submitProjectRender, submitRealModify, timelineFps, usedResources, viewedPreview, workflowRunning }: MonitorVisualProps) {
  return (
    <div className="fw-mon-visual">
      {selectedVisual && !viewedPreview ? (
        <MonitorMediaPreview key={selectedVisual.id} item={selectedVisual} />
      ) : viewedPreview ? (
        /* 这次制作做出来的那一档画面（测试帧 / 试片 / 粗略整片 / 整片）。
           只放画面本身：档位、名字和「这是哪次运行」都在上方的工具条与缩略入口里。 */
        <div className="fw-stage fw-stage-frame" ref={stageRef}>
          <StageFrame key={viewedPreview.id} visual={viewedPreview} mediaRef={previewMediaRef} onTime={setPreviewTime} currentTime={previewTime} onReady={(ready) => {
            setPreviewReady(ready)
            if (ready) setPreviewFailed(false)
          }} onFailed={setPreviewFailed} onDuration={setPreviewDuration} loopSpan={loopSpan ? range.span : null} location={previewLocation}/>
          {notice && (
            <button type="button" className="fw-mon-notice-inline" onClick={() => setNotice('')}>
              {notice}<UiIcon icon={SemIcons.close} className="ml-1 inline size-3" />
            </button>
          )}
          {regionMode && (
            <div className="fw-region-layer" onPointerDown={startRegion} onPointerMove={moveRegion} onPointerUp={endRegion} onPointerCancel={() => { regionStart.current = null; setRegionMode(false); setRegionRect(null) }}>
              <div className="fw-region-hint">拖拽框选画面区域 · Esc 取消</div>
              {regionRect && <div className="fw-region-box" style={{ left: `${regionRect.x * 100}%`, top: `${regionRect.y * 100}%`, width: `${regionRect.w * 100}%`, height: `${regionRect.h * 100}%` }} />}
            </div>
          )}
          {/* 辅助查看覆盖层（紧密贴合真实画面矩形，无画面不猜数值） */}
          <MonitorOverlayGuides
            mediaRef={previewMediaRef}
            overlayGuides={overlayGuides}
            fps={timelineFps}
          />
        </div>
      ) : (
        <MonitorStageEmpty stage={awaitingActive && !stageLive ? { ...stage, lastRunStatus: 'awaiting_info' } : stage} realRunning={Boolean(liveTask && !projectTask?.task.mock) || workflowRunning || sourceCreationBusy || remoteCreationBusy} brief={review.brief.original} correctionCount={review.corrections.length}
                           onDiscuss={() => openReview('brief')} onEdit={openEdit}
                           onRealRender={() => void (filmProject?.ready ? submitProjectRender() : awaitingActive ? focusFeedback() : submitRealModify(review.brief.original || chat.draft))} realRenderBusy={realRenderBusy || realModifyBusy || workflowRunning || remoteCreationBusy}
                           renderTargetLabel={filmProject?.ready ? '渲染项目工程' : awaitingActive ? '补充制作要求' : '开始制作'}
                           onOpenExecution={() => { setBottomTab('activity'); setTrayOpen(true) }} />
      )}
      {usedResources.length > 0 && (
      <div className="fw-mon-notice" role="status">
        <strong>本次交给 agent 的资源：</strong>
        {usedResources.map((r) => {
          const where = r.kind === 'reference' && r.startMs != null && r.endMs != null
            ? ` · ${(r.startMs / 1000).toFixed(1)}s–${(r.endMs / 1000).toFixed(1)}s`
            : ''
          return <span key={`${r.kind}:${r.id}`}>{r.label}（{r.usage}{where}） </span>
        })}
        <button type="button" onClick={() => setUsedResources([])} aria-label="关闭"><UiIcon icon={SemIcons.close} className="ml-1 inline size-3" /></button>
      </div>
      )}
      {/* agent 这轮说了什么，左侧对话里已经有了（appendMessage / 恢复时写入）。
        这里只在对话尚未收到这条回复时才补一条 —— 两处同时显示同一句话，
        等于把同一条信息说两遍，还把画面区往下挤。 */}
      {agentReply && !chat.messages.some((m) => m.role === 'ai' && m.text === agentReply) && (
      <div className="fw-mon-notice fw-mon-agent-result" role="status">
        <details className="wb-result-details">
          <summary aria-label="本轮说明"><span className="wb-result-heading">本轮说明</span><span className="wb-result-preview">{agentReply}</span><span className="wb-result-toggle" aria-hidden="true"><span className="wb-result-open">展开</span><span className="wb-result-close">收起</span><UiIcon icon={SemIcons.collapse} size="sm" /></span></summary>
          <p>{agentReply}</p>
        </details>
        <button type="button" onClick={() => setAgentReply('')} aria-label="关闭"><UiIcon icon={SemIcons.close} className="ml-1 inline size-3" /></button>
      </div>
      )}
      {filmRenderError && !stageLead && (
      <div className="fw-mon-notice" role="alert">
        项目工程渲染失败：{filmRenderError.slice(0, 300)}
        <button type="button" onClick={() => setFilmRenderError('')} aria-label="关闭"><UiIcon icon={SemIcons.close} className="ml-1 inline size-3" /></button>
      </div>
      )}
      {/* 后端能力探测失败：说清缺的是什么，并给一个重新检测的入口 ——
        否则后端在打开项目之后才启动，界面会一直停在不可用状态。 */}
      {backendCapability.status === 'connection_error' && (
      <div className="fw-mon-notice" role="alert">
        未能连接后端，画面与时间段的引用暂不可用：{backendCapability.error || '连接失败'}
        <button
          type="button"
          className="ml-1.5 underline"
          onClick={retryBackendCapability}
        >
          重新检测
        </button>
      </div>
      )}
      {backendCapability.status === 'unsupported' && (
      <div className="fw-mon-notice" role="status">
        当前后端能力不完整：画面引用{backendCapability.imageSupported ? '可用' : `缺少${(backendCapability.missingForImage ?? []).join('、') || '所需接口'}`}；时间段修改{backendCapability.spanSupported ? '可用' : `缺少${(backendCapability.missingForSpan ?? []).join('、') || '所需接口'}`}。
        <button type="button" className="ml-1.5 underline" onClick={retryBackendCapability}>重新检测</button>
      </div>
      )}
    </div>
  )
}

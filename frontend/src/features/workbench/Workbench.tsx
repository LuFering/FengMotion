import '@/features/workbench/styles/workbench-page-chrome.css'
import { useEffect, useRef, useState } from 'react'
import { studioHttpApi } from '@/api'
import { ResourcePicker } from '@/features/workbench/components/ResourcePicker'
import { libraryReferences } from '@/features/creation/services/creationResources'
import { RailProgressPanel } from '@/features/workbench/components/RailProgress'
import { type ProjectSummary } from '@/features/project/model/projects'
import { ACTIVE_DURATION, FILM_FPS } from '@/demo/timeline'
import { useAgentTasks } from '@/features/creation/hooks/useAgentTasks'
import type { ProjectSceneState } from '@/api/taskClient'
import type { ModificationConstraints, TaskEvent } from '@/api/studioApi'
import { evaluateGate, GATE_PRIMARY_KIND, workflowService } from '@/features/workflow/services/workflowService'
import { stageState, type StageVisual } from '@/features/workbench/model/stageVisual'
import { versionStanding } from '@/features/workbench/model/versionIdentity'
import { formatMediaTime } from '@/features/workbench/model/previewGeometry'
import { type MonitorProblem, type MonitorVisualItem } from '@/features/workbench/components/MonitorZones'
import { VISUAL_KIND_LABEL } from '@/features/workbench/model/monitorVisual'
import type { ChatState } from '@/features/chat/hooks/useChat'
import { type SideTab } from '@/features/workbench/model/workbenchConsole'
import { ProjectRail } from '@/features/workbench/components/ProjectRail'
import { BottomTray } from '@/features/workbench/components/BottomTray'
import { ConsoleChrome } from '@/features/workbench/components/ConsoleChrome'
import { ArtifactView } from '@/features/workbench/components/ArtifactView'
import { recordRoundOutcome } from '@/features/chat/model/roundOutcomes'
import { invalidateBackfill } from '@/features/chat/services/roundOutcomeBackfill'
import { SceneEditorWorkspace } from '@/features/scene-editor/SceneEditorWorkspace'
import { WorkbenchTopBar } from '@/features/workbench/components/WorkbenchTopBar'
import type { ViewId } from '@/shared/navigation/views'
import { WorkflowExecutionLog } from '@/features/workbench/components/WorkbenchReview'
import { WorkbenchPreviewCompare } from '@/features/workbench/components/WorkbenchPreviewCompare'
import { BriefDetailWorkspace, type BriefSection } from '@/features/workbench/components/BriefDetailWorkspace'
import { TaskDetailWorkspace } from '@/features/workbench/components/TaskDetailWorkspace'
import { useSceneVersions } from '@/features/workbench/hooks/useSceneVersions'
import { useElementInspector } from '@/features/workbench/hooks/stage/useElementInspector'
import { useLivePreview } from '@/features/workbench/hooks/stage/useLivePreview'
import { useLiveAskAi } from '@/features/workbench/hooks/stage/useLiveAskAi'
import type { SessionsState } from '@/features/chat/hooks/useSessions'
import { useStageTimeRange } from '@/features/workbench/components/StageTimeRange'
import { type BackendCapabilityInfo } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import '@/features/workbench/styles/workbench-timeline.css'
import '@/features/workbench/styles/workbench-review.css'
import '@/features/workbench/styles/workbench-desk.css'
import '@/features/workbench/styles/workbench-timerange.css'
import '@/features/workbench/styles/open-workbench.css'

import { INITIAL_FRAME, readCorrectionAttempt } from '@/features/workbench/model/workbenchSession'
import { useWorkbenchExport } from '@/features/workbench/hooks/stage/useWorkbenchExport'
import { useWorkbenchSubmit } from '@/features/workbench/hooks/submit/useWorkbenchSubmit'
import { useRealModify } from '@/features/workbench/hooks/submit/useRealModify'
import { useReviewOpinionLocate } from '@/features/workbench/hooks/review/useReviewOpinionLocate'
import { useSubmitQueue } from '@/features/workbench/hooks/submit/useSubmitQueue'
import { useRegionSelect } from '@/features/workbench/hooks/modify-target/useRegionSelect'
import { useTargetReferences } from '@/features/workbench/hooks/modify-target/useTargetReferences'
import { useTimeRangeTarget } from '@/features/workbench/hooks/modify-target/useTimeRangeTarget'
import { useTimelineManifest } from '@/features/workbench/hooks/modify-target/useTimelineManifest'
import { useVisualSelection } from '@/features/workbench/hooks/stage/useVisualSelection'
import { useProjectRender } from '@/features/workbench/hooks/stage/useProjectRender'
import { useUnsavedReplies } from '@/features/workbench/hooks/session/useUnsavedReplies'
import { WorkbenchProjectBar } from '@/features/workbench/components/WorkbenchProjectBar'
import { WorkbenchMonitor } from '@/features/workbench/components/stage/WorkbenchMonitor'
import { WorkbenchConsole } from '@/features/workbench/components/console/WorkbenchConsole'
import { useDraftText } from '@/features/workbench/hooks/session/useDraftText'
import { useBoundSession } from '@/features/workbench/hooks/session/useBoundSession'
import { useSceneEditEntry } from '@/features/workbench/hooks/stage/useSceneEditEntry'
import { useProblemTracking } from '@/features/workbench/hooks/review/useProblemTracking'
import { useStageVisuals } from '@/features/workbench/hooks/stage/useStageVisuals'
import { useStageRail } from '@/features/workbench/hooks/stage/useStageRail'
import { useReviewContext } from '@/features/workbench/hooks/review/useReviewContext'
import { useWorkflowDecisions } from '@/features/workbench/hooks/review/useWorkflowDecisions'

export interface WorkbenchProps {
  chat: ChatState
  /** 任务记录（含执行过程）—— 由 App 注入：总览页的「任务活动」读的是同一份 */
  tasks: ReturnType<typeof useAgentTasks>
  onNavigate: (view: ViewId) => void
  /** 当前打开的项目 id —— 由一级目录传入 */
  projectId: string
  /** 项目目录（含内存里新建的项目）；不传时退回种子数据 */
  projects?: ProjectSummary[]
  /** 返回项目列表 */
  onBack: () => void
  /** 换一个项目（工作台里直接切，不用先回列表） */
  onSwitchProject: (id: string) => void
  /** 创作启动层刚建好的「本次制作」——双路径都落工作台，在这里执行与呈现 */
  launch?: { workflowId: string; autoRun: boolean } | null
  /** 从本次制作深链回方法工坊（工作流编辑器） */
  onOpenWorkflowEditor?: (workflowId: string) => void
  onDismissLaunch?: () => void
  /** 当前项目绑定的会话 id（由外层维护；为 null 表示当前项目尚无会话） */
  sessionId?: string | null
  /** 会话管理状态（与对话区共用，打通历史读取、新建与双向同步） */
  threads?: SessionsState
  /** 切换或新建当前会话时的通知回调 */
  onSelectSession?: (id: string) => void
}

export function Workbench({ chat, tasks, onNavigate, projectId, projects, onBack, onSwitchProject, launch, onOpenWorkflowEditor, onDismissLaunch, sessionId: propSessionId, threads, onSelectSession }: WorkbenchProps) {
  const [workflowsSnapshot, setWorkflowsSnapshot] = useState(() => workflowService.listWorkflows())
  const [runsTick, setRunsTick] = useState(0)
  const [workflowEvents, setWorkflowEvents] = useState<TaskEvent[]>([])

  /** 当前工作台绑定的会话 ID */
  const [boundSessionId, setBoundSessionId] = useState<string | null>(propSessionId ?? null)

  /** 记录当前正在提交或提交失败但未完成创作的任务上下文，通过 sessionStorage 与服务端任务状态双重核对，保证重试幂等与状态解耦 */
  const pendingSubmissionRef = useRef<{
    promptKey: string
    idempotencyKey: string
    sessionId: string
    userMessageId?: string
    taskId?: string
    path?: 'main' | 'alt'
    createdAt: number
  } | null>((() => {
    try {
      const raw = sessionStorage.getItem(`fm-pending-sub:${projectId}`)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return Date.now() - parsed.createdAt < 3600 * 1000 ? parsed : null
    } catch {
      return null
    }
  })())
  const [_reviewTab, setReviewTab] = useState<string | null>(null)
  const [comparison, setComparison] = useState<[StageVisual, StageVisual] | null>(null)
  /* 打开对比时对齐到「用户指的那一帧」：把当时目标引用的时间与区域带过去，
     两侧才能对齐到同一位置、叠同一个框，才叫「在相同位置比较」（文档第 8 节）。 */
  const [comparisonAt, setComparisonAt] = useState<{ timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>(null)
  const [previewLocation, setPreviewLocation] = useState<{ visualId: string; timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>(null)
  const capturedPreview = useRef<{ id: string; image: string } | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [backendCapability, setBackendCapability] = useState<BackendCapabilityInfo>({ status: 'checking' })
  /* 探测版本号：手动重试时递增，触发同一次 effect 重新探测 ——
     否则后端在打开项目后才启动，界面会一直停在「连接失败」。 */
  const [capabilityProbe, setCapabilityProbe] = useState(0)
  const [briefSection, setBriefSection] = useState<BriefSection>('all')
  const [selectedTaskRecordId, setSelectedTaskRecordId] = useState<string | null>(null)
  const [canvasView, setCanvasView] = useState<'monitor' | 'brief' | 'task'>('monitor')
  const [selectedId, setSelectedId] = useState('s01')
  /** 资料页开着哪一格（素材 / 参考 / 缺失）；内容行缺素材时也会把「素材」打开 */
  const [openShelf, setOpenShelf] = useState<string | null>(null)
  /* 正在跑的那一刻还没有运行记录（记录是跑完才写的），
     所以空态要单独听任务的实时状态，否则跑的过程中画面区一直写着「还没开始跑」。 */
  /* 工作流运行不走 tasks（那是对话提交的任务），所以「正在跑」要单独接一路信号。 */
  const [workflowRunning, setWorkflowRunning] = useState(false)
  const [remoteCreationBusy, setRemoteCreationBusy] = useState(false)
  const [sourceCreationBusy, setSourceCreationBusy] = useState(false)
  const [editorPreviews, setEditorPreviews] = useState<StageVisual[]>([])
  const [editorExportTick, setEditorExportTick] = useState(0)
  /* 本地文档的变更计数：编辑器保存后必须让它 +1，否则下面那份
     「文档与画面是否一致」的缓存不会重算，指纹警告会被绕过。 */
  const [documentsTick, setDocumentsTick] = useState(0)
  /* 后端当前场景。界面据此回答「现在这条片子是什么」，也是提交时的版本依据。 */
  const [currentSceneState, setCurrentSceneState] = useState<ProjectSceneState | null>(null)
  const [editorDocumentId, setEditorDocumentId] = useState<string | null>(null)
  /* 进入编辑器时必须让用户看到的前提说明（版本对应关系无法确认等）。 */
  const [editorNotice, setEditorNotice] = useState('')
  const [editMode, setEditMode] = useState(new URLSearchParams(window.location.search).get('edit') === '1' || new URLSearchParams(window.location.search).get('panel') === 'edit')
  const referencesEdited = useRef(false)
  const [regionMode, setRegionMode] = useState(false)
  /* 框选矩形已由元素点选自己画；旧的取消/重置调用仍会写它，保留 setter 即可 */
  const [, setRegionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const regionStart = useRef<{ sx: number; sy: number; mx: number; my: number; pointerId: number } | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const previewMediaRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null)
  const [previewTime, setPreviewTime] = useState(0)
  const [previewDuration, setPreviewDuration] = useState(0)
  const [pendingPlayback, setPendingPlayback] = useState<{ version: number; start: number } | null>(null)
  const [pendingReviewLocate, setPendingReviewLocate] = useState<{
    visualId: string
    timeSeconds?: number
    span?: { start: number; end: number }
    bbox?: { x: number; y: number; w: number; h: number }
    noticeText: string
  } | null>(null)
  const [previewReady, setPreviewReady] = useState(false)
  /* 循环只在「有选区」时有意义：它回答「我要反复看的就是这一小段」。 */
  const [loopSpan, setLoopSpan] = useState(false)
  const [frame, setFrame] = useState(INITIAL_FRAME)
  const frameRef = useRef(frame)
  const resumeFrameRef = useRef(INITIAL_FRAME)
  const [scope, setScope] = useState<'project'|'scene'|'selection'>('project')
  const [constraints, setConstraints] = useState<ModificationConstraints>({
    preserveCamera: true, preserveCaptions: true, limitToSelection: false, reuseExistingComponents: true,
    preserveOutsideSelection: false,
  })
  /* 右栏收起态：窄屏下改走浮层，宽屏下留一条对话入口窄列。 */
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia('(min-width: 901px)').matches)
  /* 任务记录的返回视图：从对话进来回对话，从场景进来回场景。 */
  const [taskReturnTab, setTaskReturnTab] = useState<SideTab>('chat')
  /* 对话输入聚焦触发：问题/场景带入对话时加一，右栏切到对话后聚焦输入框。 */
  const [focusChatKey, setFocusChatKey] = useState(0)
  const [bottomTab, setBottomTab] = useState<'activity'|'changes'|'versions'>('activity')
  const [trayOpen, setTrayOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const [notice, setNotice] = useState('')
  /* 导出进行中：探测产物是否真的可读需要一次真实请求，期间按钮要能显示忙态，
     避免用户连点多次触发多个下载。 */
  const [exporting, setExporting] = useState(false)
  /* 真实修改的忙碌与错误状态。错误单独存而不是塞进 notice：
     notice 是会自动消失的提示，而「刚才为什么没改成功」要一直留着，
     直到用户重发或主动关掉。 */
  const [realModifyBusy, setRealModifyBusy] = useState(false)
  const sourceOperation = useRef(false)
  const correctionAttempt = useRef<{ key: string; id: string } | null>(readCorrectionAttempt(projectId))
  const restoredCreationAt = useRef<string | null>(null)
  const [realModifyError, setRealModifyError] = useState('')
  const [unsavedReplies, setUnsavedReplies] = useState<Array<{ userMessageId: string; reply: string; sessionId: string; requestId?: string }>>([])
  const [executionPhase, setExecutionPhase] = useState<string>('')

  const rangeVisual = useRef<string | null>(null)
  /* 问题收起态：只记展开了哪一条，默认全部收起。 */
  const [expandedProblemId, setExpandedProblemId] = useState<string | null>(null)
  const { updatePendingSubmission, projectRecords, projectTask, workflow, refreshWorkflow, catalog, project, ensureBoundSession, currentSession, split, projectSessions } = useBoundSession({ boundSessionId, onSelectSession, pendingSubmissionRef, projectId, projects, propSessionId, setBoundSessionId, tasks, threads })

  // 页面重新打开、刷新或激活时，向服务端核对未决创作任务的真实执行状态
  useEffect(() => {
    if (!projectId || !boundSessionId) return
    const verifyPendingTask = async () => {
      try {
        const stored = pendingSubmissionRef.current
        const queryId = stored?.taskId || stored?.userMessageId
        const creation = await studioHttpApi().workflowContext.creation(projectId, queryId)
        if (creation && (creation.state === 'rendered' || creation.state === 'awaiting_info')) {
          if (creation.reply) {
            setAgentReply(creation.reply)
          }
          if (creation.version !== null && creation.version !== undefined) {
            void sceneVersions.refresh(true)
          }
          updatePendingSubmission(null)
        } else if (creation && creation.state === 'failed') {
          const errorMsg = creation.error || creation.reply || '上次创作任务执行失败'
          setRealModifyError(errorMsg)
          setNotice(`上次创作未成功：${errorMsg}`)
          updatePendingSubmission(null)
        }
      } catch {
        /* 忽略网络核对异常 */
      }
    }
    void verifyPendingTask()
  }, [projectId, boundSessionId])

  const { progressWorkflow, confirmed, decisions } = useWorkflowDecisions({ projectId, runsTick, workflowsSnapshot })
  const { setReferences, review, references, selectedTaskRecord, selectedTask, retryBackendCapability, roundSummaries } = useReviewContext({ backendCapability, capabilityProbe, progressWorkflow, projectId, projectRecords, projectTask, selectedTaskRecordId, setBackendCapability, setCapabilityProbe })

  const openReview = (tab: SideTab) => {
    if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause()
    setReviewTab(tab)
    selectSideTab(tab)
    setPanelOpen(true)
    setEditMode(false)
  }
  const decideNode = (wfId: string, nodeId: string, verdict: 'done' | 'rework') => {
    const target = workflowService.getWorkflow(wfId)
    if (!target || !target.nodes.some((n) => n.id === nodeId)) return
    const checkedNode = target.nodes.find((n) => n.id === nodeId)!
    const reviewVisual = checkedNode.type === 'review' ? stageState([target], workflowService.listRuns(target.id)).visuals[0] : null
    if (checkedNode.type === 'review' && (!reviewVisual || reviewVisual.stale)) { setNotice('还没有可审阅的有效预览。'); return }
    if (reviewVisual && viewedPreview?.id !== reviewVisual.id) {
      setSelectedVisual(reviewVisual.id === stageLead?.id ? null : { id: `stage:${reviewVisual.id}`, name: reviewVisual.name, kind: 'testfilm', mediaType: reviewVisual.media, filePath: reviewVisual.file, sourceLabel: reviewVisual.tierLabel })
      setNotice('已切到这条确认对应的预览，请查看后再给出结论。')
      return
    }
    if (verdict === 'done' && checkedNode.type === 'gate' && evaluateGate(target, checkedNode).blocked.length) { setNotice('这个检查点仍有缺失项，请先补齐对应产物。'); return }
    workflowService.saveWorkflow(target.id, {
      nodes: target.nodes.map((n) => {
        if (n.id !== nodeId) return n
        if (n.type === 'review') {
          return { ...n, params: { ...n.params, checks: { ...(n.params.checks as Record<string, boolean> | undefined), done: verdict === 'done', rework: verdict === 'rework' }, reviewedRunId: reviewVisual?.runId, reviewedVisualId: reviewVisual?.id, decidedAt: new Date().toISOString() } }
        }
        const primaryKind = GATE_PRIMARY_KIND[String(n.params.gate ?? '')] ?? ''
        const primary = target.nodes.find((m) => m.type === 'artifact' && String(m.params.kind ?? '') === primaryKind)
        return { ...n, params: verdict === 'done'
          ? { ...n.params, rework: false, decision: 'confirmed', confirmedAt: new Date().toISOString(), confirmedFor: { kind: primaryKind, version: String(primary?.params.version ?? '') }, decidedAt: new Date().toISOString() }
          : { ...n.params, decision: 'not-started', confirmedFor: undefined, confirmedAt: undefined, rework: true, decidedAt: new Date().toISOString() } }
      }),
      edges: target.edges,
    })
    if (workflow && workflow.id === target.id) refreshWorkflow()
    setWorkflowsSnapshot(workflowService.listWorkflows())
    setNotice(verdict === 'done' ? '已确认，记录到工作流。' : '已标记需要修改。')
  }
  // 调试直达：?artifact=artifact-content-contract 直接打开产物只读视图。
  const { setSelectedArtifactId, rereadRuns, projectWorkflows, stageLive, selectedArtifactId, setRailTab, railTab, liveTask } = useStageRail({ editorExportTick, projectId, projectTask, remoteCreationBusy, setCurrentSceneState, setEditorPreviews, setRunsTick, sourceCreationBusy, tasks, workflowRunning, workflowsSnapshot })
  /* 版本历史面板与审阅面板共用右栏位置。它不进 sideTab：
     那不是对话的子页签，而是一次「查看历史」的临时切换。 */
  /* 场景版本历史。回退成功后要把新的当前场景写回 currentSceneState，
     否则下一次提交仍带旧的 baseVersion，会被后端 409 拒绝 ——
     用户会以为回退把项目弄坏了。
     这条 hook 必须在 stage 之前：画面区要合并场景版本自带的视频，
     而那份列表就来自这里。 */
  const sceneVersions = useSceneVersions(projectId, (scene) => {
    setCurrentSceneState(scene)
    setSelectedVisual(null); setSelectedArtifactId(null); setComparison(null)
    setRealModifyError('')
    rereadRuns()
  })

  /* 场景版本自带的视频：修改/创建任务真正提交过的那条片子。
     它与工作流产物是两条来源，但用户只关心「现在这条片子长什么样」，
     所以并进同一份画面列表；origin 标成 scene，让界面能说清它是哪来的。 */
  const { outline, projectVersion, stage, stageLead, projectVersionLead, deliverableLead, stageDeliverable, materials, projectVersionNumber, projectVersionVisual, sceneVisuals, comparablePair } = useStageVisuals({ currentSceneState, editorPreviews, progressWorkflow, projectId, projectWorkflows, referencesEdited, runsTick, sceneVersions, setReferences, stageLive, workflowsSnapshot })
  const range = useStageTimeRange(previewDuration)
  frameRef.current = frame
  const initialPanel = new URLSearchParams(window.location.search).get('panel')
  /* 右栏默认就是对话：场景详情、执行记录、修改设置是次级视图，按需打开。
     ?panel 仍可深链到指定视图。 */
  const [sideTab, setSideTab] = useState<SideTab>(
    new URLSearchParams(window.location.search).get('edit') === '1' ? 'edit' : initialPanel === 'scene' || initialPanel === 'chat' || initialPanel === 'task' || initialPanel === 'edit' || initialPanel === 'settings' || initialPanel === 'versions' || initialPanel === 'review'
      ? initialPanel as SideTab
      : 'chat')
  const { sessionDraft, appendWorkbenchDraftText, submissionEngine, setWorkbenchDraftText } = useDraftText({ boundSessionId, chat, projectId })

  // 跨刷新与多轮可靠恢复待补存回复：以服务端任务记录为依据，合并本地未落盘项
  const { handleRetrySaveReply, handleRetrySaveAllReplies } = useUnsavedReplies({ boundSessionId, projectId, setNotice, setUnsavedReplies, threads, unsavedReplies })
  // 工作台全屏时隐藏主导航栏 hm-sidebar 并清除残留标记，退出时平滑恢复
  const { realRenderBusy, filmProject, setAgentReply, setAwaitingActive, setUsedResources, getRoundOutcome, setResourcePickerOpen, overlayGuides, toggleOverlayGuide, awaitingActive, submitProjectRender, usedResources, agentReply, filmRenderError, setFilmRenderError, resourcePickerOpen } = useProjectRender({ boundSessionId, chat, editorExportTick, notice, panelOpen, projectId, realModifyBusy, referencesEdited, remoteCreationBusy, rereadRuns, restoredCreationAt, review, runsTick, sceneVersions, setCurrentSceneState, setNotice, setRealModifyError, setReferences, setRemoteCreationBusy, sourceOperation, tasks, threads, workflowRunning })

  const { sceneFilmMeta, viewedPreview, viewedStanding, projectName, totalFrames, switchOpen, switchRef, setSwitchOpen, setSelectedVisual, setSelectedStageVisual, selectedArtifact, selectedVisual, monitorProblems } = useVisualSelection({ capturedPreview, catalog, outline, projectId, projectVersion, references, regionStart, sceneVersions, selectedArtifactId, sessionDraft, setNotice, setPreviewDuration, setPreviewFailed, setPreviewLocation, setPreviewReady, setReferences, setRegionMode, setRegionRect, stage, stageLead, workflowsSnapshot })

  /* 实时画面：看当前版本时运行工程源码（见 frontend/live-preview）；历史版本、对比、编辑器模式仍放成片 */
  const [liveMode, setLiveMode] = useState(true)
  const liveEligible = viewedPreview?.media === 'video' && (!stageLead || viewedPreview.id === stageLead.id) && !comparison && !editMode
  const live = useLivePreview({ projectId, enabled: liveMode && liveEligible })
  /* 实时画面跑起来就算「预览就绪」：引用当前帧、框选这类能力不该因为没挂成片视频而被禁用 */
  const liveFrameReady = liveMode && liveEligible && live.active && !!live.meta
  const { setSequenceMovePending, directEditCapability, isHistoricalVersion, aiModifyTargetCapability, adjustPendingConfirm, spanModifyCapability, targetEvaluation, timelineFps, timelineManifest, referenceTimeline, trackClipCapability, manifestStatus, sequenceManifest, timelineOpsCapability, sequenceMovePending } = useTimelineManifest({ backendCapability, capturedPreview, documentsTick, previewDuration, previewFailed, previewReady: previewReady || liveFrameReady, projectId, projectVersion, realModifyBusy, realRenderBusy, references, remoteCreationBusy, sceneFilmMeta, sessionDraft, viewedPreview, viewedStanding, workflowRunning })
  /* 新版本可能在播放器已经 ready 后才进入视图；不依赖 onReady 事件的触发顺序。 */
  const { toggleProblem } = useProblemTracking({ capturedPreview, pendingPlayback, pendingReviewLocate, previewMediaRef, previewReady, projectId, range, rangeVisual, references, sessionDraft, setExpandedProblemId, setLoopSpan, setNotice, setPendingPlayback, setPendingReviewLocate, setPreviewDuration, setPreviewLocation, setPreviewReady, setPreviewTime, setReferences, setSequenceMovePending, viewedPreview })
  /* 问题定位：设为修改范围 + 在左栏内容页高亮那一行。监看与时间线不动 —— 它们放的是渲染切片，拿它对应真实内容会串。 */
  const locateProblem = (p: MonitorProblem) => {
    if (!p.sceneRef) return
    setTargetReference(p.sceneRef)
    locateReference(p.sceneRef)
    setNotice(`已定位到 ${p.location}。`)
  }
  /* 让 AI 修改：问题 + 目标写进对话草稿，打开对话、聚焦输入框，等用户发送 —— 不只切面板。 */
  const askFix = (p: MonitorProblem) => {
    if (p.sceneRef) setTargetReference(p.sceneRef)
    else setTargetReference(currentProjectRef)
    const problemText = `请修改：${p.title}。${p.meta}。目标：${p.sceneRef ? p.sceneRef.label : `整片 · ${projectName}`}。`
    appendWorkbenchDraftText(problemText)
    selectSideTab('chat')
    setFocusChatKey((k) => k + 1)
  }
  /* 画廊点开的视觉项：向 AI 说这个 —— 名字 + 类型带进草稿，打开对话并聚焦。 */
  const askVisual = (item: MonitorVisualItem) => {
    const produced = stage.visuals.find((v) => `stage:${v.id}` === item.id)
    if (produced) setTargetReference({ id: `preview:${produced.id}`, role: 'target', kind: 'preview', label: produced.name, source: previewSource(produced) })
    else if (item.mediaType === 'image' || item.mediaType === 'video') addContextReference({ id: `reference:${item.id}`, role: 'context', kind: 'preview', label: `参考 · ${item.name}`, source: { projectId, visualId: item.id, file: item.filePath ?? item.thumb ?? item.id, media: item.mediaType } })
    const contextLine = `关于${VISUAL_KIND_LABEL[item.kind]}「${item.name}」：`
    appendWorkbenchDraftText(contextLine)
    selectSideTab('chat')
    setFocusChatKey((k) => k + 1)
  }
  void askVisual

  const { openEdit, closeEdit, selectScene } = useSceneEditEntry({ directEditCapability, isHistoricalVersion, previewMediaRef, projectId, resumeFrameRef, sceneFilmMeta, setComparison, setDocumentsTick, setEditMode, setEditorDocumentId, setEditorNotice, setFrame, setNotice, setPanelOpen, setRailOpen, setRailTab, setReferences, setRegionMode, setRegionRect, setReviewTab, setSelectedArtifactId, setSelectedId, setSideTab, setSwitchOpen, switchOpen, switchRef, totalFrames, viewedPreview })
  const { previewSource, setTargetReference, currentProjectRef, defaultTarget, scopeFromReferences, clearTimeRange, activeSceneId, selectContentRow, effectiveTarget, openTaskRecords, scopeShort, selectTimeRange } = useTimeRangeTarget({ previewMediaRef, previewTime, project, projectId, projectVersion, range, references, sessionDraft, setConstraints, setEditMode, setFocusChatKey, setLoopSpan, setNotice, setPreviewTime, setReferences, setRegionMode, setScope, setSideTab, setTaskReturnTab, sideTab, stageLead, viewedPreview })
  /** 切换右栏页签时退出 Remotion 编辑态，避免「参数 → 场景」后监看器仍停在编辑预览。 */
  const { referenceRegion, referenceElement, focusFeedback, selectSideTab, removeReference, locateReference, toggleReferenceRole, clearReferences, referenceFrame, saveCurrentFrame, referenceArtifact, addContextReference } = useTargetReferences({ aiModifyTargetCapability, backendCapability, capturedPreview, editMode, liveFrame: liveFrameReady ? { seconds: live.time, frame: live.frame, pause: live.pause } : null, previewMediaRef, previewSource, previewTime, project, projectRecords, projectVersion, range, references, referencesEdited, regionStart, resumeFrameRef, selectedTaskRecordId, sessionDraft, setCanvasView, setComparison, setEditMode, setFocusChatKey, setFrame, setLoopSpan, setNotice, setPanelOpen, setPreviewLocation, setRailTab, setReferences, setRegionMode, setRegionRect, setReviewTab, setSelectedArtifactId, setSelectedId, setSelectedVisual, setSideTab, setTargetReference, stage, stageLead, viewedPreview })
  /** 实际视频显示矩形：stage 可能留白，Player 还会因 16:9 产生 letterbox。 */
  /* 画面框选已并进元素点选（拖拽即框选）；这里只保留它统一的 Esc 退出（对比、全屏） */
  useRegionSelect({ comparison, panelOpen, previewMediaRef, referenceRegion, regionMode, regionStart, setComparison, setComparisonAt, setNotice, setPanelOpen, setRegionMode, setRegionRect, stageRef })
  /* 制作中插话的排队规则（演示适配器没有实时干预接口）：
     任务在跑时新发的不并行启动、不假装已干预 —— 先排队，当前任务结束（完成/失败）
     后按序启动；用户点了停止后，排队的先不动，等用户点「现在开始」或新发指令时
     再按序启动。请求在发送那一刻快照（引用与约束），排队期间改引用不影响已排的。 */
  const { showPreview, buildRequest, holdQueue, isLiveTask, pendingSubmits, setHoldQueue, setPendingSubmits, startNow, startQueued, cancelQueued } = useSubmitQueue({ chat, currentProjectRef, defaultTarget, progressWorkflow, projectId, references, scope, scopeFromReferences, selectedId, setBottomTab, setComparison, setEditMode, setPreviewLocation, setSelectedArtifactId, setSelectedStageVisual, stageLead, tasks })
  const { refreshCurrentScene, locateReviewOpinion, continueOpinion } = useReviewOpinionLocate({ appendWorkbenchDraftText, capturedPreview, clearTimeRange, focusFeedback, previewMediaRef, previewReady, projectId, range, sceneVersions, sessionDraft, setComparison, setCurrentSceneState, setEditMode, setNotice, setPendingReviewLocate, setPreviewLocation, setPreviewTime, setReferences, setRegionMode, setRegionRect, setSelectedArtifactId, showPreview, stage, tasks, viewedPreview })

  /**
   * 提交一次真实修改。
   *
   * <p>与演示路径的分工（两条入口刻意分开，不互相顶替）：
   * 这里是**真实后端**，请求体只带后端第一版真正解释的字段
   * （kind/prompt/scope/sceneIds/baseVersion）。参考定位与保留约束没有实现，
   * 带上会被「收下但不执行」，所以根本不发。</p>
   *
   * <p>失败一律如实显示并保留用户输入，**不回退到演示**：
   * 后端不可用时让用户以为改成功了，比明说「连不上」糟得多。
   * 只有用户自己点演示入口才会走 Mock。</p>
   *
   * @param prompt 用户原话
   * @param span   只看这几秒（「按时间段修改」入口传进来）；不传就是整条片子的意见
   * @returns 是否已成功提交
   */
  const { submitRealModify, submitTimeSpan } = useRealModify({ buildRequest, capturedPreview, chat, constraints, correctionAttempt, currentSceneState, ensureBoundSession, filmProject, focusFeedback, pendingSubmissionRef, previewDuration, previewMediaRef, projectId, projectVersionLead, realModifyBusy, realRenderBusy, refreshCurrentScene, remoteCreationBusy, rereadRuns, review, sceneVersions, setAgentReply, setAwaitingActive, setBottomTab, setComparison, setCurrentSceneState, setExecutionPhase, setNotice, setPendingPlayback, setRealModifyBusy, setRealModifyError, setSelectedArtifactId, setSelectedVisual, setSourceCreationBusy, setUnsavedReplies, setUsedResources, sourceOperation, submissionEngine, tasks, threads, updatePendingSubmission, viewedPreview, workflowRunning })

  /**
   * 提交修改：优先真实后端，只有用户显式选择演示才走 Mock。
   *
   * <p>此前所有提交都进演示路径，界面看起来「能用」，实际什么都没改。
   * 现在默认打真实接口；演示入口保留为独立按钮，标注清楚。</p>
   */
  const { cancelTaskAndHold, handleConfirmWholeProject, submit } = useWorkbenchSubmit({ adjustPendingConfirm, aiModifyTargetCapability, boundSessionId, capturedPreview, chat, currentProjectRef, currentSession, holdQueue, isLiveTask, pendingSubmits, projectId, range, references, sessionDraft, setConstraints, setHoldQueue, setLoopSpan, setNotice, setPendingSubmits, setPreviewLocation, setRealModifyError, setReferences, setScope, spanModifyCapability, startNow, submissionEngine, submitRealModify, submitTimeSpan, targetEvaluation, tasks, threads })
  const { previewActions, runQuickAction, exportDeliverable, workbenchViewSwitch } = useWorkbenchExport({ constraints, deliverableLead, exporting, focusFeedback, onNavigate, openReview, setConstraints, setExporting, setNotice, setPanelOpen, setWorkbenchDraftText, stageDeliverable, viewedPreview })

  /* 画面元素编辑：暂停时点选 / 框选画面，鼠标右侧弹出属性小窗 ——
     声明过的文字可以自己改（版本化写回），任何位置都可以交给 AI。 */
  const inspector = useElementInspector({
    projectId, viewedPreview, sceneVersions, previewMediaRef, stageRef,
    fps: timelineFps || FILM_FPS,
    busy: Boolean(liveTask) || workflowRunning || realRenderBusy || realModifyBusy || remoteCreationBusy,
    setNotice,
    showLatest: () => { setSelectedVisual(null); setSelectedArtifactId(null); setComparison(null) },
    referenceElement, submit, draft: sessionDraft.draft,
  })

  const askAiLive = useLiveAskAi({ draft: sessionDraft.draft, updateDraft: sessionDraft.updateDraft, submit, onSent: focusFeedback })
  const workbenchBusy = Boolean(liveTask) || workflowRunning || realRenderBusy || realModifyBusy || remoteCreationBusy

  return (
    <div className="wb-a2 wb-studio flex h-full min-h-0 flex-col" data-editor={editMode} data-mode="dark">

      {/* ═══ 基岛：顶栏（工作台全屏状态下彻底隐藏，释放视口与全部宽度） ═════════ */}
      {panelOpen && (
        <WorkbenchProjectBar
          catalog={catalog}
          editMode={editMode}
          onBack={onBack}
          onSwitchProject={onSwitchProject}
          previewActions={previewActions}
          project={project}
          setSwitchOpen={setSwitchOpen}
          split={split}
          switchOpen={switchOpen}
          switchRef={switchRef}
        />
      )}

      {/* ═══ 三栏（paba .fw 网格）══════════════════════════════ */}
      <div ref={split.containerRef} className="fw relative open-workbench-layout" data-panel={panelOpen ? 'open' : 'closed'} data-editor={editMode} data-resizing={split.dragging || undefined}
           style={{ '--open-chat-width': `${split.width}px` } as React.CSSProperties}>
        {railOpen && <button className="fw-scrim" aria-label="收起场景列表" onClick={() => setRailOpen(false)} />}

        <ProjectRail onOpenBrief={() => openReview('brief')} onEditScene={openEdit} projectName={project.name}
                     directEditCapability={directEditCapability}
                     projectId={projectId}
                     open={railOpen} onClose={() => setRailOpen(false)}
                     tab={railTab} onTab={setRailTab}
                     confirmed={confirmed}
                     decisions={decisions} onDecide={decideNode}
                     workflowId={workflow?.id ?? null}
                     outline={outline}
                     materials={materials}
                     openShelf={openShelf}
                     onToggleShelf={(id) => setOpenShelf((cur) => (cur === id ? null : id))}
                     activeSceneId={activeSceneId}
                     liveState={liveTask?.state ?? null}
                     onSelectContent={selectContentRow}
                     onOpenWorkflowEditor={onOpenWorkflowEditor}
                     wholeFilmActive={effectiveTarget.kind === 'project'}
                     onSelectWholeFilm={() => {
                       /* 选整片 = 把修改范围设成整个项目。submit() 是按引用推范围，
                          所以这里必须同时换掉 target 引用，否则输入框仍会落到当前场景。 */
                       setScope('project')
                       setTargetReference(currentProjectRef)
                       setEditMode(false)
                     }}
                     onOpenMaterials={() => { setRailTab('materials'); setOpenShelf('material') }}
                     /* 概览第一格：当前进度 + 运行入口。原来这里还有一块「正在制作」
                        面板，两块都在报同一件事，已并进这一张卡。 */
                     progressPanel={
                       <RailProgressPanel
                         key={progressWorkflow?.id ?? 'none'}
                         workflow={progressWorkflow}
                         /* 传项目与原始需求：Prompt-first 开跑时要真实建立
                            workflow-v0.1.1 创作上下文（写入 prompt.original.md）。
                            用「制作要求原文」而不是输入框草稿 —— 后者是随时会变的一句话，
                            原文才是 workflow-v0.1.1 要求的创作依据。 */
                         projectId={projectId}
                         prompt={review.brief.original || undefined}
                          references={libraryReferences(references)}
                          disabled={realModifyBusy || realRenderBusy || remoteCreationBusy}
                          onCreateResult={(result) => {
                            setAgentReply(result.reply)
                            /* 同一条路径：按轮次写共享 store，拿不到身份就不写 */
                            setAwaitingActive(result.state === 'awaiting_info'
                              ? recordRoundOutcome(projectId, boundSessionId, {
                                  reply: result.reply,
                                  ...(result.userMessageId ? { userMessageId: result.userMessageId } : {}),
                                  ...(result.requestId ? { requestId: result.requestId } : {}),
                                })
                              : false)
                            /* 本页产生了新轮次 → 回填缓存立刻失效 */
                            if (result.state === 'awaiting_info') invalidateBackfill(projectId, boundSessionId)
                            setUsedResources(result.resources ?? [])
                            if (result.state === 'rendered') {
                              setSelectedVisual(null); setSelectedArtifactId(null); setComparison(null)
                              void sceneVersions.refresh(true)
                              void tasks.currentScene(projectId).then((probe) => { if (probe.scene) setCurrentSceneState(probe.scene) })
                            }
                          }}
                         task={liveTask}
                         onOpenTask={openTaskRecords}
                         autoRun={!!(launch && progressWorkflow && launch.workflowId === progressWorkflow.id && launch.autoRun)}
                         onRunEvent={(event) => setWorkflowEvents((old) => [...old, event])}
                         onRunStart={() => { setWorkflowEvents([]); if (launch) onDismissLaunch?.(); rereadRuns() }}
                         onRunEnd={rereadRuns}
                         onRunningChange={setWorkflowRunning}
                         onOpenEditor={() => progressWorkflow && onOpenWorkflowEditor?.(progressWorkflow.id)}
                         onOpenExecution={() => { setBottomTab('activity'); setTrayOpen(true) }}
                       />
                     } />

        {panelOpen && <WorkbenchConsole
            adjustPendingConfirm={adjustPendingConfirm}
            boundSessionId={boundSessionId}
            briefSection={briefSection}
            cancelQueued={cancelQueued}
            cancelTaskAndHold={cancelTaskAndHold}
            chat={chat}
            clearReferences={clearReferences}
            closeEdit={closeEdit}
            constraints={constraints}
            continueOpinion={continueOpinion}
            currentProjectRef={currentProjectRef}
            currentSceneState={currentSceneState}
            currentSession={currentSession}
            defaultTarget={defaultTarget}
            editMode={editMode}
            effectiveTarget={effectiveTarget}
            executionPhase={executionPhase}
            filmProject={filmProject}
            focusChatKey={focusChatKey}
            focusFeedback={focusFeedback}
            getRoundOutcome={getRoundOutcome}
            handleConfirmWholeProject={handleConfirmWholeProject}
            handleRetrySaveAllReplies={handleRetrySaveAllReplies}
            handleRetrySaveReply={handleRetrySaveReply}
            locateReference={locateReference}
            locateReviewOpinion={locateReviewOpinion}
            onNavigate={onNavigate}
            onSelectSession={onSelectSession}
            openReview={openReview}
            openTaskRecords={openTaskRecords}
            pendingSubmits={pendingSubmits}
            projectId={projectId}
            projectName={projectName}
            projectRecords={projectRecords}
            projectSessions={projectSessions}
            projectTask={projectTask}
            projectVersion={projectVersion}
            projectVersionNumber={projectVersionNumber}
            projectWorkflows={projectWorkflows}
            range={range}
            realModifyBusy={realModifyBusy}
            realModifyError={realModifyError}
            realRenderBusy={realRenderBusy}
            references={references}
            remoteCreationBusy={remoteCreationBusy}
            removeReference={removeReference}
            review={review}
            runQuickAction={runQuickAction}
            sceneVersions={sceneVersions}
            scope={scope}
            scopeShort={scopeShort}
            selectSideTab={selectSideTab}
            selectedTaskRecordId={selectedTaskRecordId}
            sessionDraft={sessionDraft}
            setBoundSessionId={setBoundSessionId}
            setBriefSection={setBriefSection}
            setCanvasView={setCanvasView}
            setComparison={setComparison}
            setComparisonAt={setComparisonAt}
            setConstraints={setConstraints}
            setEditMode={setEditMode}
            setLoopSpan={setLoopSpan}
            setNotice={setNotice}
            setRealModifyError={setRealModifyError}
            setReferences={setReferences}
            setResourcePickerOpen={setResourcePickerOpen}
            setScope={setScope}
            setSelectedArtifactId={setSelectedArtifactId}
            setSelectedTaskRecordId={setSelectedTaskRecordId}
            setSelectedVisual={setSelectedVisual}
            setSideTab={setSideTab}
            setTargetReference={setTargetReference}
            setTrayOpen={setTrayOpen}
            setWorkbenchDraftText={setWorkbenchDraftText}
            showPreview={showPreview}
            sideTab={sideTab}
            sourceCreationBusy={sourceCreationBusy}
            stage={stage}
            stageLead={stageLead}
            startQueued={startQueued}
            submit={submit}
            targetEvaluation={targetEvaluation}
            taskReturnTab={taskReturnTab}
            threads={threads}
            toggleReferenceRole={toggleReferenceRole}
            unsavedReplies={unsavedReplies}
            viewedPreview={viewedPreview}
            workflowRunning={workflowRunning}
          />}
        {panelOpen && <div className="open-workbench-resize" role="separator" tabIndex={0}
          aria-label="调整对话区宽度" aria-orientation="vertical"
          aria-valuemin={split.bounds.min} aria-valuemax={split.bounds.max} aria-valuenow={split.width}
          onPointerDown={split.onPointerDown} onPointerMove={split.onPointerMove}
          onPointerUp={split.onPointerUp} onPointerCancel={split.onPointerCancel} onKeyDown={split.onKeyDown}
          onDoubleClick={split.onDoubleClick}>
          <svg className="open-workbench-resize-handle" viewBox="0 0 80 160" aria-hidden="true">
            <path d={`M${40 + split.feedback.offset + split.feedback.stretch} 50 Q${40 + split.feedback.offset + split.feedback.stretch + split.feedback.bend * 2} 80 ${40 + split.feedback.offset + split.feedback.stretch} 110`} />
          </svg>
        </div>}

        {editMode ? <SceneEditorWorkspace projectId={projectId} initialSceneId={selectedId} initialDocumentId={editorDocumentId} initialNotice={editorNotice} onClose={closeEdit} onRendered={() => { setSelectedVisual(null); setSelectedArtifactId(null); setComparison(null); setEditorExportTick((n) => n + 1); /* 新试片产生了新的快照指纹，判定要重算 */ setDocumentsTick((n) => n + 1) }} consoleHeader={<ConsoleChrome sideTab={sideTab} onChange={selectSideTab} sessions={projectSessions} currentSessionId={currentSession?.id} onSelectSession={(sid) => { setBoundSessionId(sid); onSelectSession?.(sid) }} projectName={projectName} />}/> : <>
        {/* 中栏：全局固定顶栏 + 下方内容区（监看器 / 创作要求 / 任务详情） */}
        <main className="fw-canvas flex flex-col min-h-0 overflow-hidden">
          <WorkbenchTopBar
            viewedPreview={viewedPreview}
            projectVersionNumber={projectVersionNumber}
            projectVersionAuthoritative={projectVersion.authoritative}
            projectVersionVisual={projectVersionVisual}
            /* 「最新 vN」与导出目标都只认可交付整片：
               编辑器试片也带 revision（第几次导出），混进来会报出错误的版本号。 */
            deliverableLead={deliverableLead}
            availableVisuals={sceneVisuals.length > 0 ? sceneVisuals : stage.visuals}
            previewReady={previewReady || liveFrameReady}
            liveFrame={liveFrameReady}
            aiModifyTargetCapability={aiModifyTargetCapability}
            comparison={comparison}
            comparablePair={comparablePair}
            elementInspector={inspector}
            live={{ on: liveMode && liveEligible, available: liveEligible, status: live.status, message: live.message, onChange: setLiveMode }}
            onReferenceFrame={referenceFrame}
            onSaveFrame={saveCurrentFrame}
            overlayGuides={overlayGuides}
            onToggleOverlayGuide={toggleOverlayGuide}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen((v) => !v)}
            onStartCompare={() => {
              if (!comparablePair) return
              if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause()
              setEditMode(false)
              setSelectedArtifactId(null)
              setComparison([comparablePair[0], comparablePair[1]])
              setComparisonAt(null)
              setTrayOpen(false)
            }}
            onCloseCompare={() => {
              setComparison(null)
              setComparisonAt(null)
            }}
            onSelectVisual={(visual) => showPreview(visual)}
            onOpenVersionHistory={() => openReview('versions')}
            canExport={Boolean(stageDeliverable)}
            onExport={() => void exportDeliverable()}
            viewSwitchElement={workbenchViewSwitch}
            projectName={project.name}
            projectDuration={previewDuration || ACTIVE_DURATION}
            timelineFps={timelineFps || FILM_FPS}
            mediaElement={previewMediaRef.current}
            currentTime={previewTime}
            isTaskRunning={Boolean(liveTask) || workflowRunning || realRenderBusy || realModifyBusy}
            activeTaskSummary={liveTask ? { title: liveTask.label, state: liveTask.state, error: realModifyError || undefined } : null}
            onOpenTasks={() => { setBottomTab('activity'); setTrayOpen(true) }}
            onResetLayout={() => { split.reset(); setPanelOpen(true) }}
            onOpenBrief={() => openReview('brief')}
          />

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
            {canvasView === 'brief' ? (
              <BriefDetailWorkspace
                review={review}
                projectId={projectId}
                activeSection={briefSection}
                onClose={() => setCanvasView('monitor')}
                onDiscuss={focusFeedback}
              />
            ) : canvasView === 'task' && selectedTaskRecord ? (
              <TaskDetailWorkspace
                task={selectedTask}
                record={selectedTaskRecord}
                cancelTask={cancelTaskAndHold}
                onResumeRequest={(request) => {
                  setReferences(structuredClone(request.references ?? []))
                  setConstraints(structuredClone(request.constraints))
                  setScope(request.scope)
                  setWorkbenchDraftText(request.prompt)
                  focusFeedback()
                }}
                onClose={() => setCanvasView('monitor')}
              />
            ) : (
              <>

          {comparison ? <WorkbenchPreviewCompare key={`${comparison[0].id}:${comparison[1].id}:${comparisonAt?.timeSeconds ?? 'x'}:${comparisonAt?.bbox ? 'r' : 'n'}`} left={comparison[0]} right={comparison[1]} initialTime={comparisonAt?.timeSeconds} bbox={comparisonAt?.bbox ?? null} focused={!panelOpen} onFocus={() => setPanelOpen((value) => !value)} onClose={() => { setComparison(null); setComparisonAt(null) }} onDiscuss={(visual, seconds, image, bbox) => {
            setComparison(null)
            showPreview(visual)
            const id = `preview:${visual.id}:${seconds ?? 'image'}:${bbox ? JSON.stringify(bbox) : ''}`
            capturedPreview.current = { id, image }
            setPreviewLocation({ visualId: visual.id, timeSeconds: seconds, bbox: bbox ?? undefined })
            setTargetReference({ id, role: 'target', kind: 'preview', source: previewSource(visual), timeSeconds: seconds, bbox: bbox ?? undefined, label: `${visual.name}${seconds !== undefined ? ` · ${formatMediaTime(seconds)}` : ''}${bbox ? ' · 框选区域' : ''}` })
            /* 引用画面时判断「是否历史」必须与其它位置同源：
               不能拿 stageLead（可能是试片）比 id，也不能在工程版本未确认时断言历史。 */
            {
              const refStanding = projectVersion
                ? versionStanding(visual, projectVersion)
                : 'not_applicable'
              if (refStanding === 'historical') {
                setNotice('已引用历史画面；如需修改，请先切回或恢复到当前版本。')
              } else if (refStanding === 'older_than_known') {
                /* 工程版本未确认：不能说「历史」，只说已知有更新的画面 */
                setNotice('已引用画面；已知有更新的画面，但工程版本未能确认，修改前请先核对当前版本。')
              } else if (refStanding === 'unknown_baseline') {
                /* 场景画面但工程版本完全读不到：无从比较，如实说明 */
                setNotice('已引用画面；但当前工程版本未能读取，无法确认它是否最新，修改前请先核对。')
              }
            }
            focusFeedback()
          }}/> : selectedArtifact ? (
            <ArtifactView artifact={selectedArtifact}
                          onLocate={(id) => selectScene(id)}
                          onReference={() => referenceArtifact(selectedArtifact)}
                          onClose={() => setSelectedArtifactId(null)} />
          ) : (
            <WorkbenchMonitor
              projectId={projectId}
              inspector={inspector}
              live={live.active ? live : null}
              askAiLive={askAiLive}
              workbenchBusy={workbenchBusy}
              agentReply={agentReply}
              askFix={askFix}
              awaitingActive={awaitingActive}
              backendCapability={backendCapability}
              chat={chat}
              clearTimeRange={clearTimeRange}
              expandedProblemId={expandedProblemId}
              filmProject={filmProject}
              filmRenderError={filmRenderError}
              focusFeedback={focusFeedback}
              liveTask={liveTask}
              locateProblem={locateProblem}
              loopSpan={loopSpan}
              manifestStatus={manifestStatus}
              monitorProblems={monitorProblems}
              notice={notice}
              openEdit={openEdit}
              openReview={openReview}
              overlayGuides={overlayGuides}
              previewDuration={previewDuration}
              previewLocation={previewLocation}
              previewMediaRef={previewMediaRef}
              previewReady={previewReady}
              previewSource={previewSource}
              previewTime={previewTime}
              projectTask={projectTask}
              range={range}
              realModifyBusy={realModifyBusy}
              realRenderBusy={realRenderBusy}
              referenceTimeline={referenceTimeline}
              remoteCreationBusy={remoteCreationBusy}
              retryBackendCapability={retryBackendCapability}
              review={review}
              sceneFilmMeta={sceneFilmMeta}
              selectSideTab={selectSideTab}
              selectTimeRange={selectTimeRange}
              selectedVisual={selectedVisual}
              sequenceManifest={sequenceManifest}
              sequenceMovePending={sequenceMovePending}
              setAgentReply={setAgentReply}
              setBottomTab={setBottomTab}
              setFilmRenderError={setFilmRenderError}
              setFocusChatKey={setFocusChatKey}
              setLoopSpan={setLoopSpan}
              setNotice={setNotice}
              setPreviewDuration={setPreviewDuration}
              setPreviewFailed={setPreviewFailed}
              setPreviewReady={setPreviewReady}
              setPreviewTime={setPreviewTime}
              setSequenceMovePending={setSequenceMovePending}
              setTargetReference={setTargetReference}
              setTrayOpen={setTrayOpen}
              setUsedResources={setUsedResources}
              sourceCreationBusy={sourceCreationBusy}
              stage={stage}
              stageLead={stageLead}
              stageLive={stageLive}
              stageRef={stageRef}
              submit={submit}
              submitProjectRender={submitProjectRender}
              submitRealModify={submitRealModify}
              timelineFps={timelineFps}
              timelineManifest={timelineManifest}
              timelineOpsCapability={timelineOpsCapability}
              toggleProblem={toggleProblem}
              trackClipCapability={trackClipCapability}
              usedResources={usedResources}
              viewedPreview={viewedPreview}
              workflowRunning={workflowRunning}
            />
          )}
          {trayOpen && (
                <BottomTray previews={stage.visuals} onPreview={(visual) => { setSelectedArtifactId(null); setSelectedVisual(visual.id === stageLead?.id ? null : { id: `stage:${visual.id}`, name: visual.name, kind: 'testfilm', mediaType: visual.media, filePath: visual.file, sourceLabel: visual.tierLabel }); setTrayOpen(false) }} workflowLog={<WorkflowExecutionLog runs={workflowService.listRuns().filter((r) => projectWorkflows.some((w) => w.id === r.workflowId))} liveEvents={workflowEvents} running={workflowRunning}/>} records={projectRecords} rounds={roundSummaries} activeId={tasks.active?.task.id ?? null}
                            onCancel={cancelTaskAndHold} tab={bottomTab} setTab={setBottomTab} />
              )}
            </>
          )}
          </div>
        </main>

        </>}
      </div>

      {/* 从资源库引用：素材/参考片/特效在这里挂到本轮意见上。
          放在工作台根节点，右栏收起时也能打开。 */}
      <ResourcePicker
        open={resourcePickerOpen}
        onOpenChange={setResourcePickerOpen}
        onAdd={(ref) => {
          referencesEdited.current = true
          setReferences((old) => [ref, ...old.filter((r) => r.id !== ref.id)])
          setNotice(`已引用「${ref.label}」，写一句要求后提交。`)
        }}
      />

      {/* 底部状态栏已移除：画面区底部已有「最终文件 / 输出规格 / 审片 / 检查」一行，
          再挂一条演示模式、任务面板、版本号的胶囊，等于把同批信息说第三遍，
          还把画面往上挤。任务面板入口移到顶栏。 */}
    </div>
  )
}

import { submitCreation } from '@/features/creation/services/creationClient'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Folder } from '@untitledui/icons'
import { useHarnessSelection } from '@/features/harness/hooks/useHarnessSelection'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { studioHttpApi } from '@/api'
import { chatStreamManager } from '@/features/chat/services/chatStreamManager'
import { resolveSendPlanFromDraft } from '@/features/chat/model/sendPlan'
import { ResourcePicker } from '@/features/workbench/components/ResourcePicker'
import { StageFrame } from '@/features/workbench/components/StageFrame'
import '@videojs/react/video/skin.css'
import { registerComposer } from '@/features/assets/hooks/usePendingAssets'
import { creationIntent, deliveredReferences, libraryReferences } from '@/features/creation/services/creationResources'
import { RailProgressPanel } from '@/features/workbench/components/RailProgress'
import { useHarnesses, modelsOf } from '@/features/harness/hooks/useHarnesses'
import { ACTIVE_SCENES } from '@/demo/projectModel'
import { PROJECTS, type ProjectSummary } from '@/features/project/model/projects'
import { WORKBENCH_ARTIFACTS, type WorkbenchArtifact } from '@/features/workbench/model/workbenchArtifacts'
import { ACTIVE_DURATION, FILM_FPS } from '@/demo/timeline'
import { useAgentTasks } from '@/features/creation/hooks/useAgentTasks'
import type { ProjectSceneState } from '@/api/taskClient'
import type { FilmProjectState } from '@/api/workflowContext'
import { ApiError } from '@/api/errors'
import type { AgentReference, AgentTask, ModificationConstraints, TaskRequest, PreviewSource, TaskEvent } from '@/api/studioApi'
import { evaluateGate, GATE_PRIMARY_KIND, workflowService, workflowResourceReferences } from '@/features/workflow/services/workflowService'
import { GATE_DEFS } from '@/features/workflow/model/workflowTemplates'
import { contentOutline, type ContentRow } from '@/features/workbench/model/contentOutline'
import { stageState, type StageVisual } from '@/features/workbench/model/stageVisual'
import { versionSeriesOf, versionBadgeLabel, versionItemLabel, resolveProjectVersion, findProjectVersionVisual, versionStanding, modifyBlockReason, type ProjectVersionInfo } from '@/features/workbench/model/versionIdentity'
import { containedMediaRect, formatMediaTime } from '@/features/workbench/model/previewGeometry'
import { materialShelves } from '@/features/workbench/model/materialDeck'
import { initLibrary } from '@/features/assets/services/assetApiService'
import { notifyProjectRendered, onProjectRendered } from '@/features/project/services/projectRenderEvents'
import {
  MonitorMediaPreview, MonitorProblemsCollapsed,
  type MonitorProblem, type MonitorVisualItem,
} from '@/features/workbench/components/MonitorZones'
import { MonitorStageEmpty } from '@/features/workbench/components/MonitorStageEmpty'
import { VISUAL_KIND_LABEL } from '@/features/workbench/model/monitorVisual'
import type { ChatMessage as ContractMessage } from '@/api/contracts'
import type { ChatState, ChatMessage as ChatItem } from '@/features/chat/hooks/useChat'
import { type SideTab, type RailTab, quickActions } from '@/features/workbench/model/workbenchConsole'
import { RightPanel } from '@/features/workbench/components/RightPanel'
import { ProjectRail } from '@/features/workbench/components/ProjectRail'
import { BottomTray } from '@/features/workbench/components/BottomTray'
import { ConsoleChrome } from '@/features/workbench/components/ConsoleChrome'
import { ArtifactView } from '@/features/workbench/components/ArtifactView'
import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import { useRoundOutcomes, recordRoundOutcome, clearRoundOutcome } from '@/features/chat/model/roundOutcomes'
import { backfillRoundOutcomes, shouldRestoreLatestState, invalidateBackfill } from '@/features/chat/services/roundOutcomeBackfill'
import { fmtClock, fmtDay, TASK_STATUS_LABEL } from '@/shared/lib/status'
import { SceneEditorWorkspace } from '@/features/scene-editor/SceneEditorWorkspace'
import { editorRenderVisuals, readEditorRenders } from '@/features/scene-editor/render'
import { manifestMatches, parseSequenceManifest, type SequenceEntry, type SequenceManifest } from '@/features/workbench/model/sequenceManifest'
import { WorkbenchTopBar, type OverlayGuidesState } from '@/features/workbench/components/WorkbenchTopBar'
import { MonitorOverlayGuides } from '@/features/workbench/components/MonitorOverlayGuides'
import { duplicateClip } from '@/features/workbench/model/timelineEdit'
import type { ViewId } from '@/shared/navigation/views'
import { ViewSwitch } from '@/shared/components/ViewSwitch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { WorkflowExecutionLog } from '@/features/workbench/components/WorkbenchReview'
import { WorkbenchReviewDesk } from '@/features/workbench/components/WorkbenchReviewDesk'
import { WorkbenchPreviewCompare } from '@/features/workbench/components/WorkbenchPreviewCompare'
import { SceneVersionPanel } from '@/features/workbench/components/SceneVersionPanel'
import { BriefPanel } from '@/features/workbench/components/BriefPanel'
import { BriefDetailWorkspace, type BriefSection } from '@/features/workbench/components/BriefDetailWorkspace'
import { TaskRecordPanel } from '@/features/workbench/components/TaskRecordPanel'
import { TaskDetailWorkspace } from '@/features/workbench/components/TaskDetailWorkspace'
import { useWorkbenchSplit } from '@/features/workbench/hooks/useWorkbenchSplit'
import { useWorkbenchReview } from '@/features/workbench/hooks/useWorkbenchReview'
import { useSceneVersions } from '@/features/workbench/hooks/useSceneVersions'
import type { SessionsState } from '@/features/chat/hooks/useSessions'
import { summarizeRounds, type ReviewOpinion } from '@/features/workbench/services/workbenchReviewService'
import { useStageTimeRange } from '@/features/workbench/components/StageTimeRange'
import { readDocuments, readDocumentsVersion } from '@/features/scene-editor/service'
import { evaluateTimelineOpsCapability, evaluateTrackClipReferenceCapability, evaluateAiModifyTargetCapability, evaluateDirectEditCapability, resolveDirectEditTarget, documentContentFingerprint, type BackendCapabilityInfo } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import { WorkbenchTimeline } from '@/features/workbench/components/WorkbenchTimeline'
import '@/features/workbench/styles/workbench-timeline.css'
import { timeSpanBrief, type TimeSpan } from '@/features/workbench/model/timeRange'
import '@/features/workbench/styles/workbench-review.css'
import '@/features/workbench/styles/workbench-desk.css'
import '@/features/workbench/styles/workbench-timerange.css'
import '@/features/workbench/styles/open-workbench.css'

/**
 * 制作工作台 · 二级 —— 三栏工具面板
 *
 * ⚠️ 这一层用 **paba 的工作台语言**（.wb-* / .fw-* / .mini），
 *    不是首页那套纸层（.hm-* / --ht-*）。
 *    paba 自己就分两套：
 *      首页    .hm-*      纸 + 墨（--ht-*）—— 24px 纸片、胶囊、阴影
 *      工作台  .wb-/.fw-  工具面板（--surf/--hole/--line）—— 平、密、6px 圆角
 *    工作台要能长时间盯着干活，所以**不用纸、不用大圆角、不用阴影**。
 *
 * 三栏：场景列表（.fw-ing）/ 监看器（.fw-canvas）/ 对话设置（.fw-bar）
 */

/**
 * 首屏默认停在场景内的「代表帧」而不是 0s。
 * 真实成片的 0s 是黑场片头（整帧均值约 24/255），如果直接停在 0s，
 * 监看器看起来就是一块空黑画布 —— 这是首屏被读成「AI 空白工作区」的主因之一。
 * 时间码仍是真实影片时间，不伪造画面。
 */
const INITIAL_FRAME = FILM_FPS

/** 打开某场时定位到该场有画面的位置：最多进入 1 秒，短镜头按 45% 取。 */
const scenePreviewOffset = (durationFrames: number) =>
  Math.min(Math.round(FILM_FPS), Math.round(durationFrames * 0.45))

type PendingSubmit = { key: string; messageId: string; prompt: string; request: TaskRequest; status: 'waiting' | 'cancelled' }
function readFeedbackQueue(projectId: string): { items: PendingSubmit[]; hold: boolean } {
  try {
    const value = JSON.parse(sessionStorage.getItem(`fm-feedback-queue:${projectId}`) ?? 'null') as { items?: PendingSubmit[]; hold?: boolean } | null
    return { items: Array.isArray(value?.items) ? value.items.filter((item) => item.request?.projectId === projectId && ['waiting', 'cancelled'].includes(item.status)) : [], hold: value?.hold === true }
  } catch { return { items: [], hold: false } }
}

function readCorrectionAttempt(projectId: string): { key: string; id: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`fm-correction-attempt:${projectId}`) ?? 'null') as { key?: unknown; id?: unknown } | null
    return typeof value?.key === 'string' && value.key.length <= 100_000 && typeof value.id === 'string' && /^[0-9a-f-]{36}$/i.test(value.id)
      ? { key: value.key, id: value.id } : null
  } catch { return null }
}

import { evaluateExecutableLocalTarget } from '@/features/workbench/services/workbenchTargetEvaluator'

interface WorkbenchProps {
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
  const split = useWorkbenchSplit()
  /** 打开的哪个项目 —— 从一级目录传下来的 id 解析。
      ⚠️ 必须用传入的目录：对话视图里新建的项目只存在于内存态，
        拿静态 PROJECTS 查不到会静默落回第一个种子项目（顶栏名字对不上）。 */
  const catalog = projects?.length ? projects : PROJECTS
  const project = catalog.find((p) => p.id === projectId) ?? catalog[0]
  /* 当前项目的工作流实例：没有就按默认 Prompt-first 建一个。
     左栏「待你决定」与执行确认都挂在它上面 —— 这是数据源，不是装饰。
     Prompt-first 主干是 提示词 → 创作与渲染 → 看片与修改；
     看片节点的 checks 就是「等你决定」的真实载体。 */
  const [workflow, setWorkflow] = useState(() => {
    if (!projectId) return null
    const existing = workflowService.listWorkflows().find((w) => w.projectId === projectId)
    if (existing) return existing
    return workflowService.createFromPath('prompt-first', 'general', project?.name ?? '未命名创作', { projectId })
  })
  const refreshWorkflow = () => {
    if (workflow) setWorkflow(workflowService.getWorkflow(workflow.id))
  }
  /* 待你决定：本项目所有工作流里真正等你拍板的节点。
     Prompt-first 的看片结论 + Structured 的门禁（Gate，pending 态）。
     没有数据就不出现，不编造待办；结论写回各自节点，与工作流编辑器
     读同一份状态。上一版堆叠把 Gate 的结论写进了 status 字段，
     而 evaluateGate 只读 decision——通过后卡片根本不会离开待办，
     这次按 decision/confirmedFor 写，与编辑器确认卡同一口径。
     渲染里不直接读存储：快照 state 由决定写回时刷新，视图切换重挂载
     时重取，计算本身是快照的纯函数。 */
  /* id 必须带上工作流：节点 id 在各自图里唯一，但跨工作流会重名（每个 prompt-first
     图都叫 n-review）。牌堆是按 id 认卡的，重名会让两张卡被当成同一张、只渲染出一张。
     写回工作流时要的是原始 nodeId，所以两个字段分开存，不要合成一个。 */
  type Decision = { wfId: string; nodeId: string; id: string; title: string; hint: string; detail: string }
  const [workflowsSnapshot, setWorkflowsSnapshot] = useState(() => workflowService.listWorkflows())
  const [runsTick, setRunsTick] = useState(0)
  const [workflowEvents, setWorkflowEvents] = useState<TaskEvent[]>([])
  const projectRecords = tasks.records.filter((r) => !r.request?.projectId || r.request.projectId === projectId)
  const projectTask = tasks.active && (!tasks.active.request?.projectId || tasks.active.request.projectId === projectId) ? tasks.active : null

  /** 当前工作台绑定的会话 ID */
  const [boundSessionId, setBoundSessionId] = useState<string | null>(propSessionId ?? null)

  useEffect(() => {
    if (propSessionId !== undefined) {
      setBoundSessionId(propSessionId)
    }
  }, [propSessionId])

  /** 当前项目名下的所有会话列表 */
  const projectSessions = useMemo(() => {
    if (!threads) return []
    return threads.sessions.filter((s) => s.projectId === projectId)
  }, [threads, projectId])

  /** 当前激活的具体会话对象 */
  const currentSession = useMemo(() => {
    if (!boundSessionId) {
      // 若当前未指定会话，但该项目已有会话，默认选用最新的一条
      return [...projectSessions].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
    }
    return projectSessions.find((s) => s.id === boundSessionId) ?? null
  }, [projectSessions, boundSessionId])

  // 当自动选出会话时，同步回 boundSessionId 与外层
  useEffect(() => {
    if (!boundSessionId && currentSession) {
      setBoundSessionId(currentSession.id)
      onSelectSession?.(currentSession.id)
    }
  }, [boundSessionId, currentSession, onSelectSession])

  // 若服务端会话未加载过消息，自动触发拉取（加载失败时停止自动轮询，停在错误卡片等待用户手动重试）
  useEffect(() => {
    if (!currentSession || currentSession.origin !== 'server' || currentSession.messagesLoaded || currentSession.messagesError || !threads) return
    void threads.loadMessages(currentSession.id)
  }, [currentSession, threads])

  /** 确保当前有可用会话，无则自动为本项目创建服务端真实新会话（坚决不串用其他项目，草稿未同步绝不冒充，失败明确报错） */
  const ensureBoundSession = async (firstPrompt: string): Promise<{ sessionId: string | null; error?: string }> => {
    if (currentSession?.id) {
      if (currentSession.origin === 'local') {
        if (!threads) return { sessionId: null, error: '会话服务未就绪' }
        const res = await threads.retryCreate(currentSession.id)
        if (res.error || !res.session || res.session.origin !== 'server') {
          return { sessionId: null, error: res.error || '当前会话仅保存在本地草稿，未能同步至服务端，请重试' }
        }
        setBoundSessionId(res.session.id)
        onSelectSession?.(res.session.id)
        return { sessionId: res.session.id }
      }
      return { sessionId: currentSession.id }
    }
    if (!threads) return { sessionId: null, error: '会话服务未就绪' }
    try {
      const res = await threads.create({
        projectId,
        firstText: firstPrompt,
      })
      if (res.error) {
        return { sessionId: null, error: res.error }
      }
      if (!res.session || res.session.origin !== 'server') {
        return { sessionId: null, error: '未能建立服务端会话，会话未保存' }
      }
      setBoundSessionId(res.session.id)
      onSelectSession?.(res.session.id)
      return { sessionId: res.session.id }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { sessionId: null, error: msg }
    }
  }

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

  const updatePendingSubmission = (state: {
    promptKey: string
    idempotencyKey: string
    sessionId: string
    userMessageId?: string
    taskId?: string
    path?: 'main' | 'alt'
    createdAt: number
  } | null) => {
    pendingSubmissionRef.current = state
    try {
      if (!state) {
        sessionStorage.removeItem(`fm-pending-sub:${projectId}`)
      } else {
        sessionStorage.setItem(`fm-pending-sub:${projectId}`, JSON.stringify(state))
      }
    } catch {
      /* 存储不可用时忽略 */
    }
  }

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

  const decisions = useMemo(() => {
    void runsTick
    if (!projectId) return []
    const out: Decision[] = []
    workflowsSnapshot
      .filter((w) => w.projectId === projectId)
      .forEach((w) => {
        w.nodes.forEach((n) => {
          if (n.type === 'review') {
            const visual = stageState([w], workflowService.listRuns(w.id)).visuals[0]
            if (!visual || visual.stale) return
            const c = (n.params.checks ?? {}) as Record<string, boolean>
            if ((c.done || c.rework) && n.params.reviewedVisualId === visual.id) return
            out.push({
              wfId: w.id, nodeId: n.id, id: `${w.id}:${n.id}`, title: '看片与修改',
              hint: '对着预览给出结论：通过，或指出要改的地方',
              detail: '结论会写进工作流的看片节点，后续制作按它执行。',
            })
          }
          if (n.type === 'gate') {
            if (n.params.rework) return
            const ev = evaluateGate(w, n)
            if (ev.decision !== 'pending') return
            out.push({
              wfId: w.id, nodeId: n.id, id: `${w.id}:${n.id}`, title: ev.label,
              hint: ev.blocked.length ? ev.blocked.join('；') : '等待你确认',
              detail: GATE_DEFS[String(n.params.gate ?? '')]?.question ?? '确认这一层的产物是否成立。',
            })
          }
        })
      })
    return out
  }, [projectId, workflowsSnapshot, runsTick])
  /* 已确认：与待决定同一快照、同一遍历，只是过滤条件反过来——
     看片已通过 + Gate 已确认，按 decidedAt 倒序。返工不算定下来，
     不进这里（它回工作流返工）。 */
  const confirmed = useMemo(() => {
    if (!projectId) return []
    const out: { id: string; title: string; hint: string; decidedAt: string }[] = []
    workflowsSnapshot
      .filter((w) => w.projectId === projectId)
      .forEach((w) => {
        w.nodes.forEach((n) => {
          if (n.type === 'review') {
            const c = (n.params.checks ?? {}) as Record<string, boolean>
            const visual = stageState([w], workflowService.listRuns(w.id)).visuals[0]
            if (!c.done || !visual || n.params.reviewedVisualId !== visual.id) return
            const day = fmtDay(String(n.params.decidedAt ?? ''))
            out.push({ id: `${w.id}:${n.id}`, title: '看片与修改', hint: `已通过${day ? ` · ${day}` : ''}`, decidedAt: String(n.params.decidedAt ?? '') })
          }
          if (n.type === 'gate') {
            if (n.params.decision !== 'confirmed') return
            const ev = evaluateGate(w, n)
            if (ev.stale) return
            const cf = (n.params.confirmedFor ?? {}) as { kind?: string; version?: string }
            const day = fmtDay(String(n.params.decidedAt ?? ''))
            out.push({ id: `${w.id}:${n.id}`, title: ev.label, hint: `已确认${cf.version ? ` · ${cf.version}` : ''}${day ? ` · ${day}` : ''}`, decidedAt: String(n.params.decidedAt ?? '') })
          }
        })
      })
    out.sort((a, b) => (b.decidedAt || '').localeCompare(a.decidedAt || ''))
    return out
  }, [projectId, workflowsSnapshot])
  /* 监看区的问题清单见下面 monitorProblems：工作流返工 + 场景缺素材（带真实场景与时间）。
     返工项目在待决定、已确认两边都不出现，review 同时有 done + rework 时以 done 为准。 */
  /* 当前进度卡跟着「最近更新的那个工作流」走 —— 与上面两份快照同一来源，
     决定写回后快照刷新，卡片里的「看片有没有留下结论」才能跟着变。 */
  const progressWorkflow = useMemo(
    () => workflowsSnapshot.find((w) => w.projectId === projectId) ?? null,
    [projectId, workflowsSnapshot],
  )
  const originalBrief = String(progressWorkflow?.nodes.find((n) => n.type === 'prompt')?.params.text ?? progressWorkflow?.description ?? '')
  const review = useWorkbenchReview(projectId, originalBrief)
  /* 每一轮的真实输入差异。演示执行器不写文件，所以这里归纳的是「提交了什么」，
     不是文件改动清单 —— 变更清单在演示下本就为空，不能编。 */
  const roundSummaries = useMemo(() => summarizeRounds(review.opinions), [review.opinions])
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
  const retryBackendCapability = useCallback(() => setCapabilityProbe((n) => n + 1), [])
  useEffect(() => {
    let active = true
    setBackendCapability({ status: 'checking' })
    void studioHttpApi().workflowContext.previewImageCapability(projectId)
      .then((capability) => {
        if (!active) return
        /* 画面与时间段需要的接口不同，分开记录，避免一项缺失把另一项也关掉。 */
        const missingForSpan: string[] = []
        if (!capability.baseVersionCheck) missingForSpan.push('版本预检校验')
        if (!capability.atomicCorrection) missingForSpan.push('原子意见保存')
        if (!capability.correctionRetryId) missingForSpan.push('重试任务标识')
        const missingForImage = capability.supported ? [...missingForSpan] : ['画面图像接收', ...missingForSpan]
        setBackendCapability({
          status: missingForSpan.length > 0 ? 'unsupported' : 'ready',
          spanSupported: missingForSpan.length === 0,
          imageSupported: missingForImage.length === 0,
          missingForSpan,
          missingForImage,
        })
      })
      .catch((err) => {
        if (!active) return
        const msg = err instanceof Error ? err.message : String(err)
        setBackendCapability({ status: 'connection_error', error: msg })
      })
    return () => { active = false }
  }, [projectId, capabilityProbe])
  /* 后端恢复后自动重探：只在「连接失败」状态下轮询，避免常态打扰服务。 */
  useEffect(() => {
    if (backendCapability.status !== 'connection_error') return
    const timer = window.setTimeout(() => setCapabilityProbe((n) => n + 1), 15000)
    return () => window.clearTimeout(timer)
  }, [backendCapability.status, capabilityProbe])
  const [briefSection, setBriefSection] = useState<BriefSection>('all')
  const [selectedTaskRecordId, setSelectedTaskRecordId] = useState<string | null>(null)
  const [canvasView, setCanvasView] = useState<'monitor' | 'brief' | 'task'>('monitor')

  const selectedTaskRecord = projectRecords.find((r) => r.task.id === selectedTaskRecordId) ?? projectRecords[0] ?? null
  const selectedTask = selectedTaskRecord ? (projectTask?.task?.id === selectedTaskRecord.task.id ? projectTask.task : selectedTaskRecord.task) : (projectTask?.task ?? null)

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
  const [selectedId, setSelectedId] = useState('s01')
  // 调试直达：?artifact=artifact-content-contract 直接打开产物只读视图。
  const initialArtifact = new URLSearchParams(window.location.search).get('artifact')
  const [railTab, setRailTab] = useState<RailTab>(initialArtifact ? 'artifacts' : 'overview')
  /** 资料页开着哪一格（素材 / 参考 / 缺失）；内容行缺素材时也会把「素材」打开 */
  const [openShelf, setOpenShelf] = useState<string | null>(null)
  /* 「正在制作」：AI 任务此刻在哪个内容上。只认真的还在跑的状态（排队/执行/构建）——
     完成、停止、失败都不算在跑，整块随卡片一起不显示，左栏不常驻「暂无任务」。
     内容名取这次请求的目标引用：内容单元用自己的名字，整片级任务说「整片」，
     目标是渲染切片时说「当前预览画面」（那是这条片这次怎么渲的，不冒充内容）。 */
  const liveTask = useMemo(() => {
    const record = projectTask
    if (!record || !['queued', 'running', 'building'].includes(record.task.status)) return null
    const target = record.request?.references?.find((ref) => ref.role === 'target')
    const label = target?.kind === 'scene' ? target.label
      : !target || target.kind === 'project' ? '整片'
      : '当前预览画面'
    return { label, state: TASK_STATUS_LABEL[record.task.status] ?? record.task.status, taskId: record.task.id }
  }, [projectTask])

  /* 素材种子：工作台进来先把内置素材写进 IndexedDB，
     资料页和别处读的是同一份，不各读一张内存表。 */
  useEffect(() => {
    void initLibrary().catch(() => undefined)
  }, [])
  /* ── 中间区域：这次制作到底做出了什么画面 ──────────────────────
     依据《产品体验与工作流说明》§5 —— 可能是测试帧、局部试片、粗略整片，
     也可能暂时没有画面。一律从本次运行产物里读（stageVisual.ts）。
     这里**不再**拿素材库里的旧成片当预览：那是上一次制作留下的文件，
     不是这次做出来的东西，放中间会让用户以为 AI 已经交片了。 */
  const projectWorkflows = useMemo(
    () => workflowsSnapshot.filter((w) => w.projectId === projectId),
    [workflowsSnapshot, projectId],
  )
  /* 运行记录不是 React 状态：演示执行器把结果写进 localStorage，组件不会自己知道。
     所以这里显式挂一个「重读」钩子 —— 运行开始和结束各调一次。
     只依赖 workflowsSnapshot 的话，跑完画面区还停在「这次制作还没开始跑」。 */
  const rereadRuns = () => setRunsTick((n) => n + 1)
  /* 正在跑的那一刻还没有运行记录（记录是跑完才写的），
     所以空态要单独听任务的实时状态，否则跑的过程中画面区一直写着「还没开始跑」。 */
  /* 工作流运行不走 tasks（那是对话提交的任务），所以「正在跑」要单独接一路信号。 */
  const [workflowRunning, setWorkflowRunning] = useState(false)
  const [remoteCreationBusy, setRemoteCreationBusy] = useState(false)
  const [sourceCreationBusy, setSourceCreationBusy] = useState(false)
  const stageLive = Boolean(liveTask) || workflowRunning || sourceCreationBusy || remoteCreationBusy
  const [editorPreviews, setEditorPreviews] = useState<StageVisual[]>([])
  const [editorExportTick, setEditorExportTick] = useState(0)
  /* 本地文档的变更计数：编辑器保存后必须让它 +1，否则下面那份
     「文档与画面是否一致」的缓存不会重算，指纹警告会被绕过。 */
  const [documentsTick, setDocumentsTick] = useState(0)
  useEffect(() => { let active = true; void editorRenderVisuals(projectId).then(items => { if (active) setEditorPreviews(items) }).catch(() => undefined); return () => { active = false } }, [projectId, editorExportTick])
  /* 打开工作台就读一次当前场景：让「场景版本 vN」从一开始就可信，
     而不是等到用户第一次提交后才知道改动会基于哪一版。
     读失败就保持 null（界面显示不出结论），不编一个版本号出来。 */
  useEffect(() => {
    let active = true
    void tasks.currentScene(projectId).then((probe) => {
      if (active && probe.scene) setCurrentSceneState(probe.scene)
    })
    return () => { active = false }
  }, [projectId])
  /* 后端当前场景。界面据此回答「现在这条片子是什么」，也是提交时的版本依据。 */
  const [currentSceneState, setCurrentSceneState] = useState<ProjectSceneState | null>(null)
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
  const sceneVisuals = useMemo<StageVisual[]>(() => {
    return sceneVersions.versions
      .filter((v) => Boolean(v.artifactPath))
      .map((v) => ({
        id: `scene:${v.version}`,
        origin: 'scene' as const,
        tier: 'final' as const,
        tierLabel: v.source === 'restore' ? `回退版本 v${v.version}` : `场景版本 v${v.version}`,
        name: v.artifactPath!.split('/').pop() ?? v.artifactPath!,
        media: 'video' as const,
        /* 场景版本存的是相对项目目录的路径（renders/xxx.mp4），
           而 <video src> 需要完整 URL。工作流产物的 file 本身就是可播放地址，
           所以这里必须自己转一次 —— 否则画面区会报「暂时无法播放」。 */
        file: studioHttpApi().artifacts.contentUrl(projectId, v.artifactPath!),
        /* 场景版本没有 runId / workflowId，但 StageVisual 要求这两项。
           用版本号占位而不是编一个工作流 ID —— 界面据此显示的是「场景版本」，不是工作流。 */
        runId: `scene-${v.version}`,
        artifactId: `scene-${v.version}`,
        workflowId: '',
        revision: v.version,
        createdAt: v.createdAt,
        artifactKind: 'scene-version',
        // 场景版本就是当前提交结果，不是「过期预览」
        stale: false,
      }))
  }, [sceneVersions.versions])

  const stage = useMemo(() => {
    const base = stageState(projectWorkflows, workflowService.listRuns())
    /* 场景版本优先排在最前：它是用户最近一次真实提交的结果，
       比工作流演示产物更该被当作「当前这条片子」。 */
    const seen = new Set<string>()
    const visuals = [...sceneVisuals, ...editorPreviews, ...base.visuals]
      .filter((visual) => seen.has(visual.file) ? false : (seen.add(visual.file), true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const combined = { ...base, visuals }
    return stageLive ? { ...combined, lastRunStatus: 'running' as const } : combined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectWorkflows, workflowsSnapshot, runsTick, stageLive, editorPreviews, sceneVisuals])
  /* 有画面就显示「最靠后的那一档」（整片 > 粗略整片 > 试片 > 测试帧）。 */
  /* 画面区里「可以直接对比的两版」：同一个场景、都有真实视频文件、
     而且确实是两个不同版本 —— 只有一版时不给入口，避免点了没东西可比。 */
  const comparablePair = useMemo<[StageVisual, StageVisual] | null>(() => {
    const videos = sceneVisuals.filter((visual) => visual.media === 'video' && !!visual.file)
    if (videos.length < 2) return null
    /* 以当前正在看的那一版为基准，找另一个版本与它对照。 */
    const newest = videos[0]
    const other = videos.find((visual) => visual.id !== newest.id)
    return other ? [other, newest] : null
  }, [sceneVisuals])
  const stageLead: StageVisual | null = stage.visuals[0] ?? null
  /* 注：原先这里有个 `stageStale`（stageLead.stale），用于时间段/画面修改的
     前置校验。现在那两处校验改用 projectVersionLead（当前工程版本），
     过期判断由「服务端场景版本是否一致」承担，不再需要一个独立变量。 */
  /**
   * 最新可交付的整片。
   *
   * <p>为什么要与 stageLead 分开：visuals 按 createdAt 排序，刚渲染的编辑器试片
   * 会排在真实整片前面。如果「最新版本」和「导出目标」都跟着 stageLead 走，
   * 就会出现两种错误：菜单头把试片的导出次数当成项目版本号（写「最新 v2」，
   * 而场景版本其实到了 v4），导出按钮又因为首项不是 final 档而被禁用 ——
   * 项目明明有整片，用户却导不出来。</p>
   *
   * <p>所以这里单独挑出「最新的、没标过期的整片」：导出只认它，
   * 「最新 vN」也只报它。没有整片时如实为 null，由界面说明原因。</p>
   */
  const deliverableLead = useMemo<StageVisual | null>(() => {
    const finals = stage.visuals.filter((visual) => visual.tier === 'final' && !visual.stale)
    if (!finals.length) return null
    /* visuals 已按 createdAt 由近到远排序，取第一个就是最新整片。 */
    return finals[0]
  }, [stage.visuals])

  /**
   * 当前**工程版本** —— 场景序列里最新的那一条。
   *
   * <p>这是「修改要基于哪一版工程」的基准，与下面两个概念必须分开：</p>
   * <ul>
   *   <li>{@code stageLead}：画面列表首项，可能是编辑器试片（按创建时间排）。</li>
   *   <li>{@code deliverableLead}：最新可下载整片，导出只认它。</li>
   * </ul>
   *
   * <p>用 `stageLead` 当工程基准会误拒：场景 v4 才是当前工程版本，
   * 但列表首项若是刚渲染的试片 v2，`viewedPreview.id !== stageLead.id`
   * 就成立，用户拿着当前版本却被要求「先切回或恢复到当前版本」。</p>
   */
  const projectVersionLead = useMemo<StageVisual | null>(() => {
    const scenes = stage.visuals.filter((visual) => versionSeriesOf(visual) === 'scene')
    if (!scenes.length) return null
    /* 场景序列内取 revision 最大的那条 = 当前工程版本 */
    return scenes.reduce((best, cur) => (cur.revision > best.revision ? cur : best))
  }, [stage.visuals])

  /**
   * 当前工程版本号 —— 即使**没有对应的渲染画面**也要有值。
   *
   * <p>为什么要单独一份：`projectVersionLead` 只能从「有 artifactPath 的场景版本」
   * 里取（画面列表是这么构造的）。如果工程已经改到 v17 但这一版还没渲染出片，
   * 列表里最大的仍是 v16 —— 此时拿 v16 当基准会把 v16 自己判成「最新」，
   * 而真实工程版本已经往前走了一格。</p>
   *
   * <p>所以优先用后端 `currentSceneState.version`（权威），
   * 取不到才退回列表里的最大值。两者都没有时保持 null，界面不显示版本结论。</p>
   */
  const projectVersion = useMemo<ProjectVersionInfo>(() => {
    /* 【关键】后端在「项目还没有任何工程版本」时也会返回 version: 0
       （initialized=false）。0 不是一个版本号 —— 把它当权威工程版本会让界面
       显示「当前工程版本 v0」，并把真实存在的画面全判成「比 v0 新」。
       所以只有 initialized 为真时才认这个数字。 */
    const backendVersion = currentSceneState?.initialized === true
      ? currentSceneState.version
      : undefined
    return resolveProjectVersion(backendVersion, stage.visuals)
  }, [currentSceneState?.initialized, currentSceneState?.version, stage.visuals])
  const projectVersionNumber = projectVersion.version

  /**
   * 「回到当前工程版本」该跳到的那条画面。
   *
   * <p>不能跳 `deliverableLead`：它可能是工作流产物（另一条序列），
   * 也可能在「工程 v17、可下载画面仍是 v16」时把用户带到仍是历史的 v16。
   * 找不到对应画面时返回 null —— 界面应说明「尚无对应画面」，
   * 而不是给一个会跳错地方的入口。</p>
   */
  const projectVersionVisual = useMemo(
    () => findProjectVersionVisual(projectVersion, stage.visuals) as StageVisual | null,
    [projectVersion, stage.visuals],
  )

  /* 能导出的前提是这次制作真有整片那一档，且不是过期版本。
     试片、测试帧不能导出：那不是整片，导出来用户会以为拿到成片了。 */
  const stageDeliverable = Boolean(deliverableLead)
  /* 资料页那摞素材卡：本项目真实文件按格式堆叠，外加一张「缺失 / 不可用」。
     工作流引用节点绑定了哪些，卡片上如实标出（不吹成「AI 精选」）。 */
  const materials = useMemo(
    () => materialShelves(projectId, progressWorkflow?.nodes.find((n) => n.type === 'refs')?.params.assetIds as string[] ?? []),
    [projectId, progressWorkflow],
  )

  /* 内容页的行：整片之外，这部片真实有哪些内容单元。
     只读工作流运行产物（见 data/contentOutline.ts）。监看区的问题定位也用同一份行。
     运行记录在快照变化时重读 —— 执行器完成时快照不变，但目前执行器不产出场景结构，行不受影响。 */
  const outline = useMemo(
    () => contentOutline(workflowsSnapshot.filter((w) => w.projectId === projectId), workflowService.listRuns()),
    [workflowsSnapshot, projectId],
  )
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(initialArtifact)
  const [editorDocumentId, setEditorDocumentId] = useState<string | null>(null)
  /* 进入编辑器时必须让用户看到的前提说明（版本对应关系无法确认等）。 */
  const [editorNotice, setEditorNotice] = useState('')
  const [editMode, setEditMode] = useState(new URLSearchParams(window.location.search).get('edit') === '1' || new URLSearchParams(window.location.search).get('panel') === 'edit')
  const [references, setReferences] = useState<AgentReference[]>(() => progressWorkflow ? workflowResourceReferences(progressWorkflow) : [])
  const referencesEdited = useRef(false)
  useEffect(() => {
    registerComposer((items) => {
      referencesEdited.current = true
      const incoming = deliveredReferences(items)
      setReferences((old) => [...old.filter((ref) => !incoming.some((next) => next.id === ref.id)), ...incoming])
      return true
    })
    return () => registerComposer(null)
  }, [])
  const [regionMode, setRegionMode] = useState(false)
  const [regionRect, setRegionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
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
  const range = useStageTimeRange(previewDuration)
  const [previewReady, setPreviewReady] = useState(false)
  /* 循环只在「有选区」时有意义：它回答「我要反复看的就是这一小段」。 */
  const [loopSpan, setLoopSpan] = useState(false)
  const [frame, setFrame] = useState(INITIAL_FRAME)
  const frameRef = useRef(frame)
  frameRef.current = frame
  const resumeFrameRef = useRef(INITIAL_FRAME)
  const [scope, setScope] = useState<'project'|'scene'|'selection'>('project')
  const [constraints, setConstraints] = useState<ModificationConstraints>({
    preserveCamera: true, preserveCaptions: true, limitToSelection: false, reuseExistingComponents: true,
    preserveOutsideSelection: false,
  })
  const initialPanel = new URLSearchParams(window.location.search).get('panel')
  /* 右栏默认就是对话：场景详情、执行记录、修改设置是次级视图，按需打开。
     ?panel 仍可深链到指定视图。 */
  const [sideTab, setSideTab] = useState<SideTab>(
    new URLSearchParams(window.location.search).get('edit') === '1' ? 'edit' : initialPanel === 'scene' || initialPanel === 'chat' || initialPanel === 'task' || initialPanel === 'edit' || initialPanel === 'settings' || initialPanel === 'versions' || initialPanel === 'review'
      ? initialPanel as SideTab
      : 'chat')
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
  const sessionDraft = useSessionDraft(projectId, boundSessionId)
  const engineSelection = useHarnessSelection()
  const engineProbe = useHarnesses()
  const engineModels = modelsOf(engineProbe, engineSelection.harness).models
  const submissionEngine = { ...engineSelection,
    model: engineModels.find((m) => m.id === engineSelection.model)?.id
      ?? engineModels.find((m) => m.default)?.id ?? engineModels[0]?.id,
  }

  // 统一程序化草稿写入：同时更新 React 状态与 sessionDraft 统一草稿库
  const setWorkbenchDraftText = useCallback((text: string) => {
    chat.setDraft(text)
    sessionDraft.updateDraft({ text })
  }, [chat, sessionDraft])

  const appendWorkbenchDraftText = useCallback((extra: string) => {
    const current = sessionDraft.draft.text || chat.draft
    const next = current.trim() ? `${current}\n${extra}` : extra
    chat.setDraft(next)
    sessionDraft.updateDraft({ text: next })
  }, [chat, sessionDraft])

  // 跨刷新与多轮可靠恢复待补存回复：以服务端任务记录为依据，合并本地未落盘项
  useEffect(() => {
    if (!projectId) return
    let active = true
    const loadUnsaved = async () => {
      try {
        const serverList = await studioHttpApi().workflowContext.unsavedReplies(projectId, boundSessionId ?? undefined)
        if (!active) return
        const map = new Map<string, { userMessageId: string; reply: string; sessionId: string; requestId?: string }>()
        serverList.forEach(item => {
          map.set(item.userMessageId, {
            userMessageId: item.userMessageId,
            reply: item.reply,
            sessionId: item.sessionId,
            requestId: item.requestId,
          })
        })
        try {
          const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
          if (raw) {
            const localMap: Record<string, { userMessageId: string; reply: string; sessionId: string; requestId?: string }> = JSON.parse(raw)
            Object.values(localMap).forEach(item => {
              if (!boundSessionId || item.sessionId === boundSessionId) {
                if (!map.has(item.userMessageId)) {
                  map.set(item.userMessageId, item)
                }
              }
            })
          }
        } catch {}
        if (active) {
          setUnsavedReplies(Array.from(map.values()))
        }
      } catch {
        try {
          const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
          if (raw && active) {
            const localMap: Record<string, { userMessageId: string; reply: string; sessionId: string; requestId?: string }> = JSON.parse(raw)
            const list = Object.values(localMap).filter(item => !boundSessionId || item.sessionId === boundSessionId)
            setUnsavedReplies(list)
          }
        } catch {
          if (active) setUnsavedReplies([])
        }
      }
    }
    void loadUnsaved()
    return () => { active = false }
  }, [projectId, boundSessionId])

  const handleRetrySaveReply = async (targetItem?: { userMessageId: string; reply: string; sessionId: string; requestId?: string }) => {
    const item = targetItem ?? unsavedReplies[0]
    if (!item || !threads) return
    try {
      await threads.sendMessage(item.sessionId, item.reply, {
        role: 'assistant',
        taskId: item.userMessageId,
        idempotencyKey: `idem-reply-${item.userMessageId}`,
      })
      if (item.requestId) {
        try {
          await studioHttpApi().workflowContext.syncReply(projectId, item.requestId)
        } catch { /* 辅助标记失败不阻断 */ }
      }
      try {
        const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
        if (raw) {
          const map = JSON.parse(raw)
          delete map[item.userMessageId]
          localStorage.setItem(`fm_unsaved_replies_${projectId}`, JSON.stringify(map))
        }
      } catch { /* 忽略本地存储清理异常 */ }
      setUnsavedReplies(prev => prev.filter(r => r.userMessageId !== item.userMessageId))
      setNotice('该回复已成功同步到会话。')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setNotice(`重试保存失败：${msg}`)
    }
  }

  const handleRetrySaveAllReplies = async () => {
    if (!unsavedReplies.length || !threads) return
    let count = 0
    for (const item of [...unsavedReplies]) {
      try {
        await threads.sendMessage(item.sessionId, item.reply, {
          role: 'assistant',
          taskId: item.userMessageId,
          idempotencyKey: `idem-reply-${item.userMessageId}`,
        })
        if (item.requestId) {
          try {
            await studioHttpApi().workflowContext.syncReply(projectId, item.requestId)
          } catch {}
        }
        try {
          const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
          if (raw) {
            const map = JSON.parse(raw)
            delete map[item.userMessageId]
            localStorage.setItem(`fm_unsaved_replies_${projectId}`, JSON.stringify(map))
          }
        } catch {}
        count++
      } catch (err) {
        console.warn('批量补存中断：', err)
        break
      }
    }
    // 重新加载待补存列表
    try {
      const remaining = await studioHttpApi().workflowContext.unsavedReplies(projectId, boundSessionId ?? undefined)
      setUnsavedReplies(remaining)
    } catch {}
    setNotice(`已完成 ${count} 条回复的同步保存。`)
  }
  // 工作台全屏时隐藏主导航栏 hm-sidebar 并清除残留标记，退出时平滑恢复
  const prevNavHiddenRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (!panelOpen) {
      if (prevNavHiddenRef.current === null) {
        prevNavHiddenRef.current = document.body.classList.contains('hm-nav-hidden')
      }
      document.body.classList.add('hm-nav-hidden')
      document.body.classList.add('wb-fullscreen-active')
    } else {
      if (prevNavHiddenRef.current === false) {
        document.body.classList.remove('hm-nav-hidden')
      }
      prevNavHiddenRef.current = null
      document.body.classList.remove('wb-fullscreen-active')
    }
    return () => {
      if (prevNavHiddenRef.current === false) {
        document.body.classList.remove('hm-nav-hidden')
      }
      document.body.classList.remove('wb-fullscreen-active')
    }
  }, [panelOpen])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])
  /* 真实渲染：状态与提交。
     与「运行演示」不同，这条走真实后端 —— 会在项目目录里产出一个能播放的 mp4。
     界面必须让用户分清两者，所以按钮文案与结果提示都写明「真实」。 */
  const [realRenderBusy, setRealRenderBusy] = useState(false)
  /* 项目工程：agent 写的 Remotion 源码。ready=true 表示有可渲染的工程。
     就绪时「真实渲染」渲染的是这份工程，而不是内置标题卡 ——
     后者只是占位，渲出来的不是用户要的片子。 */
  const [filmProject, setFilmProject] = useState<FilmProjectState | null>(null)
  const [filmRenderError, setFilmRenderError] = useState('')
  /* agent 最近一次改工程后的说明。用户需要知道「它到底改了什么」，
     而不是只看到画面变了却不知道为什么。 */
  const [agentReply, setAgentReply] = useState('')
  /* 这次创作实际解析到的三库资源。
     消息里存了引用不等于 agent 用上了 —— 把解析结果显示出来，
     用户才能核对「我选的素材/参考片/特效有没有真的传下去」。 */
  /* agent 在等用户补充信息时的原文说明。
     非空表示这一轮它只提问、没有改工程 —— 界面据此显示等待条，
     而不是把上一版画面当成「刚改好」播放。 */
  /**
   * 「本轮未改动工程」的结论 —— **必须带消息身份**。
   *
   * <p>原先是项目级单值（只存一段文本）：它没有消息 id，
   * 界面上只能靠「最后一条 AI 回复」推断该挂给哪一轮，
   * 于是历史上每条回复都会读到同一个当前值 —— 把上一轮的结果
   * 贴到错误的轮次上。</p>
   *
   * <p>现在记录 `userMessageId`（触发这轮修改的用户消息）与 `requestId`，
   * 渲染时按消息 id 精确匹配；匹配不上就**明确降级**（不显示），
   * 绝不猜。</p>
   */
  /**
   * 「本轮未改动工程」结果 —— 改为**按轮次**存在共享 store 里
   * （`shell/roundOutcomes`），工作台侧栏与完整对话区读同一份。
   *
   * <p>此前它是单条 state：新一轮结论会替换上一轮，历史结论丢失，
   * 对话区也读不到。现在按「项目 + 会话 + 用户消息 id」存，
   * 两轮结论可以同时存在、各显示各的。</p>
   */
  const getRoundOutcome = useRoundOutcomes(projectId, boundSessionId)
  /* 仍在执行/刚完成时用于顶部状态；不再承担「哪一轮」的语义 */
  const [awaitingActive, setAwaitingActive] = useState(false)
  /* 辅助查看覆盖层（三分构图线、安全区、画面规格） */
  const [overlayGuides, setOverlayGuides] = useState<OverlayGuidesState>({
    safeArea: false,
    thirds: false,
    mediaFacts: false,
  })
  const toggleOverlayGuide = useCallback((key: keyof OverlayGuidesState) => {
    setOverlayGuides((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])
  /* 「从资源库引用」面板：素材/参考片/特效要在提交前挂到这一轮的意见上。
     没有这个入口时，用户选不到三库资源，只能靠调接口验证 —— 界面上走不通。 */
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false)
  const [usedResources, setUsedResources] = useState<NonNullable<import('@/api/workflowContext').FilmCreateResult['resources']>>([])
  useEffect(() => {
    let active = true
    void studioHttpApi().workflowContext.film(projectId)
      .then((state) => { if (active) setFilmProject(state) })
      .catch(() => { if (active) setFilmProject(null) })
    return () => { active = false }
  }, [projectId, runsTick, editorExportTick])

  /* 最新消息引用：恢复/回填的回调是异步到达的，闭包里直接读 `chat.messages`
     会拿到挂载那一刻的旧值，判断「本页有没有这条」就会永远为否。 */
  const chatMessagesRef = useRef<ChatItem[]>([])
  useEffect(() => { chatMessagesRef.current = chat.messages }, [chat.messages])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const restore = async () => {
      try {
        const saved = await studioHttpApi().workflowContext.creation(projectId)
        if (!active || !saved) return
        const running = saved.state === 'running'
        setRemoteCreationBusy(running)
        if (!sourceOperation.current && !workflowRunning && saved.updatedAt !== restoredCreationAt.current) {
          restoredCreationAt.current = saved.updatedAt
          /* 恢复路径：把结论写回**正确的轮次**。
             两个身份都要对上才写：
             · `sessionId` —— 这个状态属于哪条会话。恢复请求只带 projectId，
               拿到的是「项目最近一次」，它可能属于另一个会话；用当前界面会话
               顶替就会把 B 的结论写进 A 的作用域。
             · `userMessageId` —— 属于哪一轮。
             任一缺失或不符就**不写**（降级不显示），绝不按「最近一轮」猜。

             ⚠️ 两个前提：
             1. 必须在会话校验**之后**处理：`chat` 是 App 层共享实例
                （对话区读同一份），先写会让别的会话的内容跟过去。
             2. **不要自造消息 id**：这条回复在服务端已经有真实记录
                （创作完成时会自动落库），这里再追加一条 `creation:...` 的本地消息，
                与历史加载回来的真实消息 id 不同 —— 两者会同时存在，变成重复回复。

             所以这里只恢复**轮次结论**与侧栏说明；回复本体交给消息历史。
             如果本页确实还没有这条（历史尚未加载），强制重读一次真实消息。 */
          if (shouldRestoreLatestState(saved, projectId, boundSessionId)) {
            /* agentReply 也是「这一轮改了什么」的说明，同样属于当前会话 ——
               在校验之前写会让别的会话的说明显示在当前会话侧栏里。 */
            setAgentReply(saved.reply ?? '')
            recordRoundOutcome(projectId, boundSessionId, {
              reply: saved.reply ?? '',
              userMessageId: saved.userMessageId!,
              ...(saved.requestId ? { requestId: saved.requestId } : {}),
            })
            /* 本页缺这条真实回复时重读历史；已有就不动，避免重复。 */
            const hasReply = chatMessagesRef.current.some(
              (m) => m.role === 'ai' && m.taskId === saved.userMessageId,
            )
            if (!hasReply && threads && boundSessionId) {
              void threads.loadMessages(boundSessionId, { force: true })
            }
          }
          setAwaitingActive(saved.state === 'awaiting_info')
          setRealModifyError(saved.error ?? '')
          if (!referencesEdited.current && saved.references) setReferences(saved.references)
        }
        if (running) timer = setTimeout(() => void restore(), 4000)
        else {
          void sceneVersions.refresh(true)
          void tasks.currentScene(projectId).then((probe) => { if (active && probe.scene) setCurrentSceneState(probe.scene) })
        }
      } catch (error) {
        if (active) setRealModifyError(`读取创作记录失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    void restore()
    return () => { active = false; if (timer) clearTimeout(timer) }
    /* 依赖里必须有 boundSessionId：它可能由「自动选出会话」在挂载之后才赋值，
       也可能因用户切换会话而变。漏掉它的话，切换/自动绑定之后不会重新读取，
       于是「切回 A 成功过一次」不能代表所有进入顺序都可靠。 */
    // 按项目、会话与运行轮次恢复，不随 hooks 的对象引用重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, boundSessionId, runsTick])

  /* 历史轮次回填：按「项目 + 会话」拉该会话真实发生过的创作轮次，逐条写进共享 store。
     与上面「读最近一次状态」是两件事 —— 那个只能恢复最近一轮，这里补全历史。 */
  useEffect(() => {
    if (!projectId || !boundSessionId) return
    let active = true
    const sid = boundSessionId
    void backfillRoundOutcomes(projectId, sid, {
      onRoundsFound: (userMessageIds) => {
        if (!active) return
        /* 服务端有、本页没有的轮次：只写结论没用，回复本身也要读回来，
           否则界面上找不到可挂载的消息（外部窗口/后台任务的典型情况）。 */
        const known = new Set(
          chatMessagesRef.current.map((m) => m.taskId).filter(Boolean) as string[],
        )
        if (userMessageIds.some((id) => !known.has(id))) {
          void threads?.loadMessages(sid, { force: true })
        }
      },
    })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, boundSessionId])

  /* 进工作台就把该项目的任务历史读回来。
     任务已经落库，但前端记录只在内存 —— 不回读的话刷新一次历史就"没了"，
     用户会以为渲染结果丢了。切换项目时也重新读。 */
  useEffect(() => {
    void tasks.loadHistory(projectId)
    // tasks 每次渲染都是新对象，放进依赖会无限循环；只跟项目走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  /**
   * 提交一次真实渲染。
   *
   * <p>当前用项目名与简报生成一个最小影片（标题 + 副标题），
   * 先让链路可点可验；等场景编辑器能导出结构化分镜后，
   * 这里的 film 换成编辑器产出的那份。</p>
   */
  /**
   * 渲染项目工程。
   *
   * <p>这是「真实创作」的出口：渲的是 agent 写在项目里的 Remotion 源码。
   * 与 {@link submitRealRender} 的区别不只是实现，而是产物性质 ——
   * 那个渲的是内置标题卡，只能验证链路通不通；这个渲的是用户要的片子。</p>
   *
   * @returns 是否成功
   */
  const submitProjectRender = async (): Promise<boolean> => {
    if (sourceOperation.current || realRenderBusy || realModifyBusy || workflowRunning || remoteCreationBusy) return false
    sourceOperation.current = true
    setRealRenderBusy(true)
    setFilmRenderError('')
    try {
      const result = await studioHttpApi().workflowContext.renderFilm(projectId, review.brief.original || undefined)
      setNotice(`已渲染工程 ${result.entry} · 版本 v${result.version}`)
      /* 渲染提交了新版本：刷新版本列表与当前场景，让画面区立刻能播这一版。
         不刷新的话用户要手动重开才知道片子变了。 */
      void sceneVersions.refresh(true)
      void tasks.currentScene(projectId).then((probe) => { if (probe.scene) setCurrentSceneState(probe.scene) })
      rereadRuns()
      return true
    } catch (error) {
      /* 失败原因要透出来：渲染失败可能是语法错误、超时、缺入口，
         每种都指向不同的下一步，一句「渲染失败」等于没说。 */
      const message = error instanceof Error ? error.message : String(error)
      setFilmRenderError(message)
      setNotice(`渲染失败：${message.slice(0, 160)}`)
      return false
    } finally {
      sourceOperation.current = false
      setRealRenderBusy(false)
    }
  }

  /* 对话里自动渲染出了新版本（无论在对话页还是工作台侧栏发的消息）：和手动渲染成功后一样刷新，
     画面区立刻能播这一版，不用手动重开。 */
  useEffect(() => onProjectRendered((event) => {
    if (event.projectId !== projectId) return
    void sceneVersions.refresh(true)
    void tasks.currentScene(projectId).then((probe) => { if (probe.scene) setCurrentSceneState(probe.scene) })
    rereadRuns()
    // sceneVersions / tasks 每次渲染都是新对象，放进依赖会反复订阅；只跟项目走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projectId])

  const [switchOpen, setSwitchOpen] = useState(false)
  const switchRef = useRef<HTMLDivElement | null>(null)
  const selectedArtifact = useMemo(() => WORKBENCH_ARTIFACTS.find((a) => a.id === selectedArtifactId) ?? null, [selectedArtifactId])
  const totalFrames = Math.round(ACTIVE_DURATION * FILM_FPS)

  const projectName = catalog.find((p) => p.id === projectId)?.name ?? projectId
  /* 问题：工作流返工（未关联场景）+ 场景缺素材（带真实场景与时间，来自运行产物）。 */
  const monitorProblems = useMemo((): MonitorProblem[] => {
    if (!projectId) return []
    const out: (MonitorProblem & { decidedAt: string })[] = []
    workflowsSnapshot
      .filter((w) => w.projectId === projectId)
      .forEach((w) => {
        w.nodes.forEach((n) => {
          if (n.type === 'review') {
            const c = (n.params.checks ?? {}) as Record<string, boolean>
            if (!c.rework || c.done) return
            const day = fmtDay(String(n.params.decidedAt ?? ''))
            out.push({ id: `${w.id}:${n.id}`, title: '看片要改', meta: `工作流「${w.name}」· 看片${day ? ` · ${day}` : ''}`, location: '未关联场景', locatable: false, decidedAt: String(n.params.decidedAt ?? '') })
          }
          if (n.type === 'gate' && n.params.rework) {
            const ev = evaluateGate(w, n)
            const day = fmtDay(String(n.params.decidedAt ?? ''))
            out.push({ id: `${w.id}:${n.id}`, title: `${ev.label}返工`, meta: `工作流「${w.name}」· ${ev.label}${day ? ` · ${day}` : ''}`, location: '未关联场景', locatable: false, decidedAt: String(n.params.decidedAt ?? '') })
          }
        })
      })
    out.sort((a, b) => (b.decidedAt || '').localeCompare(a.decidedAt || ''))
    const located: MonitorProblem[] = outline.rows
      .filter((row) => row.needs)
      .map((row) => ({
        id: `need:${row.id}`, title: `${row.name}缺素材`, meta: `需要${row.needs}`,
        location: row.span ? `${row.ref.label} · ${fmtClock(row.span.from)}–${fmtClock(row.span.from + row.span.duration)}` : `${row.ref.label} · 时间未标`,
        locatable: true, sceneRef: row.ref,
      }))
    return [...out.map(({ decidedAt: _d, ...p }) => p), ...located]
  }, [projectId, workflowsSnapshot, outline])
  /* 换画面时把「上一个画面的框选/时间引用」撤下来。
     不撤的话会出现「用户看着 B、提交的却是 A 的区域引用」—— 文档第 7 节最在意的
     就是「用户指的对象与 AI 实际修改的对象是否一致」。
     只动 target（要改的那一个）：context 引用（参考、素材）是资料，不该跟着消失。 */
  const dropTargetCapture = (reason: string) => {
    const target = references.find((ref) => ref.role === 'target')
    if (!target || target.kind !== 'preview') return
    setReferences((old) => old.filter((ref) => ref.id !== target.id))
    capturedPreview.current = null
    setPreviewLocation(null)
    sessionDraft.updateDraft({ targetSnapshot: null })
    setNotice(reason)
  }

  /* 视觉选择按项目派生：切项目后旧选择自动失效，不用 effect 清。 */
  const [visualSel, setVisualSel] = useState<{ projectId: string; item: MonitorVisualItem | null }>({ projectId, item: null })
  const [stageVisualSel, setStageVisualSel] = useState<{ projectId: string; visual: StageVisual | null }>({ projectId, visual: null })
  const selectedVisual = visualSel.projectId === projectId ? visualSel.item : null
  const selectedStageVisual = stageVisualSel.projectId === projectId ? stageVisualSel.visual : null

  const setSelectedVisual = (item: MonitorVisualItem | null) => {
    if ((item?.id ?? `stage:${stageLead?.id}`) !== (selectedVisual?.id ?? `stage:${stageLead?.id}`)) {
      setPreviewReady(false); setPreviewDuration(0); setPreviewFailed(false)
      dropTargetCapture('已切换画面：上一个画面的框选区域与时间引用已撤下，避免改错对象。')
    }
    setVisualSel({ projectId, item })
    setStageVisualSel({ projectId, visual: null })
    regionStart.current = null; setRegionMode(false); setRegionRect(null)
  }

  const setSelectedStageVisual = (visual: StageVisual | null) => {
    const isLead = !visual || visual.id === stageLead?.id
    const prevId = selectedStageVisual?.id ?? (selectedVisual ? selectedVisual.id.replace(/^stage:/, '') : stageLead?.id)
    const nextId = isLead ? stageLead?.id : visual.id
    if (prevId !== nextId) {
      setPreviewReady(false); setPreviewDuration(0); setPreviewFailed(false)
      dropTargetCapture('已切换画面：上一个画面的框选区域与时间引用已撤下，避免改错对象。')
    }
    setStageVisualSel({ projectId, visual: isLead ? null : visual })
    setVisualSel({
      projectId,
      item: isLead ? null : {
        id: `stage:${visual.id}`,
        name: visual.name,
        kind: 'testfilm',
        mediaType: visual.media,
        filePath: visual.file,
        sourceLabel: visual.tierLabel,
      },
    })
    regionStart.current = null; setRegionMode(false); setRegionRect(null)
  }

  const viewedPreview = selectedStageVisual ?? (selectedVisual ? stage.visuals.find((v) => `stage:${v.id}` === selectedVisual.id || v.id === selectedVisual.id) ?? null : stageLead)

  /**
   * 「正在看的这一版」相对当前工程版本是否历史。
   *
   * <p>场景画面：与 {@link projectVersionNumber} 比 —— 后者可能来自后端，
   * 因此「工程已到 v17、画面只到 v16」时 v16 会正确判为历史。</p>
   * <p>非场景画面（试片/工作流产物）：不与工程版本号比（不同序列），
   * 交回给 versionIdentity 判为不可比较 —— 不标历史。</p>
   *
   * <p>必须定义在 `viewedPreview` 之后：它依赖这个值。</p>
   */
  /**
   * 当前预览相对工程版本的状态 —— **带可信度**。
   *
   * <p>区分「确认是历史」与「只是比已知最新画面旧」：后端版本读不到时
   * 不能说「修改将基于最新工程 vN」，只能说「已知有更新的画面」。</p>
   */
  const viewedStanding = useMemo(
    () => versionStanding(viewedPreview, projectVersion),
    [viewedPreview, projectVersion],
  )
  /* 场景版本快照里的渲染元信息：帧率与 sourceHash。
     只用来校准时间线；没有就是没有，不猜。 */
  const sceneFilmMeta = useMemo(() => {
    if (viewedPreview?.origin !== 'scene') return null
    const film = sceneVersions.versions.find((version) => version.version === viewedPreview.revision)?.film
    if (!film || typeof film !== 'object') return null
    const output = 'output' in film ? (film.output as { fps?: number } | undefined) : undefined
    const fps = output?.fps ?? ('fps' in film ? (film.fps as number) : undefined)
    const sourceHash = 'sourceHash' in film && typeof film.sourceHash === 'string' ? film.sourceHash : undefined
    return { fps, sourceHash }
  }, [sceneVersions.versions, viewedPreview?.origin, viewedPreview?.revision])

  /* 序列清单：生成侧写入项目目录的 sequences.json。
     它描述的是「这条片子里有哪些元素、各占哪几秒」，元素在代码里仍写成 Sequence。
     清单缺失、格式不对或与当前版本对不上，就只显示成片轨 —— 不从源码里猜元素。 */
  const [sequenceManifest, setSequenceManifest] = useState<SequenceManifest | null>(null)
  const [manifestStatus, setManifestStatus] = useState<'loading' | 'missing' | 'invalid' | 'ready' | 'error'>('loading')
  /* 拖动元素条得到的待发送调整。它不直接生效：AI 才是改代码的一方。 */
  const [sequenceMovePending, setSequenceMovePending] = useState<
    | { item: SequenceEntry; next: { start: number; duration: number }; brief: string; intent: 'move' | 'trim-start' | 'trim-end'; label?: string }
    | { brief: string; label?: string }
    | null
  >(null)
  useEffect(() => {
    if (!viewedPreview) { setSequenceManifest(null); return }
    let active = true
    setSequenceManifest(null)
    setManifestStatus('loading')
    const url = studioHttpApi().artifacts.contentUrl(projectId, 'sequences.json')
    void fetch(url)
      .then(async (r) => {
        if (r.status === 404) { if (active) setManifestStatus('missing'); return }
        if (!r.ok) throw new Error('manifest request failed')
        const parsed = parseSequenceManifest(await r.json())
        if (active) { setSequenceManifest(parsed); setManifestStatus(parsed ? 'ready' : 'invalid') }
      })
      .catch(() => { if (active) { setSequenceManifest(null); setManifestStatus('error') } })
    return () => { active = false }
  }, [projectId, viewedPreview?.id])
  const timelineManifest = manifestMatches(sequenceManifest, { sourceHash: sceneFilmMeta?.sourceHash, duration: previewDuration })
    ? sequenceManifest
    : null
  /* 参考轨道：清单存在但与当前版本对不上时，仍然展示出来，只是明确标为参考。
     两种情形都必须覆盖，否则时间线会只剩一条成片轨，用户看不到片段：
       · 旧项目尚未保存版本指纹（缺少指纹）
       · 两边都有指纹但不一致（版本已变）
     展示前提是总时长对得上，否则片段位置会画到错误的画面上。 */
  const referenceTimeline = !timelineManifest && sequenceManifest
    && Math.abs(sequenceManifest.durationSeconds - previewDuration) <= 0.1
    ? sequenceManifest : null
  const timelineFps = timelineManifest?.fps ?? sceneFilmMeta?.fps

  // 与实际提交分支 100% 对齐的目标有效性评估，按真实提交能力严格判断，绝不让不支持的目标滑入无范围整片修改
  const targetEvaluation = evaluateExecutableLocalTarget(
    references,
    viewedPreview,
    capturedPreview.current,
    previewDuration,
    timelineManifest
  )
  const isContinuationTargetRequired = sessionDraft.draft.continuationScopeMode === 'target_required'
  const hasValidExecutableTarget = targetEvaluation.status === 'valid_frame' || targetEvaluation.status === 'valid_span'
  const adjustPendingConfirm = isContinuationTargetRequired && !hasValidExecutableTarget

  /* 历史判断的基准必须是**当前工程版本**（projectVersionLead），不是 stageLead。
     stageLead 只是画面列表首项，可能是刚渲染的编辑器试片：
     拿它当基准，用户看场景 v15 时会被判成 uncomparable（试片与场景不同序列），
     于是历史标记消失，依赖它的能力提示也跟着错。
     projectVersionLead 取场景序列里 revision 最大的那条 —— 这才是「当前工程版本」。 */
  /**
   * 能力判断用的「不能直接修改」标志 —— **比「历史」标签更保守**。
   *
   * <p>两种情况下都不该允许直接提交修改：</p>
   * <ul>
   *   <li>{@code historical}：确认不是当前工程版本；</li>
   *   <li>{@code older_than_known}：后端版本没读到，只知道有更新的画面 ——
   *       无法确认当前看的就是工程版本，贸然修改可能基于错误基准。</li>
   * </ul>
   *
   * <p>而界面上是否显示「历史」标签只看 {@code historical} ——
   * 措辞可以弱一点，能力判断必须保守一点。</p>
   */
  /* 能力判断用的「不可修改」原因 —— **带具体理由**，不是布尔。
     两种原因都要拦，但用户该做的事不同：确认历史 → 恢复/继续调整；
     版本未确认 → 重试或重选画面。只传布尔会让评估器统一按「历史版本」给理由。 */
  const modifyBlock = modifyBlockReason(viewedStanding, projectVersion)
  /* 兼容旧字段：评估器仍有 isHistorical 分支 */
  const isHistoricalVersion = modifyBlock !== 'ok'

  /* 直接编辑的判定与入口共用同一份「已确认文档」：
     先按当前画面反查具体文档，再看它是否与画面版本一致。
     不在本地文档列表里「有就放行」—— 那会让用户看着 v3 的画面打开另一份内容。

     documentsTick / documentsVersion 必须进依赖：文档存在 localStorage，保存不会触发重渲染，
     少了它，「进编辑器改完保存 → 回同一试片 → 再进编辑器」会继续用旧的
     versionConfirmed，把已经变了的文档当成仍与画面一致，指纹警告被绕过。 */
  const documentsVersion = documentsTick + readDocumentsVersion(projectId)
  const directEditTarget = useMemo(() => resolveDirectEditTarget({
    preview: viewedPreview
      ? { origin: viewedPreview.origin, artifactId: viewedPreview.artifactId, runId: viewedPreview.runId }
      : null,
    previewSourceHash: sceneFilmMeta?.sourceHash ?? null,
    docs: readDocuments(projectId).map((doc) => ({
      id: doc.id,
      sourceId: doc.source?.id,
      sourceHash: doc.source?.sourceHash,
      /* 内容指纹：同 id 的文档被改过后这里会变，用它判断「还是渲染时那份内容吗」。 */
      contentFingerprint: documentContentFingerprint(doc),
    })),
    renders: readEditorRenders(projectId).map((item) => ({
      id: item.id,
      sceneId: item.sceneId,
      documentId: item.document?.id,
      snapshotFingerprint: item.document ? documentContentFingerprint(item.document) : undefined,
    })),
  }), [projectId, viewedPreview?.id, viewedPreview?.origin, viewedPreview?.artifactId, viewedPreview?.runId, sceneFilmMeta?.sourceHash, documentsVersion])

  const timelineOpsCapability = evaluateTimelineOpsCapability({
    hasPreview: Boolean(viewedPreview),
    previewReady,
    previewDuration,
    previewFailed,
    isBusy: realModifyBusy || realRenderBusy || workflowRunning || remoteCreationBusy,
  })

  const trackClipCapability = evaluateTrackClipReferenceCapability({
    hasPreview: Boolean(viewedPreview),
    isHistorical: isHistoricalVersion,
    modifyBlock,
    manifestStatus,
    hasManifest: Boolean(sequenceManifest),
    hasSourceHashMatch: Boolean(sequenceManifest?.sourceHash && sceneFilmMeta?.sourceHash),
    hasVerifiedTracks: Boolean(timelineManifest),
  })

  const aiModifyTargetCapability = evaluateAiModifyTargetCapability({
    hasPreview: Boolean(viewedPreview),
    previewReady,
    isHistorical: isHistoricalVersion,
    modifyBlock,
    backendCapability,
    targetKind: 'frame',
  })

  /* 时间段修改不需要图像接收能力：单独评估，避免被画面能力缺失连坐。 */
  const spanModifyCapability = evaluateAiModifyTargetCapability({
    hasPreview: Boolean(viewedPreview),
    previewReady,
    isHistorical: isHistoricalVersion,
    modifyBlock,
    backendCapability,
    targetKind: 'span',
  })

  const directEditCapability = evaluateDirectEditCapability({
    projectId,
    isHistorical: isHistoricalVersion,
    hasPreview: Boolean(viewedPreview),
    target: directEditTarget,
  })
  /* 新版本可能在播放器已经 ready 后才进入视图；不依赖 onReady 事件的触发顺序。 */
  useEffect(() => {
    if (!pendingPlayback || !previewReady || viewedPreview?.origin !== 'scene' || viewedPreview.revision !== pendingPlayback.version) return
    const media = previewMediaRef.current
    if (!(media instanceof HTMLVideoElement) || !Number.isFinite(media.duration)) return
    media.currentTime = Math.min(pendingPlayback.start, media.duration)
    setPreviewTime(media.currentTime)
    setPendingPlayback(null)
    setNotice('已定位到新版本的原修改位置，可播放并对比检查。')
  }, [pendingPlayback, previewReady, viewedPreview?.id, viewedPreview?.origin, viewedPreview?.revision])

  /* 审阅意见定位：等待目标版本的播放器真正就绪后再定位时间、选区与高亮框，彻底杜绝切版竞态与旧播放器赋值 */
  useEffect(() => {
    if (!pendingReviewLocate || !previewReady || viewedPreview?.id !== pendingReviewLocate.visualId) return
    const media = previewMediaRef.current
    if (media instanceof HTMLVideoElement && Number.isFinite(media.duration)) {
      if (typeof pendingReviewLocate.timeSeconds === 'number') {
        const targetTime = Math.min(pendingReviewLocate.timeSeconds, media.duration)
        media.currentTime = targetTime
        setPreviewTime(targetTime)
      }
    } else if (typeof pendingReviewLocate.timeSeconds === 'number') {
      setPreviewTime(pendingReviewLocate.timeSeconds)
    }
    if (pendingReviewLocate.span) {
      range.setSpan(pendingReviewLocate.span)
    }
    if (pendingReviewLocate.bbox) {
      setPreviewLocation({ visualId: pendingReviewLocate.visualId, timeSeconds: pendingReviewLocate.timeSeconds, bbox: pendingReviewLocate.bbox })
    }
    setNotice(pendingReviewLocate.noticeText)
    setPendingReviewLocate(null)
  }, [pendingReviewLocate, previewReady, viewedPreview?.id])

  const rangeVisual = useRef<string | null>(null)
  useEffect(() => {
    const identity = viewedPreview ? `${projectId}:${viewedPreview.id}` : null
    if (rangeVisual.current !== identity) {
      rangeVisual.current = identity
      const isTargetPending = pendingReviewLocate && pendingReviewLocate.visualId === viewedPreview?.id
      if (!isTargetPending) {
        range.reset()
        setLoopSpan(false)
        const staleTarget = references.find((ref) => ref.role === 'target' && ref.kind === 'preview' && ref.source.visualId !== viewedPreview?.id)
        if (staleTarget) {
          setReferences((old) => old.filter((ref) => ref.id !== staleTarget.id))
          capturedPreview.current = null
          setPreviewLocation(null)
          sessionDraft.updateDraft({ targetSnapshot: null })
          setNotice('预览版本已变化，之前的画面或时间引用已移除，请重新选择修改目标。')
        }
      }
      setSequenceMovePending(null)
      setPreviewDuration(0)
      setPreviewReady(false)
    }
  }, [projectId, viewedPreview?.id, range.reset, pendingReviewLocate])
  /* 问题收起态：只记展开了哪一条，默认全部收起。 */
  const [expandedProblemId, setExpandedProblemId] = useState<string | null>(null)
  const toggleProblem = (id: string) => setExpandedProblemId((cur) => (cur === id ? null : id))
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

  const selectScene = (id: string) => {
    setSelectedId(id)
    setSelectedArtifactId(null)
    setEditMode(false)
    setReferences([])
    setRailTab('overview')
    const clip = ACTIVE_SCENES.find((item) => item.id === id)
    // 0s 往往是黑场/入点，镜头发车时先落到该场有画面的代表帧。
    if (clip) {
      const target = clip.startFrame + scenePreviewOffset(clip.durationFrames)
      resumeFrameRef.current = target
      seek(target)
    }
    setRailOpen(false)                    // 窄屏选完就收起抽屉
  }
  const openEdit = () => {
    if (!directEditCapability.allowed) {
      setNotice(directEditCapability.reason || '当前版本不支持直接编辑')
      return
    }
    /* 打开前重新读一遍文档与渲染快照再核对：缓存只是「上次算过」，
       而用户在编辑器里改过并保存后，画面与文档可能已经不一致了。
       这里以存储里的当前内容为准，绝不把旧的 versionConfirmed 直接带到打开动作上。 */
    const freshTarget = resolveDirectEditTarget({
      preview: viewedPreview
        ? { origin: viewedPreview.origin, artifactId: viewedPreview.artifactId, runId: viewedPreview.runId }
        : null,
      previewSourceHash: sceneFilmMeta?.sourceHash ?? null,
      docs: readDocuments(projectId).map((doc) => ({
        id: doc.id,
        sourceId: doc.source?.id,
        sourceHash: doc.source?.sourceHash,
        contentFingerprint: documentContentFingerprint(doc),
      })),
      renders: readEditorRenders(projectId).map((item) => ({
        id: item.id,
        sceneId: item.sceneId,
        documentId: item.document?.id,
        snapshotFingerprint: item.document ? documentContentFingerprint(item.document) : undefined,
      })),
    })
    /* 打开的就是重新核对过的那份文档：判定与打开用同一个来源，
       不会再出现「判定用 A、打开用 B」。 */
    if (!freshTarget.docId) {
      setNotice(freshTarget.reason || '未确认到与该画面一致的场景文档')
      return
    }
    const freshCapability = evaluateDirectEditCapability({
      projectId,
      isHistorical: isHistoricalVersion,
      hasPreview: Boolean(viewedPreview),
      target: freshTarget,
    })
    setEditorDocumentId(freshTarget.docId)
    /* 提醒交给编辑器显示：进入编辑后监看区被替换，写在那里的提示用户看不到。 */
    setEditorNotice(freshCapability.note ?? '')
    setComparison(null)
    setReviewTab(null)
    setSelectedArtifactId(null)
    if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause()
    setRegionMode(false)
    setRegionRect(null)
    setPanelOpen(true)
    setEditMode(true)
    setSideTab('edit')
  }
  const closeEdit = () => {
    setEditMode(false)
    setSideTab('chat')
    /* 编辑器里可能保存过：让「文档与画面是否一致」的判定下次重新计算。 */
    setDocumentsTick((n) => n + 1)
  }
  const seek = (nextFrame: number) => {
    const next = Math.max(0, Math.min(totalFrames - 1, Math.round(nextFrame)))
    setFrame(next)
    const clip = [...ACTIVE_SCENES].reverse().find((item) => next / FILM_FPS >= item.start)
    if (clip) setSelectedId(clip.id)
  }
  useEffect(() => {
    if (!switchOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!switchRef.current?.contains(event.target as Node)) setSwitchOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSwitchOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [switchOpen])
  const currentProjectRef = useMemo<AgentReference>(() => ({
    id: `project:${projectId}`, role: 'target', kind: 'project', projectId,
    label: `整片 · ${project.name}`,
  }), [projectId, project.name])
  const scopeFromReferences = (refs: AgentReference[]): TaskRequest['scope'] => {
    const target = refs.find((ref) => ref.role === 'target')
    if (!target || target.kind === 'project' || target.kind === 'artifact' || target.kind === 'preview') return 'project'
    return 'scene'
  }
  const previewSource = (visual: StageVisual): PreviewSource => ({ projectId, visualId: visual.id, artifactId: visual.artifactId, workflowId: visual.workflowId || undefined, assetId: visual.assetId, origin: visual.origin, runId: visual.runId, revision: visual.revision, file: visual.file, media: visual.media })
  /* 默认目标也要带「停在哪一帧」：文档第 7 节要求请求里有时间位置，
     而用户不一定每次都先点「引用此帧」。图片没有时间概念，就不编一个 0 出来。 */
  const currentPreviewTime = viewedPreview?.media === 'video' ? previewTime : undefined
  const currentPreviewRef: AgentReference | null = viewedPreview ? {
    id: `preview:${viewedPreview.id}:${currentPreviewTime === undefined ? 'image' : currentPreviewTime.toFixed(3)}`,
    role: 'target',
    kind: 'preview',
    source: previewSource(viewedPreview),
    ...(currentPreviewTime === undefined ? {} : { timeSeconds: currentPreviewTime }),
    label: `${viewedPreview.name}${currentPreviewTime === undefined ? '' : ` · ${formatMediaTime(currentPreviewTime)}`}`,
  } : null
  const defaultTarget = currentPreviewRef ?? currentProjectRef
  const effectiveTarget = references.find((ref) => ref.role === 'target') ?? defaultTarget
  /* 占位文案用短名：整片 / 03 S03 / 当前画面 */
  const scopeShort = effectiveTarget.kind === 'project' ? '整片'
    : effectiveTarget.kind === 'scene' || effectiveTarget.kind === 'shot' ? effectiveTarget.label
    : effectiveTarget.kind === 'artifact' ? effectiveTarget.label : effectiveTarget.kind === 'preview' ? effectiveTarget.label : '当前画面'

  /* 现在被设为 AI 修改范围的那个内容单元 */
  const activeSceneId = useMemo(() => {
    const target = references.find((ref) => ref.role === 'target')
    return target && target.kind === 'scene' ? target.sceneId : null
  }, [references])
  const setTargetReference = (ref: AgentReference) => {
    if (ref.kind !== 'preview' || ref.endTimeSeconds === undefined) { range.reset(); setLoopSpan(false) }
    setConstraints((old) => ({ ...old, limitToSelection: ref.kind !== 'project' }))
    setScope(ref.kind === 'project' || ref.kind === 'artifact' ? 'project' : ref.kind === 'preview' ? 'selection' : 'scene')
    setReferences((old) => [ref, ...old.filter((item) => item.role !== 'target')])
  }
  const activeSeekRef = useRef<{
    token: number
    cleanup?: () => void
    targetId: string
    visualId: string
    span: TimeSpan
  } | null>(null)

  const selectTimeRange = (span: TimeSpan) => {
    if (!viewedPreview) return
    const media = previewMediaRef.current

    // 辅助函数：从当前已渲染的视频/图片节点提取合规 JPEG 图像
    const captureJpegFromMedia = (el: HTMLVideoElement | HTMLImageElement): string | null => {
      try {
        const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
        const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight
        if (w && h) {
          const scale = Math.min(1, 1200 / Math.max(w, h))
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(w * scale))
          canvas.height = Math.max(1, Math.round(h * scale))
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
            return canvas.toDataURL('image/jpeg', 0.82)
          }
        }
      } catch {}
      return null
    }

    range.setSpan(span)
    setRegionMode(false)
    const targetLabel = `${viewedPreview.tierLabel} · ${formatMediaTime(span.start)}–${formatMediaTime(span.end)}`
    const targetRef: AgentReference = {
      id: `preview:${viewedPreview.id}:${span.start}:${span.end}`,
      role: 'target', kind: 'preview', source: previewSource(viewedPreview),
      timeSeconds: span.start, endTimeSeconds: span.end,
      label: targetLabel,
    }
    setTargetReference(targetRef)

    // 清理并作废之前的未决 seek 回调
    if (activeSeekRef.current?.cleanup) {
      activeSeekRef.current.cleanup()
    }
    const token = (activeSeekRef.current?.token ?? 0) + 1

    // 只有当播放头当前已经处于选区起点（误差 < 0.05s）时，才提取当前帧；
    // 否则绝不拿未跳转完成的旧帧当选区画面，必须等待 seeked 真正完成！
    let initialJpeg: string | null = null
    if (media) {
      const isAlreadyAtStart = media instanceof HTMLVideoElement
        ? Math.abs(media.currentTime - span.start) < 0.05
        : true
      if (isAlreadyAtStart && (media instanceof HTMLVideoElement ? media.readyState >= 2 : media.complete && media.naturalWidth > 0)) {
        initialJpeg = captureJpegFromMedia(media)
      }
    }

    if (media instanceof HTMLVideoElement) {
      media.pause()
      const onSeeked = () => {
        // 1. 核对 token 确保是最新的 seek 操作
        if (activeSeekRef.current?.token !== token) return
        const frame = captureJpegFromMedia(media)
        if (frame) {
          sessionDraft.updateDraft((prev) => {
            const curSnap = prev.targetSnapshot
            if (!curSnap) return {}
            // 2. 严格核对目标身份：时间范围、目标引用必须完全一致，防止快速切目标回填错图
            if (
              curSnap.rangeSpan?.start !== span.start ||
              curSnap.rangeSpan?.end !== span.end ||
              !curSnap.references?.some((r) => r.id === targetRef.id)
            ) {
              return {}
            }
            return {
              targetSnapshot: {
                ...curSnap,
                previewImage: frame,
              },
            }
          })
        }
      }
      media.addEventListener('seeked', onSeeked, { once: true })
      activeSeekRef.current = {
        token,
        cleanup: () => media.removeEventListener('seeked', onSeeked),
        targetId: targetRef.id,
        visualId: viewedPreview.id,
        span,
      }
      media.currentTime = span.start
      setPreviewTime(span.start)
    }

    // 固化目标快照：基准版本锁定为当前选定时的版本，不随后续预览切换自动偷换
    sessionDraft.updateDraft({
      targetSnapshot: {
        version: viewedPreview.revision ?? stageLead?.revision ?? null,
        /* 来源与「是否已确认」必须与版本号一起固化：
           之后用户切换预览，也不能用新预览的来源去解释这个旧数字。 */
        versionSeries: viewedPreview ? versionSeriesOf(viewedPreview) : null,
        versionConfirmed: projectVersion.authoritative,
        scope: 'selection',
        rangeSpan: { start: span.start, end: span.end },
        bbox: null,
        label: targetLabel,
        previewImage: initialJpeg,
        references: [targetRef, ...references.filter((r) => r.role !== 'target')],
        pinned: true,
        /* 意图继承顺序：旧快照的意图 → 用户刚在无目标状态下选的草稿级意图 → 默认修改。
           少了中间这一层，「先选『关于此提问』再圈时间段/框选画面」会被改回修改，
           用户的提问就变成了真实改工程。 */
        intentAction: sessionDraft.draft.targetSnapshot?.intentAction
          ?? sessionDraft.draft.intentAction
          ?? 'modify',
      },
    })
  }

  const clearTimeRange = () => {
    if (activeSeekRef.current?.cleanup) {
      activeSeekRef.current.cleanup()
      activeSeekRef.current = null
    }
    setLoopSpan(false)
    range.reset()
    setReferences((old) => old.filter((ref) => !(ref.role === 'target' && ref.kind === 'preview' && ref.endTimeSeconds !== undefined)))
    sessionDraft.updateDraft({
      targetSnapshot: null,
    })
  }

  // 切入工作台时，若共享草稿中有目标快照且包含时间选区，自动恢复至播放器时间轴
  useEffect(() => {
    if (sessionDraft.draft.targetSnapshot?.rangeSpan && !range.active) {
      range.setSpan(sessionDraft.draft.targetSnapshot.rangeSpan)
    }
  }, [sessionDraft.key])
  /** 左栏内容页点中一个单元：把它设成 AI 的修改范围，右栏切到对话，
      于是可以直接说「这一段……」。监看器与底部时间线不动 —— 它们放的是渲染切片
      （占位数据），拿它去对应真实内容会串。 */
  const selectContentRow = (row: ContentRow) => {
    setTargetReference(row.ref)
    setEditMode(false)
    setSideTab('chat')
    setFocusChatKey((k) => k + 1)
    setNotice(row.span
      ? `已把「${row.ref.label}」设为修改范围（${fmtClock(row.span.from)} 起，${row.span.duration.toFixed(1)}s）。`
      : `已把「${row.ref.label}」设为修改范围。这一段还没有真实画面，监看与时间线暂时定位不过去。`)
  }
  const openTaskRecords = () => {
    setTaskReturnTab(sideTab)
    setEditMode(false)
    setSideTab('task')
  }
  /** 切换右栏页签时退出 Remotion 编辑态，避免「参数 → 场景」后监看器仍停在编辑预览。 */
  const selectSideTab = (next: SideTab) => {
    setReviewTab(null)
    if (editMode && next !== 'edit') setEditMode(false)
    setSideTab(next)
    if (next === 'brief') setCanvasView('brief')
    else if (next === 'task') {
      if (selectedTaskRecordId || projectRecords.length > 0) setCanvasView('task')
      else setCanvasView('monitor')
    } else {
      setCanvasView('monitor')
    }
  }
  const addContextReference = (ref: AgentReference) => {
    setReferences((old) => old.some((item) => item.id === ref.id) ? old : [...old, ref])
  }
  const removeReference = (id: string) => {
    referencesEdited.current = true
    const targetItem = references.find((item) => item.id === id)
    const isTarget = targetItem?.role === 'target'
    const isRangePreview = isTarget && targetItem?.kind === 'preview' && targetItem?.endTimeSeconds !== undefined
    if (isRangePreview) {
      range.reset()
      setLoopSpan(false)
    }
    const nextReferences = references.filter((item) => item.id !== id)
    setReferences(nextReferences)
    const hasRemainingTarget = nextReferences.some((item) => item.role === 'target')
    if (!hasRemainingTarget) {
      capturedPreview.current = null
      setPreviewLocation(null)
      sessionDraft.updateDraft({ targetSnapshot: null })
    }
  }
  const clearReferences = () => {
    referencesEdited.current = true
    range.reset()
    setLoopSpan(false)
    capturedPreview.current = null
    setPreviewLocation(null)
    setReferences([])
    sessionDraft.updateDraft({ targetSnapshot: null })
  }
  const locateReference = (ref: AgentReference) => {
    if (ref.kind === 'preview') {
      setComparison(null); setEditMode(false); setSelectedArtifactId(null)
      const visual = stage.visuals.find((v) => v.id === ref.source.visualId)
      if (!visual) { setNotice('这条意见对应的预览已不可用。'); return }
      setSelectedVisual(visual.id === stageLead?.id ? null : { id: `stage:${visual.id}`, name: visual.name, kind: 'testfilm', mediaType: visual.media, filePath: visual.file })
      setPreviewLocation({ visualId: visual.id, timeSeconds: ref.timeSeconds, bbox: ref.bbox })
      return
    }
    if (ref.kind === 'artifact') { setSelectedArtifactId(ref.artifactId); setRailTab('artifacts'); return }
    if (ref.kind === 'project') { setComparison(null); setEditMode(false); setSelectedArtifactId(null); setSelectedVisual(null); setRailTab('overview'); return }
    /* 内容单元：监看器播的是渲染切片，定位不过去；把它在左栏那一页高亮出来。
       真实画面接上之后，这里再换成按时间轴 seek。 */
    if (ref.kind === 'scene') { setSelectedArtifactId(null); setRailTab('content'); return }
    /* 三库资源没有「画面位置」可定位：素材在素材库、参考片在参考片库、
       技法在特效库。跳过去比什么都不做强，但要说清去了哪。 */
    if (ref.kind === 'asset') { setNotice('素材在「我的素材」里管理。'); return }
    if (ref.kind === 'reference') { setNotice('参考片段在「参考片库」里查看。'); return }
    if (ref.kind === 'technique') { setNotice('技法在「特效库」里查看。'); return }
    const clip = ACTIVE_SCENES.find((item) => item.id === ref.shotId)
    /* 没有可靠定位数据时不假装跳转成功：给一句提示，而不是点下去毫无反应。 */
    if (!clip) { setNotice('该引用没有可定位的画面。'); return }
    setSelectedId(ref.shotId)
    setSelectedArtifactId(null)
    setEditMode(false)
    setRailTab('overview')
    const targetFrame = ref.kind === 'frame' || ref.kind === 'region'
      ? ref.frame
      : ref.kind === 'range'
        ? ref.startFrame
        : clip.startFrame + scenePreviewOffset(clip.durationFrames)
    resumeFrameRef.current = targetFrame
    setFrame(targetFrame)
  }
  const toggleReferenceRole = (id: string) => {
    if (references.some((ref) => ref.id === id && ref.role === 'context')) range.reset()
    setReferences((old) => {
      const picked = old.find((r) => r.id === id)
      if (!picked || (picked.kind === 'preview' && !picked.source.workflowId && picked.source.origin !== 'editor' && picked.role === 'context')) return old
      const promoting = picked.role !== 'target'
      const updated = old.map((ref) =>
        ref.id === id
          ? ({ ...ref, role: promoting ? 'target' : 'context' } as AgentReference)
          : promoting && ref.role === 'target'
          ? ({ ...ref, role: 'context' } as AgentReference)
          : ref
      )
      if (!promoting && !updated.some((r) => r.role === 'target')) {
        capturedPreview.current = null
        setPreviewLocation(null)
        sessionDraft.updateDraft({ targetSnapshot: null })
      }
      return updated
    })
  }
  const focusFeedback = () => { setReviewTab(null); setSideTab('chat'); setPanelOpen(true); setFocusChatKey((k) => k + 1) }
  const referencePreview = (region?: { x: number; y: number; w: number; h: number }, whole = false) => {
    if (!viewedPreview) return
    if (!aiModifyTargetCapability.allowed) {
      setNotice(aiModifyTargetCapability.reason || '当前画面无法作为修改目标')
      return
    }
    const media = previewMediaRef.current
    if (!whole && (!media || (media instanceof HTMLVideoElement ? media.readyState < 2 : !media.complete || !media.naturalWidth))) { setNotice('预览尚未加载，暂时无法引用当前位置。'); return }
    if (media instanceof HTMLVideoElement) media.pause()
    const timeSeconds = viewedPreview.media === 'video' && !whole ? (media instanceof HTMLVideoElement ? media.currentTime : previewTime) : undefined
    const id = `preview:${viewedPreview.id}:${whole ? 'whole' : timeSeconds ?? 'image'}:${region ? JSON.stringify(region) : ''}`
    if (!whole && media) {
      try {
        const w = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
        const h = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
        if (!w || !h) throw new Error('画面尺寸不可用')
        const scale = Math.min(1, 1600 / Math.max(w, h))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法创建画布')
        context.drawImage(media, 0, 0, canvas.width, canvas.height)
        capturedPreview.current = { id, image: canvas.toDataURL('image/jpeg', 0.85) }
      } catch {
        capturedPreview.current = null
        setNotice('无法提取当前画面，请重新加载预览后重试。')
        return
      }
    }
    regionStart.current = null
    setRegionMode(false)
    setRegionRect(null)
    setPreviewLocation({ visualId: viewedPreview.id, timeSeconds, bbox: region })
    const timeLabel = timeSeconds === undefined ? '' : ` · ${formatMediaTime(timeSeconds)}`
    const targetLabel = `${viewedPreview.name}${timeLabel}${region ? ' · 框选区域' : ''}`
    const targetRef: AgentReference = { id, role: 'target', kind: 'preview', source: previewSource(viewedPreview), timeSeconds, bbox: region, label: targetLabel }
    setTargetReference(targetRef)

    // 固化目标快照至共享草稿：携带真实 JPEG 画面与选定版本
    sessionDraft.updateDraft({
      targetSnapshot: {
        version: viewedPreview.revision ?? stageLead?.revision ?? null,
        /* 来源与「是否已确认」必须与版本号一起固化：
           之后用户切换预览，也不能用新预览的来源去解释这个旧数字。 */
        versionSeries: viewedPreview ? versionSeriesOf(viewedPreview) : null,
        versionConfirmed: projectVersion.authoritative,
        scope: region ? 'selection' : (whole ? 'project' : 'scene'),
        rangeSpan: null,
        bbox: region ? [region.x, region.y, region.w, region.h] : null,
        label: targetLabel,
        previewImage: capturedPreview.current?.image ?? null, // 必须是合法的 data:image/jpeg
        references: [targetRef, ...references.filter(r => r.role !== 'target')],
        pinned: true,
        /* 意图继承顺序：旧快照的意图 → 用户刚在无目标状态下选的草稿级意图 → 默认修改。
           少了中间这一层，「先选『关于此提问』再圈时间段/框选画面」会被改回修改，
           用户的提问就变成了真实改工程。 */
        intentAction: sessionDraft.draft.targetSnapshot?.intentAction
          ?? sessionDraft.draft.intentAction
          ?? 'modify',
      },
    })
    focusFeedback()
    const isSupported = backendCapability.imageSupported === true
    setNotice(!whole && !isSupported ? `已记录画面；${aiModifyTargetCapability.reason || '暂无法确认后端支持发送画面'}。` : whole ? '已引用当前预览，输入意见后发送。' : region ? '已引用当前画面及框选区域，输入意见后发送。' : '已引用当前画面，输入意见后发送。')
  }
  const referenceFrame = () => referencePreview()
  /** 提取当前真实画面帧保存为 PNG 下载，不混入任何 UI 覆盖层或选框 */
  const saveCurrentFrame = useCallback(() => {
    const media = previewMediaRef.current
    if (!media || !(media instanceof HTMLVideoElement || media instanceof HTMLImageElement)) {
      setNotice('当前没有可导出的画面')
      return
    }
    try {
      const canvas = document.createElement('canvas')
      const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
      const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
      if (!width || !height) {
        setNotice('画面分辨率尚未就绪')
        return
      }
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(media, 0, 0, width, height)

      const timeStr = formatMediaTime(previewTime).replace(/:/g, '-')
      const versionStr = viewedPreview ? `v${viewedPreview.revision}` : 'v1'
      const filename = `${project.name}_${versionStr}_${timeStr}.png`

      const link = document.createElement('a')
      link.download = filename
      link.href = canvas.toDataURL('image/png')
      link.click()
      setNotice(`已保存当前画面帧：${filename}`)
    } catch (err) {
      console.error('Failed to capture frame', err)
      setNotice('保存当前帧失败，受媒体加载或跨域策略限制')
    }
  }, [previewMediaRef, previewTime, viewedPreview, project.name])
  const referenceRegion = (bbox: { x: number; y: number; w: number; h: number }) => referencePreview(bbox)
  const referenceArtifact = (artifact: WorkbenchArtifact) => {
    addContextReference({
      id: `artifact:${artifact.id}:${artifact.version}`, role: 'context', kind: 'artifact',
      artifactId: artifact.id, version: artifact.version, label: `${artifact.title} · ${artifact.version}`,
    })
  }
  /** 实际视频显示矩形：stage 可能留白，Player 还会因 16:9 产生 letterbox。 */
  const mediaRect = () => {
    const media = previewMediaRef.current
    const box = media?.getBoundingClientRect()
    if (!box || !media) return null
    const widthNatural = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
    const heightNatural = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
    if (!widthNatural || !heightNatural) return null
    return containedMediaRect(box, widthNatural, heightNatural)
  }

  const regionPoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current?.getBoundingClientRect()
    const media = mediaRect()
    if (!stage || !media || media.width <= 0 || media.height <= 0) return null
    const sx = (e.clientX - stage.left) / stage.width
    const sy = (e.clientY - stage.top) / stage.height
    const mx = (e.clientX - media.left) / media.width
    const my = (e.clientY - media.top) / media.height
    if (mx < 0 || mx > 1 || my < 0 || my > 1) return null
    return { sx, sy, mx, my }
  }
  const startRegion = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!regionMode || e.button !== 0 || regionStart.current) return
    const p = regionPoint(e)
    if (!p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    regionStart.current = { ...p, pointerId: e.pointerId }
    setRegionRect({ x: p.sx, y: p.sy, w: 0, h: 0 })
  }
  const moveRegion = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!regionMode || !regionStart.current || regionStart.current.pointerId !== e.pointerId) return
    const start = regionStart.current
    const stage = stageRef.current?.getBoundingClientRect()
    const media = mediaRect()
    if (!stage || !media || !stage.width || !stage.height) return
    const x = Math.min(media.left + media.width, Math.max(media.left, e.clientX))
    const y = Math.min(media.top + media.height, Math.max(media.top, e.clientY))
    const sx = (x - stage.left) / stage.width
    const sy = (y - stage.top) / stage.height
    setRegionRect({ x: Math.min(start.sx, sx), y: Math.min(start.sy, sy), w: Math.abs(sx - start.sx), h: Math.abs(sy - start.sy) })
  }
  // 全局 Esc 按键统一调度：对比模式、框选模式、工作台全屏均支持 Esc 退出
  useEffect(() => {
    if (!comparison && !regionMode && panelOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 优先退出对比模式
      if (comparison) {
        setComparison(null)
        setComparisonAt(null)
        return
      }
      // 退出框选模式
      if (regionMode) {
        regionStart.current = null
        setRegionMode(false)
        setRegionRect(null)
        return
      }
      // 退出工作台全屏
      if (!panelOpen) {
        setPanelOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [comparison, regionMode, panelOpen])
  const endRegion = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = regionStart.current
    if (!regionMode || !start || start.pointerId !== e.pointerId) return
    const media = mediaRect()
    if (media) {
      const mx = Math.min(1, Math.max(0, (e.clientX - media.left) / media.width))
      const my = Math.min(1, Math.max(0, (e.clientY - media.top) / media.height))
      const box = { x: Math.min(start.mx, mx), y: Math.min(start.my, my), w: Math.abs(mx - start.mx), h: Math.abs(my - start.my) }
      if (box.w > 0.01 && box.h > 0.01) referenceRegion(box)
      else setNotice('框选范围太小，请重新拖拽选择画面区域。')
    } else setNotice('无法定位画面，请重新加载预览后再框选。')
    regionStart.current = null
    setRegionMode(false)
    setRegionRect(null)
  }
  /* 制作中插话的排队规则（演示适配器没有实时干预接口）：
     任务在跑时新发的不并行启动、不假装已干预 —— 先排队，当前任务结束（完成/失败）
     后按序启动；用户点了停止后，排队的先不动，等用户点「现在开始」或新发指令时
     再按序启动。请求在发送那一刻快照（引用与约束），排队期间改引用不影响已排的。 */
  const [pendingSubmits, setPendingSubmits] = useState<PendingSubmit[]>(() => readFeedbackQueue(projectId).items)
  const [holdQueue, setHoldQueue] = useState(() => readFeedbackQueue(projectId).hold)
  useEffect(() => {
    try { sessionStorage.setItem(`fm-feedback-queue:${projectId}`, JSON.stringify({ items: pendingSubmits.slice(-50), hold: holdQueue })) } catch { /* Queue remains available in this mounted workbench. */ }
  }, [projectId, pendingSubmits, holdQueue])
  const isLiveTask = (task: AgentTask | null | undefined) =>
    !!task && (task.status === 'queued' || task.status === 'running' || task.status === 'building')
  const buildRequest = (prompt: string, kind: TaskRequest['kind'], useConstraints: ModificationConstraints): TaskRequest => {
    const fallbackTarget = scope === 'project' ? currentProjectRef : defaultTarget
    const requestRefs = references.some((ref) => ref.role === 'target') ? references : [fallbackTarget, ...references]
    const derivedScope = scopeFromReferences(requestRefs)
    /* 范围里的场景：目标是左栏选中的内容单元时用它自己的 id —— 它来自工作流产物，
       和当前选中的渲染切片（selectedId，占位数据）不是一回事，不能互相顶替。 */
    const target = requestRefs.find((ref) => ref.role === 'target')
    const finalScope = target?.kind === 'project' ? 'project' : target?.kind === 'preview' ? 'selection' : derivedScope
    const sceneIds = finalScope === 'project'
      ? []
      : target?.kind === 'scene' ? [target.sceneId] : [selectedId]
    const finalConstraints: ModificationConstraints = finalScope === 'project'
      ? { ...useConstraints, limitToSelection: false }
      : useConstraints
    return structuredClone({
      projectId,
      workflowId: target?.kind === 'preview' ? target.source.workflowId : progressWorkflow?.id,
      workflowRevision: target?.kind === 'preview' ? (target.source.origin === 'editor' ? undefined : target.source.revision) : progressWorkflow?.revision,
      kind,
      prompt,
      scope: finalScope,
      sceneIds,
      references: requestRefs,
      constraints: finalConstraints,
      attachments: [],
    })
  }
  const startNow = (item: { prompt: string; request: TaskRequest; messageId?: string }) => {
    const id = tasks.start(item.request)
    if (item.messageId) chat.setMessageTaskId(item.messageId, id)
    else chat.addUserMessage(item.prompt, id, projectId)
    setBottomTab('activity')
    return id
  }
  const startQueued = (key: string) => {
    const item = pendingSubmits.find((p) => p.key === key && p.status === 'waiting')
    if (!item || isLiveTask(tasks.active?.task)) return
    setPendingSubmits((old) => old.filter((p) => p.key !== key))
    setHoldQueue(false)
    startNow(item)
  }
  const cancelQueued = (key: string) => {
    setPendingSubmits((old) => old.map((p) => (p.key === key ? { ...p, status: 'cancelled' } : p)))
  }
  const showPreview = (visual: StageVisual) => {
    setComparison(null); setEditMode(false); setSelectedArtifactId(null); setPreviewLocation(null)
    setSelectedStageVisual(visual.id === stageLead?.id ? null : visual)
  }
  const continueOpinion = (opinion: ReviewOpinion) => {
    // 1. 若本轮修改产出了新版本，核查新版本画面来源并切换供用户审视最新画面
    let afterVisual: StageVisual | undefined = undefined
    if (opinion.resultVisualId) {
      afterVisual = stage.visuals.find((v) => v.id === opinion.resultVisualId)
    } else if (typeof opinion.resultVersion === 'number') {
      const expectedOrigin = opinion.resultOrigin ?? 'scene'
      afterVisual = stage.visuals.find((v) => v.revision === opinion.resultVersion && v.origin === expectedOrigin)
      if (!afterVisual) {
        const matches = stage.visuals.filter((v) => v.revision === opinion.resultVersion)
        if (matches.length === 1 && matches[0].origin === 'scene') {
          afterVisual = matches[0]
        }
      }
    }

    if (afterVisual && viewedPreview?.id !== afterVisual.id) {
      showPreview(afterVisual)
    }

    // 2. 严格遵循边界：新版本时间轴与画面可能已变动，绝不直接套用旧目标快照或旧选区！
    // 彻底清空所有旧目标（不管是 preview、scene 还是 image 等任何 role === 'target' 的引用）
    setReferences((old) => old.filter((ref) => ref.role !== 'target'))
    clearTimeRange()
    setRegionMode(false)
    setRegionRect(null)
    setPreviewLocation(null)
    capturedPreview.current = null
    // 关键机制：与共享草稿深度绑定并持久化，标记需重新选择目标；刷新或切页后绝不丢失
    sessionDraft.updateDraft({
      targetSnapshot: null,
      continuationScopeMode: 'target_required',
    })

    // 3. 将上一轮要求带回草稿区供参考
    const next = `【基于上一轮意见继续调整】\n上一轮要求：${opinion.request.prompt}\n本轮补充意见：`
    appendWorkbenchDraftText(next)
    if (typeof opinion.resultVersion === 'number' && afterVisual) {
      setNotice(`已为你打开最新版本（v${opinion.resultVersion}）。新版时间轴与画面可能已变动，请在播放器中重新核对或圈定新目标后再提交。`)
    } else {
      setNotice('上一轮未生成新版本画面，已保留在当前画面。请核对修改目标后提出补充意见。')
    }
    focusFeedback()
  }

  const locateReviewOpinion = (opinion: ReviewOpinion) => {
    const target = opinion.request.references?.find((r) => r.role === 'target')
    if (!target) {
      setNotice('该意见未包含可定位的目标位置。')
      return
    }

    const previewTarget = target.kind === 'preview' ? target : null

    // 1. 严格核对基准版本：有 ID 严格按 ID 查，查不到直接提示画面不可用，绝不退回按版本号瞎猜！
    let targetVisual: StageVisual | undefined = undefined
    const knownId = opinion.baseVisualId || previewTarget?.source?.visualId
    if (knownId) {
      targetVisual = stage.visuals.find((v) => v.id === knownId)
      if (!targetVisual) {
        setNotice(`该意见关联的画面（${knownId}）已不可用，无法还原原版画面。未在当前版本展示旧选框。`)
        return
      }
    } else if (typeof opinion.baseVersion === 'number') {
      const expectedOrigin = opinion.baseOrigin ?? 'scene'
      targetVisual = stage.visuals.find((v) => v.revision === opinion.baseVersion && v.origin === expectedOrigin)
      if (!targetVisual) {
        const matches = stage.visuals.filter((v) => v.revision === opinion.baseVersion)
        if (matches.length === 1 && matches[0].origin === 'scene') {
          targetVisual = matches[0]
        }
      }
      if (!targetVisual) {
        setNotice(`该意见关联的基准版本（v${opinion.baseVersion}）已不可用，无法还原原版画面。未在当前版本展示旧选框。`)
        return
      }
    } else {
      setNotice('该意见历史记录未关联有效版本或画面，无法定位。')
      return
    }

    // 2. 准备定位信息
    setComparison(null)
    setEditMode(false)
    setSelectedArtifactId(null)

    const span = (typeof previewTarget?.timeSeconds === 'number' && typeof previewTarget?.endTimeSeconds === 'number')
      ? { start: previewTarget.timeSeconds, end: previewTarget.endTimeSeconds }
      : undefined

    const bbox = previewTarget?.bbox
    const noticeText = `已定位到 v${targetVisual.revision ?? opinion.baseVersion ?? '历史'} 目标位置。`

    // 3. 若已在当前画面且播放器已 ready，直接定位；否则进入待定位状态，并切换至目标画面
    if (viewedPreview?.id === targetVisual.id && previewReady) {
      if (previewMediaRef.current instanceof HTMLVideoElement && typeof previewTarget?.timeSeconds === 'number') {
        const media = previewMediaRef.current
        const targetTime = Number.isFinite(media.duration) ? Math.min(previewTarget.timeSeconds, media.duration) : previewTarget.timeSeconds
        media.currentTime = targetTime
        setPreviewTime(targetTime)
      } else if (typeof previewTarget?.timeSeconds === 'number') {
        setPreviewTime(previewTarget.timeSeconds)
      }
      if (span) range.setSpan(span)
      if (bbox) setPreviewLocation({ visualId: targetVisual.id, timeSeconds: previewTarget?.timeSeconds, bbox })
      setNotice(noticeText)
    } else {
      setPendingReviewLocate({
        visualId: targetVisual.id,
        timeSeconds: previewTarget?.timeSeconds,
        span,
        bbox,
        noticeText,
      })
      if (viewedPreview?.id !== targetVisual.id) {
        showPreview(targetVisual)
      }
    }
  }
  /**
   * 重新读取项目当前场景。
   *
   * <p>为什么提交成功后必须重读：后端在渲染成功时把新场景提交为新版本。
   * 界面若不重读，手里的 version 还是旧的，下一次提交会被 409 打回，
   * 用户会以为「刚改完就不能再改了」。</p>
   *
   * @param reason 触发原因，用于区分展示（成功 / 其它）
   */
  const refreshCurrentScene = async (reason: string) => {
    const probe = await tasks.currentScene(projectId)
    if (!probe.scene) return
    setCurrentSceneState(probe.scene)
    /* 每次场景变化都顺手刷新版本列表：用户改完立刻点开历史，
       就该看到刚产生的这一版。等打开面板才去读会慢一拍，还可能读到旧列表。 */
    void sceneVersions.refresh(true)
    if (reason === 'completed') {
      /* 成功时给一句确认，让用户知道界面上的场景确实已经换成新的了 */
      setNotice(`场景已更新到版本 ${probe.scene.version}`)
    }
  }

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
  const submitRealModify = async (prompt: string, span?: TimeSpan, previewImage?: string): Promise<boolean> => {
    if (!prompt.trim()) { setRealModifyError('请先写下制作要求'); focusFeedback(); return false }
    /* 时间段修改的基准是**当前工程版本**，不是画面列表首项：
       首项可能是编辑器试片，拿它比会把「看着当前工程版本」误判成历史。 */
    if (span && (!viewedPreview || viewedPreview.id !== projectVersionLead?.id || !Number.isFinite(previewDuration) || span.start < 0 || span.end <= span.start || span.end > previewDuration)) {
      setRealModifyError('请选择当前最新视频中有效的时间范围；历史版本请先恢复后再修改。')
      return false
    }
    /* 段落修改是同一件事的窄范围版本：落盘与请求里都要带「哪一段」。
       只把用户那句话写进去，下一轮（或换个会话）就再也看不出他指的是第 3–6 秒。 */
    const correctionText = span ? `${timeSpanBrief(span, prompt)}\n\n用户原话：${prompt.trim()}` : prompt
    if (sourceOperation.current || realModifyBusy || realRenderBusy || workflowRunning || remoteCreationBusy) return false
    sourceOperation.current = true
    setRealModifyBusy(true)
    setSourceCreationBusy(true)
    try {
      if (previewImage || span) {
        let capability: { supported: boolean; baseVersionCheck?: boolean; atomicCorrection?: boolean; correctionRetryId?: boolean }
        try {
          capability = await studioHttpApi().workflowContext.previewImageCapability(projectId)
        } catch (error) {
          setRealModifyError(error instanceof ApiError && error.httpStatus === 404
            ? '当前后端不支持安全地提交画面或时间范围，请更新并重启应用后重试。'
            : '无法确认目标版本校验是否可用，请检查本地服务连接后重试；输入和引用已保留。')
          return false
        }
        if (!capability.baseVersionCheck || !capability.atomicCorrection || !capability.correctionRetryId || (previewImage && !capability.supported)) {
          setRealModifyError('当前后端不支持所需的画面引用或版本校验，请更新并重启应用后重试。')
          return false
        }
      }
      /* 项目有 Remotion 工程时，修改走另一条路：
         意见写进 corrections.md，由 agent 改工程源码，再渲染出新的版本。
         不能走 modify 任务 —— 那条改的是 scenes 数据，
         而这个项目的画面在源码里，改数据不会让画面变。 */
      const context = await studioHttpApi().workflowContext.state(projectId)
      const baseline = await tasks.currentScene(projectId)
      /* 这里以**服务端当前场景版本**为准（baseline.scene.version），
         再要求正在看的是那条场景画面。不再要求「等于画面列表首项」——
         首项可能是试片，那个条件与服务端事实无关，只会误拒当前版本。 */
      if ((span || previewImage) && (viewedPreview?.origin !== 'scene' || !baseline.scene || viewedPreview.revision !== baseline.scene.version || viewedPreview.id !== projectVersionLead?.id)) {
        setRealModifyError('当前预览无法确认与项目最新工程版本一致，请先切换或恢复到当前版本。')
        return false
      }
      if (!baseline.scene && !context.initialized && !filmProject?.ready) {
        throw new Error(baseline.failure.message || '无法读取项目当前版本')
      }
      if (filmProject?.ready || context.initialized || !baseline.scene?.initialized) {
        try {
          // 确保有绑定的服务端会话，若无则自动为当前项目创建；失败则明确报错阻断
          const sessionResult = await ensureBoundSession(prompt)
          if (sessionResult.error || !sessionResult.sessionId) {
            setRealModifyError(`会话未保存：${sessionResult.error || '未能创建项目会话'}。输入已保留，未提交创作修改。`)
            return false
          }
          const effectiveSid = sessionResult.sessionId
          const targetedCorrection = Boolean(span || previewImage)
          const userPromptText = span ? `${prompt}\n（${formatMediaTime(span.start)}–${formatMediaTime(span.end)}）` : prompt

          /* 提前构建请求引用，确保服务端持久化明确的创作目标引用与 workflow_modify 类型标记，
             彻底防止切回对话区时被误判为未回复的普通聊天而自动二次起流 */
          const request = buildRequest(prompt, 'modify', constraints)
          const targetRef: NonNullable<ContractMessage['references']>[number] = {
            id: `ref-target-${projectId}`,
            role: 'target',
            kind: 'project',
            projectId,
            label: span ? `时间段修改（${formatMediaTime(span.start)}–${formatMediaTime(span.end)}）` : '工作台创作修改',
            action: 'workflow_modify',
          }
          const creationReferences: NonNullable<ContractMessage['references']> = [targetRef,...libraryReferences(request.references ?? [])] as NonNullable<ContractMessage['references']>

          // 核心点 1 & 2：真实持久化写入服务端会话，解耦幂等键与任务状态，重试时复用已落库消息
          const promptKey = JSON.stringify([effectiveSid,projectId,userPromptText,request.references,request.constraints,previewImage,baseline.scene?.version,submissionEngine])
          const isRetrySamePrompt = pendingSubmissionRef.current?.promptKey === promptKey
          let userMessageId = isRetrySamePrompt && pendingSubmissionRef.current?.userMessageId ? pendingSubmissionRef.current.userMessageId : null
          const idempotencyKey = isRetrySamePrompt && pendingSubmissionRef.current?.idempotencyKey ? pendingSubmissionRef.current.idempotencyKey : crypto.randomUUID()

          if (!userMessageId) {
            const nextPending = {
              promptKey,
              idempotencyKey,
              sessionId: effectiveSid,
              createdAt: Date.now(),
            }
            updatePendingSubmission(nextPending)

            if (threads) {
              try {
                const savedMsg = await threads.sendMessage(effectiveSid, userPromptText, {
                  idempotencyKey,
                  references: creationReferences,
                })
                userMessageId = savedMsg.id
                updatePendingSubmission({ ...nextPending, userMessageId })
              } catch (sendErr: unknown) {
                const msg = sendErr instanceof Error ? sendErr.message : String(sendErr)
                setRealModifyError(`会话消息未能写入服务端：${msg}。输入内容已保留，未提交创作修改。`)
                return false
              }
            } else {
              userMessageId = `m-wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
              updatePendingSubmission({ ...nextPending, userMessageId })
            }

            // 单一稳定 ID 写入前端 chat，消除多处各造 ID 导致的重复显示
            chat.appendMessage({
              id: userMessageId,
              role: 'user',
              text: userPromptText,
              projectId,
              sessionId: effectiveSid,
              references: creationReferences,
              at: Date.now(),
            })
          }

          /* 先落盘再让 agent 改：意见写进 corrections.md 是持久依据，
             agent 下一轮（甚至换个会话）都能读到。只发对话不落盘，
             刷新一次就没了，而用户以为已经提了。 */
          if (context.initialized && !targetedCorrection) {
            await studioHttpApi().workflowContext.recordCorrection(projectId, correctionText)
            review.addCorrection(correctionText)
          } else if (!context.initialized) {
            await studioHttpApi().workflowContext.init(projectId, review.brief.original || prompt)
            if (!targetedCorrection && review.brief.original && review.brief.original !== prompt) {
              await studioHttpApi().workflowContext.recordCorrection(projectId, correctionText)
              review.addCorrection(correctionText)
            }
          }
          setNotice(targetedCorrection ? '正在提交修改请求，正在核对目标版本…' : '修改意见已记入。Agent 正在按它改工程…')

          /* 只传三库资源：project/scene/frame 这些由原有链路处理，
             agent 侧只认「用户明确交给它的素材/参考片/特效」。
             时间段作为明确参数追加在意图末尾 —— 混在用户那句话里，agent 只能猜。 */
          const baseIntent = creationIntent(prompt, request.references ?? [], constraints, review.keepNotes)
          const previewPath = viewedPreview ? (new URL(viewedPreview.file, window.location.href).searchParams.get('path') ?? viewedPreview.file.split('?')[0]) : null
          const intent = span ? `${baseIntent}\n\n${timeSpanBrief(span, prompt, { version: viewedPreview?.origin === 'scene' ? viewedPreview.revision : currentSceneState?.version ?? null, file: previewPath?.split('/').pop() ?? null })}` : previewImage
            ? `${baseIntent}\n\n随本次请求附带的是用户选择时的完整画面；如目标包含 bbox，请按归一化坐标定位该区域，无法识别时先询问。`
            : baseIntent
          const attemptKey = JSON.stringify([projectId, baseline.scene?.version, intent, capturedPreview.current?.id, request.references, constraints, submissionEngine])
          if (targetedCorrection && correctionAttempt.current?.key !== attemptKey) {
            correctionAttempt.current = { key: attemptKey, id: crypto.randomUUID() }
            try { sessionStorage.setItem(`fm-correction-attempt:${projectId}`, JSON.stringify(correctionAttempt.current)) } catch { /* 保留本页的重试标识 */ }
          }
          const currentTaskId = targetedCorrection ? correctionAttempt.current?.id : userMessageId
          updatePendingSubmission({
            promptKey,
            idempotencyKey,
            sessionId: effectiveSid,
            userMessageId,
            taskId: currentTaskId,
            createdAt: Date.now(),
          })
          setExecutionPhase('analyzing')
          const phasePollTimer = window.setInterval(async () => {
            try {
              if (currentTaskId) {
                const st = await studioHttpApi().workflowContext.creation(projectId, currentTaskId)
                if (st && st.phase) {
                  setExecutionPhase(st.phase)
                }
              }
            } catch {
              // 忽略轮询网络抖动
            }
          }, 2000)
          let result
          try {
            result = await submitCreation({
              projectId, intent, references:libraryReferences(request.references ?? []), previewImage,
              baseVersion:targetedCorrection ? baseline.scene?.version : undefined,
              correction:targetedCorrection ? correctionText : undefined,
              requestId:currentTaskId!, sessionId:effectiveSid, userMessageId,
              selection:submissionEngine,
            }, (job)=>setExecutionPhase(job.phase))
          } finally {
            window.clearInterval(phasePollTimer)
            setExecutionPhase('')
          }
          if (targetedCorrection) {
            correctionAttempt.current = null
            try { sessionStorage.removeItem(`fm-correction-attempt:${projectId}`) } catch { /* 存储不可用时无需清理 */ }
            review.addCorrection(correctionText)
          }
          if (result.state === 'failed') {
            setAwaitingActive(false)
            const errorMsg = result.reply || '创作任务执行失败，工程代码未产生新版本。'
            setRealModifyError(errorMsg)
            setNotice(`创作未成功：${errorMsg}`)
            updatePendingSubmission(null)
            return false
          }

          setAgentReply(result.reply)
          if (result.reply) {
            // 核心点 1：AI 回复真实持久化写入服务端会话，保证更换浏览器或清缓存后多轮回复不丢失
            let serverAiId = `m-ai-${userMessageId}`
            if (threads) {
              try {
                const savedAi = await threads.sendMessage(effectiveSid, result.reply, {
                  role: 'assistant',
                  taskId: userMessageId,
                  idempotencyKey: `idem-reply-${userMessageId}`,
                })
                serverAiId = savedAi.id
                setUnsavedReplies(prev => prev.filter(r => r.userMessageId !== userMessageId))
                try {
                  const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
                  if (raw) {
                    const map = JSON.parse(raw)
                    delete map[userMessageId ?? '']
                    localStorage.setItem(`fm_unsaved_replies_${projectId}`, JSON.stringify(map))
                  }
                } catch { /* 忽略清理异常 */ }
              } catch (aiSaveErr) {
                console.warn('[Workbench] 助手回复写入服务端失败，使用本地与服务端双重兜底:', aiSaveErr)
                const item = {
                  userMessageId: userMessageId ?? '',
                  reply: result.reply,
                  sessionId: effectiveSid,
                  requestId: currentTaskId ?? '',
                }
                setUnsavedReplies(prev => [...prev.filter(r => r.userMessageId !== item.userMessageId), item])
                try {
                  const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
                  const map = raw ? JSON.parse(raw) : {}
                  map[item.userMessageId] = { ...item, timestamp: Date.now() }
                  localStorage.setItem(`fm_unsaved_replies_${projectId}`, JSON.stringify(map))
                } catch { /* 忽略本地存储写入异常 */ }
              }
            }
            const aiItem: ChatItem = {
              id: serverAiId,
              role: 'ai',
              text: result.reply,
              projectId,
              sessionId: effectiveSid,
              /* 带上**触发这条回复的用户消息 id**。
                 不带的话，本地即时显示的消息没有身份，归属判断只能等服务端
                 历史重新读回才成立 —— 那之前提示会缺失（补存失败时更是永远缺）。
                 服务端保存时也是用同一个值作 taskId，两处必须一致。 */
              ...(userMessageId ? { taskId: userMessageId } : {}),
              at: Date.now(),
            }
            chat.appendMessage(aiItem)
            threads?.appendExtraMessage(effectiveSid, aiItem)
          }
          setUsedResources(result.resources ?? [])

          /* agent 只提问、没有改动工程：没有产物也没有新版本。
             这时绝不能提示「已渲染出版本 vN」—— 旧工程本来就能渲，
             渲出来的还是上一版画面，用户会误以为改动生效了。
             界面上给出「等待补充信息」，并把 agent 的问题留在对话里，同时如实记入审阅记录。 */
          if (result.state === 'awaiting_info') {
            /* 按**轮次**记进共享 store：项目 + 会话 + 用户消息 id。
               拿不到 userMessageId 时不写（不猜），界面上就不显示。 */
            const recorded = recordRoundOutcome(projectId, effectiveSid, {
              reply: result.reply,
              ...(result.userMessageId ? { userMessageId: result.userMessageId } : {}),
              ...(result.requestId ? { requestId: result.requestId } : {}),
            })
            /* 本页产生了新轮次 → 回填缓存立刻失效（否则切走再回来不再拉取） */
            invalidateBackfill(projectId, effectiveSid)
            setAwaitingActive(recorded)
            rereadRuns()
            setRealModifyError('')
            setNotice('Agent 本轮没有改动工程，因此没有渲染新片。')
            const baseVer = baseline.scene?.version
            const baseVisual = viewedPreview && viewedPreview.origin === 'scene' && viewedPreview.revision === baseVer ? viewedPreview : undefined
            review.record(request, {
              baseVersion: baseVer,
              baseVisualId: baseVisual?.id,
              baseOrigin: baseVisual?.origin ?? 'scene',
              resultSummary: result.reply ? `Agent 提问：${result.reply}` : 'Agent 本轮未修改工程，等待补充信息',
            })
            updatePendingSubmission(null)
            return true
          }

          setAwaitingActive(false)
          const baseVer = baseline.scene?.version
          const baseVisual = viewedPreview && viewedPreview.origin === 'scene' && viewedPreview.revision === baseVer ? viewedPreview : undefined
          review.record(request, {
            baseVersion: baseVer,
            baseVisualId: baseVisual?.id,
            baseOrigin: baseVisual?.origin ?? 'scene',
            resultVersion: result.version ?? undefined,
            resultOrigin: 'scene',
            resultSummary: result.reply,
          })
          if (span && result.version !== null) setPendingPlayback({ version: result.version, start: span.start })
          setSelectedVisual(null); setSelectedArtifactId(null); setComparison(null)
          setNotice(result.version !== null
            ? `Agent 已完成修改，渲染出版本 v${result.version}。`
            : 'Agent 已返回渲染结果，正在更新版本列表。')
          /* 刷新版本与画面：让用户立刻看到新一版，并能与上一版对比。 */
          void sceneVersions.refresh(true)
          const probe = await tasks.currentScene(projectId)
          if (probe.scene) setCurrentSceneState(probe.scene)
          rereadRuns()
          setRealModifyError('')
          updatePendingSubmission(null)
          return true
        } catch (error) {
          /* 失败必须说清是「意见没记下」还是「agent 没改出来」——
             两者下一步完全不同。 */
          const message = error instanceof Error ? error.message : String(error)
          setRealModifyError(`Agent 修改未完成：${message}。意见可能已写入项目，重试前请先检查执行记录与项目状态。`)
          setNotice(`修改未完成：${message.slice(0, 120)}`)
          return false
        }
      }

      if (span) {
        setRealModifyError('当前项目的场景修改方式暂不支持按时间段修改，未提交请求。')
        return false
      }

      /* 先读当前场景：既拿到 baseVersion 做版本预检，也确认项目确实有场景。
         没有场景时不能提交 —— 后端会拒绝，前端也不该把一个注定失败的请求发出去。 */
      const probe = await tasks.currentScene(projectId)
      if (!probe.scene) {
        setRealModifyError(probe.failure.message || '读取当前场景失败')
        return false
      }
      if (!probe.scene.initialized) {
        /* 修改需要已有场景做基线，没有就明确拒绝。
           这里刻意不再自己造一条「从一句话生成」的旁路：项目已有的
           workflow-v0.1.1 才是创作路径，绕开它另做一条简化管线
           （比如只生成文字卡片）会偏离产品方向，也让两套流程并存。
           真正的创作入口应走工作流，等它接通后替换这句提示。 */
        setRealModifyError('项目还没有场景。请先在工作流里创作一条片子，再对它提出修改。')
        return false
      }

      /* 范围沿用 buildRequest 的推导结果：它在到处都在用，另写一份
         「哪一段」的判定迟早会和它给出不同答案。selection 第一版后端不支持，
         按 project 提交前必须先告诉用户，不能悄悄放大范围。 */
      const derived = buildRequest(prompt, 'modify', constraints)
      if (review.keepNotes.trim()) {
        setRealModifyError('已保存的保留要求暂不参与真实修改。请先清除该要求；当前无法保证这些保留条件。')
        return false
      }
      if (derived.references?.some((ref) => ref.role === 'context')) {
        setRealModifyError('当前场景修改模式暂不支持带入参考上下文。若需提交，请先在引用栏中移除参考引用或清空后再试。')
        return false
      }
      if (derived.scope === 'selection') {
        setRealModifyError('选区修改暂不支持，请改为选定某个场景或整片后再试')
        return false
      }
      // 备用路径同样严格接入服务端会话与持久化，杜绝孤儿消息
      const sessionResult = await ensureBoundSession(prompt)
      if (sessionResult.error || !sessionResult.sessionId) {
        setRealModifyError(`会话未保存：${sessionResult.error || '未能创建项目会话'}。输入已保留，未提交修改任务。`)
        return false
      }
      const effectiveSid = sessionResult.sessionId

      const useScene = derived.scope === 'scene' && derived.sceneIds.length > 0
      const altTargetRef: NonNullable<ContractMessage['references']>[number] = useScene && derived.sceneIds[0]
        ? {
            id: `ref-scene-${derived.sceneIds[0]}`,
            role: 'target',
            kind: 'scene',
            sceneId: derived.sceneIds[0],
            label: '场景修改',
            action: 'workflow_modify',
          }
        : {
            id: `ref-project-${projectId}`,
            role: 'target',
            kind: 'project',
            projectId,
            label: '全局项目修改',
            action: 'workflow_modify',
          }
      const altReferences: NonNullable<ContractMessage['references']> = [altTargetRef]

      // 统一两条提交路径的重试幂等与状态解耦
      const promptKey = `${effectiveSid}:${projectId}:${prompt}:alt`
      const isRetrySamePrompt = pendingSubmissionRef.current?.promptKey === promptKey
      let userMsgId = isRetrySamePrompt && pendingSubmissionRef.current?.userMessageId ? pendingSubmissionRef.current.userMessageId : null
      const altIdempotencyKey = isRetrySamePrompt && pendingSubmissionRef.current?.idempotencyKey ? pendingSubmissionRef.current.idempotencyKey : crypto.randomUUID()

      if (!userMsgId) {
        const nextPending = {
          promptKey,
          idempotencyKey: altIdempotencyKey,
          sessionId: effectiveSid,
          path: 'alt' as const,
          createdAt: Date.now(),
        }
        updatePendingSubmission(nextPending)

        if (threads) {
          try {
            const savedMsg = await threads.sendMessage(effectiveSid, prompt, {
              idempotencyKey: altIdempotencyKey,
              references: altReferences,
            })
            userMsgId = savedMsg.id
            updatePendingSubmission({ ...nextPending, userMessageId: savedMsg.id })
          } catch (saveErr: unknown) {
            const msg = saveErr instanceof Error ? saveErr.message : String(saveErr)
            setRealModifyError(`会话消息未能写入服务端：${msg}。输入内容已保留，未提交修改任务。`)
            return false
          }
        } else {
          userMsgId = `m-wb-alt-${Date.now().toString(36)}`
          updatePendingSubmission({ ...nextPending, userMessageId: userMsgId })
        }

        chat.appendMessage({
          id: userMsgId,
          role: 'user',
          text: prompt,
          projectId,
          sessionId: effectiveSid,
          references: altReferences,
          at: Date.now(),
        })
      }

      // 消息已落盘后，启动后台任务
      const result = await tasks.startModify(projectId, {
        kind: 'modify',
        prompt,
        scope: useScene ? 'scene' : 'project',
        sceneIds: useScene ? derived.sceneIds : [],
        baseVersion: probe.scene.version,
      }, (status) => {
        /* 任务结束后重新读取当前场景：
           - completed：场景已被后端提交为新版本，界面必须立刻反映新内容与新版本
           - 其它：也重读一次，以免界面停留在提交前的旧版本上继续修改
           这一步失败不提示：任务结果本身还没展示完，再弹一个错误会盖住它。 */
        void refreshCurrentScene(status)
      })
      if (!result.taskId) {
        const failure = result.failure
        /* 冲突单独给一句：用户需要知道「刷新后重试」，而不是以为要求写错了 */
        const hint = failure?.reason === 'conflict'
          ? '场景已被其他操作更新，请刷新后再试'
          : failure?.message
        setRealModifyError(`任务启动失败：${hint || '提交失败'}。意见已记录在会话中。`)
        return false
      }
      setRealModifyError('')
      updatePendingSubmission(null)
      // 审阅记录只包含真实提交的目标与文字，不把本地需求、引用或保留条件当成发送记录。
      review.record({
        ...derived,
        scope: useScene ? 'scene' : 'project',
        sceneIds: useScene ? derived.sceneIds : [],
        references: (derived.references ?? []).filter((ref) => ref.role === 'target' && (ref.kind === 'project' || (useScene && ref.kind === 'scene'))),
        constraints: { preserveCamera: false, preserveCaptions: false, limitToSelection: useScene, reuseExistingComponents: false },
      }, { includeBrief: false })

      // 真实落盘至前端 chat，带有确定性 ID、taskId 与 target 引用
      chat.appendMessage({
        id: userMsgId,
        role: 'user',
        text: prompt,
        projectId,
        sessionId: effectiveSid,
        taskId: result.taskId,
        references: altReferences,
        at: Date.now(),
      })
      setBottomTab('activity')
      return true
    } catch (error) {
      setRealModifyError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      sourceOperation.current = false
      setRealModifyBusy(false)
      setSourceCreationBusy(false)
      rereadRuns()
    }
  }

  /**
   * 提交一次「只改这段时间」的修改。
   *
   * <p>为什么不复用对话输入框那条路：那边的范围由引用与作用域推导，
   * 时间段只是标签里的一句话，agent 读到的仍是一句自然语言。
   * 这里把起止秒数当成独立参数拼进意图（见 {@link timeSpanBrief}），
   * 并在用户的话之外写清「其余时间段尽量不变」只是目标而非承诺。</p>
   *
   * <p>提交前先暂停播放：用户刚圈定的那几秒正在播的话，
   * 等新版本回来时播放头早已跑过那一段，他会以为改的不是自己看的地方。</p>
   *
   * @param span 用户圈定的时间段（已按片长钳过）
   * @param requirement 对这几秒的要求
   */
  const submitTimeSpan = async (span: TimeSpan, requirement: string): Promise<boolean> => {
    if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause()
    return submitRealModify(requirement, span)
  }

  /**
   * 提交修改：优先真实后端，只有用户显式选择演示才走 Mock。
   *
   * <p>此前所有提交都进演示路径，界面看起来「能用」，实际什么都没改。
   * 现在默认打真实接口；演示入口保留为独立按钮，标注清楚。</p>
   */
  const submit = async (prompt: string): Promise<boolean> => {
    /* 去向由唯一判定函数决定 —— 与对话区发送、与胶囊显示共用同一份结果。
       这里不再自己读一遍意图：两套顺序一旦分叉，界面就会说谎。 */
    const plan = resolveSendPlanFromDraft(sessionDraft.draft, Boolean(projectId))

    /* 继续调整保护模式缺目标：这里也要拦，不能因为工作台默认显示「全局工程」就当成整片修改。 */
    if (plan.kind === 'blocked') {
      setRealModifyError('继续调整已清空上一轮目标。请在播放器中框选画面或选择时间段；若确需调整整片工程，请点击【确认整片修改】后再提交。')
      return false
    }

    /* 明确提问意图：仅作为会话对话发送并启动真实 AI 回复，绝不触发视频修改 */
    const isQueryIntent = plan.kind === 'chat'
    if (isQueryIntent) {
      const effectiveSid = boundSessionId || currentSession?.id || null
      if (!effectiveSid) {
        setRealModifyError('当前项目尚未绑定或选择会话，无法发起会话提问。请先在对话区选择会话。')
        return false
      }

      const target = references.find((ref) => ref.role === 'target')
      const targetLabel = sessionDraft.draft.targetSnapshot?.label || target?.label || '当前目标'
      const queryReferences: any[] = [
        ...(references || []).map((r) => ({ ...r, role: 'context' as const })),
        {
          id: `ref-query-${projectId}`,
          role: 'context' as const,
          kind: 'project' as const,
          projectId,
          label: targetLabel,
          action: 'workflow_query',
        },
      ]

      try {
        let savedMsgId: string | undefined = undefined
        if (threads) {
          const savedMsg = await threads.sendMessage(effectiveSid, prompt, {
            idempotencyKey: crypto.randomUUID(),
            references: queryReferences as any,
          })
          savedMsgId = savedMsg.id
          chat.appendMessage(savedMsg)
        } else {
          savedMsgId = chat.addUserMessage(prompt, undefined, projectId, effectiveSid)
        }

        // 启动真实 AI 流式回复：明确附带 projectId 与 sessionId，确保在工作台过滤白名单内实时可见
        const aiId = chat.startAiMessage({ demo: false, projectId, sessionId: effectiveSid })
        try {
          const streamHandle = studioHttpApi().chat.stream(effectiveSid, {
            onReasoning: (_mid, delta) => {
              chat.appendAiReasoning(aiId, delta)
            },
            onDelta: (_mid, delta, replaceFrom) => {
              chat.appendAiText(aiId, delta, replaceFrom)
            },
            onTodo: (todos) => {
              chat.setAiTodos(aiId, todos)
            },
            /* 工具调用必须实时接上 —— 原先这里没有 onStatus，侧栏执行过程中
               看不到任何步骤，只有 onCompleted 之后重读历史才有。
               用户在最关心「AI 到底改了什么」的地方，反而看不到执行过程。 */
            onStatus: (status) => {
              chat.recordToolCall(aiId, status)
            },
            /* 这一轮改动了工程：后端自动渲染，出片后刷新版本，画面区直接播新片 */
            onRender: (render) => {
              if (render.message) setNotice(render.message)
              if (render.state === 'rendered') notifyProjectRendered(projectId, render.version)
            },
            onCompleted: (message) => {
              chatStreamManager.notifyCompleted(effectiveSid)
              chat.finishAiMessage(aiId, message.text, message.toolCalls, message.reasoning, message.todos, message.deliverables)
              if (threads) {
                void threads.loadMessages(effectiveSid, { force: true })
              }
            },
            onError: (err) => {
              chatStreamManager.notifyError(effectiveSid, err.message)
              chat.failAiMessage(aiId, err.message)
            },
            onStopped: () => {
              /* 服务端已确认这一轮停止（收到 stopped 事件），这里只做本地清理。
                 **不再调用 chatStreamManager.stop** —— 停止请求由用户点击时发出，
                 这里再调一次会重复打 /stop，也会把已是 stopped 的状态重新广播。
                 与对话区同一套语义：用户消息在启动回复流之前已写入服务端，
                 停止后不保存的只是这条未完成的 AI 回复，撤掉占位避免半截回复留在侧栏。 */
              chat.removeMessage(aiId)
              setNotice('已停止生成。你的消息已保存，这条回复没有保存。')
            },
          }, submissionEngine)
          chatStreamManager.register({
            sessionId: effectiveSid,
            userMessageId: savedMsgId,
            aiMessageId: aiId,
            stop: () => streamHandle.close(),
            startedAt: Date.now(),
          })
        } catch (streamErr: unknown) {
          const msg = streamErr instanceof Error ? streamErr.message : String(streamErr)
          chatStreamManager.notifyError(effectiveSid, msg)
          chat.failAiMessage(aiId, `AI 回复流连接失败：${msg}`)
        }

        setNotice(`已就「${targetLabel}」在会话中发起提问。`)
        return true
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setRealModifyError(`提问发送失败：${msg}`)
        return false
      }
    }

    /* 真实路径是默认。失败已由 submitRealModify 写好错误并保留输入；
       这里**不回退演示** —— 静默换成假执行会让用户以为改动生效了。 */
    // 1. 若处于继续调整保护模式且没有有效可执行局部目标，严格拦截！
    if (adjustPendingConfirm) {
      setRealModifyError('继续调整已清空上一轮目标。请在播放器中框选画面或选择时间段；若确需调整整片工程，请点击【确认整片修改】后再提交。')
      return false
    }

    // 2. 检查选中的目标是否属于不支持局部修改的类型，明确报错拦截，绝不放行滑入无范围整片修改！
    if (targetEvaluation.status === 'unsupported_target') {
      setRealModifyError(targetEvaluation.reason)
      return false
    }

    // 3. 严格按支持的局部修改能力分发执行：
    if (targetEvaluation.status === 'valid_frame') {
      /* 提交前再核一次能力：界面状态可能因服务变化而滞后，真正发请求时必须以当下为准。 */
      if (!aiModifyTargetCapability.allowed) {
        setRealModifyError(aiModifyTargetCapability.reason || '当前无法提交画面修改')
        return false
      }
      return submitRealModify(prompt, undefined, targetEvaluation.image)
    }
    if (targetEvaluation.status === 'valid_span') {
      if (!spanModifyCapability.allowed) {
        setRealModifyError(spanModifyCapability.reason || '当前无法提交时间段修改')
        return false
      }
      const requirement = targetEvaluation.target.id.startsWith('clip:')
        ? `修改目标：${targetEvaluation.target.label}。\n${prompt}`
        : prompt
      return submitTimeSpan(targetEvaluation.span, requirement)
    }

    // 4. 只有当明确没有任何局部目标（targetEvaluation.status === 'none' 且已确认整片或常规制作）时，才调用整片修改
    return submitRealModify(prompt)
  }

  const handleConfirmWholeProject = () => {
    // 1. 显式设置项目目标，并将原本的局部 target 降级为 context 作为参考，杜绝 buildRequest 回退到当前画面
    setReferences((old) => [
      currentProjectRef,
      ...old
        .filter((ref) => ref.id !== currentProjectRef.id)
        .map((ref) => (ref.role === 'target' && ref.kind !== 'project' ? { ...ref, role: 'context' as const } : ref)),
    ])
    // 2. 清除局部范围约束（重置 limitToSelection 为 false）
    setConstraints((old) => ({
      ...old,
      limitToSelection: false,
    }))
    // 3. 清理局部选区与画面抓取
    range.reset()
    setLoopSpan(false)
    capturedPreview.current = null
    setPreviewLocation(null)
    // 4. 明确修改范围为整片工程
    setScope('project')
    setRealModifyError('')
    // 5. 同步更新共享草稿：确认整片模式，清空局部目标快照
    sessionDraft.updateDraft({
      continuationScopeMode: 'whole_confirmed',
      targetSnapshot: null,
    })
    setNotice('已确认本轮修改范围为整片工程，已设置项目目标并清除局部选区约束。')
  }
  useEffect(() => {
    if (holdQueue) return
    const active = tasks.active?.task
    if (isLiveTask(active)) return
    const head = pendingSubmits.find((p) => p.status === 'waiting')
    if (!head) return
    setPendingSubmits((old) => old.filter((p) => p.key !== head.key))
    startNow(head)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.active?.task.status, holdQueue])
  /* 右栏（对话流 / 任务记录）里点停止：中止任务，并按住排队 —— 别在用户刚叫停时
     就把排队的下一条悄悄启动。底部托盘的停止走同一处理。 */
  const cancelTaskAndHold = (taskId: string) => {
    tasks.cancel(taskId)
    setHoldQueue(true)
  }
  const runQuickAction = (action: (typeof quickActions)[number]) => {
    if (action.compare) {
      /* 只从当前项目真实存在的预览选择比较来源。 */
      openReview('versions')
      return
    }
    if (action.constraint === 'attachment') { setNotice('素材上传还没接通。'); return }
    if (action.constraint) {
      const enabled = !constraints[action.constraint]
      const nextConstraints = { ...constraints, [action.constraint as keyof ModificationConstraints]: enabled }
      setConstraints(nextConstraints)
      /* 请求里的约束必须就是这次切换后的值：setConstraints 是异步的，
         直接读 constraints 闭包会拿到切换前的一份。 */
      setNotice('保留条件已更新，将随下一条意见发送。')
      return
    }
    if (action.id === 'undo' || action.id === 'redo') {
      setNotice('没有可撤销的修改。')
      return
    }
    if (action.prompt) { setWorkbenchDraftText(action.prompt); focusFeedback() }
  }

  /**
   * 下载最新可交付整片。
   *
   * <p>为什么不能只写一句「已开始下载」：<a download> 的点击是同步返回的，
   * 浏览器不会告诉我们文件有没有真的取到。目标不可达（后端没起、产物被清理、
   * 网络中断）时，界面照样提示「已开始下载」，用户去文件夹里却找不到东西 ——
   * 这正是「导出成功或失败时的实际行为」要核对的地方。</p>
   *
   * <p>所以先用一次 HEAD/GET 探测产物是否真的可读，确认后才触发下载；
   * 取不到就如实说取不到，并指出是哪个版本。</p>
   */
  const exportDeliverable = async () => {
    const target = deliverableLead
    if (!target) {
      setNotice('这次制作还没有产出整片，没有可导出的文件。')
      return
    }
    if (!target.file) {
      setNotice(`v${target.revision} 的整片没有可下载的地址，无法导出。`)
      return
    }
    setExporting(true)
    try {
      /* 必须先把字节取回来，再用 blob: 地址下载。
         为什么不能直接 <a href={产物地址} download>：产物地址是后端的
         http://127.0.0.1:8080，与应用页面（fengmotion://app/）不同源，
         浏览器会忽略 download 属性、把视频当页面直接打开 ——
         实测点「导出」会跳走整个工作台去播放那个文件，而不是下载。
         先取字节再下载，既避开跨源限制，也能据此判断成功与否。 */
      const response = await fetch(target.file)
      if (!response.ok) {
        setNotice(`导出失败：v${target.revision} 的整片无法读取（HTTP ${response.status}）。`)
        return
      }
      /* 按后端契约判断返回内容：非视频类型的 2xx 多半是错误页/JSON，
         当成视频存下去用户会得到一个打不开的文件。 */
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
      if (contentType && !contentType.startsWith('video/') && !contentType.includes('octet-stream')) {
        setNotice(`导出失败：v${target.revision} 返回的不是视频（${contentType.slice(0, 40)}）。`)
        return
      }
      const blob = await response.blob()
      if (blob.size === 0) {
        setNotice(`导出失败：v${target.revision} 的整片是空文件。`)
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = target.name
      document.body.append(a)
      a.click()
      a.remove()
      /* 立刻回收会让部分浏览器来不及开始下载，留一拍再释放。 */
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      /* 说明这次导出的是哪一版 —— 用户可能正在看历史版本。
         用 versionItemLabel 统一口径：场景版本写 vN，试片/工作流产物带来源前缀。 */
      const viewing = viewedPreview && viewedPreview.id !== target.id
        ? `（当前正在查看 ${versionBadgeLabel(viewedPreview)}，导出的仍是最新整片 ${versionItemLabel(target)}）`
        : ''
      /* 【文案边界】`a.click()` 之后应用**无法观测**用户是否接受保存、
         目标路径是否可写、下载是否被取消、文件是否落盘 ——
         浏览器没有把这个结果回传给页面的接口。
         所以这里只能说「已获取数据并已发起下载」。
         写「已下载」是把不可知的事说成已确认，用户遇到取消或磁盘满
         就会以为文件在，实际没有。真实完成/取消要等原生下载接口能返回结果。 */
      setNotice(`已获取 ${versionItemLabel(target)} 的整片，已发起下载${viewing}`)
    } catch (error) {
      /* 取字节失败：产物不可达或后端没起，如实说明，不提示成功。 */
      const message = error instanceof Error ? error.message : String(error)
      setNotice(`导出失败：无法读取 v${target.revision} 的整片（${message.slice(0, 80)}）。`)
    } finally {
      setExporting(false)
    }
  }
  const workbenchViewSwitch = (
    <ViewSwitch
      current="workbench"
      onSwitch={(target) => {
        if (target === 'conversation') {
          setPanelOpen(true)
          onNavigate('conversation')
        }
      }}
    />
  )
  const previewExport = (
      <div className="wb-top-actions">
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="wb-export" type="button" disabled={!stageDeliverable || exporting}
                    onClick={() => void exportDeliverable()}>
              <UiIcon icon={SemIcons.download} size="md" />{exporting ? '导出中…' : '导出最新版本'}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {stageDeliverable && deliverableLead
              ? `下载最新产出的整片（v${deliverableLead.revision}），即使当前正在查看历史版本。`
              : '这次制作还没有产出整片，没有可导出的文件。'}
          </TooltipContent>
        </Tooltip>
      </div>
  )
  const previewActions = <div className="wb-preview-actions">{previewExport}{workbenchViewSwitch}</div>

  return (
    <div className="wb-a2 wb-studio flex h-full min-h-0 flex-col" data-editor={editMode} data-mode="dark">

      {/* ═══ 基岛：顶栏（工作台全屏状态下彻底隐藏，释放视口与全部宽度） ═════════ */}
      {panelOpen && (
        <div className="wb-projectbar" data-panel="open" data-editor={editMode} style={{ '--open-chat-width': `${split.width}px` } as React.CSSProperties}>
        {/* 左上角不再放「返回我的创作」和「项目内容与进度」两个孤立方按钮：
            返回有左侧导航「我的创作」常驻，抽屉入口收进了项目标识胶囊的菜单 ——
            顶栏左侧只留一处「我在哪个项目」，视线不用先在一排按钮里找位置。 */}
        <div className="wb-crumb">
          <div className="wb-project-context" ref={switchRef} data-open={switchOpen ? '' : undefined}>
            {/* 项目标识做成一颗胶囊：图标、项目名、展开箭头同属一个控件。
                原先图标是一个独立的白色方块、项目名又是一个透明按钮，
                三块并排看起来像三个不相干的按钮，而不是「当前项目」这一件事。 */}
            <button className="wb-project-switch" type="button"
                    aria-expanded={switchOpen} aria-haspopup="menu"
                    title={`当前项目：${project.name}`}
                    onClick={() => setSwitchOpen((v) => !v)}>
              <span className="wb-logo" aria-hidden="true"><UiIcon icon={SemIcons.film} size="sm" /></span>
              <span className="wb-project-name">{project.name}</span>
              <UiIcon icon={SemIcons.collapse} className="wb-caret" />
            </button>
            {switchOpen && (
              <div className="wb-switch-menu" role="menu">
                <div className="wb-switch-head">
                  <span>切换项目</span>
                  <span className="fw-count">{catalog.length}</span>
                </div>
                {catalog.map((p) => (
                  <button key={p.id} type="button" role="menuitem"
                          aria-current={p.id === project.id ? 'true' : undefined}
                          onClick={() => { setSwitchOpen(false); if (p.id !== project.id) onSwitchProject(p.id) }}>
                    <span className="wb-menu-project">
                      <b className="truncate">{p.name}</b>
                      <small>{p.doneClips}/{p.totalClips} 场</small>
                    </span>
                    {p.id === project.id && <UiIcon icon={SemIcons.check} className="size-3.5 wb-menu-check" />}
                  </button>
                ))}
                {/* 「项目空间」那四个页签（概览/产物/内容/资料）已按作者要求移除：
                    菜单只负责「换哪个项目」，不要再塞第二种导航 ——
                    两类操作混在一个下拉里，用户点之前不知道会换项目还是换页。 */}
                <button type="button" role="menuitem" className="wb-switch-all"
                        onClick={() => { setSwitchOpen(false); onBack() }}>
                  <UiIcon icon={Folder} className="size-3.5" />全部项目
                </button>
              </div>
            )}
          </div>
          {/* 面包屑只留「项目 / 场景名」。原来还挂着内部编号（S01）与「当前成片」
              —— 编号是数据层的 id，用户不需要；「当前成片」是默认态，说出来等于没说。
              同理删掉右侧的分辨率/帧率/时长：分辨率与帧率画面角标已经有了，
              总时长底部状态条也有，这里是第三遍。 */}
          <span className="wb-crumb-sep">/</span>
          <span className="wb-crumb-scene">{stageLead ? stageLead.tierLabel : '制作工作台'}</span>
        </div>
        {editMode && <div className="wb-projectbar-actions">{previewActions}</div>}
      </div>
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

        {panelOpen && <div className="open-workbench-conversation">
        {/* 标题与页签栏是这一列所有面板共用的底座：
            对话 / 创作要求 / 执行记录 / 版本 / 修改审阅 都在这条页签上，
            切换时只换下面的内容区，导航本身在任何情况下（包括编辑态）均不消失。 */}
        <ConsoleChrome
          sideTab={sideTab}
          onChange={(next) => { if (editMode) setEditMode(false); selectSideTab(next) }}
          sessions={projectSessions}
          currentSessionId={currentSession?.id}
          onSelectSession={(sid) => {
            setBoundSessionId(sid)
            onSelectSession?.(sid)
          }}
          projectName={projectName}
        />
        {editMode ? (
          <div className="fw-scroll flex flex-col h-full p-4">
            <div className="font-medium text-sm text-[var(--tx)]">场景对象与属性</div>
            <p className="text-xs text-[var(--tx2)] mt-2 leading-relaxed">
              当前正在右侧工作区编辑 Remotion 场景。点击上方“对话”或任意页签可随时退出编辑态返回对话。
            </p>
            <div className="mt-4">
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-[var(--tx)] hover:border-blue-500/40 transition-colors"
                onClick={closeEdit}
              >
                退出编辑，返回对话
              </button>
            </div>
          </div>
        ) : sideTab === 'versions' ? (
          <SceneVersionPanel projectId={projectId} scene={currentSceneState} versions={sceneVersions}
            viewedVersion={viewedPreview?.origin === 'scene' ? viewedPreview.revision : undefined}
            onView={(visual) => showPreview(visual)}
            onCompare={(left, right) => { setEditMode(false); setSelectedArtifactId(null); setSelectedVisual(null); setComparison([left, right]); setComparisonAt(null); setTrayOpen(false) }}
            onClose={() => { selectSideTab('chat'); void sceneVersions.refresh(true) }}/>
        ) : sideTab === 'review' ? (
          <WorkbenchReviewDesk projectId={projectId} review={review} visuals={stage.visuals} viewedId={viewedPreview?.id}
            onClose={() => { focusFeedback() }} onDiscuss={focusFeedback}
            onView={showPreview} onCompare={(left, right, opinion) => {
              setEditMode(false); setSelectedArtifactId(null); setComparison([left, right]); setTrayOpen(false)
              const at = opinion?.request.references?.find((ref) => ref.role === 'target') ?? effectiveTarget
              setComparisonAt(at.kind === 'preview' && 'timeSeconds' in at ? { timeSeconds: at.timeSeconds, bbox: at.bbox } : null)
            }}
            onLocate={locateReviewOpinion}
            onContinue={continueOpinion}/>
        ) : sideTab === 'brief' || (sideTab as string) === 'settings' ? (
          <BriefPanel
            review={review}
            onDiscuss={focusFeedback}
            activeSection={briefSection}
            onSelectSection={(sec) => {
              setBriefSection(sec)
              setCanvasView('brief')
            }}
          />
        ) : sideTab === 'task' ? (
          <TaskRecordPanel
            activeTask={projectTask?.task ?? null}
            records={projectRecords}
            cancelTask={cancelTaskAndHold}
            selectedTaskId={selectedTaskRecordId}
            onSelectTaskId={(id) => {
              setSelectedTaskRecordId(id)
              setCanvasView('task')
            }}
            onResumeRequest={(request) => {
              setReferences(structuredClone(request.references ?? [])); setConstraints(structuredClone(request.constraints)); setScope(request.scope); setWorkbenchDraftText(request.prompt); focusFeedback()
            }}
            onDiscuss={focusFeedback}
          />
        ) : (
          <RightPanel sourceMode={!!filmProject?.ready || projectWorkflows.length > 0 || !currentSceneState?.initialized} realModifyBusy={realModifyBusy || realRenderBusy || workflowRunning || remoteCreationBusy} realModifyError={realModifyError}
                     projectVersion={projectVersion}
                     projectVersionNumber={projectVersionNumber}
                     projectVersionAuthoritative={projectVersion.authoritative}
                     executionPhase={executionPhase}
                     unsavedReplies={unsavedReplies}
                     onRetrySaveReply={handleRetrySaveReply}
                     onRetrySaveAllReplies={handleRetrySaveAllReplies}
                     onClearRealModifyError={() => setRealModifyError('')}
                     adjustPendingConfirm={adjustPendingConfirm}
                     canConfirmWholeProject={Boolean(adjustPendingConfirm || targetEvaluation.status === 'unsupported_target')}
                     onConfirmWholeProject={handleConfirmWholeProject}
                     getRoundOutcome={getRoundOutcome}
                     onClearRoundOutcome={(userMessageId) => clearRoundOutcome(projectId, boundSessionId, userMessageId)}
                     currentSession={currentSession}
                     /* 工程任务（改工程/渲染/工作流/远程）不能用会话流停止，
                        单独传下去，让输入框只在「确实能停」时显示停止键。 */
                     engineeringBusy={realModifyBusy || realRenderBusy || workflowRunning || remoteCreationBusy || sourceCreationBusy}
                     onNotice={setNotice}
                     onRetryMessages={(sid) => void threads?.loadMessages(sid, { force: true })}
                     isSessionLoading={currentSession && threads ? threads.isSessionLoadingMessages(currentSession.id) : false}
                     chat={chat} sideTab={sideTab} setSideTab={selectSideTab}
                     focusChatKey={focusChatKey}
                     scope={scope}
                     scopeShort={scopeShort} projectId={projectId} target={effectiveTarget} preview={viewedPreview ?? stageLead}
                     stageLead={stageLead}
                     sessionDraft={sessionDraft}
                     onRestoreVersion={(ver) => void sceneVersions.restore(ver)}
                     onViewLead={() => showPreview(stageLead)}
                     rangeSpan={range.active && range.span ? range.span : null}
                     onOpenTask={openTaskRecords}
                     onBackFromTask={() => { setEditMode(false); setSideTab(taskReturnTab) }}
                     constraints={constraints} setConstraints={setConstraints}
                     activeTask={projectTask?.task ?? null} cancelTask={cancelTaskAndHold}
                     records={projectRecords} onSubmit={submit} onQuickAction={runQuickAction}
                     pending={pendingSubmits} onStartQueued={startQueued} onCancelQueued={cancelQueued}
                     onNavigate={onNavigate}
                     references={references} onRemoveReference={removeReference}
                     onLocateReference={locateReference} onToggleReferenceRole={toggleReferenceRole}
                     onClearReferences={clearReferences} onOpenResourcePicker={() => setResourcePickerOpen(true)} onScopeChange={(next) => { setScope(next); setTargetReference(next === 'project' ? currentProjectRef : defaultTarget) }}
                     onResumeRequest={(request) => {
                       setReferences(structuredClone(request.references ?? [])); setConstraints(structuredClone(request.constraints)); setScope(request.scope); setWorkbenchDraftText(request.prompt); focusFeedback()
                     }} onOpenReview={openReview} keepNotes={review.keepNotes}
                     onCompareVersions={(before, after) => {
                       setEditMode(false); setSelectedArtifactId(null); setComparison([before, after]); setTrayOpen(false)
                     }}
                     onShowPreview={(visual) => showPreview(visual)}
                     onClearRange={() => { range.reset(); setLoopSpan(false) }}
                     onResetScope={() => { setScope('project'); setTargetReference(currentProjectRef) }}
          />
        )}
        </div>}
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
            previewReady={previewReady}
            aiModifyTargetCapability={aiModifyTargetCapability}
            comparison={comparison}
            comparablePair={comparablePair}
            regionMode={regionMode}
            onToggleRegion={() => {
              if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause()
              regionStart.current = null
              setRegionMode((v) => !v)
              setRegionRect(null)
            }}
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
            <div className="fw-monitor">
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

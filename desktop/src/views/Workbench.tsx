import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownToLine, ArrowLeftRight, ArrowUpRight, BookOpen, Check,
  ChevronDown, ChevronLeft, ChevronRight, Clock3, FileCode2, FileText, Film, FolderOpen, History,
  Image as ImageIcon, ListTree, LoaderCircle, MessagesSquare, Music2, Type as TypeIcon,
  ShieldCheck,
  PanelBottom, Plus, RotateCcw, Send, Settings2,
  Square, X, Maximize2, Minimize2,
} from 'lucide-react'
import { studioHttpApi } from '@/services/api'
import { RailProgressPanel } from './RailProgress'
import { ProjectArtifacts } from './ProjectArtifacts'
import { useHarnesses, availabilityOf } from '@/shell/useHarnesses'
import { ACTIVE_SCENES } from '@/data/projectModel'
import { PROJECTS, type ProjectSummary } from '@/data/projects'
import { ARTIFACT_STATUS_LABEL, ARTIFACT_TYPE_LABEL, WORKBENCH_ARTIFACTS, type WorkbenchArtifact } from '@/data/workbenchArtifacts'
import { ACTIVE_DURATION, FILM_FPS } from '@/data/timeline'
import { useAgentTasks, type TaskRecord } from '@/hooks/useAgentTasks'
import type { ProjectSceneState } from '@/services/api/taskClient'
import type { FilmProjectState } from '@/services/api/workflowContext'
import type { AgentReference, AgentTask, ModificationConstraints, TaskRequest, PreviewSource, TaskEvent } from '@/services/studioApi'
import { evaluateGate, gateSummaryOf, GATE_PRIMARY_KIND, workflowService } from '@/services/workflowService'
import { GATE_DEFS } from '@/data/workflowTemplates'
import { contentOutline, type ContentOutline, type ContentRow } from '@/data/contentOutline'
import { stageState, type StageVisual } from '@/data/stageVisual'
import { containedMediaRect, formatMediaTime } from '@/data/previewGeometry'
import { materialShelves, monitorReferences, type MaterialFile, type MaterialShelf } from '@/data/materialDeck'
import { MEDIA_LABEL } from '@/data/myAssets'
import { initLibrary } from '@/services/assetService'
import {
  MonitorDelivery, MonitorMediaPreview, MonitorProblemsCollapsed, MonitorThumbRail,
  type MonitorProblem, type MonitorVisualItem,
} from './MonitorZones'
import { MonitorStageEmpty } from './MonitorStageEmpty'
import { VISUAL_KIND_LABEL } from '@/data/monitorVisual'
import type { ChatState } from '@/shell/useChat'
import { fmtClock, fmtDay, TASK_STATUS_LABEL } from '@/shell/status'
import { SceneEditorWorkspace } from '@/editor/SceneEditorWorkspace'
import { editorRenderVisuals } from '@/editor/render'
import type { ViewId } from '@/shell/views'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ViewSwitch } from '@/components/ViewSwitch'
import { EditParamsIcon } from '@/components/icons/WorkbenchActionIcons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { RequestSnapshot, WorkflowExecutionLog } from './WorkbenchReview'
import { WorkbenchReviewDesk, type ReviewDeskTab } from './WorkbenchReviewDesk'
import { WorkbenchPreviewCompare } from './WorkbenchPreviewCompare'
import { SceneVersionPanel } from './SceneVersionPanel'
import { useWorkbenchReview } from '@/hooks/useWorkbenchReview'
import { useSceneVersions } from '@/hooks/useSceneVersions'
import { summarizeRounds, type ReviewOpinion, type RoundDelta, type RoundSummary } from '@/services/workbenchReviewService'
import { PreviewReviewTools } from './PreviewReviewTools'
import '../styles/workbench-review.css'
import '../styles/workbench-desk.css'

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

type SideTab = 'scene' | 'chat' | 'task' | 'edit' | 'settings'

/** 左栏的四个页签：概览（要你决定的事）/ 产物 / 内容（这部片有哪些画面）/ 资料。 */
type RailTab = 'overview' | 'artifacts' | 'content' | 'materials'

type ConstraintKey = 'preserveCamera' | 'preserveCaptions' | 'limitToSelection' | 'reuseExistingComponents' | 'preserveOutsideSelection'

const CONSTRAINT_LABELS: Array<[ConstraintKey, string]> = [
  ['preserveCamera', '保留当前机位运动'],
  ['preserveCaptions', '保留字幕与配音'],
  ['limitToSelection', '不修改其他场景'],
  ['reuseExistingComponents', '尽量复用现有组件'],
  /* 「背景不要动」是文档第 7 节的原话要求。它和「不修改其他场景」不是一回事：
     前者是框选区域之外不动，后者是别的场景不动。只写自由文本没法被程序核对。 */
  ['preserveOutsideSelection', '框选区域外保持不动（背景不要动）'],
]



/** 「这次改了什么」里差异项的显示名（键名在 service 里，中文标签在界面里） */
const DELTA_LABEL: Record<RoundDelta['key'], string> = {
  target: '针对画面', time: '时间位置', region: '框选区域', prompt: '文字意见', brief: '需求快照',
}
const CONSTRAINT_LABEL_MAP = Object.fromEntries(CONSTRAINT_LABELS) as Record<string, string>

/**
 * 真实修改路径**实际会执行**的约束。
 *
 * <p>其余约束后端第一版没有实现，真实请求根本不发它们。
 * 界面因此必须禁用这些开关 —— 让用户勾选一个不会生效的条件，
 * 比根本没有这个开关更糟：他会拿一个没被保证的结果去用。</p>
 *
 * <p>这里与后端 `TaskRequestGuard`/`Constraints.unenforced()` 的判断保持一致，
 * 改后端支持范围时这里也要改。</p>
 */
const REAL_MODIFY_SUPPORTED_CONSTRAINTS = new Set<ConstraintKey>(['limitToSelection'])

const quickActions = [
  { id: 'undo', label: '撤销', icon: RotateCcw, prompt: '撤销上一次修改。' },
  { id: 'redo', label: '重做', icon: RotateCcw, prompt: '重做上一次修改。' },
  { id: 'compare', label: '对比版本', icon: ArrowLeftRight, compare: true },
  { id: 'camera', label: '锁定机位', icon: Settings2, constraint: 'preserveCamera' as const },
  { id: 'captions', label: '保留字幕', icon: Check, constraint: 'preserveCaptions' as const },
  { id: 'assets', label: '替换素材', icon: Plus, constraint: 'attachment' as const },
  { id: 'duration', label: '调整时长', icon: Clock3, prompt: '调整当前场景时长。请先询问目标时长。' },
  { id: 'resolution', label: '修改分辨率', icon: Settings2, prompt: '调整项目分辨率。请先询问目标分辨率。' },
  { id: 'regenerate', label: '重新制作预览', icon: ArrowUpRight, prompt: '请重新制作当前修改目标，保留已指定的内容和约束。' },
]

type PendingSubmit = { key: string; messageId: string; prompt: string; request: TaskRequest; status: 'waiting' | 'cancelled' }
function readFeedbackQueue(projectId: string): { items: PendingSubmit[]; hold: boolean } {
  try {
    const value = JSON.parse(sessionStorage.getItem(`fm-feedback-queue:${projectId}`) ?? 'null') as { items?: PendingSubmit[]; hold?: boolean } | null
    return { items: Array.isArray(value?.items) ? value.items.filter((item) => item.request?.projectId === projectId && ['waiting', 'cancelled'].includes(item.status)) : [], hold: value?.hold === true }
  } catch { return { items: [], hold: false } }
}

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
}

export function Workbench({ chat, tasks, onNavigate, projectId, projects, onBack, onSwitchProject, launch, onOpenWorkflowEditor, onDismissLaunch }: WorkbenchProps) {
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
  const [reviewTab, setReviewTab] = useState<ReviewDeskTab | null>(null)
  const [comparison, setComparison] = useState<[StageVisual, StageVisual] | null>(null)
  /* 打开对比时对齐到「用户指的那一帧」：把当时目标引用的时间与区域带过去，
     两侧才能对齐到同一位置、叠同一个框，才叫「在相同位置比较」（文档第 8 节）。 */
  const [comparisonAt, setComparisonAt] = useState<{ timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>(null)
  const [previewLocation, setPreviewLocation] = useState<{ visualId: string; timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>(null)
  const openReview = (tab: ReviewDeskTab) => { if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause(); setReviewTab(tab); setPanelOpen(true); setEditMode(false) }
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
  const stageLive = Boolean(liveTask) || workflowRunning
  const [editorPreviews, setEditorPreviews] = useState<StageVisual[]>([])
  const [editorExportTick, setEditorExportTick] = useState(0)
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
  const [versionsOpen, setVersionsOpen] = useState(false)
  /* 场景版本历史。回退成功后要把新的当前场景写回 currentSceneState，
     否则下一次提交仍带旧的 baseVersion，会被后端 409 拒绝 ——
     用户会以为回退把项目弄坏了。
     这条 hook 必须在 stage 之前：画面区要合并场景版本自带的视频，
     而那份列表就来自这里。 */
  const sceneVersions = useSceneVersions(projectId, setCurrentSceneState)

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
    const visuals = [...sceneVisuals, ...editorPreviews, ...base.visuals]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const combined = { ...base, visuals }
    return stageLive ? { ...combined, lastRunStatus: 'running' as const } : combined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectWorkflows, workflowsSnapshot, runsTick, stageLive, editorPreviews, sceneVisuals])
  /* 有画面就显示「最靠后的那一档」（整片 > 粗略整片 > 试片 > 测试帧）。 */
  const stageLead: StageVisual | null = stage.visuals[0] ?? null
  /* 交付节点标了 stale 的，画面就不是最新版 —— 如实标出来，不假装是当前版本。 */
  const stageStale = stageLead?.stale ?? false
  /* 能导出的前提是这次制作真有整片那一档，且不是过期版本。
     试片、测试帧不能导出：那不是整片，导出来用户会以为拿到成片了。 */
  const stageDeliverable = stageLead?.tier === 'final' && !stageStale
  /* Gate 评估：交付检查项之一，但不直接推导交付（交付另看最终文件与规格）。 */
  const stageGates = useMemo(() => {
    if (!projectId) return []
    return workflowsSnapshot.filter((w) => w.projectId === projectId).flatMap((w) => gateSummaryOf(w))
  }, [projectId, workflowsSnapshot])
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
  const [editMode, setEditMode] = useState(new URLSearchParams(window.location.search).get('edit') === '1' || new URLSearchParams(window.location.search).get('panel') === 'edit')
  const [references, setReferences] = useState<AgentReference[]>([])
  const [regionMode, setRegionMode] = useState(false)
  const [regionRect, setRegionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [regionBox, setRegionBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const regionStart = useRef<{ sx: number; sy: number; mx: number; my: number } | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const previewMediaRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null)
  const [previewTime, setPreviewTime] = useState(0)
  const [previewDuration, setPreviewDuration] = useState(0)
  const [previewReady, setPreviewReady] = useState(false)
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
    new URLSearchParams(window.location.search).get('edit') === '1' ? 'edit' : initialPanel === 'scene' || initialPanel === 'chat' || initialPanel === 'task' || initialPanel === 'edit' || initialPanel === 'settings'
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
  /* 真实修改的忙碌与错误状态。错误单独存而不是塞进 notice：
     notice 是会自动消失的提示，而「刚才为什么没改成功」要一直留着，
     直到用户重发或主动关掉。 */
  /* Agent 可用性读真实探测，不写死。
     原来顶部状态条固定显示「离线 / 还没接 Agent 和渲染」——在 DSH 已经接入、
     真实修改也能出片之后，那句话会让人以为功能没做（真机确认过）。
     判据与 Home / MonitorStageEmpty 一致：/api/capabilities 的 agent 项。 */
  const harnessProbe = useHarnesses()
  const agentAvailability = availabilityOf(harnessProbe, 'deepseek')
  const agentReady = agentAvailability.state === 'available'
  const agentAvailabilityLabel =
    agentAvailability.state === 'checking' ? '检测中'
      : agentAvailability.state === 'not_connected' ? '未连接'
        : agentAvailability.state === 'misconfigured' ? '配置有误'
          : agentAvailability.state === 'unknown' ? '状态未知'
            : '已连接'

  const [realModifyBusy, setRealModifyBusy] = useState(false)
  const [realModifyError, setRealModifyError] = useState('')
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
  useEffect(() => {
    let active = true
    void studioHttpApi().workflowContext.film(projectId)
      .then((state) => { if (active) setFilmProject(state) })
      .catch(() => { if (active) setFilmProject(null) })
    return () => { active = false }
  }, [projectId, runsTick, editorExportTick])

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
    if (realRenderBusy) return false
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
      setRealRenderBusy(false)
    }
  }

  const submitRealRender = async () => {
    if (realRenderBusy) return
    setRealRenderBusy(true)
    try {
      const title = projectName.trim() || 'FengMotion'
      // 简报首行作为副标题；没有简报时给一句占位，不留空
      const firstLine = review.brief.original.trim().split(String.fromCharCode(10))[0] ?? ''
      const subtitle = firstLine.slice(0, 40) || '真实渲染预览'
      const film = {
        width: 1280, height: 720, fps: 30,
        backgroundColor: '#0b1220', color: '#ffffff',
        scenes: [
          { id: 's1', text: title, subtitle, durationSeconds: 2, textAnimation: 'fade' as const },
        ],
      }
      const taskId = await tasks.startReal(projectId, film, `渲染「${title}」预览`)
      setNotice(taskId ? '已提交真实渲染，出片后可在产物页播放' : '提交失败：请确认后端已连接')
    } finally {
      setRealRenderBusy(false)
    }
  }

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
  /* 视觉资料：参考素材（服务 + 工作流绑定）+ 方向样稿 / 试片（运行产物里真带视觉文件的才算）。 */
  /* 缩略入口只放参考：参考图是拿来对照的，属于监看；
     素材（成片/片段/抽帧）归「资料」页，混进来就变成一排没意义的文件块。 */
  const galleryRefs = useMemo((): MonitorVisualItem[] => monitorReferences(projectId).map((f) => ({
    id: f.id, name: f.name, kind: 'ref', mediaType: f.media,
    thumb: f.thumb, filePath: undefined, assetId: f.id, sourceLabel: undefined,
  })), [projectId])
  /* 交付事实：最终文件（成片交付节点）+ 输出规格（创作节点 + 提示词）+ 审片（看片节点）+ 检查（Gate 评估）。 */
  const delivery = useMemo(() => {
    const hasFinalFile = stageLead?.tier === 'final' && !stageStale
    const finalFile = hasFinalFile ? stageLead.name : '尚无文件'
    const create = progressWorkflow?.nodes.find((n) => n.type === 'create')
    const prompt = progressWorkflow?.nodes.find((n) => n.type === 'prompt')
    const specParts = [String(create?.params.resolution ?? ''), String(prompt?.params.ratio ?? ''), String(create?.params.mode ?? '')].filter(Boolean)
    const specs = specParts.length ? specParts.join(' · ') : '未设定'
    const review = progressWorkflow?.nodes.find((n) => n.type === 'review')
    const rc = (review?.params.checks ?? {}) as Record<string, boolean>
    const rday = review ? fmtDay(String(review.params.decidedAt ?? '')) : ''
    const samePreview = review?.params.reviewedVisualId === stageLead?.id
    const reviewText = samePreview && rc.done ? `用户已确认${rday ? ` · ${rday}` : ''}` : samePreview && rc.rework ? `用户要求修改${rday ? ` · ${rday}` : ''}` : '本版尚未审阅'
    const confirmed = stageGates.filter((g) => g.decision === 'confirmed').length
    const blocked = stageGates.flatMap((g) => g.blocked).length
    const stale = stageGates.some((g) => g.stale)
    const checks = stageGates.length === 0
      ? '技术检查尚未执行'
      : `工作流 ${confirmed}/${stageGates.length} 项已确认${blocked > 0 ? ` · ${blocked} 项受阻` : ''}${stale ? ' · 有检查项对应旧版本' : ''} · 技术检查尚未执行`
    return { hasFinalFile, finalFile, specs, review: reviewText, checks }
  }, [stageLead, stageStale, progressWorkflow, stageGates])
  /* 换画面时把「上一个画面的框选/时间引用」撤下来。
     不撤的话会出现「用户看着 B、提交的却是 A 的区域引用」—— 文档第 7 节最在意的
     就是「用户指的对象与 AI 实际修改的对象是否一致」。
     只动 target（要改的那一个）：context 引用（参考、素材）是资料，不该跟着消失。 */
  const dropTargetCapture = (reason: string) => {
    const target = references.find((ref) => ref.role === 'target')
    if (!target || target.kind !== 'preview') return
    setReferences((old) => old.map((ref) => (ref.id === target.id ? { ...ref, role: 'context' as const } : ref)))
    setPreviewLocation(null)
    setNotice(reason)
  }

  /* 视觉选择按项目派生：切项目后旧选择自动失效，不用 effect 清。 */
  const [visualSel, setVisualSel] = useState<{ projectId: string; item: MonitorVisualItem | null }>({ projectId, item: null })
  const selectedVisual = visualSel.projectId === projectId ? visualSel.item : null
  const setSelectedVisual = (item: MonitorVisualItem | null) => {
    if ((item?.id ?? `stage:${stageLead?.id}`) !== (selectedVisual?.id ?? `stage:${stageLead?.id}`)) {
      setPreviewReady(false); setPreviewDuration(0)
      dropTargetCapture('已切换画面：上一个画面的框选区域与时间引用已撤下，避免改错对象。')
    }
    setVisualSel({ projectId, item }); setRegionMode(false); setRegionRect(null); setRegionBox(null) }
  const viewedPreview = selectedVisual ? stage.visuals.find((v) => `stage:${v.id}` === selectedVisual.id) ?? null : stageLead
  /* 缩略入口：一行，当前预览在前，其后是参考、样稿、试片 —— 不分组标题、不铺网格。 */
  const railItems = useMemo((): MonitorVisualItem[] => {
    /* 先列这次制作产出的画面（最近的那档在最前），后面才是参考素材。
       早先的档位也留着：测试帧→试片→整片是同一个项目的演进，
       用户要能随时回去看「上一版长什么样」，所以不按「已通过」把它们删掉。 */
    const produced: MonitorVisualItem[] = stage.visuals.map((v) => ({
      id: `stage:${v.id}`, name: v.name, kind: v.tier === 'final' ? 'film' : 'testfilm',
      mediaType: v.media, filePath: v.file, sourceLabel: v.tierLabel,
    }))
    return [...produced, ...galleryRefs]
  }, [stage, galleryRefs])
  const railSelectedId = selectedVisual ? selectedVisual.id : (stageLead ? `stage:${stageLead.id}` : null)
  const onRailSelect = (item: MonitorVisualItem) => {
    setComparison(null)
    setPreviewLocation(null)
    if (item.id === `stage:${stageLead?.id}`) setSelectedVisual(null)
    else setSelectedVisual(item)
  }
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
    chat.setDraft(chat.draft.trim() ? `${chat.draft}\n${problemText}` : problemText)
    selectSideTab('chat')
    setFocusChatKey((k) => k + 1)
  }
  /* 画廊点开的视觉项：向 AI 说这个 —— 名字 + 类型带进草稿，打开对话并聚焦。 */
  const askVisual = (item: MonitorVisualItem) => {
    const produced = stage.visuals.find((v) => `stage:${v.id}` === item.id)
    if (produced) setTargetReference({ id: `preview:${produced.id}`, role: 'target', kind: 'preview', label: produced.name, source: previewSource(produced) })
    else if (item.mediaType === 'image' || item.mediaType === 'video') addContextReference({ id: `reference:${item.id}`, role: 'context', kind: 'preview', label: `参考 · ${item.name}`, source: { projectId, visualId: item.id, file: item.filePath ?? item.thumb ?? item.id, media: item.mediaType } })
    const contextLine = `关于${VISUAL_KIND_LABEL[item.kind]}「${item.name}」：`
    chat.setDraft(chat.draft.trim() ? `${chat.draft}\n${contextLine}` : contextLine)
    selectSideTab('chat')
    setFocusChatKey((k) => k + 1)
  }

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
  const selectArtifact = (id: string) => {
    setSelectedArtifactId(id)
    setEditMode(false)
    setRailTab('artifacts')
    setRailOpen(false)
  }
  const openEdit = () => {
    setEditorDocumentId(viewedPreview?.origin === 'editor' ? viewedPreview.artifactId : null)
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
  const scopeText = (ref: AgentReference): string => {
    switch (ref.kind) {
      /* 整片就是整片：项目名在顶栏与左栏页脚都有，这里再写一遍会把这行挤成两行 */
      case 'project': return '整个项目'
      case 'preview': return `${ref.bbox ? '区域' : ref.timeSeconds !== undefined ? '时间点' : '预览'} · ${ref.label}`
      case 'scene': return `场景 · ${ref.label}`
      case 'shot': return `当前画面 · ${ref.label}`
      case 'frame': return `帧 · ${ref.timecode}`
      case 'range': return `范围 · ${ref.timecode}`
      case 'region': return `区域 · ${ref.label}`
      case 'artifact': return `产物 · ${ref.label}`
    }
  }
  const scopeLabel = scopeText(effectiveTarget)
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
    setConstraints((old) => ({ ...old, limitToSelection: ref.kind !== 'project' }))
    setScope(ref.kind === 'project' || ref.kind === 'artifact' ? 'project' : ref.kind === 'preview' ? 'selection' : 'scene')
    setReferences((old) => [ref, ...old.filter((item) => item.role !== 'target')])
  }
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
  }
  const addContextReference = (ref: AgentReference) => {
    setReferences((old) => old.some((item) => item.id === ref.id) ? old : [...old, ref])
  }
  const removeReference = (id: string) => setReferences((old) => old.filter((item) => item.id !== id))
  const clearReferences = () => setReferences([])
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
    setReferences((old) => {
      const picked = old.find((r) => r.id === id)
      if (!picked || (picked.kind === 'preview' && !picked.source.workflowId && picked.source.origin !== 'editor' && picked.role === 'context')) return old
      const promoting = picked.role !== 'target'
      return old.map((ref) => ref.id === id ? { ...ref, role: promoting ? 'target' : 'context' } as AgentReference : promoting && ref.role === 'target' ? { ...ref, role: 'context' } as AgentReference : ref)
    })
  }
  const focusFeedback = () => { setReviewTab(null); setSideTab('chat'); setPanelOpen(true); setFocusChatKey((k) => k + 1) }
  const referencePreview = (region?: { x: number; y: number; w: number; h: number }, whole = false) => {
    if (!viewedPreview) return
    const media = previewMediaRef.current
    if (!whole && (!media || (media instanceof HTMLVideoElement ? media.readyState < 2 : !media.complete || !media.naturalWidth))) { setNotice('预览尚未加载，暂时无法引用当前位置。'); return }
    if (media instanceof HTMLVideoElement) media.pause()
    const timeSeconds = viewedPreview.media === 'video' && !whole ? (media instanceof HTMLVideoElement ? media.currentTime : previewTime) : undefined
    setPreviewLocation({ visualId: viewedPreview.id, timeSeconds, bbox: region })
    const timeLabel = timeSeconds === undefined ? '' : ` · ${formatMediaTime(timeSeconds)}`
    setTargetReference({ id: `preview:${viewedPreview.id}:${whole ? 'whole' : timeSeconds ?? 'image'}:${region ? JSON.stringify(region) : ''}`, role: 'target', kind: 'preview', source: previewSource(viewedPreview), timeSeconds, bbox: region, label: `${viewedPreview.name}${timeLabel}${region ? ' · 框选区域' : ''}` })
    focusFeedback()
    setNotice(region ? '区域已加入修改目标，输入意见后发送。' : '预览已加入修改目标，输入意见后发送。')
  }
  const referenceFrame = () => referencePreview()
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
    if (!regionMode) return
    const p = regionPoint(e)
    if (!p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    regionStart.current = p
    setRegionRect({ x: p.sx, y: p.sy, w: 0, h: 0 })
    setRegionBox({ x: p.mx, y: p.my, w: 0, h: 0 })
  }
  const moveRegion = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!regionMode || !regionStart.current) return
    const media = mediaRect()
    if (!media) return
    const mx = Math.min(1, Math.max(0, (e.clientX - media.left) / media.width))
    const my = Math.min(1, Math.max(0, (e.clientY - media.top) / media.height))
    const start = regionStart.current
    setRegionBox({ x: Math.min(start.mx, mx), y: Math.min(start.my, my), w: Math.abs(mx - start.mx), h: Math.abs(my - start.my) })
    const stage = stageRef.current?.getBoundingClientRect()
    if (!stage) return
    const sx = Math.min(1, Math.max(0, (e.clientX - stage.left) / stage.width))
    const sy = Math.min(1, Math.max(0, (e.clientY - stage.top) / stage.height))
    setRegionRect({ x: Math.min(start.sx, sx), y: Math.min(start.sy, sy), w: Math.abs(sx - start.sx), h: Math.abs(sy - start.sy) })
  }
  useEffect(() => {
    if (!regionMode) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      regionStart.current = null
      setRegionMode(false); setRegionRect(null); setRegionBox(null)
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [regionMode])
  const endRegion = () => {
    if (!regionMode) return
    if (regionBox && regionBox.w > 0.01 && regionBox.h > 0.01) referenceRegion(regionBox)
    regionStart.current = null
    setRegionMode(false)
    setRegionRect(null)
    setRegionBox(null)
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
    const requestRefs = references.some((ref) => ref.role === 'target') ? references : [defaultTarget, ...references]
    const derivedScope = scopeFromReferences(requestRefs)
    /* 范围里的场景：目标是左栏选中的内容单元时用它自己的 id —— 它来自工作流产物，
       和当前选中的渲染切片（selectedId，占位数据）不是一回事，不能互相顶替。 */
    const target = requestRefs.find((ref) => ref.role === 'target')
    const sceneIds = derivedScope === 'project'
      ? []
      : target?.kind === 'scene' ? [target.sceneId] : [selectedId]
    return structuredClone({ projectId, workflowId: target?.kind === 'preview' ? target.source.workflowId : progressWorkflow?.id, workflowRevision: target?.kind === 'preview' ? target.source.origin === 'editor' ? undefined : target.source.revision : progressWorkflow?.revision, kind, prompt, scope: target?.kind === 'preview' ? 'selection' : derivedScope, sceneIds, references: requestRefs, constraints: useConstraints, attachments: [] })
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
    setSelectedVisual(visual.id === stageLead?.id ? null : { id: `stage:${visual.id}`, name: visual.name, kind: 'testfilm', mediaType: visual.media, filePath: visual.file, sourceLabel: visual.tierLabel })
  }
  const continueOpinion = (opinion: ReviewOpinion) => {
    setReferences(structuredClone(opinion.request.references ?? []))
    setConstraints(structuredClone(opinion.request.constraints))
    setScope(opinion.request.scope)
    const target = opinion.request.references?.find((r) => r.role === 'target')
    if (target) locateReference(target)
    const next = `继续调整：${opinion.request.prompt}\n补充意见：`
    chat.setDraft(chat.draft.trim() ? `${chat.draft}\n${next}` : next)
    focusFeedback()
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
   * @returns 是否已成功提交
   */
  const submitRealModify = async (prompt: string): Promise<boolean> => {
    if (realModifyBusy) return false
    setRealModifyBusy(true)
    try {
      /* 项目有 Remotion 工程时，修改走另一条路：
         意见写进 corrections.md，由 agent 改工程源码，再渲染出新的版本。
         不能走 modify 任务 —— 那条改的是 scenes 数据，
         而这个项目的画面在源码里，改数据不会让画面变。 */
      if (filmProject?.ready) {
        try {
          /* 先落盘再让 agent 改：意见写进 corrections.md 是持久依据，
             agent 下一轮（甚至换个会话）都能读到。只发对话不落盘，
             刷新一次就没了，而用户以为已经提了。 */
          await studioHttpApi().workflowContext.recordCorrection(projectId, prompt)
          review.addCorrection(prompt)
          chat.addUserMessage(prompt, undefined, projectId)
          setNotice('修改意见已记入。Agent 正在按它改工程…')

          const result = await studioHttpApi().workflowContext.create(projectId, prompt)
          setNotice(`Agent 已改完并渲染出版本 v${result.version}。`)
          /* 刷新版本与画面：让用户立刻看到新一版，并能与上一版对比。 */
          void sceneVersions.refresh(true)
          const probe = await tasks.currentScene(projectId)
          if (probe.scene) setCurrentSceneState(probe.scene)
          rereadRuns()
          setRealModifyError('')
          return true
        } catch (error) {
          /* 失败必须说清是「意见没记下」还是「agent 没改出来」——
             两者下一步完全不同。 */
          const message = error instanceof Error ? error.message : String(error)
          setRealModifyError(`Agent 修改未完成：${message}`)
          setNotice(`修改未完成：${message.slice(0, 120)}`)
          return false
        }
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
           workflow-v5 才是创作路径，绕开它另做一条简化管线
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
        setRealModifyError('参考上下文暂不参与真实修改，请先移除引用。')
        return false
      }
      if (derived.scope === 'selection') {
        setRealModifyError('选区修改暂不支持，请改为选定某个场景或整片后再试')
        return false
      }
      const useScene = derived.scope === 'scene' && derived.sceneIds.length > 0
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
        setRealModifyError(hint || '提交失败')
        return false
      }
      setRealModifyError('')
      // 审阅记录只包含真实提交的目标与文字，不把本地需求、引用或保留条件当成发送记录。
      review.record({
        ...derived,
        scope: useScene ? 'scene' : 'project',
        sceneIds: useScene ? derived.sceneIds : [],
        references: (derived.references ?? []).filter((ref) => ref.role === 'target' && (ref.kind === 'project' || (useScene && ref.kind === 'scene'))),
        constraints: { preserveCamera: false, preserveCaptions: false, limitToSelection: useScene, reuseExistingComponents: false },
      }, { includeBrief: false })
      chat.addUserMessage(prompt, result.taskId, projectId)
      setBottomTab('activity')
      return true
    } finally {
      setRealModifyBusy(false)
    }
  }

  /**
   * 提交修改：优先真实后端，只有用户显式选择演示才走 Mock。
   *
   * <p>此前所有提交都进演示路径，界面看起来「能用」，实际什么都没改。
   * 现在默认打真实接口；演示入口保留为独立按钮，标注清楚。</p>
   */
  const submit = async (prompt: string): Promise<boolean> => {
    /* 真实路径是默认。失败已由 submitRealModify 写好错误并保留输入；
       这里**不回退演示** —— 静默换成假执行会让用户以为改动生效了。 */
    return submitRealModify(prompt)
  }

  /** 演示入口：只有用户明确点它才走本地假执行。 */
  const submitDemo = (prompt: string) => {
    const kind: TaskRequest['kind'] = 'modify'
    const useConstraints = constraints
    const request = review.record(buildRequest(prompt, kind, useConstraints))
    const waiting = pendingSubmits.filter((p) => p.status === 'waiting')
    /* 没在跑、队里也没等待：即使之前按住过排队（刚叫停），这条新指令也直接跑 ——
       按住只拦自动启动旧排队，不拦用户的新发送。 */
    if (!isLiveTask(tasks.active?.task) && waiting.length === 0) {
      if (holdQueue) setHoldQueue(false)
      startNow({ prompt, request })
      return
    }
    const messageId = chat.addUserMessage(prompt, undefined, projectId)
    const item: PendingSubmit = { key: `${Date.now()}-${waiting.length}`, messageId, prompt, request, status: 'waiting' }
    if (!isLiveTask(tasks.active?.task) && !holdQueue) {
      /* 队里有等待、但当前没在跑：按序启动队头（可能是刚排的这一条），不插队。 */
      const next = [...waiting, item]
      const [head] = next
      /* 只删队头：其余等待项与已取消项原样保留。 */
      setPendingSubmits((old) => [...old.filter((p) => p.key !== head.key), ...(head.key === item.key ? [] : [item])])
      startNow(head)
    } else {
      setPendingSubmits((old) => [...old, item])
    }
  }
  /* 队头自动启动：当前任务完成/失败后，按序启动下一条等待；被停止后不自动启动。 */
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
    if (action.prompt) { chat.setDraft(action.prompt); focusFeedback() }
  }

  return (
    <div className="wb-a2 wb-studio flex h-full min-h-0 flex-col" data-editor={editMode} data-mode="dark">

      {/* ═══ 基岛：顶栏 ═════════════════════════════════════════ */}
      <div className="wb-projectbar">
        <ToolButton label="返回我的创作" onClick={onBack}><ChevronLeft /></ToolButton>
        <button className="mini fw-mobile" type="button" title="场景列表"
                onClick={() => setRailOpen((v) => !v)}>
          <PanelBottom className="size-3.5" />
        </button>
        <span className="wb-logo" aria-hidden="true"><Film size={17}/></span>
        <div className="wb-crumb">
          <div className="wb-project-context" ref={switchRef} data-open={switchOpen ? '' : undefined}>
            <button className="wb-project-switch" type="button"
                    aria-expanded={switchOpen} aria-haspopup="menu"
                    onClick={() => setSwitchOpen((v) => !v)}>
              <span className="wb-project-name">{project.name}</span>
              <ChevronDown className="wb-caret" />
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
                    {p.id === project.id && <Check className="size-3.5 wb-menu-check" />}
                  </button>
                ))}
                <button type="button" role="menuitem" className="wb-switch-all"
                        onClick={() => { setSwitchOpen(false); onBack() }}>
                  <FolderOpen className="size-3.5" />全部项目
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
        <span className="wb-spacer" />
        <div className="wb-top-actions">
          <button type="button" className="wb-review-entry" aria-pressed={reviewTab !== null} onClick={() => reviewTab ? setReviewTab(null) : openReview('opinions')}>
            <ListTree size={14}/>制作审阅{review.opinions.some((o) => o.status === 'open') && <span>{review.opinions.filter((o) => o.status === 'open').length}</span>}
          </button>
          <button type="button" className="wb-remotion-entry" aria-pressed={editMode}
                  onClick={editMode ? closeEdit : openEdit}>
            <EditParamsIcon size={15} />{editMode ? '返回监看' : '场景编辑器'}
          </button>
          {/* Agent 状态：读真实探测，不写死。
              原先固定「离线」，与实际能力相反 —— DSH 接了、渲染也通了，
              界面却说「提交只会记录，不会真的改项目文件」。 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="wb-agent-status" type="button"
                      data-ready={agentReady || undefined}
                      aria-label={agentReady ? 'Agent 已连接' : `Agent ${agentAvailabilityLabel}`}>
                <span className="wb-agent-dot" />{agentReady ? '已连接' : agentAvailabilityLabel}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {agentReady
                ? 'Agent 已连接：提交修改会真的改动项目场景并产出视频。'
                : `${agentAvailabilityLabel}：提交只会记录，不会改动项目文件。${harnessProbe.note ? `（${harnessProbe.note}）` : ''}`}
            </TooltipContent>
          </Tooltip>
          <ToolButton label="预览版本与对比" onClick={() => openReview('versions')}><History /></ToolButton>
          {/* 导出只给这次制作真做出来的整片。没有整片就禁用，并说清楚缺什么 ——
              不能把素材库里那条旧成片当成本次交付让人下载。 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="wb-export" type="button" disabled={!stageDeliverable}
                      onClick={() => {
                        if (!stageLead) return
                        const a = document.createElement('a')
                        a.href = stageLead.file
                        a.download = stageLead.name
                        a.click()
                        setNotice('已下载这次制作的整片。')
                      }}>
                <ArrowDownToLine className="size-3.5" />导出
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {stageDeliverable ? '下载这次制作产出的整片。' : '这次制作还没有产出整片，没有可导出的文件。'}
            </TooltipContent>
          </Tooltip>
        </div>
        {/* 与对话视图右上角同一个切换器（styles/view-switch.css）：工作台是当前视图，
            对话可一键切回，消除“进了工作台就回不去会话”的单向门 */}
        <ViewSwitch current="workbench" onSwitch={(target) => { if (target === 'conversation') onNavigate('conversation') }} />
      </div>

      {/* ═══ 三栏（paba .fw 网格）══════════════════════════════ */}
      <div className="fw relative" data-panel={panelOpen ? 'open' : 'closed'}>
        {railOpen && <button className="fw-scrim" aria-label="收起场景列表" onClick={() => setRailOpen(false)} />}

        <ProjectRail onOpenBrief={() => openReview('brief')} onEditScene={openEdit} projectName={project.name}
                     projectId={projectId}
                     open={railOpen} onClose={() => setRailOpen(false)}
                     tab={railTab} onTab={setRailTab}
                     selectedArtifactId={selectedArtifactId} onSelectArtifact={selectArtifact}
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
                            workflow-v5 创作上下文（写入 prompt.original.md）。
                            用「制作要求原文」而不是输入框草稿 —— 后者是随时会变的一句话，
                            原文才是 workflow-v5 要求的创作依据。 */
                         projectId={projectId}
                         prompt={review.brief.original || undefined}
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

        {editMode ? <SceneEditorWorkspace projectId={projectId} initialSceneId={selectedId} initialDocumentId={editorDocumentId} onClose={closeEdit} onRendered={() => { setSelectedVisual(null); setSelectedArtifactId(null); setComparison(null); setEditorExportTick((n) => n + 1) }}/> : <>
        {/* 中栏：监看器。没产出画面时换「需求与参考」形态（同一块区域，不是另一个页面）*/}
        <main className="fw-canvas">
          <div className="fw-toolbar">
            {comparison ? <><span className="wb-viewer-index">审阅</span><h2 className="wb-viewer-title">比较两份真实预览</h2></> : selectedArtifact ? (
              <>
                <span className="wb-viewer-index">产物</span>
                <h2 className="wb-viewer-title truncate">{selectedArtifact.title}</h2>
                <span className="wb-status" data-status={selectedArtifact.status}>
                  {ARTIFACT_STATUS_LABEL[selectedArtifact.status]}
                </span>
                <span className="spacer" />
                <span className="wb-viewer-meta">{ARTIFACT_TYPE_LABEL[selectedArtifact.type]} · {selectedArtifact.version} · 只读预览</span>
              </>
            ) : selectedVisual ? (
              <>
                <button type="button" className="fw-mon-btn" onClick={() => setSelectedVisual(null)}>‹ 返回监看</button>
                <h2 className="wb-viewer-title truncate">{selectedVisual.name}</h2>
                <span className="wb-status" data-status="idle">{VISUAL_KIND_LABEL[selectedVisual.kind]}</span>
                <span className="wb-viewer-meta">
                  {MEDIA_LABEL[selectedVisual.mediaType] ?? selectedVisual.mediaType}
                  {selectedVisual.sourceLabel ? ` · ${selectedVisual.sourceLabel}` : ''}
                  {selectedVisual.license ? ` · ${selectedVisual.license}` : ''}
                </span>
                <span className="spacer" />
                <button type="button" className="fw-mon-btn strong" onClick={() => askVisual(selectedVisual)}>带入对话</button>
              </>
            ) : stageLead ? (
              <>
                {/* 画面身份：这是这次制作的哪一档（测试帧 / 试片 / 粗略整片 / 整片）。
                    名字和档位都从运行产物里来，不套旧成片的「演示旧版」标签。 */}
                <span className="wb-viewer-index">监看</span>
                <h2 className="wb-viewer-title truncate">画面预览</h2>
                <span className="wb-status" data-status="done">{stageLead.tierLabel}</span><span className="wb-current-preview-meta">{stageLead.origin === 'editor' ? '编辑版本 ' : ''}v{stageLead.revision} · {new Date(stageLead.createdAt).toLocaleDateString('zh-CN')}</span>
                {stageStale && <span className="wb-status" data-status="waiting">对应旧版本</span>}
                <span className="wb-spacer" />
<button type="button" className="fw-mon-btn" onClick={() => openReview('versions')}>预览版本与对比 <ArrowLeftRight size={12}/></button>
              </>
            ) : (
              <>
                <span className="wb-viewer-index">监看</span>
                <h2 className="wb-viewer-title truncate">画面预览</h2>
                <span className="wb-status" data-status="idle">
                  {stage.lastRunStatus === 'running' ? '制作中' : '还没有画面'}
                </span>
              </>
            )}
            {!comparison && <button type="button" className="wb-focus-stage" aria-label={panelOpen ? '专注画面' : '恢复对话布局'} aria-pressed={!panelOpen} onClick={() => setPanelOpen((value) => !value)}>{panelOpen ? <Maximize2 size={14}/> : <Minimize2 size={14}/>}</button>}
          </div>

          {comparison ? <WorkbenchPreviewCompare key={`${comparison[0].id}:${comparison[1].id}:${comparisonAt?.timeSeconds ?? 'x'}:${comparisonAt?.bbox ? 'r' : 'n'}`} left={comparison[0]} right={comparison[1]} initialTime={comparisonAt?.timeSeconds} bbox={comparisonAt?.bbox ?? null} focused={!panelOpen} onFocus={() => setPanelOpen((value) => !value)} onClose={() => { setComparison(null); setComparisonAt(null) }} onDiscuss={(visual, seconds) => {
            setComparison(null)
            showPreview(visual)
            setPreviewLocation({ visualId: visual.id, timeSeconds: seconds })
            setTargetReference({ id: `preview:${visual.id}:${seconds ?? 'image'}`, role: 'target', kind: 'preview', source: previewSource(visual), timeSeconds: seconds, label: `${visual.name}${seconds !== undefined ? ` · ${formatMediaTime(seconds)}` : ''}` })
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
                    <StageFrame key={viewedPreview.id} visual={viewedPreview} mediaRef={previewMediaRef} onTime={setPreviewTime} currentTime={previewTime} onReady={setPreviewReady} onDuration={setPreviewDuration} location={previewLocation}/>
                    {notice && (
                      <button type="button" className="fw-mon-notice-inline" onClick={() => setNotice('')}>
                        {notice}<X className="ml-1 inline size-3" />
                      </button>
                    )}
                    {regionMode && (
                      <div className="fw-region-layer" onPointerDown={startRegion} onPointerMove={moveRegion} onPointerUp={endRegion} onPointerCancel={() => { regionStart.current = null; setRegionMode(false); setRegionRect(null); setRegionBox(null) }}>
                        <div className="fw-region-hint">拖拽框选画面区域</div>
                        {regionRect && <div className="fw-region-box" style={{ left: `${regionRect.x * 100}%`, top: `${regionRect.y * 100}%`, width: `${regionRect.w * 100}%`, height: `${regionRect.h * 100}%` }} />}
                      </div>
                    )}
                  </div>
                ) : (
                  <MonitorStageEmpty stage={stage} realRunning={Boolean(liveTask && !projectTask?.task.mock)} brief={review.brief.original} correctionCount={review.corrections.length}
                                     onDiscuss={() => openReview('brief')} onEdit={openEdit}
                                     onRealRender={() => void (filmProject?.ready ? submitProjectRender() : submitRealRender())} realRenderBusy={realRenderBusy}
                                     renderTargetLabel={filmProject?.ready ? '渲染项目工程' : '真实渲染预览'}
                                     onOpenExecution={() => { setBottomTab('activity'); setTrayOpen(true) }} />
                )}
              {filmRenderError && !stageLead && (
                <div className="fw-mon-notice" role="alert">
                  项目工程渲染失败：{filmRenderError.slice(0, 300)}
                  <button type="button" onClick={() => setFilmRenderError('')} aria-label="关闭"><X className="ml-1 inline size-3" /></button>
                </div>
              )}
              </div>
              {notice && !stageLead && (
                <button type="button" className="fw-mon-notice" onClick={() => setNotice('')}>
                  {notice}<X className="ml-1 inline size-3" />
                </button>
              )}
              {viewedPreview && <PreviewReviewTools key={viewedPreview.id} available={previewReady} video={viewedPreview.media === 'video'} time={previewTime} duration={previewDuration} regionMode={regionMode} onFrame={referenceFrame}
                currentTime={() => previewMediaRef.current instanceof HTMLVideoElement ? previewMediaRef.current.currentTime : previewTime}
                onRegion={() => { if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause(); setRegionMode((v) => !v); setRegionRect(null) }}
                onRange={(start, end) => { if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause(); setTargetReference({ id: `preview:${viewedPreview.id}:${start}:${end}`, role: 'target', kind: 'preview', source: previewSource(viewedPreview), timeSeconds: start, endTimeSeconds: end, label: `${viewedPreview.name} · ${formatMediaTime(start)}–${formatMediaTime(end)}` }); focusFeedback() }}/>}
              <div className="fw-mon-rail">
                <MonitorThumbRail items={railItems} selectedId={railSelectedId} onSelect={onRailSelect} />
                {liveTask && (
                  <span className="fw-mon-task">
                    <span className="fm-dot" data-s="running" />
                    {liveTask.state} · {liveTask.label}
                  </span>
                )}
              </div>
              <MonitorProblemsCollapsed problems={monitorProblems} expandedId={expandedProblemId}
                                        onToggle={toggleProblem} onLocate={locateProblem} onAskFix={askFix} />
              {delivery.hasFinalFile && (
                <MonitorDelivery finalFile={delivery.finalFile} specs={delivery.specs} review={delivery.review} checks={delivery.checks} />
              )}

            </div>
          )}
          {trayOpen && (
                <BottomTray previews={stage.visuals} onPreview={(visual) => { setSelectedArtifactId(null); setSelectedVisual(visual.id === stageLead?.id ? null : { id: `stage:${visual.id}`, name: visual.name, kind: 'testfilm', mediaType: visual.media, filePath: visual.file, sourceLabel: visual.tierLabel }); setTrayOpen(false) }} workflowLog={<WorkflowExecutionLog runs={workflowService.listRuns().filter((r) => projectWorkflows.some((w) => w.id === r.workflowId))} liveEvents={workflowEvents} running={workflowRunning}/>} records={projectRecords} rounds={roundSummaries} activeId={tasks.active?.task.id ?? null}
                            onCancel={cancelTaskAndHold} tab={bottomTab} setTab={setBottomTab} />
              )}
        </main>

        {/* 右栏：对话 / 设置 —— 收起后宽屏留一条对话入口窄列，窄屏留一个浮层入口。 */}
        {panelOpen ? (versionsOpen ? <SceneVersionPanel projectId={projectId} scene={currentSceneState} versions={sceneVersions}
            onClose={() => { setVersionsOpen(false); void sceneVersions.refresh(true) }}/> : reviewTab ? <WorkbenchReviewDesk projectId={projectId} review={review} tab={reviewTab} onTab={setReviewTab} visuals={stage.visuals} viewedId={viewedPreview?.id}
            onClose={() => { setReviewTab(null); focusFeedback() }} onDiscuss={focusFeedback}
            onView={showPreview} onCompare={(left, right) => {
              setEditMode(false); setSelectedArtifactId(null); setComparison([left, right]); setTrayOpen(false)
              /* 带上当前目标引用的时间与区域：用户从第 37.2 秒的框选意见点过来对比，
                 就该从 37.2 秒、同一个框开始看，而不是从 0 秒各看各的。 */
              const at = effectiveTarget
              setComparisonAt(at.kind === 'preview' ? { timeSeconds: at.timeSeconds, bbox: at.bbox } : null)
            }}
            onLocate={(opinion) => { const target = opinion.request.references?.find((r) => r.role === 'target'); if (target) locateReference(target) }}
            onContinue={continueOpinion}/> : <RightPanel realModifyBusy={realModifyBusy} realModifyError={realModifyError}
                       onClearRealModifyError={() => setRealModifyError('')}
                       onDemoSubmit={submitDemo}
                       sceneVersion={currentSceneState}
                       onOpenVersions={() => setVersionsOpen(true)}
                       chat={chat} sideTab={sideTab} setSideTab={selectSideTab}
                      focusChatKey={focusChatKey}
                      scope={scope}
                      scopeLabel={scopeLabel} scopeShort={scopeShort} projectId={projectId} target={effectiveTarget} preview={viewedPreview ?? stageLead}
                      onOpenTask={openTaskRecords}
                      onBackFromTask={() => { setEditMode(false); setSideTab(taskReturnTab) }}
                      onCollapse={() => setPanelOpen(false)}
                      constraints={constraints} setConstraints={setConstraints}
                      activeTask={projectTask?.task ?? null} cancelTask={cancelTaskAndHold}
                      records={projectRecords} onSubmit={submit} onQuickAction={runQuickAction}
                      pending={pendingSubmits} onStartQueued={startQueued} onCancelQueued={cancelQueued}
                      onNavigate={onNavigate}
                      references={references} onRemoveReference={removeReference}
                      onLocateReference={locateReference} onToggleReferenceRole={toggleReferenceRole}
                      onClearReferences={clearReferences} onScopeChange={(next) => { setScope(next); setTargetReference(next === 'project' ? currentProjectRef : defaultTarget) }}
                      onResumeRequest={(request) => {
                        setReferences(structuredClone(request.references ?? [])); setConstraints(structuredClone(request.constraints)); setScope(request.scope); chat.setDraft(request.prompt); focusFeedback()
                      }} onOpenReview={openReview} keepNotes={review.keepNotes} reviewSaved={review.saved} />
        ) : (
          <>
            <button className="fw-panel-reopen" type="button" aria-label="打开对话"
                    onClick={() => setPanelOpen(true)}>
              <MessagesSquare className="size-4" /><span>对话</span>
            </button>
            <button className="fw-panel-reopen-float" type="button" aria-label="打开对话"
                    onClick={() => setPanelOpen(true)}>
              <MessagesSquare className="size-4" />对话
            </button>
          </>
        )}
        </>}
      </div>

      {/* ═══ 基岛：状态栏（独立胶囊，不铺整条底板）═══════════════ */}
      <div className="wb-statusbar">
        <span className="wb-status-chip">
          <i className="wb-status-dot" data-s={liveTask || workflowRunning ? 'running' : 'idle'} />
          {editMode ? '本机编辑' : workflowRunning ? '演示运行中' : liveTask ? liveTask.state : stageLead?.origin === 'editor' ? '本机导出' : '演示模式'}
        </span>
        <button className="wb-status-chip is-btn" type="button" aria-pressed={trayOpen}
                onClick={() => setTrayOpen((v) => !v)}>
          <PanelBottom className="size-3" />{trayOpen ? '收起任务面板' : '任务面板'}
          {tasks.active?.task ? ` · ${tasks.active.task.title}` : ''}
        </button>
        {/* 只留总时长：场数在左栏「场景结构 N 场」已经报过一次，
            这里再说一遍就是同一件事写两处。 */}
        {stageLead && <span className="wb-status-chip">{stageLead.tierLabel} · {stageLead.origin === 'editor' ? '编辑版本' : '工作流'} v{stageLead.revision}</span>}
        <span className="wb-spacer" />
      </div>
    </div>
  )
}

/* ── 中栏：产物只读视图 ───────────────────────────────────── */
function ArtifactView({ artifact, onLocate, onReference, onClose }:
  { artifact: WorkbenchArtifact; onLocate: (shotId: string) => void; onReference: () => void; onClose: () => void }) {
  return (
    <div className="fw-artifact-view">
      <div className="fw-artifact-head">
        <div className="fw-artifact-kicker">{ARTIFACT_TYPE_LABEL[artifact.type]}</div>
        <h3>{artifact.title}</h3>
        <p>{artifact.summary}</p>
        <div className="fw-artifact-meta">
          <span>{artifact.version}</span>
          <span data-status={artifact.status}>{ARTIFACT_STATUS_LABEL[artifact.status]}</span>
          <span>{artifact.updatedAt}</span>

        </div>
      </div>
      <div className="fw-artifact-body">
        <pre className="fw-artifact-sheet">{artifact.body}</pre>
        <aside className="fw-artifact-side">
          <div className="fw-scene-hd">关联场景</div>
          {artifact.relatedShotIds.map((id) => {
            const scene = ACTIVE_SCENES.find((s) => s.id === id)
            return scene ? (
              <button key={id} className="mini h-7 w-full justify-start text-[10.5px]" type="button"
                      onClick={() => onLocate(id)}>
                {scene.title}
              </button>
            ) : null
          })}
          <div className="wb-sep" />
          <div className="text-[10.5px] leading-relaxed text-dim">
            点击关联场景可回到监看。
          </div>
          <button className="mini h-7 w-full justify-start text-[10.5px]" type="button" onClick={onReference}>
            引用为上下文
          </button>
          <button className="mini h-7 w-full justify-start text-[10.5px]" type="button" onClick={onClose}>
            回到监看
          </button>
        </aside>
      </div>
    </div>
  )
}

/* ── 左栏：场景列表（paba .fw-ing）────────────────────────── */
function ArtifactIcon({ type }: { type: WorkbenchArtifact['type'] }) {
  const Icon = type === 'content-contract' ? FileText
    : type === 'lookdev' ? BookOpen
    : type === 'film-plan' ? ListTree
    : ShieldCheck
  return <Icon className="size-3.5" />
}

/* ── 牌堆 ────────────────────────────────────────────────────────
   待决定与已确认共用同一套交互（原来只有待决定有，已确认是一行行平铺的记录）：
   牌堆态：下方 ‹ › 切换最前卡（循环，中间圆点指示位置、可点选），点主卡散开成列表；
   列表态：每张小卡右侧 › 键开弹窗看详情，控制区只剩聚拢键；
   形态切换用 FLIP（切换前量位置、切换后反向位移再过渡回自然位置），
   与切换动效同一套过渡（transform/背景/阴影/标题色）。
   卡片尺寸固定：小卡高度写死、内容裁切（标题单行省略、提示最多两行），
   最前卡矮、后层卡长时也不再从牌堆底下漏字。

   两处只有三件事不同，都由 props 决定：圆点语义、卡片高度（记事的正文只有一行）、
   弹窗正文。所以抽成一个组件，而不是抄两份 —— 抄两份迟早会漂移。 */
type DeckEntry = { id: string; title: string; hint: string
  /** 单张卡自己的圆点语义；不给就随整摞的 dotStatus */
  s?: 'done' | 'waiting' | 'running' | 'failed' | 'idle'
  /** 文件卡的卡面：有缩略图就用它，没有就落到 icon（按格式认） */
  thumb?: string
  icon?: ReactNode }

function RailDeck<T extends DeckEntry>({ items, dotStatus, variant, leavingId, removingId, renderModal }: {
  items: T[]
  dotStatus: 'waiting' | 'done' | 'idle'
  /** decision / record = 文字卡（决定与记录）；file = 文件卡（卡面就是那个文件） */
  variant: 'decision' | 'record' | 'file'
  /** 父级给出结论后触发滑出 / 右滑淡出；动画结束后父级再把这条从 items 里去掉 */
  leavingId?: string | null
  removingId?: string | null
  /** › 打开的弹窗正文。ctx.source 是这条当前所在的形态 —— 两种形态退场动画不同 */
  renderModal: (item: T, ctx: { close: () => void; source: 'stack' | 'list' }) => ReactNode
}) {
  const [listOpen, setListOpen] = useState(false)
  const [frontId, setFrontId] = useState<string | null>(null)
  const [modal, setModal] = useState<T | null>(null)
  const deckRef = useRef<HTMLDivElement | null>(null)
  const flipSnap = useRef<{ rects: Map<string, { left: number; top: number }>; height: number } | null>(null)
  useEffect(() => {
    if (!modal) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModal(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])
  const effectiveFrontId = frontId && items.some((d) => d.id === frontId) ? frontId : null
  const frontCardId = effectiveFrontId ?? items[0]?.id
  const frontIndex = frontCardId ? items.findIndex((d) => d.id === frontCardId) : 0
  const ordered = frontCardId
    ? [...items.filter((d) => d.id === frontCardId), ...items.filter((d) => d.id !== frontCardId)]
    : items
  const stepFront = (dir: 1 | -1) => {
    if (items.length <= 1) return
    setFrontId(items[(frontIndex + dir + items.length) % items.length].id)
  }
  /* 牌堆态 DOM 顺序固定为原始顺序，只用 data-pos 换前后——切卡时不挪节点，
     否则被挪的节点会丢过渡（实测：旧卡 30ms 就跳到最终位置，新卡却正常过渡）。

     叠几层：作者定稿最多 5 张。原来 pos > 2 一律压成 pos=2 且完全透明，于是
     5 张卡看着只有 2 层，点圆点跳到第 4 张时外观和第 1 张一模一样，只有字在变 ——
     看不出自己在哪。现在改成按脸位（rank）递进，但**封顶 MAX_STACK**：
       · rank 1 / 2 照旧错开（10px / 16px），带纸边阴影；
       · rank 3 / 4 继续往外退、逐渐变淡，凑满「看得见的 5 张」；
       · rank >= 5 既不叠也不再露出纸边（data-hidden），只留一个隐藏节点。
     保留隐藏节点是有意的：DOM 里每张卡都在，切卡只是换 data-pos，节点不增删，
     transition 才有东西可过渡；删掉节点那一次切换会闪、会丢动画。 */
  const MAX_STACK = 5
  const nonFront = items.filter((d) => d.id !== frontCardId)
  const stackCards = items.map((d) => {
    const rank = d.id === frontCardId ? 0 : 1 + nonFront.findIndex((x) => x.id === d.id)
    const pos = rank <= 2 ? rank : 2
    return {
      d, pos, rank,
      depth: Math.min(rank, MAX_STACK - 1),
      under: rank > 2 && rank < MAX_STACK,
      hidden: rank >= MAX_STACK,
    }
  })
  /* 散开成列表时用 ordered（当前卡在前、其余按原始顺序接上），不用 items ——
     实测：用原始顺序时，用户在牌堆第 5 张点开列表，自己看的那张却排在列表第 1 位，
     和圆点显示的位置对不上。散开是从"这一张"展开的，列表就该从这一张开始。 */
  const shown = listOpen
    ? ordered.map((d, i) => ({ d, pos: undefined as number | undefined, rank: i, depth: i, under: false, hidden: false }))
    : stackCards
  const captureFlip = () => {
    const deckEl = deckRef.current
    if (!deckEl) return
    const rects = new Map<string, { left: number; top: number }>()
    deckEl.querySelectorAll('.fw-deck-card').forEach((el) => {
      const id = (el as HTMLElement).dataset.id
      if (!id) return
      const r = el.getBoundingClientRect()
      rects.set(id, { left: r.left, top: r.top })
    })
    flipSnap.current = { rects, height: deckEl.getBoundingClientRect().height }
  }
  const toggleList = (next: boolean) => { captureFlip(); setListOpen(next) }
  useEffect(() => {
    const snap = flipSnap.current
    const deckEl = deckRef.current
    if (!snap || !deckEl) return
    flipSnap.current = null
    const cards = [...deckEl.querySelectorAll('.fw-deck-card')] as HTMLElement[]
    const newH = deckEl.getBoundingClientRect().height
    cards.forEach((el) => {
      const old = snap.rects.get(el.dataset.id || '')
      if (!old) return
      const r = el.getBoundingClientRect()
      el.style.transition = 'none'
      el.style.transform = `translate(${old.left - r.left}px, ${old.top - r.top}px)`
    })
    void deckEl.offsetHeight
    cards.forEach((el) => { el.style.transition = ''; el.style.transform = '' })
    deckEl.style.transition = 'height .3s ease'
    deckEl.style.height = `${snap.height}px`
    void deckEl.offsetHeight
    deckEl.style.height = `${newH}px`
    const clear = () => { deckEl.style.transition = ''; deckEl.style.height = '' }
    deckEl.addEventListener('transitionend', clear, { once: true })
    window.setTimeout(clear, 350)
  }, [listOpen])
  if (items.length === 0) return null
  return (
    <>
      <div className={`fw-deck fw-deck--${variant}${listOpen ? ' is-list' : ''}`} ref={deckRef}>
        {shown.map(({ d, pos, depth, under, hidden }) => {
          const front = !listOpen && pos === 0
          /* 文件卡：整张卡就是那个文件本身 —— 图片/视频给画面，没有画面的格式
             给格式图标。不再挂文件名和「引用 · 可商用」那一行：这是一摞素材的
             缩略浏览，卡上一写字，画面就被压掉三成，而且这些字段（授权、审核、
             时长）在预览弹窗里已经有完整一份，卡上再抄一遍是重复。
             点卡即预览（不做「散开成列表」——那是决定卡用来翻多条记录的形态）。 */
          if (variant === 'file') {
            return (
              <div key={d.id} data-id={d.id} className="fw-deck-card"
                   data-pos={pos}
                   data-depth={depth}
                   data-under={under || undefined}
                   data-hidden={hidden || undefined}
                   style={{ '--depth': String(depth) } as React.CSSProperties}
                   aria-hidden={!front ? true : undefined}
                   aria-label={d.title}
                   onClick={front ? () => setModal(d) : undefined}>
                <span className="fw-file-face">
                  {d.thumb ? <img src={d.thumb} alt="" /> : <span className="fw-file-ph">{d.icon}</span>}
                </span>
              </div>
            )
          }
          return (
            <div key={d.id} data-id={d.id} className="fw-rail-decision fw-deck-card"
                 data-pos={pos}
                 data-depth={depth}
                 data-under={under || undefined}
                 data-hidden={hidden || undefined}
                 style={{ '--depth': String(depth) } as React.CSSProperties}
                 data-leaving={leavingId === d.id || undefined}
                 data-removing={removingId === d.id || undefined}
                 aria-hidden={!listOpen && !front ? true : undefined}
                 onClick={!listOpen && front ? () => toggleList(true) : undefined}>
              <span className="fm-dot" data-s={d.s ?? dotStatus} />
              <span className="fw-rail-decision-main">
                <b>{d.title}</b>
                <small>{d.hint}</small>
              </span>
              <button type="button" className="fw-deck-marker" aria-label={`查看${d.title}详情`}
                      onClick={(e) => { e.stopPropagation(); setModal(d) }}>›</button>
            </div>
          )
        })}
      </div>
      {/* 只有一张卡时整组控件不出现：‹ › 渲染出来也是 disabled、点了没反应，
          圆点更是只有一个高亮长条 —— 没有选择可做的时候，别摆出选择的架势。 */}
      {(listOpen || items.length > 1) && (
        <div className="fw-deck-controls">
          {listOpen ? (
            <button type="button" className="fw-deck-gather" onClick={() => toggleList(false)}>聚拢 ↑</button>
          ) : (
            <span className="fw-deck-switch">
              <button type="button" className="fw-deck-switch-btn" aria-label="上一张"
                      onClick={() => stepFront(-1)}>‹</button>
              <span className="fw-deck-dots">
                {items.map((d) => (
                  <button key={d.id} type="button" className="fw-deck-dot"
                          data-active={d.id === items[frontIndex]?.id || undefined}
                          aria-label={`看${d.title}`} onClick={() => setFrontId(d.id)} />
                ))}
              </span>
              <button type="button" className="fw-deck-switch-btn" aria-label="下一张"
                      onClick={() => stepFront(1)}>›</button>
            </span>
          )}
        </div>
      )}
      {modal && (
        <div className="fw-modal-backdrop" onClick={() => setModal(null)}>
          <div className="fw-modal" role="dialog" aria-modal="true" aria-label={`${modal.title}详情`}
               onClick={(e) => e.stopPropagation()}>
            {renderModal(modal, { close: () => setModal(null), source: listOpen ? 'list' : 'stack' })}
          </div>
        </div>
      )}
    </>
  )
}

function ProjectRail({ projectName, projectId, open, onClose, tab, onTab, onOpenBrief, onEditScene,
  selectedArtifactId, onSelectArtifact,
  confirmed,
  decisions, onDecide, workflowId, outline, materials, openShelf, onToggleShelf,
  activeSceneId, liveState, onSelectContent, onOpenWorkflowEditor,
  wholeFilmActive, onSelectWholeFilm, onOpenMaterials, progressPanel }:
  { projectName: string; projectId: string; open: boolean; onClose: () => void
    tab: RailTab; onTab: (tab: RailTab) => void
    selectedArtifactId: string | null; onSelectArtifact: (id: string) => void
    confirmed: { id: string; title: string; hint: string }[]
    decisions: { wfId: string; nodeId: string; id: string; title: string; hint: string; detail: string }[]
    onDecide: (wfId: string, nodeId: string, verdict: 'done' | 'rework') => void
    workflowId: string | null
    /** 内容页的行（整片之外真实存在的内容单元）与它从哪来 */
    outline: ContentOutline
    /** 资料页的三格：素材 / 参考 / 缺失（素材与参考分开，每格按格式一摞一摞堆） */
    materials: MaterialShelf[]
    openShelf: string | null
    onToggleShelf: (id: string) => void
    /** 现在被设为 AI 修改范围的那个单元 */
    activeSceneId: string | null
    /** AI 任务正在跑时的状态词（执行中…）；没在跑就是 null —— 正在处理的那一行自己显示它 */
    liveState: string | null
    onSelectContent: (row: ContentRow) => void
    onOpenWorkflowEditor?: (workflowId: string) => void
    /** 整片：不管项目有没有分镜都固定存在的入口，选中即把修改范围设为整个项目。 */
    wholeFilmActive: boolean
    onSelectWholeFilm: () => void
    /** 内容行缺素材时，把人带到资料页那摞素材卡上 */
    onOpenMaterials: () => void
    /** 概览第一格：当前进度卡（读数 + 运行入口，见 RailProgress.tsx） */
    onOpenBrief: () => void
    onEditScene: () => void
    progressPanel?: ReactNode }) {
  /* 给结论后先让那张卡退场（牌堆态滑出、列表态右滑淡出），动画结束再写回工作流。
     卡片的形态、位移与弹窗都在 RailDeck 里，这里只留「哪张正在退场」和它的定时器。 */
  const [leaving, setLeaving] = useState<{ id: string; verdict: 'done' | 'rework' } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const leavingTimer = useRef<number | null>(null)
  const removingTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (leavingTimer.current) window.clearTimeout(leavingTimer.current)
    if (removingTimer.current) window.clearTimeout(removingTimer.current)
  }, [])
  const decideFromModal = (d: (typeof decisions)[number], source: 'stack' | 'list', verdict: 'done' | 'rework') => {
    if (leaving || removing) return
    if (source === 'list') {
      setRemoving(d.id)
      removingTimer.current = window.setTimeout(() => { onDecide(d.wfId, d.nodeId, verdict); setRemoving(null) }, 220)
    } else {
      setLeaving({ id: d.id, verdict })
      leavingTimer.current = window.setTimeout(() => { onDecide(d.wfId, d.nodeId, verdict); setLeaving(null) }, 280)
    }
  }
  return (
    <aside className="fw-ing" data-open={open ? '' : undefined} aria-label="项目导航">
      <div className="wb-space-heading"><FolderOpen size={15}/><span>项目空间</span></div>
      {/* 四个页签就是这一栏的全部导航。原来那行「概览 1 项」标题只是把页签名和
          一个计数又写了一遍，还把首屏高度花在标题上，去掉。 */}
      <div className="fw-ing-hd">
        <SegmentedControl value={tab} onChange={onTab} ariaLabel="工作区导航"
                          className="fw-rail-seg"
                          options={[
                            { value: 'overview', label: '概览' },
                            { value: 'artifacts', label: '产物' },
                            { value: 'content', label: '内容' },
                            { value: 'materials', label: '资料' },
                          ]} />
        <button className="iconbtn fw-mobile" type="button" title="收起" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>

      {tab === 'artifacts' ? (
        <div className="fw-artifacts" role="tabpanel">
          {/* 工作流产出的文档型产物（有版本与状态） */}
          {WORKBENCH_ARTIFACTS.map((a) => (
            <button key={a.id} type="button" className="fw-artifact"
                    aria-current={a.id === selectedArtifactId ? 'true' : undefined}
                    onClick={() => onSelectArtifact(a.id)}>
              <span className="fw-artifact-ic"><ArtifactIcon type={a.type} /></span>
              <span className="fw-artifact-main">
                <b>{a.title}</b>
                <small>{ARTIFACT_TYPE_LABEL[a.type]} · {a.version}</small>
              </span>
              <span className="fw-artifact-status" data-status={a.status}>{ARTIFACT_STATUS_LABEL[a.status]}</span>
            </button>
          ))}
          {/* 项目目录里真实存在的文件（AI 产出的视频、脚本等）——
              与上面的工作流产物分开呈现：来源不同，一个来自流程节点，一个来自磁盘。 */}
          <ProjectArtifacts projectId={projectId} />
        </div>
      ) : tab === 'content' ? (
        /* 内容 —— 这部片有哪些画面，是这一栏的主要导航：找到某个画面，并把修改范围
           明确给 AI。整片固定存在（不然用户没法说「整部片的节奏太慢」）；下面的行
           只在项目真有可靠结构时出现（见 data/contentOutline.ts）。

           行只显示它真有的东西：名称、产物的状态、产物里真写了帧号才有时间、指到
           预览文件才有缩略图。没有画面就不留空缩略图位，也不拿渲染切片冒充内容。 */
        <div className="fw-ing-list">
          <button type="button" className="fm-unit" data-state="whole"
                  aria-current={wholeFilmActive ? 'true' : undefined}
                  onClick={onSelectWholeFilm}>
            <span className="fm-unit-body">
              <b>整片 · {projectName}</b>
              <span>需求与视觉方向</span>
            </span>
          </button>

          {outline.rows.map((row) => {
            /* 正在处理的就是这一行：状态改成实时状态、圆点亮起来 ——
               「当前进度」卡在概览页，用户浏览内容列表时看不到它，所以让行自己说。
               这不新开栏目，也不铺执行细节（细节在右侧任务页与底部面板）。 */
            const busy = liveState !== null && row.ref.sceneId === activeSceneId
            return (
              <Fragment key={row.id}>
              <button type="button" className="fm-unit" data-part={row.depth}
                      data-busy={busy || undefined}
                      aria-current={row.ref.sceneId === activeSceneId ? 'true' : undefined}
                      onClick={() => onSelectContent(row)}>
                {row.thumb && <span className="fm-unit-frame"><img src={row.thumb} alt="" /></span>}
                {busy && <i className="fm-dot" data-s="running" />}
                <span className="fm-unit-body">
                  <b>{row.index && <span className="fm-unit-index">{row.index}</span>}{row.name}</b>
                  <span>
                    {busy ? `正在制作 · ${liveState}` : row.status}
                    {row.span ? ` · ${fmtClock(row.span.from)}–${fmtClock(row.span.from + row.span.duration)}` : ''}
                  </span>
                </span>
              </button>
              {/* 这一行自己声明要外部素材、而素材索引里没有场景级绑定时，就地提醒一次；
                  点它去资料页看那摞素材卡（不是跳素材库）。 */}
              {row.needs && (
                <button type="button" className="fm-unit-need" onClick={onOpenMaterials}>
                  需要{row.needs} · 还没绑定素材 ›
                </button>
              )}
              </Fragment>
            )
          })}

          {outline.rows.length === 0 && (
            <p className="fw-rail-none">
              还没有能拆开的内容结构：工作流产出场景规格或导演处理之后，这里才会出现画面单元。
            </p>
          )}
        </div>
      ) : tab === 'materials' ? (
        /* 资料 —— 素材与参考**分开两格**，各自按格式一摞一摞地堆（图片/视频/音频）。
           不做抽屉、不跳素材库：几十张图铺进左栏会挤掉内容导航，跳走又会丢掉来路。
           「产物」入口已按作者定稿去掉。
           三个入口用概览同一套蓝色标签（.fw-tag）：原来是一排灰卡 + 右侧数字 + ›，
           和概览的分组标题不是一个语言，且数字在右、标题在左，读起来要来回跳。
           现在数字并进标签内部、贴着标题，右侧不再有第二个数字和箭头。
           下面那段「素材索引只记…」的说明是给开发看的字段限制，不是作者要读的话，去掉。 */
        <div className="fw-ing-list">
          {materials.map((shelf) => (
            <Fragment key={shelf.id}>
              <button type="button" className="fw-tag fw-tag--shelf"
                      aria-expanded={openShelf === shelf.id}
                      onClick={() => onToggleShelf(shelf.id)}>
                {shelf.title}<span className="fw-tag-n num">{shelf.count}</span>
              </button>

              {openShelf === shelf.id && (
                shelf.piles.length === 0 ? (
                  <p className="fw-rail-none">{shelf.empty ?? '这一格现在是空的。'}</p>
                ) : (
                  /* 和概览同一套牌堆，同一套叠放与翻卡 —— 区别只在卡片本身：
                     这里的每张卡就是一个文件（卡面是它自己的缩略图），
                     相同格式的文件堆成一摞：图片一摞、视频一摞、音频一摞。 */
                  shelf.piles.map((pile) => (
                    <Fragment key={pile.id}>
                      <div className="fw-stack-hd">
                        {pile.title}
                        <span className="num">{pile.files.length}</span>
                      </div>
                      <RailDeck items={pile.files.map(fileEntry)} dotStatus="idle" variant="file"
                                renderModal={(file, { close }) => (
                                  <>
                                    <div className="fw-modal-head">
                                      <span className="fw-rail-decision-main">
                                        <b>{file.title}</b><small>{file.hint}</small>
                                      </span>
                                      <button type="button" className="fw-modal-close" aria-label="关闭" onClick={close}>×</button>
                                    </div>
                                    <span className="fw-asset-preview">
                                      {file.thumb
                                        ? <img src={file.thumb} alt={file.title} />
                                        : <span className="fw-file-ph">{file.icon}</span>}
                                    </span>
                                  </>
                                )} />
                    </Fragment>
                  ))
                )
              )}
            </Fragment>
          ))}

          {materials.length === 0 && (
            <p className="fw-rail-none">这个项目还没有素材文件。</p>
          )}

        </div>
      ) : (
        <div className="fw-ing-list">
          {/* 概览第一格：当前进度（读数 + 运行入口）。原来这里还并排一块「正在制作」
              面板，两块报同一件事、同屏出现两个阶段数，已合成一张卡（RailProgress.tsx）。
              下面两段是同一份快照的两种过滤：等你拍板的、和你已经定下的。 */}
          {progressPanel}

          {decisions.length > 0 && <section>
            <div className="fw-scene-hd">
              <span className="fw-tag">待决定<span className="fw-tag-n num">{decisions.length}</span></span>
            </div>
            {(
              /* 多条决定：牌堆态（小卡叠放，圆点选最前）与列表态（向下排列）共用同一批
                 卡片节点；详情只在弹窗里，不再有展开的大卡片。 */
              <RailDeck items={decisions} dotStatus="waiting" variant="decision"
                        leavingId={leaving?.id ?? null} removingId={removing}
                        renderModal={(d, { close, source }) => (
                          <>
                            <div className="fw-modal-head">
                              <span className="fm-dot" data-s="waiting" />
                              <span className="fw-rail-decision-main"><b>{d.title}</b><small>{d.hint}</small></span>
                              <button type="button" className="fw-modal-close" aria-label="关闭" onClick={close}>×</button>
                            </div>
                            <p className="fw-modal-detail">{d.detail}</p>
                            <div className="fw-rail-decision-acts">
                              <button type="button" className="fw-decide-btn" data-kind="done"
                                      onClick={() => decideFromModal(d, source, 'done')}>通过</button>
                              <button type="button" className="fw-decide-btn" data-kind="rework"
                                      onClick={() => decideFromModal(d, source, 'rework')}>要改</button>
                            </div>
                            <button type="button" className="fw-rail-decision-more"
                                    onClick={() => { close(); if (workflowId) onOpenWorkflowEditor?.(workflowId) }}>打开工作流查看详情</button>
                          </>
                        )} />
            )}
          </section>}

          {confirmed.length > 0 && (
            /* 已确认和待决定用同一套牌堆：卡多了叠起来、‹ › 翻、点主卡散开成列表。
               区别只在内容 —— 它是记录，没有可操作项，所以弹窗里只给深链。 */
            <section>
              <div className="fw-scene-hd">
                <span className="fw-tag">最近已决定<span className="fw-tag-n num">{confirmed.length}</span></span>
              </div>
              <RailDeck items={confirmed} dotStatus="done" variant="record"
                        renderModal={(c, { close }) => (
                          <>
                            <div className="fw-modal-head">
                              <span className="fm-dot" data-s="done" />
                              <span className="fw-rail-decision-main"><b>{c.title}</b><small>{c.hint}</small></span>
                              <button type="button" className="fw-modal-close" aria-label="关闭" onClick={close}>×</button>
                            </div>
                            <button type="button" className="fw-rail-decision-more"
                                    onClick={() => { close(); if (workflowId) onOpenWorkflowEditor?.(workflowId) }}>打开工作流查看详情</button>
                          </>
                        )} />
            </section>
          )}

        </div>
      )}

      <div className="wb-space-links">
        <span>项目工具</span>
        <button type="button" onClick={onOpenBrief}><FileText size={14}/>制作要求<ArrowUpRight size={13}/></button>
        <button type="button" onClick={onEditScene}><Film size={14}/>场景编辑器<ArrowUpRight size={13}/></button>
      </div>
    </aside>
  )
}

/** 文件格式 → 占位图标（没有缩略图时用；不画空框） */
const MEDIA_NODE: Record<MaterialFile['media'], ReactNode> = {
  image: <ImageIcon className="size-5" />,
  video: <Film className="size-5" />,
  audio: <Music2 className="size-5" />,
  font: <TypeIcon className="size-5" />,
  doc: <FileText className="size-5" />,
}

/** 一个文件 → 牌堆里的一张卡。卡面就是文件本身，卡脚是名字与授权/审核。 */
const fileEntry = (f: MaterialFile) => ({
  id: f.id,
  title: f.name,
  hint: `${f.adopted ? '引用 · ' : ''}${f.meta}`,
  thumb: f.thumb,
  icon: MEDIA_NODE[f.media],
})

function ToolButton({ label, onClick, active, disabled, children }: {
  label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="iconbtn fw-toolbtn" type="button" aria-label={label}
                aria-pressed={active || undefined} disabled={disabled} onClick={onClick}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  )
}

/* ── 这次制作的画面 ───────────────────────────────────────────
   只渲染产物真的指到的那个文件（测试帧 / 试片 / 整片）。
   视频给原生控件，图片给静态画面 —— 不套播放器皮肤，
   因为没有时间轴就没有逐帧定位，装成播放器会让用户以为能拖到某一帧。
   文件加载失败就说失败，不退回旧成片。 */
function StageFrame({ visual, mediaRef, onTime, onDuration, location, currentTime, onReady }: { visual: StageVisual; mediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>; onTime: (time: number) => void; onDuration: (duration: number) => void; onReady: (ready: boolean) => void; currentTime: number; location?: { visualId: string; timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null }) {
  useEffect(() => {
    const media = mediaRef.current
    if (location?.visualId === visual.id && location.timeSeconds !== undefined && media instanceof HTMLVideoElement && media.readyState >= 1) {
      media.pause(); media.currentTime = Math.min(location.timeSeconds, media.duration); onTime(media.currentTime)
    }
  }, [location, visual.id, mediaRef, onTime])
  const [failed, setFailed] = useState(false)
  if (failed) return <div className="fw-mon-empty"><div className="fw-mon-empty-title">{visual.tierLabel}暂时无法播放</div><p className="fw-mon-empty-sub">文件可能已移动或连接中断。</p><button type="button" className="wb-media-retry" onClick={() => setFailed(false)}>重新加载预览</button></div>
  return <>{visual.media === 'video' ? <video ref={(el) => { mediaRef.current = el }} className="fw-stage-media" src={visual.file} controls playsInline onLoadedData={() => onReady(true)} onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => { onDuration(e.currentTarget.duration); const seconds = location?.visualId === visual.id ? location.timeSeconds ?? 0 : 0; e.currentTarget.currentTime = Math.min(seconds, e.currentTarget.duration); onTime(e.currentTarget.currentTime) }} onError={() => { onReady(false); onDuration(0); setFailed(true) }}/> : <img ref={(el) => { mediaRef.current = el }} className="fw-stage-media" src={visual.file} alt={visual.tierLabel} onLoad={() => onReady(true)} onError={() => { onReady(false); onDuration(0); setFailed(true) }}/>}{location?.visualId === visual.id && location.bbox && (visual.media === 'image' || location.timeSeconds === undefined || Math.abs(currentTime - location.timeSeconds) < 0.08) && <PreviewTargetHighlight mediaRef={mediaRef} bbox={location.bbox}/>}</>
}

function PreviewTargetHighlight({ mediaRef, bbox }: { mediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>; bbox: { x: number; y: number; w: number; h: number } }) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useEffect(() => {
    const media = mediaRef.current
    const parent = media?.parentElement
    if (!media || !parent) return
    const measure = () => {
      const naturalWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
      const naturalHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
      const visible = containedMediaRect(media.getBoundingClientRect(), naturalWidth, naturalHeight)
      const host = parent.getBoundingClientRect()
      if (visible) setRect({ left: visible.left - host.left + visible.width * bbox.x, top: visible.top - host.top + visible.height * bbox.y, width: visible.width * bbox.w, height: visible.height * bbox.h })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(media); media.addEventListener('loadedmetadata', measure); media.addEventListener('load', measure); measure()
    return () => { observer.disconnect(); media.removeEventListener('loadedmetadata', measure); media.removeEventListener('load', measure) }
  }, [mediaRef, bbox])
  return rect ? <div className="wb-reference-highlight" role="img" aria-label="本条意见引用的画面区域" style={rect}><span>意见引用区域</span></div> : null
}

/* ── 右栏：对话 / 修改设置 ──────────────────────────────────── */
function RightPanel({ projectId, target, preview, chat, sideTab, setSideTab, focusChatKey, scope, scopeLabel, scopeShort,
  onOpenTask, onBackFromTask, onCollapse,
  constraints, setConstraints, activeTask, cancelTask, records, onSubmit, onQuickAction,
  pending, onStartQueued, onCancelQueued,
  onNavigate, references, onRemoveReference,
  onLocateReference, onToggleReferenceRole, onClearReferences, onScopeChange,
  onOpenReview, keepNotes, reviewSaved, onResumeRequest,
  realModifyBusy, realModifyError, onClearRealModifyError, onDemoSubmit, sceneVersion, onOpenVersions }:
  { projectId: string; target: AgentReference; preview: StageVisual | null; chat: ChatState; sideTab: SideTab; setSideTab: (v: SideTab) => void; focusChatKey: number
    scope: 'project'|'scene'|'selection'
    /** 输入框上显示的作用范围（真名，不是枚举）与它的短名（占位文案用） */
    scopeLabel: string; scopeShort: string
    onOpenTask: () => void
    onBackFromTask: () => void; onCollapse: () => void
    constraints: ModificationConstraints
    setConstraints: React.Dispatch<React.SetStateAction<ModificationConstraints>>
    activeTask: AgentTask | null; cancelTask: (id: string) => void; records: TaskRecord[]
    onSubmit: (p: string) => Promise<boolean>; onQuickAction: (a: (typeof quickActions)[number]) => void
    pending: Array<{ key: string; messageId: string; prompt: string; status: 'waiting' | 'cancelled' }>
    onStartQueued: (key: string) => void; onCancelQueued: (key: string) => void
    onNavigate: (v: ViewId) => void
    references: AgentReference[]; onRemoveReference: (id: string) => void
    onLocateReference: (ref: AgentReference) => void; onToggleReferenceRole: (id: string) => void
    onClearReferences: () => void; onScopeChange: (next: 'project'|'scene'|'selection') => void
    onOpenReview: (tab: ReviewDeskTab) => void; keepNotes: string; reviewSaved: boolean; onResumeRequest: (request: TaskRequest) => void
    /** 真实修改正在提交：按钮要禁用并改文案，否则用户会连点发多次 */
    realModifyBusy: boolean
    /** 上次真实修改失败的原因；非空表示要一直显示到用户处理 */
    realModifyError: string
    onClearRealModifyError: () => void
    /** 演示入口：用户明确点「演示」才走本地假执行 */
    onDemoSubmit: (p: string) => void
    /** 后端当前场景；null 表示还没读到 */
    sceneVersion: ProjectSceneState | null
    /** 打开场景版本历史。没有场景版本可看时也应能点开 —— 里面会说明「还没有版本」 */
    onOpenVersions: () => void }) {
  /* 草稿只在提交成功后清空：失败时保留输入，用户改一个字就能重发，
     而不用把整段要求重写一遍。onSubmit 返回是否成功。 */
  /**
   * 「作用于 x · 场景版本 N」里的版本部分。
   *
   * <p>显示版本不是装饰：连续修改时用户要能看出这次改的是哪一版，
   * 冲突时也能马上发现「界面上的版本已经旧了」。</p>
   */
  const sceneVersionLabel = sceneVersion === null
    ? null
    : sceneVersion.initialized
      ? `场景版本 v${sceneVersion.version}`
      : '尚未生成场景'

  const submit = async () => {
    const v = chat.draft.trim()
    if (!v || realModifyBusy) return
    const ok = await onSubmit(v)
    if (ok) chat.setDraft('')
  }
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  /* 问题/场景带入对话时聚焦输入框：只在切到对话后触发，不抢其他视图的焦点。 */
  useEffect(() => {
    if (sideTab === 'chat' && focusChatKey > 0) inputRef.current?.focus()
  }, [focusChatKey, sideTab])
  const activeRecord = activeTask ? records.find((r) => r.task.id === activeTask.id) ?? null : null
  const activeLive = !!activeTask && (activeTask.status === 'queued' || activeTask.status === 'running' || activeTask.status === 'building')
  const activeDone = !!activeTask && (activeTask.status === 'completed' || activeTask.status === 'failed' || activeTask.status === 'cancelled')
  const latestEvent = activeRecord?.events.at(-1)
  const messages = chat.messages.filter((m) => m.id !== 'intro' && (!m.projectId || m.projectId === projectId))
  /* 输入框附近的保留条件摘要：只列已启用的，默认全开时也不铺开关 ——
     用户能看见当前约束（不再默默限制），改约束去次级视图。 */
  const enabledConstraints = ([
    ['preserveCamera', '机位'],
    ['preserveCaptions', '字幕'],
    ['limitToSelection', '不改其他场景'],
    ['reuseExistingComponents', '复用组件'],
  ] as const).filter(([key]) => constraints[key])

  return (
    <aside className="fw-panel" aria-label="AI 对话">
      <div className="wb-assistant-heading"><MessagesSquare size={16}/><strong>创作助手</strong><span>本机记录</span></div>
      <div className="fw-ing-hd fw-panel-hd">
        {sideTab !== 'edit' && <SegmentedControl value={sideTab === 'settings' || sideTab === 'task' ? '' : sideTab}
                          onChange={(next) => setSideTab(next as SideTab)}
                          ariaLabel="场景与 AI 工作区"
                          className="fw-panel-seg"
                          options={[{ value: 'chat', label: '对话' }, { value: 'scene', label: '当前目标' }]} />}
        {sideTab === 'edit' && <span className="fw-panel-title">Remotion 编辑器</span>}
        {sideTab === 'task' && <span className="fw-panel-title">执行记录</span>}
        {sideTab === 'settings' && <span className="fw-panel-title">修改设置</span>}
        <ToolButton label="修改设置" active={sideTab === 'settings'} onClick={() => setSideTab('settings')}>
          <Settings2 className="size-3.5" />
        </ToolButton>
        {/* 原型：从工作台切回完整对话视图（同一份 useChat 会话） */}
        <ToolButton label="完整对话" onClick={() => onNavigate('conversation')}>
          <MessagesSquare className="size-3.5" />
        </ToolButton>
        <ToolButton label="收起右侧栏" onClick={onCollapse}>
          <ChevronRight className="size-3.5" />
        </ToolButton>
      </div>

      {sideTab === 'scene' ? (<div className="fw-scroll wb-target-facts"><span className="wb-target-kicker">修改目标</span><h3>{target.label}</h3><p>{target.kind === 'project' ? '本次意见作用于整个项目；选中具体预览或内容后，可以缩小修改范围。' : '意见会连同当前目标一起发送。查看发送记录可核对当时的范围。'}</p>{preview && <dl><dt>预览类型</dt><dd>{preview.tierLabel}</dd><dt>{preview.origin === 'editor' ? '编辑版本' : '工作流版本'}</dt><dd>v{preview.revision}</dd><dt>预览生成于</dt><dd>{new Date(preview.createdAt).toLocaleString('zh-CN')}</dd></dl>}<button type="button" className="wb-btn-ghost" onClick={() => setSideTab('chat')}><MessagesSquare size={14}/> 对这个目标提意见</button></div>
      ) : sideTab === 'chat' ? (
        <>
          <div className="fw-scroll">
            <div className="flex flex-col gap-3 p-3.5">
              {/* 上下文条（paba .fw-ctx）：你在改哪个场景 */}
              <div className="fw-ctx wb-feedback-context"><span className="wb-feedback-context-icon"><MessagesSquare size={18}/></span><div className="min-w-0"><b>{preview ? '这份画面，想怎么调整？' : '继续完善你的想法'}</b><small>{preview ? '选中画面，留下具体的修改意见。' : '描述风格、补充细节，或标记要保留的内容。'}</small></div></div>

              {/* 消息：AI 不用气泡，用户用 --soft 底（fm-components §9） */}
              <ReferenceChips references={references}
                              defaultLabel={target.kind === 'project' ? '当前目标：整个项目' : `当前目标：${target.label}`}
                              onRemoveReference={onRemoveReference}
                              onLocateReference={onLocateReference}
                              onToggleReferenceRole={onToggleReferenceRole}
                              onClearReferences={onClearReferences} />

              {messages.length === 0 && !preview && <div className="wb-feedback-starters"><span>从一个细节开始</span>{[['画面风格', '关于画面风格，我希望：'], ['必须保留', '请保留以下内容，不要修改：'], ['参考用法', '关于参考资料，请借鉴：']].map(([label, draft]) => <button type="button" key={label} onClick={() => { chat.setDraft(chat.draft.trim() ? `${chat.draft}\n${draft}` : draft); inputRef.current?.focus() }}>{label}<Plus size={12}/></button>)}</div>}
              {messages.map((m) => (
                m.role === 'user'
                  ? (
                    <div key={m.id}>
                      <p className="fm-msg-user">{m.text}</p><RequestSnapshot request={records.find((r) => r.task.id === m.taskId)?.request}/>
                      {pending.filter((p) => p.messageId === m.id).map((p) => (
                        p.status === 'waiting' ? (
                          <div key={p.key} className="wb-queue-note">
                            <span>等待处理 · 当前任务结束后处理</span>
                            <button type="button" disabled={activeLive} onClick={() => onStartQueued(p.key)}>现在开始</button>
                            <button type="button" onClick={() => onCancelQueued(p.key)}>取消</button>
                          </div>
                        ) : (
                          <div key={p.key} className="wb-queue-note"><span>已取消等待</span></div>
                        )
                      ))}
                    </div>
                  )
                  : (
                    <div key={m.id} className="fw-msg">
                      <span className="fw-msg-avatar">AI</span>
                      <div className="fw-msg-body">
                        <p className="fm-msg-ai">{m.text}</p>
                        {/* 与对话视图同一套口径。换了个页签就把标记丢掉的话，
                            这里会显得这些回复像是真 Agent 说的 —— useChat 的字段
                            注释已经写明「界面必须显示」「不得当作成功」。 */}
                        {m.streaming && <p className="fw-msg-note">正在回复…</p>}
                        {m.failed && <p className="fw-msg-failed" role="alert">这条回复没有完成：{m.failed}</p>}
                        {m.demo && !m.streaming && !m.failed && <p className="fw-msg-note">演示回复 · 未连接 Agent</p>}
                      </div>
                    </div>
                  )
              ))}

              {/* 执行项只插在消息流里，不另开大卡片：进行中只露最新一条关键事件，
                  演示身份挂在项上（不是只靠底部的离线行）。 */}
              {activeTask && activeLive && (
                <div className="wb-chat-block">
                  <div className="wb-chat-task">
                    <LoaderCircle className="size-3 animate-spin" />
                    <b className="truncate">{activeRecord?.request
                      ? `正在演示记录 ${activeRecord.request.references?.find((r) => r.role === 'target')?.label ?? '整片'}`
                      : activeTask.title}</b>
                    <span className="wb-insp-tag">演示</span>
                    <span className="wb-insp-tag">{TASK_STATUS_LABEL[activeTask.status] ?? activeTask.status}</span>
                  </div>
                  {latestEvent && <div className="wb-chat-event">{latestEvent.message}</div>}
                  <div className="flex gap-1.5">
                    <button className="wb-btn-ghost" type="button" onClick={onOpenTask}>查看执行</button>
                    <button className="wb-btn-ghost" type="button" onClick={() => cancelTask(activeTask.id)}>
                      <Square className="size-3" />停止
                    </button>
                  </div>
                </div>
              )}

              {/* 任务结果卡。
                  演示任务不产预览、不改文件，所以只报结束；
                  真实任务会产出 mp4，文案必须说清这一点 —— 否则用户看到
                  「没有生成新预览」而左侧明明有一个能播的视频（真机截图确认过）。 */}
              {activeTask && activeDone && (
                <div className="wb-chat-block">
                  <div className="wb-chat-task">
                    <span className="fm-dot" data-s={activeTask.status === 'completed' ? 'done' : activeTask.status === 'failed' ? 'failed' : 'idle'} />
                    <b className="truncate">
                      {activeTask.status === 'completed'
                        ? (activeTask.mock ? '演示任务已完成' : '渲染已完成')
                        : activeTask.status === 'failed' ? '任务失败' : '任务已停止'}
                    </b>
                    {activeTask.mock && <span className="wb-insp-tag">演示</span>}
                  </div>
                  <div className="wb-chat-event">
                    {activeTask.status === 'completed'
                      ? (activeTask.mock
                          ? '没有生成新预览，也没有文件变更。'
                          : '已产出视频，可在「产物」页播放。')
                      : latestEvent?.message ?? '没有执行详情。'}
                  </div>
                  <button className="wb-btn-ghost" type="button" onClick={onOpenTask}>查看执行</button>
                  {(activeTask.status === 'failed' || activeTask.status === 'cancelled') && activeRecord?.request && <button className="wb-btn-ghost" type="button" onClick={() => onResumeRequest(activeRecord.request!)}><RotateCcw size={12}/>带回对话继续编辑</button>}
                </div>
              )}

              <div className="wb-demo-line"><i className="wb-demo-dot" />{reviewSaved ? '审阅记录保存在此浏览器' : '本地保存失败 · 请到制作审阅导出备份'}</div>
            </div>
          </div>

          {/* 对话输入：与首页同一张纸片（.fw-sheet），主按钮是胶囊 */}
          <form className="fw-compose" onSubmit={(e) => { e.preventDefault(); void submit() }}>
            <div className="fw-sheet">
              {/* 作用范围独占输入框上方一行：写在按钮旁边会被挤成两行、还会把名字截掉，
                  而它是「AI 到底会动哪一块」的唯一提示 —— 不能被截。 */}
              <div className="wb-compose-scope" title={scopeLabel}>
                作用于 <b>{scopeLabel}</b>
                {/* 版本号本身是入口：用户看到「场景版本 v14」最自然的动作就是点它看历史。
                    没读过场景时也允许点开 —— 面板会说清「还没有场景版本」，比一个死文本有用。 */}
                <button type="button" className="wb-compose-version" onClick={onOpenVersions}
                        title="查看场景版本历史与回退">
                  {sceneVersionLabel ?? '查看场景版本'}
                </button>
              </div>
              <textarea className="wb-input" rows={3} ref={inputRef}
                        value={chat.draft} onChange={(e) => chat.setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
                        placeholder={target.kind === 'project' ? '补充创作要求，或描述希望调整的内容…' : `描述「${scopeShort}」要改哪里、保留什么…`} />
              {keepNotes && <button type="button" className="wb-keep-summary" onClick={() => onOpenReview('brief')} title={keepNotes}>始终保留：{keepNotes}</button>}
              <button type="button" className="wb-compose-brief-link" onClick={() => onOpenReview('brief')}>查看制作要求与后续纠正 <ArrowUpRight size={11}/></button>
              {enabledConstraints.length > 0 && (
                <div className="wb-compose-constraints">
                  <span>约束：{enabledConstraints.map(([, label]) => label).join(' · ')}</span>
                  <button type="button" onClick={() => setSideTab('settings')}>修改约束 ›</button>
                </div>
              )}
              {/* 真实修改的错误提示：留在输入区上方而不是自动消失的 notice，
                  因为「刚才为什么没改成功」是用户要继续处理的信息。 */}
              {realModifyError && (
                <div className="wb-compose-error">
                  <span>{realModifyError}</span>
                  <button type="button" onClick={onClearRealModifyError} title="关闭"><X className="size-3" /></button>
                </div>
              )}

              <div className="mt-1.5 flex items-center gap-2">
                <button className="iconbtn" type="button" title="上传还没接通" disabled><Plus /></button>
                {/* 能力边界必须写在入口旁：用户会默认「能对话就能随便改」，
                    实际只认「把文字改成 X」「文字/背景颜色改成 X」两种说法。 */}
                <span className="wb-compose-capability" title="当前仅支持修改文字与颜色；其它要求会被明确拒绝，不会瞎改">
                  仅支持文字 / 颜色
                </span>
                <button className="mini mini-ghost" type="button"
                        onClick={() => { const v = chat.draft.trim(); if (v) onDemoSubmit(v) }}
                        disabled={!chat.draft.trim()}
                        title="不调用后端，本地演示执行过程与界面反馈">
                  演示
                </button>
                <button className="mini mini-strong" type="submit"
                        disabled={!chat.draft.trim() || realModifyBusy}>
                  <Send className="size-3" />{realModifyBusy ? '提交中…' : activeLive ? '排队记录' : '提交修改'}
                </button>
              </div>
            </div>
          </form>
        </>
      ) : sideTab === 'task' ? (
        <TaskPanel activeTask={activeTask} records={records} cancelTask={cancelTask}
                   scope={scope} constraints={constraints}
                   onResumeRequest={onResumeRequest} onBack={onBackFromTask} />
      ) : (
        <div className="fw-scroll">
          <div className="flex flex-col gap-3 p-3.5">
            <div className="flex items-center gap-2">
              <button className="wb-btn-ghost wb-insp-back" type="button" onClick={() => setSideTab('chat')}>
                <ChevronLeft className="size-3" />返回对话
              </button>
              <span className="fw-panel-title">修改设置</span>
            </div>
            <div className="fw-scene-hd">修改作用范围</div>
            <SegmentedControl value={scope} onChange={onScopeChange}
                              ariaLabel="修改作用范围"
                              className="fw-scope-seg"
                              options={[
                                ...(preview ? [{ value: 'selection' as const, label: '当前预览' }] : []),
                                { value: 'project', label: '整个项目' },
                              ]} />

            <div className="wb-sep" />
            <button type="button" className="wb-desk-secondary" onClick={() => onOpenReview('brief')}>编辑特别保留要求 <ArrowUpRight size={12}/></button><div className="fw-scene-hd">保留条件</div>
            {CONSTRAINT_LABELS.map(([key, label]) => {
              /* 真实修改暂不执行这些约束：禁用而不是让人勾上然后静默忽略。
                 勾了却不生效，用户会以为改动受到了保护。 */
              const supported = REAL_MODIFY_SUPPORTED_CONSTRAINTS.has(key)
              return (
                <div key={key} className="fw-constraint-row" data-unsupported={!supported || undefined}
                     title={supported ? undefined : '当前仅支持修改文字与颜色，该保留条件暂不生效'}>
                  <span>{label}</span>
                  <Switch checked={constraints[key]} disabled={!supported}
                          aria-label={label}
                          onCheckedChange={(checked) => setConstraints((c) => ({ ...c, [key]: checked }))} />
                </div>
              )
            })}
            <div className="wb-constraint-note">
              当前只支持「不修改其他场景」；其余保留条件暂不生效，已禁用。
            </div>

            <div className="wb-sep" />
            <div className="fw-scene-hd">快捷操作</div>
            <div className="grid grid-cols-3 gap-1.5">
              {quickActions.filter((a) => !['undo', 'redo', 'compare', 'assets', 'camera', 'captions'].includes(a.id)).map((a) => (
                <button key={a.id} type="button" onClick={() => onQuickAction(a)}
                        className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-md border border-line bg-hole p-1 text-center text-[10px] text-dim transition-colors hover:border-acc/60 hover:text-fg">
                  <a.icon className="size-3.5" />{a.label}
                </button>
              ))}
            </div>

            <div className="wb-sep" />
            <div className="fw-scene-hd">预览来源</div>
            <div className="rounded-md border border-line bg-hole p-2.5 text-[10.5px] leading-relaxed text-dim">
              {preview ? `${preview.tierLabel} · ${preview.name} · ${preview.origin === 'editor' ? '编辑版本' : '工作流'} v${preview.revision}` : '当前项目还没有生成可查看的预览。'}
            </div>
            <button className="mini h-7 justify-start text-[11px]" type="button" onClick={() => onNavigate('render')}>
              <ArrowUpRight className="size-3" />打开渲染与交付
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}

/* ── 右栏：场景检查器（次级视图）────────────────────────────
   场景是编辑对象，AI 只是它的一个动作。这里把「改哪一场、这一场是什么、
   当前参数/约束/引用/执行状态」放在一处；默认右栏是对话。 */
function ReferenceChips({ references, defaultLabel, onRemoveReference, onLocateReference,
  onToggleReferenceRole, onClearReferences }:
  { references: AgentReference[]; defaultLabel: string
    onRemoveReference: (id: string) => void; onLocateReference: (ref: AgentReference) => void
    onToggleReferenceRole: (id: string) => void; onClearReferences: () => void }) {
  return (
    <div className="fw-ref-chips">
      {references.length === 0
        ? <span className="fw-ref-empty">{defaultLabel}</span>
        : references.map((ref) => (
          <span key={ref.id} className="fw-ref-chip" data-role={ref.role}>
            <button className="fw-ref-role" type="button" title={ref.kind === 'preview' && !ref.source.workflowId && ref.source.origin !== 'editor' ? '参考资料仅作为上下文' : '切换目标/上下文'} disabled={ref.kind === 'preview' && !ref.source.workflowId && ref.source.origin !== 'editor'}
                    onClick={() => onToggleReferenceRole(ref.id)}>{ref.role === 'target' ? '目标' : '上下文'}</button>
            <button className="fw-ref-label" type="button" title="定位到引用"
                    onClick={() => onLocateReference(ref)}>{ref.label}</button>
            <button type="button" title="移除引用" onClick={() => onRemoveReference(ref.id)}>×</button>
          </span>
        ))}
      {references.length > 0 && <button className="fw-ref-clear" type="button" onClick={onClearReferences}>清空</button>}
    </div>
  )
}

/* ── 右栏：当前任务 ─────────────────────────────────────────── */
function TaskPanel({ activeTask, records, cancelTask, scope, constraints, onBack, onResumeRequest }:
  { activeTask: AgentTask | null; records: TaskRecord[]; cancelTask: (id: string) => void
    scope: 'project'|'scene'|'selection'; constraints: ModificationConstraints
    onBack: () => void; onResumeRequest: (request: TaskRequest) => void }) {
  const record = activeTask ? records.find((r) => r.task.id === activeTask.id) : null
  /* 作用范围只说「当前场景」：原来拼的是 `场景 · s01`，又把数据层 id 露出来了。 */
  const recordedConstraints = record?.request?.constraints ?? constraints
  const recordedScope = record?.request?.scope ?? scope
  const scopeLabel = recordedScope === 'project' ? '整个项目' : recordedScope === 'scene' ? '当前场景' : '所选范围'
  return (
    <div className="fw-scroll">
      <div className="flex flex-col gap-3 p-3.5">
        <button className="wb-btn-ghost wb-insp-back" type="button" onClick={onBack}>
          <ChevronLeft className="size-3" />返回
        </button>
        <div className="fw-scene-hd">当前任务</div>
        {activeTask ? (
          <div className="fw-task-card">
            <div className="flex items-center gap-2">
              {(activeTask.status === 'queued' || activeTask.status === 'running' || activeTask.status === 'building')
                ? <LoaderCircle className="size-3 animate-spin text-acc" />
                : <span className="fm-dot" data-s={activeTask.status === 'completed' ? 'done' : activeTask.status === 'failed' ? 'failed' : 'idle'} />}
              <b>{activeTask.title}</b>
              <span className="fw-count ml-auto">{TASK_STATUS_LABEL[activeTask.status] ?? activeTask.status}</span>
            </div>
            {record?.events.slice(-5).map((e) => (
              <div key={e.id} className="mt-1.5 text-[10.5px] text-dim">· {e.message}</div>
            ))}
            {(activeTask.status === 'queued' || activeTask.status === 'running' || activeTask.status === 'building') && (
              <button className="mini mt-2 h-6 px-2 text-[10.5px]" type="button" onClick={() => cancelTask(activeTask.id)}>
                <Square className="size-2.5" />停止任务
              </button>
            )}
          </div>
        ) : (
          <div className="fw-tray-empty">没有正在执行的任务。</div>
        )}
        <div className="wb-sep" />
        <RequestSnapshot request={record?.request}/>
        {record?.request && activeTask && ['failed', 'cancelled'].includes(activeTask.status) && <button type="button" className="wb-btn-ghost" onClick={() => onResumeRequest(record.request!)}><RotateCcw size={12}/>带回对话继续编辑</button>}
        <div className="fw-scene-hd">发送时的作用范围</div>
        <div className="fw-chips"><span className="fw-chip">{scopeLabel}</span></div>
        <div className="fw-scene-hd">保留条件</div>
        {record?.modify ? (
          /* 真实修改：如实说「本次没有提交保留条件」。
             不能拿界面当前的约束顶替 —— 那是用户此刻的勾选状态，
             不是这次任务实际发送的内容，展示出来等于编一份没发生的请求。 */
          <div className="wb-insp-kv"><span>本次未提交保留约束</span><b>不保留</b></div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {CONSTRAINT_LABELS.map(([key, label]) => (
              <span key={key} className="wb-insp-kv"><span>{label}</span><b>{recordedConstraints[key] ? '保留' : '不保留'}</b></span>
            ))}
          </div>
        )}
        {record?.modify && (
          <>
            <div className="fw-scene-hd">本次实际提交</div>
            <div className="flex flex-col gap-1.5">
              <span className="wb-insp-kv"><span>基于场景版本</span><b>v{record.modify.baseVersion}</b></span>
              <span className="wb-insp-kv"><span>目标场景</span><b>{record.modify.sceneIds.length > 0 ? record.modify.sceneIds.join('、') : '整片'}</b></span>
            </div>
            <div className="wb-constraint-note">
              当前只支持修改文字或颜色，暂不支持参考定位与保留约束。
            </div>
          </>
        )}
        <div className="wb-sep" />
        <div className="text-[10.5px] leading-relaxed text-dim">
          任务 ≠ 质量验收。完成只代表这次执行结束，是否接受还要看变更与验证。
        </div>
      </div>
    </div>
  )
}

/* ── 底部任务面板 ───────────────────────────────────────────── */
function BottomTray({ previews, onPreview, workflowLog, records, rounds, activeId, onCancel, tab, setTab }:
  { previews: StageVisual[]; onPreview: (visual: StageVisual) => void; workflowLog: ReactNode; records: TaskRecord[]; rounds: RoundSummary[]; activeId: string | null; onCancel: (id: string) => void
    tab: 'activity'|'changes'|'versions'; setTab: (t: 'activity'|'changes'|'versions') => void }) {
  /* 底部托盘的 Agent 状态同样读真实探测，不再写死「离线」。 */
  const trayProbe = useHarnesses()
  const trayAgent = availabilityOf(trayProbe, 'deepseek').state
  const trayReady = trayAgent === 'available'
  return (
    <div className="fw-tray">
      <div className="fw-tray-hd">
        <SegmentedControl value={tab} onChange={setTab} ariaLabel="执行与版本"
                          className="fw-tray-seg"
                          options={[
                            { value: 'activity', label: '执行过程' },
                            { value: 'changes', label: '变更审阅' },
                            { value: 'versions', label: '预览记录' },
                          ]} />
        <span className="spacer" />
        <span className="num tray-note" title={trayReady ? 'Agent 已连接' : 'Agent 未连接'}>
          {trayReady ? '已连接' : trayAgent === 'checking' ? '检测中' : '未连接'}
        </span>
      </div>
      <div className="fw-scroll">
        <div className="fw-tray-body">
          {tab === 'activity' && workflowLog}
          {tab === 'activity' && (records.length === 0
            ? <div className="fw-tray-empty">还没有修改请求。</div>
            : <div className="flex flex-col gap-0.5">
                {records.map((r) => (
                  <div key={r.task.id} className="fw-tray-row" data-status={r.task.status}>
                    <span className="num">{r.task.createdAt}</span>
                    <span className="tray-msg">{r.events.at(-1)?.message ?? r.task.title}</span>
                    <span className="fw-count">{TASK_STATUS_LABEL[r.task.status] ?? r.task.status}</span>
                    {activeId === r.task.id && ['queued', 'running', 'building'].includes(r.task.status) && (
                      <button className="iconbtn" type="button" title="停止" onClick={() => onCancel(r.task.id)}>
                        <Square className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
          )}
          {tab === 'changes' && (
            <div className="wb-changes">
              {/* 先如实说清「为什么没有文件变更」：不是功能坏了，是演示执行器不写文件。
                  这一栏能给的是每一轮真实提交了什么、与上一轮比改了什么。 */}
              <p className="wb-changes-note">
                <FileCode2 className="size-3 shrink-0" />
                没有文件变更记录：演示执行器不写文件、不产成片。下面记的是每一轮的输入，以及它和上一轮的差异。
              </p>
              {rounds.length === 0
                ? <div className="fw-tray-empty">还没有提交过修改意见。</div>
                : rounds.map((round, index) => {
                  const changed = round.deltas.filter((delta) => delta.changed && delta.key !== 'prompt')
                  const added = round.constraintsAdded.map((key) => CONSTRAINT_LABEL_MAP[key] ?? key)
                  const removed = round.constraintsRemoved.map((key) => CONSTRAINT_LABEL_MAP[key] ?? key)
                  return (
                    <div key={round.id} className="wb-round">
                      <div className="wb-round-hd">
                        <b>第 {rounds.length - index} 轮</b>
                        {round.preview?.revision !== undefined && (
                          <span className="wb-round-ver">
                            {round.preview.origin === 'editor' ? '编辑版本' : '工作流'} v{round.preview.revision}
                          </span>
                        )}
                        <span className="num">{new Date(round.createdAt).toLocaleString('zh-CN')}</span>
                        <span className="wb-round-on">保留 {round.constraintsOn.length} 项</span>
                      </div>
                      <p className="wb-round-prompt" title={round.prompt}>{round.prompt}</p>
                      <p className="wb-round-scale">
                        针对 {round.preview ? round.preview.label : '整个项目'}
                        {round.contextCount > 0 ? ` · 上下文引用 ${round.contextCount} 条` : ''}
                      </p>
                      <p className="wb-round-diff">
                        {round.isFirstRound
                          ? '第一轮：没有上一轮可比'
                          : changed.length === 0
                            ? '与上一轮相比：输入没有变化'
                            : `与上一轮相比：${changed.map((delta) => `${DELTA_LABEL[delta.key]} ${delta.before} → ${delta.after}`).join(' ｜ ')}`}
                        {added.length > 0 && ` ｜ 新增保留：${added.join('、')}`}
                        {removed.length > 0 && ` ｜ 取消保留：${removed.join('、')}`}
                      </p>
                    </div>
                  )
                })}
            </div>
          )}
          {tab === 'versions' && (previews.length === 0 ? <div className="fw-tray-empty">还没有预览版本。执行结束不代表生成了新画面。</div> : <div className="wb-preview-history">{previews.map((visual) => <button type="button" key={visual.id} onClick={() => onPreview(visual)}><Film size={15}/><span><b>{visual.name}</b><small>{visual.tierLabel} · {visual.origin === 'editor' ? '编辑版本' : '工作流'} v{visual.revision} · {new Date(visual.createdAt).toLocaleString('zh-CN')}</small></span><ChevronRight size={14}/></button>)}</div>)}

        </div>
      </div>
    </div>
  )
}

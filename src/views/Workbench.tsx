import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownToLine, ArrowLeftRight, ArrowUpRight, BookOpen, Check,
  ChevronDown, ChevronLeft, Clock3, FileCode2, FileText, FolderOpen, History, ListTree, LoaderCircle, Maximize2, MessagesSquare,
  ShieldCheck,
  PanelBottom, Pause, Play, Plus, RotateCcw, Send, Settings2,
  SkipBack, SkipForward, Square, Volume2, X,
} from 'lucide-react'
import { CreationTaskPanel } from './CreationTask'
import { ACTIVE_SCENES, SCENES } from '@/data/projectModel'
import { PROJECTS, type ProjectSummary } from '@/data/projects'
import type { StoryboardEntry } from '@/data/projectModel'
import { ARTIFACT_STATUS_LABEL, ARTIFACT_TYPE_LABEL, WORKBENCH_ARTIFACTS, type WorkbenchArtifact } from '@/data/workbenchArtifacts'
import { ACTIVE_DURATION, FILM_FPS, FILM_HEIGHT, FILM_WIDTH } from '@/data/timeline'
import { useAgentTasks, type TaskRecord } from '@/hooks/useAgentTasks'
import type { AgentReference, AgentTask, ModificationConstraints, ProjectVersion, TaskRequest } from '@/services/studioApi'
import { studioAdapter } from '@/services/studioAdapter'
import { evaluateGate, GATE_PRIMARY_KIND, workflowService } from '@/services/workflowService'
import { GATE_DEFS } from '@/data/workflowTemplates'
import type { ChatState } from '@/shell/useChat'
import { statusOf } from '@/shell/status'
import { FilmPlayer, type PlayerRef } from '@/remotion/FilmPlayer'
import { StoryTimeline } from '@/views/StoryTimeline'
import { RemotionEditPanel, RemotionEditPreview } from '@/views/RemotionEditPanel'
import type { EditableShotSettings } from '@/remotion/EditableShot'
import { defaultShotSettings, loadShotOverrides, saveShotOverrides, type ShotOverrideMap } from '@/data/shotOverrides'
import type { ViewId } from '@/shell/views'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ViewSwitch } from '@/components/ViewSwitch'
import { EditParamsIcon, FrameRefIcon, RangeRefIcon, RegionRefIcon } from '@/components/icons/WorkbenchActionIcons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'

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

/** 项目里实际存在的那份成片。演示适配器不改它，只播放/下载。 */
const EXISTING_FILM_SOURCE = './media/token-full-legacy.mp4'

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

const TASK_STATUS_LABEL: Record<string, string> = {
  queued: '排队中', running: '执行中', building: '构建中',
  completed: '已完成', cancelled: '已停止', failed: '失败',
}

type ConstraintKey = 'preserveCamera' | 'preserveCaptions' | 'limitToSelection' | 'reuseExistingComponents'

const CONSTRAINT_LABELS: Array<[ConstraintKey, string]> = [
  ['preserveCamera', '保留当前机位运动'],
  ['preserveCaptions', '保留字幕与配音'],
  ['limitToSelection', '不修改其他场景'],
  ['reuseExistingComponents', '尽量复用现有组件'],
]

const MOTION_LABEL: Record<EditableShotSettings['motion'], string> = {
  rise: '上浮', fade: '淡入', scale: '缩放',
}

const quickActions = [
  { id: 'undo', label: '撤销', icon: RotateCcw, prompt: '撤销上一次修改。' },
  { id: 'redo', label: '重做', icon: RotateCcw, prompt: '重做上一次修改。' },
  { id: 'compare', label: '对比版本', icon: ArrowLeftRight, compare: true },
  { id: 'camera', label: '锁定机位', icon: Settings2, constraint: 'preserveCamera' as const },
  { id: 'captions', label: '保留字幕', icon: Check, constraint: 'preserveCaptions' as const },
  { id: 'assets', label: '替换素材', icon: Plus, constraint: 'attachment' as const },
  { id: 'duration', label: '调整时长', icon: Clock3, prompt: '调整当前场景时长。请先询问目标时长。' },
  { id: 'resolution', label: '修改分辨率', icon: Settings2, prompt: '调整项目分辨率。请先询问目标分辨率。' },
  { id: 'regenerate', label: '重做当前场景', icon: ArrowUpRight, prompt: '重新生成当前场景，保留现有机位运动和字幕。' },
]

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
  const playerRef = useRef<PlayerRef | null>(null)
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
  type Decision = { wfId: string; id: string; title: string; hint: string; detail: string }
  const [workflowsSnapshot, setWorkflowsSnapshot] = useState(() => workflowService.listWorkflows())
  const decisions = useMemo(() => {
    if (!projectId) return []
    const out: Decision[] = []
    workflowsSnapshot
      .filter((w) => w.projectId === projectId)
      .forEach((w) => {
        w.nodes.forEach((n) => {
          if (n.type === 'review') {
            const c = (n.params.checks ?? {}) as Record<string, boolean>
            if (c.done || c.rework) return
            out.push({
              wfId: w.id, id: n.id, title: '看片与修改',
              hint: '对着预览给出结论：通过，或指出要改的地方',
              detail: '结论会写进工作流的看片节点，后续制作按它执行。',
            })
          }
          if (n.type === 'gate') {
            if (n.params.rework) return
            const ev = evaluateGate(w, n)
            if (ev.decision !== 'pending') return
            out.push({
              wfId: w.id, id: n.id, title: ev.label,
              hint: ev.blocked.length ? ev.blocked.join('；') : '等待你确认',
              detail: GATE_DEFS[String(n.params.gate ?? '')]?.question ?? '确认这一层的产物是否成立。',
            })
          }
        })
      })
    return out
  }, [projectId, workflowsSnapshot])
  const decideNode = (wfId: string, nodeId: string, verdict: 'done' | 'rework') => {
    const target = workflowService.getWorkflow(wfId)
    if (!target || !target.nodes.some((n) => n.id === nodeId)) return
    workflowService.saveWorkflow(target.id, {
      nodes: target.nodes.map((n) => {
        if (n.id !== nodeId) return n
        if (n.type === 'review') {
          return { ...n, params: { ...n.params, checks: { ...(n.params.checks as Record<string, boolean> | undefined), [verdict]: true }, decidedAt: new Date().toISOString() } }
        }
        const primaryKind = GATE_PRIMARY_KIND[String(n.params.gate ?? '')] ?? ''
        const primary = target.nodes.find((m) => m.type === 'artifact' && String(m.params.kind ?? '') === primaryKind)
        return { ...n, params: verdict === 'done'
          ? { ...n.params, decision: 'confirmed', confirmedFor: { kind: primaryKind, version: String(primary?.params.version ?? '') }, decidedAt: new Date().toISOString() }
          : { ...n.params, decision: 'not-started', rework: true, decidedAt: new Date().toISOString() } }
      }),
      edges: target.edges,
    })
    if (workflow && workflow.id === target.id) refreshWorkflow()
    setWorkflowsSnapshot(workflowService.listWorkflows())
    setNotice(verdict === 'done' ? '已确认，记录到工作流。' : '已标记需要修改。')
  }
  const [selectedId, setSelectedId] = useState('s01')
  const [selectedStoryboardId, setSelectedStoryboardId] = useState<string | null>(null)
  // 调试直达：?artifact=artifact-content-contract 直接打开产物只读视图。
  const initialArtifact = new URLSearchParams(window.location.search).get('artifact')
  const [railTab, setRailTab] = useState<'structure' | 'artifacts'>(initialArtifact ? 'artifacts' : 'structure')
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(initialArtifact)
  const [editMode, setEditMode] = useState(new URLSearchParams(window.location.search).get('edit') === '1')
  const [shotOverrides, setShotOverrides] = useState<ShotOverrideMap>(() => loadShotOverrides(projectId))
  const [savedAt, setSavedAt] = useState('')
  const [references, setReferences] = useState<AgentReference[]>([])
  const [regionMode, setRegionMode] = useState(false)
  const [regionRect, setRegionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [regionBox, setRegionBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const regionStart = useRef<{ sx: number; sy: number; mx: number; my: number } | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const playerBoxRef = useRef<HTMLDivElement | null>(null)
  const [frame, setFrame] = useState(INITIAL_FRAME)
  const [playerReady, setPlayerReady] = useState(false)
  const initialSeekDone = useRef(false)
  const frameRef = useRef(frame)
  frameRef.current = frame
  const resumeFrameRef = useRef(INITIAL_FRAME)
  const [framePulse, setFramePulse] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [previewRate, setPreviewRate] = useState(1)
  const [scope, setScope] = useState<'project'|'scene'|'selection'>('scene')
  const [constraints, setConstraints] = useState<ModificationConstraints>({
    preserveCamera: true, preserveCaptions: true, limitToSelection: true, reuseExistingComponents: true,
  })
  const initialPanel = new URLSearchParams(window.location.search).get('panel')
  // 默认打开「场景」检查器，而不是对话 —— AI 修改是一个显式动作，不是首屏主角。
  const [sideTab, setSideTab] = useState<SideTab>(
    initialPanel === 'scene' || initialPanel === 'chat' || initialPanel === 'task' || initialPanel === 'edit' || initialPanel === 'settings'
      ? initialPanel as SideTab
      : 'scene')
  const [bottomTab, setBottomTab] = useState<'activity'|'changes'|'versions'>('activity')
  const [trayOpen, setTrayOpen] = useState(false)
  const [compare, setCompare] = useState(false)
  const [compareSplit, setCompareSplit] = useState(50)
  const [railOpen, setRailOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [switchOpen, setSwitchOpen] = useState(false)
  const switchRef = useRef<HTMLDivElement | null>(null)
  const selectedScene = useMemo(() => SCENES.find((s) => s.id === selectedId) ?? SCENES[0], [selectedId])
  const selectedArtifact = useMemo(() => WORKBENCH_ARTIFACTS.find((a) => a.id === selectedArtifactId) ?? null, [selectedArtifactId])
  const currentShotSettings = useMemo<EditableShotSettings>(() => shotOverrides[selectedId] ?? defaultShotSettings(selectedScene), [selectedId, selectedScene, shotOverrides])
  useEffect(() => {
    if (!saveShotOverrides(projectId, shotOverrides)) return
    if (Object.keys(shotOverrides).length === 0) { setSavedAt(''); return }
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
  }, [projectId, shotOverrides])
  // Player 初始在 0s；加载完成后主动跳到代表帧，避免首屏是一块黑场画布。
  useEffect(() => {
    if (!playerReady || initialSeekDone.current) return
    initialSeekDone.current = true
    playerRef.current?.seekTo(INITIAL_FRAME)
  }, [playerReady])
  // 从 Remotion 编辑态返回监看时，Player 会重新挂载在 0s；恢复到进入编辑前的播放头。
  useEffect(() => {
    if (editMode) { resumeFrameRef.current = frameRef.current; return }
    const timer = window.setTimeout(() => playerRef.current?.seekTo(resumeFrameRef.current), 0)
    return () => window.clearTimeout(timer)
  }, [editMode])
  // A2 §7：切片段时监看画面 opacity/scale 轻入场，不重挂 Player。
  useEffect(() => {
    setFramePulse(false)
    const raf = window.requestAnimationFrame(() => setFramePulse(true))
    const timer = window.setTimeout(() => setFramePulse(false), 420)
    return () => { window.cancelAnimationFrame(raf); window.clearTimeout(timer) }
  }, [selectedId])
  const storyboard = selectedStoryboardId && selectedScene.storyboard?.段 !== selectedStoryboardId
    ? null : selectedScene.storyboard
  const selectedVersion = studioAdapter.versions()[0]
  const totalFrames = Math.round(ACTIVE_DURATION * FILM_FPS)

  const selectScene = (id: string, storyboardId?: string | null) => {
    setSelectedId(id)
    setSelectedStoryboardId(storyboardId ?? null)
    setSelectedArtifactId(null)
    setEditMode(false)
    setReferences([])
    setRailTab('structure')
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
    setSelectedArtifactId(null)
    setEditMode(true)
    setSideTab('edit')
  }
  const closeEdit = () => {
    setEditMode(false)
    setSideTab('chat')
  }
  const applyShotSettings = (settings: EditableShotSettings) => {
    setShotOverrides((old) => ({ ...old, [selectedId]: settings }))
  }
  const resetShotSettings = () => {
    setShotOverrides((old) => { const copy = { ...old }; delete copy[selectedId]; return copy })
  }
  const seek = (nextFrame: number) => {
    const next = Math.max(0, Math.min(totalFrames - 1, Math.round(nextFrame)))
    playerRef.current?.seekTo(next)
    setFrame(next)
    const clip = [...ACTIVE_SCENES].reverse().find((item) => next / FILM_FPS >= item.start)
    if (clip) { setSelectedId(clip.id); setSelectedStoryboardId(clip.storyboardId) }
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
  const currentShotRef = useMemo<AgentReference>(() => ({
    id: `shot:${selectedId}`, role: 'target', kind: 'shot', shotId: selectedId,
    label: selectedScene.label,
  }), [selectedId, selectedScene.label])
  const currentProjectRef = useMemo<AgentReference>(() => ({
    id: `project:${projectId}`, role: 'target', kind: 'project', projectId,
    label: `整个项目 · ${project.name}`,
  }), [projectId, project.name])
  const scopeFromReferences = (refs: AgentReference[]): TaskRequest['scope'] => {
    const target = refs.find((ref) => ref.role === 'target')
    if (!target || target.kind === 'project' || target.kind === 'artifact') return 'project'
    return 'scene'
  }
  const setTargetReference = (ref: AgentReference) => {
    setScope(ref.kind === 'project' || ref.kind === 'artifact' ? 'project' : 'scene')
    setReferences((old) => [ref, ...old.filter((item) => item.role !== 'target')])
  }
  /** 从场景检查器显式进入 AI 修改：把本场设为目标，再打开对话。 */
  const openChatForScene = () => {
    setScope('scene')
    setTargetReference(currentShotRef)
    setEditMode(false)
    setSideTab('chat')
  }
  const openTaskRecords = () => { setEditMode(false); setSideTab('task') }
  /** 切换右栏页签时退出 Remotion 编辑态，避免「参数 → 场景」后监看器仍停在编辑预览。 */
  const selectSideTab = (next: SideTab) => {
    if (editMode && next !== 'edit') setEditMode(false)
    setSideTab(next)
  }
  const addContextReference = (ref: AgentReference) => {
    setReferences((old) => old.some((item) => item.id === ref.id) ? old : [...old, ref])
  }
  const removeReference = (id: string) => setReferences((old) => old.filter((item) => item.id !== id))
  const clearReferences = () => setReferences([])
  const locateReference = (ref: AgentReference) => {
    if (ref.kind === 'artifact') { setSelectedArtifactId(ref.artifactId); setRailTab('artifacts'); return }
    if (ref.kind === 'project') { setSelectedArtifactId(null); setRailTab('structure'); return }
    const clip = ACTIVE_SCENES.find((item) => item.id === ref.shotId)
    if (!clip) return
    setSelectedId(ref.shotId)
    setSelectedStoryboardId(clip.storyboardId)
    setSelectedArtifactId(null)
    setEditMode(false)
    setRailTab('structure')
    const targetFrame = ref.kind === 'frame' || ref.kind === 'region'
      ? ref.frame
      : ref.kind === 'range'
        ? ref.startFrame
        : clip.startFrame + scenePreviewOffset(clip.durationFrames)
    resumeFrameRef.current = targetFrame
    playerRef.current?.seekTo(targetFrame)
    setFrame(targetFrame)
  }
  const toggleReferenceRole = (id: string) => {
    setReferences((old) => old.map((ref) => ref.id === id
      ? { ...ref, role: ref.role === 'target' ? 'context' : 'target' } as AgentReference
      : ref))
  }
  const referenceFrame = () => {
    const tc = formatTime(frame / FILM_FPS)
    setTargetReference({
      id: `frame:${selectedId}:${frame}`, role: 'target', kind: 'frame', shotId: selectedId,
      frame, timecode: tc, label: `第 ${frame} 帧`,
    })
  }
  const referenceRange = () => {
    const clip = ACTIVE_SCENES.find((item) => item.id === selectedId)
    const startFrame = clip?.startFrame ?? Math.round((selectedScene.start ?? 0) * FILM_FPS)
    const endFrame = startFrame + (clip?.durationFrames ?? Math.round(selectedScene.duration * FILM_FPS)) - 1
    setTargetReference({
      id: `range:${selectedId}:${startFrame}:${endFrame}`, role: 'target', kind: 'range',
      shotId: selectedId, startFrame, endFrame,
      timecode: `${formatTime(startFrame / FILM_FPS)}–${formatTime(endFrame / FILM_FPS)}`,
      label: '本场时段',
    })
  }
  const referenceRegion = (bbox: { x: number; y: number; w: number; h: number }) => {
    setTargetReference({
      id: `region:${selectedId}:${frame}:${bbox.x.toFixed(2)}:${bbox.y.toFixed(2)}:${bbox.w.toFixed(2)}:${bbox.h.toFixed(2)}`,
      role: 'target', kind: 'region', shotId: selectedId, frame, bbox,
      label: `画面区域 ${Math.round(bbox.w * 100)}×${Math.round(bbox.h * 100)}%`,
    })
  }
  const referenceArtifact = (artifact: WorkbenchArtifact) => {
    addContextReference({
      id: `artifact:${artifact.id}:${artifact.version}`, role: 'context', kind: 'artifact',
      artifactId: artifact.id, version: artifact.version, label: `${artifact.title} · ${artifact.version}`,
    })
  }
  /** 实际视频显示矩形：stage 可能留白，Player 还会因 16:9 产生 letterbox。 */
  const mediaRect = () => {
    const box = playerBoxRef.current?.getBoundingClientRect()
    if (!box) return null
    const aspect = FILM_WIDTH / FILM_HEIGHT
    let width = box.width
    let height = width / aspect
    if (height > box.height) { height = box.height; width = height * aspect }
    return {
      left: box.left + (box.width - width) / 2,
      top: box.top + (box.height - height) / 2,
      width, height,
    }
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
  const endRegion = () => {
    if (!regionMode) return
    if (regionBox && regionBox.w > 0.01 && regionBox.h > 0.01) referenceRegion(regionBox)
    regionStart.current = null
    setRegionMode(false)
    setRegionRect(null)
    setRegionBox(null)
  }
  const submit = (prompt: string, kind: TaskRequest['kind'] = 'modify') => {
    const requestRefs = references.some((ref) => ref.role === 'target') ? references : [currentShotRef, ...references]
    const derivedScope = scopeFromReferences(requestRefs)
    const sceneIds = derivedScope === 'project' ? [] : [selectedId]
    const request: TaskRequest = { kind, prompt, scope: derivedScope, sceneIds, references: requestRefs, constraints, attachments: [] }
    const id = tasks.start(request)
    chat.addUserMessage(prompt, id)
    setBottomTab('activity')
    setTrayOpen(true)
  }
  const runQuickAction = (action: (typeof quickActions)[number]) => {
    if (action.compare) { setCompare((v) => !v); return }
    if (action.constraint === 'attachment') { setNotice('素材上传还没接通。'); return }
    if (action.constraint) {
      const enabled = !constraints[action.constraint]
      setConstraints((old) => ({ ...old, [action.constraint as keyof ModificationConstraints]: enabled }))
      submit(`快捷约束：${action.label}（${enabled ? '开启' : '关闭'}）`)
      return
    }
    if (action.id === 'undo' || action.id === 'redo') {
      setNotice('没有可撤销的修改。')
      return
    }
    if (action.prompt) submit(action.prompt)
  }
  const playToggle = () => {
    if (playing) playerRef.current?.pause()
    else playerRef.current?.play()
    setPlaying((v) => !v)
  }

  return (
    <div className="wb-a2 flex h-full min-h-0 flex-col" data-mode="dark">

      {/* ═══ 基岛：顶栏 ═════════════════════════════════════════ */}
      <div className="wb-projectbar">
        <ToolButton label="返回我的创作" onClick={onBack}><ChevronLeft /></ToolButton>
        <button className="mini fw-mobile" type="button" title="场景列表"
                onClick={() => setRailOpen((v) => !v)}>
          <PanelBottom className="size-3.5" />
        </button>
        <span className="wb-logo" aria-hidden="true">W</span>
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
          <span className="wb-crumb-scene" title={selectedScene.label}>{selectedScene.label}</span>
        </div>
        <span className="wb-spacer" />
        <div className="wb-top-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="wb-agent-status" type="button" aria-label="离线：Agent 与渲染未连接">
                <span className="wb-agent-dot" />离线
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>还没接 Agent 和渲染。提交只会记录，不会真的改项目文件。</TooltipContent>
          </Tooltip>
          <span className="wb-divider" />
          <ToolButton label="撤销（Ctrl+Z）" onClick={() => runQuickAction(quickActions[0])}><RotateCcw /></ToolButton>
          <ToolButton label="重做（Ctrl+Shift+Z）" onClick={() => runQuickAction(quickActions[1])}><RotateCcw className="scale-x-[-1]" /></ToolButton>
          <span className="wb-divider" />
          <ToolButton label="生成历史" onClick={() => { setBottomTab('versions'); setTrayOpen(true) }}><History /></ToolButton>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="wb-export" type="button" disabled={!playerReady}
                      onClick={() => {
                        const a = document.createElement('a')
                        a.href = EXISTING_FILM_SOURCE; a.download = 'token-full-legacy.mp4'; a.click()
                        setNotice('已下载当前成片。')
                      }}>
                <ArrowDownToLine className="size-3.5" />导出
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>下载当前成片。</TooltipContent>
          </Tooltip>
        </div>
        {/* 与对话视图右上角同一个切换器（styles/view-switch.css）：工作台是当前视图，
            对话可一键切回，消除“进了工作台就回不去会话”的单向门 */}
        <ViewSwitch current="workbench" onSwitch={(target) => { if (target === 'conversation') onNavigate('conversation') }} />
      </div>

      {/* ═══ 三栏（paba .fw 网格）══════════════════════════════ */}
      <div className="fw relative">
        {railOpen && <button className="fw-scrim" aria-label="收起场景列表" onClick={() => setRailOpen(false)} />}

        <ProjectRail projectName={project.name}
                     open={railOpen} onClose={() => setRailOpen(false)}
                     tab={railTab} onTab={setRailTab}
                     selectedArtifactId={selectedArtifactId} onSelectArtifact={selectArtifact}
                     references={references}
                     onRemoveReference={removeReference} onLocateReference={locateReference}
                     onToggleReferenceRole={toggleReferenceRole} onClearReferences={clearReferences}
                     decisions={decisions} onDecide={decideNode}
                     workflowId={workflow?.id ?? null}
                     onOpenWorkflowEditor={onOpenWorkflowEditor}
                     creation={launch ? (
                       <CreationTaskPanel
                         workflowId={launch.workflowId}
                         autoRun={launch.autoRun}
                         onOpenEditor={() => onOpenWorkflowEditor?.(launch.workflowId)}
                         onClose={() => onDismissLaunch?.()}
                       />
                     ) : undefined} />

        {/* 中栏：监看器 */}
        <main className="fw-canvas">
          <div className="fw-toolbar">
            {selectedArtifact ? (
              <>
                <span className="wb-viewer-index">产物</span>
                <h2 className="wb-viewer-title truncate">{selectedArtifact.title}</h2>
                <span className="wb-status" data-status={selectedArtifact.status}>
                  {ARTIFACT_STATUS_LABEL[selectedArtifact.status]}
                </span>
                <span className="spacer" />
                <span className="wb-viewer-meta">{ARTIFACT_TYPE_LABEL[selectedArtifact.type]} · {selectedArtifact.version} · 只读预览</span>
              </>
            ) : (
              <>
                {/* 原来这里挂一个场景编号徽标（S01）。那是数据层 id —— 场景号
                    在左侧列表里已经编好，舞台只要显示画面名就够。 */}
                <h2 className="wb-viewer-title truncate">{selectedScene.label}</h2>
                <span className="wb-status" data-status={statusOf(selectedScene.status).s}>
                  <span className="fm-dot" data-s={statusOf(selectedScene.status).s} />
                  {statusOf(selectedScene.status).label}
                </span>
                {!selectedScene.inTimeline && <span className="wb-status" data-status="waiting">未纳入当前版本</span>}
                <span className="wb-spacer" />
                <ShotActionBar
                  onFrame={referenceFrame} onRange={referenceRange}
                  onRegion={() => { setRegionMode((v) => !v); setRegionRect(null) }}
                  regionMode={regionMode} editMode={editMode}
                  onEdit={openEdit}
                />
              </>
            )}
          </div>

          {selectedArtifact ? (
            <ArtifactView artifact={selectedArtifact}
                          onLocate={(id) => selectScene(id)}
                          onReference={() => referenceArtifact(selectedArtifact)}
                          onClose={() => setSelectedArtifactId(null)} />
          ) : editMode ? (
            <>
              <div className="fw-stage fw-stage-edit">
                <RemotionEditPreview settings={currentShotSettings} poster={selectedScene.frame ?? undefined} />
                <div className="fw-edit-hint">实时预览</div>
              </div>
              <ShotActionBar
                onFrame={referenceFrame} onRange={referenceRange}
                onRegion={() => { setRegionMode((v) => !v); setRegionRect(null) }}
                regionMode={regionMode} editMode={editMode}
                onEdit={closeEdit}
              />
            </>
          ) : (
            <>
              {/* 舞台：paba .fw-stage */}
              <div className="fw-stage" ref={stageRef}>
                {!compare ? (
                  <div className={`fw-media-fit${framePulse ? ' chg' : ''}`} ref={playerBoxRef}>
                    <FilmPlayer onPlayer={(p) => { playerRef.current = p }} onFrame={setFrame} onReady={setPlayerReady} />
                    <span className="wb-frame-badge num">16:9 · {FILM_FPS}fps</span>
                    <div className="wb-frame-cap">
                      <div className="wb-frame-cap-t">{selectedScene.label}</div>
                      {/* 原来还有一行「00:00:00 · 3.9s」：时间码紧挨着的播放条
                          已经实时显示（而且这场就是从 00:00:00 起，写出来等于没说），
                          时长在下面的场景列表和右栏检查器里都有。字幕只留场景名。 */}
                    </div>
                  </div>
                ) : (
                  <div className="relative flex size-full overflow-hidden bg-black">
                    <div className="relative h-full overflow-hidden" style={{ width: `${compareSplit}%` }}>
                      <img src={selectedScene.frame ?? './frames/u01.jpg'} alt="项目抽帧"
                           className="absolute inset-0 size-full object-contain" />
                      <span className="absolute left-2 top-2 bg-black/75 px-1.5 py-1 text-[10px]">已存画面</span>
                    </div>
                    <div className="relative h-full flex-1 overflow-hidden border-l border-acc">
                      <FilmPlayer onPlayer={(p) => { playerRef.current = p }} onFrame={setFrame} onReady={setPlayerReady} />
                      <span className="wb-compare-tag">当前影片</span>
                    </div>
                    <input aria-label="调整对比画面分割" type="range" min={25} max={75} value={compareSplit}
                           onChange={(e) => setCompareSplit(Number(e.target.value))}
                           className="absolute bottom-2 left-2 z-20 w-[calc(100%-16px)] accent-[var(--acc)]" />
                  </div>
                )}
                {!playerReady && (
                  <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-md border border-warn/30 bg-surf px-2 py-1 text-[11px] text-warn">
                    <LoaderCircle className="size-3 animate-spin" />正在加载项目影片
                  </div>
                )}
                {notice && (
                  <button className="absolute bottom-3 right-3 z-20 max-w-[75%] rounded-md border border-warn/30 bg-surf px-2 py-1 text-[10px] text-warn"
                          onClick={() => setNotice('')}>
                    {notice}<X className="ml-1 inline size-3" />
                  </button>
                )}
                {regionMode && (
                  <div className="fw-region-layer" onPointerDown={startRegion} onPointerMove={moveRegion} onPointerUp={endRegion}>
                    <div className="fw-region-hint">拖拽框选画面区域</div>
                    {regionRect && <div className="fw-region-box" style={{ left: `${regionRect.x * 100}%`, top: `${regionRect.y * 100}%`, width: `${regionRect.w * 100}%`, height: `${regionRect.h * 100}%` }} />}
                  </div>
                )}
              </div>

              <PlayerBar playerRef={playerRef} frame={frame} onSeek={seek} playing={playing}
                         onToggle={playToggle} rate={previewRate} onRate={setPreviewRate} totalFrames={totalFrames} />

              <div className="tl-wrap">
                <StoryTimeline selectedId={selectedId} onSelect={selectScene} activeFrame={frame} onSeek={seek} />
              </div>

              {trayOpen && (
                <BottomTray records={tasks.records} activeId={tasks.active?.task.id ?? null}
                            onCancel={tasks.cancel} tab={bottomTab} setTab={setBottomTab} />
              )}
            </>
          )}
        </main>

        {/* 右栏：对话 / 设置 */}
        <RightPanel chat={chat} sideTab={sideTab} setSideTab={selectSideTab}
                    scope={scope}
                    scene={selectedScene} storyboard={storyboard}
                    onOpenChat={openChatForScene} onOpenTask={openTaskRecords}
                    constraints={constraints} setConstraints={setConstraints}
                    activeTask={tasks.active?.task ?? null} cancelTask={tasks.cancel}
                    records={tasks.records} onSubmit={submit} onQuickAction={runQuickAction}
                    onNavigate={onNavigate} selectedVersion={selectedVersion}
                    editSettings={currentShotSettings} editSavedAt={savedAt}
                    editOverridden={!!shotOverrides[selectedId]}
                    references={references} onRemoveReference={removeReference}
                    onLocateReference={locateReference} onToggleReferenceRole={toggleReferenceRole}
                    onClearReferences={clearReferences} onScopeChange={(next) => { setScope(next); setTargetReference(next === 'project' ? currentProjectRef : currentShotRef) }}
                    onApplyEdit={applyShotSettings} onResetEdit={resetShotSettings}
                    onCloseEdit={closeEdit} onOpenEdit={openEdit} />
      </div>

      {/* ═══ 基岛：状态栏（独立胶囊，不铺整条底板）═══════════════ */}
      <div className="wb-statusbar">
        <span className="wb-status-chip">
          <i className="wb-status-dot" data-s={tasks.active ? 'running' : 'ok'} />
          {tasks.active ? (TASK_STATUS_LABEL[tasks.active.task.status] ?? tasks.active.task.status) : '就绪'}
        </span>
        <button className="wb-status-chip is-btn" type="button" aria-pressed={trayOpen}
                onClick={() => setTrayOpen((v) => !v)}>
          <PanelBottom className="size-3" />{trayOpen ? '收起任务面板' : '任务面板'}
          {tasks.active?.task ? ` · ${tasks.active.task.title}` : ''}
        </button>
        {/* 只留总时长：场数在左栏「场景结构 N 场」已经报过一次，
            这里再说一遍就是同一件事写两处。 */}
        <span className="wb-status-chip">总时长 {fmtSec(ACTIVE_DURATION)}</span>
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

function ProjectRail({ projectName, open, onClose, tab, onTab,
  selectedArtifactId, onSelectArtifact, references,
  onRemoveReference, onLocateReference, onToggleReferenceRole, onClearReferences,
  decisions, onDecide, workflowId, onOpenWorkflowEditor, creation }:
  { projectName: string; open: boolean; onClose: () => void
    tab: 'structure' | 'artifacts'; onTab: (tab: 'structure' | 'artifacts') => void
    selectedArtifactId: string | null; onSelectArtifact: (id: string) => void
    references: AgentReference[]
    onRemoveReference: (id: string) => void; onLocateReference: (ref: AgentReference) => void
    onToggleReferenceRole: (id: string) => void; onClearReferences: () => void
    decisions: { wfId: string; id: string; title: string; hint: string; detail: string }[]
    onDecide: (wfId: string, nodeId: string, verdict: 'done' | 'rework') => void
    workflowId: string | null
    onOpenWorkflowEditor?: (workflowId: string) => void
    creation?: ReactNode }) {
  /* 牌堆交互（无大卡片）：牌堆态与列表态是同一批卡片节点在两种形态间切换。
     牌堆态：下方 ‹ › 切换最前卡（循环，中间带计数），点主卡散开成列表；
     列表态：每张小卡右侧 › 键开弹窗看详情、做结论，控制区只剩聚拢键；
     形态切换用 FLIP（切换前量位置、切换后反向位移再过渡回自然位置），
     与切换动效同一套过渡（transform/背景/阴影/标题色）。
     卡片尺寸固定：小卡高度写死、内容裁切（标题单行省略、提示最多两行），
     最前卡矮、后层卡长时也不再从牌堆底下漏字。 */
  const [leaving, setLeaving] = useState<{ id: string; verdict: 'done' | 'rework' } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [frontId, setFrontId] = useState<string | null>(null)
  const [modal, setModal] = useState<{ d: (typeof decisions)[number]; source: 'stack' | 'list' } | null>(null)
  const leavingTimer = useRef<number | null>(null)
  const removingTimer = useRef<number | null>(null)
  const deckRef = useRef<HTMLDivElement | null>(null)
  const flipSnap = useRef<{ rects: Map<string, { left: number; top: number }>; height: number } | null>(null)
  useEffect(() => () => {
    if (leavingTimer.current) window.clearTimeout(leavingTimer.current)
    if (removingTimer.current) window.clearTimeout(removingTimer.current)
  }, [])
  useEffect(() => {
    if (!modal) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModal(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])
  const effectiveFrontId = frontId && decisions.some((d) => d.id === frontId) ? frontId : null
  const frontIndex = effectiveFrontId ? decisions.findIndex((d) => d.id === effectiveFrontId) : 0
  const ordered = effectiveFrontId
    ? [...decisions.filter((d) => d.id === effectiveFrontId), ...decisions.filter((d) => d.id !== effectiveFrontId)]
    : decisions
  const stepFront = (dir: 1 | -1) => {
    if (decisions.length <= 1) return
    setFrontId(decisions[(frontIndex + dir + decisions.length) % decisions.length].id)
  }
  const shown = listOpen ? ordered : ordered.slice(0, 3)
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
  const decideFromModal = (verdict: 'done' | 'rework') => {
    if (!modal || leaving || removing) return
    const { d, source } = modal
    setModal(null)
    if (source === 'list') {
      setRemoving(d.id)
      removingTimer.current = window.setTimeout(() => { onDecide(d.wfId, d.id, verdict); setRemoving(null) }, 220)
    } else {
      setLeaving({ id: d.id, verdict })
      leavingTimer.current = window.setTimeout(() => { onDecide(d.wfId, d.id, verdict); setLeaving(null) }, 280)
    }
  }
  return (
    <aside className="fw-ing" data-open={open ? '' : undefined} aria-label="镜头库与产物">
      {creation}
      <div className="fw-ing-hd">
        <h2>{tab === 'structure' ? '概览' : '产物'}</h2>
        <span className="fw-count">{tab === 'structure'
          ? `${decisions.length + references.length} 项`
          : `${WORKBENCH_ARTIFACTS.length}`}</span>
        <span className="spacer" />
        <button className="iconbtn fw-mobile" type="button" title="收起" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>

      <SegmentedControl value={tab} onChange={onTab} ariaLabel="工作区导航"
                        className="fw-rail-seg"
                        options={[{ value: 'structure', label: '结构' }, { value: 'artifacts', label: '产物' }]} />

      {tab === 'artifacts' ? (
        <div className="fw-artifacts" role="tabpanel">
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
        </div>
      ) : (
        <div className="fw-ing-list">
          <section>
            <div className="fw-scene-hd">
              <span>待你决定</span><span className="spacer" />
              <span className="hint">{decisions.length}</span>
            </div>
            {decisions.length === 0 ? (
              <p className="fw-rail-none">这一轮的事都已定下，可以继续下一轮制作。</p>
            ) : (
              /* 多条决定：牌堆态（小卡叠放，圆点选最前）与列表态（向下排列）
                 共用同一批卡片节点；详情只在弹窗里，不再有展开的大卡片。 */
              <>
              <div className={`fw-deck${listOpen ? ' is-list' : ''}`} ref={deckRef}>
                {shown.map((d, i) => {
                  const front = !listOpen && i === 0
                  return (
                    <div key={d.id} data-id={d.id} className="fw-rail-decision fw-deck-card"
                         data-pos={listOpen ? undefined : i}
                         data-leaving={leaving?.id === d.id || undefined}
                         data-removing={removing === d.id || undefined}
                         aria-hidden={!listOpen && !front ? true : undefined}
                         onClick={!listOpen && front ? () => toggleList(true) : undefined}>
                      <span className="fm-dot" data-s="waiting" />
                      <span className="fw-rail-decision-main">
                        <b>{d.title}</b>
                        <small>{d.hint}</small>
                      </span>
                      <button type="button" className="fw-deck-marker" aria-label={`查看${d.title}详情`}
                              onClick={(e) => { e.stopPropagation(); setModal({ d, source: listOpen ? 'list' : 'stack' }) }}>›</button>
                    </div>
                  )
                })}
              </div>
              <div className="fw-deck-controls">
                {listOpen ? (
                  <button type="button" className="fw-deck-gather" onClick={() => toggleList(false)}>聚拢 ↑</button>
                ) : (
                  <span className="fw-deck-switch">
                    <button type="button" className="fw-deck-switch-btn" aria-label="上一张"
                            disabled={decisions.length <= 1} onClick={() => stepFront(-1)}>‹</button>
                    <span className="fw-deck-switch-count">{frontIndex + 1} / {decisions.length}</span>
                    <button type="button" className="fw-deck-switch-btn" aria-label="下一张"
                            disabled={decisions.length <= 1} onClick={() => stepFront(1)}>›</button>
                  </span>
                )}
              </div>
              {modal && (
                <div className="fw-modal-backdrop" onClick={() => setModal(null)}>
                  <div className="fw-modal" role="dialog" aria-modal="true" aria-label={`${modal.d.title}详情`} onClick={(e) => e.stopPropagation()}>
                    <div className="fw-modal-head">
                      <span className="fm-dot" data-s="waiting" />
                      <span className="fw-rail-decision-main"><b>{modal.d.title}</b><small>{modal.d.hint}</small></span>
                      <button type="button" className="fw-modal-close" aria-label="关闭" onClick={() => setModal(null)}>×</button>
                    </div>
                    <p className="fw-modal-detail">{modal.d.detail}</p>
                    <div className="fw-rail-decision-acts">
                      <button type="button" className="fw-decide-btn" data-kind="done" onClick={() => decideFromModal('done')}>通过</button>
                      <button type="button" className="fw-decide-btn" data-kind="rework" onClick={() => decideFromModal('rework')}>要改</button>
                    </div>
                    <button type="button" className="fw-rail-decision-more"
                            onClick={() => { setModal(null); if (workflowId) onOpenWorkflowEditor?.(workflowId) }}>打开工作流查看详情</button>
                  </div>
                </div>
              )}
              </>
            )}
          </section>

          <section>
            <div className="fw-scene-hd">
              <span>引用</span><span className="spacer" />
              <span className="hint">{references.length}</span>
            </div>
            <ReferenceChips references={references}
                            defaultLabel="引用此帧 / 引用本场 / 框选画面区域 会加到这里"
                            onRemoveReference={onRemoveReference}
                            onLocateReference={onLocateReference}
                            onToggleReferenceRole={onToggleReferenceRole}
                            onClearReferences={onClearReferences} />
          </section>

        </div>
      )}

      <div className="fw-ing-footer">{projectName}</div>
    </aside>
  )
}

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

/* ── 预览下方动作条：图标 + Tooltip ─────────────────────────── */
function ShotActionBar({ onFrame, onRange, onRegion, regionMode, editMode, onEdit }: {
  onFrame: () => void; onRange: () => void; onRegion: () => void
  regionMode: boolean; editMode: boolean; onEdit: () => void
}) {
  return (
    <div className="fw-actionbar" aria-label="场景操作">
      <ToolButton label="引用此帧" onClick={onFrame}><FrameRefIcon size={20} /></ToolButton>
      <ToolButton label="引用本场" onClick={onRange}><RangeRefIcon size={20} /></ToolButton>
      <ToolButton label="框选画面区域（加入引用）" onClick={onRegion} active={regionMode}><RegionRefIcon size={20} /></ToolButton>
      <span className="fw-actionbar-sep" />
      <ToolButton label={editMode ? '退出编辑' : '编辑画面参数'}
                  onClick={onEdit} active={editMode}><EditParamsIcon size={20} /></ToolButton>
    </div>
  )
}

/* ── 播放条 ─────────────────────────────────────────────────── */
function PlayerBar({ playerRef, frame, onSeek, playing, onToggle, rate, onRate, totalFrames }:
  { playerRef: React.RefObject<PlayerRef | null>; frame: number; onSeek: (n: number) => void
    playing: boolean; onToggle: () => void; rate: number; onRate: (n: number) => void; totalFrames: number }) {
  return (
    <div className="fw-playbar">
      <button className="iconbtn" type="button" title="上一帧" onClick={() => onSeek(frame - 1)}><SkipBack /></button>
      <button className="iconbtn wb-play-main" type="button" title={playing ? '暂停' : '播放'} onClick={onToggle}>
        {playing ? <Pause /> : <Play />}
      </button>
      <button className="iconbtn" type="button" title="下一帧" onClick={() => onSeek(frame + 1)}><SkipForward /></button>
      <span className="time num">
        {formatTime(frame / FILM_FPS)} <span className="wb-time-dim">/ {formatTime(ACTIVE_DURATION)}</span>
      </span>
      {/* paba .nc-pp-range —— 填充用 --acc，不是 shadcn 的圆头灰轨 */}
      <div className="pp-range">
        <input type="range" min={0} max={totalFrames - 1} step={1} value={frame}
               aria-label="播放进度"
               style={{ '--fill': `${(frame / Math.max(1, totalFrames - 1)) * 100}%` } as React.CSSProperties}
               onChange={(e) => onSeek(Number(e.target.value))} />
      </div>
      <div className="fw-zoom">
        <button type="button" disabled={rate <= 0.5} onClick={() => onRate(Math.max(0.5, rate - 0.5))} title="减速">−</button>
        <span className="num w-9 text-center">{rate}×</span>
        <button type="button" disabled={rate >= 2} onClick={() => onRate(Math.min(2, rate + 0.5))} title="加速">+</button>
      </div>
      <button className="iconbtn" type="button" title="切换静音"
              onClick={() => { const p = playerRef.current; if (p) p.setVolume(p.getVolume() ? 0 : 1) }}>
        <Volume2 />
      </button>
      <button className="iconbtn" type="button" title="全屏"
              onClick={() => playerRef.current?.requestFullscreen()}><Maximize2 /></button>
    </div>
  )
}

/* ── 右栏：对话 / 修改设置 ──────────────────────────────────── */
function RightPanel({ chat, sideTab, setSideTab, scope, scene, storyboard,
  onOpenChat, onOpenTask,
  constraints, setConstraints, activeTask, cancelTask, records, onSubmit, onQuickAction,
  onNavigate, selectedVersion, editSettings, editSavedAt, editOverridden, references, onRemoveReference,
  onLocateReference, onToggleReferenceRole, onClearReferences, onScopeChange,
  onApplyEdit, onResetEdit, onCloseEdit, onOpenEdit }:
  { chat: ChatState; sideTab: SideTab; setSideTab: (v: SideTab) => void
    scope: 'project'|'scene'|'selection'
    scene: (typeof SCENES)[number]
    storyboard: StoryboardEntry | null; onOpenChat: () => void; onOpenTask: () => void
    constraints: ModificationConstraints
    setConstraints: React.Dispatch<React.SetStateAction<ModificationConstraints>>
    activeTask: AgentTask | null; cancelTask: (id: string) => void; records: TaskRecord[]
    onSubmit: (p: string) => void; onQuickAction: (a: (typeof quickActions)[number]) => void
    onNavigate: (v: ViewId) => void; selectedVersion: ProjectVersion
    editSettings: EditableShotSettings; editSavedAt: string; editOverridden: boolean
    references: AgentReference[]; onRemoveReference: (id: string) => void
    onLocateReference: (ref: AgentReference) => void; onToggleReferenceRole: (id: string) => void
    onClearReferences: () => void; onScopeChange: (next: 'project'|'scene'|'selection') => void
    onApplyEdit: (settings: EditableShotSettings) => void; onResetEdit: () => void
    onCloseEdit: () => void; onOpenEdit: () => void }) {
  const submit = () => { const v = chat.draft.trim(); if (v) { onSubmit(v); chat.setDraft('') } }

  return (
    <aside className="fw-panel" aria-label="场景检查器与 AI 修改">
      <div className="fw-ing-hd fw-panel-hd">
        <SegmentedControl value={sideTab === 'settings' || sideTab === 'task' ? '' : sideTab}
                          onChange={(next) => next === 'edit' ? onOpenEdit() : setSideTab(next as SideTab)}
                          ariaLabel="场景与 AI 工作区"
                          className="fw-panel-seg"
                          options={[{ value: 'scene', label: '场景' }, { value: 'chat', label: '对话' }, { value: 'edit', label: '参数' }]} />
        <ToolButton label="修改设置" active={sideTab === 'settings'} onClick={() => setSideTab('settings')}>
          <Settings2 className="size-3.5" />
        </ToolButton>
        {/* 原型：从工作台切回完整对话视图（同一份 useChat 会话） */}
        <ToolButton label="完整对话" onClick={() => onNavigate('conversation')}>
          <MessagesSquare className="size-3.5" />
        </ToolButton>
      </div>

      {sideTab === 'scene' ? (
        <SceneInspector scene={scene} storyboard={storyboard}
                        settings={editSettings} savedAt={editSavedAt} overridden={editOverridden}
                        constraints={constraints} setConstraints={setConstraints}
                        activeTask={activeTask} references={references}
                        onRemoveReference={onRemoveReference} onLocateReference={onLocateReference}
                        onToggleReferenceRole={onToggleReferenceRole} onClearReferences={onClearReferences}
                        onOpenChat={onOpenChat} onOpenEdit={onOpenEdit} onOpenTask={onOpenTask} />
      ) : sideTab === 'chat' ? (
        <>
          <div className="fw-scroll">
            <div className="flex flex-col gap-3 p-3.5">
              {/* 上下文条（paba .fw-ctx）：你在改哪个场景 */}
              <div className="fw-ctx">
                {scene.frame && <img src={scene.frame} alt="" />}
                <div className="min-w-0">
                  <b>{scene.label}</b>

                </div>
              </div>

              {/* 消息：AI 不用气泡，用户用 --soft 底（fm-components §9） */}
              <ReferenceChips references={references}
                              defaultLabel="默认目标：当前场景"
                              onRemoveReference={onRemoveReference}
                              onLocateReference={onLocateReference}
                              onToggleReferenceRole={onToggleReferenceRole}
                              onClearReferences={onClearReferences} />

              <div className="fw-msg">
                <span className="fw-msg-avatar">AI</span>
                <p className="fm-msg-ai">{chat.messages[0]?.text}</p>
              </div>
              {chat.messages.slice(1).map((m) => (
                m.role === 'user'
                  ? <p key={m.id} className="fm-msg-user">{m.text}</p>
                  : (
                    <div key={m.id} className="fw-msg">
                      <span className="fw-msg-avatar">AI</span>
                      <p className="fm-msg-ai">{m.text}</p>
                    </div>
                  )
              ))}

              {storyboard && (
                <div className="wb-chat-block">
                  <p>{storyboard.旁白}</p>
                  <details>
                    <summary>查看画面与动效要求</summary>
                    <p>画面：{storyboard.画面}</p>
                    <p>动效：{storyboard.动效}</p>
                    <p>衔接：{storyboard.衔接}</p>
                  </details>
                </div>
              )}

              {activeTask && (
                <div className="wb-chat-block">
                  <div className="wb-chat-task">
                    <LoaderCircle className="size-3 animate-spin" />
                    <b className="truncate">{activeTask.title}</b>
                    <span className="wb-insp-tag">{TASK_STATUS_LABEL[activeTask.status] ?? activeTask.status}</span>
                  </div>
                  {records.find((r) => r.task.id === activeTask.id)?.events.slice(-3).map((e) => (
                    <div key={e.id} className="wb-chat-event">{e.message}</div>
                  ))}
                  <button className="wb-btn-ghost" type="button" onClick={() => cancelTask(activeTask.id)}>
                    <Square className="size-3" />停止任务
                  </button>
                </div>
              )}

              <div className="wb-demo-line"><i className="wb-demo-dot" />离线 · 提交只记录状态</div>
            </div>
          </div>

          {/* 对话输入：与首页同一张纸片（.fw-sheet），主按钮是胶囊 */}
          <form className="fw-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
            <div className="fw-sheet">
              <textarea className="wb-input" rows={3}
                        value={chat.draft} onChange={(e) => chat.setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                        placeholder="告诉 AI 要如何修改当前场景…" />
              <div className="mt-1.5 flex items-center gap-2">
                <button className="iconbtn" type="button" title="上传还没接通" disabled><Plus /></button>
                <span className="wb-compose-scope">
                  作用范围 · {scope === 'project' ? '整个项目' : scope === 'scene' ? '当前场景' : '所选场景'}
                </span>
                <button className="mini mini-strong" type="submit" disabled={!chat.draft.trim()}>
                  <Send className="size-3" />提交
                </button>
              </div>
            </div>
          </form>
        </>
      ) : sideTab === 'task' ? (
        <TaskPanel activeTask={activeTask} records={records} cancelTask={cancelTask}
                   scope={scope} constraints={constraints}
                   onBack={() => setSideTab('scene')} />
      ) : sideTab === 'edit' ? (
        <RemotionEditPanel settings={editSettings} savedAt={editSavedAt} isOverridden={editOverridden}
                           onApply={onApplyEdit} onReset={onResetEdit} onClose={onCloseEdit} />
      ) : (
        <div className="fw-scroll">
          <div className="flex flex-col gap-3 p-3.5">
            <div className="fw-scene-hd">修改作用范围</div>
            <SegmentedControl value={scope} onChange={onScopeChange}
                              ariaLabel="修改作用范围"
                              className="fw-scope-seg"
                              options={[
                                { value: 'scene', label: '当前场景' },
                                { value: 'selection', label: '所选场景' },
                                { value: 'project', label: '整个项目' },
                              ]} />

            <div className="wb-sep" />
            <div className="fw-scene-hd">保留条件</div>
            {CONSTRAINT_LABELS.map(([key, label]) => (
              <div key={key} className="fw-constraint-row">
                <span>{label}</span>
                <Switch checked={constraints[key]}
                        aria-label={label}
                        onCheckedChange={(checked) => setConstraints((c) => ({ ...c, [key]: checked }))} />
              </div>
            ))}

            <div className="wb-sep" />
            <div className="fw-scene-hd">快捷操作</div>
            <div className="grid grid-cols-3 gap-1.5">
              {quickActions.map((a) => (
                <button key={a.id} type="button" onClick={() => onQuickAction(a)}
                        className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-md border border-line bg-hole p-1 text-center text-[10px] text-dim transition-colors hover:border-acc/60 hover:text-fg">
                  <a.icon className="size-3.5" />{a.label}
                </button>
              ))}
            </div>

            <div className="wb-sep" />
            <div className="fw-scene-hd">预览来源</div>
            <div className="rounded-md border border-line bg-hole p-2.5 text-[10.5px] leading-relaxed text-dim">
              当前播放来源：{selectedVersion.source}。这是固定旧版预览，不是新渲染。
              Remotion Player 包装真实影片播放；原始可编辑合成仍是 HyperFrames HTML/GSAP。
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

/* ── 右栏：场景检查器（默认）────────────────────────────────
   场景是编辑对象，AI 只是它的一个动作。这里把「改哪一场、这一场是什么、
   当前参数/约束/引用/执行状态」放在首屏；对话不再占用默认右栏。 */
function SceneInspector({ scene, storyboard, settings, savedAt, overridden,
  constraints, setConstraints, activeTask, references,
  onRemoveReference, onLocateReference, onToggleReferenceRole, onClearReferences,
  onOpenChat, onOpenEdit, onOpenTask }:
  { scene: (typeof SCENES)[number]
    storyboard: StoryboardEntry | null; settings: EditableShotSettings; savedAt: string; overridden: boolean
    constraints: ModificationConstraints
    setConstraints: React.Dispatch<React.SetStateAction<ModificationConstraints>>
    activeTask: AgentTask | null; references: AgentReference[]
    onRemoveReference: (id: string) => void; onLocateReference: (ref: AgentReference) => void
    onToggleReferenceRole: (id: string) => void; onClearReferences: () => void
    onOpenChat: () => void; onOpenEdit: () => void; onOpenTask: () => void }) {
  const state = statusOf(scene.status)
  const sceneStart = scene.start ?? 0
  const taskDot = activeTask?.status === 'failed' ? 'failed'
    : activeTask?.status === 'completed' ? 'done'
    : activeTask?.status === 'cancelled' ? 'idle' : 'running'

  return (
    <div className="wb-insp">
      <div className="wb-insp-scroll">
      <div className="wb-insp-hero">
        <span className="wb-insp-thumb">
          {scene.frame ? <img src={scene.frame} alt="" /> : <span className="wb-insp-thumb-empty">无帧</span>}
        </span>
        <div className="min-w-0">
          <div className="wb-insp-obj">{scene.label}</div>
          {/* kicker 只留状态。原来还跟着「镜 01」「当前成片」：
              镜号就是左边的场景序号（列表里已经编好），「当前成片」又是默认态，
              两段都是在重复用户已经看得见的东西。 */}
          <div className="wb-insp-kicker">
            <span className="fm-dot" data-s={state.s} />{state.label}
          </div>
        </div>
      </div>

      <section className="wb-insp-section">
        <h3>镜头信息</h3>
        <div className="wb-insp-kv"><span>时间</span><b className="num">{formatTime(sceneStart)} – {formatTime(sceneStart + scene.duration)}</b></div>
        {/* 原来这一行是「时长 / 轨道」+ `3.9s · V1 · {clip.track}`：
            「V1」是写死的轨道名，后面跟的数字又是内部轨道序号（s01=0、s02=1…
            逐镜递增）—— 一个写死的名字加一个内部序号并列，是典型的字段倾倒。 */}
        <div className="wb-insp-kv"><span>时长</span><b>{fmtSec(scene.duration)}</b></div>
        {/* 「计划段 1 · 第1幕」也是把分镜表的内部字段（段/幕）直接倒出来，删掉。 */}
      </section>

      {storyboard && (
        <section className="wb-insp-section">
          <h3>旁白</h3>
          <p className="wb-insp-text">{storyboard.旁白}</p>
        </section>
      )}

      <section className="wb-insp-section">
        <h3>镜头参数</h3>
        <div className="wb-insp-kv"><span>标题</span><b className="truncate" title={settings.title}>{settings.title}</b></div>
        <div className="wb-insp-kv"><span>强调色</span><b><i className="wb-swatch" style={{ background: settings.accent }} />{settings.accent}</b></div>
        <div className="wb-insp-kv"><span>动效</span><b>{MOTION_LABEL[settings.motion]}</b></div>
        {/* 这一行原来还有一个「时长」，与本面板上方「镜头信息」里的时长是同一个数
            （defaultShotSettings 就是按场景时长算的）—— 同一个数不在同一屏写两遍。 */}
        <div className="wb-insp-actions">
          <button className="wb-btn-ghost" type="button" onClick={onOpenEdit}><Settings2 />编辑参数</button>
          {overridden && <span className="wb-insp-tag">{savedAt ? `本地已存 ${savedAt}` : '本地已覆盖'}</span>}
        </div>
        {/* 原来这里有一句「仅覆盖标题层样例参数；写入本地 override，不写服务端。」
            —— 在跟用户交代实现（override 存哪、写不写服务端），不是在说产品，删掉。 */}
      </section>

      <details className="wb-insp-details">
        <summary>
          <span>修改约束</span>
        </summary>
        <div className="wb-insp-details-body">
          {CONSTRAINT_LABELS.map(([key, label]) => (
            <div className="fw-constraint-row" key={key}>
              <span>{label}</span>
              <Switch checked={constraints[key]} aria-label={label}
                      onCheckedChange={(checked) => setConstraints((c) => ({ ...c, [key]: checked }))} />
            </div>
          ))}
        </div>
      </details>

      <section className="wb-insp-section">
        <h3>Agent 引用</h3>
        <ReferenceChips references={references}
                        defaultLabel="默认目标：本场"
                        onRemoveReference={onRemoveReference}
                        onLocateReference={onLocateReference}
                        onToggleReferenceRole={onToggleReferenceRole}
                        onClearReferences={onClearReferences} />
      </section>

      <section className="wb-insp-section">
        <h3>执行</h3>
        {activeTask ? (
          <div className="wb-insp-task">
            <span className="fm-dot" data-s={taskDot} />
            <b className="truncate">{activeTask.title}</b>
            <span className="wb-insp-tag">{TASK_STATUS_LABEL[activeTask.status] ?? activeTask.status}</span>
          </div>
        ) : (
          <p className="wb-insp-note">没有正在执行的任务。</p>
        )}
        <div className="wb-insp-actions">
          <button className="wb-btn-ghost" type="button" onClick={onOpenTask}><PanelBottom />任务记录</button>
        </div>
      </section>
      </div>

      <div className="wb-insp-foot">
        <button className="wb-btn-primary" type="button" onClick={onOpenChat}><Send />让 AI 修改本场</button>
      </div>
    </div>
  )
}

/** 引用 chips：对话与场景检查器共用同一组状态，避免两处行为分叉。 */
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
            <button className="fw-ref-role" type="button" title="切换目标/上下文"
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
function TaskPanel({ activeTask, records, cancelTask, scope, constraints, onBack }:
  { activeTask: AgentTask | null; records: TaskRecord[]; cancelTask: (id: string) => void
    scope: 'project'|'scene'|'selection'; constraints: ModificationConstraints
    onBack: () => void }) {
  const record = activeTask ? records.find((r) => r.task.id === activeTask.id) : null
  /* 作用范围只说「当前场景」：原来拼的是 `场景 · s01`，又把数据层 id 露出来了。 */
  const scopeLabel = scope === 'project' ? '整个项目' : scope === 'scene' ? '当前场景' : '所选场景'
  return (
    <div className="fw-scroll">
      <div className="flex flex-col gap-3 p-3.5">
        <button className="wb-btn-ghost wb-insp-back" type="button" onClick={onBack}>
          <ChevronLeft className="size-3" />返回场景
        </button>
        <div className="fw-scene-hd">当前任务</div>
        {activeTask ? (
          <div className="fw-task-card">
            <div className="flex items-center gap-2">
              <LoaderCircle className="size-3 animate-spin text-acc" />
              <b>{activeTask.title}</b>
              <span className="fw-count ml-auto">{TASK_STATUS_LABEL[activeTask.status] ?? activeTask.status}</span>
            </div>
            {record?.events.slice(-5).map((e) => (
              <div key={e.id} className="mt-1.5 text-[10.5px] text-dim">· {e.message}</div>
            ))}
            <button className="mini mt-2 h-6 px-2 text-[10.5px]" type="button" onClick={() => cancelTask(activeTask.id)}>
              <Square className="size-2.5" />停止任务
            </button>
          </div>
        ) : (
          <div className="fw-tray-empty">没有正在执行的任务。</div>
        )}
        <div className="wb-sep" />
        <div className="fw-scene-hd">作用范围</div>
        <div className="fw-chips"><span className="fw-chip">{scopeLabel}</span></div>
        <div className="fw-scene-hd">保留条件</div>
        <div className="flex flex-col gap-1.5">
          {CONSTRAINT_LABELS.map(([key, label]) => (
            <span key={key} className="wb-insp-kv"><span>{label}</span><b>{constraints[key] ? '保留' : '不保留'}</b></span>
          ))}
        </div>
        <div className="wb-sep" />
        <div className="text-[10.5px] leading-relaxed text-dim">
          任务 ≠ 质量验收。完成只代表这次执行结束，是否接受还要看变更与验证。
        </div>
      </div>
    </div>
  )
}

/* ── 底部任务面板 ───────────────────────────────────────────── */
function BottomTray({ records, activeId, onCancel, tab, setTab }:
  { records: TaskRecord[]; activeId: string | null; onCancel: (id: string) => void
    tab: 'activity'|'changes'|'versions'; setTab: (t: 'activity'|'changes'|'versions') => void }) {
  return (
    <div className="fw-tray">
      <div className="fw-tray-hd">
        <SegmentedControl value={tab} onChange={setTab} ariaLabel="执行与版本"
                          className="fw-tray-seg"
                          options={[
                            { value: 'activity', label: '执行过程' },
                            { value: 'changes', label: '变更审阅' },
                            { value: 'versions', label: '版本记录' },
                          ]} />
        <span className="spacer" />
        <span className="num tray-note">离线</span>
      </div>
      <div className="fw-scroll">
        <div className="fw-tray-body">
          {tab === 'activity' && (records.length === 0
            ? <div className="fw-tray-empty">还没有任务。</div>
            : <div className="flex flex-col gap-0.5">
                {records.map((r) => (
                  <div key={r.task.id} className="fw-tray-row" data-status={r.task.status}>
                    <span className="num">{r.task.createdAt}</span>
                    <span className="tray-msg">{r.events.at(-1)?.message ?? r.task.title}</span>
                    <span className="fw-count">{TASK_STATUS_LABEL[r.task.status] ?? r.task.status}</span>
                    {activeId === r.task.id && (
                      <button className="iconbtn" type="button" title="停止" onClick={() => onCancel(r.task.id)}>
                        <Square className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
          )}
          {tab === 'changes' && (
            <div className="fw-tray-empty">
              <FileCode2 className="size-3 shrink-0" />
              还没有文件变更记录。
            </div>
          )}
          {tab === 'versions' && (
            <div className="fw-tray-cards">
              {studioAdapter.versions().map((v) => (
                <div key={v.id} className="fw-card">
                  <div className="fw-card-hd">
                    <FileCode2 className="size-3 text-acc" />{v.name}
                  </div>
                  <div className="fw-card-note">{v.summary}</div>
                  <div className="num fw-card-src">{v.source}</div>
                  <button className="mini mini-s" type="button"
                          disabled={!v.restorable} title="只读">
                    {v.restorable ? '恢复版本' : '只读来源'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** A2 规范：时间码 MM:SS:FF，数字等宽；fps 用项目真实帧率，不冒充 25fps。 */
function formatTime(seconds: number) {
  const totalFrames = Math.max(0, Math.round(seconds * FILM_FPS))
  const m = Math.floor(totalFrames / (FILM_FPS * 60))
  const s = Math.floor(totalFrames / FILM_FPS) % 60
  const f = totalFrames % FILM_FPS
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(m)}:${pad(s)}:${pad(f)}`
}

/** 时长：有真实小数才写（3.9s），整数不挂尾随 .0（152.0s → 152s）。
    「152.0s」这种写法是假精确 —— 没有任何来源能精确到 0.1 秒，
    小数位只是 toFixed(1) 的产物，看起来却像测量结果。 */
function fmtSec(seconds: number) {
  const r = Math.round(seconds * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)}s`
}

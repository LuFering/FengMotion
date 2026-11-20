import type * as React from 'react'
import { useState, useRef, useMemo } from 'react'
import { WORKBENCH_ARTIFACTS } from '@/features/workbench/model/workbenchArtifacts'
import { ACTIVE_DURATION, FILM_FPS } from '@/demo/timeline'
import type { MonitorProblem, MonitorVisualItem } from '@/features/workbench/components/MonitorZones'
import { fmtDay, fmtClock } from '@/shared/lib/status'
import { evaluateGate, type WorkflowDef } from '@/features/workflow/services/workflowService'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import { versionStanding, type ProjectVersionInfo } from '@/features/workbench/model/versionIdentity'
import { useSceneVersions } from '@/features/workbench/hooks/useSceneVersions'
import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import type { ProjectSummary } from '@/features/project/model/projects'
import type { ContentOutline } from '@/features/workbench/model/contentOutline'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { AgentReference } from '@/api/studioApi'

export interface UseVisualSelectionArgs {
  capturedPreview: React.RefObject<{ id: string; image: string } | null>
  catalog: ProjectSummary[]
  outline: ContentOutline
  projectId: WorkbenchProps['projectId']
  projectVersion: ProjectVersionInfo
  references: AgentReference[]
  regionStart: React.RefObject<{ sx: number; sy: number; mx: number; my: number; pointerId: number } | null>
  sceneVersions: ReturnType<typeof useSceneVersions>
  selectedArtifactId: string | null
  sessionDraft: ReturnType<typeof useSessionDraft>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPreviewDuration: React.Dispatch<React.SetStateAction<number>>
  setPreviewFailed: React.Dispatch<React.SetStateAction<boolean>>
  setPreviewLocation: React.Dispatch<React.SetStateAction<{ visualId: string; timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>>
  setPreviewReady: React.Dispatch<React.SetStateAction<boolean>>
  setReferences: React.Dispatch<React.SetStateAction<AgentReference[]>>
  setRegionMode: React.Dispatch<React.SetStateAction<boolean>>
  setRegionRect: React.Dispatch<React.SetStateAction<{ x: number; y: number; w: number; h: number } | null>>
  stage: { visuals: StageVisual[]; hasRun: boolean; lastRunStatus: 'none' | 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_info'; requestOnly: boolean }
  stageLead: StageVisual | null
  workflowsSnapshot: WorkflowDef[]
}

/**
 * 监看区正在看的画面：按项目维护画面选择，换画面时撤下旧画面的框选与时间引用；
 * 派生版本状态、渲染元信息与监看区问题清单，另管项目切换菜单的开合。
 */
export function useVisualSelection({ capturedPreview, catalog, outline, projectId, projectVersion, references, regionStart, sceneVersions, selectedArtifactId, sessionDraft, setNotice, setPreviewDuration, setPreviewFailed, setPreviewLocation, setPreviewReady, setReferences, setRegionMode, setRegionRect, stage, stageLead, workflowsSnapshot }: UseVisualSelectionArgs) {
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
  const sceneFilmMeta = useMemo(() => {
    if (viewedPreview?.origin !== 'scene') return null
    const film = sceneVersions.versions.find((version) => version.version === viewedPreview.revision)?.film
    if (!film || typeof film !== 'object') return null
    const output = 'output' in film ? (film.output as { fps?: number } | undefined) : undefined
    const fps = output?.fps ?? ('fps' in film ? (film.fps as number) : undefined)
    const sourceHash = 'sourceHash' in film && typeof film.sourceHash === 'string' ? film.sourceHash : undefined
    return { fps, sourceHash }
  }, [sceneVersions.versions, viewedPreview?.origin, viewedPreview?.revision])
  return { sceneFilmMeta, viewedPreview, viewedStanding, projectName, totalFrames, switchOpen, switchRef, setSwitchOpen, setSelectedVisual, setSelectedStageVisual, selectedArtifact, selectedVisual, monitorProblems }
}

import type * as React from 'react'
import type { SideTab, RailTab } from '@/features/workbench/model/workbenchConsole'
import type { AgentReference, PreviewSource } from '@/api/studioApi'
import { ACTIVE_SCENES } from '@/demo/projectModel'
import { scenePreviewOffset } from '@/features/workbench/model/workbenchSession'
import { formatMediaTime } from '@/features/workbench/model/previewGeometry'
import { versionSeriesOf, type ProjectVersionInfo } from '@/features/workbench/model/versionIdentity'
import { useCallback } from 'react'
import type { WorkbenchArtifact } from '@/features/workbench/model/workbenchArtifacts'
import { useStageTimeRange } from '@/features/workbench/components/StageTimeRange'
import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import type { CapabilityResult, BackendCapabilityInfo } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { ProjectSummary } from '@/features/project/model/projects'
import type { TaskRecord } from '@/features/creation/hooks/useAgentTasks'
import type { MonitorVisualItem } from '@/features/workbench/components/MonitorZones'

export interface UseTargetReferencesArgs {
  /** 实时画面（运行工程源码）正在显示：引用当前帧改为引用时间和帧号 */
  liveFrame: { seconds: number; frame: number; pause: () => void } | null
  aiModifyTargetCapability: CapabilityResult
  backendCapability: BackendCapabilityInfo
  capturedPreview: React.RefObject<{ id: string; image: string } | null>
  editMode: boolean
  previewMediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>
  previewSource: (visual: StageVisual) => PreviewSource
  previewTime: number
  project: ProjectSummary
  projectRecords: TaskRecord[]
  projectVersion: ProjectVersionInfo
  range: ReturnType<typeof useStageTimeRange>
  references: AgentReference[]
  referencesEdited: React.RefObject<boolean>
  regionStart: React.RefObject<{ sx: number; sy: number; mx: number; my: number; pointerId: number } | null>
  resumeFrameRef: React.RefObject<number>
  selectedTaskRecordId: string | null
  sessionDraft: ReturnType<typeof useSessionDraft>
  setCanvasView: React.Dispatch<React.SetStateAction<'monitor' | 'brief' | 'task'>>
  setComparison: React.Dispatch<React.SetStateAction<[StageVisual, StageVisual] | null>>
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>
  setFocusChatKey: React.Dispatch<React.SetStateAction<number>>
  setFrame: React.Dispatch<React.SetStateAction<number>>
  setLoopSpan: React.Dispatch<React.SetStateAction<boolean>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setPreviewLocation: React.Dispatch<React.SetStateAction<{ visualId: string; timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>>
  setRailTab: React.Dispatch<React.SetStateAction<RailTab>>
  setReferences: React.Dispatch<React.SetStateAction<AgentReference[]>>
  setRegionMode: React.Dispatch<React.SetStateAction<boolean>>
  setRegionRect: React.Dispatch<React.SetStateAction<{ x: number; y: number; w: number; h: number } | null>>
  setReviewTab: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedArtifactId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedId: React.Dispatch<React.SetStateAction<string>>
  setSelectedVisual: (item: MonitorVisualItem | null) => void
  setSideTab: React.Dispatch<React.SetStateAction<SideTab>>
  setTargetReference: (ref: AgentReference) => void
  stage: { visuals: StageVisual[]; hasRun: boolean; lastRunStatus: 'none' | 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_info'; requestOnly: boolean }
  stageLead: StageVisual | null
  viewedPreview: StageVisual | null
}

/**
 * 修改意见的引用管理：把当前画面、框选区域或产物加为引用并把目标固化进草稿，支持移除、清空、定位与目标/参考互换。
 * 另含右栏页签切换、聚焦意见输入框和保存当前帧。
 */
export function useTargetReferences({ aiModifyTargetCapability, backendCapability, capturedPreview, editMode, liveFrame, previewMediaRef, previewSource, previewTime, project, projectRecords, projectVersion, range, references, referencesEdited, regionStart, resumeFrameRef, selectedTaskRecordId, sessionDraft, setCanvasView, setComparison, setEditMode, setFocusChatKey, setFrame, setLoopSpan, setNotice, setPanelOpen, setPreviewLocation, setRailTab, setReferences, setRegionMode, setRegionRect, setReviewTab, setSelectedArtifactId, setSelectedId, setSelectedVisual, setSideTab, setTargetReference, stage, stageLead, viewedPreview }: UseTargetReferencesArgs) {
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
  /**
   * 把当前画面（可带框选区域）挂成本轮的修改目标。
   *
   * @param options.label  目标名称（画面元素用元素名，例如「片头标题」），不给就写「框选区域」
   * @param options.intent 强制意图：元素小窗里「交给 AI」就是要改，不沿用草稿里可能残留的「提问」
   * @param options.quiet  不弹提示：调用方紧接着会自己提交，不需要再说「输入意见后发送」
   */
  const referencePreview = (region?: { x: number; y: number; w: number; h: number }, whole = false, options: { label?: string; intent?: 'modify'; quiet?: boolean } = {}) => {
    if (!viewedPreview) return
    /* 实时画面：引用时间和帧号，不附图 —— 能取到的只有上次出片的画面，源码改过之后那张图和眼前的不一样，
       带错图比不带图更误导 */
    if (liveFrame && !whole && !region) {
      if (!aiModifyTargetCapability.allowed) { setNotice(aiModifyTargetCapability.reason || '当前画面无法作为修改目标'); return }
      liveFrame.pause()
      const timeSeconds = liveFrame.seconds
      const id = `preview:${viewedPreview.id}:live:${liveFrame.frame}`
      capturedPreview.current = null
      setPreviewLocation({ visualId: viewedPreview.id, timeSeconds })
      const targetLabel = `${viewedPreview.name} · 实时画面 ${formatMediaTime(timeSeconds)}（第 ${liveFrame.frame} 帧）`
      const targetRef: AgentReference = { id, role: 'target', kind: 'preview', source: previewSource(viewedPreview), timeSeconds, label: targetLabel }
      setTargetReference(targetRef)
      sessionDraft.updateDraft({
        targetSnapshot: {
          version: viewedPreview.revision ?? stageLead?.revision ?? null,
          versionSeries: versionSeriesOf(viewedPreview),
          versionConfirmed: projectVersion.authoritative,
          scope: 'scene', rangeSpan: null, bbox: null, label: targetLabel, previewImage: null,
          references: [targetRef, ...references.filter(r => r.role !== 'target')],
          pinned: true,
          intentAction: options.intent ?? sessionDraft.draft.targetSnapshot?.intentAction ?? sessionDraft.draft.intentAction ?? 'modify',
        },
      })
      focusFeedback()
      if (options.quiet) return targetLabel
      setNotice(`已引用实时画面第 ${liveFrame.frame} 帧，输入意见后发送。`)
      return targetLabel
    }
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
    const targetLabel = `${viewedPreview.name}${timeLabel}${region ? ` · ${options.label ?? '框选区域'}` : ''}`
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
        intentAction: options.intent
          ?? sessionDraft.draft.targetSnapshot?.intentAction
          ?? sessionDraft.draft.intentAction
          ?? 'modify',
      },
    })
    focusFeedback()
    if (options.quiet) return targetLabel
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
  /** 画面元素小窗「交给 AI」：挂上元素区域与当前画面，意图固定为修改；返回目标名称，供调用方确认目标已挂上再提交 */
  const referenceElement = (bbox: { x: number; y: number; w: number; h: number }, label: string) => referencePreview(bbox, false, { label, intent: 'modify', quiet: true })
  const referenceArtifact = (artifact: WorkbenchArtifact) => {
    addContextReference({
      id: `artifact:${artifact.id}:${artifact.version}`, role: 'context', kind: 'artifact',
      artifactId: artifact.id, version: artifact.version, label: `${artifact.title} · ${artifact.version}`,
    })
  }
  return { referenceRegion, referenceElement, focusFeedback, selectSideTab, removeReference, locateReference, toggleReferenceRole, clearReferences, referenceFrame, saveCurrentFrame, referenceArtifact, addContextReference }
}

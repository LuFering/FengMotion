import type * as React from 'react'
import { ACTIVE_SCENES } from '@/demo/projectModel'
import { scenePreviewOffset } from '@/features/workbench/model/workbenchSession'
import { resolveDirectEditTarget, documentContentFingerprint, evaluateDirectEditCapability } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import { readDocuments } from '@/features/scene-editor/services/sceneEditorService'
import { readEditorRenders } from '@/features/scene-editor/services/sceneRender'
import { FILM_FPS } from '@/demo/timeline'
import { useEffect } from 'react'
import { useTimelineManifest } from '@/features/workbench/hooks/target/useTimelineManifest'
import { useVisualSelection } from '@/features/workbench/hooks/stage/useVisualSelection'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { RailTab, SideTab } from '@/features/workbench/model/workbenchConsole'
import type { AgentReference } from '@/api/studioApi'

export interface UseSceneEditEntryArgs {
  directEditCapability: ReturnType<typeof useTimelineManifest>['directEditCapability']
  isHistoricalVersion: ReturnType<typeof useTimelineManifest>['isHistoricalVersion']
  previewMediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>
  projectId: WorkbenchProps['projectId']
  resumeFrameRef: React.RefObject<number>
  sceneFilmMeta: ReturnType<typeof useVisualSelection>['sceneFilmMeta']
  setComparison: React.Dispatch<React.SetStateAction<[StageVisual, StageVisual] | null>>
  setDocumentsTick: React.Dispatch<React.SetStateAction<number>>
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>
  setEditorDocumentId: React.Dispatch<React.SetStateAction<string | null>>
  setEditorNotice: React.Dispatch<React.SetStateAction<string>>
  setFrame: React.Dispatch<React.SetStateAction<number>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setRailOpen: React.Dispatch<React.SetStateAction<boolean>>
  setRailTab: React.Dispatch<React.SetStateAction<RailTab>>
  setReferences: React.Dispatch<React.SetStateAction<AgentReference[]>>
  setRegionMode: React.Dispatch<React.SetStateAction<boolean>>
  setRegionRect: React.Dispatch<React.SetStateAction<{ x: number; y: number; w: number; h: number } | null>>
  setReviewTab: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedArtifactId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedId: React.Dispatch<React.SetStateAction<string>>
  setSideTab: React.Dispatch<React.SetStateAction<SideTab>>
  setSwitchOpen: ReturnType<typeof useVisualSelection>['setSwitchOpen']
  switchOpen: ReturnType<typeof useVisualSelection>['switchOpen']
  switchRef: ReturnType<typeof useVisualSelection>['switchRef']
  totalFrames: ReturnType<typeof useVisualSelection>['totalFrames']
  viewedPreview: ReturnType<typeof useVisualSelection>['viewedPreview']
}

/**
 * 场景选择与直接编辑的进出：选中场景时跳到有画面的代表帧，进入编辑前重新核对画面对应的场景文档，
 * 退出后让文档与画面的一致性重新判定。另管项目切换菜单的点外与 Esc 收起。
 */
export function useSceneEditEntry({ directEditCapability, isHistoricalVersion, previewMediaRef, projectId, resumeFrameRef, sceneFilmMeta, setComparison, setDocumentsTick, setEditMode, setEditorDocumentId, setEditorNotice, setFrame, setNotice, setPanelOpen, setRailOpen, setRailTab, setReferences, setRegionMode, setRegionRect, setReviewTab, setSelectedArtifactId, setSelectedId, setSideTab, setSwitchOpen, switchOpen, switchRef, totalFrames, viewedPreview }: UseSceneEditEntryArgs) {
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
  return { openEdit, closeEdit, selectScene }
}

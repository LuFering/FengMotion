import type * as React from 'react'
import { useMemo, useRef, useEffect } from 'react'
import type { AgentReference, TaskRequest, PreviewSource, ModificationConstraints } from '@/api/studioApi'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import { formatMediaTime } from '@/features/workbench/model/previewGeometry'
import type { TimeSpan } from '@/features/workbench/model/timeRange'
import { versionSeriesOf, type ProjectVersionInfo } from '@/features/workbench/model/versionIdentity'
import type { ContentRow } from '@/features/workbench/model/contentOutline'
import { fmtClock } from '@/shared/lib/status'
import { useStageTimeRange } from '@/features/workbench/components/StageTimeRange'
import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import type { ProjectSummary } from '@/features/project/model/projects'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { SideTab } from '@/features/workbench/model/workbenchConsole'

export interface UseTimeRangeTargetArgs {
  previewMediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>
  previewTime: number
  project: ProjectSummary
  projectId: WorkbenchProps['projectId']
  projectVersion: ProjectVersionInfo
  range: ReturnType<typeof useStageTimeRange>
  references: AgentReference[]
  sessionDraft: ReturnType<typeof useSessionDraft>
  setConstraints: React.Dispatch<React.SetStateAction<ModificationConstraints>>
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>
  setFocusChatKey: React.Dispatch<React.SetStateAction<number>>
  setLoopSpan: React.Dispatch<React.SetStateAction<boolean>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPreviewTime: React.Dispatch<React.SetStateAction<number>>
  setReferences: React.Dispatch<React.SetStateAction<AgentReference[]>>
  setRegionMode: React.Dispatch<React.SetStateAction<boolean>>
  setScope: React.Dispatch<React.SetStateAction<'project' | 'scene' | 'selection'>>
  setSideTab: React.Dispatch<React.SetStateAction<SideTab>>
  setTaskReturnTab: React.Dispatch<React.SetStateAction<SideTab>>
  sideTab: SideTab
  stageLead: StageVisual | null
  viewedPreview: StageVisual | null
}

/** 从 Workbench.tsx 的 Workbench 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useTimeRangeTarget({ previewMediaRef, previewTime, project, projectId, projectVersion, range, references, sessionDraft, setConstraints, setEditMode, setFocusChatKey, setLoopSpan, setNotice, setPreviewTime, setReferences, setRegionMode, setScope, setSideTab, setTaskReturnTab, sideTab, stageLead, viewedPreview }: UseTimeRangeTargetArgs) {
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
  return { previewSource, setTargetReference, currentProjectRef, defaultTarget, scopeFromReferences, clearTimeRange, activeSceneId, selectContentRow, effectiveTarget, openTaskRecords, scopeShort, selectTimeRange }
}

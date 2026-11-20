import type * as React from 'react'
import { useState, useEffect, useMemo } from 'react'
import { parseSequenceManifest, manifestMatches, type SequenceManifest, type SequenceEntry } from '@/features/workbench/model/sequenceManifest'
import { loadVideoTimeline, timelineArtifactPath } from '@/features/workbench/services/videoTimeline'
import { evaluateExecutableLocalTarget } from '@/features/workbench/services/workbenchTargetEvaluator'
import { modifyBlockReason, type ProjectVersionInfo, type VersionStanding } from '@/features/workbench/model/versionIdentity'
import { readDocumentsVersion, readDocuments } from '@/features/scene-editor/services/sceneEditorService'
import { resolveDirectEditTarget, documentContentFingerprint, evaluateTimelineOpsCapability, evaluateTrackClipReferenceCapability, evaluateAiModifyTargetCapability, evaluateDirectEditCapability, type BackendCapabilityInfo } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import { readEditorRenders } from '@/features/scene-editor/services/sceneRender'
import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { AgentReference } from '@/api/studioApi'
import type { StageVisual } from '@/features/workbench/model/stageVisual'

export interface UseTimelineManifestArgs {
  backendCapability: BackendCapabilityInfo
  capturedPreview: React.RefObject<{ id: string; image: string } | null>
  documentsTick: number
  previewDuration: number
  previewFailed: boolean
  previewReady: boolean
  projectId: WorkbenchProps['projectId']
  projectVersion: ProjectVersionInfo
  realModifyBusy: boolean
  realRenderBusy: boolean
  references: AgentReference[]
  remoteCreationBusy: boolean
  sceneFilmMeta: { fps: number | undefined; sourceHash: string | undefined } | null
  sessionDraft: ReturnType<typeof useSessionDraft>
  viewedPreview: StageVisual | null
  viewedStanding: VersionStanding
  workflowRunning: boolean
}

/**
 * 时间线序列清单与修改能力判定：读取并核对当前视频的独立清单，据当前画面与工程版本
 * 评估时间线操作、片段引用、画面/时间段修改与直接编辑是否可用；另存拖动元素条得到的待发调整。
 */
export function useTimelineManifest({ backendCapability, capturedPreview, documentsTick, previewDuration, previewFailed, previewReady, projectId, projectVersion, realModifyBusy, realRenderBusy, references, remoteCreationBusy, sceneFilmMeta, sessionDraft, viewedPreview, viewedStanding, workflowRunning }: UseTimelineManifestArgs) {
  const artifactPath = timelineArtifactPath(projectId, viewedPreview)
  const manifestKey = JSON.stringify([projectId, viewedPreview?.id, artifactPath])
  type ManifestStatus = 'loading' | 'missing' | 'invalid' | 'ready' | 'error'
  const [loaded, setLoaded] = useState<{ key: string; manifest: SequenceManifest | null; status: ManifestStatus; reason?: string } | null>(null)
  const sequenceManifest = loaded?.key === manifestKey ? loaded.manifest : null
  const manifestStatus: ManifestStatus = loaded?.key === manifestKey ? loaded.status : artifactPath ? 'loading' : 'missing'
  const manifestReason = loaded?.key === manifestKey ? loaded.reason : undefined
  const timelineBusy = realModifyBusy || realRenderBusy || remoteCreationBusy || workflowRunning
  /* 拖动元素条得到的待发送调整。它不直接生效：AI 才是改代码的一方。 */
  const [sequenceMovePending, setSequenceMovePending] = useState<
    | { item: SequenceEntry; next: { start: number; duration: number }; brief: string; intent: 'move' | 'trim-start' | 'trim-end'; label?: string }
    | { brief: string; label?: string }
    | null
  >(null)
  useEffect(() => {
    if (!artifactPath || timelineBusy) return
    let active = true
    setLoaded({ key: manifestKey, manifest: null, status: 'loading' })
    void loadVideoTimeline(projectId, artifactPath)
      .then((raw) => {
        const parsed = parseSequenceManifest(raw)
        if (active) setLoaded({ key: manifestKey, manifest: parsed, status: parsed ? 'ready' : 'invalid' })
      })
      .catch((error: unknown) => {
        const status = (error as { httpStatus?: number })?.httpStatus
        if (active) setLoaded({ key: manifestKey, manifest: null,
          status: status === 404 ? 'missing' : status === 422 ? 'invalid' : 'error',
          reason: error instanceof Error ? error.message : '轨道读取失败' })
      })
    return () => { active = false }
  }, [projectId, artifactPath, manifestKey, timelineBusy])
  const timelineManifest = manifestMatches(sequenceManifest, { artifactPath, sourceHash: sceneFilmMeta?.sourceHash, duration: previewDuration })
    ? sequenceManifest
    : null
  /* 参考轨道：清单存在但与当前版本对不上时，仍然展示出来，只是明确标为参考。
     两种情形都必须覆盖，否则时间线会只剩一条成片轨，用户看不到片段：
       · 旧项目尚未保存版本指纹（缺少指纹）
       · 两边都有指纹但不一致（版本已变）
     展示前提是总时长对得上，否则片段位置会画到错误的画面上。 */
  const referenceTimeline = !timelineManifest && sequenceManifest
    && sequenceManifest.artifactPath === artifactPath
    && Math.abs(sequenceManifest.durationSeconds - previewDuration) <= 0.1
    ? sequenceManifest : null
  const timelineFps = timelineManifest?.fps ?? referenceTimeline?.fps ?? sceneFilmMeta?.fps

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
    manifestReason,
    manifestDetail: sequenceManifest?.detail,
    hasManifest: Boolean(sequenceManifest),
    hasSourceHashMatch: Boolean(artifactPath && sequenceManifest?.artifactPath === artifactPath),
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
  return { setSequenceMovePending, directEditCapability, isHistoricalVersion, aiModifyTargetCapability, adjustPendingConfirm, spanModifyCapability, targetEvaluation, timelineFps, timelineManifest, referenceTimeline, trackClipCapability, manifestStatus, sequenceManifest, timelineOpsCapability, sequenceMovePending }
}

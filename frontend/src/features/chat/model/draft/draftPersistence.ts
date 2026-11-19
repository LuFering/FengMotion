import type { DraftAttachment, SessionDraft } from './draftTypes'

export const STORAGE_PREFIX = 'fengmotion:session-draft:v1:'

/** 从本地持久化存储安全恢复纯数据 */
export function loadPersistedDraft(key: string): SessionDraft | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    // 严谨恢复附件：只恢复已上传成功且有 fileId 的可持久化元数据，不恢复裸 File
    const attachments: DraftAttachment[] = Array.isArray(parsed.attachments)
      ? parsed.attachments.map((a: any) => ({
          name: String(a.name || '附件'),
          size: Number(a.size || 0),
          kind: a.kind || 'file',
          source: a.source,
          fileId: a.fileId,
          assetId: a.assetId,
          mimeType: a.mimeType,
          purpose: a.purpose,
          note: a.note,
          refVideoId: a.refVideoId,
          refStart: a.refStart,
          refEnd: a.refEnd,
          refWants: a.refWants,
          fxId: a.fxId,
          fxVersion: a.fxVersion,
        }))
      : []

    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      attachments,
      targetSnapshot: parsed.targetSnapshot ?? null,
      /* 草稿级意图必须一起恢复：只恢复文字、意图回到默认 modify，
         用户刷新后以为还在「提问」，实际发出去会改工程。 */
      intentAction: (parsed.intentAction === 'query' || parsed.intentAction === 'modify') ? parsed.intentAction : undefined,
      continuationScopeMode: (parsed.continuationScopeMode === 'target_required' || parsed.continuationScopeMode === 'whole_confirmed') ? parsed.continuationScopeMode : null,
      pendingSubmission: parsed.pendingSubmission ?? null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    }
  } catch (e) {
    console.warn('[DraftStore] failed to load persisted draft for', key, e)
    return null
  }
}

/** 安全持久化到本地存储（排除 rawFile、临时 object URL 等不可序列化项） */
export function persistDraft(key: string, draft: SessionDraft) {
  try {
    /* 显式选择本身也是草稿；只有文字为空不能丢掉用户的操作意图。 */
    if (!draft.text.trim() && !draft.attachments.length && !draft.targetSnapshot && !draft.pendingSubmission && !draft.continuationScopeMode && !draft.intentAction) {
      localStorage.removeItem(`${STORAGE_PREFIX}${key}`)
      return
    }

    const serializable = {
      text: draft.text,
      targetSnapshot: draft.targetSnapshot,
      intentAction: draft.intentAction,
      continuationScopeMode: draft.continuationScopeMode ?? null,
      pendingSubmission: draft.pendingSubmission,
      updatedAt: draft.updatedAt,
      // 仅持久化有 fileId 或属于 asset/ref/fx 的有效附件元数据，绝不写入未上传的本地 File
      attachments: draft.attachments
        .filter((a) => a.fileId || a.assetId || a.source === 'ref' || a.source === 'fx')
        .map((a) => ({
          name: a.name,
          size: a.size,
          kind: a.kind,
          source: a.source,
          fileId: a.fileId,
          assetId: a.assetId,
          mimeType: a.mimeType,
          purpose: a.purpose,
          note: a.note,
          refVideoId: a.refVideoId,
          refStart: a.refStart,
          refEnd: a.refEnd,
          refWants: a.refWants,
          fxId: a.fxId,
          fxVersion: a.fxVersion,
        })),
    }

    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(serializable))
  } catch (e) {
    console.warn('[DraftStore] failed to persist draft for', key, e)
  }
}

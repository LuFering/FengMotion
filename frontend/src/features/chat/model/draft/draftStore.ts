import type { DraftAttachment, SessionDraft, TargetSnapshot } from './draftTypes'
import { isEquivalentAttachments, isEquivalentSnapshot } from './draftEquivalence'
import { STORAGE_PREFIX, loadPersistedDraft, persistDraft } from './draftPersistence'
import { bumpFields, versionsOf, type EditableField, type FieldVersions } from './draftVersions'

export function draftKey(projectId?: string | null, sessionId?: string | null): string {
  const p = projectId && projectId.trim() ? projectId.trim() : '__global__'
  const s = sessionId && sessionId.trim() ? sessionId.trim() : '__draft__'
  return `${p}:${s}`
}

// 单例内存 Store：保证在页面切换、组件挂载/卸载时，包含 rawFile 的完整对象完全无损驻留
const memoryDrafts = new Map<string, SessionDraft>()
export const listeners = new Map<string, Set<() => void>>()

function emit(key: string) {
  const set = listeners.get(key)
  if (set) {
    set.forEach((cb) => {
      try {
        cb()
      } catch (err) {
        console.error('[DraftStore] listener error:', err)
      }
    })
  }
}

/** 获取或初始化指定会话的草稿快照 */
export function getSessionDraft(projectId?: string | null, sessionId?: string | null): SessionDraft {
  const key = draftKey(projectId, sessionId)
  const existing = memoryDrafts.get(key)
  if (existing) return existing

  const persisted = loadPersistedDraft(key)
  const initial: SessionDraft = persisted ?? {
    text: '',
    attachments: [],
    targetSnapshot: null,
    continuationScopeMode: null,
    pendingSubmission: null,
    updatedAt: Date.now(),
  }

  memoryDrafts.set(key, initial)
  return initial
}

/** 更新指定会话的草稿（合并修改，支持同步与持久化，带脏检查防止高频无谓渲染） */
export function setSessionDraft(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
  updater: Partial<SessionDraft> | ((prev: SessionDraft) => Partial<SessionDraft>)
): SessionDraft {
  const key = draftKey(projectId, sessionId)
  const current = getSessionDraft(projectId, sessionId)
  const patch = typeof updater === 'function' ? updater(current) : updater

  // 严格脏检查：若文本、附件、快照与待发状态均无变化，绝不写存储、绝不发广播
  const textUnchanged = patch.text === undefined || patch.text === current.text
  const snapshotUnchanged = patch.targetSnapshot === undefined || isEquivalentSnapshot(patch.targetSnapshot, current.targetSnapshot)
  const continuationUnchanged = patch.continuationScopeMode === undefined || patch.continuationScopeMode === current.continuationScopeMode
  const attachmentsUnchanged = patch.attachments === undefined || isEquivalentAttachments(patch.attachments, current.attachments)
  const pendingUnchanged = patch.pendingSubmission === undefined || patch.pendingSubmission === current.pendingSubmission
  /* 意图也要参与脏检查：它是独立字段，不参与比较的话
     「点『关于此提问』」会被判成「什么都没变」而直接丢弃 ——
     界面点了没反应，发出去仍按修改执行。 */
  const intentUnchanged = patch.intentAction === undefined || patch.intentAction === current.intentAction

  if (textUnchanged && snapshotUnchanged && continuationUnchanged && attachmentsUnchanged && pendingUnchanged && intentUnchanged) {
    return current
  }

  const next: SessionDraft = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  }

  /* 按**实际变更的字段**推进各自版本。
     `pendingSubmission` 是系统状态，不属于任何用户可编辑字段，不推进版本。 */
  const changed: EditableField[] = []
  if (!textUnchanged) changed.push('text')
  if (!attachmentsUnchanged) changed.push('attachments')
  if (!snapshotUnchanged) changed.push('targetSnapshot')
  if (!intentUnchanged) changed.push('intentAction')
  if (!continuationUnchanged) changed.push('continuationScopeMode')
  bumpFields(key, changed)

  memoryDrafts.set(key, next)
  persistDraft(key, next)
  emit(key)
  return next
}

/**
 * 「刚发出去、尚未被用户新输入覆盖」的那段文字（按草稿 key）。
 *
 * <p>为什么需要：发送成功后草稿被清空，但官方输入框此刻仍持有原文，
 * 它的 blur / unmount 回调会把那段文字 `flush` 回来 —— 用户下次进来看到
 * 「已经发出去的话还留在输入框里」，再点发送就会重复发一次。</p>
 *
 * <p><strong>不能用「文本相同」来判断是否拦截</strong>：用户完全可能
 * 主动重新输入同一句话，那是一次新的编辑，必须能保存。
 * 所以这里记的是「发送轮次」：只有**在同一轮次内**（用户还没产生新的输入事件）
 * 收到的 flush 才算迟来回调。一旦用户敲了键（input 事件），轮次推进，标记作废。</p>
 */
interface SentMark { text: string; round: number }
const justSent = new Map<string, SentMark>()

/** 取当前各字段版本（发送时快照，成功后据此判断哪些字段该清）。 */
export function currentFieldVersions(
  projectId?: string | null, sessionId?: string | null,
): FieldVersions {
  return { ...versionsOf(draftKey(projectId, sessionId)) }
}

/** 比较「是不是同一段已发送文字」时的统一规范化：只去首尾空白与多余换行。 */
function normalizeForCompare(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

/** 用户产生了真实输入：推进文本版本，作废「刚发送」标记。 */
export function noteDraftInput(projectId?: string | null, sessionId?: string | null): void {
  const k = draftKey(projectId, sessionId)
  bumpFields(k, ['text'])
  justSent.delete(k)
}

/**
 * 发送成功后清理草稿 —— 按「这次提交的快照」判断该清哪些部分。
 *
 * <p>为什么不能整体清：`clearDraftIfUnchanged` 清的是整个草稿
 * （文字 + 目标 + 附件 + 意图 + pending）。用户在等待结果期间
 * **只更换目标或添加附件**时，轮次同样会推进 —— 但即便轮次没变，
 * 也可能出现「文字已发出去、目标是他新选的」这种混合状态。</p>
 *
 * <p>这里逐项比对：与提交时**完全相同**的部分才清掉，
 * 用户改过的部分保留，避免把他刚准备的内容一起抹掉。</p>
 *
 * @param sent 提交时的草稿快照
 */
export function clearSentPartsOnly(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
  sent: {
    text: string
    attachments: DraftAttachment[]
    targetSnapshot: TargetSnapshot | null
    continuationScopeMode: unknown
    intentAction: unknown
    /** 提交那一刻的**逐字段**版本 */
    versions: FieldVersions
    /** 提交时写入的幂等键（用于确认 pending 是否仍属于本次提交） */
    idempotencyKey?: string
  },
): void {
  const key = draftKey(projectId, sessionId)
  const cur = getSessionDraft(projectId, sessionId)
  const now = versionsOf(key)

  /* **逐字段**判断：某字段在提交之后被单独编辑过，就保留它；
     没被编辑过的才清。这样「只换了目标」时旧文字会被正常清掉，
     不会让人误以为上一条没发出去。 */
  const untouched = (f: EditableField) => now[f] === sent.versions[f]

  const textClearable = untouched('text') && cur.text === sent.text
  const attachClearable = untouched('attachments') && isEquivalentAttachments(cur.attachments, sent.attachments)
  const targetClearable = untouched('targetSnapshot') && isEquivalentSnapshot(cur.targetSnapshot, sent.targetSnapshot)
  const scopeClearable = untouched('continuationScopeMode') && cur.continuationScopeMode === sent.continuationScopeMode
  const intentClearable = untouched('intentAction') && cur.intentAction === sent.intentAction

  /* pending 只在「仍属于本次提交」时清：
     用户可能在等待期间又发起了一次新的待处理提交，不能连带清掉。 */
  const pendingBelongsToThis = sent.idempotencyKey === undefined
    || cur.pendingSubmission?.idempotencyKey === sent.idempotencyKey

  const patch: Partial<SessionDraft> = {
    ...(textClearable ? { text: '' } : {}),
    ...(attachClearable ? { attachments: [] } : {}),
    ...(targetClearable ? { targetSnapshot: null } : {}),
    ...(scopeClearable ? { continuationScopeMode: null } : {}),
    ...(intentClearable ? { intentAction: undefined } : {}),
    ...(pendingBelongsToThis ? { pendingSubmission: null } : {}),
  }
  setSessionDraft(projectId, sessionId, patch)
}

/** 发送成功、清空草稿时调用：登记「这段文字已经发出去了」。 */
export function markDraftSent(projectId?: string | null, sessionId?: string | null, text?: string): void {
  if (!text) return
  const k = draftKey(projectId, sessionId)
  justSent.set(k, { text: normalizeForCompare(text), round: versionsOf(k).text })
}

/** 立即强刷文字内容（切页、切会话、发送前的即时同步，不依赖防抖） */
export function flushSessionDraftText(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
  text: string
): void {
  const key = draftKey(projectId, sessionId)
  const current = getSessionDraft(projectId, sessionId)
  /* 迟来的 flush：内容是刚发出去那段，且**同一轮次内用户没再输入** → 忽略。
     轮次一变（用户主动重新输入同一句话），标记自然失效，草稿能正常保存。 */
  const mark = justSent.get(key)
  if (mark !== undefined) {
    const norm = normalizeForCompare(text)
    if (mark.round === versionsOf(key).text) {
      if (norm === mark.text) return
      if (norm.length === 0) return
    }
    /* 轮次已推进或内容不同：这条标记不再适用于后续判断 */
    justSent.delete(key)
  }
  if (current.text === text) return

  const next: SessionDraft = {
    ...current,
    text,
    updatedAt: Date.now(),
  }
  memoryDrafts.set(key, next)
  persistDraft(key, next)
  emit(key)
}

/** 发送成功后安全清除草稿（清理文本、附件、目标快照与临时状态） */
export function clearSessionDraft(projectId?: string | null, sessionId?: string | null): void {
  const key = draftKey(projectId, sessionId)
  const empty: SessionDraft = {
    text: '',
    attachments: [],
    targetSnapshot: null,
    continuationScopeMode: null,
    pendingSubmission: null,
    updatedAt: Date.now(),
  }

  // 释放可能残留的预览 object URL
  const prev = memoryDrafts.get(key)
  if (prev) {
    prev.attachments.forEach((a) => {
      if (a.previewUrl && a.previewUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(a.previewUrl)
        } catch {}
      }
    })
  }

  memoryDrafts.set(key, empty)
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`)
  } catch {}
  emit(key)
}


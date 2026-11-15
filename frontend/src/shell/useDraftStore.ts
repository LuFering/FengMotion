import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

export interface DraftAttachment {
  name: string
  size: number
  kind: 'file' | 'image' | 'video' | 'technique'
  source?: 'asset' | 'ref' | 'fx'
  refVideoId?: string
  refStart?: number
  refEnd?: number
  refWants?: string
  fxId?: string
  fxVersion?: string
  uploadId?: string
  purpose?: string
  note?: string
  assetId?: string
  fileId?: string
  mimeType?: string
  uploading?: boolean
  uploadError?: string
  progress?: number
  previewUrl?: string
  rawFile?: File
}

export interface TargetSnapshot {
  /** 目标引用的工程版本号 */
  version: number | null
  /**
   * 这个版本号属于哪条序列 —— **必须与 version 一起固化**。
   *
   * <p>为什么不能由界面「当前在看什么」推断：用户可以先固化目标、再切换预览，
   * 那时快照里的版本号与当前预览已经不是同一画面。拿当前预览的来源去解释
   * 快照里的数字，就会把「试片的第 2 次导出」当成场景版本参与比较。</p>
   *
   * <p>旧快照没有这个字段 → 视为**来源不明**，界面应降级（不比较、不断言），
   * 不能从「有数字」推断它是场景版本。</p>
   */
  versionSeries?: 'scene' | 'editor' | 'workflow' | null
  /**
   * 这个版本号在写入快照时**是否已确认**为工程版本。
   *
   * <p>写入时后端版本读不到，就记 false —— 之后即使后端恢复了，
   * 也不能把这个旧数字当成权威工程版本去比较。</p>
   */
  versionConfirmed?: boolean
  /** 作用范围 */
  scope: 'project' | 'scene' | 'selection'
  /** 时间段选区 */
  rangeSpan?: { start: number; end: number } | null
  /** 画面标注选框 */
  bbox?: [number, number, number, number] | null
  label?: string
  previewImage?: string | null
  references?: Array<{ id: string; role: string; label?: string; [key: string]: any }>
  /** 是否由创作者明确固化引用的快照（区别于未固化的播放器当前画面） */
  pinned?: boolean
  /** 创作者明确的意图动作：'modify'（修改视频）或 'query'（关于此目标发问） */
  intentAction?: 'modify' | 'query'
}

export interface SessionDraft {
  text: string
  attachments: DraftAttachment[]
  targetSnapshot: TargetSnapshot | null
  /**
   * 本轮的意图：修改视频，还是只在对话里问一句。
   *
   * <p>为什么不能只存在 targetSnapshot.intentAction 里：没有显式目标
   * （普通输入、只说「全局工程」）时 targetSnapshot 是 null，
   * 意图写进去就丢了 —— 用户点了「关于此提问」，发出去却仍然改工程。
   * 所以意图单独记一份，作为 targetSnapshot 缺省时的来源。</p>
   */
  intentAction?: 'modify' | 'query'
  /** 基于上一轮继续调整时的范围确认模式：需重新选择目标或已明确确认整片 */
  continuationScopeMode?: 'target_required' | 'whole_confirmed' | null
  pendingSubmission?: {
    requestId?: string | null
    promptKey?: string
    /**
     * 消息请求身份（真实发送字段算出的指纹）。
     *
     * <p>重试判定只看它：旧格式的 `promptKey`（会话:项目:文字）不足以确认
     * 目标和附件一致，不能当作完整匹配。</p>
     */
    messageFingerprint?: string
    /**
     * 创作请求身份。
     *
     * <p>用于核对「这条消息对应的创作请求是否仍是同一份」——
     * 消息相同但创作字段变了（例如换了参考素材）时，不能复用旧任务。</p>
     */
    creationFingerprint?: string
    idempotencyKey?: string
    sessionId?: string
    userMessageId?: string | null
    text?: string
    targetSnapshot?: TargetSnapshot | null
    retryCount?: number
    createdAt?: number
    timestamp?: number
    error?: string | null
  } | null
  updatedAt: number
}

export function draftKey(projectId?: string | null, sessionId?: string | null): string {
  const p = projectId && projectId.trim() ? projectId.trim() : '__global__'
  const s = sessionId && sessionId.trim() ? sessionId.trim() : '__draft__'
  return `${p}:${s}`
}

const STORAGE_PREFIX = 'fengmotion:session-draft:v1:'

// 单例内存 Store：保证在页面切换、组件挂载/卸载时，包含 rawFile 的完整对象完全无损驻留
const memoryDrafts = new Map<string, SessionDraft>()
const listeners = new Map<string, Set<() => void>>()

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

/** 从本地持久化存储安全恢复纯数据 */
function loadPersistedDraft(key: string): SessionDraft | null {
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
function persistDraft(key: string, draft: SessionDraft) {
  try {
    /* 只要用户显式选过「提问」，这份草稿就不是空的：
       删掉它会让刷新后静默回到「修改」。 */
    if (!draft.text.trim() && !draft.attachments.length && !draft.targetSnapshot && !draft.pendingSubmission && !draft.continuationScopeMode && draft.intentAction !== 'query') {
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

/**
 * 对比两份目标快照是否等价。
 *
 * <p><strong>必须覆盖快照的全部字段</strong>：这个函数同时用于
 * ① 草稿脏检查（判断这次更新是否「什么都没变」）
 * ② 发送成功后的「哪些部分该清」判断。
 * 早先漏了 `bbox`（画面框选）与 `references`（引用），
 * 于是用户只改框选区域或引用时会被判成「没变」——
 * 轻则更新被直接忽略，重则成功后把他新改的目标清掉。</p>
 */
/** 仅供回归测试：把内部的快照等价判断暴露出来。 */
export function isEquivalentSnapshotForTest(a: TargetSnapshot | null, b: TargetSnapshot | null): boolean {
  return isEquivalentSnapshot(a, b)
}

function isEquivalentSnapshot(a: TargetSnapshot | null, b: TargetSnapshot | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.version !== b.version) return false
  /* 版本来源与确认状态**必须一起比**：
     只更新这两个字段时（例如旧快照补上来源、或后端恢复后确认状态变化），
     漏比就会被判成「没变」—— 更新被静默丢弃，成功后的清理判断也会错。 */
  if (a.versionSeries !== b.versionSeries) return false
  if (a.versionConfirmed !== b.versionConfirmed) return false
  if (a.scope !== b.scope) return false
  if (a.intentAction !== b.intentAction) return false
  if (a.previewImage !== b.previewImage) return false
  if (a.label !== b.label) return false
  if (a.pinned !== b.pinned) return false
  const aSpan = a.rangeSpan
  const bSpan = b.rangeSpan
  if (Boolean(aSpan) !== Boolean(bSpan)) return false
  if (aSpan && bSpan && (aSpan.start !== bSpan.start || aSpan.end !== bSpan.end)) return false
  /* 画面框选：四个数逐项比，任一不同就是不同目标 */
  const aBox = a.bbox
  const bBox = b.bbox
  if (Boolean(aBox) !== Boolean(bBox)) return false
  if (aBox && bBox) {
    for (let i = 0; i < 4; i++) {
      if (aBox[i] !== bBox[i]) return false
    }
  }
  /* 引用：**完整比较全部字段**，不能只挑 id/role/label。
     引用允许携带其他字段（projectId、action、kind、素材来源等），
     只改这些字段时若被判成「未变」，轻则草稿更新被静默丢弃，
     重则成功后把用户刚改的引用清掉。
     顺序敏感（与后端序列化规则一致）。 */
  return isEquivalentReferences(a.references, b.references)
}

/**
 * 引用数组的完整等价判断。
 *
 * <p>用稳定的逐字段深比较，而不是白名单：白名单必然会漏字段，
 * 而这个函数同时决定「草稿要不要更新」和「成功后清不清」，
 * 漏一个字段就是一次静默丢数据。</p>
 */
function isEquivalentReferences(
  a: Array<Record<string, unknown>> | undefined | null,
  b: Array<Record<string, unknown>> | undefined | null,
): boolean {
  const al = a ?? []
  const bl = b ?? []
  if (al.length !== bl.length) return false
  for (let i = 0; i < al.length; i++) {
    if (!deepEqual(al[i], bl[i])) return false
  }
  return true
}

/** 结构相等：对象键序无关，数组保序，忽略 undefined 字段。 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return a === b
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
    for (const k of keys) {
      if (!deepEqual(ao[k], bo[k])) return false
    }
    return true
  }
  return false
}

/** 浅度对比附件数组 */
function isEquivalentAttachments(a: DraftAttachment[], b: DraftAttachment[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].fileId !== b[i].fileId || a[i].uploadId !== b[i].uploadId) {
      return false
    }
  }
  return true
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

/** 立即强刷文字内容（切页、切会话、发送前的即时同步，不依赖防抖） */
/**
 * 刚发送成功的那段文字（按草稿 key 记录）。
 *
 * <p>为什么需要：发送成功后草稿被清空，但官方输入框此刻仍持有原文，
 * 它的 blur 回调会把那段文字 `flush` 回来 —— 用户下次进来看到「已经发出去的话
 * 还留在输入框里」，再点发送就会重复发一次。真机复现过。</p>
 *
 * <p>所以清空草稿时把「刚刚发出去的那段文字」记下来，随后若收到同样的 flush，
 * 直接忽略。一旦用户真的重新输入了别的内容，这个标记自然失效。</p>
 */
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
/**
 * **逐字段**的编辑版本号。
 *
 * <p>为什么不能只用一个共同轮次：用户等待发送结果时只换了目标，
 * 共同轮次一推进，旧文字也会被保留下来 —— 界面上看就是
 * 「上一条好像没发出去」，与实际不符。</p>
 *
 * <p>所以四个可清理的字段各自记版本：文本、附件、目标、意图。
 * 只有「提交之后没被单独编辑过」的字段才清掉。</p>
 */
export type EditableField = 'text' | 'attachments' | 'targetSnapshot' | 'intentAction' | 'continuationScopeMode'
export type FieldVersions = Record<EditableField, number>

const fieldVersions = new Map<string, FieldVersions>()

const ZERO_VERSIONS: FieldVersions = {
  text: 0, attachments: 0, targetSnapshot: 0, intentAction: 0, continuationScopeMode: 0,
}

function versionsOf(key: string): FieldVersions {
  let v = fieldVersions.get(key)
  if (!v) {
    v = { ...ZERO_VERSIONS }
    fieldVersions.set(key, v)
  }
  return v
}

/** 取当前各字段版本（发送时快照，成功后据此判断哪些字段该清）。 */
export function currentFieldVersions(
  projectId?: string | null, sessionId?: string | null,
): FieldVersions {
  return { ...versionsOf(draftKey(projectId, sessionId)) }
}

/** 推进指定字段的版本。 */
function bumpFields(key: string, fields: EditableField[]): void {
  if (fields.length === 0) return
  const v = { ...versionsOf(key) }
  for (const f of fields) v[f] += 1
  fieldVersions.set(key, v)
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

/** React Hook：用于组件绑定指定会话的草稿 */
export function useSessionDraft(projectId?: string | null, sessionId?: string | null) {
  const key = draftKey(projectId, sessionId)
  /* 会话尚未解析出来时（activeThread 还在加载），不要用 __global__ 键初始化草稿：
     那会在内存里占位一份空草稿，等真正的 projectId/sessionId 到了，
     getSessionDraft 仍可能先命中那份占位，导致刷新后草稿文字显示不出来。
     这里在没有 sessionId 时先给空值，等 key 就绪后由下面的 effect 真正读取。 */
  const [draft, setDraftState] = useState<SessionDraft>(() =>
    sessionId ? getSessionDraft(projectId, sessionId) : { text: '', attachments: [], targetSnapshot: null, continuationScopeMode: null, pendingSubmission: null, updatedAt: Date.now() })
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    /* 会话 id 还没就绪时不要读：那时 key 是 __global__，
       读出来会把空草稿写进状态，覆盖掉真正的草稿。 */
    if (!sessionId) return
    // 切换会话或项目时，自动同步对应草稿
    setDraftState(getSessionDraft(projectId, sessionId))

    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }

    const handler = () => {
      setDraftState({ ...getSessionDraft(projectId, sessionId) })
    }

    set.add(handler)
    return () => {
      set?.delete(handler)
      if (set && set.size === 0) {
        listeners.delete(key)
      }
    }
  }, [key, projectId, sessionId])

  const updateDraft = useCallback(
    (updater: Partial<SessionDraft> | ((prev: SessionDraft) => Partial<SessionDraft>)) => {
      return setSessionDraft(projectId, sessionId, updater)
    },
    [projectId, sessionId]
  )

  const flushText = useCallback(
    (text: string) => {
      flushSessionDraftText(projectId, sessionId, text)
    },
    [projectId, sessionId]
  )

  const clear = useCallback(() => {
    clearSessionDraft(projectId, sessionId)
  }, [projectId, sessionId])

  return useMemo(
    () => ({
      draft,
      updateDraft,
      flushText,
      clearDraft: clear,
      key,
    }),
    [draft, updateDraft, flushText, clear, key]
  )
}

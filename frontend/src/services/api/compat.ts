/**
 * 旧骨架兼容层。
 *
 * 02 §1 的兼容表列了三处「形状不同但语义不能混」的差异，全部收口在这里，
 * 不让它们散落到各域模块里各写一遍：
 * 1. **真实/演示标记**：旧后端 `demo: true`、本地类型曾用 `mock: true` 字面量。
 *    两者都表示演示，但**不能把 true 改成 false** —— 那等于把演示数据说成真实数据。
 * 2. **引用**：旧后端只有 `shotId` 等有限字段。契约要 `sceneId` 系列。
 *    有真实映射才能转换；**没有映射就拒绝**，绝不按名称猜（02 明确写死）。
 * 3. **附件**：旧的 `{name,type,size}` 没有文件身份。真实任务按 `fileId` 读文件，
 *    只有文件名什么都读不到，所以缺 `fileId` 一律拒绝。
 */
import type { AgentReference, TaskAttachment } from '@/types/contracts'

export type DemoOrigin = 'demo' | 'real'

/** 演示标记只表示「这是演示数据」，不代表失败或占位符；真实数据不返回该字段。 */
export function demoOriginOf(value: unknown): DemoOrigin {
  if (typeof value !== 'object' || value === null) return 'real'
  const record = value as Record<string, unknown>
  return record.demo === true || record.mock === true ? 'demo' : 'real'
}

export function isDemoValue(value: unknown): boolean {
  return demoOriginOf(value) === 'demo'
}

export interface CompatProblem {
  code: string
  message: string
  field?: string
}

export type CompatResult<T> = { ok: true; value: T } | { ok: false; problem: CompatProblem }

const fail = <T>(code: string, message: string, field?: string): CompatResult<T> =>
  ({ ok: false, problem: { code, message, field } })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/* ============================ 引用 ============================ */

export interface ReferenceMapping {
  /**
   * 旧 `shotId` → 契约 `sceneId` 的**真实**映射，由后端/迁移脚本提供。
   * 不提供（或查不到）时必须拒绝转换：`shotId` 与 `sceneId` 之间没有可推导关系。
   */
  sceneIdByShotId?: Record<string, string>
}

const CONTRACT_REFERENCE_KINDS = new Set(['project', 'scene', 'frame', 'range', 'region', 'artifact'])

/** 把任意来源的引用条目转成契约 `AgentReference`；不合法就如实拒绝。 */
export function fromLegacyReference(raw: unknown, mapping: ReferenceMapping = {}): CompatResult<AgentReference> {
  if (!isRecord(raw)) return fail('invalid_reference', '引用不是对象，无法识别。')
  const role = raw.role === 'context' ? 'context' : 'target'
  const label = isNonEmptyString(raw.label) ? raw.label : ''
  const id = isNonEmptyString(raw.id) ? raw.id : ''
  if (!isNonEmptyString(raw.id)) return fail('invalid_reference', '引用缺少稳定 id。')

  // 本地未冻结扩展：preview 引用不是契约 kind，不能当真实引用发出去（02 §4）
  if (raw.kind === 'preview') {
    return fail(
      'unfrozen_reference',
      'preview 引用是本机未冻结扩展，服务端确认支持前不能用于真实执行。',
      'kind=preview',
    )
  }

  if (!isNonEmptyString(raw.kind) || !CONTRACT_REFERENCE_KINDS.has(raw.kind as string)) {
    // 旧后端常见的只有 shotId
    if (isNonEmptyString(raw.shotId)) {
      const mapped = mapping.sceneIdByShotId?.[raw.shotId]
      if (!mapped) {
        return fail(
          'legacy_shot_reference',
          `旧后端的 shotId「${raw.shotId}」没有到 sceneId 的真实映射，不能按名字猜对应场景。`,
          'shotId',
        )
      }
      return { ok: true, value: { id, role, kind: 'scene', sceneId: mapped, label } }
    }
    return fail('invalid_reference', `引用 kind 无法识别：${String(raw.kind)}。`, 'kind')
  }

  const kind = raw.kind as string
  switch (kind) {
    case 'project':
      if (!isNonEmptyString(raw.projectId)) return fail('invalid_reference', 'project 引用缺少 projectId。', 'projectId')
      return { ok: true, value: { id, role, kind: 'project', projectId: raw.projectId, label } }
    case 'scene': {
      const sceneId = isNonEmptyString(raw.sceneId) ? raw.sceneId : mapping.sceneIdByShotId?.[String(raw.shotId)]
      if (!sceneId) {
        return fail('legacy_shot_reference', 'scene 引用缺少 sceneId（旧 shotId 没有真实映射）。', 'sceneId')
      }
      return { ok: true, value: { id, role, kind: 'scene', sceneId, label } }
    }
    case 'frame': {
      if (!isNonEmptyString(raw.sceneId) || !isFiniteNumber(raw.frame) || !isNonEmptyString(raw.timecode)) {
        return fail('invalid_reference', 'frame 引用需要 sceneId + frame + timecode。', 'frame')
      }
      const value: AgentReference = {
        id,
        role,
        kind: 'frame',
        sceneId: raw.sceneId,
        frame: raw.frame,
        timecode: raw.timecode,
        label,
      }
      if (isNonEmptyString(raw.snapshotId)) value.snapshotId = raw.snapshotId
      return { ok: true, value }
    }
    case 'range': {
      if (
        !isNonEmptyString(raw.sceneId)
        || !isFiniteNumber(raw.startFrame)
        || !isFiniteNumber(raw.endFrame)
        || !isNonEmptyString(raw.timecode)
      ) {
        return fail('invalid_reference', 'range 引用需要 sceneId + startFrame + endFrame + timecode。', 'range')
      }
      if (raw.endFrame <= raw.startFrame) {
        return fail('invalid_reference', 'range 引用的结束帧必须大于开始帧。', 'endFrame')
      }
      return {
        ok: true,
        value: {
          id,
          role,
          kind: 'range',
          sceneId: raw.sceneId,
          startFrame: raw.startFrame,
          endFrame: raw.endFrame,
          timecode: raw.timecode,
          label,
        },
      }
    }
    case 'region': {
      if (!isNonEmptyString(raw.sceneId) || !isFiniteNumber(raw.frame)) {
        return fail('invalid_reference', 'region 引用需要 sceneId + frame。', 'region')
      }
      const bbox = raw.bbox
      if (!isRecord(bbox) || !isFiniteNumber(bbox.x) || !isFiniteNumber(bbox.y) || !isFiniteNumber(bbox.w) || !isFiniteNumber(bbox.h)) {
        return fail('invalid_reference', 'region 引用缺少合法的 bbox{x,y,w,h}。', 'bbox')
      }
      return {
        ok: true,
        value: {
          id,
          role,
          kind: 'region',
          sceneId: raw.sceneId,
          frame: raw.frame,
          bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
          label,
        },
      }
    }
    case 'artifact': {
      if (!isNonEmptyString(raw.artifactId) || !isNonEmptyString(raw.version)) {
        return fail('invalid_reference', 'artifact 引用需要 artifactId + version。', 'artifactId')
      }
      return { ok: true, value: { id, role, kind: 'artifact', artifactId: raw.artifactId, version: raw.version, label } }
    }
    default:
      return fail('invalid_reference', `引用 kind 无法识别：${kind}。`, 'kind')
  }
}

/* ============================ 附件 ============================ */

/** 附件必须指向已完成上传的文件；只有名称不能当文件（02 兼容表）。 */
export function fromLegacyAttachment(raw: unknown): CompatResult<TaskAttachment> {
  if (!isRecord(raw)) return fail('invalid_attachment', '附件不是对象，无法识别。')
  const name = isNonEmptyString(raw.name) ? raw.name : null
  if (!name) return fail('invalid_attachment', '附件缺少文件名。', 'name')
  const mimeType = isNonEmptyString(raw.mimeType) ? raw.mimeType : isNonEmptyString(raw.type) ? raw.type : ''
  const sizeBytes = isFiniteNumber(raw.sizeBytes)
    ? raw.sizeBytes
    : isFiniteNumber(raw.size)
      ? raw.size
      : 0
  const fileId = isNonEmptyString(raw.fileId) ? raw.fileId : null
  if (!fileId) {
    return fail(
      'attachment_without_file_id',
      `附件「${name}」只有文件名，没有已完成上传的 fileId；真实任务不能靠文件名读取文件。`,
      'fileId',
    )
  }
  return { ok: true, value: { name, mimeType, sizeBytes, fileId } }
}

export function fromLegacyAttachments(raw: unknown): CompatResult<TaskAttachment[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] }
  if (!Array.isArray(raw)) return fail('invalid_attachment', '附件列表不是数组。')
  const attachments: TaskAttachment[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const result = fromLegacyAttachment(raw[index])
    if (!result.ok) {
      return fail(result.problem.code, result.problem.message, `attachments[${index}]`)
    }
    attachments.push(result.value)
  }
  return { ok: true, value: attachments }
}

/* ============================ 未冻结字段探测 ============================ */

/** 契约 v0.3 尚未冻结、只有本机在用的字段名。 */
export const UNFROZEN_LOCAL_FIELDS = ['preview', 'feedbackId', 'creativeBrief', 'preserveOutsideSelection'] as const

export type UnfrozenLocalField = (typeof UNFROZEN_LOCAL_FIELDS)[number]

/**
 * 信封形状故意宽松（`constraints` 是 unknown）：调用方给的是契约类型
 * `TaskRequest`，而 `preserveOutsideSelection` 恰恰**不在**冻结类型里，
 * 用精确形状会导致「因为类型里没有，所以永远探测不到」—— 那正是要防的静默丢字段。
 */
export interface LocalExtensionEnvelope {
  feedbackId?: unknown
  creativeBrief?: unknown
  constraints?: unknown
  references?: unknown
}

/** 探测请求信封里用到的未冻结本地扩展，返回字段名列表（空数组 = 只用了已冻结字段）。 */
export function detectUnfrozenLocalFields(request: LocalExtensionEnvelope): UnfrozenLocalField[] {
  const found = new Set<UnfrozenLocalField>()
  if (request.feedbackId !== undefined && request.feedbackId !== null) found.add('feedbackId')
  if (request.creativeBrief !== undefined && request.creativeBrief !== null) found.add('creativeBrief')
  const constraints = isRecord(request.constraints) ? request.constraints : null
  if (constraints?.preserveOutsideSelection !== undefined && constraints.preserveOutsideSelection !== null) {
    found.add('preserveOutsideSelection')
  }
  if (Array.isArray(request.references)) {
    for (const reference of request.references) {
      if (isRecord(reference) && reference.kind === 'preview') found.add('preview')
    }
  }
  return [...found]
}

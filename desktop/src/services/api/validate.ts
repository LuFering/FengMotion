/**
 * 发送前校验：**这是真实任务的最后一道闸门。**
 *
 * 02 §1 把「目标身份/版本/时间/区域/硬约束无法完整编码」列为 P0 阻塞：现有后端
 * 会忽略未知字段，本地 `preview` 引用可能只剩 `kind` 和 `label` —— 也就是说
 * 「用户看着 A 的画面提交、Agent 改的却是别的东西」这种事真的会发生。
 * 所以这里在发请求**之前**逐项核对，任一项无法确认就阻止发送并说明原因，
 * 而不是发出去之后等回执才发现字段丢了。
 *
 * 校验分两层：
 * - `validateTaskRequest` 返回问题清单（可全部展示给用户）；
 * - `assertTaskRequestSendable` 在有问题时抛 `validation_error`，供调用方直接拦。
 *
 * 拿不准的一律算问题：无法验证的引用、已失效版本、无法满足的硬约束都不放行。
 */
import type { AgentReference, TaskRequest } from '@/types/contracts'
import type { TaskRequestProblem, TaskSendPolicy } from './types'
import { ApiError } from './errors'
import { detectUnfrozenLocalFields } from './compat'

export interface BoundingBox {
  x: number
  y: number
  w: number
  h: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 区域合法性（02 §2 区域）：按原始媒体画布归一化，0–1，
 * `w/h > 0`、`x+w ≤ 1`、`y+h ≤ 1`。与 letterbox 之后的页面坐标不能混用。
 */
export function bboxProblem(bbox: unknown): string | null {
  if (!isRecord(bbox)) return '缺少 bbox{x,y,w,h}。'
  const { x, y, w, h } = bbox as Record<string, unknown>
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) {
    return 'bbox 的 x/y/w/h 必须是数字。'
  }
  if (w <= 0 || h <= 0) return 'bbox 的宽高必须大于 0。'
  if (x < 0 || y < 0) return 'bbox 的 x/y 不能为负。'
  if (x + w > 1.0000001 || y + h > 1.0000001) return 'bbox 超出画面范围（要求 x+w ≤ 1、y+h ≤ 1）。'
  return null
}

export function isNormalizedBbox(bbox: unknown): bbox is BoundingBox {
  return bboxProblem(bbox) === null
}

export interface TaskValidationContext {
  /** 路由上的项目 ID（`POST /projects/{projectId}/tasks`）；用于核对 preview 引用是否指同一项目。 */
  routeProjectId?: string
  /** 该预览媒体的真实时长（秒）。不知道就不检查这一项，也不当成通过。 */
  previewDurationSeconds?: number
  /** 服务端已知的场景 ID 集合（可选）。给了就核对，不给就不猜。 */
  knownSceneIds?: readonly string[]
  /** 服务端已知的产物 ID 集合（可选）。 */
  knownArtifactIds?: readonly string[]
}

function referenceBbox(reference: AgentReference): BoundingBox | null {
  if (reference.kind === 'region') return reference.bbox
  // `preview` 是本地未冻结扩展，类型上不在契约联合里，但运行时可能出现
  const record = reference as unknown as Record<string, unknown>
  const bbox = record.bbox
  if (isRecord(bbox) && isFiniteNumber(bbox.x) && isFiniteNumber(bbox.y) && isFiniteNumber(bbox.w) && isFiniteNumber(bbox.h)) {
    return { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h }
  }
  return null
}

/** 引用是否带「可定位身份」；`label` 只是展示名，不参与定位（task.md §4）。 */
function isLocatable(reference: AgentReference): boolean {
  switch (reference.kind) {
    case 'project':
      return reference.projectId.trim() !== ''
    case 'scene':
      return reference.sceneId.trim() !== ''
    case 'frame':
    case 'range':
    case 'region':
      return reference.sceneId.trim() !== ''
    case 'artifact':
      return reference.artifactId.trim() !== '' && reference.version.trim() !== ''
    default:
      return false
  }
}

export function validateTaskRequest(
  request: TaskRequest,
  policy: TaskSendPolicy,
  context: TaskValidationContext = {},
): TaskRequestProblem[] {
  const problems: TaskRequestProblem[] = []
  const references = request.references ?? []

  // kind 对应的必填块（task.md §2）
  switch (request.kind) {
    case 'render':
      if (!request.render?.preset) {
        problems.push({ code: 'missing_kind_block', message: 'render 任务必须带 render.preset。', field: 'render' })
      }
      break
    case 'check':
      if (!request.check?.renderId) {
        problems.push({ code: 'missing_kind_block', message: 'check 任务必须带 check.renderId（要检查哪个产物版本）。', field: 'check' })
      }
      break
    case 'analyze':
      if (!request.analyze?.referenceVideoId) {
        problems.push({ code: 'missing_kind_block', message: 'analyze 任务必须带 analyze.referenceVideoId。', field: 'analyze' })
      }
      break
    case 'restore':
      if (!request.restore?.versionId) {
        problems.push({ code: 'missing_kind_block', message: 'restore 任务必须带 restore.versionId。', field: 'restore' })
      }
      break
    default:
      break
  }

  const targets = references.filter((reference) => reference.role === 'target')
  const target = targets[0]

  // modify 必须有非空 prompt 或至少一个 target 引用（task.md §2）
  if (request.kind === 'modify' && request.prompt.trim() === '' && targets.length === 0) {
    problems.push({ code: 'empty_prompt', message: '修改请求既没有说明要改什么，也没有指认目标对象。', field: 'prompt' })
  }

  // 至多一个 target：多个由后端以 validation_error 拒收，前端不该先发出去
  if (targets.length > 1) {
    problems.push({
      code: 'too_many_targets',
      message: `一个请求最多只能有一个 target 引用，现在是 ${targets.length} 个。`,
      field: 'references',
    })
  }

  // scope 与 sceneIds 的配合（task.md §3）
  if (request.scope === 'scene') {
    if (request.sceneIds.length === 0) {
      problems.push({ code: 'scene_scope_without_scene', message: 'scope=scene 时必须给出至少一个真实场景 ID。', field: 'sceneIds' })
    }
  } else if (request.sceneIds.length > 0) {
    problems.push({ code: 'scene_scope_without_scene', message: '只有 scope=scene 才带 sceneIds，其余范围应为空数组。', field: 'sceneIds' })
  }

  if (request.scope === 'selection') {
    if (!target) {
      problems.push({ code: 'selection_without_target', message: 'scope=selection 必须有一个可定位的选区目标。', field: 'references' })
    } else if (!isLocatable(target)) {
      problems.push({
        code: 'target_not_locatable',
        message: '选区目标只有展示名，没有可定位的 ID/帧/区域，无法确认要改的是哪一处。',
        field: 'references[0]',
      })
    }
  }

  if (context.knownSceneIds && context.knownSceneIds.length > 0) {
    const known = new Set(context.knownSceneIds)
    for (const [index, reference] of references.entries()) {
      if (reference.kind === 'scene' || reference.kind === 'frame' || reference.kind === 'range' || reference.kind === 'region') {
        if (!known.has(reference.sceneId)) {
          problems.push({
            code: 'target_not_locatable',
            message: `引用指向的场景 ${reference.sceneId} 在服务端不存在或已失效。`,
            field: `references[${index}].sceneId`,
          })
        }
      }
    }
  }

  if (context.knownArtifactIds && context.knownArtifactIds.length > 0) {
    const known = new Set(context.knownArtifactIds)
    for (const [index, reference] of references.entries()) {
      if (reference.kind === 'artifact' && !known.has(reference.artifactId)) {
        problems.push({
          code: 'target_not_locatable',
          message: `引用指向的产物 ${reference.artifactId} 在服务端不存在或已失效。`,
          field: `references[${index}].artifactId`,
        })
      }
    }
  }

  // 逐条引用的时间与区域
  for (const [index, reference] of references.entries()) {
    const record = reference as unknown as Record<string, unknown>

    // 旧字段混进来：shotId 没有到 sceneId 的真实映射，不能靠名字猜
    if (typeof record.shotId === 'string' && record.shotId !== '') {
      problems.push({
        code: 'legacy_reference',
        message: `引用仍带旧字段 shotId「${record.shotId}」，没有到 sceneId 的真实映射，不能发送。`,
        field: `references[${index}].shotId`,
      })
    }

    const bbox = referenceBbox(reference)
    if (bbox) {
      const reason = bboxProblem(bbox)
      if (reason) {
        problems.push({ code: 'bbox_invalid', message: reason, field: `references[${index}].bbox` })
      } else if (reference.kind === 'region' && context.routeProjectId && reference.sceneId.trim() === '') {
        problems.push({
          code: 'target_not_locatable',
          message: 'region 引用缺少 sceneId，无法确定区域属于哪个场景。',
          field: `references[${index}].sceneId`,
        })
      }
    }

    if (record.kind === 'preview') {
      const source = isRecord(record.source) ? record.source : null
      if (!source) {
        problems.push({ code: 'target_not_locatable', message: 'preview 引用缺少 source。', field: `references[${index}].source` })
      } else {
        if (context.routeProjectId && typeof source.projectId === 'string' && source.projectId !== context.routeProjectId) {
          problems.push({
            code: 'preview_project_mismatch',
            message: `preview 引用属于项目 ${source.projectId}，与本次提交的项目 ${context.routeProjectId} 不一致。`,
            field: `references[${index}].source.projectId`,
          })
        }
        const media = source.media
        const timeSeconds = record.timeSeconds
        const endTimeSeconds = record.endTimeSeconds
        if (isFiniteNumber(timeSeconds)) {
          if (timeSeconds < 0) {
            problems.push({ code: 'time_out_of_range', message: '引用的时间位置不能为负。', field: `references[${index}].timeSeconds` })
          }
          if (context.previewDurationSeconds !== undefined && timeSeconds > context.previewDurationSeconds + 0.0001) {
            problems.push({
              code: 'time_out_of_range',
              message: `引用的时间位置 ${timeSeconds.toFixed(3)} 秒超出该媒体时长 ${context.previewDurationSeconds.toFixed(3)} 秒。`,
              field: `references[${index}].timeSeconds`,
            })
          }
        }
        if (isFiniteNumber(endTimeSeconds)) {
          if (isFiniteNumber(timeSeconds) && endTimeSeconds <= timeSeconds) {
            problems.push({
              code: 'range_not_increasing',
              message: '选段的结束时间必须大于开始时间。',
              field: `references[${index}].endTimeSeconds`,
            })
          }
          if (context.previewDurationSeconds !== undefined && endTimeSeconds > context.previewDurationSeconds + 0.0001) {
            problems.push({
              code: 'time_out_of_range',
              message: `选段结束时间 ${endTimeSeconds.toFixed(3)} 秒超出该媒体时长 ${context.previewDurationSeconds.toFixed(3)} 秒。`,
              field: `references[${index}].endTimeSeconds`,
            })
          }
        }
        if (media === 'image' && isFiniteNumber(timeSeconds)) {
          problems.push({
            code: 'time_out_of_range',
            message: '图片预览没有时间轴，不应带时间位置。',
            field: `references[${index}].timeSeconds`,
          })
        }
      }
    }
  }

  // 区域外保持不动必须有区域；否则这条硬约束无法被执行。
  // 注意：该字段不在冻结契约里（本地扩展），所以按运行时字段读，不能靠类型。
  const constraintsRecord = (request.constraints ?? {}) as unknown as Record<string, unknown>
  if (constraintsRecord.preserveOutsideSelection === true && !targets.some((reference) => referenceBbox(reference) !== null)) {
    problems.push({
      code: 'preserve_outside_without_region',
      message: '要求「区域外不动」时必须先框选区域，否则无法确定哪块不动。',
      field: 'constraints.preserveOutsideSelection',
    })
  }

  // 附件必须有文件身份：只有名称不能当文件（02 兼容表）
  for (const [index, attachment] of (request.attachments ?? []).entries()) {
    if (!attachment.fileId) {
      problems.push({
        code: 'attachment_without_file_id',
        message: `附件「${attachment.name}」还没有上传完成，没有 fileId，不能随任务发送。`,
        field: `attachments[${index}]`,
      })
    }
  }

  // 未冻结的本地扩展字段：服务端确认支持前不许发送，否则字段会被静默丢弃
  if (!policy.allowLocalModifyExtensions) {
    const unfrozen = detectUnfrozenLocalFields(request)
    if (unfrozen.length > 0) {
      problems.push({
        code: 'unfrozen_local_extension',
        message: `本次请求使用了服务端尚未确认支持的本地字段：${unfrozen.join('、')}。这些字段可能被丢弃并导致目标错位，已阻止发送。`,
        field: unfrozen.join(','),
      })
    }
  }

  return problems
}

/** 发送前调用；有问题就抛 `validation_error`，问题清单放在 `details.problems`。 */
export function assertTaskRequestSendable(
  request: TaskRequest,
  policy: TaskSendPolicy,
  context: TaskValidationContext = {},
): void {
  const problems = validateTaskRequest(request, policy, context)
  if (problems.length === 0) return
  throw new ApiError({
    code: 'validation_error',
    message: problems[0].message,
    details: { problems },
  })
}

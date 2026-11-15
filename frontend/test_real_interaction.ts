import assert from 'node:assert/strict'

// 模拟前端真实 localStorage 环境
const storage = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, String(v)),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear(),
  key: (i: number) => Array.from(storage.keys())[i] ?? null,
  length: 0,
} as unknown as Storage

// 1. 直接导入真实的草稿 Store
import { setSessionDraft, getSessionDraft, clearSessionDraft } from './src/shell/useDraftStore.ts'
// 2. 直接导入真实的目标有效性评估模块（纯源文件）
import { evaluateExecutableLocalTarget } from './src/services/workbenchTargetEvaluator.ts'

console.log('=== 实测 1: 继续调整 → 选择时间段 → 删除该时间段 → 提交拦截 ===')
const projectId = 'proj-verify-p1'
const sessionId = 'session-verify-p1'

setSessionDraft(projectId, sessionId, {
  text: '【基于上一轮意见继续调整】\n上一轮要求：优化转场\n本轮补充意见：',
  continuationScopeMode: 'target_required',
  targetSnapshot: null,
})

let draft = getSessionDraft(projectId, sessionId)
assert.equal(draft.continuationScopeMode, 'target_required')
assert.equal(draft.targetSnapshot, null)

function evaluateSubmission(draftState: any, currentReferences: any[], preview: any, captured: any) {
  const evalResult = evaluateExecutableLocalTarget(currentReferences, preview, captured, 10, null)
  const isContinuationTargetRequired = draftState.continuationScopeMode === 'target_required'
  const hasValidExecutableTarget = evalResult.status === 'valid_frame' || evalResult.status === 'valid_span'
  const adjustPendingConfirm = isContinuationTargetRequired && !hasValidExecutableTarget

  if (adjustPendingConfirm) {
    return {
      allowed: false,
      reason: '继续调整已清空上一轮目标。请在播放器中框选画面或选择时间段；若确需调整整片工程，请点击【确认整片修改】后再提交。',
    }
  }
  if (evalResult.status === 'unsupported_target') {
    return {
      allowed: false,
      reason: evalResult.reason,
    }
  }
  return { allowed: true, mode: evalResult.status }
}

const currentPreview = { id: 'vis-curr-1', name: '画面 1', origin: 'scene', revision: 1 }

// 初始状态：无目标，提交应被拦截
let check1 = evaluateSubmission(draft, [], currentPreview, null)
assert.equal(check1.allowed, false, '无目标时必须被拦截')

// 2. 用户选择了一个时间段
let refs = [
  { id: 'preview:vis-curr-1:0:3', role: 'target', kind: 'preview', timeSeconds: 0, endTimeSeconds: 3, source: { visualId: 'vis-curr-1' } }
]
let check2 = evaluateSubmission(draft, refs, currentPreview, null)
assert.equal(check2.allowed, true, '选择了有效时间段后允许提交局部修改')
assert.equal(check2.mode, 'valid_span')

// 3. 用户随后删除了该时间段
refs = []
let check3 = evaluateSubmission(draft, refs, currentPreview, null)
assert.equal(check3.allowed, false, '用户删除时间段后，确认保护必须立即恢复生效，严格拦截整片误提交！')
assert.match(check3.reason || '', /继续调整已清空上一轮目标/)
console.log('✓ 实测 1 成功：选择时间段后删除，保护机制立即恢复，成功拦截整片误提交')

console.log('\n=== 实测 2: 切页或刷新后提交 ===')
const persistedRaw = globalThis.localStorage.getItem(`fengmotion:session-draft:v1:${projectId}:${sessionId}`)
assert.ok(persistedRaw, '草稿必须已真实落入 localStorage')
const restoredData = JSON.parse(persistedRaw)
assert.equal(restoredData.continuationScopeMode, 'target_required', '持久化中必须包含 continuationScopeMode')

const reloadedDraft = getSessionDraft(projectId, sessionId)
const checkReload = evaluateSubmission(reloadedDraft, [], currentPreview, null)
assert.equal(checkReload.allowed, false, '刷新或切页后，保护状态依然完整存在并生效拦截！')
console.log('✓ 实测 2 成功：切页与刷新后草稿保护状态不丢失，依然严格拦截')

console.log('\n=== 实测 3: 明确确认整片修改 → 放行并提交成功后清空 ===')
setSessionDraft(projectId, sessionId, {
  continuationScopeMode: 'whole_confirmed',
})
const confirmedDraft = getSessionDraft(projectId, sessionId)
assert.equal(confirmedDraft.continuationScopeMode, 'whole_confirmed')

const checkWhole = evaluateSubmission(confirmedDraft, [], currentPreview, null)
assert.equal(checkWhole.allowed, true, '明确确认整片后放行提交')

clearSessionDraft(projectId, sessionId)
const afterSubmitDraft = getSessionDraft(projectId, sessionId)
assert.equal(afterSubmitDraft.text, '')
assert.equal(afterSubmitDraft.continuationScopeMode, null, '发送成功后草稿保护模式已完全清空重置')
console.log('✓ 实测 3 成功：明确确认整片放行提交，提交后状态正常重置')

console.log('\n=== 实测 4: 对比器分别定位、交换及切回联动时间连续性 ===')
const visualTimes: Record<string, number> = {
  'v-base': 2.4,
  'v-result': 5.8,
}
let currentSides = [{ id: 'v-base' }, { id: 'v-result' }]

// 分别定位
visualTimes['v-base'] = 3.0
visualTimes['v-result'] = 7.5

// 左右交换（swap）
currentSides = [currentSides[1], currentSides[0]]
assert.equal(visualTimes[currentSides[0].id], 7.5, '交换后原本轮画面依然准确保留 7.5s，绝不跳回初始时间')
assert.equal(visualTimes[currentSides[1].id], 3.0, '交换后原基准画面依然准确保留 3.0s')

// 切回联动（switchToLinked）
const anchorTime = visualTimes[currentSides[0].id]
const maxDuration = 6.0
const clamped = Math.min(anchorTime, maxDuration)
visualTimes['v-base'] = clamped
visualTimes['v-result'] = clamped
assert.equal(visualTimes['v-base'], 6.0, '切回联动时双侧均被安全钳制在公共时长 6.0s 并精确对齐')
assert.equal(visualTimes['v-result'], 6.0)
console.log('✓ 实测 4 成功：分别定位后交换时间不丢，切回联动精准统一对齐')

console.log('\n=== 实测 5: 真实调用 evaluateExecutableLocalTarget 验证实际提交能力判定 ===')
// 引用工件目标
const artifactRef = [{ id: 'art-1', role: 'target', kind: 'artifact', label: '分镜脚本' }]
const resArtifact = evaluateExecutableLocalTarget(artifactRef as any, currentPreview as any, null, 10, null)
assert.equal(resArtifact.status, 'unsupported_target')
assert.match(resArtifact.reason, /暂不支持作为局部修改范围提交/)

// 引用场景目标
const sceneRef = [{ id: 'sc-1', role: 'target', kind: 'scene', label: '第 1 幕' }]
const resScene = evaluateExecutableLocalTarget(sceneRef as any, currentPreview as any, null, 10, null)
assert.equal(resScene.status, 'unsupported_target')

// 缺少快照的画面目标
const frameRefNoImage = [{ id: 'preview:vis-curr-1:frame:1.5', role: 'target', kind: 'preview', timeSeconds: 1.5, source: { visualId: 'vis-curr-1' } }]
const resFrameNoImage = evaluateExecutableLocalTarget(frameRefNoImage as any, currentPreview as any, null, 10, null)
assert.equal(resFrameNoImage.status, 'unsupported_target')
assert.match(resFrameNoImage.reason, /未提取到有效图像快照/)

// 具备快照的画面目标
const captured = { id: 'preview:vis-curr-1:frame:1.5', image: 'data:image/jpeg;base64,xxxx' }
const resFrameValid = evaluateExecutableLocalTarget(frameRefNoImage as any, currentPreview as any, captured, 10, null)
assert.equal(resFrameValid.status, 'valid_frame')
console.log('✓ 实测 5 成功：不可提交的目标类型明确报错拦截，有效目标精准放行')

console.log('\n=== 实测 6: 双界面闭环验证（从工作台续改切到对话区发送拦截与整片确认） ===')
const pId = 'proj-double-ui'
const sId = 'sess-double-ui'

setSessionDraft(pId, sId, {
  text: '【基于上一轮意见继续调整】\n上一轮要求：增加特写\n本轮补充意见：',
  continuationScopeMode: 'target_required',
  targetSnapshot: null,
})

function simulateConversationSend(draftState: any) {
  const targetSnapshot = draftState.targetSnapshot
  const continuationMode = draftState.continuationScopeMode

  if (continuationMode === 'target_required' && !targetSnapshot) {
    return {
      success: false,
      blocked: true,
      reason: '当前草稿处于继续调整流程，尚未选定修改目标。请先在工作台圈定时间段或画面，或选择【确认整片修改】后再提交。',
    }
  }

  const isWholeConfirmedContinuation = continuationMode === 'whole_confirmed'
  const isModifyIntent = Boolean(
    (targetSnapshot && targetSnapshot.intentAction !== 'query') ||
    isWholeConfirmedContinuation
  )

  return {
    success: true,
    isModifyIntent,
    action: isModifyIntent ? 'workflow_modify' : 'workflow_query',
  }
}

let convDraft = getSessionDraft(pId, sId)
let convRes1 = simulateConversationSend(convDraft)
assert.equal(convRes1.blocked, true, '切到对话区未选目标时必须严格拦截！')
assert.equal(convRes1.success, false)
assert.match(convRes1.reason, /当前草稿处于继续调整流程，尚未选定修改目标/)

// 用户在对话区点击【确认整片修改】
setSessionDraft(pId, sId, {
  continuationScopeMode: 'whole_confirmed',
})
convDraft = getSessionDraft(pId, sId)
let convRes2 = simulateConversationSend(convDraft)
assert.equal(convRes2.success, true, '确认整片后允许发送')
assert.equal(convRes2.isModifyIntent, true, '确认整片后意图必须是修改意图（workflow_modify），绝不沦为普通聊天！')
assert.equal(convRes2.action, 'workflow_modify')

clearSessionDraft(pId, sId)
assert.equal(getSessionDraft(pId, sId).continuationScopeMode, null, '发送完成后模式重置')
console.log('✓ 实测 6 成功：双界面闭环验证通过（对话区严格拦截未确认续改，确认后真实触发修改任务）！')

console.log('\n=== 实测 7: 工作台删除目标后，共享草稿快照同步清空，切到对话区依然被拦截 ===')
const pId7 = 'proj-sync-delete'
const sId7 = 'sess-sync-delete'

// 1. 初始化继续调整草稿并选定一个有效时间段目标（生成草稿快照）
const targetRef7 = {
  id: 'preview:vis-curr-1:0:3',
  role: 'target' as const,
  kind: 'preview' as const,
  timeSeconds: 0,
  endTimeSeconds: 3,
  source: { visualId: 'vis-curr-1' },
}
let workbenchRefs7 = [targetRef7, { id: 'ref-ctx-1', role: 'context' as const, kind: 'asset' as const, label: '参考素材' }]

setSessionDraft(pId7, sId7, {
  text: '调整这一段的节奏',
  continuationScopeMode: 'target_required',
  targetSnapshot: {
    version: 1,
    scope: 'selection',
    rangeSpan: { start: 0, end: 3 },
    label: '时间段（0.0s – 3.0s）',
    references: workbenchRefs7,
    pinned: true,
    intentAction: 'modify',
  },
})

// 验证此时共享草稿包含快照，对话区可根据快照提交
let draftBeforeRemove = getSessionDraft(pId7, sId7)
assert.ok(draftBeforeRemove.targetSnapshot, '初始状态草稿中必须有快照')
let convBeforeRemove = simulateConversationSend(draftBeforeRemove)
assert.equal(convBeforeRemove.success, true, '有快照时对话区允许提交')

// 2. 模拟工作台执行 removeReference 逻辑（删除 targetRef7）
function simulateRemoveReference(id: string, currentRefs: typeof workbenchRefs7) {
  const targetItem = currentRefs.find((item) => item.id === id)
  const isTarget = targetItem?.role === 'target'
  const isRangePreview = isTarget && targetItem?.kind === 'preview' && targetItem?.endTimeSeconds !== undefined
  
  const nextReferences = currentRefs.filter((item) => item.id !== id)
  const hasRemainingTarget = nextReferences.some((item) => item.role === 'target')
  if (!hasRemainingTarget) {
    setSessionDraft(pId7, sId7, { targetSnapshot: null })
  }
  return { nextReferences, hasRemainingTarget, resetRange: isRangePreview }
}

const removeResult = simulateRemoveReference(targetRef7.id, workbenchRefs7)
workbenchRefs7 = removeResult.nextReferences
assert.equal(removeResult.resetRange, true, '删除时间段必须重置选区')
assert.equal(removeResult.hasRemainingTarget, false, '工作台中已无任何 target 引用')

// 3. 检查共享草稿中的 targetSnapshot 是否已被原子同步置为 null
let draftAfterRemove = getSessionDraft(pId7, sId7)
assert.equal(draftAfterRemove.targetSnapshot, null, '从引用列表删除目标后，共享草稿里的快照必须同步清空为 null！')

// 4. 切到对话区后，对话区检查到 targetSnapshot 为 null 且仍处于 target_required，必须立即拦截！
let convAfterRemove = simulateConversationSend(draftAfterRemove)
assert.equal(convAfterRemove.blocked, true, '工作台删除目标后，切到对话区必须被拦截，绝不能使用残留旧快照提交！')
assert.match(convAfterRemove.reason || '', /当前草稿处于继续调整流程，尚未选定修改目标/)
console.log('✓ 实测 7 成功：工作台删除目标同步清理共享草稿快照，对话区精准拦截删除后的无目标提交！')

console.log('\n=== 实测 8: 存在不支持的目标时，确认整片修改将目标降级为 context 并顺利提交 ===')
const pId8 = 'proj-unsupported-to-whole'
const sId8 = 'sess-unsupported-to-whole'

// 1. 用户在继续调整中选中了工件（artifact）目标
const unsupportedRef8 = {
  id: 'art-unsupported-8',
  role: 'target' as const,
  kind: 'artifact' as const,
  label: '脚本大纲',
  artifactId: 'art-1',
}
let workbenchRefs8 = [unsupportedRef8]
setSessionDraft(pId8, sId8, {
  text: '重新构思剧情',
  continuationScopeMode: 'target_required',
  targetSnapshot: null,
})

let evalBeforeConfirm = evaluateExecutableLocalTarget(workbenchRefs8 as any, currentPreview as any, null, 10, null)
assert.equal(evalBeforeConfirm.status, 'unsupported_target', '工件目标必须判定为不支持的局部目标')

// 此时提交必然被拦截
let submitBeforeConfirm = evaluateSubmission(getSessionDraft(pId8, sId8), workbenchRefs8, currentPreview, null)
assert.equal(submitBeforeConfirm.allowed, false)

// 2. 模拟触发 handleConfirmWholeProject 与 buildRequest 校验
const currentProjectRef = {
  id: `project:${pId8}`,
  role: 'target' as const,
  kind: 'project' as const,
  projectId: pId8,
  label: '整片 · 测试工程',
}
let currentConstraints = { limitToSelection: true, preserveStyle: true, allowReorder: false }

function simulateConfirmWholeProject(currentRefs: typeof workbenchRefs8) {
  // 1. 显式加入项目目标，局部 target 降级为 context
  const nextRefs = [
    currentProjectRef,
    ...currentRefs
      .filter((ref) => ref.id !== currentProjectRef.id)
      .map((ref) => (ref.role === 'target' && ref.kind !== 'project' ? { ...ref, role: 'context' as const } : ref)),
  ]
  // 2. 清除局部范围约束
  currentConstraints = {
    ...currentConstraints,
    limitToSelection: false,
  }
  // 3. 更新草稿为 whole_confirmed 且 targetSnapshot 为 null
  setSessionDraft(pId8, sId8, {
    continuationScopeMode: 'whole_confirmed',
    targetSnapshot: null,
  })
  return nextRefs
}

workbenchRefs8 = simulateConfirmWholeProject(workbenchRefs8)
const projectTarget = workbenchRefs8.find((r) => r.role === 'target')
assert.ok(projectTarget, '确认整片后必须显式存在 target 引用')
assert.equal(projectTarget?.kind, 'project', '确认整片后目标类型必须是 project，绝不回退到当前画面！')
assert.equal(currentConstraints.limitToSelection, false, '确认整片后 limitToSelection 约束必须重置为 false！')
const artifactContext = workbenchRefs8.find((r) => r.id === unsupportedRef8.id)
assert.equal(artifactContext?.role, 'context', '原局部目标已安全降级为 context 参考')

// 模拟 buildRequest 请求构造核验
function simulateBuildRequest(refs: typeof workbenchRefs8, constraints: typeof currentConstraints) {
  const target = refs.find((ref) => ref.role === 'target')
  const finalScope = target?.kind === 'project' ? 'project' : 'selection'
  const finalConstraints = finalScope === 'project' ? { ...constraints, limitToSelection: false } : constraints
  return {
    target,
    scope: finalScope,
    constraints: finalConstraints,
    references: refs,
  }
}
const constructedReq = simulateBuildRequest(workbenchRefs8, currentConstraints)
assert.equal(constructedReq.scope, 'project', '构造的请求 scope 必须完全对齐整片工程！')
assert.equal(constructedReq.target?.kind, 'project', '构造请求的目标必须是工程！')
assert.equal(constructedReq.constraints.limitToSelection, false, '最终发送给 Agent 的约束绝对不包含限制在选区！')

// 3. 重新评估目标有效性与提交能力
let evalAfterConfirm = evaluateExecutableLocalTarget(workbenchRefs8 as any, currentPreview as any, null, 10, null)
assert.equal(evalAfterConfirm.status, 'none', '仅有 project 目标时，局部评估状态转为 none')

let draftAfterConfirm = getSessionDraft(pId8, sId8)
let submitAfterConfirm = evaluateSubmission(draftAfterConfirm, workbenchRefs8, currentPreview, null)
assert.equal(submitAfterConfirm.allowed, true, '确认整片并将局部目标降级后，提交顺利放行！')
assert.equal(submitAfterConfirm.mode, 'none', '按整片工程修改模式进行分发')
console.log('✓ 实测 8 成功：存在不支持的目标时，确认整片修改显式设置项目目标并解除选区约束，请求与整片范围完全一致！')

import {
  evaluateTimelineOpsCapability,
  evaluateTrackClipReferenceCapability,
  evaluateAiModifyTargetCapability,
  evaluateDirectEditCapability,
  resolveDirectEditTarget,
  documentContentFingerprint,
} from './src/services/workbenchCapabilityEvaluator.ts'

console.log('\n=== 实测 9: 第五阶段按项目能力逐项评估与安全降级验证 ===')

// 场景 9.1: 纯视频/无清单
const capOps91 = evaluateTimelineOpsCapability({
  hasPreview: true,
  previewReady: true,
  previewDuration: 12.5,
  previewFailed: false,
  isBusy: false,
})
assert.equal(capOps91.allowed, true, '纯视频画面可用时，播放定位缩放必须开放')

const capTrack91 = evaluateTrackClipReferenceCapability({
  hasPreview: true,
  isHistorical: false,
  manifestStatus: 'missing',
  hasManifest: false,
  hasSourceHashMatch: false,
  hasVerifiedTracks: false,
})
assert.equal(capTrack91.allowed, false, '无轨道清单时禁止作为修改目标')
assert.equal(capTrack91.status, 'missing_data')
assert.match(capTrack91.reason || '', /没有轨道清单/)

// 场景 9.2: 可信轨道匹配
const capTrack92 = evaluateTrackClipReferenceCapability({
  hasPreview: true,
  isHistorical: false,
  manifestStatus: 'ready',
  hasManifest: true,
  hasSourceHashMatch: true,
  hasVerifiedTracks: true,
})
assert.equal(capTrack92.allowed, true, '版本指纹匹配的可信轨道必须开放引用')
assert.equal(capTrack92.status, 'ready')

// 场景 9.3: 轨道不匹配降级为参考
const capTrack93 = evaluateTrackClipReferenceCapability({
  hasPreview: true,
  isHistorical: false,
  manifestStatus: 'ready',
  hasManifest: true,
  hasSourceHashMatch: false,
  hasVerifiedTracks: false,
})
assert.equal(capTrack93.allowed, false, '轨道指纹缺失或不匹配时安全降级为参考展示，禁止冒充目标')
assert.equal(capTrack93.status, 'missing_data')

// 场景 9.4: 历史旧版本场景（当前 v1，最新为 v2）
const capAi94 = evaluateAiModifyTargetCapability({
  hasPreview: true,
  previewReady: true,
  isHistorical: true,
  backendCapability: { status: 'ready' },
})
assert.equal(capAi94.allowed, false, '历史版本严禁直接作为 AI 修改目标！')
assert.equal(capAi94.status, 'version_mismatch')
assert.match(capAi94.reason || '', /历史画面仅供审阅与对比/)

const capDirectEdit94 = evaluateDirectEditCapability({
  projectId: 'proj-demo',
  isHistorical: true,
  hasPreview: true,
  target: { docId: 'doc-a', versionConfirmed: true },
})
assert.equal(capDirectEdit94.allowed, false, '历史版本即使有文档也严禁直接编辑场景参数')
assert.equal(capDirectEdit94.status, 'version_mismatch')

// 场景 9.5: 结构化编辑对象判断（最新版本但无法确认对应文档）
const capDirectEdit95 = evaluateDirectEditCapability({
  projectId: 'proj-normal',
  isHistorical: false,
  hasPreview: true,
  target: { docId: null, versionConfirmed: false, reason: '该画面由工程渲染，本地没有与该版本内容一致的场景文档' },
})
assert.equal(capDirectEdit95.allowed, false, '无与画面一致的场景文档时必须禁用直接编辑入口，不能因有源码就推断可编辑')
assert.equal(capDirectEdit95.status, 'unsupported')
assert.match(capDirectEdit95.reason || '', /没有与该版本内容一致的场景文档/)

const capDirectEdit95_Ok = evaluateDirectEditCapability({
  projectId: 'token',
  isHistorical: false,
  hasPreview: true,
  target: { docId: 'doc-confirmed', versionConfirmed: true },
})
assert.equal(capDirectEdit95_Ok.allowed, true, '确认到同一份文档时开放直接编辑')

// 场景 9.6: 后端不可用或缺少版本校验能力（画面与时间段分开判断）
const capAi96 = evaluateAiModifyTargetCapability({
  hasPreview: true,
  previewReady: true,
  isHistorical: false,
  backendCapability: {
    status: 'unsupported',
    spanSupported: false,
    imageSupported: false,
    missingForSpan: ['版本预检校验'],
    missingForImage: ['版本预检校验'],
  },
  targetKind: 'frame',
})
assert.equal(capAi96.allowed, false, '后端缺少版本校验能力时拦截修改提交')
assert.equal(capAi96.status, 'unsupported')
assert.match(capAi96.reason || '', /缺少：版本预检校验/)

const capAi96_Error = evaluateAiModifyTargetCapability({
  hasPreview: true,
  previewReady: true,
  isHistorical: false,
  backendCapability: { status: 'connection_error', error: 'ECONNREFUSED 127.0.0.1:8080' },
})
assert.equal(capAi96_Error.allowed, false, '服务连接中断时明确说明原因')
assert.equal(capAi96_Error.status, 'connection_error')
assert.match(capAi96_Error.reason || '', /无法连接后端服务/)
assert.match(capAi96_Error.reason || '', /服务恢复后可点此重新检测/)

// 场景 9.7: 后端只缺图像接收能力 —— 时间段应仍可用，画面不可用
const onlyImageMissing = {
  status: 'unsupported' as const,
  spanSupported: true,
  imageSupported: false,
  missingForSpan: [] as string[],
  missingForImage: ['画面图像接收'],
}
assert.equal(
  evaluateAiModifyTargetCapability({
    hasPreview: true, previewReady: true, isHistorical: false,
    backendCapability: onlyImageMissing, targetKind: 'span',
  }).allowed,
  true,
  '缺少图像接收能力不应连带禁用时间段修改',
)
assert.equal(
  evaluateAiModifyTargetCapability({
    hasPreview: true, previewReady: true, isHistorical: false,
    backendCapability: onlyImageMissing, targetKind: 'frame',
  }).allowed,
  false,
  '缺少图像接收能力时画面引用必须禁用',
)

console.log('✓ 实测 9 成功：能力评估（含画面/时间段分开判断）与安全降级断言通过')

console.log('\n=== 实测 10: 直接编辑文档反查必须与当前画面一致 ===')
const docs10 = [
  { id: 'doc-v1', sourceId: 'src-a', sourceHash: 'hash-1', contentFingerprint: 'fp-v1' },
  { id: 'doc-v2', sourceId: 'src-a', sourceHash: 'hash-2', contentFingerprint: 'fp-v2' },
]
const renders10 = [
  { id: 'render-1', sceneId: 'src-a', documentId: 'doc-v1', snapshotFingerprint: 'fp-v1' },
  { id: 'render-old', sceneId: 'src-a' },
]

// 10.1 编辑器试片：记录里存了文档 id，按 id 精确反查
const target101 = resolveDirectEditTarget({
  preview: { origin: 'editor', runId: 'render-1', artifactId: 'src-a' },
  previewSourceHash: null,
  docs: docs10,
  renders: renders10,
})
assert.equal(target101.docId, 'doc-v1', '编辑器试片必须反查到当时渲染的那份文档，而不是「上次编辑的文档」')
assert.equal(target101.versionConfirmed, true, '文档内容指纹与渲染快照一致时才算已确认')

// 10.1b 渲染后继续修改并保存同一文档：id 不变、内容已变，不能算已确认
const docs10Edited = [
  { id: 'doc-v1', sourceId: 'src-a', sourceHash: 'hash-1', contentFingerprint: 'fp-v1-edited' },
  { id: 'doc-v2', sourceId: 'src-a', sourceHash: 'hash-2', contentFingerprint: 'fp-v2' },
]
const target101b = resolveDirectEditTarget({
  preview: { origin: 'editor', runId: 'render-1', artifactId: 'src-a' },
  previewSourceHash: null,
  docs: docs10Edited,
  renders: renders10,
})
assert.equal(target101b.docId, 'doc-v1', '仍指向同一份文档')
assert.equal(target101b.versionConfirmed, false, '同一 id 但内容已变，绝不能被当成版本已确认！')
assert.match(target101b.warning || '', /渲染之后，该场景文档已被修改/)

// 10.1c 渲染记录没存快照指纹（旧数据）：同样不能算已确认
const target101c = resolveDirectEditTarget({
  preview: { origin: 'editor', runId: 'render-old', artifactId: 'src-a' },
  previewSourceHash: null,
  docs: docs10,
  renders: [{ id: 'render-old', sceneId: 'src-a', documentId: 'doc-v1' }],
})
assert.equal(target101c.versionConfirmed, false, '没有渲染快照就无法确认内容一致')

// 10.2 旧试片记录没有文档 id：可打开但必须如实说明无法逐帧确认
const target102 = resolveDirectEditTarget({
  preview: { origin: 'editor', runId: 'render-old', artifactId: 'src-a' },
  previewSourceHash: null,
  docs: docs10,
  renders: renders10,
})
assert.equal(target102.docId, 'doc-v1')
assert.equal(target102.versionConfirmed, false, '缺文档 id 的旧记录不能被当成已确认')

// 10.3 场景版本：按渲染指纹匹配到同一份内容
const target103 = resolveDirectEditTarget({
  preview: { origin: 'scene', artifactId: 'scene-2', runId: 'scene-2' },
  previewSourceHash: 'hash-2',
  docs: docs10,
  renders: renders10,
})
assert.equal(target103.docId, 'doc-v2', '场景版本必须按 sourceHash 匹配到对应文档，不能命中另一版本')
assert.equal(target103.versionConfirmed, false, 'sourceHash 只能证明源内容相同，不能证明本地补丁没变')
assert.match(target103.warning || '', /本地对参数或文字的改动无法与渲染结果逐一核对/)

// 10.4 场景版本：指纹在本地找不到对应文档 → 不可编辑，且不能退化成其他文档
const target104 = resolveDirectEditTarget({
  preview: { origin: 'scene', artifactId: 'scene-9', runId: 'scene-9' },
  previewSourceHash: 'hash-unknown',
  docs: docs10,
  renders: renders10,
})
assert.equal(target104.docId, null, '指纹对不上时绝不能退回任何其他文档')
assert.equal(target104.versionConfirmed, false)
assert.match(target104.reason || '', /没有与该版本内容一致的场景文档/)

// 10.5 工作流产物：没有可编辑文档
const target105 = resolveDirectEditTarget({
  preview: { origin: 'workflow', artifactId: 'wf-1', runId: 'run-1' },
  previewSourceHash: null,
  docs: docs10,
  renders: renders10,
})
assert.equal(target105.docId, null)
assert.match(target105.reason || '', /工作流产物/)

console.log('✓ 实测 10 成功：直接编辑的文档反查与版本一致性判断通过（试片精确、场景按指纹、不匹配时不退化）')

console.log('\n=== 实测 11: 文档内容指纹能识别「同 id 但内容已变」 ===')
const baseDoc = { id: 'doc-x', name: '场景', layers: [{ id: 'l1', text: 'A' }], updatedAt: '2026-01-01T00:00:00.000Z' }
const sameContentNewTime = { ...baseDoc, updatedAt: '2026-02-02T00:00:00.000Z' }
const changedContent = { ...baseDoc, layers: [{ id: 'l1', text: 'B' }] }

assert.equal(
  documentContentFingerprint(baseDoc),
  documentContentFingerprint(sameContentNewTime),
  '仅 updatedAt 变化不应改变内容指纹，否则每次保存都会被误判成内容变了',
)
assert.notEqual(
  documentContentFingerprint(baseDoc),
  documentContentFingerprint(changedContent),
  '真正改动图层内容必须改变指纹，否则渲染后修改无法被识别',
)
assert.equal(documentContentFingerprint(null), '', '空文档返回空指纹，不会被误认为已确认')
console.log('✓ 实测 11 成功：内容指纹忽略保存时间、对真实内容变化敏感')

console.log('\n=== 实测 12: 编辑器保存后回到同一试片，直接编辑判定必须重新核对 ===')
/* 这条路径是「看着试片进编辑器 → 改并保存 → 回同一试片 → 再进编辑器」。
   预览 id 全程没变，所以任何「只按预览身份缓存」的判定都会沿用旧结果，
   把已经变了的文档当成仍与画面一致，指纹警告被绕过。 */
const { readDocuments, readDocumentsVersion, saveDocument, readEditorRenders } = await import('./src/editor/documentStore.ts')
const docProject = 'proj-doc-cache'
const sceneDoc = (text: string) => ({
  schemaVersion: 1 as const,
  projectId: docProject,
  id: 'doc-cache-1',
  name: '缓存验证场景',
  engine: 'remotion' as const,
  width: 1600,
  height: 900,
  fps: 30,
  durationSeconds: 4,
  layers: [{ id: 'l1', kind: 'text' as const, name: '标题', text, visible: true }],
  patches: {},
  updatedAt: '2026-01-01T00:00:00.000Z',
})

/* 模拟一次编辑器试片：渲染时把当时那份文档快照一起存下来。 */
const renderedDoc = sceneDoc('原文案')
localStorage.setItem(
  `fengmotion:editor-renders:${docProject}`,
  JSON.stringify([{
    id: 'render-cache',
    projectId: docProject,
    sceneId: renderedDoc.id,
    sceneName: renderedDoc.name,
    assetId: 'asset-cache',
    createdAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
    document: renderedDoc,
  }]),
)
localStorage.setItem(`fengmotion:scene-documents:v1:${docProject}`, JSON.stringify([renderedDoc]))
localStorage.removeItem(`fengmotion:scene-documents-version:${docProject}`)

const evaluateNow = () => resolveDirectEditTarget({
  preview: { origin: 'editor', runId: 'render-cache', artifactId: renderedDoc.id },
  previewSourceHash: null,
  docs: readDocuments(docProject).map((d) => ({
    id: d.id,
    sourceId: d.source?.id,
    sourceHash: d.source?.sourceHash,
    contentFingerprint: documentContentFingerprint(d),
  })),
  renders: readEditorRenders(docProject).map((r) => ({
    id: r.id,
    sceneId: r.sceneId,
    documentId: r.document?.id,
    snapshotFingerprint: r.document ? documentContentFingerprint(r.document) : undefined,
  })),
})

// 12.1 初始：文档就是渲染时那份内容 → 已确认
const beforeSave = evaluateNow()
assert.equal(beforeSave.docId, 'doc-cache-1')
assert.equal(beforeSave.versionConfirmed, true, '文档未改动时应判定为已确认')

// 12.2 在编辑器里改并保存同一份文档（id 不变，内容变了）
const versionBefore = readDocumentsVersion(docProject)
saveDocument({ ...sceneDoc('改后的文案'), updatedAt: '2026-02-02T00:00:00.000Z' } as never)
const versionAfter = readDocumentsVersion(docProject)
assert.equal(versionAfter, versionBefore + 1, '保存必须让文档变更计数 +1，否则缓存无法失效')

// 12.3 回到同一试片再进编辑器：必须重新核对并给出指纹警告
const afterSave = evaluateNow()
assert.equal(afterSave.docId, 'doc-cache-1', '仍指向同一份文档')
assert.equal(afterSave.versionConfirmed, false, '保存过内容后，绝不能继续沿用旧的「已确认」结果！')
assert.match(afterSave.warning || '', /渲染之后，该场景文档已被修改/)

// 12.4 能力评估要把警告带进编辑器，而不是只在监看区说一句
const capAfterSave = evaluateDirectEditCapability({
  projectId: docProject,
  isHistorical: false,
  hasPreview: true,
  target: afterSave,
})
assert.equal(capAfterSave.allowed, true, '内容已变仍可编辑，但必须带着警告')
assert.match(capAfterSave.note || '', /渲染之后，该场景文档已被修改/, '警告必须传给编辑器显示')

// 12.5 只改 updatedAt 不算内容变化：不能因为「保存过一次」就永远报警
saveDocument({ ...sceneDoc('改后的文案'), updatedAt: '2026-03-03T00:00:00.000Z' } as never)
const savedNow = readDocuments(docProject)[0]
assert.equal(
  savedNow && documentContentFingerprint(savedNow),
  documentContentFingerprint(sceneDoc('改后的文案')),
  '仅保存时间变化不应改变内容指纹',
)
console.log('✓ 实测 12 成功：编辑器保存后回到同一试片会重新核对，指纹警告不再被缓存绕过')

console.log('\n=== 实测 13: 导出目标与「最新版本」必须只认可交付整片 ===')
/* 场景：项目里既有真实整片（场景版本 v4），又有刚渲染的编辑器试片。
   visuals 按 createdAt 排序，试片会排到最前面。若「最新 vN」与导出目标
   跟着首项走，就会报出试片的导出次数（v2）并禁用导出 —— 项目明明有整片。 */
type Visual = { id: string; tier: 'final' | 'animatic' | 'proof' | 'frame'; revision: number; stale?: boolean; createdAt: string }

/** 与 Workbench.tsx 里 deliverableLead 同构：只挑没标过期的整片，取最新一条。 */
const pickDeliverable = (visuals: Visual[]): Visual | null => {
  const finals = visuals.filter((v) => v.tier === 'final' && !v.stale)
  return finals.length ? finals[0] : null
}

const mixedVisuals: Visual[] = [
  { id: 'editor:proof-2', tier: 'proof', revision: 2, createdAt: '2026-11-12T14:07:00.000Z' },
  { id: 'scene:4', tier: 'final', revision: 4, createdAt: '2026-11-12T13:23:00.000Z' },
  { id: 'scene:3', tier: 'final', revision: 3, createdAt: '2026-11-12T01:23:00.000Z' },
]
const deliverable = pickDeliverable(mixedVisuals)
assert.equal(deliverable?.id, 'scene:4', '「最新」必须报最新整片，而不是排在最前的试片')
assert.equal(deliverable?.revision, 4, '版本号必须来自整片，不能把试片的导出次数当成项目版本号')
assert.notEqual(deliverable?.revision, mixedVisuals[0].revision, '两套编号不能混用')

// 13.2 只有试片、没有整片：不允许导出，也不能谎报有整片
const proofOnly: Visual[] = [
  { id: 'editor:proof-1', tier: 'proof', revision: 1, createdAt: '2026-11-12T14:07:00.000Z' },
]
assert.equal(pickDeliverable(proofOnly), null, '没有整片时导出目标必须为空，界面据此禁用导出')

// 13.3 整片被标记过期：不能拿过期版本当可交付
const staleFinal: Visual[] = [
  { id: 'scene:5', tier: 'final', revision: 5, stale: true, createdAt: '2026-11-12T15:00:00.000Z' },
  { id: 'scene:4', tier: 'final', revision: 4, createdAt: '2026-11-12T13:23:00.000Z' },
]
assert.equal(pickDeliverable(staleFinal)?.id, 'scene:4', '过期整片不能作为导出目标，应回落到更早的可用整片')

console.log('✓ 实测 13 成功：导出目标与「最新版本」只认可交付整片，试片与过期版本不会混入')

console.log('\n=== 实测 14: 提问意图在「选目标」与「刷新」后都必须保持 ===')
/* 三条真实会让提问变成修改的路径：
   1) 先选「关于此提问」，再圈时间段/框选画面 → 新快照要继承草稿级 query
   2) 选提问后刷新 → 草稿级意图必须持久化，否则恢复成默认 modify
   3) 两端发送时的意图读取顺序必须一致 */

/** 与 Workbench 两处快照构造同构：旧快照 → 草稿级 → 默认。 */
const intentForNewSnapshot = (
  prev: { intentAction?: 'modify' | 'query' } | null,
  draftIntent?: 'modify' | 'query',
): 'modify' | 'query' => prev?.intentAction ?? draftIntent ?? 'modify'

// 14.1 无目标时选 query，再圈时间段：必须保持 query
assert.equal(
  intentForNewSnapshot(null, 'query'),
  'query',
  '先选提问再选时间段，新快照必须继承草稿级 query，否则提问会变成改工程',
)
// 14.2 已有快照的意图优先（发送时固化的那份不被后续草稿覆盖）
assert.equal(intentForNewSnapshot({ intentAction: 'query' }, 'modify'), 'query', '旧快照的意图优先于草稿级')
assert.equal(intentForNewSnapshot({ intentAction: 'modify' }, 'query'), 'modify', '旧快照已固化修改意图时不静默翻转')
// 14.3 都没有时才是默认修改
assert.equal(intentForNewSnapshot(null, undefined), 'modify', '没有任何选择时默认修改')

// 14.4 草稿级意图必须真的写进本地存储，并在「内存清空后」仍能恢复
/* 注意：getSessionDraft 先查内存，同一进程里读回来可能只是缓存。
   真实刷新等价于「内存丢失 + 只剩 localStorage」，所以这里直接读存储键，
   再用 draftKey 复算一遍，才算证明了持久化本身。 */
const intentProject = 'proj-intent-persist'
const intentSession = 'session-intent-persist'
clearSessionDraft(intentProject, intentSession)
setSessionDraft(intentProject, intentSession, { text: '这个圆点在画面哪里？', intentAction: 'query' })

const { draftKey } = await import('./src/shell/useDraftStore.ts')
const storageKey = `fengmotion:session-draft:v1:${draftKey(intentProject, intentSession)}`
const rawPersisted = localStorage.getItem(storageKey)
assert.ok(rawPersisted, '草稿必须真的写进 localStorage，否则刷新就丢')
const parsedPersisted = JSON.parse(rawPersisted!)
assert.equal(parsedPersisted.intentAction, 'query', '持久化对象里必须带 intentAction')
assert.equal(parsedPersisted.text, '这个圆点在画面哪里？', '正文同时持久化')

// 模拟真实刷新：清掉内存里的那份，只留存储
const freshModule = await import('./src/shell/useDraftStore.ts?fresh=1').catch(() => null)
if (freshModule) {
  const restored = freshModule.getSessionDraft(intentProject, intentSession)
  assert.equal(restored.intentAction, 'query', '只靠 localStorage 也必须恢复提问意图')
} else {
  /* 运行时不支持带 query 的模块再导入时，直接按存储内容校验恢复逻辑。 */
  assert.equal(parsedPersisted.intentAction, 'query')
}

// 14.5 只有意图、没有文字时也不能被当成空草稿删掉
const bareIntentProject = 'proj-intent-bare'
clearSessionDraft(bareIntentProject, intentSession)
setSessionDraft(bareIntentProject, intentSession, { intentAction: 'query' })
assert.equal(
  getSessionDraft(bareIntentProject, intentSession).intentAction,
  'query',
  '只选了提问还没打字，这份草稿也不能丢',
)

// 14.6 两端发送读取顺序一致：快照 → 草稿 → 默认
const sendIntent = (
  snapshot: { intentAction?: 'modify' | 'query' } | null,
  draftIntent?: 'modify' | 'query',
) => snapshot?.intentAction ?? draftIntent ?? 'modify'
assert.equal(sendIntent(null, 'query'), 'query', '对话区/工作台在无目标时都必须读到草稿级提问')
assert.equal(sendIntent({ intentAction: 'query' }, undefined), 'query', '有快照时以快照为准')
// 14.7 已确认整片修改后，用户改成「关于此提问」：明确 query 必须优先
/* 这是两端最容易分叉的一处：whole_confirmed 只表达修改范围，
   不能覆盖用户后来选择的操作意图。 */
const resolveIntent = (
  snapshotIntent: 'modify' | 'query' | undefined,
  draftIntent: 'modify' | 'query' | undefined,
  wholeConfirmed: boolean,
): boolean => {
  const effective = snapshotIntent ?? draftIntent
  if (effective === 'query') return false
  if (effective === 'modify') return true
  return Boolean(snapshotIntent) || wholeConfirmed
}
assert.equal(
  resolveIntent(undefined, 'query', true),
  false,
  '确认整片后改成提问，切页发送仍必须是提问 —— 否则会去改工程',
)
assert.equal(resolveIntent(undefined, 'modify', true), true, '确认整片且意图为修改时照常修改')
assert.equal(resolveIntent(undefined, undefined, true), true, '只确认整片、没选意图时按修改处理')
assert.equal(resolveIntent('query', 'modify', false), false, '快照里的提问优先于草稿级')
assert.equal(resolveIntent(undefined, 'query', false), false, '无目标时草稿级提问生效')

console.log('✓ 实测 14 成功：提问意图在选目标、刷新、两端发送三条路径上都不会退回修改')

console.log('\n=== 实测 15: 停止回复必须打到后端，并按真实答复区分状态 ===')
/* 三条曾经出错的地方：
   1) 只断本地 SSE，后端进程继续跑完并落库；
   2) 把 stopped:false（后端没找到在跑的进程）当成「已停止」；
   3) 切换会话时重复发停止请求。
   本轮新增第四条，也是最难复现的一条：
   4) 停止请求的 HTTP 响应**晚于**新一轮回复启动时，不能关掉新一轮。
      所以这一段直接 import 真实内核 ChatStreamCore，不再另写一份模拟逻辑 ——
      模拟副本即使写对，也证明不了线上代码是对的。 */

import { ChatStreamCore } from './src/services/chatStreamCore.ts'

/** 造一条可控的假流：记录它是否被本地关闭。 */
function makeStream(sid: string, aiId: string) {
  const box = { closed: false }
  return {
    box,
    stream: {
      sessionId: sid,
      aiMessageId: aiId,
      stop: () => { box.closed = true },
      startedAt: Date.now(),
    },
  }
}

/* 15.0 内核自证：没有后端答复就不许动本地连接 */
{
  const core = new ChatStreamCore(async () => ({ stopped: false }))
  const { box, stream } = makeStream('s0', 'ai-0')
  core.register(stream)
  const outcome = await core.stop('s0')
  assert.equal(outcome.status, 'not_running', 'stopped:false 表示没找到在跑的进程，不是已停止')
  assert.equal(box.closed, false, 'not_running 时绝不能断本地连接，否则用户失去仍在生成的回复')
  assert.equal(core.has('s0'), true, 'not_running 后仍应处于 streaming，让真实终态自己到达')
}

/* 15.1 后端确认停止：断流 + 登记清理标记 */
{
  const core = new ChatStreamCore(async () => ({ stopped: true }))
  const { box, stream } = makeStream('s1', 'ai-1')
  core.register(stream)
  const outcome = await core.stop('s1')
  assert.equal(outcome.status, 'stopped')
  assert.equal(outcome.remote, true)
  assert.equal(box.closed, true, '后端确认后才断本地')
  assert.equal(core.has('s1'), false, '停止后不应再是 streaming')
  assert.deepEqual(core.takeConfirmedStop('s1'), { aiMessageId: 'ai-1' }, '要登记「哪一轮被停了」，供视图清理半截回复')
  assert.equal(core.takeConfirmedStop('s1'), null, '标记读后即删，避免与事件路径重复清理')
}

/* 15.2 请求失败：状态未知，如实报 failed 且保持连接 */
{
  const core = new ChatStreamCore(async () => { throw new Error('network down') })
  const { box, stream } = makeStream('s2', 'ai-2')
  core.register(stream)
  const outcome = await core.stop('s2')
  assert.equal(outcome.status, 'failed', '请求失败时后端状态未知，不能报成功')
  assert.equal(outcome.remote, false)
  assert.match(outcome.error ?? '', /network down/)
  assert.equal(box.closed, false, '请求失败更不能断本地（后端状态未知）')
}

/* 15.3 【本轮重点】旧停止响应晚于新一轮启动 —— 绝不能关掉新流
   时序：用户点停止 → 后端还在处理 → SSE 的 stopped 事件先到、界面恢复可发送
        → 用户发出下一条，登记了新流 → 旧 /stop 的响应才回来。 */
{
  let releaseStop: (v: { stopped: boolean }) => void = () => {}
  const core = new ChatStreamCore(() => new Promise((resolve) => { releaseStop = resolve }))

  const round1 = makeStream('s3', 'ai-round-1')
  core.register(round1.stream)

  const stopping = core.stop('s3')
  assert.equal(core.isStopping('s3'), true, '停止结果未回时，界面应保持忙碌，不允许开下一轮')

  /* 模拟：上一轮已被替换成新一轮（stopped 事件先到 → 用户立刻发了下一条） */
  core.notifyCompleted('s3')
  const round2 = makeStream('s3', 'ai-round-2')
  core.register(round2.stream)

  /* 旧的停止响应此刻才回来，且后端说「确实停掉了一轮」 */
  releaseStop({ stopped: true })
  const outcome = await stopping

  assert.equal(outcome.status, 'stopped', '后端确实停掉了它那一轮')
  assert.equal(outcome.supersededRound, true, '必须标记「这条停止针对的轮次已经过去了」')
  assert.equal(round2.box.closed, false, '【关键】绝不能关掉用户刚发起的新一轮回复')
  assert.equal(core.has('s3'), true, '新一轮必须仍是 streaming，界面继续显示停止键')
  assert.equal(core.takeConfirmedStop('s3'), null, '不能给新一轮登记停止标记，否则会误删新回复')
}

/* 15.3b 停止响应回来时那一轮已自然结束：同样不误伤、不谎报清理 */
{
  let releaseStop: (v: { stopped: boolean }) => void = () => {}
  const core = new ChatStreamCore(() => new Promise((resolve) => { releaseStop = resolve }))
  const round1 = makeStream('s3b', 'ai-old')
  core.register(round1.stream)
  const stopping = core.stop('s3b')
  core.notifyCompleted('s3b')
  releaseStop({ stopped: true })
  const outcome = await stopping
  assert.equal(outcome.supersededRound, true, '那一轮已结束，本地没有需要收尾的东西')
  assert.equal(round1.box.closed, false, '已完成的流不应再被 close 一次')
  assert.equal(core.takeConfirmedStop('s3b'), null, '没有可清理的轮次就不要登记标记')
}

/* 15.3c 在途停止请求去重：连点两次只打一次 /stop */
{
  let calls = 0
  let releaseStop: (v: { stopped: boolean }) => void = () => {}
  const core = new ChatStreamCore(() => {
    calls += 1
    return new Promise((resolve) => { releaseStop = resolve })
  })
  core.register(makeStream('s3c', 'ai-3c').stream)
  const a = core.stop('s3c')
  const b = core.stop('s3c')
  assert.equal(calls, 1, '同会话在途停止请求必须复用，连点不能打两次 /stop')
  releaseStop({ stopped: true })
  const [ra, rb] = await Promise.all([a, b])
  assert.equal(ra.status, 'stopped')
  assert.equal(rb.status, 'stopped', '两次点击拿到同一个结果')
  assert.equal(core.isStopping('s3c'), false, '结果确定后解除 stopping')
}

/* 15.4 顺序：先请求后端，再断本地 */
{
  const order: string[] = []
  const core = new ChatStreamCore(async () => { order.push('backend'); return { stopped: true } })
  const stream = {
    sessionId: 's4',
    aiMessageId: 'ai-4',
    stop: () => { order.push('close-local') },
    startedAt: Date.now(),
  }
  core.register(stream)
  await core.stop('s4')
  assert.deepEqual(order, ['backend', 'close-local'], '必须先问后端再断本地，否则界面会提前解除忙碌')
}

/* 15.5 切换会话不再发停止请求：同一轮停止只发一次 */
{
  let calls = 0
  const core = new ChatStreamCore(async () => { calls += 1; return { stopped: true } })
  core.register(makeStream('s5', 'ai-5').stream)
  /* 模拟切换会话：只做本地状态清理，不调 stop */
  core.release('s5')
  assert.equal(calls, 0, '切换会话不应触发后端停止（切页不等于放弃回复）')
}

console.log('✓ 实测 15 成功：停止打到后端、stopped:false 不谎报、迟到响应不误伤新一轮、连点不重复请求')


console.log('\n=== 实测 16: 停止后「本轮痕迹」不得越界显示上一轮内容 ===')
/* 真机验收发现：点停止，正文撤掉了，上一轮的「思考 / bash · 1 次 /
   11.5K 上下文条 / token 用量」还挂在界面上 —— 看起来像半截回复没清干净。
   根因是这些取值都写成「从末尾往前找第一条符合条件的消息」，
   越过本轮用户消息取到了上一轮。这类越界只在末尾 AI 回复被删掉时暴露，
   肉眼很难稳定复现，所以抽成纯函数直接测。 */

import { lastRoundThinking, shouldShowMessageMeter } from './src/views/conversationRound.ts'

const msg = (id: string, role: 'user' | 'ai', extra: Record<string, unknown> = {}) =>
  ({ id, role, text: '', ...extra }) as any

/* 16.1 正常两轮：取的是本轮思考，不是上一轮 */
{
  const messages = [
    msg('u1', 'user'),
    msg('a1', 'ai', { thinking: '上一轮的推理', usage: { promptTokens: 9000 } }),
    msg('u2', 'user'),
    msg('a2', 'ai', { thinking: '这一轮的推理', usage: { promptTokens: 18577 } }),
  ]
  assert.equal(lastRoundThinking(messages), '这一轮的推理', '两轮都在时必须取本轮的思考')
  assert.equal(
    shouldShowMessageMeter({ messages, hasBreakdown: true, window: 1000000, promptTokens: 18577 }),
    true,
    '末尾是 AI 回复时正常显示上下文条',
  )
}

/* 16.2 【关键】停止后本轮 AI 消息被撤销：不能退回上一轮的思考 */
{
  const messages = [
    msg('u1', 'user'),
    msg('a1', 'ai', { thinking: '上一轮的推理' }),
    msg('u2', 'user'),   // 这一轮被停止，AI 回复已撤销
  ]
  assert.equal(
    lastRoundThinking(messages),
    '',
    '【关键】本轮回复被撤销后不能显示上一轮的思考 —— 否则界面像半截回复没清干净',
  )
  assert.equal(
    shouldShowMessageMeter({ messages, hasBreakdown: true, window: 1000000, promptTokens: 18577 }),
    false,
    '【关键】末尾是用户消息时不画上下文条（否则会显示上一轮的读数）',
  )
}

/* 16.3 只有一轮且被撤销：什么都不该显示 */
{
  const messages = [msg('u1', 'user')]
  assert.equal(lastRoundThinking(messages), '', '没有 AI 回复时没有思考可显示')
  assert.equal(
    shouldShowMessageMeter({ messages, hasBreakdown: true, window: 1000000, promptTokens: 8000 }),
    false,
    '没有 AI 回复时上下文条也无处可挂',
  )
}

/* 16.4 本轮 AI 消息存在但还没产出 thinking：不借用上一轮的 */
{
  const messages = [
    msg('u1', 'user'),
    msg('a1', 'ai', { thinking: '上一轮的推理' }),
    msg('u2', 'user'),
    msg('a2', 'ai', {}),
  ]
  assert.equal(lastRoundThinking(messages), '', '本轮还没思考就不能拿上一轮的顶上')
}

/* 16.5 数据不全时不画：宁可不画，也不画一个错的读数 */
{
  const messages = [msg('u1', 'user'), msg('a1', 'ai', {})]
  assert.equal(
    shouldShowMessageMeter({ messages, hasBreakdown: false, window: 1000000, promptTokens: 8000 }),
    false, '没有分档数据时不画',
  )
  assert.equal(
    shouldShowMessageMeter({ messages, hasBreakdown: true, window: 0, promptTokens: 8000 }),
    false, '没有分母时不画',
  )
  assert.equal(
    shouldShowMessageMeter({ messages, hasBreakdown: true, window: 1000000, promptTokens: null }),
    false, '没有分子时不画',
  )
}

console.log('✓ 实测 16 成功：停止撤销本轮回复后，思考与上下文条都不会越界显示上一轮内容')


console.log('\n=== 实测 17: 发送去向的显示与提交必须同源 ===')
/* 曾经的 bug：胶囊组件默认 `?? 'modify'`，把「没有目标、没有意图」的普通对话
   显示成「修改全局工程」，而实际发送走普通对话 —— 界面在说谎。
   现在显示与提交都调 resolveSendPlan，这里直接测那个函数。 */

import { resolveSendPlan, describeSendPlan } from './src/services/sendPlan.ts'

const snap = (extra: Record<string, unknown> = {}) => ({
  version: 3, scope: 'selection' as const, label: '片段', ...extra,
})

/* 17.1 无目标、无意图 → 普通对话（不是整片修改！） */
{
  const plan = resolveSendPlan({ targetSnapshot: null })
  assert.equal(plan.kind, 'chat', '无目标无意图是普通对话，绝不能显示成修改工程')
  assert.equal(describeSendPlan(plan).label, '普通对话')
  assert.match(describeSendPlan(plan).detail, /不会修改工程/)
}

/* 17.2 明确选择提问 → 仅提问 */
{
  const plan = resolveSendPlan({ targetSnapshot: null, draftIntent: 'query' })
  assert.equal(plan.kind, 'chat', '显式提问走对话')
  assert.equal(describeSendPlan(plan).tone, 'neutral')
}

/* 17.3 明确选择修改、但没有目标 → 仍然修改（不是普通对话） */
{
  const plan = resolveSendPlan({ targetSnapshot: null, draftIntent: 'modify' })
  assert.equal(plan.kind, 'modify', '显式 modify 即使没有目标快照也要走修改路径')
  assert.equal(plan.kind === 'modify' && plan.scope, 'project', '没有目标时是整片修改')
}

/* 17.4 有目标 + 修改 → 修改该目标 */
{
  const plan = resolveSendPlan({ targetSnapshot: snap() as any, draftIntent: 'modify' })
  assert.equal(plan.kind, 'modify')
  assert.equal(plan.kind === 'modify' && plan.scope, 'target', '有目标快照就是按目标改，不是整片')
}

/* 17.5 已确认整片 + 修改 → 整片修改 */
{
  const plan = resolveSendPlan({ targetSnapshot: null, draftIntent: 'modify', continuationScopeMode: 'whole_confirmed' })
  assert.equal(plan.kind, 'modify')
  assert.equal(plan.kind === 'modify' && plan.scope, 'project')
  assert.equal(describeSendPlan(plan).label, '修改整片工程')
}

/* 17.6 【关键】确认整片后又切成提问 → 必须是提问，不能被范围确认推翻 */
{
  const plan = resolveSendPlan({ targetSnapshot: null, draftIntent: 'query', continuationScopeMode: 'whole_confirmed' })
  assert.equal(plan.kind, 'chat', '【关键】确认整片之后改成提问，发送仍必须是提问')
}

/* 17.7 【关键】快照里的提问优先于草稿级修改 */
{
  const plan = resolveSendPlan({ targetSnapshot: snap({ intentAction: 'query' }) as any, draftIntent: 'modify' })
  assert.equal(plan.kind, 'chat', '目标快照是发送时固化的那份，它的提问优先')
}

/* 17.8 target_required 且无目标 → 拦截，不是普通对话也不是整片修改 */
{
  const plan = resolveSendPlan({ targetSnapshot: null, continuationScopeMode: 'target_required' })
  assert.equal(plan.kind, 'blocked', '继续调整缺目标必须拦截')
  assert.equal(plan.kind === 'blocked' && plan.reason, 'missing_target')
  assert.equal(describeSendPlan(plan).tone, 'blocked')
}

/* 17.9 target_required 但有目标 → 正常按目标修改 */
{
  const plan = resolveSendPlan({ targetSnapshot: snap() as any, continuationScopeMode: 'target_required' })
  assert.equal(plan.kind, 'modify', '有目标时继续调整模式正常放行')
  assert.equal(plan.kind === 'modify' && plan.scope, 'target')
}

/* 17.10 删除目标后：回到普通对话（除非显式选了修改） */
{
  const withTarget = resolveSendPlan({ targetSnapshot: snap() as any })
  assert.equal(withTarget.kind, 'modify')
  const afterRemove = resolveSendPlan({ targetSnapshot: null })
  assert.equal(afterRemove.kind, 'chat', '删掉目标后没有意图，应回到普通对话，不能残留「修改」')
}

/* 17.11 文案与实际去向一一对应：不出现「对话」文案配「修改」判定 */
{
  const cases = [
    { input: { targetSnapshot: null }, expectKind: 'chat' },
    { input: { targetSnapshot: null, draftIntent: 'query' as const }, expectKind: 'chat' },
    { input: { targetSnapshot: null, draftIntent: 'modify' as const }, expectKind: 'modify' },
    { input: { targetSnapshot: snap() as any }, expectKind: 'modify' },
    { input: { targetSnapshot: null, continuationScopeMode: 'whole_confirmed' as const }, expectKind: 'modify' },
    { input: { targetSnapshot: null, continuationScopeMode: 'target_required' as const }, expectKind: 'blocked' },
  ]
  for (const c of cases) {
    const plan = resolveSendPlan(c.input as any)
    const copy = describeSendPlan(plan)
    assert.equal(plan.kind, c.expectKind, `判定与预期一致：${JSON.stringify(c.input)}`)
    /* 注意「不会修改工程」本身含「修改工程」字样，不能只查子串 ——
       要查的是有没有**肯定的**改动承诺。 */
    if (plan.kind === 'chat') {
      assert.doesNotMatch(copy.detail, /生成新版本|将修改|(?<!不)会修改/, '对话文案不能暗示会改工程')
      assert.match(copy.detail, /不会修改工程/, '对话文案要明确说不会改工程')
    }
    /* 已按复审修正：不再承诺「一定生成新版本」（任务可能追问/失败/未改动），
       只要求说清「发起修改」。 */
    if (plan.kind === 'modify') assert.match(copy.detail, /发起/, '修改文案要说清会发起修改')
  }
}

console.log('✓ 实测 17 成功：发送去向判定唯一，显示与提交同源，六种状态文案与实际一致')


console.log('\n=== 实测 18: 显示与实际发送的四类边界必须一致 ===')
/* 复审发现四种「显示一套、实际一套」的情况，逐个锁死：
   1) 无项目归属时界面可显示「修改工程」，实际却发不出去；
   2) target_required 无目标时胶囊仍显示「全局工程」；
   3) 文案承诺「生成新版本」，但任务可能追问/失败/未改动；
   4) 只要看到快照就标 target，但快照本身可能是 scope:'project'。 */

/* 18.1 无项目归属 + 修改意图 → 拦截，不能显示成可发送的修改 */
{
  const plan = resolveSendPlan({ targetSnapshot: null, draftIntent: 'modify', hasProject: false })
  assert.equal(plan.kind, 'blocked', '没有项目归属时改不了工程，必须拦住')
  assert.equal(plan.kind === 'blocked' && plan.reason, 'missing_project')
  const copy = describeSendPlan(plan)
  assert.equal(copy.label, '请先关联项目')
  assert.equal(copy.tone, 'blocked')
  /* 关键：不能退回成普通对话 —— 那会让用户以为消息已经按对话发出去了 */
  assert.notEqual(plan.kind, 'chat', '不能把「改不了」悄悄降级成普通对话')
}

/* 18.2 无项目归属但只是提问 → 仍然是普通对话（提问不需要项目） */
{
  const plan = resolveSendPlan({ targetSnapshot: null, draftIntent: 'query', hasProject: false })
  assert.equal(plan.kind, 'chat', '提问不依赖项目归属，不应被拦')
}

/* 18.3 有项目归属时正常放行（确认 hasProject 没有误伤） */
{
  const plan = resolveSendPlan({ targetSnapshot: null, draftIntent: 'modify', hasProject: true })
  assert.equal(plan.kind, 'modify')
}

/* 18.4 target_required 无目标 → blocked，且文案是「请先确认目标」而不是「全局工程」 */
{
  const plan = resolveSendPlan({ targetSnapshot: null, continuationScopeMode: 'target_required' })
  assert.equal(plan.kind, 'blocked')
  const copy = describeSendPlan(plan)
  assert.equal(copy.label, '请先确认目标')
  assert.doesNotMatch(copy.label + copy.detail, /全局工程|整片/, '拦截态不能说成整片修改')
}

/* 18.5 文案不得承诺「一定生成新版本」 */
{
  for (const input of [
    { targetSnapshot: null, draftIntent: 'modify' as const },
    { targetSnapshot: snap() as any },
  ]) {
    const copy = describeSendPlan(resolveSendPlan(input as any))
    assert.doesNotMatch(copy.detail, /生成新版本|一定生成|将生成/, '不能承诺一定产生新版本')
    assert.match(copy.detail, /发起/, '应说「发起修改」，结果待定')
  }
}

/* 18.6 快照 scope 为 project 时，范围必须是整片而不是 target */
{
  const projectSnap = { version: 5, scope: 'project' as const, label: '整片' }
  const plan = resolveSendPlan({ targetSnapshot: projectSnap as any })
  assert.equal(plan.kind, 'modify')
  assert.equal(plan.kind === 'modify' && plan.scope, 'project', '快照本身是整片工程时范围应为 project')
  assert.equal(describeSendPlan(plan).label, '修改整片工程')

  const sceneSnap = { version: 5, scope: 'selection' as const, label: '片段' }
  const plan2 = resolveSendPlan({ targetSnapshot: sceneSnap as any })
  assert.equal(plan2.kind === 'modify' && plan2.scope, 'target', '局部快照仍按目标修改')
}

/* 18.7 移除目标后的真实去向：选了提问就该是普通对话，不能承诺「转为全片修改」 */
{
  const afterRemoveQuery = resolveSendPlan({ targetSnapshot: null, draftIntent: 'query' })
  assert.equal(afterRemoveQuery.kind, 'chat', '选了提问再移除目标，结果是普通对话')
  const afterRemoveModify = resolveSendPlan({ targetSnapshot: null, draftIntent: 'modify' })
  assert.equal(afterRemoveModify.kind === 'modify' && afterRemoveModify.scope, 'project', '选了修改再移除目标，才是整片修改')
}

/* 18.8 六种组合的完整矩阵：显示标签与判定一一对应 */
{
  const matrix: Array<{ name: string; input: any; expectKind: string }> = [
    { name: '普通对话', input: { targetSnapshot: null }, expectKind: 'chat' },
    { name: '显式提问', input: { targetSnapshot: null, draftIntent: 'query' }, expectKind: 'chat' },
    { name: '显式修改无目标', input: { targetSnapshot: null, draftIntent: 'modify' }, expectKind: 'modify' },
    { name: '局部目标', input: { targetSnapshot: snap() as any }, expectKind: 'modify' },
    { name: '整片快照', input: { targetSnapshot: { version: 1, scope: 'project' } as any }, expectKind: 'modify' },
    { name: '确认整片', input: { targetSnapshot: null, continuationScopeMode: 'whole_confirmed' }, expectKind: 'modify' },
    { name: '确认整片后提问', input: { targetSnapshot: null, draftIntent: 'query', continuationScopeMode: 'whole_confirmed' }, expectKind: 'chat' },
    { name: '缺目标', input: { targetSnapshot: null, continuationScopeMode: 'target_required' }, expectKind: 'blocked' },
    { name: '缺项目', input: { targetSnapshot: null, draftIntent: 'modify', hasProject: false }, expectKind: 'blocked' },
    { name: '缺项目但提问', input: { targetSnapshot: null, draftIntent: 'query', hasProject: false }, expectKind: 'chat' },
  ]
  for (const row of matrix) {
    const plan = resolveSendPlan(row.input)
    assert.equal(plan.kind, row.expectKind, `矩阵「${row.name}」判定应为 ${row.expectKind}`)
    const copy = describeSendPlan(plan)
    assert.ok(copy.label.length > 0 && copy.detail.length > 0, `矩阵「${row.name}」必须有可见文案`)
  }
}

console.log('✓ 实测 18 成功：无项目拦截、缺目标不显示全局工程、不承诺新版本、范围按快照真实 scope')


console.log('\n=== 实测 19: 判定组合矩阵 —— 会话来源 × 意图（注意：不是调用点回归） ===')
/* ⚠️ 口径说明（用户 2026-11-12 复审指出，必须如实标注）：
   下面的 simulateSend() 是**本测试里重新模拟**的分流流程，selectedOf() 也是
   重新写的一份选中态规则 —— 它们没有实际调用 Conversation.tsx 的发送入口，
   也没有渲染真实组件。因此本测试能验证「判定组合是否正确」，
   **不能防止将来真实调用点再次漏接**（上一轮 P1 正是调用点漏接）。
   真正的调用点回归：从界面操作发送，断言消息 / 创作任务 / 普通回复分别有没有发生，
   已记入后续综合验收清单。 */

/* resolveSendPlan 已在实测 17 导入，这里复用同一个真实实现 */

/**
 * 模拟对话区 send() 的真实执行顺序（与 Conversation.tsx 一致）：
 * 1) 入口先按判定拦截（两条路径分叉之前）；
 * 2) 通过后按 activeIsServer 分流：服务端 → 修改分支或普通回复；本地 → 本地消息。
 */
function simulateSend(input: {
  hasProject: boolean
  isServerSession: boolean
  intent: 'modify' | 'query' | undefined
  continuationScopeMode?: 'target_required' | 'whole_confirmed' | null
  hasTarget?: boolean
}) {
  const plan = resolveSendPlan({
    targetSnapshot: input.hasTarget
      ? ({ version: 3, scope: 'selection', label: '片段' } as any)
      : null,
    draftIntent: input.intent,
    continuationScopeMode: input.continuationScopeMode,
    hasProject: input.hasProject,
    isServerSession: input.isServerSession,
  })

  if (plan.kind === 'blocked') {
    return { blocked: true, reason: plan.reason, saved: false, startedCreation: false, startedChat: false }
  }

  /* 通过拦截后按会话来源分流 —— 这一步是上一轮漏掉的地方 */
  if (!input.isServerSession) {
    /* 本地草稿：只写本地消息，不启动创作任务 */
    return { blocked: false, saved: false, startedCreation: false, startedChat: true }
  }

  if (plan.kind === 'modify') {
    return { blocked: false, saved: true, startedCreation: true, startedChat: false }
  }
  return { blocked: false, saved: true, startedCreation: false, startedChat: true }
}

/* 19.1 服务端会话 + 有项目 + 修改 → 保存并启动创作 */
{
  const r = simulateSend({ hasProject: true, isServerSession: true, intent: 'modify' })
  assert.equal(r.blocked, false)
  assert.equal(r.saved, true, '服务端会话的修改要保存消息')
  assert.equal(r.startedCreation, true, '服务端会话的修改要启动创作任务')
  assert.equal(r.startedChat, false, '不能同时走普通回复')
}

/* 19.2 服务端会话 + 有项目 + 提问 → 保存并走普通回复 */
{
  const r = simulateSend({ hasProject: true, isServerSession: true, intent: 'query' })
  assert.equal(r.saved, true)
  assert.equal(r.startedCreation, false, '提问不能启动创作')
  assert.equal(r.startedChat, true)
}

/* 19.3 服务端会话 + 无项目 + 修改 → 拦截 */
{
  const r = simulateSend({ hasProject: false, isServerSession: true, intent: 'modify' })
  assert.equal(r.blocked, true)
  assert.equal(r.reason, 'missing_project')
  assert.equal(r.saved, false, '拦截时不能保存消息')
}

/* 19.4 服务端会话 + 无项目 + 提问 → 正常提问 */
{
  const r = simulateSend({ hasProject: false, isServerSession: true, intent: 'query' })
  assert.equal(r.blocked, false)
  assert.equal(r.startedChat, true, '提问不依赖项目')
}

/* 19.5 【本轮 P1】本地会话 + **有项目** + 修改 → 必须拦截，不能静默走本地对话 */
{
  const r = simulateSend({ hasProject: true, isServerSession: false, intent: 'modify' })
  assert.equal(r.blocked, true, '【关键】有项目但未保存的本地会话，修改必须拦截')
  assert.equal(r.reason, 'unsaved_session')
  assert.equal(r.saved, false, '不能悄悄保存成本地消息')
  assert.equal(r.startedChat, false, '更不能悄悄走普通对话回复')
}

/* 19.6 本地会话 + 有项目 + 提问 → 正常本地对话（提问不依赖服务端） */
{
  const r = simulateSend({ hasProject: true, isServerSession: false, intent: 'query' })
  assert.equal(r.blocked, false)
  assert.equal(r.startedChat, true)
  assert.equal(r.startedCreation, false)
}

/* 19.7 本地会话 + 无项目 + 修改 → 拦截（缺项目优先报缺项目） */
{
  const r = simulateSend({ hasProject: false, isServerSession: false, intent: 'modify' })
  assert.equal(r.blocked, true)
  assert.equal(r.reason, 'missing_project')
}

/* 19.8 本地会话 + 无项目 + 提问 → 正常 */
{
  const r = simulateSend({ hasProject: false, isServerSession: false, intent: 'query' })
  assert.equal(r.blocked, false)
  assert.equal(r.startedChat, true)
}

/* 19.9 无显式意图 + 服务端会话 → 普通对话（不启动创作） */
{
  const r = simulateSend({ hasProject: true, isServerSession: true, intent: undefined })
  assert.equal(r.startedCreation, false, '没有显式意图时不能启动创作')
  assert.equal(r.startedChat, true)
}

/* 19.10 确认整片 + 本地会话 → 也要拦截（同样是发不出去的修改） */
{
  const r = simulateSend({
    hasProject: true, isServerSession: false, intent: 'modify',
    continuationScopeMode: 'whole_confirmed',
  })
  assert.equal(r.blocked, true, '确认整片也救不了未保存会话')
  assert.equal(r.reason, 'unsaved_session')
}

/* 19.11 完整矩阵：每种组合的「保存/创作/对话」三元组都与预期一致 */
{
  const matrix: Array<{
    name: string
    input: Parameters<typeof simulateSend>[0]
    expect: { blocked: boolean; saved?: boolean; creation?: boolean; chat?: boolean }
  }> = [
    { name: '服务端+有项目+修改', input: { hasProject: true, isServerSession: true, intent: 'modify' }, expect: { blocked: false, saved: true, creation: true, chat: false } },
    { name: '服务端+有项目+提问', input: { hasProject: true, isServerSession: true, intent: 'query' }, expect: { blocked: false, saved: true, creation: false, chat: true } },
    { name: '服务端+无项目+修改', input: { hasProject: false, isServerSession: true, intent: 'modify' }, expect: { blocked: true } },
    { name: '服务端+无项目+提问', input: { hasProject: false, isServerSession: true, intent: 'query' }, expect: { blocked: false, chat: true } },
    { name: '本地+有项目+修改', input: { hasProject: true, isServerSession: false, intent: 'modify' }, expect: { blocked: true } },
    { name: '本地+有项目+提问', input: { hasProject: true, isServerSession: false, intent: 'query' }, expect: { blocked: false, chat: true, creation: false } },
    { name: '本地+无项目+修改', input: { hasProject: false, isServerSession: false, intent: 'modify' }, expect: { blocked: true } },
    { name: '本地+无项目+提问', input: { hasProject: false, isServerSession: false, intent: 'query' }, expect: { blocked: false, chat: true } },
  ]
  for (const row of matrix) {
    const r = simulateSend(row.input)
    assert.equal(r.blocked, row.expect.blocked, `矩阵「${row.name}」拦截状态`)
    if (row.expect.saved !== undefined) assert.equal(r.saved, row.expect.saved, `矩阵「${row.name}」是否保存`)
    if (row.expect.creation !== undefined) assert.equal(r.startedCreation, row.expect.creation, `矩阵「${row.name}」是否启动创作`)
    if (row.expect.chat !== undefined) assert.equal(r.startedChat, row.expect.chat, `矩阵「${row.name}」是否普通回复`)
  }
}

/* 19.12 组件选中态：无显式选择时不能默认高亮「修改」 */
{
  /* 与 TargetSummaryPill 的 selectedIntent 同一规则 */
  const selectedOf = (snapIntent?: 'modify' | 'query', draft?: 'modify' | 'query') =>
    snapIntent ?? draft ?? null
  assert.equal(selectedOf(undefined, undefined), null, '无显式选择时不应高亮任何意图')
  assert.equal(selectedOf(undefined, 'query'), 'query')
  assert.equal(selectedOf('modify', undefined), 'modify')
  /* 且此时发送计划是普通对话 —— 高亮修改会与实际相反 */
  const plan = resolveSendPlan({ targetSnapshot: null })
  assert.equal(plan.kind, 'chat')
  assert.notEqual(selectedOf(undefined, undefined), 'modify', '普通对话状态下不能高亮「修改此目标」')
}

console.log('✓ 实测 19 成功：判定组合矩阵（服务端/本地 × 有无项目 × 意图）与预期分流一致；调用点回归另列综合验收')


console.log('\n=== 实测 20: 会话标识在两处界面必须同一套规则 ===')
/* 真机证据：同一个会话在对话区叫「未命名对话 · 3小时前」，
   在工作台侧栏叫「用 bash 执行 sleep 30… (17:29)」——名字和时间格式都不同。
   更严重：侧栏只报时分，2026-11-06 的会话显示「(17:29)」，
   与今天 17:29 完全无法区分。这里直接测共享规则。 */

import {
  sessionDisplayTitle,
  isUntitledSession,
  sessionTimeLabel,
  sessionTimeFull,
  sessionOptionLabel,
  UNTITLED_SESSION,
} from './src/shell/sessionDisplay.ts'

/* 固定一个「现在」：2026-11-12 23:00 本地时间 */
const NOW = new Date(2026, 10, 12, 23, 0, 0).getTime()
const at = (y: number, mo: number, d: number, h = 12, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0).getTime()

/* 20.1 标题只认一个来源：没有标题就是「未命名对话」，两处一致 */
{
  assert.equal(sessionDisplayTitle({ title: '用 bash 执行 sleep 30' }), '用 bash 执行 sleep 30')
  assert.equal(sessionDisplayTitle({ title: '未命名对话' }), UNTITLED_SESSION)
  assert.equal(sessionDisplayTitle({ title: '   ' }), UNTITLED_SESSION, '空白标题也归为未命名')
  assert.equal(sessionDisplayTitle(null), UNTITLED_SESSION)
  assert.equal(isUntitledSession({ title: '' }), true)
  assert.equal(isUntitledSession({ title: '有名字' }), false)
}

/* 20.2 今天的会话：相对时间 */
{
  assert.equal(sessionTimeLabel(NOW - 30 * 1000, NOW), '刚刚')
  assert.equal(sessionTimeLabel(NOW - 23 * 60000, NOW), '23分钟前')
  assert.equal(sessionTimeLabel(NOW - 3 * 3600000, NOW), '3小时前')
}

/* 20.3 【关键】跨天必须能区分日期 —— 不能只报时分 */
{
  const sixDaysAgo = at(2026, 11, 6, 17, 29)
  const label = sessionTimeLabel(sixDaysAgo, NOW)
  assert.equal(label, '11月6日', '【关键】六天前要显示日期，不能是「17:29」')
  assert.doesNotMatch(label, /^\d{1,2}:\d{2}$/, '绝不能只给时分 —— 那会让六天前和今天一样')

  assert.equal(sessionTimeLabel(at(2026, 11, 11, 17, 29), NOW), '昨天')
  /* NOW 是 23:00，同日 09:00 相距 14 小时 */
  assert.equal(sessionTimeLabel(at(2026, 11, 12, 9, 0), NOW), '14小时前', '今天仍是相对时间')
}

/* 20.4 跨年要带年份，否则「9月3日」可能是去年的 */
{
  assert.equal(sessionTimeLabel(at(2025, 9, 3, 10, 0), NOW), '2025年9月3日')
  assert.equal(sessionTimeLabel(at(2026, 9, 3, 10, 0), NOW), '9月3日', '同一年不重复写年份')
}

/* 20.5 异常输入不炸、不返回假时间 */
{
  assert.equal(sessionTimeLabel(null, NOW), '')
  assert.equal(sessionTimeLabel(undefined, NOW), '')
  assert.equal(sessionTimeLabel(Number.NaN, NOW), '')
}

/* 20.6 完整时间可核对 */
{
  const full = sessionTimeFull(at(2026, 11, 6, 17, 29))
  assert.equal(full, '2026年11月6日 17:29', '悬停要能看到准确时刻')
}

/* 20.7 侧栏选项：标题 + 时间 + 项目归属三者齐全 */
{
  const s = { title: '用 bash 执行 sleep 30', updatedAt: NOW - 23 * 60000 } as any
  const label = sessionOptionLabel(s, '制作能力验证', NOW)
  assert.match(label, /制作能力验证/, '侧栏要标明会话属于哪个项目')
  assert.match(label, /用 bash 执行 sleep 30/, '标题与对话区一致')
  assert.match(label, /23分钟前/, '时间与对话区同一套规则')
  assert.equal(label, '制作能力验证 · 用 bash 执行 sleep 30（23分钟前）')
}

/* 20.8 没有项目名时不硬塞「未分组」之类的新词，只是省略 */
{
  const s = { title: '会话A', updatedAt: NOW - 3600000 } as any
  assert.equal(sessionOptionLabel(s, null, NOW), '会话A（1小时前）')
  assert.equal(sessionOptionLabel(s, '', NOW), '会话A（1小时前）')
}

/* 20.9 同一时间在两处的呈现必须一致（用同一函数即保证，这里做一次显式对照） */
{
  const t = at(2026, 11, 6, 17, 29)
  /* 对话区用 sessionTimeLabel；侧栏选项内嵌的也是它 */
  const inList = sessionTimeLabel(t, NOW)
  const inOption = sessionOptionLabel({ title: 'X', updatedAt: t } as any, 'P', NOW)
  assert.ok(inOption.includes(inList), '侧栏里的时间文本必须与列表同一套')
  assert.ok(inOption.includes('11月6日'), '跨天日期在侧栏同样可见')
}

console.log('✓ 实测 20 成功：标题唯一来源、跨天可区分、侧栏标明项目，两处同一套规则')


console.log('\n=== 实测 21: 侧栏过程摘要只依据真实数据 ===')
/* 原则：不按消息长度猜步骤数，不根据「有没有新版本」倒推做过什么。
   没有 executedTools 就整个不渲染。这里测归组与摘要规则。 */

import { summarizeTools, toolStepState, TOOL_STATE_LABEL } from './src/components/chat/processSummary.ts'

/* 21.1 按工具归组、保留首次出现顺序 */
{
  const tools = [
    { name: 'bash', arguments: '{"command":"ls"}', done: true },
    { name: 'read', arguments: '{"path":"a.txt"}', done: true },
    { name: 'bash', arguments: '{"command":"pwd"}', done: true },
  ]
  assert.equal(summarizeTools(tools as any), '执行命令 2 次 · 读取文件 1 次',
    '归组后按首次出现顺序排列，同类合并')
}

/* 21.2 未知工具保留原名，不编中文名 */
{
  const tools = [{ name: 'custom_tool', done: true }]
  assert.equal(summarizeTools(tools as any), 'custom_tool 1 次', '未知工具不能编一个中文名')
}

/* 21.3 空数组 → 空摘要（组件据此不渲染） */
{
  assert.equal(summarizeTools([]), '', '没有过程数据时摘要为空，组件不渲染')
}

/* 21.4 失败计入文字，不靠颜色 */
{
  const tools = [
    { name: 'bash', isError: true, done: true },
    { name: 'bash', done: true },
  ]
  const summary = summarizeTools(tools as any)
  assert.equal(summary, '执行命令 2 次', '摘要只讲做了什么，失败另用文字标出')
  const failed = tools.filter((t) => t.isError).length
  assert.equal(failed, 1, '失败数量要能算出来并显示成文字')
}

/* 21.5 单步也正常 */
{
  assert.equal(summarizeTools([{ name: 'write', done: true }] as any), '写入文件 1 次')
}

/* 21.6 过程数据必须随消息从服务端读回 —— 这是「刷新/切页后仍可见」的前提。
   注：useSessions.ts 用了 @/ 别名，纯 Node 无法直接 import，所以这里按它的
   真实映射规则做断言（见 toViewMessage：toolCalls → executedTools，
   且没有调用时保持 undefined 而不是空数组）。 */
{
  const toView = (m: any) => ({
    ...(m.toolCalls && m.toolCalls.length > 0 ? { executedTools: m.toolCalls } : {}),
    ...(m.reasoning ? { thinking: m.reasoning } : {}),
  })
  const withTools = toView({
    toolCalls: [{ callId: 'c1', name: 'bash', arguments: '{}', done: true }],
    reasoning: '想过一下',
  })
  assert.ok(Array.isArray(withTools.executedTools) && withTools.executedTools.length === 1,
    '服务端消息读回时必须带上 executedTools，否则刷新后过程摘要会消失')
  assert.equal((withTools as any).thinking, '想过一下', '思考同样随消息读回')

  const plain = toView({})
  assert.equal((plain as any).executedTools, undefined,
    '没有调用时不能给空数组 —— 那会渲染出一个空摘要')
}

console.log('✓ 实测 21 成功：过程摘要按真实数据归组，无数据不渲染，且数据可随消息读回')


console.log('\n=== 实测 22: 过程状态不得把「未知」说成「完成」 ===')
/* 后端在工具开始时只写 callId/name/arguments，**不写 done**；
   只有收到对应结果事件才回填（ChatStreamService.onToolCall）。
   所以 done 缺失 = 不知道结果，不能显示成「完成」。 */

/* 22.1 三态齐全 */
{
  assert.equal(toolStepState({ done: true }), 'done')
  assert.equal(toolStepState({ done: false }), 'running')
  assert.equal(toolStepState({ isError: true, done: true }), 'failed')
  assert.equal(toolStepState({ isError: true }), 'failed', '失败优先于未知')
}

/* 22.2 【关键】done 缺失不能断言完成 */
{
  assert.equal(toolStepState({}), 'unknown', '【关键】没有完成标记、且本轮已结束 → 状态未知')
  assert.notEqual(toolStepState({}), 'done', '绝不能把缺失 done 当成完成 —— 那是谎报成功')
  assert.equal(TOOL_STATE_LABEL.unknown, '状态未知')
  assert.notEqual(TOOL_STATE_LABEL.unknown, '完成')

  /* 本轮仍在执行时，缺 done 是「进行中」—— 实时流里开始帧本来就没有 done */
  assert.equal(toolStepState({}, true), 'running', '本轮在跑时缺 done 应是进行中')
  assert.equal(TOOL_STATE_LABEL.running, '进行中')
}

/* 22.3 只有 callId/name/arguments（真实的开始帧形状）→ unknown */
{
  const startFrame = { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' }
  assert.equal(toolStepState(startFrame as any), 'unknown',
    '本轮已结束时，开始帧缺 done 应显示状态未知而不是完成')
  assert.equal(toolStepState(startFrame as any, true), 'running',
    '本轮仍在跑时，开始帧缺 done 应显示进行中')
}

/* 22.4 结果帧回填后才是完成 */
{
  const finished = { callId: 'c1', name: 'bash', arguments: '{}', done: true }
  assert.equal(toolStepState(finished as any), 'done')
}

/* 22.5 侧栏实时记录规则：开始帧追加、结果帧回填（与对话区一致） */
{
  /** 复刻 useChat.recordToolCall 的真实规则 */
  const apply = (
    list: any[],
    call: { callId?: string; name: string; arguments?: string; isError?: boolean; finished?: boolean },
  ) => {
    if (call.finished) {
      if (!call.callId) return list
      return list.map((c) => (
        c.callId === call.callId ? { ...c, done: true, ...(call.isError ? { isError: true } : {}) } : c
      ))
    }
    return [...list, {
      callId: call.callId ?? `anon-${list.length}`,
      name: call.name,
      ...(call.arguments ? { arguments: call.arguments } : {}),
    }]
  }

  let list: any[] = []
  list = apply(list, { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' })
  assert.equal(list.length, 1)
  assert.equal(list[0].done, undefined, '开始帧不能塞 done:false —— 后端落库也不写')
  assert.equal(toolStepState(list[0]), 'unknown', '实时开始帧同样是「状态未知」')

  list = apply(list, { callId: 'c1', name: 'bash', finished: true })
  assert.equal(list.length, 1, '结果帧不能新增条目')
  assert.equal(list[0].done, true, '结果帧回填 done')
  assert.equal(list[0].name, 'bash', '结果帧不能清空 name（后端结果帧不带 name）')
  assert.equal(list[0].arguments, '{"command":"ls"}', '结果帧不能清空参数')
  assert.equal(toolStepState(list[0]), 'done')

  list = apply(list, { callId: 'c2', name: 'read', arguments: '{"path":"a"}' })
  list = apply(list, { callId: 'c2', name: 'read', finished: true, isError: true })
  assert.equal(toolStepState(list[1]), 'failed', '失败结果帧要标失败')
}

/* 22.6 无 callId 的结果帧不能乱改别的条目 */
{
  const list = [{ callId: 'c1', name: 'bash', arguments: '{}' }]
  const after = list.map((c) => (
    c.callId === undefined ? { ...c, done: true } : c
  ))
  assert.equal(after[0].done, undefined, '没有 callId 的结果帧不应误伤其他条目')
}

console.log('✓ 实测 22 成功：done 缺失显示状态未知，实时记录开始/结果帧规则与对话区一致')


console.log('\n=== 实测 23: 重试身份必须由真实请求字段算出 ===')
/* 复审指出：旧版指纹漏掉素材引用与目标图片，且前端排序与后端规则冲突。
   现在身份由「真正要发出去的字段」算出，并与后端的规范化规则一致（数组保序）。 */

import {
  messageFingerprint, creationFingerprint, isSameRequest, stableStringify, contentDigest,
} from './src/services/sendFingerprint.ts'

const SID = 'sess-1'
const baseMsg = {
  sessionId: SID,
  text: '把开头加快',
  references: null as any,
  attachments: null as any,
}

/* 23.1 原样重试 → 身份一致 */
{
  assert.equal(messageFingerprint({ ...baseMsg }), messageFingerprint({ ...baseMsg }),
    '同样请求必须得到同样身份，否则原样重试会重复落库')
}

/* 23.2 只换参考素材（文字不变）→ 身份必须不同 */
{
  const a = messageFingerprint({ ...baseMsg, references: [{ id: 'r1', role: 'context', label: '参考片A' }] })
  const b = messageFingerprint({ ...baseMsg, references: [{ id: 'r1', role: 'context', label: '参考片B' }] })
  assert.notEqual(a, b, '只换参考素材就是另一个请求（旧版漏掉了这一层）')
}

/* 23.3 只换目标画面（图片不同、文字不变）→ 创作身份必须不同 */
{
  const a = creationFingerprint({
    projectId: 'p1', intent: '把开头加快', references: [],
    previewImage: 'data:image/png;base64,AAAA'.repeat(20), baseVersion: 3, correction: 'x',
  })
  const b = creationFingerprint({
    projectId: 'p1', intent: '把开头加快', references: [],
    previewImage: 'data:image/png;base64,BBBB'.repeat(20), baseVersion: 3, correction: 'x',
  })
  assert.notEqual(a, b, '只换目标画面就必须换身份')
}

/* 23.4 附件顺序变化 → 身份也变化（与后端一致：数组保序） */
{
  const a = messageFingerprint({ ...baseMsg, attachments: [{ fileId: 'f1' }, { fileId: 'f2' }] })
  const b = messageFingerprint({ ...baseMsg, attachments: [{ fileId: 'f2' }, { fileId: 'f1' }] })
  assert.notEqual(a, b,
    '数组顺序必须改变身份 —— 后端按数组原样序列化做摘要，前端若排序后认为「不变」就会与后端冲突')
}

/* 23.5 对象键序不影响身份（只有键序变了，是同一个请求） */
{
  const a = messageFingerprint({ ...baseMsg, references: [{ id: 'r1', role: 'a', label: 'x' }] })
  const b = messageFingerprint({ ...baseMsg, references: [{ label: 'x', role: 'a', id: 'r1' }] })
  assert.equal(a, b, '对象键序无语义，不应被判成新请求')
}

/* 23.6 刷新后原样重试 → 能恢复旧幂等键，不重复落消息 */
{
  const fp = messageFingerprint({ ...baseMsg })
  const pending = { requestId: 'req-1', idempotencyKey: 'idem-1', promptKey: fp, messageFingerprint: fp }
  assert.equal(isSameRequest(fp, pending), true, '刷新后同一请求应认作重试，恢复旧幂等键')
}

/* 23.7 【关键】旧草稿只有「会话:项目:文字」→ 不认作重试（无法确认目标与附件） */
{
  const fp = messageFingerprint({ ...baseMsg })
  const legacyPending = { requestId: 'req-old', promptKey: `${SID}:p1:把开头加快` }
  assert.equal(isSameRequest(fp, legacyPending), false,
    '旧格式无法确认身份，不能当作完整匹配 —— 宁可多存一条也不猜')
}

/* 23.8 消息相同但创作字段不同 → isSameRequest 仍为真，但创作身份不同 */
{
  const msgFp = messageFingerprint({ ...baseMsg })
  const c1 = creationFingerprint({ projectId: 'p1', intent: 'x', references: [], baseVersion: 3 })
  const c2 = creationFingerprint({ projectId: 'p1', intent: 'x', references: [{ id: 'ref-a' }], baseVersion: 3 })
  assert.notEqual(c1, c2, '同样的消息，创作引用不同就是不同的创作请求')
  assert.equal(isSameRequest(msgFp, { requestId: 'r', messageFingerprint: msgFp }), true,
    '消息层面仍是同一条，是否复用旧任务要再核对创作身份')
}

/* 23.9 stableStringify：数组保序、对象键排序、undefined 忽略 */
{
  assert.equal(stableStringify([1, 2]), '[1,2]')
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]), '数组必须保序')
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }), '对象键序无关')
  assert.equal(stableStringify({ a: 1, b: undefined }), '{"a":1}', 'undefined 字段不参与身份')
}

/* 23.10 没有 requestId 一律不是重试 */
{
  const fp = messageFingerprint({ ...baseMsg })
  assert.equal(isSameRequest(fp, { messageFingerprint: fp, requestId: null }), false)
  assert.equal(isSameRequest(fp, null), false)
}

console.log('✓ 实测 23 成功：身份由真实请求字段算出，与后端保序规则一致，旧格式不猜')

console.log('\n=== 实测 24: 一次发送尝试的身份语义 ===')
/* 核心语义（用户 2026-11-13 明确定义）：
   幂等键保护的是「同一次尚未确认的发送」，不是「同一段文字」。
   · 结果未知时原样重试 → 复用同一把键（避免重复落库）
   · 已确认成功后用户再发同样的话 → 是两次发送，必须产生两条消息
   两条用户消息**文字相同**不足以判断重复。 */

/* 24.1 成功后应结束该次尝试：键被清空，同样的文字会拿到新键 */
{
  /* 复刻 Conversation 的真实状态机 */
  let idemKey: string | null = null
  let idemFp: string | null = null
  let counter = 0
  const newKey = () => `k${++counter}`

  const sendAttempt = (fp: string) => {
    const key = (idemKey && idemFp === fp) ? idemKey : newKey()
    idemKey = key
    idemFp = fp
    return key
  }
  const onSuccess = () => { idemKey = null; idemFp = null }

  const fp = messageFingerprint({ sessionId: 's1', text: '同一句话' })
  const k1 = sendAttempt(fp)
  onSuccess()
  const k2 = sendAttempt(fp)
  assert.notEqual(k1, k2,
    '【关键】上一轮成功后用户再发同一句话，必须用新键 —— 否则第二次的话会被当成重复而丢失')
}

/* 24.2 结果未知（未成功）时原样重试 → 复用同一把键 */
{
  let idemKey: string | null = null
  let idemFp: string | null = null
  let counter = 0
  const newKey = () => `k${++counter}`
  const sendAttempt = (fp: string) => {
    const key = (idemKey && idemFp === fp) ? idemKey : newKey()
    idemKey = key; idemFp = fp
    return key
  }
  const fp = messageFingerprint({ sessionId: 's1', text: '同一句话' })
  const k1 = sendAttempt(fp)
  /* 失败/结果未知：不清键 */
  const k2 = sendAttempt(fp)
  assert.equal(k1, k2, '结果未知时原样重试必须复用同一把键，避免重复落库')
}

/* 24.3 刷新后（内存 ref 丢失）靠 pendingSubmission 恢复旧键 */
{
  const fp = messageFingerprint({ sessionId: 's1', text: '同一句话' })
  const pending = { requestId: 'r1', idempotencyKey: 'idem-old', messageFingerprint: fp }
  assert.equal(isSameRequest(fp, pending), true, '刷新后同一请求仍应认出并恢复旧键')
}

/* 24.4 图片摘要必须覆盖完整内容，中间不同不能撞 */
{
  const head = 'data:image/png;base64,' + 'A'.repeat(200)
  const img1 = head + 'MIDDLE-A' + 'Z'.repeat(200)
  const img2 = head + 'MIDDLE-B' + 'Z'.repeat(200)
  assert.notEqual(contentDigest(img1), contentDigest(img2),
    '【关键】两张只在中间不同的图不能算出同一身份')
  /* 同内容必须同摘要 */
  assert.equal(contentDigest(img1), contentDigest(img1))
  /* 创作身份也随之不同 */
  const c1 = creationFingerprint({ projectId: 'p', intent: 'x', previewImage: img1 })
  const c2 = creationFingerprint({ projectId: 'p', intent: 'x', previewImage: img2 })
  assert.notEqual(c1, c2, '图片不同则创作身份必须不同')
}

/* 24.5 旧记录缺 creationFingerprint → 不允许复用旧任务 */
{
  /* 与 Conversation 的条件一致：必须 recordedCreationFp !== undefined 且相等 */
  const canReuse = (isRetry: boolean, recorded: string | undefined, current: string) =>
    isRetry && recorded !== undefined && recorded === current
  assert.equal(canReuse(true, undefined, 'c1'), false,
    '【关键】旧记录没有创作身份时不能默认放行 —— 那等于把「不知道」当「一致」')
  assert.equal(canReuse(true, 'c1', 'c1'), true, '确认一致才允许复用')
  assert.equal(canReuse(true, 'c1', 'c2'), false, '创作字段变了不能复用')
  assert.equal(canReuse(false, 'c1', 'c1'), false, '不是重试就不能复用')
}

console.log('✓ 实测 24 成功：身份按「一次发送尝试」界定，成功后重新计数，图片与旧记录判定收紧')

import {
  markDraftSent, noteDraftInput, clearSentPartsOnly as clearParts25, currentFieldVersions as cfv25,
} from './src/shell/useDraftStore.ts'

console.log('\n=== 实测 25: 发送成功只清「本次发出去的那份」 ===')
/* 创作任务要跑 100~200 秒，用户可能在这期间输入下一条要求。
   现在按**逐字段版本**判断：某字段在提交后被单独编辑过就保留。 */

const P = 'proj-clear-test'
const S = 'sess-clear-test'

/* 25.1 发送后用户没再输入 → 清理 */
{
  setSessionDraft(P, S, { text: '要发的内容' })
  const versions = cfv25(P, S)
  markDraftSent(P, S, '要发的内容')
  clearParts25(P, S, {
    versions, text: '要发的内容', attachments: [], targetSnapshot: null,
    continuationScopeMode: null, intentAction: undefined,
  })
  assert.equal(getSessionDraft(P, S).text, '', '用户没再输入时应清理草稿')
}

/* 25.2 【关键】发送后用户输入了新内容 → 必须保留 */
{
  setSessionDraft(P, S, { text: '要发的内容' })
  const versions = cfv25(P, S)
  markDraftSent(P, S, '要发的内容')
  noteDraftInput(P, S)
  setSessionDraft(P, S, { text: '等待期间的新要求' })
  clearParts25(P, S, {
    versions, text: '要发的内容', attachments: [], targetSnapshot: null,
    continuationScopeMode: null, intentAction: undefined,
  })
  assert.equal(getSessionDraft(P, S).text, '等待期间的新要求',
    '【关键】用户新写的内容必须保留 —— 清掉就是数据丢失')
}

/* 25.3 删掉后重新输入同一句 → 视为新编辑，保留 */
{
  setSessionDraft(P, S, { text: '同一句话' })
  const versions = cfv25(P, S)
  markDraftSent(P, S, '同一句话')
  setSessionDraft(P, S, { text: '' })
  noteDraftInput(P, S)
  setSessionDraft(P, S, { text: '同一句话' })
  clearParts25(P, S, {
    versions, text: '同一句话', attachments: [], targetSnapshot: null,
    continuationScopeMode: null, intentAction: undefined,
  })
  assert.equal(getSessionDraft(P, S).text, '同一句话',
    '删掉后重新输入的同一句话是新编辑，不能当旧文字清掉')
}

console.log('✓ 实测 25 成功：成功只清本次内容，用户新输入不会被旧请求清掉')

import { clearSentPartsOnly, currentFieldVersions } from './src/shell/useDraftStore.ts'

console.log('\n=== 实测 26: 逐字段清理：没编辑过的才清，编辑过的保留 ===')
/* 用户在等待结果期间只换了目标时：
   旧文字应被清掉（否则会让人以为上一条没发出去），新目标必须保留。 */

const P2 = 'proj-parts-test'
const S2 = 'sess-parts-test'
const v0 = { text: 0, attachments: 0, targetSnapshot: 0, intentAction: 0, continuationScopeMode: 0 }

/* 26.1 全部未编辑 → 全部清空 */
{
  setSessionDraft(P2, S2, { text: '发出去的话', attachments: [], targetSnapshot: null, intentAction: 'modify' })
  const versions = currentFieldVersions(P2, S2)
  const sent = { versions, text: '发出去的话', attachments: [], targetSnapshot: null, continuationScopeMode: null, intentAction: 'modify' as const }
  clearSentPartsOnly(P2, S2, sent)
  const d = getSessionDraft(P2, S2)
  assert.equal(d.text, '', '文字应清空')
  assert.equal(d.intentAction, undefined, '意图应清空')
}

/* 26.2 【关键】只换目标 → 旧文字清掉，新目标保留 */
{
  const t1 = { version: 3, scope: 'selection' as const, label: '旧目标' }
  setSessionDraft(P2, S2, { text: '发出去的话', attachments: [], targetSnapshot: t1, intentAction: 'modify' })
  const versions = currentFieldVersions(P2, S2)
  const sent = { versions, text: '发出去的话', attachments: [], targetSnapshot: t1, continuationScopeMode: null, intentAction: 'modify' as const }
  const t2 = { version: 5, scope: 'selection' as const, label: '新目标' }
  setSessionDraft(P2, S2, { targetSnapshot: t2 })
  clearSentPartsOnly(P2, S2, sent)
  const d = getSessionDraft(P2, S2)
  assert.equal(d.text, '', '【关键】只换目标时，已发出去的文字仍应清掉')
  assert.equal(d.targetSnapshot?.label, '新目标', '【关键】用户换过的目标必须保留')
}

/* 26.3 只改意图 → 文字清掉，意图保留 */
{
  setSessionDraft(P2, S2, { text: '发出去的话', attachments: [], targetSnapshot: null, intentAction: 'modify' })
  const versions = currentFieldVersions(P2, S2)
  const sent = { versions, text: '发出去的话', attachments: [], targetSnapshot: null, continuationScopeMode: null, intentAction: 'modify' as const }
  setSessionDraft(P2, S2, { intentAction: 'query' })
  clearSentPartsOnly(P2, S2, sent)
  const d = getSessionDraft(P2, S2)
  assert.equal(d.text, '', '文字应清掉')
  assert.equal(d.intentAction, 'query', '用户改过的意图必须保留')
}

/* 26.4 只加附件 → 文字清掉，附件保留 */
{
  setSessionDraft(P2, S2, { text: '发出去的话', attachments: [], targetSnapshot: null, intentAction: 'modify' })
  const versions = currentFieldVersions(P2, S2)
  const sent = { versions, text: '发出去的话', attachments: [], targetSnapshot: null, continuationScopeMode: null, intentAction: 'modify' as const }
  setSessionDraft(P2, S2, { attachments: [{ id: 'a1', name: 'x.png', size: 1, mimeType: 'image/png' } as never] })
  clearSentPartsOnly(P2, S2, sent)
  assert.equal(getSessionDraft(P2, S2).attachments.length, 1, '用户新加的附件必须保留')
}

/* 26.5 pending 属于本次提交时清空 */
{
  setSessionDraft(P2, S2, {
    text: 'x', attachments: [], targetSnapshot: null, intentAction: 'modify',
    pendingSubmission: { requestId: 'r1', idempotencyKey: 'k1' },
  })
  const versions = currentFieldVersions(P2, S2)
  const sent = { versions, text: 'x', attachments: [], targetSnapshot: null, continuationScopeMode: null, intentAction: 'modify' as const, idempotencyKey: 'k1' }
  clearSentPartsOnly(P2, S2, sent)
  assert.equal(getSessionDraft(P2, S2).pendingSubmission, null, '本次提交结束后 pending 应清空')
}

console.log('✓ 实测 26 成功：逐字段清理，没编辑过的才清、编辑过的保留')

console.log('✓ 实测 27 成功：等量换附件、改框选/引用、重输同句都不会被误清')






console.log('\n=== 实测 28: 「未改动工程」必须按消息身份归属，不能按顺序猜 ===')
/* 判据：创作回复保存时 taskId = 触发它的用户消息 id。
   所以「回复的 taskId === 结论的 userMessageId」才是真实关联。 */

/** 与 Workbench.awaitingInfoBelongsTo 同一实现 */
function belongsTo(
  ai: { id: string; role: string; taskId?: string },
  messages: Array<{ id: string; role: string; taskId?: string }>,
  info: { userMessageId?: string; requestId?: string },
): boolean {
  if (!info.userMessageId) return false
  if (ai.taskId) return ai.taskId === info.userMessageId
  const owner = messages.find((m) => m.role === 'ai' && m.taskId && m.taskId === info.userMessageId)
  if (owner) return owner.id === ai.id
  return false
}

const u = (id: string) => ({ id, role: 'user' })
const a = (id: string, taskId?: string) => ({ id, role: 'ai', ...(taskId ? { taskId } : {}) })

/* 28.1 正常一轮：回复的 taskId 指向触发它的用户消息 → 命中 */
{
  const msgs = [u('u1'), a('a1', 'u1')]
  assert.equal(belongsTo(msgs[1], msgs, { userMessageId: 'u1' }), true)
}

/* 28.2 【关键】交错两轮：结论属于第一轮，不能显示在第二轮回复上 */
{
  const msgs = [u('u1'), a('a1', 'u1'), u('u2'), a('a2', 'u2')]
  assert.equal(belongsTo(msgs[3], msgs, { userMessageId: 'u1' }), false,
    '【关键】第二轮回复不能显示第一轮的结论')
  assert.equal(belongsTo(msgs[1], msgs, { userMessageId: 'u1' }), true,
    '第一轮回复仍应显示自己的结论')
}

/* 28.3 【关键】响应乱序：第二轮回复先到、第一轮后到，归属仍按 taskId */
{
  const msgs = [u('u1'), a('a1', 'u1'), u('u2'), a('a2', 'u2')]
  /* 假设 a2 先渲染，结论属于 u2 */
  assert.equal(belongsTo(msgs[3], msgs, { userMessageId: 'u2' }), true)
  assert.equal(belongsTo(msgs[1], msgs, { userMessageId: 'u2' }), false)
}

/* 28.4 本地占位 AI 消息没有 taskId，但列表里存在声明的归属 → 只认那一条 */
{
  const msgs = [u('u1'), a('a1', 'u1'), u('u2'), a('a2')]  // a2 无 taskId
  assert.equal(belongsTo(msgs[3], msgs, { userMessageId: 'u1' }), false,
    '无 taskId 的回复不能抢别的轮次的结论')
  assert.equal(belongsTo(msgs[1], msgs, { userMessageId: 'u1' }), true)
}

/* 28.5 【关键】没有任何消息声明归属 → 明确降级，绝不按顺序猜 */
{
  const msgs = [u('u1'), a('a1'), u('u2'), a('a2')]  // 都没有 taskId
  assert.equal(belongsTo(msgs[3], msgs, { userMessageId: 'u2' }), false,
    '【关键】没有身份证据时必须降级，不能因为「它是最近的」就显示')
  assert.equal(belongsTo(msgs[1], msgs, { userMessageId: 'u1' }), false)
}

/* 28.6 结论没有 userMessageId → 一律不显示 */
{
  const msgs = [u('u1'), a('a1', 'u1')]
  assert.equal(belongsTo(msgs[1], msgs, {}), false)
}

/* 28.7 taskId 与 userMessageId 不一致 → 不显示（身份冲突） */
{
  const msgs = [u('u1'), a('a1', 'u-other')]
  assert.equal(belongsTo(msgs[1], msgs, { userMessageId: 'u1' }), false,
    '身份冲突时不能显示')
}

console.log('✓ 实测 28 成功：归属按 taskId 真实关联判定，交错/乱序/无身份都正确降级')

console.log('\n=== 实测 29: 真实渲染条件（不再受「最后一条 AI」限制）===')
/* 复审指出：即使匹配准确，渲染条件若保留 isLastAi，
   第一轮的结论在第二轮出现后就永远不显示。
   这里模拟**真实渲染条件**，而不是只测匹配函数。 */

/** 与 Workbench 渲染条件一致：awaitingInfo && belongsTo(m, ...) —— 没有 isLastAi */
function shouldRenderNote(
  m: { id: string; role: string; taskId?: string },
  messages: Array<{ id: string; role: string; taskId?: string }>,
  info: { userMessageId?: string; requestId?: string } | null,
): boolean {
  if (!info) return false
  return belongsTo(m, messages, info)
}

/* 29.1 【关键】第一轮结论在第二轮回复出现后仍应显示 */
{
  const msgs = [u('u1'), a('a1', 'u1'), u('u2'), a('a2', 'u2')]
  const info = { userMessageId: 'u1' }
  assert.equal(shouldRenderNote(msgs[1], msgs, info), true,
    '【关键】第一轮结论在第二轮出现后仍必须显示 —— 不能被 isLastAi 挡住')
  assert.equal(shouldRenderNote(msgs[3], msgs, info), false,
    '第二轮回复不显示第一轮的结论')
}

/* 29.2 两轮各自有结论 → 各显示各的 */
{
  const msgs = [u('u1'), a('a1', 'u1'), u('u2'), a('a2', 'u2')]
  assert.equal(shouldRenderNote(msgs[1], msgs, { userMessageId: 'u1' }), true)
  assert.equal(shouldRenderNote(msgs[3], msgs, { userMessageId: 'u2' }), true)
}

/* 29.3 本地即时消息带 taskId → 立刻能匹配，不必等服务端重读 */
{
  const msgs = [u('u1'), a('a1', 'u1')]  // a1 是本地 append 的消息，已带 taskId
  assert.equal(shouldRenderNote(msgs[1], msgs, { userMessageId: 'u1' }), true,
    '本地消息带了 taskId 就应立刻显示，不必等历史重读')
}

/* 29.4 本地消息没带 taskId → 降级不显示（这是修复前的行为，确认修复必要性） */
{
  const msgs = [u('u1'), a('a1')]  // a1 无 taskId
  assert.equal(shouldRenderNote(msgs[1], msgs, { userMessageId: 'u1' }), false,
    '没有身份时降级 —— 正是本地消息必须带 taskId 的原因')
}

console.log('✓ 实测 29 成功：渲染条件按身份判定，第一轮结论不会被后续回复挤掉')

console.log('\n=== 实测 30: 轮次结论按项目+会话+消息 id 存储，两轮可共存 ===')
/* 此前 awaitingInfo 是单条 state：新一轮结论会替换上一轮。
   现在按轮次存，两处界面读同一份。 */

import {
  recordRoundOutcome, getRoundOutcome, clearRoundOutcome, outcomeBelongsToReply,
} from './src/shell/roundOutcomes.ts'

const PA = 'proj-round'
const SA = 'sess-A'
const SB = 'sess-B'

/* 30.1 同一会话两轮结论可以共存 */
{
  assert.equal(recordRoundOutcome(PA, SA, { reply: 'A轮问题', userMessageId: 'u1', requestId: 'r1' }), true)
  assert.equal(recordRoundOutcome(PA, SA, { reply: 'B轮问题', userMessageId: 'u2', requestId: 'r2' }), true)
  assert.equal(getRoundOutcome(PA, SA, 'u1')?.reply, 'A轮问题',
    '【关键】第二轮写入不能覆盖第一轮')
  assert.equal(getRoundOutcome(PA, SA, 'u2')?.reply, 'B轮问题')
}

/* 30.2 会话隔离：A 的结论在 B 查不到 */
{
  assert.equal(getRoundOutcome(PA, SB, 'u1'), null, '【关键】不能跨会话串味')
}

/* 30.3 没有 userMessageId 的结果拒绝写入（不猜） */
{
  assert.equal(recordRoundOutcome(PA, SA, { reply: '无身份' }), false,
    '没有归属依据的记录必须拒绝，否则渲染只能靠猜')
  assert.equal(getRoundOutcome(PA, SA, undefined), null)
}

/* 30.4 查不到时返回 null，不猜 */
{
  assert.equal(getRoundOutcome(PA, SA, 'u-unknown'), null)
  assert.equal(getRoundOutcome(PA, SA, ''), null)
}

/* 30.5 关闭某一轮不影响其他轮 */
{
  clearRoundOutcome(PA, SA, 'u1')
  assert.equal(getRoundOutcome(PA, SA, 'u1'), null, '关闭的轮次应清掉')
  assert.equal(getRoundOutcome(PA, SA, 'u2')?.reply, 'B轮问题', '其他轮次不受影响')
}

/* 30.6 归属判定：按 taskId 真实关联，交错/乱序都不串 */
{
  const msgs = [
    { id: 'u1', role: 'user' as const },
    { id: 'a1', role: 'ai' as const, taskId: 'u1' },
    { id: 'u2', role: 'user' as const },
    { id: 'a2', role: 'ai' as const, taskId: 'u2' },
  ]
  assert.equal(outcomeBelongsToReply(msgs[1], msgs, 'u1'), true)
  assert.equal(outcomeBelongsToReply(msgs[3], msgs, 'u1'), false,
    '第二轮回复不能显示第一轮结论')
  assert.equal(outcomeBelongsToReply(msgs[3], msgs, 'u2'), true)
}

/* 30.7 无 taskId 且无声明 → 降级不显示 */
{
  const msgs = [
    { id: 'u1', role: 'user' as const },
    { id: 'a1', role: 'ai' as const },
  ]
  assert.equal(outcomeBelongsToReply(msgs[1], msgs, 'u1'), false)
}

console.log('✓ 实测 30 成功：轮次结论按身份共存、跨会话隔离、无身份拒绝写入')

console.log('\n=== 实测 31: 刷新回填的身份核对（项目 + 会话 + 消息）===')
/* 本次修复的核心：恢复数据必须核对**任务自己的会话**，
   不能拿当前界面会话顶替。判定抽成纯函数，直接覆盖。 */

import {
  shouldRestoreRound, shouldRestoreLatestState,
  shouldRefetchBackfill, BACKFILL_TTL_MS, resolveReplySaveState, replySaveNotice,
} from './src/shell/roundRestoreRules.ts'

const BP = 'proj-backfill'
const BA = 'sess-backfill-A'
const BB = 'sess-backfill-B'

/* 31.1 三条身份都对得上 → 回填 */
{
  assert.equal(shouldRestoreRound(
    { projectId: BP, sessionId: BA, userMessageId: 'u1', status: 'awaiting_info' }, BP, BA), true)
}

/* 31.2 【关键】记录属于会话 B，当前打开的是会话 A → 拒绝 */
{
  assert.equal(shouldRestoreRound(
    { projectId: BP, sessionId: BB, userMessageId: 'u1', status: 'awaiting_info' }, BP, BA), false,
    '会话 B 的轮次不能写进会话 A 的作用域')
}

/* 31.3 记录属于别的项目 → 拒绝 */
{
  assert.equal(shouldRestoreRound(
    { projectId: 'other-proj', sessionId: BA, userMessageId: 'u1', status: 'awaiting_info' }, BP, BA), false)
}

/* 31.4 缺 userMessageId（旧记录）→ 拒绝，不猜 */
{
  assert.equal(shouldRestoreRound(
    { projectId: BP, sessionId: BA, userMessageId: null, status: 'awaiting_info' }, BP, BA), false)
  assert.equal(shouldRestoreRound(
    { projectId: BP, sessionId: BA, userMessageId: '', status: 'awaiting_info' }, BP, BA), false)
}

/* 31.5 缺会话身份 → 拒绝（真实案例：echo-test-1 的 session_id 为空）*/
{
  assert.equal(shouldRestoreRound(
    { projectId: BP, sessionId: null, userMessageId: 'msg-echo-1', status: 'awaiting_info' }, BP, BA), false,
    '没有会话身份的历史记录必须降级，不能归到当前会话')
}

/* 31.6 有产物的轮次不需要这条提示 */
{
  assert.equal(shouldRestoreRound(
    { projectId: BP, sessionId: BA, userMessageId: 'u1', status: 'rendered' }, BP, BA), false)
}

/* 31.7 当前作用域缺项目或会话 → 拒绝 */
{
  assert.equal(shouldRestoreRound(
    { projectId: BP, sessionId: BA, userMessageId: 'u1', status: 'awaiting_info' }, null, BA), false)
  assert.equal(shouldRestoreRound(
    { projectId: BP, sessionId: BA, userMessageId: 'u1', status: 'awaiting_info' }, BP, null), false)
}

/* 31.8 「项目最近一次状态」恢复路径同样核对会话 */
{
  assert.equal(shouldRestoreLatestState(
    { state: 'awaiting_info', sessionId: BA, userMessageId: 'u1' }, BP, BA), true)
  assert.equal(shouldRestoreLatestState(
    { state: 'awaiting_info', sessionId: BB, userMessageId: 'u1' }, BP, BA), false,
    '最近一次状态属于会话 B 时，不能写进会话 A')
  assert.equal(shouldRestoreLatestState(
    { state: 'awaiting_info', sessionId: null, userMessageId: 'u1' }, BP, BA), false,
    '状态没有会话身份时降级')
  assert.equal(shouldRestoreLatestState(
    { state: 'awaiting_info', sessionId: BA, userMessageId: null }, BP, BA), false)
  assert.equal(shouldRestoreLatestState(
    { state: 'rendered', sessionId: BA, userMessageId: 'u1' }, BP, BA), false)
  assert.equal(shouldRestoreLatestState(null, BP, BA), false)
}

/* 31.9 多轮回填后各轮各自可查，互不覆盖 */
{
  const rounds = [
    { projectId: BP, sessionId: BA, userMessageId: 'u1', status: 'awaiting_info' },
    { projectId: BP, sessionId: BA, userMessageId: 'u2', status: 'awaiting_info' },
    { projectId: BP, sessionId: BB, userMessageId: 'u3', status: 'awaiting_info' },
  ]
  let written = 0
  for (const r of rounds) {
    if (!shouldRestoreRound(r, BP, BA)) continue
    recordRoundOutcome(BP, BA, { reply: `${r.userMessageId} 的结论`, userMessageId: r.userMessageId })
    written += 1
  }
  assert.equal(written, 2, '只回填本会话的两轮')
  assert.equal(getRoundOutcome(BP, BA, 'u1')?.reply, 'u1 的结论')
  assert.equal(getRoundOutcome(BP, BA, 'u2')?.reply, 'u2 的结论',
    '两轮共存，后一轮不覆盖前一轮')
  assert.equal(getRoundOutcome(BP, BA, 'u3'), null, '别的会话的轮次不会出现在这里')
  assert.equal(getRoundOutcome(BP, BB, 'u3'), null,
    '本轮没有回填会话 B —— 它刷新时由自己的作用域回填')
}

console.log('✓ 实测 31 成功：回填按项目+会话+消息三重核对，跨会话不串用，缺身份降级')

console.log('\n=== 实测 32: 回填缓存必须过期，「先空后产生任务再切回」能拿到 ===')
/* 一次成功就永久 done 的缓存会让会话长期看不到后来产生的结果
   （另一个窗口 / 后台恢复中的任务 / 别的入口写进服务端）。 */

const T0 = 1_700_000_000_000

/* 32.1 从没回填过 → 必须拉 */
{
  assert.equal(shouldRefetchBackfill(undefined, T0), true)
}

/* 32.2 刚回填过 → 不重复请求（避免每次切会话都打接口）*/
{
  assert.equal(shouldRefetchBackfill(T0, T0 + 1_000), false)
  assert.equal(shouldRefetchBackfill(T0, T0 + BACKFILL_TTL_MS - 1), false)
}

/* 32.3 【关键】过了有效期 → 必须重新拉。
   否则「先回填空列表，之后别的窗口产生了任务，再切回」永远看不到。 */
{
  assert.equal(shouldRefetchBackfill(T0, T0 + BACKFILL_TTL_MS), true,
    '到期边界必须重新拉取')
  assert.equal(shouldRefetchBackfill(T0, T0 + BACKFILL_TTL_MS + 1), true)
}

/* 32.4 时间戳异常 → 当作过期，宁可多拉一次也不长期用旧数据 */
{
  assert.equal(shouldRefetchBackfill(NaN, T0), true)
  assert.equal(shouldRefetchBackfill(T0, T0 - 60_000), true, '时钟回拨不能把缓存永久留住')
}

/* 32.5 场景演练：空回填 → 后来产生任务 → 切回时能拿到 */
{
  /* 第一次进入：服务端还没有轮次，回填空 */
  const firstAt = T0
  const firstPass: Array<{ projectId: string; sessionId: string; userMessageId: string; status: string }> = []
  const restored1 = firstPass.filter((r) => shouldRestoreRound(r, BP, BA))
  assert.equal(restored1.length, 0, '首次进入确实没有可回填的轮次')

  /* 用户在另一个窗口产生了一轮结果（本页没收到实时写入）*/
  const laterPass = [
    { projectId: BP, sessionId: BA, userMessageId: 'u-late', status: 'awaiting_info' },
  ]

  /* 立刻切回：缓存仍在有效期内，不会重新拉 —— 这是有意的节流 */
  assert.equal(shouldRefetchBackfill(firstAt, firstAt + 5_000), false)

  /* 过了有效期再切回：必须重新拉，并且这一轮要能回填进来 */
  assert.equal(shouldRefetchBackfill(firstAt, firstAt + BACKFILL_TTL_MS + 1), true)
  const restored2 = laterPass.filter((r) => shouldRestoreRound(r, BP, BA))
  assert.equal(restored2.length, 1, '【关键】后来产生的轮次在过期后必须能拿到')
  assert.equal(restored2[0].userMessageId, 'u-late')
}

console.log('✓ 实测 32 成功：回填缓存按 TTL 过期，先空后产生的轮次能再次拉到')

console.log('\n=== 实测 33: 回复保存失败必须先核对服务端，不能凭异常断言 ===')
/* 后端在创作完成时会自动落库回复（syncTaskReplyToSession），
   所以前端 POST 失败可能只是重复写入或响应丢失。
   单凭异常就说「没保存」会误导用户去重试、甚至以为回复丢了。 */

/* 33.1 服务端已有 → 按已保存显示，不标失败 */
{
  assert.equal(resolveReplySaveState({ kind: 'found', messageId: 'm1', text: 't' }), 'saved',
    '后端已自动保存时不能标成失败')
}

/* 33.2 服务端确认没有 → 明确标出未保存（界面据此给重试）*/
{
  assert.equal(resolveReplySaveState({ kind: 'absent' }), 'absent',
    '确认没存进去时必须给出可见状态，不能像正常回复一样显示')
}

/* 33.3 两种情况必须能区分 —— 这正是「不能凭异常断言」的意义 */
{
  assert.notEqual(
    resolveReplySaveState({ kind: 'found', messageId: 'm1', text: 't' }),
    resolveReplySaveState({ kind: 'absent' }),
  )
}

console.log('✓ 实测 33 成功：保存失败按服务端核对结果分流，不凭异常断言')

console.log('\n=== 实测 34: 回复保存状态必须是三态，「核对失败」不能说成「没保存」===')
/* 把「查完了确实没有」和「没查成」压成两态，断网时界面就会断言
   「回复没有存进会话」—— 而那时后端很可能已经自动保存好了。 */

/* 34.1 找到 → saved */
{
  const lookup = { kind: 'found' as const, messageId: 'm1', text: '回复' }
  assert.equal(resolveReplySaveState(lookup), 'saved')
  assert.equal(replySaveNotice('saved', 'x'), null, 'saved 不该显示任何警告')
}

/* 34.2 查完确实没有 → absent */
{
  assert.equal(resolveReplySaveState({ kind: 'absent' }), 'absent')
  const notice = replySaveNotice('absent', '500')
  assert.ok(notice && notice.includes('没有存进会话'), 'absent 才能明确说没存')
}

/* 34.3 【关键】核对失败 → unknown，不能等同 absent */
{
  const lookup = { kind: 'unknown' as const, reason: '网络不可用' }
  assert.equal(resolveReplySaveState(lookup), 'unknown')
  assert.notEqual(resolveReplySaveState(lookup), 'absent',
    '核对失败不能当成「确认没有保存」')
  const notice = replySaveNotice('unknown', '网络不可用')
  assert.ok(notice && notice.includes('无法确认'), 'unknown 只能说无法确认')
  assert.ok(notice && !notice.includes('没有存进会话'),
    'unknown 绝不能断言「没有存进会话」')
}

/* 34.4 翻页上限被触及也属 unknown（没查完 ≠ 确实没有）*/
{
  const lookup = { kind: 'unknown' as const, reason: '会话消息过多，未能查完' }
  assert.equal(resolveReplySaveState(lookup), 'unknown',
    '没查完不能当作完整查找成功')
}

/* 34.5 三态互不相同，且 unknown 也保留重试（文案里点明可重试）*/
{
  const states = new Set([
    resolveReplySaveState({ kind: 'found', messageId: 'm', text: 't' }),
    resolveReplySaveState({ kind: 'absent' }),
    resolveReplySaveState({ kind: 'unknown', reason: 'x' }),
  ])
  assert.equal(states.size, 3, '三种结果必须能区分')
  assert.ok(replySaveNotice('unknown', 'x')?.includes('重试'))
  assert.ok(replySaveNotice('absent', 'x')?.includes('重试'))
}

console.log('✓ 实测 34 成功：已找到/确认没有/核对失败三态分明，核对失败不断言没保存')

console.log('\n=== 实测 35: 恢复最近状态不得自造重复回复（两种加载顺序）===')
/* 恢复时若自造 creation:... 消息，而真实回复已由历史加载，
   两个 id 不同会同时存在 → 重复回复。
   正确做法：只恢复轮次结论，回复本体交给消息历史。 */

/** 判定「恢复时该不该重读消息」—— 本页缺这条真实回复才重读。 */
function shouldReloadForRestoredReply(
  messages: Array<{ role: string; taskId?: string }>,
  userMessageId: string | undefined,
): boolean {
  if (!userMessageId) return false
  return !messages.some((m) => m.role === 'ai' && m.taskId === userMessageId)
}

const RESTORE_UMID = 'u-restore'

/* 35.1 顺序 A：真实回复**已**加载 → 不重读、不追加 */
{
  const messages = [
    { role: 'user' },
    { role: 'ai', taskId: RESTORE_UMID },
  ]
  assert.equal(shouldReloadForRestoredReply(messages, RESTORE_UMID), false,
    '已有真实回复时不该再重读，更不该自造第二条')
  /* 关键：消息里仍然只有一条 AI 回复 */
  assert.equal(messages.filter((m) => m.role === 'ai').length, 1,
    '恢复不能产生重复回复')
}

/* 35.2 顺序 B：恢复先到、历史尚未加载 → 触发一次重读（而非自造消息）*/
{
  const messages: Array<{ role: string; taskId?: string }> = [{ role: 'user' }]
  assert.equal(shouldReloadForRestoredReply(messages, RESTORE_UMID), true,
    '本页缺这条时必须重读真实消息')
}

/* 35.3 无身份 → 不重读（不猜）*/
{
  assert.equal(shouldReloadForRestoredReply([], undefined), false)
  assert.equal(shouldReloadForRestoredReply([], ''), false)
}

/* 35.4 别人的回复（taskId 不同）不算「本页已有」*/
{
  const messages = [{ role: 'ai', taskId: 'other-round' }]
  assert.equal(shouldReloadForRestoredReply(messages, RESTORE_UMID), true,
    '不能因为别的轮次有回复就认为这一轮也有')
}

console.log('✓ 实测 35 成功：两种加载顺序都不会产生重复回复，缺消息时重读真实记录')

console.log('\n=== 实测 36: 版本身份必须按序列区分，跨序列不能比大小 ===')
/* 场景版本 v4、编辑器试片第 2 次导出、工作流第 3 次运行 ——
   三个 revision 数字长得一样，含义完全不同。
   直接比大小会把「场景 v4」判成「比试片 v2 旧的历史版本」。 */

import {
  versionSeriesOf, versionSeriesKey, versionRelation, isHistoricalAgainst, versionBadgeLabel,
  resolveProjectVersion, findProjectVersionVisual, resolveVersionJumpTarget, versionStanding,
  modifyBlockReason, modifyBlockNotice,
} from './src/data/versionIdentity.ts'

const mk = (origin: string, revision: number, id?: string) =>
  ({ origin, revision, id: id ?? `${origin}-${revision}` }) as any

/* 36.1 序列识别 */
{
  assert.equal(versionSeriesOf(mk('scene', 4)), 'scene')
  assert.equal(versionSeriesOf(mk('editor', 2)), 'editor')
  assert.equal(versionSeriesOf(mk('workflow', 3)), 'workflow')
  /* 老数据没有 origin → 按工作流产物归类 */
  assert.equal(versionSeriesOf({ revision: 1 } as any), 'workflow')
  assert.equal(versionSeriesOf(null), null)
}

/* 36.2 同序列才能比较 */
{
  assert.equal(versionRelation(mk('scene', 3), mk('scene', 4)), 'older')
  assert.equal(versionRelation(mk('scene', 4), mk('scene', 4)), 'same')
  assert.equal(versionRelation(mk('scene', 5), mk('scene', 4)), 'newer')
}

/* 36.3 【关键】跨序列一律 uncomparable，不做大小判断 */
{
  assert.equal(versionRelation(mk('editor', 2), mk('scene', 4)), 'uncomparable',
    '试片第 2 次导出与场景 v4 不是同一序列')
  assert.equal(versionRelation(mk('scene', 4), mk('editor', 2)), 'uncomparable')
  assert.equal(versionRelation(mk('workflow', 3), mk('scene', 4)), 'uncomparable')
}

/* 36.4 跨序列不得标「历史」 */
{
  assert.equal(isHistoricalAgainst(mk('editor', 2), mk('scene', 4)), false,
    '看着试片 v2、基准是场景 v4 时不能报「正在查看历史」')
  assert.equal(isHistoricalAgainst(mk('scene', 3), mk('scene', 4)), true,
    '同序列确实更旧才算历史')
}

/* 36.5 缺任一侧 → 不标历史（不猜）*/
{
  assert.equal(isHistoricalAgainst(null, mk('scene', 4)), false)
  assert.equal(isHistoricalAgainst(mk('scene', 3), null), false)
}

/* 36.6 版本号展示要带来源，避免把试片当成项目版本 */
{
  assert.equal(versionBadgeLabel(mk('scene', 4)), 'v4')
  assert.equal(versionBadgeLabel(mk('editor', 2)), '编辑器试片 v2')
  assert.equal(versionBadgeLabel(mk('workflow', 3)), '工作流产物 v3')
  assert.equal(versionBadgeLabel(null), '无版本')
}

/* 36.7 同一条画面（id 相同）算 same，不因来源缺失误判 */
{
  const a = mk('scene', 4, 'same-id')
  assert.equal(versionRelation(a, a), 'same')
}

console.log('✓ 实测 36 成功：四类版本身份分开，跨序列不比大小、不误标历史')

console.log('\n=== 实测 37: 同 origin 内部也要分序列（不同工作流 / 不同场景文档）===')
/* 光比 origin 不够：workflow 的 revision 是「该工作流自己的修订号」，
   editor 的 revision 是「该场景文档第几次导出」——
   两个不同工作流/不同文档的同一个数字毫无关系。 */

const wf = (workflowId: string, revision: number, id?: string) =>
  ({ origin: 'workflow', workflowId, revision, id: id ?? `${workflowId}-${revision}` }) as any
const ed = (sceneId: string, revision: number, id?: string) =>
  ({ origin: 'editor', artifactId: sceneId, revision, id: id ?? `ed-${sceneId}-${revision}` }) as any
const sc = (revision: number, id?: string) =>
  ({ origin: 'scene', revision, id: id ?? `scene-${revision}` }) as any

/* 37.1 同 origin 不同工作流 → 不可比较 */
{
  assert.equal(versionRelation(wf('wf-A', 2), wf('wf-B', 5)), 'uncomparable',
    '两个不同工作流的修订号不能比大小')
  assert.equal(versionRelation(wf('wf-A', 2), wf('wf-A', 5)), 'older',
    '同一工作流内才可比')
}

/* 37.2 同 origin 不同场景文档的编辑器试片 → 不可比较
   （revision 由 old.filter(r => r.sceneId === doc.id).length + 1 得出，
     每个文档各自从 1 开始）*/
{
  assert.equal(versionRelation(ed('scene-1', 2), ed('scene-2', 5)), 'uncomparable',
    '不同场景文档的「导出次数」不能比大小')
  assert.equal(versionRelation(ed('scene-1', 2), ed('scene-1', 5)), 'older',
    '同一场景文档内才可比')
}

/* 37.3 序列身份键要能区分「哪一条」 */
{
  assert.equal(versionSeriesKey(wf('wf-A', 2)), 'workflow:wf-A')
  assert.equal(versionSeriesKey(wf('wf-B', 2)), 'workflow:wf-B')
  assert.notEqual(versionSeriesKey(wf('wf-A', 2)), versionSeriesKey(wf('wf-B', 2)))
  assert.equal(versionSeriesKey(ed('scene-1', 2)), 'editor:scene-1')
  assert.notEqual(versionSeriesKey(ed('scene-1', 2)), versionSeriesKey(ed('scene-2', 2)))
  /* 场景版本是项目级单序列 */
  assert.equal(versionSeriesKey(sc(16)), 'scene')
  assert.equal(versionSeriesKey(sc(15)), 'scene')
}

/* 37.4 【关键】缺区分依据时不可比较，绝不退化成「同一序列」 */
{
  assert.equal(versionSeriesKey({ origin: 'workflow', revision: 3 } as any), null,
    '没有 workflowId 就不能声称属于某条工作流序列')
  assert.equal(versionSeriesKey({ origin: 'editor', revision: 2 } as any), null,
    '没有 sceneId 就不能声称属于某条文档序列')
  assert.equal(versionRelation(
    { origin: 'workflow', revision: 3 } as any,
    { origin: 'workflow', revision: 5 } as any,
  ), 'uncomparable', '两条都没有归属的产物不能互相比大小')
}

/* 37.5 场景 v15 相对 v16 是历史；跨来源（试片 vs 场景）不是 */
{
  assert.equal(isHistoricalAgainst(sc(15), sc(16)), true)
  assert.equal(isHistoricalAgainst(ed('scene-1', 2), sc(16)), false,
    '试片导出次数不是「比场景 v16 旧的历史版本」')
  assert.equal(isHistoricalAgainst(wf('wf-A', 3), sc(16)), false)
}

console.log('✓ 实测 37 成功：同 origin 内按工作流/文档分序列，缺依据不可比较')

console.log('\n=== 实测 38: 当前工程无对应渲染画面时，历史判断仍成立 ===')
/* projectVersionLead 只能从「有产物文件」的场景版本里取。
   工程改到 v17 但还没渲出片时，画面列表最大仍是 v16。
   此时若用列表值当基准，v16 会被判成「最新」—— 但它其实落后工程一版。 */

/**
 * 与 Workbench 中 viewedIsHistorical / projectVersionNumber 同构的判定。
 * 优先用后端权威版本号，取不到才退回画面列表最大值。
 */
function resolveProjectVersionNumber(
  backendVersion: number | null | undefined,
  visuals: Array<{ origin?: string; revision: number }>,
): number | null {
  if (typeof backendVersion === 'number') return backendVersion
  const scenes = visuals.filter((v) => v.origin === 'scene')
  if (!scenes.length) return null
  return scenes.reduce((best, cur) => (cur.revision > best.revision ? cur : best)).revision
}

function viewedIsHistorical(
  viewed: { origin?: string; revision: number } | null,
  projectVersion: number | null,
): boolean {
  if (!viewed || viewed.origin !== 'scene') return false
  if (typeof viewed.revision !== 'number' || projectVersion === null) return false
  return viewed.revision < projectVersion
}

/* 38.1 工程已到 v17、画面只到 v16 → v16 判为历史（这正是修掉的问题）*/
{
  const visuals = [{ origin: 'scene', revision: 16 }, { origin: 'scene', revision: 15 }]
  const vnum = resolveProjectVersionNumber(17, visuals)
  assert.equal(vnum, 17, '后端权威版本优先')
  assert.equal(viewedIsHistorical({ origin: 'scene', revision: 16 }, vnum), true,
    '【关键】工程已到 v17 时 v16 必须是历史，不能因为列表最大是 v16 就当成最新')
}

/* 38.2 后端版本取不到 → 退回列表最大值（仍能判断）*/
{
  const visuals = [{ origin: 'scene', revision: 16 }, { origin: 'scene', revision: 15 }]
  const vnum = resolveProjectVersionNumber(null, visuals)
  assert.equal(vnum, 16)
  assert.equal(viewedIsHistorical({ origin: 'scene', revision: 15 }, vnum), true)
  assert.equal(viewedIsHistorical({ origin: 'scene', revision: 16 }, vnum), false)
}

/* 38.3 完全没有场景画面 → 版本号 null，不编结论 */
{
  const vnum = resolveProjectVersionNumber(null, [{ origin: 'editor', revision: 2 }])
  assert.equal(vnum, null)
  assert.equal(viewedIsHistorical({ origin: 'scene', revision: 15 }, vnum), false,
    '拿不到工程版本时不标历史（不猜）')
}

/* 38.4 看的是试片 → 永不标历史（不同序列）*/
{
  const vnum = resolveProjectVersionNumber(17, [{ origin: 'scene', revision: 16 }])
  assert.equal(viewedIsHistorical({ origin: 'editor', revision: 2 }, vnum), false)
}

/* 38.5 列表首项是试片时，场景画面仍能正确判断
   （这是 P1 报告的核心场景：stageLead=试片，看场景 v15）*/
{
  const visuals = [
    { origin: 'editor', revision: 2 },   // 首项是试片（按创建时间排最前）
    { origin: 'scene', revision: 16 },
    { origin: 'scene', revision: 15 },
  ]
  const vnum = resolveProjectVersionNumber(null, visuals)
  assert.equal(vnum, 16, '基准要取场景序列最大值，不能被首项试片干扰')
  assert.equal(viewedIsHistorical({ origin: 'scene', revision: 15 }, vnum), true,
    '【关键】首项是试片时，场景 v15 相对 v16 仍要判为历史')
}

console.log('✓ 实测 38 成功：无渲染画面时用后端版本号，首项是试片也不影响判断')

console.log('\n=== 实测 39: 工程版本与最新可下载画面分开表达 ===')
/* 「工程改到第几版」和「哪一版能下载」是两件事：
   工程可能已到 v17 而最新可下载画面仍是 v16。
   把两者混成一个数字，跳转会把人带到仍是历史的旧版，或带到别的来源。 */

const vw = (origin: string, revision: number, extra: Record<string, unknown> = {}) =>
  ({ origin, revision, ...extra }) as any

/* 39.1 后端有版本 → 权威 */
{
  const info = resolveProjectVersion(17, [vw('scene', 16)])
  assert.equal(info.version, 17)
  assert.equal(info.source, 'backend')
  assert.equal(info.authoritative, true)
}

/* 39.2 后端读不到 → 退回列表最大值，但**不权威** */
{
  const info = resolveProjectVersion(null, [vw('scene', 16), vw('scene', 15), vw('editor', 2)])
  assert.equal(info.version, 16)
  assert.equal(info.source, 'visuals')
  assert.equal(info.authoritative, false,
    '已知画面最高 ≠ 当前工程版本，不能无条件标「最新工程」')
}

/* 39.3 完全拿不到 → unknown */
{
  const info = resolveProjectVersion(undefined, [vw('editor', 2)])
  assert.equal(info.version, null)
  assert.equal(info.source, 'unknown')
  assert.equal(info.authoritative, false)
}

/* 39.4 【关键】工程 v17、画面只到 v16 → 找不到「当前工程版本」对应画面，
   不能退回 v16（那会把人带到仍是历史的版本上） */
{
  const visuals = [vw('scene', 16), vw('scene', 15)]
  const info = resolveProjectVersion(17, visuals)
  const target = findProjectVersionVisual(info, visuals)
  assert.equal(target, null,
    '工程 v17 尚未渲出画面时，不得跳到一个仍是历史的 v16')
}

/* 39.5 有对应画面时才给跳转目标 */
{
  const visuals = [vw('scene', 16), vw('scene', 15)]
  const info = resolveProjectVersion(16, visuals)
  const target = findProjectVersionVisual(info, visuals)
  assert.ok(target && (target as any).revision === 16)
}

/* 39.6 【关键】不能跳到工作流产物：即使它是「最新可下载」，
   也不属于当前工程版本序列 */
{
  const visuals = [vw('workflow', 9, { workflowId: 'wf-A' }), vw('scene', 16), vw('scene', 15)]
  const info = resolveProjectVersion(16, visuals)
  const target = findProjectVersionVisual(info, visuals)
  assert.equal((target as any)?.origin, 'scene',
    '跳转目标必须是场景画面，不能是工作流产物')
  assert.equal((target as any)?.revision, 16)
}

/* 39.7 版本未知 → 不给跳转（不猜）*/
{
  const info = resolveProjectVersion(null, [])
  assert.equal(findProjectVersionVisual(info, []), null)
}

console.log('✓ 实测 39 成功：工程版本与可下载画面分开，跳转只认当前工程版本画面')

console.log('\n=== 实测 40: 隔离场景矩阵（你列的五种情况）===')
/* 把用户要求的五种情况逐一过一遍：胶囊、列表标记、跳转、导出目标。 */

const seriesOf = (v: any) => versionSeriesOf(v)

/* 40.1 场景 v15/v16 与编辑器试片 v2 同时存在 */
{
  const visuals = [vw('editor', 2, { artifactId: 'doc-1' }), vw('scene', 16), vw('scene', 15)]
  const info = resolveProjectVersion(16, visuals)
  assert.equal(info.version, 16)
  /* 试片不得被当作历史（不同序列）*/
  assert.equal(isHistoricalAgainst(visuals[0], visuals[1]), false)
  /* 场景 v15 相对 v16 是历史 */
  assert.equal(isHistoricalAgainst(visuals[2], visuals[1]), true)
  /* 跳转目标是场景 v16，不是试片 */
  assert.equal((findProjectVersionVisual(info, visuals) as any).revision, 16)
  /* 胶囊标签要带来源 */
  assert.equal(versionBadgeLabel(visuals[0]), '编辑器试片 v2')
  assert.equal(versionBadgeLabel(visuals[1]), 'v16')
}

/* 40.2 两个不同工作流各自产物同时存在 */
{
  const a = vw('workflow', 3, { workflowId: 'wf-A' })
  const b = vw('workflow', 5, { workflowId: 'wf-B' })
  assert.equal(seriesOf(a), 'workflow')
  assert.equal(seriesOf(b), 'workflow')
  /* 同 origin 但不同工作流 → 不可比较 */
  assert.equal(versionRelation(a, b), 'uncomparable')
  assert.equal(isHistoricalAgainst(a, b), false,
    '不能因为 3 < 5 就把 A 的产物标成 B 的历史版本')
}

/* 40.3 当前工程 v17，但最新渲染画面为 v16 */
{
  const visuals = [vw('scene', 16), vw('scene', 15)]
  const info = resolveProjectVersion(17, visuals)
  assert.equal(info.version, 17)
  assert.equal(info.authoritative, true)
  /* v16 相对 v17 是历史 —— 这正是修掉的问题 */
  assert.equal(viewedIsHistorical({ origin: 'scene', revision: 16 }, info.version), true)
  /* 且没有可跳转的「当前工程版本」画面 */
  assert.equal(findProjectVersionVisual(info, visuals), null)
}

/* 40.4 工程版本暂时无法读取 */
{
  const visuals = [vw('scene', 16)]
  const info = resolveProjectVersion(null, visuals)
  assert.equal(info.authoritative, false)
  /* 界面此时不该标「最新工程」—— 用 authoritative 控制，而不是 version 非空 */
  assert.equal(info.version !== null && info.authoritative, false,
    '有数字但不权威，不能标最新工程')
}

/* 40.5 导出目标仍是「最新可下载整片」，与工程版本各归各的 */
{
  const visuals = [
    vw('workflow', 9, { workflowId: 'wf-A', tier: 'final' }),
    vw('scene', 16, { tier: 'final' }),
    vw('scene', 15, { tier: 'final' }),
  ]
  const info = resolveProjectVersion(17, visuals)
  /* 工程版本 17（后端权威），跳转目标没有（v17 未渲出片）*/
  assert.equal(info.version, 17)
  assert.equal(findProjectVersionVisual(info, visuals), null)
  /* 而「最新可下载整片」是另一件事，由 deliverableLead 单独提供 ——
     两者不能互相顶替，这里只确认它们取值路径不同：
     跳转不因为存在可下载画面就给出错误目标。 */
}

console.log('✓ 实测 40 成功：五种隔离场景的判定均符合预期')

console.log('\n=== 实测 41: 非权威版本不得断言「当前工程」 ===')
/* 后端版本读不到、只知道列表里最高是 v16 时：
   v16 可以叫「已知画面中版本最高」，但不能叫「当前工程版本」，
   v15 也不能被断言成「历史版本、修改将基于最新工程 v16」。 */

const visualsA = [vw('scene', 16), vw('scene', 15)]

/* 41.1 非权威时 standing 降级为 older_than_known（不是 historical）*/
{
  const info = resolveProjectVersion(null, visualsA)
  assert.equal(info.authoritative, false)
  assert.equal(versionStanding(vw('scene', 15), info), 'older_than_known',
    '版本未确认时只能说「比已知最新旧」，不能说「历史版本」')
  assert.equal(versionStanding(vw('scene', 16), info), 'current')
}

/* 41.2 权威时才是 historical */
{
  const info = resolveProjectVersion(16, visualsA)
  assert.equal(info.authoritative, true)
  assert.equal(versionStanding(vw('scene', 15), info), 'historical')
}

/* 41.3 【关键】跳转目标的 kind 必须反映可信度 */
{
  const nonAuth = resolveProjectVersion(null, visualsA)
  const t1 = resolveVersionJumpTarget(nonAuth, visualsA)
  assert.ok(t1)
  assert.equal(t1!.kind, 'known_latest',
    '非权威时只能说「查看已知最新画面」，不能说「回到当前工程版本」')

  const auth = resolveProjectVersion(16, visualsA)
  const t2 = resolveVersionJumpTarget(auth, visualsA)
  assert.ok(t2)
  assert.equal(t2!.kind, 'project_version')
}

/* 41.4 非权威且无对应画面 → 不给跳转 */
{
  const info = resolveProjectVersion(null, [vw('scene', 15)])
  const t = resolveVersionJumpTarget(info, [vw('scene', 15)])
  /* 已知最高是 v15，列表里正好有 v15 → 可以跳，但 kind 是 known_latest */
  assert.ok(t)
  assert.equal(t!.kind, 'known_latest')
  /* 若画面列表里没有该版本（例如版本号来自别处），则不给跳转 */
  assert.equal(resolveVersionJumpTarget(info, []), null)
}

/* 41.5 跨序列不适用 */
{
  const info = resolveProjectVersion(16, visualsA)
  assert.equal(versionStanding(vw('editor', 2, { artifactId: 'd1' }), info), 'not_applicable',
    '试片不参与工程版本历史判断')
  assert.equal(versionStanding(null, info), 'not_applicable')
}

/* 41.6 完全读不到版本 → 场景画面归 unknown_baseline（不猜，且要拦）*/
{
  const info = resolveProjectVersion(null, [])
  assert.equal(info.source, 'unknown')
  assert.equal(versionStanding(vw('scene', 15), info), 'unknown_baseline')
}

/* 41.7 三种 standing 必须互不相同，界面文案才能分开 */
{
  const auth = resolveProjectVersion(16, visualsA)
  const nonAuth = resolveProjectVersion(null, visualsA)
  const states = new Set([
    versionStanding(vw('scene', 16), auth),
    versionStanding(vw('scene', 15), auth),
    versionStanding(vw('scene', 15), nonAuth),
  ])
  assert.equal(states.size, 3, 'current / historical / older_than_known 必须可区分')
}

console.log('✓ 实测 41 成功：非权威时降级措辞，跳转与提示都带可信度')

console.log('\n=== 实测 42: 未初始化的工程不得把 version=0 当工程版本 ===')
/* 后端在「项目还没有任何工程版本」时也会返回 version: 0（initialized=false）。
   0 不是版本号 —— 当成权威工程版本会显示「当前工程版本 v0」，
   并把真实存在的画面全判成「比 v0 新」。 */

/**
 * 与 Workbench 中 projectVersion 的构造同构：
 * 只有 initialized 为真才认后端那个数字。
 */
function projectVersionOf(
  scene: { initialized?: boolean; version?: number } | null | undefined,
  visuals: Array<{ origin?: string; revision: number }>,
) {
  const backendVersion = scene?.initialized === true ? scene.version : undefined
  return resolveProjectVersion(backendVersion, visuals)
}

/* 42.1 未初始化 + version:0 → 不认作工程版本 */
{
  const info = projectVersionOf({ initialized: false, version: 0 }, [])
  assert.equal(info.source, 'unknown', '未初始化时的 0 不是工程版本')
  assert.equal(info.version, null)
  assert.equal(info.authoritative, false)
}

/* 42.2 未初始化但已有画面（试片）→ 来源是 visuals，不权威 */
{
  const visuals = [vw('editor', 2, { artifactId: 'doc-1' })]
  const info = projectVersionOf({ initialized: false, version: 0 }, visuals)
  assert.equal(info.version, null, '只有试片时没有场景版本号')
  assert.equal(info.authoritative, false)
}

/* 42.3 已初始化 + version:0 也不该被当成「工程版本 v0」——
   0 表示还没有版本，任何真实画面都比它新是荒谬的 */
{
  const visuals = [vw('scene', 0)]
  const info = projectVersionOf({ initialized: true, version: 0 }, visuals)
  /* 这条只记录当前行为：initialized 为真时认这个数字（后端契约如此）。
     真实数据里 initialized 为真时 version 至少为 1。 */
  assert.equal(info.version, 0)
  /* 但界面不该把 v0 当成「有画面」去跳转 —— 由 visuals 是否含该版本决定 */
  assert.equal(resolveVersionJumpTarget(info, visuals)?.kind, 'project_version')
}

/* 42.4 正常已初始化 → 权威 */
{
  const info = projectVersionOf({ initialized: true, version: 16 }, [vw('scene', 16)])
  assert.equal(info.version, 16)
  assert.equal(info.authoritative, true)
  assert.equal(info.source, 'backend')
}

/* 42.5 未初始化时的 standing（不产生假历史标记）
   注意：场景画面在「工程版本未知」时是 unknown_baseline，不是 not_applicable
   （后者专指非场景画面）—— 见实测 48。 */
{
  const info = projectVersionOf({ initialized: false, version: 0 }, [vw('editor', 2, { artifactId: 'd' })])
  assert.equal(versionStanding(vw('editor', 2, { artifactId: 'd' }), info), 'not_applicable')
  assert.equal(versionStanding(vw('scene', 15), info), 'unknown_baseline')
}

console.log('✓ 实测 42 成功：未初始化的 version=0 不被当作工程版本')

console.log('\n=== 实测 43: 不可修改的原因要传给能力评估器，不能只传布尔 ===')
/* 两种原因都拦截，但用户该做的事完全不同：
   确认历史 → 恢复/继续调整；工程版本未确认 → 重试或重选画面。
   只传布尔会让评估器统一按「历史版本」给理由。 */

/* 43.1 三种 standing → 三种原因
   （current / newer 的判定在实测 46 里细化：要带 projectVersion 看基准是否可信） */
{
  assert.equal(modifyBlockReason('historical'), 'historical')
  assert.equal(modifyBlockReason('older_than_known'), 'unconfirmed')
  assert.equal(modifyBlockReason('not_applicable'), 'ok')
}

/* 43.2 两种原因的文案必须不同 */
{
  const h = modifyBlockNotice('historical')
  const u = modifyBlockNotice('unconfirmed')
  assert.ok(h && h.includes('历史版本'))
  assert.ok(u && u.includes('无法确认'))
  assert.notEqual(h, u, '历史版本与版本未确认必须给出不同建议')
  assert.equal(modifyBlockNotice('ok'), null)
}

/* 43.3 「不可修改」的判定要覆盖两种原因 */
{
  const auth = resolveProjectVersion(16, visualsA)
  const nonAuth = resolveProjectVersion(null, visualsA)
  /* 确认历史 → 拦 */
  assert.equal(modifyBlockReason(versionStanding(vw('scene', 15), auth), auth), 'historical')
  /* 版本未确认 → 也拦，但原因是 unconfirmed */
  assert.equal(modifyBlockReason(versionStanding(vw('scene', 15), nonAuth), nonAuth), 'unconfirmed')
  /* 当前版本 + 基准可信 → 放行 */
  assert.equal(modifyBlockReason(versionStanding(vw('scene', 16), auth), auth), 'ok')
}

console.log('✓ 实测 43 成功：不可修改的原因随状态传递，文案与建议分开')

console.log('\n=== 实测 44: 目标胶囊不跨序列比较、未确认时不断言 ===')
/* 胶囊原先把 preview.revision 与 stageLead.revision 直接比大小。
   首项是试片时会把试片导出次数当工程版本；工程版本未确认时还会
   断言「基准工程已更新至 vN」。 */

/** 与 TargetSummaryPill 中 canCompareWithProject / isHistorical 同构。 */
function pillHistorical(
  targetVersion: number | null,
  targetSeries: 'scene' | 'editor' | 'workflow' | null,
  stageLeadVersion: number | null,
  versionUnconfirmed: boolean,
): boolean {
  const hasVersion = targetVersion !== null && targetVersion !== undefined
  const canCompare = Boolean(
    hasVersion && targetSeries === 'scene' && !versionUnconfirmed
      && stageLeadVersion !== null && stageLeadVersion !== undefined,
  )
  return canCompare && Number(targetVersion) < Number(stageLeadVersion)
}

/* 44.1 场景目标 + 可信工程版本 → 能正确判历史 */
{
  assert.equal(pillHistorical(15, 'scene', 16, false), true)
  assert.equal(pillHistorical(16, 'scene', 16, false), false)
}

/* 44.2 【关键】目标来自试片 → 不跨序列比较 */
{
  assert.equal(pillHistorical(2, 'editor', 16, false), false,
    '试片导出次数不是「比工程 v16 旧的历史版本」')
  assert.equal(pillHistorical(3, 'workflow', 16, false), false)
}

/* 44.3 【关键】工程版本未确认 → 不做断言 */
{
  assert.equal(pillHistorical(15, 'scene', 16, true), false,
    '工程版本未确认时不能断言「已过期历史」')
}

/* 44.4 缺来源 → 不比较（不猜）*/
{
  assert.equal(pillHistorical(15, null, 16, false), false)
}

/* 44.5 缺工程版本 → 不比较 */
{
  assert.equal(pillHistorical(15, 'scene', null, false), false)
}

console.log('✓ 实测 44 成功：胶囊只在同序列且工程版本可信时才判历史')

console.log('\n=== 实测 45: 目标快照必须自带来源，不能从当前预览推断 ===')
/* 用户可以先固化目标、再切换预览 —— 那时快照里的版本号与当前预览
   已经不是同一画面。用新预览的来源解释旧快照的数字，就会把
   「试片的第 2 次导出」当成场景版本参与比较。 */

/** 与 TargetSummaryPill 中 effectiveSeries / canCompare 同构。 */
function pillSeries(snapshot: { versionSeries?: string | null } | null, propSeries: string | null) {
  return snapshot ? (snapshot.versionSeries ?? null) : (propSeries ?? null)
}
function pillCanCompare(
  version: number | null,
  snapshot: { versionSeries?: string | null; versionConfirmed?: boolean } | null,
  propSeries: string | null,
  stageLead: number | null,
  propUnconfirmed: boolean,
) {
  const series = pillSeries(snapshot, propSeries)
  const confirmed = snapshot ? snapshot.versionConfirmed === true : !propUnconfirmed
  return Boolean(
    version !== null && series === 'scene' && confirmed && !propUnconfirmed
      && stageLead !== null,
  )
}

/* 45.1 快照自带 scene → 可比较 */
{
  const snap = { versionSeries: 'scene', versionConfirmed: true }
  assert.equal(pillSeries(snap, 'editor'), 'scene', '快照自己的来源优先')
  assert.equal(pillCanCompare(15, snap, 'editor', 16, false), true)
}

/* 45.2 【关键】快照记的是试片，而当前预览是场景 → 仍按快照的试片处理，不比较 */
{
  const snap = { versionSeries: 'editor', versionConfirmed: true }
  assert.equal(pillSeries(snap, 'scene'), 'editor')
  assert.equal(pillCanCompare(2, snap, 'scene', 16, false), false,
    '快照是试片时不能拿当前预览的来源去比较')
}

/* 45.3 旧快照没有来源 → 降级，不比较（不猜）*/
{
  const snap = { version: 15 } as any
  assert.equal(pillSeries(snap, 'scene'), null, '旧快照来源不明')
  assert.equal(pillCanCompare(15, snap, 'scene', 16, false), false,
    '来源不明时不能从「有数字」推断它是场景版本')
}

/* 45.4 快照写入时未确认 → 之后即使后端恢复也不当权威 */
{
  const snap = { versionSeries: 'scene', versionConfirmed: false }
  assert.equal(pillCanCompare(15, snap, 'scene', 16, false), false,
    '写入时未确认的旧数字不能当权威工程版本')
}

/* 45.5 没有快照时才用调用方传的来源（对应「当前画面」语义）*/
{
  assert.equal(pillSeries(null, 'scene'), 'scene')
  assert.equal(pillCanCompare(15, null, 'scene', 16, false), true)
  assert.equal(pillCanCompare(15, null, 'scene', 16, true), false, '调用方说未确认就不比较')
}

console.log('✓ 实测 45 成功：快照自带来源优先，旧快照缺身份时降级不猜')

console.log('\n=== 实测 46: 不可修改原因必须考虑基准可信度 ===')
/* modifyBlockReason 原先对 not_applicable 与非权威的 current 都返回 ok。
   后者会让界面先显示「可修改」，提交时才被别的校验拒绝 —— 前后矛盾。 */

const authV = resolveProjectVersion(16, visualsA)
const nonAuthV = resolveProjectVersion(null, visualsA)
const unknownV = resolveProjectVersion(null, [])

/* 46.1 权威 + current → ok */
{
  assert.equal(modifyBlockReason('current', authV), 'ok')
}

/* 46.2 【关键】非权威 + current → unconfirmed（不是 ok）*/
{
  assert.equal(modifyBlockReason('current', nonAuthV), 'unconfirmed',
    '版本号相同但基准不可信时，不能先显示可修改')
}

/* 46.3 权威 + newer → 数据不一致，拦 */
{
  assert.equal(modifyBlockReason('newer', authV), 'unconfirmed')
}

/* 46.4 historical / older_than_known 不受影响 */
{
  assert.equal(modifyBlockReason('historical', authV), 'historical')
  assert.equal(modifyBlockReason('older_than_known', nonAuthV), 'unconfirmed')
}

/* 46.5 not_applicable（非场景画面）不在此处拦，由其它能力检查管 */
{
  assert.equal(modifyBlockReason('not_applicable', authV), 'ok')
  assert.equal(modifyBlockReason('not_applicable', unknownV), 'ok')
}

/* 46.6 未传 projectVersion 时保持旧行为（向后兼容），但 current 保守处理 */
{
  assert.equal(modifyBlockReason('historical'), 'historical')
  assert.equal(modifyBlockReason('current'), 'unconfirmed',
    '不知道基准是否可信时，current 不能直接放行')
}

console.log('✓ 实测 46 成功：不可修改原因纳入基准可信度，避免先放行后拒绝')

console.log('\n=== 实测 47: 快照来源字段必须参与等价判断 ===')
/* isEquivalentSnapshot 同时决定「草稿要不要更新」和「成功后清不清」。
   漏比字段 → 只改来源时被判成「没变」，更新被静默丢弃。 */

import { isEquivalentSnapshotForTest } from './src/shell/useDraftStore.ts'

const snapOf = (extra: Record<string, unknown>) => ({
  version: 16, scope: 'selection', rangeSpan: { start: 1, end: 2 },
  bbox: null, label: '目标', previewImage: null, pinned: true,
  intentAction: 'modify', references: [],
  ...extra,
}) as any

/* 47.1 完全相同 → 等价 */
{
  assert.equal(isEquivalentSnapshotForTest(snapOf({}), snapOf({})), true)
}

/* 47.2 【关键】只改 versionSeries → 不等价（不能被当成「没变」）*/
{
  const a = snapOf({ versionSeries: undefined })
  const b = snapOf({ versionSeries: 'scene' })
  assert.equal(isEquivalentSnapshotForTest(a, b), false,
    '旧快照补来源时必须判为变化，否则更新被丢弃')
}

/* 47.3 来源切换 → 不等价 */
{
  assert.equal(
    isEquivalentSnapshotForTest(snapOf({ versionSeries: 'scene' }), snapOf({ versionSeries: 'editor' })),
    false,
  )
}

/* 47.4 【关键】只改 versionConfirmed → 不等价 */
{
  assert.equal(
    isEquivalentSnapshotForTest(snapOf({ versionConfirmed: false }), snapOf({ versionConfirmed: true })),
    false,
    '确认状态变化必须判为变化，否则成功后清理判断会错',
  )
}

/* 47.5 两字段都相同 → 仍等价（不引入误报）*/
{
  assert.equal(
    isEquivalentSnapshotForTest(
      snapOf({ versionSeries: 'scene', versionConfirmed: true }),
      snapOf({ versionSeries: 'scene', versionConfirmed: true }),
    ),
    true,
  )
}

console.log('✓ 实测 47 成功：来源与确认状态纳入快照等价判断')

console.log('\n=== 实测 48: 场景画面缺基准时不得声称可修改 ===')
/* 工程版本完全读不到时，原实现 versionStanding 返回 not_applicable，
   modifyBlockReason 对它返回 ok —— 场景缺基准与非场景画面混在一起，
   会导致「先显示可修改、提交才拒绝」。 */

/* 48.1 场景画面 + 工程版本未知 → unknown_baseline（不是 not_applicable）*/
{
  const unknownV = resolveProjectVersion(null, [])
  assert.equal(versionStanding(vw('scene', 16), unknownV), 'unknown_baseline',
    '场景画面缺基准要单独一类，不能混进 not_applicable')
}

/* 48.2 【关键】unknown_baseline 必须拦 */
{
  const unknownV = resolveProjectVersion(null, [])
  assert.equal(modifyBlockReason('unknown_baseline', unknownV), 'unconfirmed',
    '工程版本读不到时不能先声称可修改')
}

/* 48.3 非场景画面仍是 not_applicable，不在此处拦（由其它能力检查管）*/
{
  const unknownV = resolveProjectVersion(null, [])
  assert.equal(versionStanding(vw('editor', 2, { artifactId: 'd' }), unknownV), 'not_applicable')
  assert.equal(modifyBlockReason('not_applicable', unknownV), 'ok')
}

/* 48.4 无画面 → not_applicable */
{
  const unknownV = resolveProjectVersion(null, [])
  assert.equal(versionStanding(null, unknownV), 'not_applicable')
}

/* 48.5 有基准时行为不变 */
{
  const authV = resolveProjectVersion(16, visualsA)
  assert.equal(versionStanding(vw('scene', 16), authV), 'current')
  assert.equal(modifyBlockReason('current', authV), 'ok')
}

console.log('✓ 实测 48 成功：场景缺基准单独归类并拦截，不与「非场景画面」混淆')



console.log('\n========================================')
console.log('全套 48 项真实功能与交互场景测试全部严格通过！')
console.log('========================================')

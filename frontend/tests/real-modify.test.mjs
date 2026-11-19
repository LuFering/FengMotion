import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { fakeStudio, installBrowserGlobals, spy, startViteForModules, stateSpy } from './support/fake-studio.mjs'

/*
 * 工作台「真实修改」的提交路径（useRealModify → submitFilmCorrection / submitSceneModify）。
 *
 * 这几条路径在拆分时调整过控制流：两条路径各自成文件，主函数 `return await` 调用。
 * 这里守的是拆分前后必须一致的行为：
 *   · 前置校验拦下时不碰后端、不进忙碌态；
 *   · 两条路径的成功 / 失败 / 抛错都返回正确结果，且忙碌态一定复位（finally 在路径结束后才跑）；
 *   · 普通场景路径里的异常仍由主函数的 catch 接住，错误如实显示。
 */

let server
let api
let useRealModify
let roundOutcomes

installBrowserGlobals()

before(async () => {
  server = await startViteForModules()
  api = await server.ssrLoadModule('/src/api/index.ts')
  ;({ useRealModify } = await server.ssrLoadModule('/src/features/workbench/hooks/submit/useRealModify.ts'))
  roundOutcomes = await server.ssrLoadModule('/src/features/chat/model/roundOutcomes.ts')
})

after(async () => {
  api?.installStudioHttpApi(null)
  await server?.close()
})

let studio
beforeEach(() => {
  studio = fakeStudio()
  api.installStudioHttpApi(studio.client)
})

/** 一份能走通的参数；over 里给的字段覆盖默认值。 */
function makeArgs(over = {}) {
  let userSeq = 0
  const args = {
    buildRequest: (prompt, kind, constraints) => ({ kind, prompt, scope: 'project', sceneIds: [], references: [], constraints }),
    capturedPreview: { current: null },
    chat: { appendMessage: spy() },
    constraints: { preserveCamera: false, preserveCaptions: false, limitToSelection: false, reuseExistingComponents: false },
    correctionAttempt: { current: null },
    currentSceneState: null,
    ensureBoundSession: spy(async () => ({ sessionId: 's1' })),
    filmProject: { ready: true },
    focusFeedback: spy(),
    pendingSubmissionRef: { current: null },
    previewDuration: 10,
    previewMediaRef: { current: null },
    projectId: 'p1',
    projectVersionLead: null,
    realModifyBusy: false,
    realRenderBusy: false,
    refreshCurrentScene: spy(async () => {}),
    remoteCreationBusy: false,
    rereadRuns: spy(),
    review: { addCorrection: spy(), brief: { original: '' }, keepNotes: '', record: spy() },
    sceneVersions: { refresh: spy(async () => {}) },
    setAgentReply: stateSpy(''),
    setAwaitingActive: stateSpy(false),
    setBottomTab: stateSpy('changes'),
    setComparison: stateSpy(null),
    setCurrentSceneState: stateSpy(null),
    setExecutionPhase: stateSpy(''),
    setNotice: stateSpy(''),
    setPendingPlayback: stateSpy(null),
    setRealModifyBusy: stateSpy(false),
    setRealModifyError: stateSpy(''),
    setSelectedArtifactId: stateSpy(null),
    setSelectedVisual: spy(),
    setSourceCreationBusy: stateSpy(false),
    setUnsavedReplies: stateSpy([]),
    setUsedResources: stateSpy([]),
    sourceOperation: { current: false },
    submissionEngine: { model: 'm1', harness: 'h1' },
    tasks: {
      currentScene: spy(async () => ({ scene: { initialized: true, version: 3 } })),
      startModify: spy(async () => ({ taskId: 't1' })),
    },
    threads: {
      sendMessage: spy(async (_sid, _text, opts) => ({ id: opts?.role === 'assistant' ? 'ai-1' : `u-${++userSeq}` })),
      appendExtraMessage: spy(),
    },
    updatePendingSubmission: spy(),
    viewedPreview: null,
    workflowRunning: false,
    ...over,
  }
  return args
}

/** 忙碌态必须在提交结束后全部复位。 */
function assertReleased(args) {
  assert.equal(args.sourceOperation.current, false)
  assert.equal(args.setRealModifyBusy.value, false)
  assert.equal(args.setSourceCreationBusy.value, false)
  assert.ok(args.rereadRuns.calls.length > 0, '结束时要重读运行记录')
}

const creationPosts = () => studio.called('http.post')

/* ── 前置校验 ─────────────────────────────────────────────── */

test('空要求：直接拦下并聚焦输入框，不碰后端、不进忙碌态', async () => {
  const args = makeArgs()
  assert.equal(await useRealModify(args).submitRealModify('   '), false)
  assert.equal(args.setRealModifyError.value, '请先写下制作要求')
  assert.equal(args.focusFeedback.calls.length, 1)
  assert.equal(args.setRealModifyBusy.calls.length, 0)
  assert.equal(studio.calls.length, 0)
})

test('已有操作在跑：不重复提交，也不改忙碌态', async () => {
  const args = makeArgs({ realModifyBusy: true })
  assert.equal(await useRealModify(args).submitRealModify('改亮一点'), false)
  assert.equal(args.setRealModifyBusy.calls.length, 0)
  assert.equal(studio.calls.length, 0)
})

test('时间段不在当前最新视频内：拦下并说明', async () => {
  const lead = { id: 'v3', origin: 'scene', revision: 3, file: '/r/v3.mp4' }
  const args = makeArgs({ viewedPreview: lead, projectVersionLead: lead })
  assert.equal(await useRealModify(args).submitRealModify('改亮一点', { start: 2, end: 12 }), false)
  assert.match(args.setRealModifyError.value, /有效的时间范围/)
  assert.equal(studio.calls.length, 0)
})

/* ── Remotion 工程路径（submitFilmCorrection） ──────────────── */

test('工程修改成功：先落用户消息与修改意见，再发起创作，回复落盘并刷新版本', async () => {
  const args = makeArgs()
  assert.equal(await useRealModify(args).submitRealModify('把标题改成红色'), true)

  /* 用户消息先落库，修改意见写进 corrections.md */
  const [sid, text] = args.threads.sendMessage.calls[0]
  assert.equal(sid, 's1')
  assert.equal(text, '把标题改成红色')
  assert.deepEqual(studio.called('workflowContext.recordCorrection')[0].slice(1), ['p1', '把标题改成红色'])

  /* 创作请求带上会话与用户消息身份 */
  assert.equal(creationPosts().length, 1)
  const body = creationPosts()[0][2]
  assert.equal(body.sessionId, 's1')
  assert.equal(body.userMessageId, 'u-1')
  assert.equal(body.requestId, 'u-1')
  assert.equal(body.baseVersion, undefined, '非定点修改不带基准版本')

  /* 回复落盘、界面状态更新 */
  assert.equal(args.setAgentReply.value, '已按要求修改')
  assert.equal(args.threads.sendMessage.calls[1][2].role, 'assistant')
  assert.deepEqual(args.chat.appendMessage.calls.map(([m]) => m.role), ['user', 'ai'])
  assert.equal(args.review.record.calls[0][1].resultVersion, 4)
  assert.equal(args.sceneVersions.refresh.calls.length, 1)
  assert.match(args.setNotice.value, /v4/)
  assert.equal(args.updatePendingSubmission.calls.at(-1)[0], null)
  assertReleased(args)
})

test('工程修改：创作进行期间一直保持忙碌，结束后才复位', async () => {
  const args = makeArgs()
  const seen = []
  const base = fakeStudio()
  studio = fakeStudio({
    'http.post': async (...a) => {
      /* 让出一轮事件循环：主流程若没等路径结束就进了 finally，这里会看到已复位 */
      await new Promise((resolve) => setTimeout(resolve, 0))
      seen.push({ op: args.sourceOperation.current, busy: args.setRealModifyBusy.value, creation: args.setSourceCreationBusy.value })
      return base.client.http.post(...a)
    },
  })
  api.installStudioHttpApi(studio.client)
  assert.equal(await useRealModify(args).submitRealModify('把标题改成红色'), true)
  assert.deepEqual(seen, [{ op: true, busy: true, creation: true }])
  assertReleased(args)
})

test('场景修改：任务启动期间一直保持忙碌，结束后才复位', async () => {
  useSceneProject()
  const args = sceneArgs()
  const seen = []
  args.tasks.startModify = spy(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    seen.push({ op: args.sourceOperation.current, busy: args.setRealModifyBusy.value })
    return { taskId: 't1' }
  })
  assert.equal(await useRealModify(args).submitRealModify('第二场换成夜景'), true)
  assert.deepEqual(seen, [{ op: true, busy: true }])
  assertReleased(args)
})

test('工程修改：创作返回失败时如实报错并清掉待恢复记录', async () => {
  studio = fakeStudio({ creationResult: { state: 'failed', reply: '渲染超时' } })
  api.installStudioHttpApi(studio.client)
  const args = makeArgs()
  assert.equal(await useRealModify(args).submitRealModify('把标题改成红色'), false)
  assert.equal(args.setRealModifyError.value, '渲染超时')
  assert.equal(args.updatePendingSubmission.calls.at(-1)[0], null)
  assert.equal(args.setAgentReply.calls.length, 0, '失败时不显示回复')
  assertReleased(args)
})

test('工程修改：agent 只提问时按轮次记下结论，不报新版本', async () => {
  studio = fakeStudio({ creationResult: { state: 'awaiting_info', reply: '要改哪一段？', version: null, resources: [] } })
  api.installStudioHttpApi(studio.client)
  const args = makeArgs()
  assert.equal(await useRealModify(args).submitRealModify('改一下'), true)
  const outcome = roundOutcomes.getRoundOutcome('p1', 's1', 'u-1')
  assert.equal(outcome?.reply, '要改哪一段？')
  assert.equal(args.setAwaitingActive.value, true)
  assert.match(args.setNotice.value, /没有改动工程/)
  assert.equal(args.sceneVersions.refresh.calls.length, 0, '没有新版本就不刷新版本列表')
  assertReleased(args)
})

test('工程修改：用户消息写不进会话时不发起创作，输入保留', async () => {
  const args = makeArgs()
  args.threads.sendMessage = spy(async () => { throw new Error('网络断开') })
  assert.equal(await useRealModify(args).submitRealModify('把标题改成红色'), false)
  assert.match(args.setRealModifyError.value, /会话消息未能写入服务端：网络断开/)
  assert.equal(creationPosts().length, 0)
  assertReleased(args)
})

test('工程修改：中途抛错由本路径接住，说明意见可能已写入', async () => {
  studio = fakeStudio({ 'workflowContext.recordCorrection': async () => { throw new Error('磁盘已满') } })
  api.installStudioHttpApi(studio.client)
  const args = makeArgs()
  assert.equal(await useRealModify(args).submitRealModify('把标题改成红色'), false)
  assert.match(args.setRealModifyError.value, /^Agent 修改未完成：磁盘已满/)
  assertReleased(args)
})

test('工程修改：重试同一句话时复用已落库的用户消息，不重复写入', async () => {
  /* 参数要在调用 hook 之前备齐：组件每次渲染都传一份新参数，调用后不会再改。 */
  const pendingSubmissionRef = { current: null }
  const args = makeArgs({ pendingSubmissionRef, updatePendingSubmission: spy((state) => { pendingSubmissionRef.current = state }) })
  studio = fakeStudio({ creationResult: { state: 'failed', reply: '渲染超时' } })
  api.installStudioHttpApi(studio.client)
  /* 第一次：消息落库后创作失败，待恢复记录里留下消息 id */
  assert.equal(await useRealModify(args).submitRealModify('把标题改成红色'), false)
  const savedBefore = args.threads.sendMessage.calls.length
  /* 失败分支会清空待恢复记录；这里模拟「刷新后仍有记录」的重试 */
  pendingSubmissionRef.current = { ...args.updatePendingSubmission.calls.find(([s]) => s?.userMessageId)[0] }
  studio = fakeStudio()
  api.installStudioHttpApi(studio.client)
  assert.equal(await useRealModify(args).submitRealModify('把标题改成红色'), true)
  const userWrites = args.threads.sendMessage.calls.slice(savedBefore).filter(([, , o]) => o?.role !== 'assistant')
  assert.equal(userWrites.length, 0, '重试不再写用户消息')
  assert.equal(creationPosts()[0][2].userMessageId, 'u-1')
})

/* ── 普通场景路径（submitSceneModify） ──────────────────────── */

const sceneArgs = (over = {}) => makeArgs({ filmProject: null, ...over })

function useSceneProject() {
  studio = fakeStudio({ 'workflowContext.state': async () => ({ initialized: false }) })
  api.installStudioHttpApi(studio.client)
}

test('场景修改成功：消息落库后启动修改任务，记录只含真实提交的字段', async () => {
  useSceneProject()
  const args = sceneArgs()
  assert.equal(await useRealModify(args).submitRealModify('第二场换成夜景'), true)
  const [pid, request] = args.tasks.startModify.calls[0]
  assert.equal(pid, 'p1')
  assert.deepEqual(request, { kind: 'modify', prompt: '第二场换成夜景', scope: 'project', sceneIds: [], baseVersion: 3 })
  assert.equal(args.chat.appendMessage.calls.at(-1)[0].taskId, 't1')
  assert.equal(args.setBottomTab.value, 'activity')
  assert.deepEqual(args.review.record.calls[0][1], { includeBrief: false })
  assert.equal(creationPosts().length, 0, '这条路径不走创作接口')
  assertReleased(args)
})

test('场景修改：任务启动冲突时提示刷新后重试', async () => {
  useSceneProject()
  const args = sceneArgs()
  args.tasks.startModify = spy(async () => ({ failure: { reason: 'conflict', message: '409' } }))
  assert.equal(await useRealModify(args).submitRealModify('第二场换成夜景'), false)
  assert.match(args.setRealModifyError.value, /场景已被其他操作更新，请刷新后再试/)
  assertReleased(args)
})

test('场景修改：抛出的异常仍由主流程接住，错误如实显示且忙碌态复位', async () => {
  useSceneProject()
  const args = sceneArgs()
  args.tasks.startModify = spy(async () => { throw new Error('后端崩溃') })
  assert.equal(await useRealModify(args).submitRealModify('第二场换成夜景'), false)
  assert.equal(args.setRealModifyError.value, '后端崩溃')
  assertReleased(args)
})

test('场景修改：有保留要求时拒绝提交，不写消息', async () => {
  useSceneProject()
  const args = sceneArgs()
  args.review.keepNotes = '片头不动'
  assert.equal(await useRealModify(args).submitRealModify('第二场换成夜景'), false)
  assert.match(args.setRealModifyError.value, /保留要求暂不参与真实修改/)
  assert.equal(args.threads.sendMessage.calls.length, 0)
  assertReleased(args)
})

test('场景修改：按时间段修改不支持，未提交请求', async () => {
  useSceneProject()
  const lead = { id: 'v3', origin: 'scene', revision: 3, file: '/r/v3.mp4' }
  const args = sceneArgs({ viewedPreview: lead, projectVersionLead: lead })
  assert.equal(await useRealModify(args).submitRealModify('这段换色', { start: 1, end: 2 }), false)
  assert.match(args.setRealModifyError.value, /暂不支持按时间段修改/)
  assert.equal(args.tasks.startModify.calls.length, 0)
  assertReleased(args)
})

test('分派：工程上下文已初始化时即使没有 Remotion 工程也走工程修改路径', async () => {
  const args = sceneArgs()
  assert.equal(await useRealModify(args).submitRealModify('把标题改成红色'), true)
  assert.equal(creationPosts().length, 1)
  assert.equal(args.tasks.startModify.calls.length, 0)
})

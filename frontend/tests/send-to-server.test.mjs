import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { fakeStudio, installBrowserGlobals, spy, startViteForModules, stateSpy } from './support/fake-studio.mjs'

/*
 * 对话页「发送到服务端会话」（useSendMessage 的 sendToServer → sendToServerSteps）。
 *
 * 拆分时把两个阶段（基准版本核对、发起创作）移出了原函数，阶段里原来的 return
 * 改成返回布尔值、由调用处照旧 return。这里从入口 send() 走完整流程，守住：
 *   · 版本核对拦下时，用户消息根本不写进会话；
 *   · 修改意图的成功 / 失败 / 结果未知 / 复用旧任务各走各的出口，
 *     失败与未知时不清草稿、不清幂等键（以便原样重试），成功时才清；
 *   · 普通提问不发起创作，改起回复流。
 */

let server
let api
let useSendMessage
let drafts
let roundOutcomes

installBrowserGlobals()

before(async () => {
  server = await startViteForModules()
  api = await server.ssrLoadModule('/src/api/index.ts')
  ;({ useSendMessage } = await server.ssrLoadModule('/src/features/chat/hooks/conversation/useSendMessage.ts'))
  drafts = await server.ssrLoadModule('/src/features/chat/hooks/useDraftStore.ts')
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

let sessionSeq = 0

/**
 * 一份能走通的参数。每个用例用独立的会话 id，草稿存储互不干扰。
 * draft 覆盖草稿字段；over 覆盖参数。
 */
function makeArgs({ draft = {}, ...over } = {}) {
  const sid = `s${++sessionSeq}`
  let userSeq = 0
  let settle
  const done = new Promise((resolve) => { settle = resolve })
  const setSubmitting = stateSpy(false)
  const setSubmittingDone = spy((v) => { setSubmitting(v); if (v === false) settle() })
  setSubmittingDone.done = done
  const sessionDraft = {
    draft: { text: '', attachments: [], targetSnapshot: null, intentAction: undefined, continuationScopeMode: null, pendingSubmission: null, updatedAt: 0, ...draft },
    updateDraft: spy(),
  }
  const args = {
    activeIsServer: true,
    activeSessionRef: { current: sid },
    activeThread: { id: sid, projectId: 'p1', origin: 'server', messages: [] },
    attachments: [],
    chat: { appendMessage: spy(), setDraft: spy(), addUserMessage: spy(), startAiMessage: spy(() => 'ai-local'), failAiMessage: spy() },
    effectiveEffort: null,
    effectiveModel: 'm1',
    harnessId: 'h1',
    idemKeyRef: { current: null },
    idemTextRef: { current: null },
    inputRef: { current: null },
    messages: [],
    mountedRef: { current: true },
    pending: false,
    projectPending: false,
    props: {
      activeSessionId: sid,
      threads: { sendMessage: spy(async (_sid, _text, opts) => ({ id: opts?.role === 'assistant' ? 'ai-1' : `u-${++userSeq}` })) },
    },
    replySaveRetry: null,
    selectedHarness: undefined,
    servedRef: new Set(),
    sessionDraft,
    setAttachments: stateSpy([]),
    setPending: stateSpy(false),
    setReplySaveRetry: stateSpy(null),
    setSendError: stateSpy(null),
    setStageLeadVersion: stateSpy(null),
    setSubmitting: setSubmittingDone,
    startServerReply: spy(),
    submissionInFlight: { current: false },
    ...over,
  }
  return { args, sid }
}

/** 在一次服务端渲染里调用 hook，拿到它返回的函数（useCallback 在渲染外仍可调用）。 */
function mount(args) {
  let hook
  const Probe = () => { hook = useSendMessage(args); return null }
  renderToString(createElement(Probe))
  return hook
}

/** 发送一条并等整次提交结束（finally 里 setSubmitting(false)）。 */
async function sendAndWait(args, text) {
  mount(args).send(text)
  await args.setSubmitting.done
}

const userWrites = (args) => args.props.threads.sendMessage.calls.filter(([, , o]) => o?.role !== 'assistant')
const creationPosts = () => studio.called('http.post')
const modifyDraft = (over = {}) => ({ intentAction: 'modify', ...over })
const target = (version) => ({ version, versionSeries: 'scene', versionConfirmed: true, scope: 'selection', label: '第 2 段', intentAction: 'modify' })

/* ── 普通提问 ───────────────────────────────────────────────── */

test('普通提问：消息落库后起回复流，不发起创作', async () => {
  const { args } = makeArgs({ draft: { intentAction: 'query' } })
  await sendAndWait(args, '这一版节奏怎么样？')
  assert.equal(userWrites(args).length, 1)
  assert.equal(creationPosts().length, 0)
  assert.equal(args.startServerReply.calls.length, 1)
  assert.ok(args.servedRef.has('u-1'), '起流前先登记，避免重复起流')
  assert.equal(args.chat.appendMessage.calls[0][0].id, 'u-1')
  assert.equal(args.idemKeyRef.current, null, '发送结束清掉幂等键')
  assert.equal(args.setSendError.value, null)
})

/* ── 基准版本核对（confirmBaseVersion） ─────────────────────── */

test('目标基准版本已过期：拦下且不写用户消息', async () => {
  const { args } = makeArgs({ draft: modifyDraft({ targetSnapshot: target(2) }) })
  await sendAndWait(args, '这段换成暖色')
  assert.match(args.setSendError.value, /基准版本（v2）已过期，工程当前最新版本为 v3/)
  assert.equal(args.setStageLeadVersion.value, 3)
  assert.equal(userWrites(args).length, 0)
  assert.equal(creationPosts().length, 0)
})

test('读不到工程当前版本：拦下且不写用户消息', async () => {
  studio = fakeStudio({ 'task.currentScene': async () => { throw new Error('连接被拒绝') } })
  api.installStudioHttpApi(studio.client)
  const { args } = makeArgs({ draft: modifyDraft({ targetSnapshot: target(3) }) })
  await sendAndWait(args, '这段换成暖色')
  assert.match(args.setSendError.value, /未能确认工程当前版本（目标引用基准版本为 v3）/)
  assert.equal(userWrites(args).length, 0)
})

/* ── 发起创作（runCreationRound） ───────────────────────────── */

test('修改成功：版本核对通过后落消息、发起创作、落盘回复，最后清草稿', async () => {
  const { args, sid } = makeArgs({ draft: modifyDraft({ targetSnapshot: target(3), text: '这段换成暖色' }) })
  drafts.setSessionDraft('p1', sid, { text: '这段换成暖色' })
  await sendAndWait(args, '这段换成暖色')

  assert.equal(userWrites(args).length, 1)
  const body = creationPosts()[0][2]
  assert.equal(body.userMessageId, 'u-1')
  assert.equal(body.sessionId, sid)
  assert.equal(body.baseVersion, 3)
  assert.equal(body.intent, '这段换成暖色')

  /* 发请求前先把恢复信息写进草稿 */
  const pendingWrite = args.sessionDraft.updateDraft.calls[0][0].pendingSubmission
  assert.equal(pendingWrite.userMessageId, 'u-1')
  assert.equal(pendingWrite.requestId, body.requestId)

  /* 回复用服务端真实 id 显示，用户消息随后追加 */
  const [, , replyOpts] = args.props.threads.sendMessage.calls[1]
  assert.equal(replyOpts.role, 'assistant')
  assert.equal(replyOpts.taskId, 'u-1')
  assert.deepEqual(args.chat.appendMessage.calls.map(([m]) => m.id), ['ai-1', 'u-1'])

  assert.equal(args.startServerReply.calls.length, 0, '修改意图不另起回复流')
  assert.equal(args.idemKeyRef.current, null)
  assert.equal(drafts.getSessionDraft('p1', sid).text, '', '成功后清掉已发出的文字')
  assert.equal(args.setSendError.value, null)
})

test('修改：创作返回失败时报错并记下失败，不清草稿、保留幂等键', async () => {
  studio = fakeStudio({ creationResult: { state: 'failed', reply: '渲染超时' } })
  api.installStudioHttpApi(studio.client)
  const { args, sid } = makeArgs({ draft: modifyDraft({ text: '整片换成暖色' }) })
  drafts.setSessionDraft('p1', sid, { text: '整片换成暖色' })
  await sendAndWait(args, '整片换成暖色')
  assert.equal(args.setSendError.value, '渲染超时')
  const last = args.sessionDraft.updateDraft.calls.at(-1)[0].pendingSubmission
  assert.equal(last.error, '渲染超时')
  assert.equal(last.userMessageId, 'u-1')
  assert.notEqual(args.idemKeyRef.current, null, '保留幂等键以便原样重试')
  assert.equal(drafts.getSessionDraft('p1', sid).text, '整片换成暖色', '失败不清草稿')
  assert.equal(args.chat.appendMessage.calls.length, 0)
})

test('修改：创作结果未知时说明消息已送达，记下待恢复信息', async () => {
  studio = fakeStudio({ 'http.post': async () => { throw new Error('连接中断') } })
  api.installStudioHttpApi(studio.client)
  const { args } = makeArgs({ draft: modifyDraft() })
  await sendAndWait(args, '整片换成暖色')
  assert.match(args.setSendError.value, /^消息已送达会话，制作结果尚未完成确认：/)
  assert.ok(args.sessionDraft.updateDraft.calls.at(-1)[0].pendingSubmission.error)
  assert.notEqual(args.idemKeyRef.current, null)
  assert.equal(args.chat.appendMessage.calls.length, 0)
})

test('修改：agent 只提问时按轮次记下结论', async () => {
  studio = fakeStudio({ creationResult: { state: 'awaiting_info', reply: '要改哪一段？', version: null, resources: [] } })
  api.installStudioHttpApi(studio.client)
  const { args, sid } = makeArgs({ draft: modifyDraft() })
  await sendAndWait(args, '改一下')
  assert.equal(roundOutcomes.getRoundOutcome('p1', sid, 'u-1')?.reply, '要改哪一段？')
  assert.equal(args.setSendError.value, null)
})

test('修改：回复没存进会话时标出失败并给重试入口', async () => {
  const { args, sid } = makeArgs({ draft: modifyDraft() })
  args.props.threads.sendMessage = spy(async (_s, _t, opts) => {
    if (opts?.role === 'assistant') throw new Error('写入超时')
    return { id: 'u-1' }
  })
  await sendAndWait(args, '整片换成暖色')
  const ai = args.chat.appendMessage.calls.find(([m]) => m.role === 'ai')[0]
  assert.equal(ai.id, 'm-ai-u-1')
  assert.ok(ai.failed, '界面上要看得出这条没存进会话')
  assert.deepEqual(args.setReplySaveRetry.value, { sessionId: sid, userMessageId: 'u-1', reply: '已按要求修改', localId: 'm-ai-u-1' })
})

test('修改重试：同一份请求且旧任务仍在运行时复用旧任务，不重复发起创作', async () => {
  /* 第一次：结果未知，草稿里留下完整的待恢复记录 */
  studio = fakeStudio({ 'http.post': async () => { throw new Error('连接中断') } })
  api.installStudioHttpApi(studio.client)
  const first = makeArgs({ draft: modifyDraft() })
  await sendAndWait(first.args, '整片换成暖色')
  const recorded = first.args.sessionDraft.updateDraft.calls.at(-1)[0].pendingSubmission
  const firstKey = userWrites(first.args)[0][2].idempotencyKey

  /* 第二次：同一会话、同一句话，后端说旧任务还在跑 */
  studio = fakeStudio({ 'workflowContext.creation': async () => ({ state: 'running' }) })
  api.installStudioHttpApi(studio.client)
  const retry = makeArgs({ draft: modifyDraft({ pendingSubmission: recorded }) })
  retry.args.props.activeSessionId = first.args.props.activeSessionId
  retry.args.activeSessionRef.current = first.args.props.activeSessionId
  await sendAndWait(retry.args, '整片换成暖色')

  assert.equal(userWrites(retry.args)[0][2].idempotencyKey, firstKey, '用户消息复用同一把幂等键')
  assert.equal(creationPosts().length, 0, '不重复发起创作')
  assert.deepEqual(studio.called('workflowContext.creation')[0].slice(1), ['p1', recorded.requestId])
  assert.equal(retry.args.chat.appendMessage.calls.length, 1)
  assert.equal(retry.args.idemKeyRef.current, null)
})

test('修改：改了要求再发是新请求，不复用旧任务', async () => {
  studio = fakeStudio({ 'http.post': async () => { throw new Error('连接中断') } })
  api.installStudioHttpApi(studio.client)
  const first = makeArgs({ draft: modifyDraft() })
  await sendAndWait(first.args, '整片换成暖色')
  const recorded = first.args.sessionDraft.updateDraft.calls.at(-1)[0].pendingSubmission

  studio = fakeStudio({ 'workflowContext.creation': async () => ({ state: 'running' }) })
  api.installStudioHttpApi(studio.client)
  const next = makeArgs({ draft: modifyDraft({ pendingSubmission: recorded }) })
  next.args.props.activeSessionId = first.args.props.activeSessionId
  next.args.activeSessionRef.current = first.args.props.activeSessionId
  await sendAndWait(next.args, '整片换成冷色')

  assert.equal(studio.called('workflowContext.creation').length, 0, '不去查旧任务')
  assert.equal(creationPosts().length, 1)
  assert.notEqual(creationPosts()[0][2].requestId, recorded.requestId)
})

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

let server, streams, events
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  streams = await server.ssrLoadModule('/src/services/api/streams.ts')
  events = await server.ssrLoadModule('/src/services/projectRenderEvents.ts')
})
after(async () => { await server?.close() })

const sse = (frames) => new Response(new ReadableStream({
  start(controller) {
    for (const [event, data] of frames) controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    controller.close()
  },
}))

/* 对话一轮改动了工程：completed 之后是 render 帧，再是 end。界面要能拿到进度与版本号。 */
test('render frames after completed reach the handler in order', async () => {
  const http = {
    config: { streamIdleTimeoutMs: 5000, streamReconnectLimit: 0, streamStableMs: 0, resyncLimit: 0 },
    openEventStream: async () => sse([
      ['completed', { type: 'completed', message: { id: 'm1', sessionId: 's1', role: 'assistant', text: '好了', createdAt: '2026-11-19T00:00:00Z' } }],
      ['render', { type: 'render', state: 'rendering', message: '正在渲染这一轮的改动…' }],
      ['heartbeat', { type: 'heartbeat' }],
      ['render', { type: 'render', state: 'rendered', version: 3, artifactPath: 'renders/project-1.mp4', message: '已出片 v3。' }],
      ['render', { type: 'render', state: 'bogus' }],
      ['end', { type: 'end' }],
    ]),
  }
  const seen = []
  const handle = streams.openChatSessionStream(http, 's1', { onCompleted: () => seen.push('completed'), onRender: (r) => seen.push(r) }, {})
  await handle.finished
  assert.equal(seen[0], 'completed')
  assert.deepEqual(seen.slice(1), [
    { type: 'render', state: 'rendering', message: '正在渲染这一轮的改动…' },
    { type: 'render', state: 'rendered', version: 3, artifactPath: 'renders/project-1.mp4', message: '已出片 v3。' },
  ])
})

test('project render events only reach subscribers and stop after unsubscribe', () => {
  const got = []
  const off = events.onProjectRendered((e) => got.push(e))
  events.notifyProjectRendered('p1', 3)
  off()
  events.notifyProjectRendered('p1', 4)
  assert.deepEqual(got, [{ projectId: 'p1', version: 3 }])
})

/* 切回对话只接上那一轮：请求带 attach；后端说这一轮不在了，就提示一次并停止，不重连、不重跑 */
test('attach sends the flag and turn_not_running stops without reconnecting', async () => {
  const errors = await server.ssrLoadModule('/src/services/api/errors.ts')
  let calls = 0, query = null
  const http = {
    config: { streamIdleTimeoutMs: 5000, streamReconnectLimit: 3, streamStableMs: 0, resyncLimit: 0 },
    openEventStream: async (_path, options) => {
      calls++; query = options.query
      throw errors.ApiError.fromResponse(409, { error: { code: 'turn_not_running', message: '这一轮没有在运行' } })
    },
  }
  const seen = []
  const handle = streams.openChatSessionStream(http, 's1', { onError: (e) => seen.push(e.details?.rawCode) }, { attach: true })
  await handle.finished
  assert.equal(calls, 1, '不应重连')
  assert.equal(query.attach, true)
  assert.equal(query.rerun, undefined)
  assert.deepEqual(seen, ['turn_not_running'])
})

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server
let HttpClient
let DEFAULT_API_CONFIG
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  ;({ HttpClient } = await server.ssrLoadModule('/src/services/api/http.ts'))
  ;({ DEFAULT_API_CONFIG } = await server.ssrLoadModule('/src/services/api/config.ts'))
})
after(async () => { await server?.close() })

test('multipart 上传由浏览器生成 Content-Type 和 boundary', async () => {
  let captured
  const client = new HttpClient(DEFAULT_API_CONFIG, { fetchImpl: async (_url, init) => {
    captured = init
    return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  } })
  const form = new FormData()
  form.append('file', new Blob(['test'], { type: 'image/png' }), 'sample.png')
  await client.post('/uploads', form)
  assert.equal(captured.body, form)
  assert.equal(captured.headers.has('Content-Type'), false)
})

test('普通 JSON 请求仍设置 JSON Content-Type', async () => {
  let captured
  const client = new HttpClient(DEFAULT_API_CONFIG, { fetchImpl: async (_url, init) => {
    captured = init
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  } })
  await client.post('/example', { text: 'hello' })
  assert.match(captured.headers.get('Content-Type'), /^application\/json/)
  assert.equal(captured.body, '{"text":"hello"}')
})

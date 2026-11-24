import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

let server, renderWorktree
const saved = new Map()
before(async () => {
  globalThis.sessionStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }
  globalThis.window = { setTimeout: callback => setTimeout(callback, 0) }
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  ;({ renderWorktree } = await server.ssrLoadModule('/src/api/sourceRender.ts'))
})
after(async () => { await server?.close(); delete globalThis.window; delete globalThis.sessionStorage })

const source = projectId => ({ projectId, version: 2, sourceHash: 'working-hash' })
const complete = (projectId, requestId) => ({ projectId, requestId, state: 'rendered', result: { version: 3, artifactPath: 'renders/v3.mp4' } })

test('render binds the server baseline and coalesces concurrent clicks', async () => {
  const projectId = 'render-once'
  let posted, calls = 0
  const http = {
    get: async () => source(projectId),
    post: async (_path, body) => { posted = body; calls++; return complete(projectId, body.requestId) },
  }
  const first = renderWorktree(http, projectId, 'confirmed output')
  const second = renderWorktree(http, projectId, 'confirmed output')
  assert.equal(first, second)
  assert.equal((await first).version, 3)
  assert.equal(calls, 1)
  assert.equal(posted.baseVersion, 2)
  assert.equal(posted.sourceHash, 'working-hash')
  assert.equal(saved.has(`fm-source-render:${projectId}`), false)
})

test('lost POST receipt queries the same job instead of creating a new request', async () => {
  const projectId = 'lost-receipt'
  let requestId, posts = 0, reads = 0
  const http = {
    get: async path => path.endsWith('/source/state') ? source(projectId) : (reads++, complete(projectId, requestId)),
    post: async (_path, body) => { posts++; requestId = body.requestId; throw new Error('lost connection') },
  }
  assert.equal((await renderWorktree(http, projectId)).version, 3)
  assert.equal(posts, 1)
  assert.equal(reads, 1)
})

test('polling failure retains request identity for reconnection', async () => {
  const projectId = 'resume-job'
  let original, reconnect = false, sourceReads = 0
  const http = {
    get: async path => {
      if (path.endsWith('/source/state')) { sourceReads++; return source(projectId) }
      throw new Error('temporarily offline')
    },
    post: async (_path, body) => {
      if (reconnect) { assert.equal(body.requestId, original); return complete(projectId, original) }
      original = body.requestId
      return { projectId, requestId: original, state: 'running' }
    },
  }
  await assert.rejects(renderWorktree(http, projectId), /temporarily offline/)
  assert.ok(saved.has(`fm-source-render:${projectId}`))
  reconnect = true
  assert.equal((await renderWorktree(http, projectId)).version, 3)
  assert.equal(sourceReads, 1)
})

test('baseline rejection clears the unaccepted request and requires a fresh baseline', async () => {
  const projectId = 'stale-render'
  const ids = []
  let sourceReads = 0
  const http = {
    get: async path => {
      if (path.endsWith('/source/state')) { sourceReads++; return source(projectId) }
      throw Object.assign(new Error('no such request'), { httpStatus: 404 })
    },
    post: async (_path, body) => { ids.push(body.requestId); throw Object.assign(new Error('source changed'), { httpStatus: 409 }) },
  }
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(renderWorktree(http, projectId), /source changed/)
  assert.notEqual(ids[0], ids[1])
  assert.equal(sourceReads, 2)
})

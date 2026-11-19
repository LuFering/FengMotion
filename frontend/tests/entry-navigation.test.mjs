import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
let server, NavigationGuard, prepareCreationEntry
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  ;({ NavigationGuard } = await server.ssrLoadModule('/src/shared/navigation/navigationGuard.ts'))
  ;({ prepareCreationEntry } = await server.ssrLoadModule('/src/features/creation/services/creationEntry.ts'))
})
after(async () => { await server?.close() })

test('all destinations wait for a decision; stay preserves the editor', () => {
  const guard = new NavigationGuard(); let left = false
  guard.register(() => ({ dirty: true, name: '草稿', canSave: true, save: () => true }))
  guard.request(() => { left = true })
  assert.equal(left, false); assert.equal(guard.getSnapshot().name, '草稿')
  guard.stay(); assert.equal(left, false); assert.equal(guard.hasUnsaved(), true)
  guard.request(() => { left = true }); guard.discard()
  assert.equal(left, true); assert.equal(guard.getSnapshot(), null)
})
test('save failure or exception cannot execute the pending navigation', async () => {
  for (const save of [() => false, () => { throw new Error('磁盘写入失败') }]) {
    const guard = new NavigationGuard(); let left = false
    guard.register(() => ({ dirty: true, name: '草稿', canSave: true, save }))
    guard.request(() => { left = true }); await guard.saveAndLeave()
    assert.equal(left, false); assert.ok(guard.getSnapshot().error); assert.equal(guard.hasUnsaved(), true)
  }
})
test('save completes before leaving and ignores repeated clicks/destinations', async () => {
  const guard = new NavigationGuard(); const calls = []; let finish
  guard.register(() => ({ dirty: true, name: '草稿', canSave: true, save: () => { calls.push('save'); return new Promise((r) => { finish = r }) } }))
  guard.request(() => calls.push('original'))
  const pending = guard.saveAndLeave(); void guard.saveAndLeave()
  guard.request(() => calls.push('other')); guard.discard(); guard.stay()
  assert.deepEqual(calls, ['save']); assert.equal(guard.getSnapshot().saving, true)
  finish(true); await pending; assert.deepEqual(calls, ['save', 'original'])
})
test('clean editors leave immediately; unregister clears the refresh guard', () => {
  const guard = new NavigationGuard(); let left = false
  const unregister = guard.register(() => ({ dirty: false, name: '', canSave: true, save: () => true }))
  guard.request(() => { left = true }); assert.equal(left, true)
  unregister(); assert.equal(guard.hasUnsaved(), false); assert.equal(guard.getSnapshot(), null)
})
test('running editor cannot be saved by a leave action', async () => {
  const guard = new NavigationGuard(); let saved = false
  guard.register(() => ({ dirty: true, name: '运行中', canSave: false, save: () => { saved = true; return true } }))
  guard.request(() => {}); await guard.saveAndLeave()
  assert.equal(saved, false); assert.equal(guard.getSnapshot().canSave, false)
})
test('stale async completion cannot navigate after editor unmount', async () => {
  const guard = new NavigationGuard(); let left = false, finish
  const unregister = guard.register(() => ({ dirty: true, name: '草稿', canSave: true, save: () => new Promise((r) => { finish = r }) }))
  guard.request(() => { left = true }); const pending = guard.saveAndLeave()
  unregister(); finish(true); await pending; assert.equal(left, false)
})
test('creation preparation creates a real empty project session, no message payload', async () => {
  const calls = []
  const result = await prepareCreationEntry({ projectId: null, title: '需求原文' }, {
    createProject: async () => { calls.push('project'); return { id: 'p' } },
    createSession: async (input) => { calls.push(input); return { session: { id: 's', projectId: 'p', origin: 'server' }, error: null } },
  })
  assert.deepEqual(result, { projectId: 'p', sessionId: 's' })
  assert.deepEqual(calls, ['project', { projectId: 'p', firstText: '需求原文' }])
})
test('existing project is reused; local fallback and identity mismatch never signal ready', async () => {
  for (const session of [{ id: 's', projectId: 'p', origin: 'local' }, { id: 's', projectId: 'other', origin: 'server' }, null]) {
    await assert.rejects(() => prepareCreationEntry({ projectId: 'p' }, {
      createProject: async () => { assert.fail('must reuse existing project') },
      createSession: async () => ({ session, error: null }),
    }))
  }
})
test('session failure exposes prepared project for safe retry without another project', async () => {
  let prepared, count = 0
  const deps = { createProject: async () => { count++; return { id: 'p' } }, onProjectReady: (id) => { prepared = id }, createSession: async () => ({ session: null, error: '连接失败' }) }
  await assert.rejects(() => prepareCreationEntry({ projectId: null }, deps), /连接失败/)
  const result = await prepareCreationEntry({ projectId: prepared }, { ...deps, createSession: async () => ({ session: { id: 's', projectId: 'p', origin: 'server' }, error: null }) })
  assert.equal(count, 1); assert.equal(result.projectId, 'p')
})

test('first creation records the original brief; initialized projects are untouched', async () => {
  const { ensureCreationContext } = await server.ssrLoadModule('/src/features/creation/services/creationEntry.ts')
  const calls = []
  await ensureCreationContext('p', '原始需求\n逐字保留', { state: async () => ({ initialized: false }), init: async (...args) => calls.push(args) })
  assert.deepEqual(calls, [['p', '原始需求\n逐字保留']])
  await ensureCreationContext('p', '后续修改', { state: async () => ({ initialized: true }), init: async () => assert.fail('must not replace initial brief') })
  await assert.rejects(() => ensureCreationContext('p', '需求', { state: async () => { throw new Error('连接失败') }, init: async () => assert.fail('no writes when status is unknown') }), /连接失败/)
})

test('leave prompt updates when a running editor becomes savable', async () => {
  const guard = new NavigationGuard(); let canSave = false, left = false
  guard.register(() => ({ dirty: true, name: '草稿', canSave, save: () => true }))
  guard.request(() => { left = true })
  canSave = true; guard.refreshEditor()
  assert.equal(guard.getSnapshot().canSave, true)
  await guard.saveAndLeave(); assert.equal(left, true)
})

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

let server
let eq
let store

/* 草稿存储会写 localStorage，测试里用内存版代替 */
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
}

before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  eq = await server.ssrLoadModule('/src/features/chat/model/draft/draftEquivalence.ts')
  store = await server.ssrLoadModule('/src/features/chat/model/draft/draftStore.ts')
})

after(async () => { await server?.close() })

const snap = (over = {}) => ({ version: 3, versionSeries: 'scene', versionConfirmed: true, scope: 'selection', rangeSpan: { start: 1, end: 2 }, bbox: [0, 0, 10, 10], label: '第 1 段', references: [{ id: 'a', role: 'target', kind: 'project' }], ...over })

test('快照等价：同内容不同对象算相等，null 只和 null 相等', () => {
  assert.equal(eq.isEquivalentSnapshot(snap(), snap()), true)
  assert.equal(eq.isEquivalentSnapshot(null, null), true)
  assert.equal(eq.isEquivalentSnapshot(snap(), null), false)
})

test('快照等价：版本来源、确认状态、框选、引用的任一字段变了都算不同', () => {
  assert.equal(eq.isEquivalentSnapshot(snap(), snap({ versionSeries: 'editor' })), false)
  assert.equal(eq.isEquivalentSnapshot(snap(), snap({ versionConfirmed: false })), false)
  assert.equal(eq.isEquivalentSnapshot(snap(), snap({ bbox: [0, 0, 10, 11] })), false)
  assert.equal(eq.isEquivalentSnapshot(snap(), snap({ rangeSpan: null })), false)
  assert.equal(eq.isEquivalentSnapshot(snap(), snap({ references: [{ id: 'a', role: 'target', kind: 'project', action: 'workflow_modify' }] })), false)
})

test('引用比较：对象键序无关，undefined 字段忽略，数组保序', () => {
  const a = snap({ references: [{ id: 'a', role: 'target' }, { id: 'b', role: 'context' }] })
  assert.equal(eq.isEquivalentSnapshot(a, snap({ references: [{ role: 'target', id: 'a', extra: undefined }, { id: 'b', role: 'context' }] })), true)
  assert.equal(eq.isEquivalentSnapshot(a, snap({ references: [{ id: 'b', role: 'context' }, { id: 'a', role: 'target' }] })), false)
})

test('附件比较只看 name、fileId、uploadId', () => {
  const a = [{ name: 'x.png', size: 1, kind: 'image', fileId: 'f1' }]
  assert.equal(eq.isEquivalentAttachments(a, [{ name: 'x.png', size: 99, kind: 'file', fileId: 'f1' }]), true)
  assert.equal(eq.isEquivalentAttachments(a, [{ name: 'x.png', size: 1, kind: 'image', fileId: 'f2' }]), false)
  assert.equal(eq.isEquivalentAttachments(a, []), false)
})

test('setSessionDraft：什么都没变时返回原对象，不推进版本', () => {
  const first = store.setSessionDraft('p1', 's-same', { text: '你好' })
  const v = store.currentFieldVersions('p1', 's-same')
  assert.equal(store.setSessionDraft('p1', 's-same', { text: '你好' }), first)
  assert.deepEqual(store.currentFieldVersions('p1', 's-same'), v)
})

test('clearSentPartsOnly：发送后只换了目标，旧文字照常清掉、新目标保留', () => {
  store.setSessionDraft('p1', 's-mix', { text: '改亮一点', targetSnapshot: snap() })
  const sent = { ...store.getSessionDraft('p1', 's-mix'), versions: store.currentFieldVersions('p1', 's-mix') }
  const newTarget = snap({ label: '第 2 段' })
  store.setSessionDraft('p1', 's-mix', { targetSnapshot: newTarget })
  store.clearSentPartsOnly('p1', 's-mix', sent)
  const cur = store.getSessionDraft('p1', 's-mix')
  assert.equal(cur.text, '')
  assert.equal(cur.targetSnapshot.label, '第 2 段')
})

test('迟来的 flush 不会把刚发出去的文字写回来；用户重新输入后同一句话能保存', () => {
  store.setSessionDraft('p1', 's-flush', { text: '发出去的话' })
  store.markDraftSent('p1', 's-flush', '发出去的话')
  store.clearSessionDraft('p1', 's-flush')
  store.flushSessionDraftText('p1', 's-flush', '发出去的话')
  assert.equal(store.getSessionDraft('p1', 's-flush').text, '')
  store.noteDraftInput('p1', 's-flush')
  store.flushSessionDraftText('p1', 's-flush', '发出去的话')
  assert.equal(store.getSessionDraft('p1', 's-flush').text, '发出去的话')
})

test('持久化：只写可恢复的附件元数据，清空后删除存储项', () => {
  store.setSessionDraft('p2', 's-persist', { text: 'hi', attachments: [{ name: 'a.png', size: 1, kind: 'image', fileId: 'f1' }, { name: 'b.png', size: 2, kind: 'image' }] })
  const raw = JSON.parse(mem.get('fengmotion:session-draft:v1:p2:s-persist'))
  assert.deepEqual(raw.attachments.map((a) => a.name), ['a.png'])
  store.clearSessionDraft('p2', 's-persist')
  assert.equal(mem.has('fengmotion:session-draft:v1:p2:s-persist'), false)
})

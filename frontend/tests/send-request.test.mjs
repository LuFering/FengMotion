import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

let server
let req

before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  req = await server.ssrLoadModule('/src/features/chat/model/sendRequest.ts')
})

after(async () => { await server?.close() })

test('只带上传成功的附件，字段对齐 TaskAttachment', () => {
  const out = req.readyAttachments([
    { name: 'a.png', size: 10, kind: 'image', fileId: 'f1', mimeType: 'image/png' },
    { name: 'b.png', size: 20, kind: 'image', fileId: 'f2', uploading: true },
    { name: 'c.png', size: 30, kind: 'image', fileId: 'f3', uploadError: '失败' },
    { name: 'd.txt', size: 40, kind: 'file' },
    { name: 'e.txt', size: 50, kind: 'file', fileId: 'f5' },
  ])
  assert.deepEqual(out, [
    { fileId: 'f1', name: 'a.png', mimeType: 'image/png', sizeBytes: 10 },
    { fileId: 'f5', name: 'e.txt', mimeType: '', sizeBytes: 50 },
  ])
})

const base = [{ id: 'r1', role: 'reference', kind: 'asset' }]
const targetOf = (refs) => refs.slice(base.length)

test('没有项目时只保留原有引用，不改入参', () => {
  const out = req.withProjectTarget(base, { projectId: null, targetSnapshot: null, isModifyIntent: true, isWholeConfirmedContinuation: true })
  assert.deepEqual(out, base)
  assert.notEqual(out, base)
})

test('有局部目标：修改推 target/workflow_modify，提问推 context/workflow_query', () => {
  const snap = { label: '第 2 段', rangeSpan: { start: 1, end: 3 } }
  const modify = targetOf(req.withProjectTarget(base, { projectId: 'p1', targetSnapshot: snap, isModifyIntent: true, isWholeConfirmedContinuation: false }))
  assert.deepEqual(modify, [{ id: 'ref-target-p1', role: 'target', kind: 'project', projectId: 'p1', label: '第 2 段', action: 'workflow_modify' }])
  const query = targetOf(req.withProjectTarget(base, { projectId: 'p1', targetSnapshot: { rangeSpan: { start: 1, end: 3 } }, isModifyIntent: false, isWholeConfirmedContinuation: false }))
  assert.equal(query[0].role, 'context')
  assert.equal(query[0].action, 'workflow_query')
  assert.equal(query[0].label, '时间段（1–3）')
})

test('整片确认：修改推整片修改，提问推整片上下文', () => {
  const modify = targetOf(req.withProjectTarget(base, { projectId: 'p1', targetSnapshot: null, isModifyIntent: true, isWholeConfirmedContinuation: true }))
  assert.equal(modify[0].label, '整片工程修改')
  assert.equal(modify[0].action, 'workflow_modify')
  const query = targetOf(req.withProjectTarget(base, { projectId: 'p1', targetSnapshot: null, isModifyIntent: false, isWholeConfirmedContinuation: true }))
  assert.equal(query[0].label, '整片工程（仅提问，不修改）')
  assert.equal(query[0].action, 'workflow_query')
})

test('显式修改但没有目标也没确认整片：仍推整片修改引用', () => {
  const out = targetOf(req.withProjectTarget(base, { projectId: 'p1', targetSnapshot: null, isModifyIntent: true, isWholeConfirmedContinuation: false }))
  assert.equal(out[0].action, 'workflow_modify')
})

test('普通提问、无目标、未确认整片：不加工程引用', () => {
  const out = req.withProjectTarget(base, { projectId: 'p1', targetSnapshot: null, isModifyIntent: false, isWholeConfirmedContinuation: false })
  assert.deepEqual(out, base)
})

test('修改说明：有时间段时标出 m:ss–m:ss', () => {
  assert.equal(req.correctionTextFor('  改亮一点 ', undefined), '改亮一点')
  assert.equal(req.correctionTextFor('改亮一点', { start: 65, end: 125.5 }), '【指定时间段 1:05–2:05】\n\n用户原话：改亮一点')
})

test('预览图只接受图片，不接受视频', () => {
  assert.equal(req.previewImageOf('data:image/jpeg;base64,xx'), 'data:image/jpeg;base64,xx')
  assert.equal(req.previewImageOf('/renders/frame.png'), '/renders/frame.png')
  assert.equal(req.previewImageOf('/renders/film.mp4'), undefined)
  assert.equal(req.previewImageOf(null), undefined)
})

test('requestId：可复用的旧 id 去掉空白后复用，否则新生成', () => {
  assert.equal(req.requestIdFor('  abc  '), 'abc')
  const fresh = req.requestIdFor('   ')
  assert.match(fresh, /^[0-9a-f-]{36}$/i)
  assert.notEqual(req.requestIdFor(null), req.requestIdFor(null))
})

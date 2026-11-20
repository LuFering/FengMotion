import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

let server, m
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  m = await server.ssrLoadModule('/src/features/workbench/model/elementEdit.ts')
})
after(async () => { await server?.close() })

const title = { id: 'intro-title', kind: 'text', label: '片头标题', properties: { text: '标题' },
  placement: { startFrame: 0, endFrame: 90, bounds: { x: 0.1, y: 0.12, w: 0.8, h: 0.18 } } }
const badge = { id: 'badge', kind: 'text', label: '角标', properties: { text: 'NEW' },
  placement: { startFrame: 30, endFrame: 60, bounds: { x: 0.2, y: 0.15, w: 0.1, h: 0.05 } } }
const loose = { id: 'note', kind: 'text', label: '无位置', properties: { text: '说明' } }

test('frame numbers do not slip to the previous frame at exact boundaries', () => {
  assert.equal(m.frameAt(3, 30), 90)
  assert.equal(m.frameAt(0.1, 30), 3)
  assert.equal(m.frameAt(-1, 30), 0)
  assert.equal(m.frameAt(1, 0), 0)
})

test('only elements with placement inside [start, end) are pickable', () => {
  assert.deepEqual(m.elementsAtFrame([title, loose], 0).map((e) => e.id), ['intro-title'])
  assert.deepEqual(m.elementsAtFrame([title, loose], 90).map((e) => e.id), [])
  assert.deepEqual(m.elementsAtFrame([title, badge], 45).map((e) => e.id), ['intro-title', 'badge'])
})

test('hit test prefers the smallest overlapping rectangle and ignores misses', () => {
  assert.equal(m.hitElement([title, badge], 45, { x: 0.25, y: 0.17 })?.id, 'badge')
  assert.equal(m.hitElement([title, badge], 10, { x: 0.25, y: 0.17 })?.id, 'intro-title')
  assert.equal(m.hitElement([title, badge], 45, { x: 0.5, y: 0.8 }), null)
  assert.equal(m.hitElement([loose], 0, { x: 0.5, y: 0.5 }), null)
})

test('letterboxing is removed before converting to normalized coordinates', () => {
  const frame = m.containedRect(1000, 500, 1920, 1080)
  assert.ok(Math.abs(frame.width - 888.888) < 0.01)
  assert.equal(frame.top, 0)
  assert.equal(m.toNormPoint(frame.left - 2, 100, frame), null)
  const p = m.toNormPoint(frame.left + frame.width / 2, 250, frame)
  assert.ok(Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.y - 0.5) < 1e-9)
  assert.deepEqual(m.containedRect(400, 300, 0, 0), { left: 0, top: 0, width: 400, height: 300 })
})

test('video maps to its registered scene version without fuzzy matching', () => {
  const versions = [
    { version: 5, artifactPath: 'renders/project-element-b.mp4' },
    { version: 4, artifactPath: 'renders/project-a.mp4' },
  ]
  assert.equal(m.versionForArtifact(versions, './renders/project-a.mp4')?.version, 4)
  assert.equal(m.versionForArtifact(versions, '/home/u/projects/coffee/renders/project-element-b.mp4')?.version, 5)
  assert.equal(m.versionForArtifact(versions, 'renders/other.mp4'), null)
  assert.equal(m.versionForArtifact(versions, 'xrenders/project-a.mp4'), null)
  assert.equal(m.versionForArtifact(versions, null), null)
})

test('reasons and failures read as plain sentences with reload hints', () => {
  assert.match(m.previewOnlyReason({ reason: { code: 'manifest_missing', message: '' } }), /元素声明/)
  assert.equal(m.elementEditFailure('element_edit_noop').reload, false)
  assert.equal(m.elementEditFailure('scene_version_conflict').reload, true)
  assert.equal(m.elementEditFailure('weird', '后端说的话').text, '后端说的话')
})

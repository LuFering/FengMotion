import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { manifestMatches, parseSequenceManifest, sequenceClipKey } from '../src/features/workbench/model/sequenceManifest.ts'

const manifest = parseSequenceManifest({
  schemaVersion: 2, sourceHash: 'revision-a', fps: 30, durationSeconds: 4,
  tracks: ['one', 'two'].map((id) => ({ id, name: id, clips: [{ id: 'same', name: id, kind: 'shape', start: 0, duration: 4 }] })),
})

test('only a matching version hash and duration establish track ownership', () => {
  assert.ok(manifestMatches(manifest, { sourceHash: 'revision-a', duration: 4 }))
  assert.equal(manifestMatches(manifest, { sourceHash: 'revision-b', duration: 4 }), false)
  assert.equal(manifestMatches(manifest, { duration: 4 }), false)
  assert.equal(manifestMatches({ ...manifest, sourceHash: undefined }, { sourceHash: 'revision-a', duration: 4 }), false)
  assert.equal(manifestMatches(manifest, { sourceHash: 'revision-a', duration: 5 }), false)
})

test('identical clip IDs in different tracks remain distinct, including delimiter characters', () => {
  assert.ok(manifest)
  assert.notEqual(sequenceClipKey('one', 'same'), sequenceClipKey('two', 'same'))
  assert.notEqual(sequenceClipKey('a:b', 'c'), sequenceClipKey('a', 'b:c'))
})

test('video identity prevents same-duration cross-version tracks and fallback editing', () => {
  const bound = parseSequenceManifest({ ...manifest, artifactPath: 'renders/a.mp4', detail: 'sequences' })
  assert.ok(manifestMatches(bound, { artifactPath: 'renders/a.mp4', duration: 4 }))
  assert.equal(manifestMatches(bound, { artifactPath: 'renders/b.mp4', sourceHash: 'revision-a', duration: 4 }), false)
  assert.equal(manifestMatches(bound, { artifactPath: 'renders/a.mp4', sourceHash: 'wrong', duration: 4 }), false)
  assert.equal(manifestMatches({ ...bound, detail: 'limited' }, { artifactPath: 'renders/a.mp4', duration: 4 }), false)
  assert.equal(manifestMatches(manifest, { artifactPath: 'renders/a.mp4', sourceHash: 'revision-a', duration: 4 }), false)
})

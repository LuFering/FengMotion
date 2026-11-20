import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTimelineCollector, manifestFromFrames } from '../../remotion/timeline.mjs'

const composition = { id: 'Test', durationInFrames: 20, fps: 10 }
const row = (id, from, duration, parent = null, name = id) => ({ id, name, from, duration, parent, show: true, type: 'sequence' })

test('nested, conditional and structural rows use actual active frames', () => {
  const frames = new Map(Array.from({ length: 20 }, (_, frame) => [frame, [
    row('root', 0, 20, null, '<AbsoluteFill>'), row('start', 0, 10, 'root'), row('end', 10, 10, 'root'),
    ...(frame < 10 ? [row('nested', 3, 3, 'start')] : []),
    ...(frame >= 7 && frame < 9 ? [row('conditional', 0, 20, 'root')] : []),
  ]]))
  const manifest = manifestFromFrames(frames, composition)
  const clips = manifest.tracks.flatMap(track => track.clips)
  assert.equal(clips.length, 4)
  assert.deepEqual(clips.find(clip => clip.name === 'conditional').start, 0.7)
  assert.equal(clips.find(clip => clip.name === 'conditional').duration, 0.2)
  assert.equal(clips.find(clip => clip.name === 'nested').start, 0.3)
  assert.equal(clips.find(clip => clip.name === 'start').start, 0)
})

test('missing or oversized captures produce an explicit full-film fallback', () => {
  const collector = createTimelineCollector()
  assert.equal(collector.manifest(composition).detail, 'limited')
  for (let frame = 0; frame < 20; frame++) collector.onArtifact({ filename: `${collector.prefix}${frame}.json`, frame,
    content: JSON.stringify(Array.from({ length: 61 }, (_, index) => row(`parallel-${index}`, 0, 20))) })
  const fallback = collector.manifest(composition)
  assert.equal(fallback.detail, 'limited')
  assert.equal(fallback.tracks.length, 1)
  assert.equal(fallback.tracks[0].clips[0].duration, 2)
})

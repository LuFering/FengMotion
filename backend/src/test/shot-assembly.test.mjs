import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shotAssembly, shotTracks } from '../../remotion/shot-assembly.mjs'

const timeline = {
  width: 960, height: 540, fps: 30, durationInFrames: 210,
  shots: [
    { id: 'chart', sourceId: 'chart', startFrame: 0, frames: 120, label: '比较 {"每杯"}' },
    { id: 'outro', sourceId: 'chart', startFrame: 120, frames: 90, label: '结尾' },
  ],
  voiceover: 'voiceover.m4a',
}

test('backend composes separate instances and keeps narration outside the shots', () => {
  const entry = shotAssembly(timeline)
  assert.equal(entry.match(/import \{ Shot as/g).length, 1)
  assert.ok(entry.includes('key={"outro"} name={"结尾"} from={120} durationInFrames={90}'))
  assert.ok(entry.includes('</Sequence><Html5Audio src={staticFile("voiceover.m4a")} />'))
  assert.ok(entry.includes('name={"比较 {\\"每杯\\"}"}'))
  assert.throws(() => shotAssembly({ ...timeline, shots: [{ sourceId: '../index' }] }), /Invalid shot source ID/)
})

test('track clips expose stable slot IDs rather than render-generated sequence IDs', () => {
  const manifest = shotTracks(timeline)
  assert.equal(manifest.durationSeconds, 7)
  assert.deepEqual(manifest.tracks[0].clips.map(({ id, start, duration }) => [id, start, duration]), [
    ['chart', 0, 4], ['outro', 4, 3],
  ])
})

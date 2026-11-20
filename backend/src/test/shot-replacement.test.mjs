import assert from 'node:assert/strict'
import { test } from 'node:test'
import { propose } from './shot-replacement/proposal.mjs'

const base = {
  version: 1,
  shots: [{ id: 'chart', sourceId: 'bars', startFrame: 0, frames: 120 },
    { id: 'outro', sourceId: 'end', startFrame: 120, frames: 90, locked: true }],
  audio: { id: 'voice', startFrame: 0 },
}
const sources = { bars: { shotId: 'chart' }, ranking: { shotId: 'chart' }, end: { shotId: 'outro' } }
const request = { baseVersion: 1, operation: 'replace-shot-source', shotId: 'chart', sourceId: 'ranking' }

test('a proposal replaces only the target source and never mutates the committed base', () => {
  const copy = structuredClone(base)
  const next = propose(base, 'chart', request, sources)
  assert.deepEqual(next, { ...base, version: 2, shots: [{ ...base.shots[0], sourceId: 'ranking' }, base.shots[1]] })
  assert.deepEqual(base, copy)
})

test('only a new registered source for the authorized, unlocked slot is accepted', () => {
  for (const [target, patch, error] of [
    ['chart', { baseVersion: 0 }, 'shot_version_conflict'],
    ['chart', { shotId: 'outro', sourceId: 'end' }, 'shot_out_of_scope'],
    ['outro', { shotId: 'outro', sourceId: 'end' }, 'shot_out_of_scope'],
    ['chart', { sourceId: 'end' }, 'invalid_shot_source'],
    ['chart', { sourceId: 'constructor' }, 'invalid_shot_source'],
    ['chart', { sourceId: 'bars' }, 'unchanged_shot_source'],
    ['chart', { audio: { id: 'silent' } }, 'unsupported_shot_operation'],
    ['chart', { frames: 240 }, 'unsupported_shot_operation'],
  ]) assert.throws(() => propose(base, target, { ...request, ...patch }, sources), new RegExp(error))
})

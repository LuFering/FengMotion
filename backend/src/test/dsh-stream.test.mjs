import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../dsh-plugin/index.js'

test('bridge attaches each attempt to its session and step without narrating tool calls', () => {
  let accept
  const frames = []
  const original = process.stderr.write
  process.stderr.write = line => { frames.push(JSON.parse(String(line))); return true }
  try {
    apply({ on(event, callback) { assert.equal(event, 'agent/assistant-stream'); accept = callback } })
    const send = frame => accept({ frame })
    send({ type: 'start', attemptId: 'project:thread:1', turn: 2, step: 4 })
    send({ type: 'chunk', attemptId: 'project:thread:1', chunk: { type: 'text-delta', text: '先检查。' } })
    send({ type: 'chunk', attemptId: 'project:thread:1', chunk: { type: 'tool-call-delta', id: 'read', argumentsDelta: '{}' } })
    send({ type: 'start', attemptId: 'other:1', turn: 1, step: 1 })
    send({ type: 'chunk', attemptId: 'other:1', chunk: { type: 'text-delta', text: '另一个会话' } })
    send({ type: 'chunk', attemptId: 'project:thread:1', chunk: { type: 'text-delta', text: '然后验证。' } })
    send({ type: 'end', attemptId: 'project:thread:1', outcome: { kind: 'committed' } })
    const scoped = frames.filter(frame => frame.params.sessionId === 'project:thread')
    assert.equal(scoped.length, 4)
    assert.equal(scoped[1].params.text, '先检查。')
    assert.equal(scoped[2].params.text, '然后验证。')
    assert.equal(scoped[2].params.step, 4)
    assert.equal(scoped[2].params.turn, 2)
    assert.equal(scoped[2].params.attemptId, 'project:thread:1')
    assert.equal(frames.filter(frame => frame.params.kind === 'text').length, 3)
  } finally { process.stderr.write = original }
})

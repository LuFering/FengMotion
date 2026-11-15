import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../main/resources/dsh-direct-text/plugin.mjs'

async function exercise(chunks) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'direct-test-'))
  const request = path.join(dir, 'request.json'), result = path.join(dir, 'result.json')
  process.env.FENGMOTION_DIRECT_REQUEST = request
  process.env.FENGMOTION_DIRECT_RESULT = result
  try {
    await writeFile(request, JSON.stringify({ provider: 'p', model: 'm', prompt: 'hello', maxTokens: 10, timeoutMs: 1000 }))
    let options
    apply({ llm: { listProviders: () => [{ id: 'p' }], async *stream(value) { options = value; yield* chunks } } })
    let output
    for (let i = 0; i < 100; i++) {
      try { output = JSON.parse(await readFile(result, 'utf8')); break } catch (e) { if (e.code !== 'ENOENT') throw e }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(output, 'bridge did not publish result')
    return { options, output }
  } finally {
    delete process.env.FENGMOTION_DIRECT_REQUEST
    delete process.env.FENGMOTION_DIRECT_RESULT
    await rm(dir, { recursive: true, force: true })
  }
}

test('calls LLM directly with no tools and joins text', async () => {
  const { options, output } = await exercise([{ type: 'text-delta', text: 'ok' }, { type: 'finish', reason: { kind: 'stop' } }])
  assert.deepEqual(options.tools, [])
  assert.equal(options.messages[0].content[0].text, 'hello')
  assert.equal(output.text, 'ok')
})

test('reports error code without provider error message', async () => {
  const { output } = await exercise([{ type: 'finish', reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL', message: 'secret' } } }])
  assert.deepEqual(output, { error: 'MODEL_ERROR', code: 'MISSING_CREDENTIAL' })
})

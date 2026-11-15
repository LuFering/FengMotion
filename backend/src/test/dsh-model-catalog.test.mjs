import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../main/resources/dsh-model-catalog/plugin.mjs'

async function run(llm) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'catalog-test-'))
  const request = path.join(dir, 'request.json'), result = path.join(dir, 'result.json')
  process.env.FENGMOTION_CATALOG_REQUEST = request
  process.env.FENGMOTION_CATALOG_RESULT = result
  try {
    await writeFile(request, JSON.stringify({ provider: 'p' }))
    apply({ llm })
    for (let i = 0; i < 200; i++) {
      try { return JSON.parse(await readFile(result, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw Error('no result')
  } finally {
    delete process.env.FENGMOTION_CATALOG_REQUEST
    delete process.env.FENGMOTION_CATALOG_RESULT
    await rm(dir, { recursive: true, force: true })
  }
}

test('resolves runtime metadata and exposes only allowed fields', async () => {
  const output = await run({ listProviders: () => [{ id: 'p' }], listModels: async () => [{ id: 'm' }],
    resolveModelInfo: async (p, m) => ({ id: m, name: 'Model', context: { contextWindow: 99 },
      defaultMaxTokens: 12, reasoning: { efforts: [{ id: 'high' }] }, secret: 'do-not-expose' }) })
  assert.deepEqual(output, { entries: [{ id: 'm', label: 'Model', contextWindow: 99, maxTokens: null, reasoningEfforts: ['high'] }] })
})

test('keeps other models when one capability lookup fails', async () => {
  const output = await run({ listProviders: () => [{ id: 'p' }], listModels: async () => [{ id: 'm' }, { id: 'plain' }],
    resolveModelInfo: async (_provider, id) => {
      if (id === 'm') throw Error('secret')
      return { id, name: 'Plain' }
    } })
  assert.deepEqual(output, { entries: [
    { id: 'm', label: 'm', contextWindow: null, maxTokens: null, reasoningEfforts: null },
    { id: 'plain', label: 'Plain', contextWindow: null, maxTokens: null, reasoningEfforts: [] },
  ] })
})

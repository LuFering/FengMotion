import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFrom, pathToFileUrl, runtimeVersions } from '../../remotion/render-shared.mjs'

test('runtime file URLs preserve spaces unicode percent hashes and question marks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fm-依赖 # % ?-'))
  try {
    const file = path.join(root, 'component #?.mjs')
    await writeFile(file, 'export const marker = "loaded"')
    assert.equal(fileURLToPath(pathToFileUrl(file)), file)
    assert.equal((await import(pathToFileUrl(file))).marker, 'loaded')
    const packageRoot = path.join(root, 'node_modules/example')
    await mkdir(packageRoot, { recursive: true })
    await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'example', type: 'module', main: 'index.mjs' }))
    await writeFile(path.join(packageRoot, 'index.mjs'), 'export const marker = "package"')
    assert.equal((await loadFrom(path.join(root, 'node_modules'), 'example')).marker, 'package')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('render provenance records installed versions rather than dependency ranges', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fm-runtime-versions-'))
  try {
    const expected = { remotion: '4.0.519', '@remotion/renderer': '4.0.519', '@remotion/bundler': '4.0.519', react: '19.0.0' }
    for (const [name, version] of Object.entries(expected)) {
      await mkdir(path.join(root, name), { recursive: true })
      await writeFile(path.join(root, name, 'package.json'), JSON.stringify({ name, version }))
    }
    assert.deepEqual(await runtimeVersions(root), expected)
    await writeFile(path.join(root, 'react/package.json'), '{}')
    await assert.rejects(runtimeVersions(root), /react/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

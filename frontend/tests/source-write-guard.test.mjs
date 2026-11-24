import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, access, mkdir, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { withSourceWriteGuard } from '../live-preview/source-write-guard.mjs'

test('cooperating writers cannot overlap, and another writer can enter after release', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fm-source-guard-'))
  let release, enter
  const started = new Promise(resolve => { enter = resolve })
  const finish = new Promise(resolve => { release = resolve })
  try {
    const first = withSourceWriteGuard(root, async () => { enter(); await finish; return 'first' })
    await started
    await assert.rejects(withSourceWriteGuard(root, () => assert.fail('overlapping writer ran')), { code: 'source_busy' })
    release()
    assert.equal(await first, 'first')
    assert.equal(await withSourceWriteGuard(root, () => 'second'), 'second')
    await assert.rejects(access(path.join(root, '.fengmotion/source-write.lock')), { code: 'ENOENT' })
  } finally { release?.(); await rm(root, { recursive: true, force: true }) }
})

test('failed writes release their lock, foreign owner records and symbolic links remain untouched', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fm-source-guard-'))
  try {
    await assert.rejects(withSourceWriteGuard(root, () => { throw new Error('failed write') }), /failed write/)
    const lock = path.join(root, '.fengmotion/source-write.lock')
    await mkdir(lock)
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: 123, token: 'another-owner' }))
    await assert.rejects(withSourceWriteGuard(root, () => assert.fail()), { code: 'source_busy' })
    await access(path.join(lock, 'owner.json'))
    await rm(lock, { recursive: true })
    await symlink(path.join(root, 'external'), lock)
    await assert.rejects(withSourceWriteGuard(root, () => assert.fail()), { code: 'source_lock_invalid' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('unresolved recovery journal blocks edits until recovery is completed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fm-recovery-guard-'))
  const backup = path.join(root, '.fengmotion/restore-backups/recovery-one')
  try {
    await mkdir(backup, { recursive: true })
    await writeFile(path.join(backup, 'recovery.json'), JSON.stringify({ state: 'applied' }))
    await assert.rejects(withSourceWriteGuard(root, () => assert.fail('pending recovery must block writes')), { code: 'source_recovery_required' })
    await writeFile(path.join(backup, 'recovery.json'), JSON.stringify({ state: 'rolled_back' }))
    assert.equal(await withSourceWriteGuard(root, () => 'writable'), 'writable')
    await writeFile(path.join(backup, 'recovery.json'), JSON.stringify({ state: 'committed', entries: 'x'.repeat(32768) }))
    assert.equal(await withSourceWriteGuard(root, () => 'large-journal'), 'large-journal')
    await writeFile(path.join(backup, 'recovery.json'), JSON.stringify({ state: 'committed', entries: 'x'.repeat(1_048_576) }))
    await assert.rejects(withSourceWriteGuard(root, () => assert.fail()), { code: 'source_recovery_invalid' })
    await writeFile(path.join(backup, 'recovery.json'), '{broken')
    await assert.rejects(withSourceWriteGuard(root, () => assert.fail()), { code: 'source_recovery_invalid' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

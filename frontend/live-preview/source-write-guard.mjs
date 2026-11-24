import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile, lstat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { EditError } from './source-edit.mjs'

export async function withSourceWriteGuard(root, action) {
  const control = path.join(root, '.fengmotion')
  const lock = path.join(control, 'source-write.lock')
  const token = randomUUID()
  const staged = path.join(control, `.source-lock-${token}`)
  const owner = JSON.stringify({ pid: process.pid, token })
  let acquired = false
  try {
    const stat = await lstat(control).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
    if (stat?.isSymbolicLink()) throw new EditError('source_lock_invalid', '源码锁目录无效')
    const existing = await lstat(lock).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
    if (existing?.isSymbolicLink()) throw new EditError('source_lock_invalid', '源码锁路径无效')
    if (existing) throw new EditError('source_busy', '另一处正在写入源码，请重新读取后重试')
    await mkdir(control, { recursive: true })
    await mkdir(staged)
    await writeFile(path.join(staged, 'owner.json'), owner)
    try { await rename(staged, lock) }
    catch (error) {
      if (['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw new EditError('source_busy', '另一处正在写入源码，请重新读取后重试')
      throw error
    }
    acquired = true
    const backups = path.join(control, 'restore-backups')
    const backupStat = await lstat(backups).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
    if (backupStat?.isSymbolicLink()) throw new EditError('source_lock_invalid', '恢复目录不能是符号链接')
    if (backupStat) {
      for (const entry of await readdir(backups, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new EditError('source_lock_invalid', '恢复目录不能包含符号链接')
        const journal = path.join(backups, entry.name, 'recovery.json')
        const info = await lstat(journal).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
        if (!info) continue
        if (info.isSymbolicLink() || !info.isFile() || info.size > 1_048_576) throw new EditError('source_recovery_invalid', '恢复日志无效，请先检查工程')
        let value
        try { value = JSON.parse(await readFile(journal, 'utf8')) } catch { throw new EditError('source_recovery_invalid', '恢复日志无法读取') }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EditError('source_recovery_invalid', '恢复日志不是有效对象')
        if (!['committed', 'rolled_back'].includes(value.state)) throw new EditError('source_recovery_required', '工程存在未收尾的源码写入，请先恢复后再编辑')
      }
    }
    return await action()
  } finally {
    if (acquired && await readFile(path.join(lock, 'owner.json'), 'utf8').catch(() => '') === owner) {
      await unlink(path.join(lock, 'owner.json')).catch(() => undefined)
      await rmdir(lock).catch(() => undefined)
    }
    await unlink(path.join(staged, 'owner.json')).catch(() => undefined)
    await rmdir(staged).catch(() => undefined)
  }
}

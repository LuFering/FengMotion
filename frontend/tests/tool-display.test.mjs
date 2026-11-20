import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startViteForModules } from './support/fake-studio.mjs'

/*
 * 对话里工具调用的分组（toolDisplay）。
 * 守的是两件事：执行顺序不被打乱（只合并相邻的同名调用），
 * 以及组与步骤的 id 稳定（新调用到达时已有的行不重建、不重新生长）。
 */

let server
let td
before(async () => {
  server = await startViteForModules()
  td = await server.ssrLoadModule('/src/features/chat/components/toolDisplay.tsx')
})
after(async () => { await server?.close() })

const call = (callId, name, extra = {}) => ({ callId, name, arguments: JSON.stringify({ command: `echo ${callId}` }), done: true, ...extra })

test('只合并相邻的同名调用，不把后面的命令挪到前面', () => {
  const tasks = td.toolCallsToTasks([call('a', 'bash'), call('b', 'bash'), call('c', 'read'), call('d', 'bash')], false)
  assert.deepEqual(tasks.map((t) => t.title), ['bash · 2 次', 'read · 1 次', 'bash · 1 次'])
  assert.deepEqual(tasks.map((t) => t.steps.length), [2, 1, 1])
})

test('组 id 取首个调用，新调用到达时组 id 与已有步骤 id 都不变', () => {
  const before = td.toolCallsToTasks([call('a', 'bash')], true)
  const afterArrive = td.toolCallsToTasks([call('a', 'bash'), call('b', 'bash', { done: false })], true)
  assert.equal(afterArrive[0].id, before[0].id)
  assert.equal(afterArrive[0].steps[0].id, before[0].steps[0].id)
  assert.equal(afterArrive[0].steps[1].id, 'b')
})

test('运行中：没收到结果的那一步扫光，组标题带上它的命令说明', () => {
  const [task] = td.toolCallsToTasks([call('a', 'bash'), call('b', 'bash', { done: false })], true)
  assert.deepEqual(task.steps.map((s) => s.running), [false, true])
  assert.match(task.runningTitle, /^正在执行 bash · /)
  const [settled] = td.toolCallsToTasks([call('a', 'bash'), call('b', 'bash')], false)
  assert.equal(settled.runningTitle, undefined)
})

test('推进单元数与分组口径一致：每组 1 个标题单元加每步 1 个', () => {
  const calls = [call('a', 'bash'), call('b', 'read'), call('c', 'bash')]
  assert.equal(td.toolCallsRevealed(calls), 3 + 3)
})

test('失败的调用用失败标记代替文件标签', () => {
  const [task] = td.toolCallsToTasks([call('a', 'bash', { isError: true })], false)
  assert.deepEqual(task.steps[0].chips, [{ label: '失败', tone: 'error' }])
  assert.match(task.title, /1 失败/)
})

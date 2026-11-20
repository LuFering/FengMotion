import http from 'node:http'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
const args = process.argv.slice(2)
const value = name => args[args.indexOf(name) + 1]
const mode = value('--composition')
writeFileSync(path.join(value('--node-modules'), 'fixture-process.json'), JSON.stringify({ pid: process.pid }))
const emit = payload => process.stdout.write(JSON.stringify(payload) + '\n')
if (mode === 'DependencyMissing') {
  emit({ event: 'failed', code: 'dependency_missing', message: 'missing test dependency' })
  process.exit(2)
}
if (mode === 'ExitEarly') process.exit(3)
if (mode === 'InvalidSignal') {
  emit({ event: 'ready', url: 'http://example.com/', pid: process.pid })
  setInterval(() => {}, 1000)
} else if (mode === 'Timeout') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  writeFileSync(path.join(value('--node-modules'), 'fixture-process.json'), JSON.stringify({ pid: process.pid, child: child.pid }))
  setInterval(() => {}, 1000)
} else {
  const server = http.createServer((request, response) => response.end('preview fixture'))
  server.listen(Number(value('--port')), value('--host'), () => {
    emit({ event: 'ready', url: `http://127.0.0.1:${server.address().port}/`, pid: process.pid })
    process.stderr.write('fixture logs\n')
  })
}
process.on('SIGTERM', () => process.exit(0))

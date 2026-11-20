import { spawn } from 'node:child_process'

const child = spawn(process.execPath, process.argv.slice(2), { stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 1))

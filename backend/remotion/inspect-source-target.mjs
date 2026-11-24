import { createRequire } from 'node:module'
import path from 'node:path'
import { resolveNodeModules } from './render-shared.mjs'

try {
  process.stdin.setEncoding('utf8')
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
    if (input.length > 8_400_000) throw new Error('source_too_large')
  }
  const request = JSON.parse(input)
  const requireFrom = createRequire(path.join(resolveNodeModules(import.meta.dirname), 'source-target.js'))
  const parser = requireFrom('@babel/parser')
  const ast = parser.parse(request.text, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
  if (request.validateOnly) {
    process.stdout.write(JSON.stringify({ ok: true }))
  } else {
    let target = null
    function visit(value) {
      if (!value || typeof value !== 'object' || target) return
      if (value.type === 'JSXElement' && value.loc.start.line === request.line
          && value.loc.start.column + 1 === request.column) { target = value; return }
      for (const [key, item] of Object.entries(value)) {
        if (['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) continue
        if (Array.isArray(item)) item.forEach(visit)
        else visit(item)
      }
    }
    visit(ast)
    if (!target) throw new Error('source_target_missing')
    const code = request.text.slice(target.start, target.end)
    if (code.length > 32768) throw new Error('source_target_too_large')
    process.stdout.write(JSON.stringify({ ok: true, start: target.start, end: target.end, code }))
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error.message).slice(0, 300) }))
  process.exitCode = 1
}

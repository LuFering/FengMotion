import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { startViteForModules } from './support/fake-studio.mjs'

/* 回复里用反引号写的文件路径按文件渲染（FileMention），其余行内代码保持原样。 */

let server
let md
before(async () => {
  server = await startViteForModules()
  md = await server.ssrLoadModule('/src/features/chat/components/MarkdownText.tsx')
})
after(async () => { await server?.close() })

const html = (text) => renderToString(createElement(md.MarkdownText, { text }))

test('带目录的文件路径：目录与文件名分开，悬停看完整路径', () => {
  const out = html('成片在 `renders/coffee-caffeine.mp4`。')
  assert.match(out, /class="md-file"/)
  assert.match(out, /class="md-file-dir">renders\/</)
  assert.match(out, /class="md-file-name">coffee-caffeine\.mp4</)
  assert.match(out, /title="renders\/coffee-caffeine\.mp4/)
  assert.match(out, /class="md-file-icon md-file-logo" src="\.\/assets\/brand\/fengmotion-mark\.png"/)
})

test('只有文件名也按文件渲染', () => {
  assert.match(html('看一下 `package.json`'), /class="md-file-name">package\.json</)
})

test('不是文件的行内代码保持普通样式', () => {
  for (const code of ['shotcraft:chart-live-moves', 'npm run build', 'https://example.com/a.mp4', 'film.config']) {
    const out = html(`见 \`${code}\``)
    assert.doesNotMatch(out, /md-file/, code)
    assert.match(out, /class="md-inline-code"/, code)
  }
})

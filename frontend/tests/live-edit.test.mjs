import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const parser = require('@babel/parser')
const se = await import('../live-preview/source-edit.mjs')

let server, m
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  m = await server.ssrLoadModule('/src/features/workbench/model/liveEdit.ts')
})
after(async () => { await server?.close() })

const code = `const A = () => (
\t<Chars
\t\ttext={'一杯咖啡里，\\n到底有多少咖啡因？'}
\t\tstyle={{
\t\t\tfontSize: 106,
\t\t\tletterSpacing: '-0.01em',
\t\t\tcolor: C.ink,
\t\t}}
\t/>
);
const B = () => <div style={{marginTop: 4}}>答案</div>;`

test('inspect reports literals, expressions and plain text children', () => {
  const info = se.inspect(parser, code, 2, 2)
  assert.equal(info.name, 'Chars')
  assert.equal(info.attrs.text.value, '一杯咖啡里，\n到底有多少咖啡因？')
  assert.equal(info.attrs.style.props.fontSize.value, 106)
  assert.deepEqual(info.attrs.style.props.color, { kind: 'expr', code: 'C.ink' })
  assert.equal(se.inspect(parser, code, 11, 17).children.value, '答案')
  assert.equal(se.inspect(parser, code, 1, 1), null)
})

test('edits replace one value and keep formatting, quotes and neighbours', () => {
  let out = se.applyEdit(parser, code, { line: 2, column: 2, path: ['style', 'fontSize'], value: 96, expect: 106 })
  assert.match(out, /\t\t\tfontSize: 96,\n\t\t\tletterSpacing: '-0\.01em',/)
  out = se.applyEdit(parser, out, { line: 2, column: 2, path: ['style', 'letterSpacing'], value: '0.02em', expect: '-0.01em' })
  assert.match(out, /letterSpacing: '0\.02em'/)
  out = se.applyEdit(parser, out, { line: 2, column: 2, path: ['text'], value: '一杯\n多少', expect: '一杯咖啡里，\n到底有多少咖啡因？' })
  assert.match(out, /text=\{'一杯\\n多少'\}/)
  out = se.applyEdit(parser, out, { line: 11, column: 17, path: ['#children'], value: '新答案', expect: '答案' })
  assert.match(out, /<div style=\{\{marginTop: 4\}\}>新答案<\/div>/)
})

test('new style keys are inserted with the existing indentation and comma style', () => {
  const out = se.applyEdit(parser, code, { line: 2, column: 2, path: ['style', 'fontWeight'], value: 700, expect: null })
  assert.match(out, /\t\t\tcolor: C\.ink,\n\t\t\tfontWeight: 700,\n\t\t\}\}/)
  const inline = se.applyEdit(parser, code, { line: 11, column: 17, path: ['style', 'opacity'], value: 0.5, expect: null })
  assert.match(inline, /style=\{\{marginTop: 4, opacity: 0\.5\}\}/)
})

test('expressions are only replaced when the caller names the exact expression', () => {
  assert.throws(() => se.applyEdit(parser, code, { line: 2, column: 2, path: ['style', 'color'], value: '#FFAA00', expect: '#000' }), { code: 'not_static' })
  assert.throws(() => se.applyEdit(parser, code, { line: 2, column: 2, path: ['style', 'color'], value: '#FFAA00', expect: null, expectCode: 'C.gold' }), { code: 'source_changed' })
  const out = se.applyEdit(parser, code, { line: 2, column: 2, path: ['style', 'color'], value: '#FFAA00', expect: null, expectCode: 'C.ink' })
  assert.match(out, /color: '#FFAA00'/)
})

test('stale expectations and missing elements are refused', () => {
  assert.throws(() => se.applyEdit(parser, code, { line: 2, column: 2, path: ['style', 'fontSize'], value: 90, expect: 100 }), { code: 'source_changed' })
  assert.throws(() => se.applyEdit(parser, code, { line: 3, column: 9, path: ['text'], value: 'x', expect: 'y' }), { code: 'element_not_found' })
  assert.throws(() => se.applyEdit(parser, code, { line: 2, column: 2, path: ['style', 'fontWeight'], value: 700, expect: 600 }), { code: 'source_changed' })
})

/* 组件链：页面节点 div（style 是变量）→ div → Chars 调用处（style 是对象字面量） */
const el = (extra = {}) => ({
  src: 'src/Coffee.tsx:68:5', tag: 'div', text: '一杯咖啡里，', level: 0,
  style: { fontSize: '106px', fontFamily: 'Inter', fontWeight: '600', color: 'rgb(244, 238, 228)', lineHeight: '131.44px', letterSpacing: '-1.06px', opacity: '1', textAlign: 'start', backgroundColor: 'rgba(0, 0, 0, 0)' },
  rect: { x: 0.08, y: 0.34, w: 0.85, h: 0.12 }, box: { x: 0, y: 0, w: 10, h: 10 }, sequence: null, frame: 75,
  chain: [
    { name: 'div', kind: 'host', src: 'src/Coffee.tsx:68:5', props: {}, source: { name: 'div', attrs: { style: { kind: 'object', props: { whiteSpace: { kind: 'string', value: 'pre' } }, code: '' } }, children: null, file: 'src/Coffee.tsx', fileHash: 'h' } },
    { name: 'div', kind: 'host', src: 'src/Coffee.tsx:66:3', props: {}, source: { name: 'div', attrs: { style: { kind: 'expr', code: 'style' } }, children: null, file: 'src/Coffee.tsx', fileHash: 'h' } },
    { name: 'Chars', kind: 'component', src: 'src/Coffee.tsx:170:5', props: {}, source: { name: 'Chars', attrs: {
      text: { kind: 'string', value: '一杯咖啡里，\n到底有多少咖啡因？' },
      style: { kind: 'object', props: { fontSize: { kind: 'number', value: 106 }, color: { kind: 'expr', code: 'C.ink' } }, code: '' },
    }, children: null, file: 'src/Coffee.tsx', fileHash: 'h' } },
  ],
  ...extra,
})

test('text is written where the shown words come from, not inside the component', () => {
  const t = m.textTarget(el())
  assert.equal(t.src, 'src/Coffee.tsx:170:5')
  assert.deepEqual(t.path, ['text'])
})

test('style edits go to the level that already has the key, new keys go to the call site', () => {
  assert.equal(m.styleTargetFor(el(), 'fontSize').src, 'src/Coffee.tsx:170:5')
  assert.equal(m.styleTargetFor(el(), 'whiteSpace').src, 'src/Coffee.tsx:68:5')
  /* 新增 fontWeight：不写进 Chars 内部的 div（那会影响所有 Chars），写在调用处 */
  assert.equal(m.styleTargetFor(el(), 'fontWeight').src, 'src/Coffee.tsx:170:5')
  assert.deepEqual(m.fieldState(m.styleTargetFor(el(), 'color'), 'color'), { mode: 'expr', code: 'C.ink' })
  assert.deepEqual(m.fieldState(m.styleTargetFor(el(), 'fontWeight'), 'fontWeight'), { mode: 'insert' })
})

test('units, colors and timecodes follow the workbench conventions', () => {
  assert.deepEqual(m.splitUnit('-0.01em'), { n: -0.01, unit: 'em' })
  assert.deepEqual(m.splitUnit(106), { n: 106, unit: '' })
  assert.equal(m.splitUnit('calc(1px + 2px)'), null)
  assert.equal(m.joinUnit(0.02, 'em', '-0.01em'), '0.02em')
  assert.equal(m.joinUnit(96, '', 106), 96)
  assert.equal(m.hexOf('rgb(244, 238, 228)'), '#F4EEE4')
  assert.equal(m.hexOf('rgba(0, 0, 0, 0.5)'), null)
  assert.equal(m.toTimecode(75, 30), '0:02.5')
  assert.equal(m.shortSrc('src/Coffee.tsx:170:5'), 'Coffee.tsx:170')
})

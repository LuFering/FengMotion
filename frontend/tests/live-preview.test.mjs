import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const babel = require('@babel/core')
const annotateSource = (await import('../live-preview/annotate.mjs')).default

let server, live, groups, changes
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  live = await server.ssrLoadModule('/src/features/workbench/hooks/stage/useLivePreview.ts')
  groups = await server.ssrLoadModule('/src/features/workbench/model/timelineGroups.ts')
  changes = await server.ssrLoadModule('/src/features/workbench/model/layerChanges.ts')
})
after(async () => { await server?.close() })

const annotate = (code, filename = '/proj/src/Coffee.tsx') => babel.transformSync(code, {
  filename, babelrc: false, configFile: false,
  parserOpts: { plugins: ['jsx', 'typescript'] },
  plugins: [[annotateSource, { root: '/proj' }]],
}).code

test('every JSX element gets its source position, relative to the project root', () => {
  const out = annotate('const A = () => <div>\n  <Chars text="hi" />\n</div>')
  assert.match(out, /<div data-fm-src="src\/Coffee\.tsx:1:17">/)
  assert.match(out, /<Chars text="hi" data-fm-src="src\/Coffee\.tsx:2:3" \/>/)
})

test('fragments are left alone and existing annotations are not duplicated', () => {
  const out = annotate('const A = () => <><React.Fragment><span data-fm-src="x" /></React.Fragment></>')
  assert.doesNotMatch(out, /Fragment data-fm-src/)
  assert.equal(out.match(/data-fm-src/g).length, 1)
})

test('live tracks follow the render-time rules: scene layers by depth, media by type, elements by category and split when they overlap', () => {
  const tracks = live.liveTracks([
    { id: 'b', parent: null, name: 'BarChart', type: 'sequence', from: 90, duration: 240 },
    { id: 'a', parent: null, name: 'Hook', type: 'sequence', from: 0, duration: 90 },
    { id: 'n', parent: 'b', name: 'Inner', type: 'sequence', from: 10, duration: 20 },
    { id: 'm', parent: null, name: 'Music', type: 'audio', from: 0, duration: 900 },
    { id: 'z', parent: null, name: 'Empty', type: 'sequence', from: 10, duration: 0 },
  ], 30, [
    { key: 'src/A.tsx:1:1', src: 'src/A.tsx:1:1', name: '标题', kind: 'text', ranges: [[0, 60]] },
    { key: 'src/A.tsx:2:1', src: 'src/A.tsx:2:1', name: '副标题', kind: 'text', ranges: [[30, 90]] },
  ])
  assert.deepEqual(tracks.map((t) => t.name), ['场景层 1', '场景层 2', '文字 1', '文字 2', '音频'])
  assert.deepEqual(tracks.map((t) => t.category), ['scene', 'scene', 'text', 'text', 'audio'])
  assert.equal(tracks[2].clips[0].src, 'src/A.tsx:1:1')
  assert.deepEqual(tracks[0].clips.map((c) => [c.name, c.start, c.duration]), [['Hook', 0, 3], ['BarChart', 3, 8]])
  assert.equal(tracks[1].clips[0].name, 'Inner')
  assert.deepEqual(tracks[2].clips.map((c) => c.name), ['标题'])
  assert.deepEqual(tracks[3].clips.map((c) => c.name), ['副标题'])
  assert.equal(tracks[4].clips[0].kind, 'audio')
  const hit = live.layerClipFor(tracks, [null, 'src/A.tsx:2:1'], 2)
  assert.equal(hit.trackId, tracks[3].id)
  assert.equal(live.layerClipFor(tracks, ['src/A.tsx:2:1'], 5), null)
})

const clip = (id, start, duration, extra = {}) => ({ id, name: id, kind: 'shape', start, duration, ...extra })

test('tracks group into category drawers; busy categories start collapsed, scenes stay open', () => {
  const tracks = [
    { id: 's1', name: '场景层 1', category: 'scene', clips: [clip('Hook', 0, 3)] },
    { id: 's2', name: '场景层 2', category: 'scene', clips: [clip('In', 0, 1)] },
    { id: 's3', name: '场景层 3', category: 'scene', clips: [clip('Deep', 0, 1)] },
    { id: 't1', name: '文字 1', category: 'text', clips: [clip('a', 0, 1, { src: 'A:1:1' }), clip('a2', 2, 1, { src: 'A:1:1' })] },
    { id: 't2', name: '文字 2', category: 'text', clips: [clip('b', 0, 1, { src: 'A:2:1' })] },
    { id: 't3', name: '文字 3', category: 'text', clips: [clip('c', 0, 1, { src: 'A:3:1' })] },
    { id: 'm', name: '背景音乐', clips: [clip('m', 0, 9)] },
  ]
  const g = groups.groupTracks(tracks)
  assert.deepEqual(g.map((x) => [x.category, x.tracks.length, x.count]), [['scene', 3, 3], ['text', 3, 3], ['audio', 1, 1]])
  assert.equal(groups.defaultCollapsed(g[0]), false)
  assert.equal(groups.defaultCollapsed(g[1]), true)
  assert.equal(groups.categoryOf({ id: 'x', name: '成片', clips: [] }), 'scene')
  const bins = groups.densityBins(g[1], 0, 4, 4)
  assert.deepEqual(bins, [3, 0, 1, 0])
  /* 这一刻同时有几个：取最晚出现的；没有就取最近的 */
  assert.equal(groups.prominentClipAt(g[1], 2.5).clip.id, 'a2')
  assert.equal(groups.prominentClipAt(g[1], 1.6).clip.id, 'a2')
})

test('cut points, snapping, search and the elements inside a time span', () => {
  const tracks = [
    { id: 's', name: '场景层 1', category: 'scene', clips: [clip('Hook', 0, 3), clip('Bar', 3, 5)] },
    { id: 't', name: '文字 1', category: 'text', clips: [clip('Chars', 1, 1.5, { src: 'src/C.tsx:4:2', text: '单份浓缩 64mg' }), clip('Chars', 4, 1, { src: 'src/C.tsx:4:2', text: '单份浓缩 64mg' })] },
  ]
  const pts = groups.cutPoints(tracks, 8)
  assert.deepEqual(pts, [0, 1, 2.5, 3, 4, 5, 8])
  assert.equal(groups.adjacentCut(pts, 3, 1), 4)
  assert.equal(groups.adjacentCut(pts, 3, -1), 2.5)
  assert.equal(groups.adjacentCut(pts, 8, 1), null)
  assert.equal(groups.snapTo(pts, 2.93, 0.1), 3)
  assert.equal(groups.snapTo(pts, 2.7, 0.1), 2.7)
  assert.deepEqual(groups.searchClips(tracks, '浓缩').map((h) => h.clip.start), [1, 4])
  assert.deepEqual(groups.searchClips(tracks, 'c.tsx 64').length, 2)
  assert.equal(groups.searchClips(tracks, '   ').length, 0)
  const inSpan = groups.elementsInSpan(tracks, { start: 2, end: 4.5 })
  assert.deepEqual(inSpan.map((e) => [e.category, e.name]), [['scene', 'Hook'], ['scene', 'Bar'], ['text', 'Chars']])
  assert.equal(inSpan[2].start, 1)
  assert.equal(inSpan[2].end, 5)
})

test('change marks survive source positions shifting, and catch real edits', () => {
  const item = (key, name, ranges, extra = {}) => ({ key, src: key, name, kind: 'text', ranges, ...extra })
  const before = [item('A:10:1', '标题', [[0, 30]], { text: '咖啡' }), item('A:20:1', '标签', [[30, 60]], { text: '64mg' })]
  /* AI 在上面插了 3 行：位置全变，内容没变 → 什么都不标 */
  const shifted = [item('A:13:1', '标题', [[0, 30]], { text: '咖啡' }), item('A:23:1', '标签', [[30, 60]], { text: '64mg' })]
  assert.deepEqual([...changes.diffLayers(before, shifted, new Set())], [])
  /* 改了文字、挪了时间、新加了元素 → 都标出来 */
  const edited = [item('A:10:1', '标题', [[0, 30]], { text: '茶' }), item('A:20:1', '标签', [[40, 60]], { text: '64mg' }), item('A:30:1', '新', [[0, 9]])]
  assert.deepEqual([...changes.diffLayers(before, edited, new Set())].sort(), ['A:10:1', 'A:20:1', 'A:30:1'])
  /* 标过的跟着元素走到新位置 */
  assert.deepEqual([...changes.diffLayers(before, shifted, new Set(['A:20:1']))], ['A:23:1'])
})

import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

let server, graph, service, templates, Preview, renderToStaticMarkup
const values = new Map()
globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) }
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  graph = await server.ssrLoadModule('/src/services/workflowGraph.ts')
  templates = await server.ssrLoadModule('/src/data/workflowTemplates.ts')
  service = (await server.ssrLoadModule('/src/services/workflowService.ts')).workflowService
  Preview = (await server.ssrLoadModule('/src/components/WorkflowGraphPreview.tsx')).WorkflowGraphPreview
  renderToStaticMarkup = (await import('react-dom/server')).renderToStaticMarkup
})
after(async () => { await server?.close(); delete globalThis.localStorage })
const node = (id, type, text = '') => ({ id, type, position: { x: 0, y: 0 }, params: { text } })
const edge = (id, source, target, sourcePort = 'doc', targetPort = 'prompt') => ({ id, source, target, sourcePort, targetPort })

test('actual graph validation rejects empty, missing inputs and missing prompts before execution', () => {
  assert.match(graph.workflowGraphProblems([], [])[0].message, /没有节点/)
  assert.match(graph.workflowGraphProblems([node('p', 'prompt')], [])[0].message, /提示词/)
  assert.match(graph.workflowGraphProblems([node('c', 'create')], [])[0].message, /缺少/)
})
test('real preset graph validates after setting its actual prompt', () => {
  const g = templates.promptFirstGraph('general')
  g.nodes.find((n) => n.type === 'prompt').params.text = '测试创作要求'
  assert.deepEqual(graph.workflowGraphProblems(g.nodes, g.edges), [])
})
test('invalid port types, removed endpoints and multiple sources are rejected', () => {
  const nodes = [node('p', 'prompt', '内容'), node('q', 'prompt', '其他'), node('c', 'create')]
  assert.ok(graph.workflowGraphProblems(nodes, [edge('a', 'p', 'c', 'missing')]).some((p) => /失效/.test(p.message)))
  assert.ok(graph.workflowGraphProblems(nodes, [edge('a', 'gone', 'c')]).some((p) => /失效/.test(p.message)))
  assert.ok(graph.workflowGraphProblems(nodes, [edge('a', 'p', 'c'), edge('b', 'q', 'c')]).some((p) => /只能连接一个/.test(p.message)))
})
test('cycles and duplicate IDs cannot silently enter a run', () => {
  assert.match(graph.workflowGraphProblems([node('a', 'prompt', '内容'), node('a', 'create')], [])[0].message, /重复/)
  const nodes = [node('a', 'finishing'), node('b', 'finishing')]
  const edges = [edge('a', 'a', 'b', 'render', 'render'), edge('b', 'b', 'a', 'render', 'render')]
  assert.ok(graph.workflowGraphProblems(nodes, edges).some((p) => /循环/.test(p.message)))
})
test('actual artifact parser never presents demo JSON or unsafe URLs as real video', () => {
  assert.equal(graph.workflowArtifactMedia({ demo: true, content: '{"file":"https://example.com/a.mp4"}' }), null)
  assert.equal(graph.workflowArtifactMedia({ demo: false, content: 'broken' }), null)
  assert.equal(graph.workflowArtifactMedia({ demo: false, content: '{"file":"javascript:alert(1)"}' }), null)
  assert.equal(graph.workflowArtifactMedia({ demo: false, content: '{"file":"http://127.0.0.1:8080/a.mp4"}' }), 'http://127.0.0.1:8080/a.mp4')
})
test('empty creation, saved project association and copies use the actual store', () => {
  values.set('fm-workflows-v2', '[]')
  const wf = service.createEmpty('画布测试')
  assert.equal(wf.projectId, null)
  assert.deepEqual(wf.nodes, [])
  const saved = service.saveWorkflow(wf.id, { projectId: 'prj_test', nodes: [node('p', 'prompt', '要求')], edges: [] })
  assert.equal(saved.projectId, 'prj_test')
  assert.equal(saved.revision, 2)
  const copy = service.duplicateWorkflow(wf.id)
  assert.notEqual(copy.id, wf.id)
  copy.nodes[0].params.text = '新内容'
  assert.equal(service.getWorkflow(wf.id).nodes[0].params.text, '要求')
  service.deleteWorkflow(copy.id); service.deleteWorkflow(wf.id)
  assert.deepEqual(service.listWorkflows(), [])
})
test('preview renders real saved labels and connections without mounting React Flow', async () => {
  const { createElement } = await import('react')
  const g = templates.promptFirstGraph('general')
  const before = JSON.stringify(g)
  const markup = renderToStaticMarkup(createElement(Preview, g))
  assert.match(markup, /创作需求/)
  assert.match(markup, /wf-mini-edge/)
  assert.doesNotMatch(markup, /react-flow|<video|<iframe/)
  assert.equal(JSON.stringify(g), before)
})
test('structured preview resolves parent geometry without modifying lane nodes', async () => {
  const { createElement } = await import('react')
  const g = templates.structuredGraph()
  const before = JSON.stringify(g)
  const markup = renderToStaticMarkup(createElement(Preview, g))
  assert.doesNotMatch(markup, /NaN|undefined/)
  assert.equal(JSON.stringify(g), before)
})
test('layout is deterministic across repeated Strict Mode invocations and respects measured height', () => {
  const nodes = [{ id: 'a', height: 380 }, { id: 'b', height: 100 }, { id: 'c', height: 220 }]
  const before = JSON.stringify(nodes)
  const first = graph.workflowLayoutPositions(nodes, [{ source: 'a', target: 'c' }])
  assert.deepEqual(graph.workflowLayoutPositions(nodes, [{ source: 'a', target: 'c' }]), first)
  assert.equal(first.a.y, 0)
  assert.ok(first.b.y >= 444)
  assert.ok(first.c.x > first.a.x)
  assert.equal(JSON.stringify(nodes), before)
})
test('structured evaluation checks graph safety without requiring missing artifacts to exist', () => {
  const g = templates.structuredGraph()
  assert.deepEqual(graph.workflowGraphProblems(g.nodes, g.edges, { validateInputs: false }), [])
})
test('legacy generated lanes upgrade without moving custom layouts or mutating stored records', () => {
  const nodes = [
    { id: 'lane-0', type: 'lane', position: { x: 30, y: 30 }, height: 148, params: { stage: 0 } },
    { id: 'a', type: 'artifact', parentId: 'lane-0', position: { x: 24, y: 44 }, params: { kind: 'intent-brief' } },
  ]
  const before = JSON.stringify(nodes)
  assert.equal(graph.upgradeLegacyStructuredLayout(nodes)[0].height, 300)
  assert.equal(JSON.stringify(nodes), before)
  const custom = structuredClone(nodes); custom[0].position.x = 80
  assert.equal(graph.upgradeLegacyStructuredLayout(custom), custom)
  const movedChild = structuredClone(nodes); movedChild[1].position.y = 80
  assert.equal(graph.upgradeLegacyStructuredLayout(movedChild), movedChild)
})
test('failed persistent writes never report a successful creation or save', () => {
  const actual = globalThis.localStorage.setItem
  globalThis.localStorage.setItem = () => { throw new Error('quota exceeded') }
  try { assert.throws(() => service.createEmpty('不可保存'), /未能保存/) }
  finally { globalThis.localStorage.setItem = actual }
  assert.deepEqual(service.listWorkflows(), [])
})

test('run identity never projects another version, project, unsaved graph or legacy record', async () => {
  const { runMatchesDefinition } = await server.ssrLoadModule('/src/services/workflowPresentation.ts')
  const wf = { id: 'w', revision: 3, projectId: 'p' }
  const run = { workflowId: 'w', revision: 3, projectId: 'p' }
  assert.equal(runMatchesDefinition(run, wf, false), true)
  for (const other of [{ ...run, revision: 2 }, { ...run, projectId: 'q' }, { ...run, projectId: undefined }, { ...run, workflowId: 'another' }]) {
    assert.equal(runMatchesDefinition(other, wf, false), false)
  }
  assert.equal(runMatchesDefinition(run, wf, true), false)
  assert.equal(runMatchesDefinition(null, wf, false), false)
  assert.equal(runMatchesDefinition({ ...run, projectId: null }, { ...wf, projectId: null }, false), true)
})
test('legacy run labels do not invent demo status from missing video', async () => {
  const { workflowRunLabel } = await server.ssrLoadModule('/src/services/workflowPresentation.ts')
  assert.match(workflowRunLabel({ executionMode: 'project', artifacts: [] }), /项目运行/)
  assert.match(workflowRunLabel({ executionMode: 'demo', artifacts: [] }), /演示/)
  assert.match(workflowRunLabel({ artifacts: [] }), /类型未记录/)
  assert.match(workflowRunLabel({ artifacts: [{ demo: false }] }), /真实产物/)
})
test('card copy uses real prompt and project data, missing association is explicit', async () => {
  const { workflowBrief, workflowProjectLabel } = await server.ssrLoadModule('/src/services/workflowPresentation.ts')
  assert.equal(workflowBrief({ nodes: [{ type: 'prompt', params: { text: '产品广告\n蓝色画面' } }], description: 'old' }), '产品广告 蓝色画面')
  assert.equal(workflowBrief({ nodes: [], description: '' }), '')
  assert.equal(workflowProjectLabel('p', [{ id: 'p', name: '真实项目' }]), '真实项目')
  assert.match(workflowProjectLabel('missing', []), /不在当前列表/)
  assert.match(workflowProjectLabel('missing', [], false, true), /读取失败/)
  assert.match(workflowProjectLabel(null, []), /未关联/)
})
test('real demo executor persists immutable project, version, mode and node labels', async () => {
  const { startDemoRun } = await server.ssrLoadModule('/src/services/workflowService.ts')
  const wf = service.createFromPath('prompt-first', 'general', '运行归属验证')
  const prompt = wf.nodes.find((n) => n.type === 'prompt'); prompt.params.text = '演示需求'
  const handle = startDemoRun(wf, { onEvent() {}, onNodeStatus() {} })
  const run = await handle.done
  assert.equal(run.projectId, null)
  assert.equal(run.revision, wf.revision)
  assert.equal(run.executionMode, 'demo')
  assert.equal(run.nodeLabels[prompt.id], '创作需求')
  const stored = service.listRuns(wf.id)[0]
  assert.equal(stored.executionMode, 'demo')
  assert.equal(stored.projectId, null)
  assert.ok(stored.nodeStatus[prompt.id])
})

test('port executor follows connected prompts and stops downstream on failure', async () => {
  const { executeWorkflow }=await server.ssrLoadModule('/src/services/workflowExecution.ts')
  const wf=service.createFromPath('prompt-first','general','真实端口测试')
  wf.nodes.find(n=>n.type==='prompt').params.text='已连接的需求'
  wf.nodes.unshift({...node('unused','prompt','未连接的需求')})
  let got
  const result=await executeWorkflow(wf,{resourceReferences:()=>[],create:async(id,input)=>{got=input;return {state:'rendered',artifactPath:'x.mp4'}},saveIO:async()=>{},onStatus(){},cancelled:()=>false})
  assert.equal(result.status,'completed');assert.equal(got.intent,'已连接的需求')
  assert.equal(result.nodeIO['n-create']?.inputs.prompt,'已连接的需求')
  const statuses=[]
  const failed=await executeWorkflow(wf,{resourceReferences:()=>[],create:async()=>({state:'failed',reply:'服务不可达'}),saveIO:async()=>{},onStatus:(id,s)=>statuses.push([id,s]),cancelled:()=>false})
  assert.equal(failed.status,'failed');assert.ok(statuses.some(([id,s])=>id==='n-review'&&s==='skipped'))
})

import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

let server, graph, service, templates, Preview, renderToStaticMarkup
const values = new Map()
globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) }
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  graph = await server.ssrLoadModule('/src/features/workflow/services/workflowGraph.ts')
  templates = await server.ssrLoadModule('/src/features/workflow/model/workflowTemplates.ts')
  service = (await server.ssrLoadModule('/src/features/workflow/services/workflowService.ts')).workflowService
  Preview = (await server.ssrLoadModule('/src/features/workflow/components/WorkflowGraphPreview.tsx')).WorkflowGraphPreview
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
  const nodes = [node('a', 'delivery'), node('b', 'delivery')]
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
  const { runMatchesDefinition } = await server.ssrLoadModule('/src/features/workflow/services/workflowPresentation.ts')
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
  const { workflowRunLabel } = await server.ssrLoadModule('/src/features/workflow/services/workflowPresentation.ts')
  assert.match(workflowRunLabel({ executionMode: 'project', artifacts: [] }), /项目运行/)
  assert.match(workflowRunLabel({ executionMode: 'demo', artifacts: [] }), /演示/)
  assert.match(workflowRunLabel({ artifacts: [] }), /类型未记录/)
  assert.match(workflowRunLabel({ artifacts: [{ demo: false }] }), /真实产物/)
})
test('card copy uses real prompt and project data, missing association is explicit', async () => {
  const { workflowBrief, workflowProjectLabel } = await server.ssrLoadModule('/src/features/workflow/services/workflowPresentation.ts')
  assert.equal(workflowBrief({ nodes: [{ type: 'prompt', params: { text: '产品广告\n蓝色画面' } }], description: 'old' }), '产品广告 蓝色画面')
  assert.equal(workflowBrief({ nodes: [], description: '' }), '')
  assert.equal(workflowProjectLabel('p', [{ id: 'p', name: '真实项目' }]), '真实项目')
  assert.match(workflowProjectLabel('missing', []), /不在当前列表/)
  assert.match(workflowProjectLabel('missing', [], false, true), /读取失败/)
  assert.match(workflowProjectLabel(null, []), /未关联/)
})
test('real demo executor persists immutable project, version, mode and node labels', async () => {
  const { startDemoRun } = await server.ssrLoadModule('/src/features/workflow/services/workflowService.ts')
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
  const { executeWorkflow }=await server.ssrLoadModule('/src/features/workflow/services/workflowExecution.ts')
  const wf=service.createFromPath('prompt-first','general','真实端口测试')
  wf.nodes.find(n=>n.type==='prompt').params.text='已连接的需求'
  wf.nodes.unshift({...node('unused','prompt','未连接的需求')})
  let got
  const result=await executeWorkflow(wf,{resourceReferences:()=>[],create:async(id,input)=>{got=input;return {state:'rendered',version:1,artifactPath:'x.mp4'}},saveIO:async()=>{},onStatus(){},cancelled:()=>false})
  assert.equal(result.status,'awaiting_info');assert.equal(got.prompt,'已连接的需求')
  assert.equal(result.nodeIO['n-create']?.inputs.prompt,'已连接的需求')
  const statuses=[]
  const failed=await executeWorkflow(wf,{resourceReferences:()=>[],create:async()=>({state:'failed',reply:'服务不可达'}),saveIO:async()=>{},onStatus:(id,s)=>statuses.push([id,s]),cancelled:()=>false})
  assert.equal(failed.status,'failed');assert.ok(statuses.some(([id,s])=>id==='n-review'&&s==='skipped'))
})

test('F1 templates use prompt -> create -> review -> delivery and do not hardcode token on refs', () => {
  const g = templates.promptFirstGraph('general')
  assert.deepEqual(g.nodes.map((n) => n.type), ['prompt', 'create', 'review', 'delivery'])
  assert.equal(g.nodes.some((n) => ['lookdev', 'filmplan', 'finishing'].includes(n.type)), false)
  const talking = templates.promptFirstGraph('talking')
  assert.ok(talking.nodes.some((n) => n.type === 'refs'))
  assert.notEqual(templates.pfDefaultParams('refs').projectId, 'token')
  assert.equal(templates.pfDefaultParams('refs').projectId, '')
})

test('F2 pure migration removes lookdev/filmplan into legacyDrafts, converts finishing to delivery, and avoids IO on read', async () => {
  const { migrateWorkflowDefinition } = await server.ssrLoadModule('/src/features/workflow/services/workflowMigration.ts')
  const { executeWorkflow } = await server.ssrLoadModule('/src/features/workflow/services/workflowExecution.ts')
  const legacyWf = {
    id: 'wf-legacy-1',
    name: '旧工作流',
    description: '',
    path: 'prompt-first',
    presetId: 'general',
    projectId: null,
    revision: 4,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    nodes: [
      node('n-p', 'prompt', '原始提示词'),
      { id: 'n-look', type: 'lookdev', position: { x: 10, y: 10 }, params: { summary: '高对比胶片质感' } },
      { id: 'n-plan', type: 'filmplan', position: { x: 20, y: 20 }, params: { summary: '三幕推进' } },
      node('n-c', 'create'),
      node('n-r', 'review'),
      { id: 'n-fin-keep', type: 'finishing', position: { x: 500, y: 150 }, params: { notes: '保留打磨备注' } },
    ],
    edges: [
      edge('e1', 'n-p', 'n-look', 'doc', 'prompt'),
      edge('e2', 'n-look', 'n-c', 'doc', 'look'),
      edge('e3', 'n-plan', 'n-c', 'doc', 'plan'),
      edge('e4', 'n-p', 'n-c', 'doc', 'prompt'),
      edge('e5', 'n-c', 'n-r', 'render', 'render'),
      edge('e6', 'n-c', 'n-fin-keep', 'render', 'render'),
      edge('e7', 'n-r', 'n-fin-keep', 'notes', 'notes'),
    ],
  }
  const before = JSON.stringify(legacyWf)
  const migrated = migrateWorkflowDefinition(legacyWf)
  assert.equal(JSON.stringify(legacyWf), before)
  assert.equal(migrated.schemaVersion, 2)
  assert.deepEqual(migrated.legacyDrafts, { lookdev: '高对比胶片质感', filmplan: '三幕推进' })
  assert.equal(migrated.nodes.some((n) => n.type === 'lookdev' || n.type === 'filmplan' || n.type === 'finishing'), false)
  const deliveryNode = migrated.nodes.find((n) => n.id === 'n-fin-keep')
  assert.equal(deliveryNode?.type, 'delivery')
  assert.equal(deliveryNode?.params.notes, '保留打磨备注')
  assert.equal(migrated.edges.some((e) => e.source === 'n-look' || e.target === 'n-look' || e.source === 'n-plan'), false)
  assert.ok(migrated.edges.some((e) => e.source === 'n-c' && e.target === 'n-fin-keep' && e.targetPort === 'render'))
  assert.ok(migrated.edges.some((e) => e.source === 'n-r' && e.target === 'n-fin-keep' && e.targetPort === 'notes'))

  // 读存储只做内存迁移，不回写 localStorage，保存时才写回
  values.set('fm-workflows-v2', JSON.stringify([legacyWf]))
  const loaded = service.getWorkflow('wf-legacy-1')
  assert.equal(loaded.schemaVersion, 2)
  assert.equal(JSON.parse(values.get('fm-workflows-v2'))[0].schemaVersion, undefined)
  const saved = service.saveWorkflow('wf-legacy-1', { nodes: loaded.nodes, edges: loaded.edges })
  assert.equal(saved.schemaVersion, 2)
  assert.equal(JSON.parse(values.get('fm-workflows-v2'))[0].schemaVersion, 2)

  // 执行器不再接受未迁移的旧节点
  const rejected = await executeWorkflow(legacyWf, {
    resourceReferences: () => [],
    create: async () => ({ state: 'rendered' }),
    saveIO: async () => {},
    onStatus() {},
    cancelled: () => false,
  })
  assert.equal(rejected.status, 'failed')
  assert.match(rejected.error, /已停用/)
})

test('delivery node is deterministic and cycle rerun clears create/review/delivery and passes correction', async () => {
  const { executeWorkflow } = await server.ssrLoadModule('/src/features/workflow/services/workflowExecution.ts')
  const g = templates.promptFirstGraph('general')
  g.nodes.find((n) => n.type === 'prompt').params.text = '原生需求'

  // 1. 审片未通过 -> 停在等待审片通过
  const unreviewed = await executeWorkflow(g, {
    resourceReferences: () => [],
    create: async () => ({ state: 'rendered', version: 2, artifactPath: 'renders/v2.mp4' }),
    saveIO: async () => {},
    onStatus() {},
    cancelled: () => false,
  })
  assert.equal(unreviewed.status, 'awaiting_info')
  assert.equal(unreviewed.nodeIO['n-delivery'].outputs.delivered, false)
  assert.match(unreviewed.nodeIO['n-delivery'].outputs.reason, /等待审片通过/)

  // 2. 审片通过的是旧版本(v1 != v2) -> 仍停在等待审片通过
  const staleReview = structuredClone(g)
  staleReview.nodes.find((n) => n.type === 'review').params = {
    checks: { done: true, rework: false },
    reviewedVersion: 1,
    reviewedArtifactPath: 'renders/v1.mp4',
  }
  const staleRes = await executeWorkflow(staleReview, {
    resourceReferences: () => [],
    create: async () => ({ state: 'rendered', version: 2, artifactPath: 'renders/v2.mp4' }),
    saveIO: async () => {},
    onStatus() {},
    cancelled: () => false,
  })
  assert.equal(staleRes.status, 'awaiting_info')
  assert.match(staleRes.nodeIO['n-delivery'].outputs.reason, /旧版本/)

  // 3. 审片通过的就是最新渲染(v2) -> 交付成功输出这次渲染
  const okReview = structuredClone(g)
  okReview.nodes.find((n) => n.type === 'review').params = {
    checks: { done: true, rework: false },
    reviewedVersion: 2,
    reviewedArtifactPath: 'renders/v2.mp4',
  }
  const okRes = await executeWorkflow(okReview, {
    resourceReferences: () => [],
    create: async () => ({ state: 'rendered', version: 2, artifactPath: 'renders/v2.mp4' }),
    saveIO: async () => {},
    onStatus() {},
    cancelled: () => false,
  })
  assert.equal(okRes.status, 'completed')
  assert.equal(okRes.nodeIO['n-delivery'].outputs.delivered, true)
  assert.equal(okRes.nodeIO['n-delivery'].outputs.render.version, 2)

  // 4. 审片选需要修改 -> 清掉 create/review/delivery 旧结果，重跑制作循环并传入 correction
  const reworkWf = structuredClone(g)
  reworkWf.nodes.find((n) => n.type === 'review').params = {
    checks: { done: false, rework: true },
    issues: '片头字幕再放大一些',
  }
  let createCalls = 0
  let receivedInput = null
  const reworkRes = await executeWorkflow(reworkWf, {
    completedIO: {
      'n-prompt': { label: '创作需求', inputs: {}, outputs: { doc: '已保存的原始需求' } },
      'n-create': { label: '制作与渲染', inputs: { prompt: '已保存的原始需求' }, outputs: { render: { state: 'rendered', version: 1, artifactPath: 'v1.mp4' } } },
      'n-review': { label: '审片与修改', inputs: {}, outputs: { notes: { approved: false } } },
      'n-delivery': { label: '交付', inputs: {}, outputs: { delivered: false } },
    },
    resourceReferences: () => [],
    create: async (_id, input) => {
      createCalls += 1
      receivedInput = input
      return { state: 'rendered', version: 2, artifactPath: 'renders/v2.mp4' }
    },
    saveIO: async () => {},
    onStatus() {},
    cancelled: () => false,
  })
  assert.equal(createCalls, 1)
  assert.equal(receivedInput.prompt, '已保存的原始需求')
  assert.equal(receivedInput.correction, '片头字幕再放大一些')
  assert.equal(reworkRes.nodeIO['n-create'].outputs.render.version, 2)
  assert.equal(reworkRes.status, 'awaiting_info')
})

/* 按真实顺序：第一次运行渲染出 v2 后停在等待审片 → 用户审片通过 v2（保存使 revision 变化）→ 继续交付。
   create 一旦被再次调用就会走 HTTP 并失败，所以运行状态为 completed 即证明没有重新渲染。 */
async function awaitingDeliveryRun() {
  const mod = await server.ssrLoadModule('/src/features/workflow/services/workflowService.ts')
  const wf = mod.workflowService.createFromPath('prompt-first', 'general', '交付测试', { projectId: 'p-deliver', seedPrompt: '原始需求' })
  const id = (type) => wf.nodes.find((n) => n.type === type).id
  const render = { state: 'rendered', version: 2, artifactPath: 'renders/v2.mp4', runId: 'run-deliver' }
  const run = {
    id: 'run-deliver', workflowId: wf.id, workflowName: wf.name, revision: wf.revision, projectId: 'p-deliver',
    executionMode: 'project', nodeLabels: {}, definition: structuredClone(wf), nodeRequestIds: {},
    nodeIO: {
      [id('prompt')]: { label: '创作需求', inputs: {}, outputs: { doc: '原始需求' } },
      [id('create')]: { label: '制作与渲染', inputs: { prompt: '原始需求' }, outputs: { render } },
      [id('review')]: { label: '审片与修改', inputs: { render }, outputs: { notes: { render, approved: false, rework: false } } },
      [id('delivery')]: { label: '交付', inputs: {}, outputs: { render: null, delivered: false, status: 'awaiting_review', reason: '等待审片通过' } },
    },
    status: 'awaiting_info', task: { id: 'run-deliver', kind: 'modify', status: 'awaiting_info', mock: false, title: wf.name, createdAt: new Date().toISOString() },
    events: [], artifacts: [], changes: null, nodeStatus: {}, startedAt: new Date().toISOString(), finishedAt: null, demo: false,
  }
  const setReview = (params) => {
    const current = mod.workflowService.getWorkflow(wf.id)
    return mod.workflowService.saveWorkflow(wf.id, {
      nodes: current.nodes.map((n) => (n.type === 'review' ? { ...n, params: { ...n.params, ...params } } : n)),
      edges: current.edges,
    })
  }
  return { mod, wf, id, run, setReview }
}
const quiet = { onEvent() {}, onNodeStatus() {} }

test('continue delivery uses the latest saved review verdict and does not re-render', async () => {
  const { mod, wf, id, run, setReview } = await awaitingDeliveryRun()
  const saved = setReview({ checks: { done: true, rework: false }, reviewedVersion: 2, reviewedArtifactPath: 'renders/v2.mp4', reviewedRunId: 'run-deliver' })
  assert.notEqual(saved.revision, run.revision, '审片结论保存后 revision 会变，交付不能靠 revision 匹配')

  const finished = await mod.deliverProjectRun(run, mod.workflowService.getWorkflow(wf.id), quiet).done
  assert.equal(finished.status, 'completed', finished.events.map((e) => e.message).join(' / '))
  assert.equal(finished.nodeIO[id('delivery')].outputs.delivered, true)
  assert.equal(finished.nodeIO[id('delivery')].outputs.render.version, 2)
  assert.deepEqual(finished.nodeIO[id('create')], run.nodeIO[id('create')], 'create 结果保留，不重新渲染')
})

test('plain resume of an awaiting delivery is re-evaluated instead of reported as completed', async () => {
  const { mod, id, run } = await awaitingDeliveryRun()
  const finished = await mod.resumeProjectRun(run, quiet).done
  assert.equal(finished.status, 'awaiting_info')
  assert.equal(finished.nodeIO[id('delivery')].outputs.delivered, false)
})

test('continue delivery refuses rework verdicts and changed graph structure', async () => {
  const rework = await awaitingDeliveryRun()
  rework.setReview({ checks: { done: false, rework: true }, issues: '第三镜太快' })
  assert.throws(() => rework.mod.deliverProjectRun(rework.run, rework.mod.workflowService.getWorkflow(rework.wf.id), quiet), /需要修改/)

  const changed = await awaitingDeliveryRun()
  const current = changed.mod.workflowService.getWorkflow(changed.wf.id)
  changed.mod.workflowService.saveWorkflow(changed.wf.id, {
    nodes: [...current.nodes, { id: 'n-extra-refs', type: 'refs', position: { x: 0, y: 0 }, params: { projectId: '', assetIds: [], refSegmentIds: [] } }],
    edges: current.edges,
  })
  assert.throws(() => changed.mod.deliverProjectRun(changed.run, changed.mod.workflowService.getWorkflow(changed.wf.id), quiet), /结构/)

  const notWaiting = await awaitingDeliveryRun()
  assert.throws(() => notWaiting.mod.deliverProjectRun({ ...notWaiting.run, status: 'completed' }, notWaiting.wf, quiet), /等待审片通过/)
})

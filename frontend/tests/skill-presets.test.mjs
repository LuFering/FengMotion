import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

let server, apiMod, bindingMod, service, execMod, MappingEditor, renderToStaticMarkup
const values = new Map()
globalThis.localStorage = {
  getItem: (k) => values.get(k) ?? null,
  setItem: (k, v) => {
    values.set(k, String(v))
    Object.defineProperty(globalThis.localStorage, k, { value: String(v), configurable: true, enumerable: true })
  },
  removeItem: (k) => {
    values.delete(k)
    delete globalThis.localStorage[k]
  },
}

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  apiMod = await server.ssrLoadModule('/src/api/skillPresets.ts')
  bindingMod = await server.ssrLoadModule('/src/features/workflow/services/workflowPresetBinding.ts')
  service = (await server.ssrLoadModule('/src/features/workflow/services/workflowService.ts')).workflowService
  execMod = await server.ssrLoadModule('/src/features/workflow/services/workflowExecution.ts')
  MappingEditor = (await server.ssrLoadModule('/src/features/workflow/components/SkillPresetMappingEditor.tsx')).SkillPresetMappingEditor
  renderToStaticMarkup = (await import('react-dom/server')).renderToStaticMarkup
})

after(async () => {
  await server?.close()
  delete globalThis.localStorage
})

const samplePreset = (status = 'draft') => ({
  id: 'preset_logo_1',
  name: 'Logo 动画',
  description: '品牌 Logo 入场动画制作流程',
  status,
  skillPackageId: 'pkg_1',
  sourceRepo: 'boriwatopal/remotion-skills',
  skillPath: 'skills/logo-animation/SKILL.md',
  commitSha: '1234567890abcdef1234567890abcdef12345678',
  mappingVersion: 1,
  createdAt: '2026-11-18T00:00:00Z',
  updatedAt: '2026-11-18T00:00:00Z',
  activatedAt: status === 'active' ? '2026-11-18T01:00:00Z' : null,
  mapping: {
    name: 'Logo 动画',
    description: '品牌 Logo 入场动画',
    slug: 'logo-animation',
    promptScaffold: '品牌名：\nLogo 文件：\n主色调：\n时长与节奏：',
    defaults: { duration: '约 5 秒', ratio: '16:9' },
    requiredInputs: [
      { kind: 'asset', label: '品牌 Logo（SVG 优先）', required: true },
      { kind: 'text', label: '品牌色值说明', required: false },
    ],
    lookdevTemplate: '# 视觉方向\n突出标志轮廓光与金属质感',
    filmPlanTemplate: '# 导演处理\n0-1s 构图入场，1-4s 品牌定格',
    reviewChecklist: ['Logo 边缘是否清晰无锯齿', '品牌标准色是否准确'],
    guide: [
      {
        title: '入场动势',
        body: '使用弹簧曲线驱动缩放与位移',
        sources: ['skills/logo-animation/SKILL.md'],
      },
    ],
    components: [{ path: 'skills/logo-animation/LogoReveal.tsx', purpose: '基础 Logo 揭示组件' }],
    instructedCommands: [
      { command: 'npm run verify-svg', decision: 'replace-with-builtin', note: '用内置 SVG 检查替代' },
    ],
    stepMapping: [{ step: '导入 SVG 矢量标志', node: 'refs', note: '挂在素材节点' }],
    unmapped: [{ step: '发布到社交媒体尺寸变体', reason: '当前阶段仅输出单一画幅' }],
    truncatedSources: ['skills/logo-animation/EXTRA.md'],
  },
})

test('instructed command decisions never include auto-run', () => {
  const valuesOnly = apiMod.INSTRUCTED_COMMAND_DECISION_OPTIONS.map((o) => o.value)
  assert.deepEqual(valuesOnly, ['replace-with-builtin', 'manual-approval', 'ignore'])
  assert.equal(apiMod.INSTRUCTED_COMMAND_DECISION_OPTIONS.some((o) => /自动运行|auto/i.test(o.label + o.value)), false)
})

test('v2 actions and conditional inputs survive editor normalization, saving and workflow binding', async () => {
  const preset = samplePreset('active')
  const input = { kind: 'asset', label: '人物头像', required: false, requiredWhen: '人物排行模式' }
  const step = { step: '绘制按年份变化的排名', action: 'compose', node: 'create', note: '使用提供的数据集' }
  preset.mapping.requiredInputs = [input]
  preset.mapping.stepMapping = [step]
  preset.mapping.defaults = { duration: null, ratio: null }
  const normalized = apiMod.normalizePresetMapping(preset.mapping)
  assert.deepEqual(normalized.requiredInputs, [input])
  assert.deepEqual(normalized.stepMapping, [step])
  const graph = bindingMod.buildGraphFromSkillPreset({ ...preset, mapping: normalized })
  assert.deepEqual(graph.nodes.find(node => node.type === 'refs').params.requiredInputs, [input])
  let submitted
  const client = apiMod.createSkillPresetsResource({ put: async (_url, body) => { submitted = body; return preset } })
  await client.updatePresetMapping(preset.id, normalized)
  assert.deepEqual(submitted.stepMapping, [step])
  assert.deepEqual(submitted.requiredInputs, [input])
  assert.deepEqual(submitted.defaults, { duration: null, ratio: null })
})

test('skillPresets client routes and extracts 422 validation errors accurately', async () => {
  const { ApiError, parseErrorPayload } = await server.ssrLoadModule('/src/api/errors.ts')
  const parsed = parseErrorPayload(422, {
    error: {
      code: 'mapping_invalid',
      message: '映射校验失败',
      requestId: 'req_422',
      problems: [
        { field: 'components[0].path', message: '不存在于清单' },
        { field: 'instructedCommands', message: '缺少命令: npm test' },
      ],
    },
  })
  assert.equal(Array.isArray(parsed.details?.problems), true)
  assert.equal(parsed.details.problems.length, 2)

  const calls = []
  const fakeHttp = {
    get: async (url, opts) => { calls.push(['GET', url, opts]); return [samplePreset('active')] },
    post: async (url, body, opts) => {
      calls.push(['POST', url, body, opts])
      if (url.endsWith('/mappings')) {
        throw new ApiError({
          code: parsed.code,
          message: parsed.message,
          httpStatus: 422,
          details: parsed.details,
        })
      }
      return samplePreset('active')
    },
    put: async (url, body) => { calls.push(['PUT', url, body]); return samplePreset('draft') },
    del: async (url) => { calls.push(['DELETE', url]) },
  }
  const client = apiMod.createSkillPresetsResource(fakeHttp)

  const presets = await client.listPresets('active')
  assert.equal(presets.length, 1)
  assert.equal(calls[0][0], 'GET')
  assert.equal(calls[0][1], '/workflow-presets')

  await assert.rejects(
    () => client.generateMapping('pkg_1', 'skills/logo-animation/SKILL.md'),
    (err) => {
      const msgs = apiMod.extractPresetValidationErrors(err)
      assert.equal(msgs.length, 2)
      assert.match(msgs[0], /components\[0\]\.path/)
      return true
    },
  )

  await client.updatePresetMapping('preset_logo_1', samplePreset('draft').mapping)
  assert.equal(calls.at(-1)[0], 'PUT')
  assert.equal(calls.at(-1)[1], '/workflow-presets/preset_logo_1/mapping')

  await client.applyPresetToProject('prj_1', 'preset_logo_1')
  assert.equal(calls.at(-1)[0], 'POST')
  assert.equal(calls.at(-1)[1], '/projects/prj_1/workflow/preset')
  assert.deepEqual(calls.at(-1)[2], { presetId: 'preset_logo_1' })
})

test('F3 createFromSkillPreset keeps the scaffold as a hint only, and carries requiredInputs and reviewChecklist', async () => {
  values.set('fm-workflows-v2', '[]')
  const preset = samplePreset('active')
  const wf = service.createFromSkillPreset(preset, '我的 Logo 片')
  assert.equal(wf.skillPresetId, 'preset_logo_1')
  assert.equal(wf.skillPresetMeta?.name, 'Logo 动画')
  const promptNode = wf.nodes.find((n) => n.type === 'prompt')
  // 骨架只是填写提示：写进 text 会在首次运行时变成 prompt.original.md 里的「用户原文」
  assert.equal(promptNode.params.text, '')
  assert.match(promptNode.params.promptScaffold, /品牌名/)
  assert.equal(promptNode.params.duration, '约 5 秒')

  const seeded = service.createFromSkillPreset(preset, '带入首页输入', { seedPrompt: '给晨光咖啡做 Logo 动画' })
  assert.equal(seeded.nodes.find((n) => n.type === 'prompt').params.text, '给晨光咖啡做 Logo 动画', '只带入用户原话，不拼接骨架')
  const refsNode = wf.nodes.find((n) => n.type === 'refs')
  assert.ok(refsNode)
  assert.deepEqual(refsNode.params.requiredInputs, [
    { kind: 'asset', label: '品牌 Logo（SVG 优先）', required: true },
    { kind: 'text', label: '品牌色值说明', required: false },
  ])
  const reviewNode = wf.nodes.find((n) => n.type === 'review')
  assert.deepEqual(reviewNode.params.customChecklist, ['Logo 边缘是否清晰无锯齿', '品牌标准色是否准确'])

  promptNode.params.text = '品牌名：晨光咖啡\nLogo 文件：logo.svg\n主色调：琥珀\n时长与节奏：5 秒，前慢后快'
  const execRes = await execMod.executeWorkflow(wf, {
    resourceReferences: () => [],
    create: async () => ({ state: 'rendered', version: 1, artifactPath: 'v1.mp4' }),
    saveIO: async () => {},
    onStatus() {},
    cancelled: () => false,
  })
  assert.deepEqual(execRes.nodeIO['n-review'].outputs.notes.customChecklist, [
    'Logo 边缘是否清晰无锯齿',
    '品牌标准色是否准确',
  ])
})

test('F2 mapping editor shows unmapped/truncation info, enables editing in draft, and locks inputs when active', async () => {
  const { createElement } = await import('react')
  const draftMarkup = renderToStaticMarkup(
    createElement(MappingEditor, {
      preset: samplePreset('draft'),
      onUpdated() {},
      onArchived() {},
    }),
  )
  assert.match(draftMarkup, /启用为视频类型/)
  assert.match(draftMarkup, /保存草稿/)
  assert.match(draftMarkup, /发布到社交媒体尺寸变体/)
  assert.match(draftMarkup, /EXTRA\.md/)
  assert.doesNotMatch(draftMarkup, /<option[^>]*>[^<]*自动运行/)

  const activeMarkup = renderToStaticMarkup(
    createElement(MappingEditor, {
      preset: samplePreset('active'),
      onUpdated() {},
      onArchived() {},
    }),
  )
  assert.match(activeMarkup, /已启用 · 只读/)
  assert.match(activeMarkup, /<input[^>]*disabled=""/)
  assert.doesNotMatch(activeMarkup, /启用为视频类型/)
  assert.doesNotMatch(activeMarkup, /保存草稿/)
})

test('running with the untouched scaffold is rejected before any side effect', async () => {
  values.set('fm-workflows-v2', '[]')
  const wf = service.createFromSkillPreset(samplePreset('active'), '骨架未填')
  const promptNode = wf.nodes.find((n) => n.type === 'prompt')
  const { workflowGraphProblems } = await server.ssrLoadModule('/src/features/workflow/services/workflowGraph.ts')
  for (const text of [promptNode.params.promptScaffold, `  ${promptNode.params.promptScaffold.replace(/\n/g, '\n\n')}  `]) {
    promptNode.params.text = text
    assert.ok(workflowGraphProblems(wf.nodes, wf.edges).some((p) => /骨架/.test(p.message)), '骨架原样（含空白差异）不能运行')
  }
  let created = 0
  const res = await execMod.executeWorkflow(wf, { resourceReferences: () => [], create: async () => { created++; return {} }, saveIO: async () => {}, onStatus() {}, cancelled: () => false })
  assert.equal(res.status, 'failed')
  assert.equal(created, 0)

  promptNode.params.text = `${promptNode.params.promptScaffold}\n补充：结尾停留 1 秒`
  assert.equal(workflowGraphProblems(wf.nodes, wf.edges).some((p) => /骨架/.test(p.message)), false, '在骨架上填写过就可以运行')
})

test('F4 running workflow with skillPresetId calls applyPresetToProject before agent creation and stops on failure', async () => {
  const { installStudioHttpApi, createStudioApiClient, resetStudioHttpApi } = await server.ssrLoadModule('/src/api/index.ts')
  const { startDemoRun } = await server.ssrLoadModule('/src/features/workflow/services/workflowService.ts')
  values.set('fm-workflows-v2', '[]')
  const wf = service.createFromSkillPreset(samplePreset('active'), '落地验证')
  wf.projectId = 'prj_apply'
  wf.nodes.find((n) => n.type === 'prompt').params.text = '给晨光咖啡做 Logo 动画'

  const callOrder = []
  const client = createStudioApiClient({ config: { baseUrl: 'http://127.0.0.1:8080/api', mode: 'http' } })
  client.http.get = async (path) => {
    if (path.endsWith('/workflow')) return { initialized: true }
    if (path.includes('/creation-jobs/')) return { projectId: 'prj_apply', requestId: 'r', state: 'rendered', result: { state: 'rendered', version: 1, artifactPath: 'a.mp4', reply: 'ok', agentMs: 1, durationInFrames: 30, width: 1920, height: 1080, fps: 30 } }
    return []
  }
  client.http.put = async (_path, body) => ({ revision: 1, data: body.data })
  client.http.post = async (path, body) => {
    callOrder.push([path, body])
    if (path.endsWith('/workflow/preset')) {
      return {
        presetId: body.presetId,
        previousPresetId: null,
        guide: 'written',
        guideBackup: null,
        componentsCopied: 1,
        drafts: [{ name: 'lookdev-brief', action: 'written', reason: '模板原样，已写入预设' }],
        warnings: [],
      }
    }
    if (path.endsWith('/creation-jobs')) {
      return { projectId: 'prj_apply', requestId: body.requestId, sessionId: null, userMessageId: null, state: 'rendered', phase: 'completed', result: { state: 'rendered', version: 1, artifactPath: 'a.mp4', reply: 'done', agentMs: 10, durationInFrames: 30, width: 1920, height: 1080, fps: 30 }, error: null, createdAt: new Date().toISOString() }
    }
    return {}
  }
  installStudioHttpApi(client)
  try {
    const run1 = await startDemoRun(wf, { projectId: 'prj_apply', onEvent() {}, onNodeStatus() {} }).done
    assert.equal(run1.status, 'awaiting_info') // waiting for review approval
    const presetIdx = callOrder.findIndex(([p]) => p === '/projects/prj_apply/workflow/preset')
    const jobIdx = callOrder.findIndex(([p]) => p === '/projects/prj_apply/creation-jobs')
    assert.ok(presetIdx >= 0 && jobIdx > presetIdx)

    // Fail applyPresetToProject -> must fail before calling creation-jobs
    const calls2 = []
    client.http.post = async (path) => {
      calls2.push(path)
      if (path.endsWith('/workflow/preset')) throw new Error('预设落地失败')
      return {}
    }
    const run2 = await startDemoRun(wf, { projectId: 'prj_apply', onEvent() {}, onNodeStatus() {} }).done
    assert.equal(run2.status, 'failed')
    assert.equal(calls2.includes('/projects/prj_apply/creation-jobs'), false)
  } finally {
    resetStudioHttpApi()
  }
})

test('archived preset: run warns and continues, and tells whether the project already has the guide', async () => {
  const { installStudioHttpApi, createStudioApiClient, resetStudioHttpApi } = await server.ssrLoadModule('/src/api/index.ts')
  const { startDemoRun } = await server.ssrLoadModule('/src/features/workflow/services/workflowService.ts')
  const { ApiError } = await server.ssrLoadModule('/src/api/errors.ts')
  values.set('fm-workflows-v2', '[]')
  const wf = service.createFromSkillPreset(samplePreset('active'), '归档后运行')
  wf.projectId = 'prj_archived'
  wf.nodes.find((n) => n.type === 'prompt').params.text = '给晨光咖啡做 Logo 动画'

  const notActive = () => new ApiError({ code: 'conflict', message: '只有启用中的视频类型可以用到项目上', httpStatus: 409, details: { rawCode: 'preset_not_active' } })
  const rendered = { state: 'rendered', version: 1, artifactPath: 'a.mp4', reply: 'ok', agentMs: 1, durationInFrames: 30, width: 1920, height: 1080, fps: 30 }
  const runWith = async (record) => {
    const posts = []
    const client = createStudioApiClient({ config: { baseUrl: 'http://127.0.0.1:8080/api', mode: 'http' } })
    client.http.get = async (path) => {
      if (path.endsWith('/workflow/preset')) return { record }
      if (path.endsWith('/workflow')) return { initialized: true }
      if (path.includes('/creation-jobs/')) return { projectId: 'prj_archived', requestId: 'r', state: 'rendered', result: rendered }
      return []
    }
    client.http.put = async (_path, body) => ({ revision: 1, data: body.data })
    client.http.post = async (path, body) => {
      posts.push(path)
      if (path.endsWith('/workflow/preset')) throw notActive()
      if (path.endsWith('/creation-jobs')) return { projectId: 'prj_archived', requestId: body.requestId, sessionId: null, userMessageId: null, state: 'rendered', phase: 'completed', result: rendered, error: null, createdAt: new Date().toISOString() }
      return {}
    }
    installStudioHttpApi(client)
    try {
      const events = []
      const run = await startDemoRun(wf, { projectId: 'prj_archived', onEvent: (e) => events.push(e.message), onNodeStatus() {} }).done
      return { run, events, posts }
    } finally {
      resetStudioHttpApi()
    }
  }

  const applied = await runWith({ presetId: 'preset_logo_1', name: 'Logo 动画' })
  assert.equal(applied.run.status, 'awaiting_info', '归档不应让运行失败，停在等待审片')
  assert.ok(applied.posts.includes('/projects/prj_archived/creation-jobs'), '要继续制作')
  assert.ok(applied.events.some((m) => /已归档.*沿用项目里已有的 skill 指引/.test(m)), applied.events.join(' / '))

  const never = await runWith(null)
  assert.ok(never.posts.includes('/projects/prj_archived/creation-jobs'))
  assert.ok(never.events.some((m) => /已归档.*本次运行没有 skill 指引/.test(m)), never.events.join(' / '))
})

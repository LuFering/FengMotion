/*
 * 测试替身：假的后端客户端 + 浏览器全局对象 + 调用记录。
 *
 * 不替换任何模块：前端所有后端调用都经过 studioHttpApi()，
 * 用 installStudioHttpApi 注入这里的假客户端即可。
 */
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

/** 浏览器全局：localStorage / sessionStorage / window 的定时器与地址。 */
export function installBrowserGlobals() {
  const storage = () => {
    const m = new Map()
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) }, clear: () => m.clear() }
  }
  globalThis.localStorage = storage()
  globalThis.sessionStorage = storage()
  globalThis.window = {
    setInterval: (...a) => setInterval(...a),
    clearInterval: (id) => clearInterval(id),
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (id) => clearTimeout(id),
    location: { href: 'http://localhost/' },
  }
}

/** 起一个只做模块加载的 vite 服务。 */
export function startViteForModules() {
  return createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
}

/** 记录调用的替身函数：fn.calls 是每次调用的参数数组。 */
export function spy(impl = () => undefined) {
  const fn = (...args) => { fn.calls.push(args); return impl(...args) }
  fn.calls = []
  return fn
}

/** 只记录最后一次 setState 的值（函数式更新按当前值求值）。 */
export function stateSpy(initial) {
  const fn = spy((next) => { fn.value = typeof next === 'function' ? next(fn.value) : next })
  fn.value = initial
  return fn
}

/**
 * 假的后端客户端。overrides 按 `领域.方法` 覆盖默认行为。
 *
 * 默认：工程上下文已初始化、当前场景 v3、创作立即渲染完成并产出 v4。
 */
export function fakeStudio(overrides = {}) {
  const calls = []
  const call = (name, impl) => (...args) => { calls.push([name, ...args]); return impl(...args) }
  const pick = (name, fallback) => call(name, overrides[name] ?? fallback)
  const creationJob = (body, result) => ({
    projectId: body.projectId ?? 'p1', requestId: body.requestId, sessionId: body.sessionId ?? null,
    userMessageId: body.userMessageId ?? null, state: result.state === 'failed' ? 'failed' : result.state,
    phase: 'done', result: { ...result, requestId: body.requestId, userMessageId: body.userMessageId }, error: result.state === 'failed' ? result.reply : null, createdAt: '',
  })
  const creationResult = overrides.creationResult ?? { state: 'rendered', reply: '已按要求修改', version: 4, resources: [] }
  const client = {
    http: {
      post: pick('http.post', async (path, body) => {
        const projectId = decodeURIComponent(path.split('/projects/')[1]?.split('/')[0] ?? 'p1')
        return creationJob({ ...body, projectId }, creationResult)
      }),
      get: pick('http.get', async () => { throw new Error('没有这条任务') }),
    },
    workflowContext: {
      state: pick('workflowContext.state', async () => ({ initialized: true })),
      init: pick('workflowContext.init', async () => ({})),
      recordCorrection: pick('workflowContext.recordCorrection', async () => ({})),
      creation: pick('workflowContext.creation', async () => null),
      previewImageCapability: pick('workflowContext.previewImageCapability', async () => ({ supported: true, baseVersionCheck: true, atomicCorrection: true, correctionRetryId: true })),
    },
    task: {
      currentScene: pick('task.currentScene', async () => ({ initialized: true, version: 3 })),
    },
    chat: {
      listMessages: pick('chat.listMessages', async () => ({ items: [] })),
    },
  }
  return { client, calls, called: (name) => calls.filter((c) => c[0] === name) }
}

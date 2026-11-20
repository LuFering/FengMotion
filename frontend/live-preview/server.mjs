#!/usr/bin/env node
/**
 * 工程源码实时预览服务（契约：frontend/docs/contracts/live-preview.md）。
 *
 * 把项目的 Remotion 源码和预览壳（harness/）一起打包，在 127.0.0.1 上提供：
 *   /            预览页（工作台用 iframe 加载）
 *   /bundle.js   打包结果（只在内存里，不写项目目录）
 *   /public/...  项目 public/ 下的静态文件（staticFile() 指向这里，支持 Range）
 *   /events      SSE：源码改了 → reload；编译失败 → build-error
 *   /api/...     元素写死的属性读取、改一个值写回源码、撤销（只接受预览页自己发来、带令牌的请求）
 *
 * 依赖全部从 --node-modules 解析，与出片用同一份 Remotion / React。
 * 编译失败不退出，继续提供上一次成功的结果。标准输出第一行是就绪信号 JSON，之后只是日志。
 *
 * 用法：
 *   node server.mjs --project <dir> --entry src/index.tsx --composition <id> \
 *     --node-modules <dir> [--host 127.0.0.1] [--port 0]
 */
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, existsSync, statSync, watch } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import annotateSource from './annotate.mjs'
import { applyEdit, EditError, inspect } from './source-edit.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

function args() {
  const out = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key.startsWith('--')) out[key.slice(2)] = argv[i + 1]?.startsWith('--') ? 'true' : argv[++i]
  }
  return out
}

/** 就绪 / 失败信号只能是第一行，后端靠它判断；其余都走 stderr 日志 */
let signalled = false
function signal(payload) {
  if (signalled) return
  signalled = true
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}
function fail(code, message) {
  signal({ event: 'failed', code, message })
  process.exit(2)
}
const log = (...parts) => process.stderr.write(`[live-preview] ${parts.join(' ')}\n`)

const opts = args()
const projectRoot = path.resolve(opts.project ?? '')
const entryRel = opts.entry ?? 'src/index.tsx'
const entry = path.resolve(projectRoot, entryRel)
const compositionId = opts.composition ?? ''
const nodeModules = path.resolve(opts['node-modules'] ?? path.join(here, '..', 'node_modules'))
const host = opts.host ?? '127.0.0.1'
const port = Number(opts.port ?? 0)

if (!opts.project || !existsSync(projectRoot)) fail('entry_missing', `项目目录不存在：${projectRoot}`)
if (!existsSync(entry)) fail('entry_missing', `工程入口不存在：${entryRel}`)

const requireFrom = createRequire(path.join(nodeModules, 'noop.js'))
const need = ['esbuild', '@babel/core', '@babel/parser', 'remotion', '@remotion/player', 'react', 'react-dom']
for (const name of need) {
  try { requireFrom.resolve(name) } catch { fail('dependency_missing', `${nodeModules} 里缺少 ${name}`) }
}
const esbuild = requireFrom('esbuild')
const babel = requireFrom('@babel/core')
const parser = requireFrom('@babel/parser')

/* 写回源码的令牌：只嵌在预览页里；预览页之外拿不到它（不发跨域许可，见下面的 HTTP 部分） */
const token = randomBytes(16).toString('hex')

const publicDir = path.join(projectRoot, 'public')
const registryFile = path.join(here, 'harness', 'registry.ts')

/* ── 打包插件 ─────────────────────────────────────────────── */

/**
 * remotion 换成一层薄壳：registerRoot / Composition / Still / Folder 改成「登记」，
 * 由预览壳挑出要播放的那个 composition 交给 Player；其余导出原样透传（同一份实例）。
 */
const remotionShim = {
  name: 'fm-remotion-shim',
  setup(build) {
    build.onResolve({ filter: /^remotion$/ }, async (a) => {
      if (a.pluginData?.real) return undefined
      return { path: 'fm:remotion-shim', namespace: 'fm' }
    })
    build.onResolve({ filter: /^fm-real-remotion$/ }, async (a) => {
      const real = await build.resolve('remotion', { kind: 'import-statement', resolveDir: here, pluginData: { real: true } })
      return { path: real.path }
    })
    build.onResolve({ filter: /^fm-project-entry$/ }, () => ({ path: entry }))
    build.onLoad({ filter: /^fm:remotion-shim$/, namespace: 'fm' }, () => ({
      resolveDir: here,
      loader: 'tsx',
      contents: `
import React from 'react';
import { setRoot, registerComposition, unregisterComposition } from ${JSON.stringify(registryFile)};
export * from 'fm-real-remotion';
export const registerRoot = (component) => { setRoot(component); };
function Registered(props) {
  /* 每次渲染都登记一次（登记本身按内容去重，不会反复通知）；卸载时才注销 */
  React.useLayoutEffect(() => { registerComposition(props); });
  React.useLayoutEffect(() => () => unregisterComposition(props.id), [props.id]);
  return null;
}
export const Composition = (props) => React.createElement(Registered, props);
export const Still = (props) => React.createElement(Registered, { ...props, durationInFrames: 1, fps: props.fps ?? 30 });
export const Folder = ({ children }) => React.createElement(React.Fragment, null, children);
`,
    }))
  },
}

/** 项目自己的 JSX：标上源码位置（见 annotate.mjs）；node_modules 与预览壳不标 */
const annotate = {
  name: 'fm-annotate',
  setup(build) {
    build.onLoad({ filter: /\.(tsx|jsx)$/ }, async (a) => {
      const file = a.path
      if (!file.startsWith(`${projectRoot}${path.sep}`) || file.includes(`${path.sep}node_modules${path.sep}`)) return undefined
      const source = await readFile(file, 'utf8')
      const result = await babel.transformAsync(source, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceType: 'module',
        parserOpts: { plugins: ['jsx', 'typescript'] },
        plugins: [[annotateSource, { root: projectRoot }]],
        /* 行号保持原样：编译错误和运行时报错里的行号仍对得上源码 */
        generatorOpts: { retainLines: true },
      })
      return { contents: result?.code ?? source, loader: file.endsWith('.tsx') ? 'tsx' : 'jsx', resolveDir: path.dirname(file) }
    })
  },
}

/* ── 构建结果与推送 ───────────────────────────────────────── */

let outputs = new Map()
let buildVersion = 0
let lastError = null
const clients = new Set()
function broadcast(type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) res.write(line)
}

let firstBuild
const firstBuildDone = new Promise((resolve) => { firstBuild = resolve })

const report = {
  name: 'fm-report',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        const message = result.errors.slice(0, 5).map((e) => {
          const at = e.location ? `${path.relative(projectRoot, e.location.file)}:${e.location.line}:${e.location.column + 1}  ` : ''
          return `${at}${e.text}`
        }).join('\n')
        lastError = message
        log('编译失败', message.split('\n')[0])
        broadcast('build-error', { message })
      } else {
        const next = new Map()
        for (const file of result.outputFiles ?? []) {
          next.set(`/${path.relative('/out', file.path).replace(/\\/g, '/')}`, file.contents)
        }
        outputs = next
        lastError = null
        buildVersion += 1
        if (buildVersion > 1) broadcast('reload', { version: buildVersion })
      }
      firstBuild()
    })
  },
}

const ctx = await esbuild.context({
  entryPoints: { bundle: path.join(here, 'harness', 'entry.tsx') },
  bundle: true,
  write: false,
  outdir: '/out',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: 'linked',
  nodePaths: [nodeModules],
  define: { 'process.env.NODE_ENV': '"development"', __FM_COMPOSITION__: JSON.stringify(compositionId) },
  loader: Object.fromEntries(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.woff', '.woff2', '.ttf', '.otf',
    '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.mov'].map((ext) => [ext, 'file'])),
  assetNames: 'assets/[name]-[hash]',
  publicPath: '/',
  logLevel: 'silent',
  plugins: [remotionShim, annotate, report],
})
await ctx.watch()
await firstBuildDone

/* public/ 不在打包图里：文件换了也要让预览刷新 */
if (existsSync(publicDir)) {
  let timer
  try {
    watch(publicDir, { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(() => broadcast('reload', { version: buildVersion, reason: 'public' }), 150)
    })
  } catch { /* 有的平台不支持递归监听：静态文件变化要手动刷新 */ }
}

/* ── HTTP ─────────────────────────────────────────────────── */

const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
}
const typeOf = (p) => TYPES[path.extname(p).toLowerCase()] ?? 'application/octet-stream'

function page() {
  const css = outputs.has('/bundle.css') ? `<link rel="stylesheet" href="/bundle.css?v=${buildVersion}">` : ''
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>FengMotion 实时预览</title>
<meta name="viewport" content="width=device-width,initial-scale=1">${css}
<script>window.remotion_staticBase = '/public'; window.__fmToken = ${JSON.stringify(token)};</script>
<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style>
</head><body><div id="root"></div>
<script type="module" src="/bundle.js?v=${buildVersion}"></script></body></html>`
}

function servePublic(req, res, rel) {
  const file = path.resolve(publicDir, rel)
  if (!file.startsWith(`${publicDir}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end(); return
  }
  const size = statSync(file).size
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return }
    res.writeHead(206, { 'Content-Type': typeOf(file), 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' })
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Type': typeOf(file), 'Content-Length': size, 'Accept-Ranges': 'bytes' })
  createReadStream(file).pipe(res)
}

/* ── 写回源码 ─────────────────────────────────────────────── */

const sha1 = (text) => createHash('sha1').update(text).digest('hex').slice(0, 16)

/** src 形如 src/Coffee.tsx:171:6；文件必须在项目目录里 */
function parseSrc(src) {
  const m = /^(.+):(\d+):(\d+)$/.exec(String(src ?? ''))
  if (!m) throw new EditError('invalid_src', '源码位置格式不对')
  const file = path.resolve(projectRoot, m[1])
  if (!file.startsWith(`${projectRoot}${path.sep}`) || file.includes(`${path.sep}node_modules${path.sep}`)) throw new EditError('invalid_src', '只能改项目自己的源码')
  return { file, rel: m[1], line: Number(m[2]), column: Number(m[3]) }
}

/** 撤销栈：每条记下改之前和改之后的整份文件；撤销时文件必须还是「改之后」的样子 */
const undoStack = []
const UNDO_LIMIT = 100

async function writeAtomic(file, content) {
  const tmp = `${file}.fm-tmp-${process.pid}`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

/* 写回与撤销排队执行：两个请求同时读到旧文件再各写一遍，会让撤销栈记错 */
let queue = Promise.resolve()
function serial(task) {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

async function api(route, body) {
  if (route === 'edit' || route === 'undo') return serial(() => apiNow(route, body))
  return apiNow(route, body)
}

async function apiNow(route, body) {
  if (route === 'state') return { edits: undoStack.length }
  if (route === 'inspect') {
    const out = {}
    const files = new Map()
    for (const src of Array.isArray(body.srcs) ? body.srcs.slice(0, 40) : []) {
      try {
        const at = parseSrc(src)
        if (!files.has(at.file)) files.set(at.file, existsSync(at.file) ? await readFile(at.file, 'utf8') : null)
        const code = files.get(at.file)
        if (code == null) { out[src] = null; continue }
        const info = inspect(parser, code, at.line, at.column)
        out[src] = info && { ...info, file: at.rel, fileHash: sha1(code) }
      } catch { out[src] = null }
    }
    return { elements: out }
  }
  if (route === 'edit') {
    const at = parseSrc(body.src)
    const before = await readFile(at.file, 'utf8')
    if (body.fileHash && body.fileHash !== sha1(before)) throw new EditError('source_changed', '源码已经变化，请重新读取')
    const after = applyEdit(parser, before, { line: at.line, column: at.column, path: body.path, value: body.value, expect: body.expect ?? null, expectCode: body.expectCode ?? null })
    if (after === before) return { edits: undoStack.length, fileHash: sha1(before), changed: false }
    await writeAtomic(at.file, after)
    undoStack.push({ file: at.file, before, after, src: body.src })
    if (undoStack.length > UNDO_LIMIT) undoStack.shift()
    log('写回', `${at.rel}:${at.line}`, JSON.stringify(body.path))
    return { edits: undoStack.length, fileHash: sha1(after), changed: true }
  }
  if (route === 'undo') {
    const last = undoStack[undoStack.length - 1]
    if (!last) throw new EditError('nothing_to_undo', '没有可以撤销的修改')
    const current = await readFile(last.file, 'utf8')
    if (current !== last.after) { undoStack.length = 0; throw new EditError('source_changed', '源码在这之后被别处改过，不能再撤销') }
    await writeAtomic(last.file, last.before)
    undoStack.pop()
    log('撤销', path.relative(projectRoot, last.file))
    return { edits: undoStack.length, src: last.src }
  }
  throw new EditError('not_found', '没有这个接口')
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 256 * 1024) { reject(new EditError('too_large', '请求太大')); req.destroy() } })
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { reject(new EditError('invalid_json', '请求格式不对')) } })
    req.on('error', reject)
  })
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = decodeURIComponent(url.pathname)
  /* 不发任何跨域许可：预览页、打包结果、静态文件都只给 iframe 里这个同源页面用。
     别的网页即使能嵌入预览页，也读不到页面内容，拿不到写回令牌。 */
  res.setHeader('Cache-Control', 'no-store')
  if (pathname.startsWith('/api/')) {
    const ownOrigin = `http://${req.headers.host}`
    if (req.method !== 'POST' || req.headers['x-fm-token'] !== token || (req.headers.origin && req.headers.origin !== ownOrigin)) {
      res.writeHead(403, { 'Content-Type': TYPES['.json'] }).end(JSON.stringify({ error: { code: 'forbidden', message: '只接受预览页自己的请求' } }))
      return
    }
    readJson(req).then((body) => api(pathname.slice('/api/'.length), body)).then((result) => {
      res.writeHead(200, { 'Content-Type': TYPES['.json'] }).end(JSON.stringify(result))
    }).catch((error) => {
      const known = error instanceof EditError
      const status = !known ? 500 : error.code === 'source_changed' ? 409 : error.code === 'not_found' || error.code === 'element_not_found' ? 404 : 422
      res.writeHead(status, { 'Content-Type': TYPES['.json'] }).end(JSON.stringify({ error: { code: known ? error.code : 'internal', message: error.message } }))
    })
    return
  }
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': TYPES['.html'] }).end(page()); return
  }
  if (pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
    res.write(`event: hello\ndata: ${JSON.stringify({ version: buildVersion, error: lastError })}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (pathname.startsWith('/public/')) { servePublic(req, res, pathname.slice('/public/'.length)); return }
  const body = outputs.get(pathname)
  if (body) { res.writeHead(200, { 'Content-Type': typeOf(pathname), 'Content-Length': body.byteLength }).end(Buffer.from(body)); return }
  res.writeHead(404).end()
})

server.on('error', (error) => fail('listen_failed', error.message))
server.listen(port, host, () => {
  const address = server.address()
  const url = `http://${host}:${typeof address === 'object' && address ? address.port : port}/`
  signal({ event: 'ready', url, pid: process.pid })
  log('就绪', url, lastError ? '（当前有编译错误）' : '')
})

/* SSE 保活：有的代理会掐掉长时间无数据的连接 */
setInterval(() => { for (const res of clients) res.write(': ping\n\n') }, 25_000).unref()

const stop = async () => { try { await ctx.dispose() } catch { /* 退出时不管 */ } process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

/* 启动我的进程没了就跟着退出：Windows 上后端被强制结束时收不到 SIGTERM，
   不看父进程的话，预览进程（连同 esbuild 和文件监听）会一直留在后台 */
const parentPid = process.ppid
setInterval(() => {
  let gone = process.ppid !== parentPid
  if (!gone) { try { process.kill(parentPid, 0) } catch (error) { gone = error?.code === 'ESRCH' } }
  if (gone) { log('启动进程已退出，预览服务随之停止'); void stop() }
}, 5_000).unref()

/**
 * 渲染共用模块。
 *
 * <p>统一工程（内置 {@code Film} 组件 + scenes props）与项目工程（agent 写的
 * Remotion 源码）除了「入口在哪、composition 叫什么」之外，其余步骤完全一样：
 * 找依赖、把工程复制到可写目录、打包、选 composition、渲染、按固定协议输出。
 * 这些踩过的坑（只读挂载、浏览器下载、stdout 只留结果）不该有两份实现，
 * 否则下次只修一边就会出现「统一工程能渲、项目工程不能渲」。</p>
 *
 * <p>所以这里只管共用流程，两个入口脚本各自决定 sourceRoot 与 compositionId。</p>
 */

import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * 递归复制目录。
 *
 * <p>不用 fs.promises.cp：部分 Node 版本对只读源目录行为不一致，
 * 而这里正好要处理「源可能只读」（AppImage 挂载点）的情形。</p>
 *
 * @param from 源目录
 * @param to 目标目录
 */
export async function cpDir(from, to) {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    if (entry.isDirectory()) await cpDir(src, dest)
    else await copyFile(src, dest)
  }
}

/**
 * 解析依赖所在目录。
 *
 * <p>顺序：环境变量 → {@code <repo>/desktop/node_modules} → {@code <repo>/node_modules}。
 * 逐个验证存在性：写死一条路径时目录改名会得到「Cannot find module」，
 * 而不是一句说清方向的错误。</p>
 *
 * @param helperDir 调用方脚本所在目录（用于推断仓库根）
 * @returns node_modules 绝对路径
 * @throws Error 都找不到
 */
export function resolveNodeModules(helperDir) {
  const fromEnv = process.env.FENGMOTION_NODE_MODULES?.trim()
  if (fromEnv) return fromEnv

  const repoRoot = path.resolve(helperDir, '..', '..')
  const candidates = [
    path.join(repoRoot, 'desktop', 'node_modules'),
    path.join(repoRoot, 'node_modules'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `找不到 node_modules，已尝试：${candidates.join('、')}。`
    + '请先在 desktop/ 下安装依赖，或设置 FENGMOTION_NODE_MODULES。',
  )
}

/**
 * 从指定 node_modules 里加载一个包。
 *
 * <p>用 createRequire 而不是普通 import：渲染脚本自身没有 node_modules，
 * 普通 import 解析不到。</p>
 *
 * @param nodeModules 依赖目录
 * @param specifier 包名
 * @returns 模块命名空间
 */
export async function loadFrom(nodeModules, specifier) {
  const requireFrom = createRequire(path.join(nodeModules, 'noop.js'))
  const resolved = requireFrom.resolve(specifier)
  return import(pathToFileUrl(resolved))
}

/**
 * 文件路径转 file:// URL（兼容 Windows）。
 *
 * @param p 路径
 * @returns URL
 */
export function pathToFileUrl(p) {
  return new URL(`file://${p.startsWith('/') ? '' : '/'}${p.replace(/\\/g, '/')}`).href
}

/**
 * 解析命令行参数。
 *
 * @param argv process.argv.slice(2)
 * @returns 参数表
 */
export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!key?.startsWith('--')) continue
    out[key.slice(2)] = argv[i + 1]
  }
  return out
}

/**
 * 把工程复制到一个可写的临时目录。
 *
 * <p><strong>为什么必须复制</strong>：打包成 AppImage 后工程位于只读挂载点，
 * 而 Remotion / webpack 会往工程目录写 {@code node_modules/.cache} 与
 * {@code .remotion}。只读下报 EROFS/EACCES，最终表现为「输出不是合法 JSON」，
 * 真正原因埋在 stderr 里。复制几十 KB 源码远比逐个关缓存开关可靠。</p>
 *
 * @param sourceDir 源工程目录（含 entryPoint 的相对根）
 * @returns 临时工作目录
 */
export async function stageWritableCopy(sourceDir) {
  const workDir = path.join(os.tmpdir(), `fengmotion-render-${process.pid}-${Date.now()}`)
  await mkdir(workDir, { recursive: true })
  await cpDir(sourceDir, workDir)
  return workDir
}

/**
 * 清理临时目录。
 *
 * @param workDir 目录
 */
export async function cleanup(workDir) {
  if (!workDir) return
  await rm(workDir, { recursive: true, force: true })
}

/**
 * 按固定协议往 stdout 写结果。
 *
 * <p>stdout 只放这一行 JSON：后端按它判断成败。日志一律走 stderr，
 * 混进来会让解析失败并掩盖真正原因。</p>
 *
 * @param payload 结果对象
 */
export function emitResult(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n')
}

/**
 * 渲染一个 composition 并输出结果。
 *
 * @param options.nodeModules 依赖目录
 * @param options.workDir 可写工作目录（已 chdir 之前调用）
 * @param options.entryPoint 打包入口（绝对路径）
 * @param options.compositionId composition ID
 * @param options.props 输入 props
 * @param options.out 输出文件
 * @param options.browser 浏览器可执行文件路径，可为 null
 * @returns 渲染结果摘要
 */
export async function renderProject(options) {
  const { bundle } = await loadFrom(options.nodeModules, '@remotion/bundler')
  const { renderMedia, selectComposition } = await loadFrom(options.nodeModules, '@remotion/renderer')

  /* chdir 到可写目录：Remotion 把 .remotion（Chrome 下载）与 .cache（webpack）
     写到「当前工作目录」，只读镜像下直接 EACCES。仅复制源码不够。

     浏览器本身不在这里下载：实测 Remotion 把它放在用户缓存目录
     （~/.cache/google-chrome-headless），跨次渲染复用 ——
     安装态实测首次 140 秒（含下载），第二次 33 秒。
     所以这里不需要额外指定缓存路径；早期尝试用 REMOTION_BROWSER_CACHE
     并不生效，已移除，避免留下一个看起来在起作用的假配置。 */
  process.chdir(options.workDir)

  const serveUrl = await bundle({ entryPoint: options.entryPoint })

  /* browserExecutable 必须同时给 selectComposition：
     只给 renderMedia 的话，selectComposition 会先去找 Chrome Headless Shell，
     找不到就下载 90MB —— 用户首次渲染会平白等一次大文件下载。 */
  const browserExecutable = options.browser || null

  const composition = await selectComposition({
    serveUrl,
    id: options.compositionId,
    inputProps: options.props,
    browserExecutable,
  })

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: options.out,
    inputProps: options.props,
    browserExecutable,
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100)
      if (pct % 25 === 0) process.stderr.write(`progress ${pct}%\n`)
    },
  })

  return {
    durationInFrames: composition.durationInFrames,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
  }
}

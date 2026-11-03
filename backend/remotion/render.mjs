/**
 * Remotion 渲染脚本（统一工程）。
 *
 * <p>由后端以子进程方式调用：`node render.mjs --props <文件> --out <文件>`。
 * 输出固定的 JSON 到 stdout，供后端解析结果。</p>
 *
 * <p><strong>依赖从哪来</strong>：不在这里单独 npm install —— Remotion 全家桶
 * 有几百 MB，再装一份纯属浪费。默认复用桌面端已安装的 node_modules
 * （`FENGMOTION_NODE_MODULES` 可覆盖），这也是「统一工程」的一部分：
 * 一份依赖，多处使用。</p>
 *
 * 用法：
 *   node render.mjs --props /tmp/film.json --out /tmp/out.mp4 [--browser /path/to/chrome]
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * 解析依赖所在目录。
 *
 * @returns node_modules 的绝对路径
 */
function resolveNodeModules() {
  const fromEnv = process.env.FENGMOTION_NODE_MODULES?.trim()
  if (fromEnv) return fromEnv
  // 默认：桌面端仓库的 node_modules（与本工程同处一个代码库）
  return path.resolve(import.meta.dirname, '..', '..', 'FengMotion-desktop', 'node_modules')
}

/**
 * 从指定 node_modules 里加载一个包。
 *
 * <p>用 createRequire 而不是普通 import：本工程没有自己的 node_modules，
 * 普通 import 会解析失败。</p>
 *
 * @param nodeModules 依赖目录
 * @param specifier 包名
 * @returns 模块命名空间
 */
async function loadFrom(nodeModules, specifier) {
  const requireFrom = createRequire(path.join(nodeModules, 'noop.js'))
  const resolved = requireFrom.resolve(specifier)
  return import(pathToFileUrl(resolved))
}

/** 把文件路径转成 file:// URL（Windows 路径也能正确处理）。 */
function pathToFileUrl(p) {
  return new URL(`file://${p.startsWith('/') ? '' : '/'}${p.replace(/\\/g, '/')}`).href
}

/**
 * 解析命令行参数。
 *
 * @param argv process.argv.slice(2)
 * @returns 参数表
 */
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!key?.startsWith('--')) continue
    out[key.slice(2)] = argv[i + 1]
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.props || !args.out) {
    console.error(JSON.stringify({ ok: false, error: '缺少 --props 或 --out' }))
    process.exit(2)
  }

  const nodeModules = resolveNodeModules()
  const { bundle } = await loadFrom(nodeModules, '@remotion/bundler')
  const { renderMedia, selectComposition } = await loadFrom(nodeModules, '@remotion/renderer')

  const props = JSON.parse(await readFile(args.props, 'utf8'))

  // 打包含 TSX 的工程：Remotion 自己用 esbuild 编译，不需要预先构建
  const serveUrl = await bundle({
    entryPoint: path.join(import.meta.dirname, 'src', 'index.tsx'),
  })

  const composition = await selectComposition({
    serveUrl,
    id: 'Film',
    inputProps: props,
  })

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: args.out,
    inputProps: props,
    // 显式指定浏览器：默认会去找 Chrome Headless Shell，没装就现下载 90MB。
    // 后端调用时会把系统 Chrome 路径传进来。
    browserExecutable: args.browser || null,
    // 日志交给 stderr，stdout 只留结果，方便后端解析
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 25 === 0) {
        process.stderr.write(`progress ${Math.round(progress * 100)}%\n`)
      }
    },
  })

  process.stdout.write(JSON.stringify({
    ok: true,
    output: args.out,
    durationInFrames: composition.durationInFrames,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
  }) + '\n')
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: error?.message ?? String(error) }) + '\n')
  process.exit(1)
})

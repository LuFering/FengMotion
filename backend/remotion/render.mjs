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

import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * 递归复制目录。
 *
 * <p>用它而不是 fs.promises.cp：后者在部分 Node 版本对只读源目录的行为不一致，
 * 而这里正好要处理「源可能只读」的情形，自己实现更好控制。</p>
 *
 * @param from 源目录
 * @param to 目标目录
 */
async function cpDir(from, to) {
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
 * <p>单仓两目录布局：本工程在 {@code backend/remotion/}，依赖装在
 * {@code desktop/node_modules}。这里按「先猜后验」的顺序找：</p>
 * <ol>
 *   <li>环境变量 {@code FENGMOTION_NODE_MODULES}（打包态由后端注入）</li>
 *   <li>{@code <repo>/desktop/node_modules} —— 单仓布局</li>
 *   <li>{@code <repo>/node_modules} —— 依赖装在仓库根的旧布局</li>
 * </ol>
 *
 * <p>必须逐个验证存在性：写死一条路径时，目录改名就会得到一个
 * 「Cannot find module」而不是一句说清方向的错误。</p>
 *
 * @returns node_modules 的绝对路径
 * @throws Error 三处都找不到
 */
function resolveNodeModules() {
  const fromEnv = process.env.FENGMOTION_NODE_MODULES?.trim()
  if (fromEnv) return fromEnv

  const repoRoot = path.resolve(import.meta.dirname, '..', '..')
  const candidates = [
    path.join(repoRoot, 'desktop', 'node_modules'),
    path.join(repoRoot, 'node_modules'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `找不到 node_modules，已尝试：${candidates.join('、')}。` +
    '请先在 desktop/ 下安装依赖，或设置 FENGMOTION_NODE_MODULES。',
  )
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
  /* 工程目录必须是可写的。
     打包成 AppImage 后，工程位于只读挂载点（/tmp/.mount_xxx/resources/remotion）。
     Remotion 与 webpack 会往工程目录里写两类东西，且都不是我们能忽略的：
       · node_modules/.cache —— webpack 缓存
       · .remotion / .cache   —— Chrome Headless Shell 下载与 bundler 产物
     实测只读下报 EROFS / EACCES，最终表现为「渲染脚本输出不是合法 JSON」，
     真正原因埋在 stderr 里。
     与其逐个猜 Remotion 的缓存开关，不如把工程整体复制到可写临时目录再跑 ——
     源码只有几十 KB，复制成本可忽略，且不怕它以后再加新的写盘点。 */
  const workDir = path.join(os.tmpdir(), `fengmotion-render-${process.pid}-${Date.now()}`)
  await mkdir(workDir, { recursive: true })
  await cpDir(path.join(import.meta.dirname, 'src'), path.join(workDir, 'src'), { recursive: true })
  /* 切到可写目录再渲染：Remotion 会把 .remotion（Chrome 下载）与
     .cache（webpack）写到「当前工作目录」，只读镜像下直接 EACCES。
     仅复制源码不够，必须连 cwd 一起换掉。 */
  process.chdir(workDir)

  const serveUrl = await bundle({
    entryPoint: path.join(workDir, 'src', 'index.tsx'),
  })

  /* browserExecutable 必须同时给 selectComposition：
     只给 renderMedia 的话，selectComposition 会先去找 Chrome Headless Shell，
     找不到就下载 90MB —— 用户首次渲染会平白等一次大文件下载。
     后端会传 --browser（系统 Chrome），这里两处都用上。 */
  const browserExecutable = args.browser || null

  const composition = await selectComposition({
    serveUrl,
    id: 'Film',
    inputProps: props,
    browserExecutable,
  })

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: args.out,
    inputProps: props,
    // 显式指定浏览器：默认会去找 Chrome Headless Shell，没装就现下载 90MB。
    // 后端调用时会把系统 Chrome 路径传进来。
    browserExecutable,
    // 日志交给 stderr，stdout 只留结果，方便后端解析
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 25 === 0) {
        process.stderr.write(`progress ${Math.round(progress * 100)}%\n`)
      }
    },
  })

  // 临时工程复制用完即删：每次渲染都会复制一份，不清理会堆积在 /tmp
  await rm(workDir, { recursive: true, force: true })

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

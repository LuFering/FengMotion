/**
 * 桌面壳编译脚本（只编译 electron/ 下的两个入口，不碰 src/ 与产品构建）。
 *
 * 为什么不合并进 `npm run build`：产品构建（tsc -b && vite build）是浏览器壳的产物，
 * 加壳是可选形态。两者分开，加壳失败不会拖垮前端构建，也符合「一次只改一件事」。
 *
 * 为什么两种都是 CJS：
 *   · main → CJS（.cjs）。Electron 的 electron 模块是纯 CJS 导出；ESM 主进程里
 *     命名导入报错、默认导入得到空对象（已实测），只有 CJS 能拿到完整 API。
 *   · preload → CJS（.cjs）。Electron 的 ESM preload 要求 .mjs 且与 sandbox 相互牵制；
 *     preload 只有两个 IPC 转发，CJS 最省事。
 *
 * 用法：
 *   node scripts/build-electron.mjs          # 编译
 *   node scripts/build-electron.mjs --watch  # 暂不实现，先保持简单
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, renameSync, existsSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const outDir = path.join(repoRoot, 'electron', 'build')
const tsc = path.join(repoRoot, 'node_modules', '.bin', 'tsc')

/** tsc 的公共参数。--ignoreConfig 是 TS6 的要求：命令行给了文件就不加载 tsconfig。 */
const commonArgs = [
  '--ignoreConfig',
  '--target', 'es2023',
  '--skipLibCheck',
  '--types', 'node',
  '--strict',
  '--sourceMap',
  '--ignoreDeprecations', '6.0',
  '--outDir', outDir,
]

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

/** 编译一个入口，并把它改名成目标扩展名。 */
function compile(entry, moduleArgs, finalName) {
  execFileSync(tsc, [entry, ...commonArgs, ...moduleArgs], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  const base = path.basename(entry, '.ts')
  const produced = path.join(outDir, `${base}.js`)
  const map = path.join(outDir, `${base}.js.map`)
  if (!existsSync(produced)) throw new Error(`编译没有产出 ${produced}`)
  renameSync(produced, path.join(outDir, finalName))
  if (existsSync(map)) renameSync(map, path.join(outDir, `${finalName}.map`))
}

// 主进程：CJS。Electron 的 electron 模块是纯 CJS 导出，ESM 主进程拿不到 API（已实测三种写法全失败）。
compile(path.join(repoRoot, 'electron', 'main.ts'), ['--module', 'commonjs', '--moduleResolution', 'node10'], 'main.cjs')
// preload：CJS。Electron 的 ESM preload 要求 .mjs 且与 sandbox 设置相互牵制；这里只需两个 IPC 转发，用 CJS 最省事。
compile(path.join(repoRoot, 'electron', 'preload.ts'), ['--module', 'commonjs', '--moduleResolution', 'node10'], 'preload.cjs')

console.log(`桌面壳已编译到 ${path.relative(repoRoot, outDir)}/`)

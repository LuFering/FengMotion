/**
 * 增量部署：只把「前端构建产物 + 壳代码」同步到已安装目录，不重装 Electron 运行时。
 *
 * 为什么需要它：`install-desktop.mjs` 是全量安装，每次都会复制 274MB 的 Electron 运行时，
 * 而日常改动只涉及 dist/（几十 MB，且大部分静态素材没变）和两个壳文件（几 KB）。
 * 用 rsync 的增量比对，一次部署通常只需传几个 MB。
 *
 * 用法：
 *   node scripts/deploy-desktop.mjs            # 构建产物 + 壳代码
 *   node scripts/deploy-desktop.mjs --dist     # 只同步前端产物
 *   node scripts/deploy-desktop.mjs --shell    # 只同步壳代码（改了 electron/ 之后）
 *
 * 注意：应用正在运行时也能部署，但**必须重启应用**才会生效 ——
 * Chromium 已加载的 JS 不会热替换，旧窗口会一直用旧代码。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const repoRoot = path.resolve(import.meta.dirname, '..')
const home = os.homedir()
const INSTALL_DIR = path.join(home, '.local', 'opt', 'fengmotion-desktop')
const APP_DIR = path.join(INSTALL_DIR, 'app')

const DIST_SRC = path.join(repoRoot, 'dist')
const SHELL_SRC = path.join(repoRoot, 'electron', 'build')
const ICONS_SRC = path.join(repoRoot, 'build', 'icons')

const args = process.argv.slice(2)
const onlyDist = args.includes('--dist')
const onlyShell = args.includes('--shell')
const doDist = onlyDist || !onlyShell
const doShell = onlyShell || !onlyDist

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

if (!existsSync(INSTALL_DIR)) {
  fail(`应用未安装：${INSTALL_DIR}\n请先运行 node scripts/install-desktop.mjs`)
}

/** rsync 增量同步：只传变化的文件。--delete 保证删掉旧版本残留的 hash 文件。 */
function rsync(src, dest, label) {
  if (!existsSync(src)) fail(`缺少源目录：${src}`)
  /**
   * 关键：源路径**必须**带尾部斜杠（`src/`）。
   * 不带斜杠时 rsync 会把「源目录名」也复制到目标下，于是 `dist` 变成 `dist/dist`
   * —— 这个坑已实际踩过（部署后 app/dist 从 56M 涨到 111M，且新文件没生效）。
   */
  const srcWithSlash = src.endsWith('/') ? src : `${src}/`
  execFileSync(
    'rsync',
    ['-a', '--delete', '--checksum', '--itemize-changes', srcWithSlash, dest],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  console.log(`  ✓ ${label}`)
}

const before = execFileSync('du', ['-sb', APP_DIR], { encoding: 'utf-8' }).split('\t')[0]

console.log(`部署到 ${INSTALL_DIR.replace(home, '~')}`)

if (doDist) {
  rsync(DIST_SRC, path.join(APP_DIR, 'dist'), '前端构建产物 → app/dist')
}

if (doShell) {
  // 壳代码是两个小文件，直接覆盖
  for (const file of ['main.cjs', 'preload.cjs']) {
    const src = path.join(SHELL_SRC, file)
    if (!existsSync(src)) fail(`缺少壳产物：${src}\n请先运行 node scripts/build-electron.mjs`)
    execFileSync('cp', ['-a', src, path.join(APP_DIR, file)])
  }
  console.log('  ✓ 壳代码 → app/main.cjs, app/preload.cjs')
}

// 图标只在内容变化时才同步（避免每次部署都动图标缓存）
if (doDist && existsSync(ICONS_SRC)) {
  const installedIcon = path.join(APP_DIR, 'build', 'icons', '512x512.png')
  const srcIcon = path.join(ICONS_SRC, '512x512.png')
  if (existsSync(srcIcon)) {
    const same = existsSync(installedIcon) && readFileSync(installedIcon).equals(readFileSync(srcIcon))
    if (!same) {
      rsync(ICONS_SRC, path.join(APP_DIR, 'build', 'icons'), '图标 → app/build/icons')
    }
  }
}

const after = execFileSync('du', ['-sb', APP_DIR], { encoding: 'utf-8' }).split('\t')[0]
const delta = Number(after) - Number(before)

console.log(`
部署完成
  应用目录  ${APP_DIR.replace(home, '~')}
  体积变化  ${(delta / 1024 / 1024).toFixed(1)} MB

⚠️ 必须重启应用才生效：
   已运行的窗口用的是启动时加载的旧 JS，不会自动更新。
   ${'`'}fengmotion${'`'} 重新启动，或在应用菜单里退出后重开。
`)

// 提示正在运行的实例
try {
  const running = execFileSync('pgrep', ['-f', 'opt/fengmotion-desktop/electron/electron'], {
    encoding: 'utf-8',
  }).trim()
  if (running) {
    const count = running.split('\n').length
    console.log(`  当前有 ${count} 个进程在运行（属于同一个应用实例），请退出后重新打开。`)
  }
} catch {
  // pgrep 无匹配时退出码非 0，属正常情况
}

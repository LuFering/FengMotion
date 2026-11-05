/**
 * 用户级安装脚本：把 FengMotion 桌面壳装进 ~/.local，不碰系统目录（无需 sudo）。
 *
 * 布局（仿 open-design-desktop 的做法，但更简单，不打包 AppImage）：
 *   ~/.local/opt/fengmotion-desktop/
 *     ├── electron/             Electron 运行时（从 node_modules 复制）
 *     └── app/                  壳代码 + 构建产物 + 运行时资源
 *         ├── main.cjs
 *         ├── preload.cjs
 *         ├── dist/
 *         ├── build/icons/
 *         └── resources/         ← 主进程按 main.cjs 同级的 resources/ 查找
 *             ├── jre/           自带的裁剪 JRE（不依赖用户装 Java）
 *             ├── backend/       fengmotion-server.jar
 *             └── remotion/      渲染工程 + 运行依赖
 *   ~/.local/bin/fengmotion            启动器脚本（已在 PATH 中）
 *   ~/.local/share/applications/fengmotion.desktop    应用菜单入口
 *   ~/.local/share/icons/hicolor/<size>/apps/fengmotion.png
 *
 * 为什么不用 electron-builder 出 AppImage：
 *   本次目标是「装到自己机器上能用」。electron-builder 会额外下载 ~100MB 工具链，
 *   且默认产物在 ~/release 下需要另行安装。用户级直装更快、可随时改代码重装，
 *   等确实需要分发给别人时再上 electron-builder。
 *
 * 用法：
 *   node scripts/install-desktop.mjs           # 安装/覆盖
 *   node scripts/install-desktop.mjs --uninstall
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const repoRoot = path.resolve(import.meta.dirname, '..')
const home = os.homedir()

const APP_ID = 'fengmotion'
const APP_NAME = 'FengMotion'
const OPT_DIR = path.join(home, '.local', 'opt', 'fengmotion-desktop')
const BIN_DIR = path.join(home, '.local', 'bin')
const BIN_PATH = path.join(BIN_DIR, APP_ID)
const DESKTOP_DIR = path.join(home, '.local', 'share', 'applications')
const DESKTOP_PATH = path.join(DESKTOP_DIR, `${APP_ID}.desktop`)
const ICON_ROOT = path.join(home, '.local', 'share', 'icons', 'hicolor')

const ELECTRON_SRC = path.join(repoRoot, 'node_modules', 'electron', 'dist')
const DIST_SRC = path.join(repoRoot, '..', 'frontend', 'dist')
const SHELL_SRC = path.join(repoRoot, 'electron', 'build')
const ICONS_SRC = path.join(repoRoot, 'build', 'icons')
/* 运行时资源由 prepare-backend-resources.mjs 产出。
   少了它们，应用能打开但点什么都失败（后端起不来 / 渲染报缺工程），
   而且用户看到的是「连不上」而不是「没装全」，极难自查 —— 所以安装前强制校验。 */
const RESOURCES_SRC = path.join(repoRoot, 'electron', 'resources')

/** 安装前必须存在的产物。缺任何一个就直接报错，不做半成品安装。 */
function assertPrerequisites() {
  const required = [
    [ELECTRON_SRC, 'Electron 运行时（node_modules/electron/dist）'],
    [DIST_SRC, '前端构建产物（dist/）'],
    [SHELL_SRC, '壳编译产物（electron/build/）'],
    [ICONS_SRC, '图标（build/icons/）'],
    [path.join(RESOURCES_SRC, 'jre', 'bin', 'java'), '自带 JRE（electron/resources/jre）'],
    [path.join(RESOURCES_SRC, 'backend', 'fengmotion-server.jar'), '后端 jar（electron/resources/backend）'],
    [path.join(RESOURCES_SRC, 'remotion', 'render.mjs'), 'Remotion 渲染工程（electron/resources/remotion）'],
    [path.join(RESOURCES_SRC, 'remotion', 'node_modules'), 'Remotion 运行依赖（electron/resources/remotion/node_modules）'],
  ]
  const missing = required.filter(([p]) => !existsSync(p))
  if (missing.length > 0) {
    const lines = missing.map(([p, label]) => `  · 缺少${label}：${p}`).join('\n')
    throw new Error(`${lines}\n\n请先运行：\n  npm --prefix ../frontend run build && npm run build:shell && npm run resources`)
  }
}

function uninstall() {
  const removed = []
  for (const p of [OPT_DIR, BIN_PATH, DESKTOP_PATH]) {
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true })
      removed.push(p)
    }
  }
  // 图标按尺寸逐个删
  for (const size of ['16x16', '32x32', '48x48', '64x64', '128x128', '256x256', '512x512']) {
    const p = path.join(ICON_ROOT, size, 'apps', `${APP_ID}.png`)
    if (existsSync(p)) {
      rmSync(p, { force: true })
      removed.push(p)
    }
  }
  console.log('已卸载：')
  for (const p of removed) console.log('  ' + p.replace(home, '~'))
  console.log('\n提示：应用数据（localStorage 等）在 ~/.config/FengMotion/ 下，如不需要可手动删除。')
}

function install() {
  assertPrerequisites()

  // 1) 应用目录：先清空再铺，避免上次安装的残留文件混进新版本
  rmSync(OPT_DIR, { recursive: true, force: true })
  mkdirSync(OPT_DIR, { recursive: true })

  // Electron 运行时（274MB，复制一次；后续可考虑硬链接优化）
  console.log('复制 Electron 运行时…')
  cpSync(ELECTRON_SRC, path.join(OPT_DIR, 'electron'), { recursive: true })

  // 壳代码与构建产物
  console.log('复制应用代码与构建产物…')
  const appDir = path.join(OPT_DIR, 'app')
  mkdirSync(appDir, { recursive: true })
  /* 整目录复制，不逐个列举文件名。
     main.cjs 会 require('./backend.cjs')、'./updater.cjs'，只拷两个文件
     会让应用一启动就报 Cannot find module —— 实测踩到过。
     以后壳里再加模块，也不必回来改这份清单。 */
  cpSync(SHELL_SRC, appDir, {
    recursive: true,
    // .map 只在调试时有意义，装到用户目录里没必要占地方
    filter: (src) => !src.endsWith('.map'),
  })
  cpSync(DIST_SRC, path.join(appDir, 'dist'), { recursive: true })
  // 图标也放一份在 app 下：窗口图标由主进程从这里读（见 main.ts 的 resolveIconPath）
  cpSync(ICONS_SRC, path.join(appDir, 'build', 'icons'), { recursive: true })

  /* 运行时资源：JRE / 后端 jar / Remotion。
     主进程在非打包态会探测 main.cjs 同级的 resources/（见 main.ts 的
     resourcesRoot 三个分支）。铺错位置的表现是「应用能开、AI 用不了」，
     所以这里与 main.ts 的约定必须严格一致。 */
  console.log('复制运行时资源（JRE / 后端 / 渲染工程）…')
  cpSync(RESOURCES_SRC, path.join(appDir, 'resources'), { recursive: true })

  // 2) 图标：装到 hicolor 主题目录，各尺寸都放一份
  console.log('安装图标…')
  for (const size of ['16x16', '32x32', '48x48', '64x64', '128x128', '256x256', '512x512']) {
    const dest = path.join(ICON_ROOT, size, 'apps')
    mkdirSync(dest, { recursive: true })
    cpSync(path.join(ICONS_SRC, `${size}.png`), path.join(dest, `${APP_ID}.png`))
  }

  // 3) 启动器脚本
  mkdirSync(BIN_DIR, { recursive: true })
  const launcher = `#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${OPT_DIR}"

# 关键：本机环境里存在 ELECTRON_RUN_AS_NODE=1（可能来自某个 Node 工具链的导出）。
# 一旦带上它，Electron 会退化成纯 Node 进程，require('electron') 只返回二进制路径，
# 应用会立刻报 "Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')"。
# 所以这里必须显式清掉。
unset ELECTRON_RUN_AS_NODE

# 注意：这里**不能**预设 FENGMOTION_API_BASE。
# 主进程用它判断「要不要自己启动后端」—— 设了就会被当成「外部已提供后端」
# 而完全跳过启动，应用随即表现为「连不上 Agent」。
# 只有用户确实要在外部跑后端时才由他自己导出这个变量。

exec "\${APP_DIR}/electron/electron" "\${APP_DIR}/app/main.cjs" "$@"
`
  writeFileSync(BIN_PATH, launcher, 'utf-8')
  chmodSync(BIN_PATH, 0o755)

  // 4) 应用菜单入口
  mkdirSync(DESKTOP_DIR, { recursive: true })
  const desktopEntry = `[Desktop Entry]
Type=Application
Name=${APP_NAME}
GenericName=AI Video Studio
Comment=AI 视频创作工作台
Exec=${BIN_PATH} %U
Icon=${APP_ID}
Terminal=false
Categories=AudioVideo;Video;
StartupWMClass=${APP_ID}
Keywords=video;ai;fengmotion;剪辑;视频;
`
  writeFileSync(DESKTOP_PATH, desktopEntry, 'utf-8')

  // 5) 刷新桌面数据库，让菜单立刻看到新条目（失败不影响安装）
  for (const cmd of [
    ['update-desktop-database', [DESKTOP_DIR]],
    ['gtk-update-icon-cache', ['-f', '-t', ICON_ROOT]],
  ]) {
    try {
      execFileSync(cmd[0], cmd[1], { stdio: 'ignore' })
    } catch {
      // 这些工具在某些系统上不存在，缺了也不影响 .desktop 被读取
    }
  }

  const size = execFileSync('du', ['-sh', OPT_DIR], { encoding: 'utf-8' }).split('\t')[0]
  console.log(`
已安装 ${APP_NAME}（用户级，无需 sudo）
  应用目录   ${OPT_DIR.replace(home, '~')}  (${size})
  启动命令   ${BIN_PATH.replace(home, '~')}
  菜单入口   ${DESKTOP_PATH.replace(home, '~')}
  图标       ${ICON_ROOT.replace(home, '~')}/<size>/apps/${APP_ID}.png

自带运行时（不需要另装 Java / Node / Chromium）：
  · JRE      app/resources/jre
  · 后端     app/resources/backend/fengmotion-server.jar
  · 渲染     app/resources/remotion

启动方式：
  · 应用菜单里搜「${APP_NAME}」
  · 或在终端执行 ${APP_ID}

注意：Agent（DSH）仍使用本机已配置的引擎，未随包分发。
`)
}

const isUninstall = process.argv.includes('--uninstall')
if (isUninstall) uninstall()
else install()

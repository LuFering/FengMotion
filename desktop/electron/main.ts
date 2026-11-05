/**
 * FengMotion 桌面壳（最小可用版）
 *
 * 设计要点（每条都对应一个已查明的真实约束，不要随意改）：
 *
 * 1. 不用 file:// 加载 dist。
 *    src/editor/service.ts 用 fetch('./editor-sources/token/manifest.json')，
 *    Chrome/Electron 的 fetch 不支持 file: 协议，会直接抛错；
 *    src/data/myAssets.ts 还有运行时拼出的 '/ledger/xxx.jpg' 绝对路径。
 *    因此这里注册自定义协议 fengmotion://，由主进程把请求映射到 dist 目录。
 *    这样既绕开 fetch 限制，也让以 / 开头的绝对路径自然指向 dist 根。
 *
 * 2. 窗口必须等 app.whenReady() 之后才创建，协议必须先注册再加载页面。
 *
 * 3. 后端地址来自环境变量，不写死在代码里（契约 02 §1：不要把 8080 写死到组件）。
 *    壳本身不启动后端，只负责把地址交给渲染进程。
 */

import electron from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { startBackend, type BackendHandle } from './backend'
import { downloadUpdate, initUpdater } from './updater'

/**
 * 关于模块格式（已实测，勿改回 ESM）：
 *
 * 这份主进程必须编译成 **CJS**（.cjs）。原因是 Electron 45 的 `electron` 模块
 * 是纯 CJS 导出（类型上写作 `export = Electron.CrossProcessExports`），
 * 在 ESM 主进程里三种写法全部拿不到 API：
 *   · `import { app } from 'electron'` → SyntaxError: does not provide an export named 'BrowserWindow'
 *   · `import electron from 'electron'` → 得到一个空对象（protocol/app 全是 undefined）
 *   · `import * as ns from 'electron'` → 命名空间里只有空的 'module.exports' 键
 *
 * 编译成 CJS 后，`import electron from 'electron'` 经 TS 的 __importDefault 变成
 * `{ default: module.exports }`，default 正是完整的 electron API，可用。
 */
const { app, BrowserWindow, ipcMain, protocol, net, dialog, Menu } = electron

/**
 * 类型别名：解构出来的 BrowserWindow 是「值」，不能直接当类型用
 * （否则报 TS2749）。类型要从 electron 命名空间取。
 */
type BrowserWindowType = InstanceType<typeof BrowserWindow>

/** 自定义协议名。用 fengmotion:// 而不占用 app://，避免与 Chromium 保留名冲突。 */
const SCHEME = 'fengmotion'

/**
 * 后端基址。
 *
 * 优先用 FENGMOTION_API_BASE（例如想连自己起的后端）。否则由随包后端决定：
 * `startBackend()` 会挑一个空闲端口并返回实际地址 —— 8080 被占用时会换端口，
 * 所以这里不能写死。后端没起来时退回默认值，前端会显示「Agent 不可用」而不是崩掉。
 */
let API_BASE = process.env.FENGMOTION_API_BASE ?? 'http://127.0.0.1:8080/api'

/** 随包启动的后端句柄；未启动时为 null。 */
let backendHandle: BackendHandle | null = null

/**
 * 定位 dist 根目录。
 *
 * 注意：编译产物在 electron/build/ 下，所以不能只往上找一级 —— 那会得到
 * electron/dist（不存在）。这里按「开发 → 安装后 → 打包」三种形态依次探测，
 * 取第一个含 index.html 的目录。
 */
function resolveDistRoot(): string {
  const candidates = [
    process.env.FENGMOTION_DIST,
    // 用户级安装布局：opt/fengmotion-desktop/app/main.cjs → 同目录下的 dist
    path.join(__dirname, 'dist'),
    // 开发布局：electron/build/main.cjs → 上两级是仓库根，dist 在那里
    path.join(__dirname, '..', '..', '..', 'frontend', 'dist'),
    // 打包后：app.getAppPath() 指向 resources/app
    path.join(app.getAppPath(), 'dist'),
    path.join(process.resourcesPath ?? '', 'app', 'dist'),
  ].filter((p): p is string => Boolean(p))

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) return candidate
  }
  throw new Error(`找不到构建产物 dist（已查找：${candidates.join('、')}）。请先运行 npm run build。`)
}

// 协议必须在 whenReady 之前声明特权：standard 让它有正常的 origin（不是 null），
// 这样 CORS、localStorage、相对路径解析都按常规网页行为工作。
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

let DIST_ROOT = ''

/**
 * 把 fengmotion://app/<path> 映射到 dist 下的文件。
 *
 * host 固定为 app（见 loadURL）；资源路径相对 './'，因此 './assets/x.js'
 * 解析为 fengmotion://app/assets/x.js，'/ledger/x.jpg' 解析为 fengmotion://app/ledger/x.jpg，
 * 两种情况都落在 dist 根，正是想要的行为。
 */
function resolveDistFile(requestUrl: URL): string | null {
  let pathname = decodeURIComponent(requestUrl.pathname)
  if (pathname === '/' || pathname === '') pathname = '/index.html'
  const normalized = path.normalize(path.join(DIST_ROOT, pathname))
  const root = path.normalize(DIST_ROOT)
  // 安全：只允许 dist 根之内的文件，拒绝 ../ 逃逸
  if (!normalized.startsWith(root + path.sep)) return null
  return normalized
}

function registerAppProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const filePath = resolveDistFile(new URL(request.url))
    if (!filePath) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

/** 应用图标：安装形态下由 .desktop 提供，这里给窗口和任务栏用。 */
function resolveIconPath(): string | undefined {
  const candidates = [
    // 用户级安装：图标随 app 一起放
    path.join(__dirname, 'build', 'icons', '512x512.png'),
    // 开发布局
    path.join(__dirname, '..', '..', 'build', 'icons', '512x512.png'),
    path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'favicon.png'),
  ]
  return candidates.find((p) => existsSync(p))
}

function createWindow(): BrowserWindowType {
  const icon = resolveIconPath()
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#26262b', // 与 html[data-theme=dark] 的 --bg 一致，避免白闪
    title: 'FengMotion · 创作空间',
    ...(icon ? { icon } : {}),
    // 双保险：即使有应用菜单，也让它默认隐藏（按 Alt 才出现）
    autoHideMenuBar: true,
    show: false, // 等首帧就绪再显示，避免看到空窗口
    webPreferences: {
      // 构建产物是 preload.cjs（见 scripts/build-electron.mjs 的说明）。
      // 写成 preload.js 会静默加载失败 —— 这个 bug 已修过一次，勿回退。
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  if (process.env.FENGMOTION_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  // 诊断：把渲染进程的报错回传到主进程终端，否则壳里出错只能靠 DevTools 看。
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[load-failed] ${code} ${desc} ${url}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[renderer-gone] ${details.reason} exitCode=${details.exitCode}`)
  })

  // 验收用：设了 FENGMOTION_SCREENSHOT 就截一张图再退出，用于在无人值守环境里确认渲染结果。
  const shotPath = process.env.FENGMOTION_SCREENSHOT
  if (shotPath) {
    win.once('ready-to-show', () => {
      setTimeout(() => {
        void win.webContents
          .capturePage()
          .then(async (image) => {
            const { writeFile } = await import('node:fs/promises')
            await writeFile(shotPath, image.toPNG())
            console.log(`[screenshot] 已保存 ${shotPath}`)
          })
          .catch((error) => console.error('[screenshot] 失败', error))
          .finally(() => app.quit())
      }, 1500) // 留时间给首屏字体与视频帧
    })
  }

  void win.loadURL(`${SCHEME}://app/index.html`)
  return win
}

/**
 * 必须在 ready 之前设置应用名。
 *
 * app.getPath('userData') 由应用名决定，且在 ready 前就已定型：
 * 在 whenReady 里才 setName 的话，userData 仍是默认的 ~/.config/Electron ——
 * 结果是本应用和其他所有 Electron 应用共享同一份 localStorage，
 * 主题/设置会被串味（已实际观察到：设置被外部值覆盖成浅色）。
 */
app.setName('FengMotion')

/**
 * Linux 上窗口与 .desktop 的关联靠这个，不是靠 BrowserWindow 的 icon。
 *
 * Electron 文档（electron.d.ts: setDesktopName）明确要求：
 *   「This API must be called before the ready event.」
 *   且必须与真实的 .desktop 文件名一致。
 *
 * 之前只设了 setName，窗口 app_id 变成 "FengMotion"，匹配不上
 * "fengmotion.desktop" → GNOME（尤其 Wayland 会话）拿不到图标，
 * 就回退成 Electron 默认图标。这正是 dock 栏图标不生效的原因。
 *
 * 注意：app_id 取的是去掉 .desktop 后缀的部分，即 "fengmotion"。
 */
app.setDesktopName('fengmotion.desktop')

/* 验收用调试端口：Electron 会把未知命令行参数当成应用参数（实测报 bad option），
   所以走环境变量而不是 argv。默认关闭，只在内测/自动化时设
   FENGMOTION_DEBUG_PORT。必须在 ready 之前 appendSwitch 才生效。 */
const debugPort = process.env.FENGMOTION_DEBUG_PORT
if (debugPort && /^\d+$/.test(debugPort)) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort)
  app.commandLine.appendSwitch('remote-allow-origins', '*')
  console.log(`[debug] 已开启远程调试端口 ${debugPort}`)
}

// 单实例：避免重复启动开出多个窗口（Linux 上双击图标常见）。
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(async () => {
    DIST_ROOT = resolveDistRoot()

    /* 先起后端再建窗口：前端首屏就会探测 /api/capabilities 与 /api/harnesses，
       后端没起来的话用户会看到「Agent 不可用」闪一下，还得手动刷新。
       后端启动失败不阻止开窗 —— 前端仍可浏览，只是没有 Agent。 */
    if (!process.env.FENGMOTION_API_BASE) {
      /* 打包态用 resources；开发态指向后端仓库根 —— backend.ts 会在其下找
         remotion/，而 backend/target 里没有那个工程（那里只有 jar）。

         用户级安装（install-desktop.mjs）既不是 electron-builder 打包态，
         也不在仓库里：它把壳放进 ~/.local/opt/fengmotion-desktop/app/，
         运行时资源放在同级 resources/。此时若仍按「开发态」去找
         ../../backend，就会指向 ~/.local/opt/backend —— 那里什么都没有，
         后端永远起不来，应用表现为「打开后用不了 AI」。
         所以第三分支显式探测同级 resources/。 */
      /* 注意这里是 __dirname 本身而不是它的上级：main.cjs 与 resources/
         是同一个 app/ 目录下的兄弟，安装脚本就是按这个布局铺的。 */
      const installedRoot = path.resolve(__dirname, 'resources')
      const resourcesRoot = app.isPackaged
        ? process.resourcesPath
        : existsSync(path.join(installedRoot, 'backend'))
          ? installedRoot
          : path.resolve(__dirname, '..', '..', '..', 'backend')
      backendHandle = await startBackend({
        resourcesRoot,
        /* 数据目录必须与后端 application.yml 的 fengmotion.data-dir 默认值一致
           （Linux 上都是 ~/.config/FengMotion/data）。两处不一致会出现
           「开发态能看到项目、应用里报项目不存在」—— 因为实际读的是两个库。 */
        dataDir: path.join(app.getPath('userData'), 'data'),
        logFile: path.join(app.getPath('userData'), 'backend.log'),
        packaged: app.isPackaged,
      }).catch((error: unknown) => {
        console.error('[backend] 启动失败', error)
        return null
      })
      if (backendHandle) API_BASE = backendHandle.apiBase
    }
    // Linux 下 WM_CLASS 由这个字段决定，要和 .desktop 的 StartupWMClass 对上，
    // 否则任务栏会把图标和窗口当成两个不同应用。
    /**
     * 移除 Electron 的默认应用菜单（File / Edit / View / Window）。
     *
     * 这些是 Electron 自带的通用菜单，与产品无关，留在窗口顶部只会占掉一行高度、
     * 并且和自绘界面风格冲突。Linux/Windows 上直接置空即可彻底消失。
     * macOS 例外：完全移除会让 Cmd+Q、Cmd+C 等系统快捷键失效，所以保留一个空壳菜单。
     */
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]))
    } else {
      Menu.setApplicationMenu(null)
    }
    registerAppProtocol()

    // 渲染进程查询运行时配置用：后端地址、是否打包。
    ipcMain.handle('fengmotion:runtime-config', () => ({
      apiBaseUrl: API_BASE,
      packaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      distRoot: DIST_ROOT,
    }))

    // 桌面端专属能力：选目录（浏览器 webkitdirectory 拿不到绝对路径）。
    // 对应 docs/contracts/asset.md §3.3 的 POST /assets/import 按绝对路径导入。
    /* 用户确认后下载更新。默认不自动下载（见 updater.ts），
       所以必须有这个显式入口，否则更新永远停在「发现新版本」。 */
    ipcMain.handle('fengmotion:download-update', () => {
      downloadUpdate()
    })

    ipcMain.handle('fengmotion:pick-directory', async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })

    createWindow()

    /* 打包态检查更新。状态只写日志与通知，不阻塞窗口 ——
       更新是后台行为，用户正在创作时不该被打断。 */
    initUpdater((message) => {
      console.log('[update]', message)
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('fengmotion:update-status', message)
    })

    app.on('activate', () => {
      // macOS：点 dock 图标时若无窗口则重建
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

/** 退出前收掉后端：应用关了不该留一个占着端口的 Java 进程。 */
let backendStopping = false
async function stopBackendOnce(): Promise<void> {
  if (backendStopping) return
  backendStopping = true
  await backendHandle?.stop()
  backendHandle = null
}

app.on('before-quit', (event) => {
  if (backendHandle === null || backendStopping) return
  /* 阻止这次退出，先优雅停后端再重新 quit。
     不这样做的话，SIGTERM 还没发出去进程就没了，后端会成为孤儿。 */
  event.preventDefault()
  void stopBackendOnce().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  // macOS 习惯是关窗不退出；Windows/Linux 关窗即退出
  if (process.platform !== 'darwin') app.quit()
})

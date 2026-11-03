/**
 * 自动更新：从 GitHub Releases 检查并下载新版本。
 *
 * <p><strong>为什么用 electron-updater 而不是自己写</strong>：它内置了 blockmap
 * 差分下载 —— 更新时只拉变化的块，而不是整包。对一个带 90MB 运行时（JRE + jar）
 * 的应用来说，这是「避免每次从 0 更新」的关键。</p>
 *
 * <p><strong>只在打包态启用</strong>：开发态（未打包）跑更新会去读 GitHub 上的发布，
 * 拿到的是别人构建的产物，覆盖当前开发目录 —— 没有任何好处，只会把环境搞乱。</p>
 */

import { app } from 'electron'

/** 更新器实例；未启用时为 null。 */
type Updater = typeof import('electron-updater').autoUpdater

let updater: Updater | null = null

/**
 * 初始化自动更新。
 *
 * @param onStatus 状态回调，用于把进度显示到界面
 */
export function initUpdater(onStatus: (message: string) => void): void {
  if (!app.isPackaged) {
    console.log('[update] 开发态不检查更新')
    return
  }

  void (async () => {
    try {
      // 动态导入：开发态没装 electron-updater 时也不会因为静态 import 直接崩
      const mod = await import('electron-updater')
      const autoUpdater = mod.autoUpdater
      updater = autoUpdater

      // 不自动下载：先让用户知道有新版本，避免在创作中途突然占带宽
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true

      autoUpdater.on('update-available', (info) => {
        onStatus(`发现新版本 ${info.version}，正在后台下载`)
        void autoUpdater.downloadUpdate()
      })
      autoUpdater.on('update-downloaded', (info) => {
        onStatus(`新版本 ${info.version} 已就绪，重启后生效`)
      })
      autoUpdater.on('error', (error) => {
        // 更新失败不该影响使用：记日志即可，不弹窗打断用户
        console.warn('[update] 检查或下载失败：', error.message)
      })

      await autoUpdater.checkForUpdates()
    } catch (error) {
      console.warn('[update] 初始化失败（不影响使用）：', error instanceof Error ? error.message : error)
    }
  })()
}

/** 立即应用已下载的更新并重启。 */
export function quitAndInstall(): void {
  updater?.quitAndInstall()
}

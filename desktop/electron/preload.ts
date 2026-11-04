/**
 * 预加载脚本：在隔离世界里给渲染进程暴露一个极小的、明确的能力面。
 *
 * 原则：只暴露壳真正能提供的东西，不做 `require` 透传，
 * 渲染进程的业务代码（src/ 下）本来也没有任何 Node 依赖。
 *
 * 关键：**把壳的后端地址交给前端**。
 * 前端配置层只认 `VITE_FENGMOTION_API_BASE`（Vite 约定的前缀，打包后被静态注入），
 * 而壳运行时才知道真实的后端地址（可能是动态端口、也可能由用户配置）。
 * 两边不接上的话，壳设的地址完全不起作用 —— 前端会一直打默认的 8080。
 * 所以这里通过 `runtimeConfig` 暴露出来，由 `src/services/api` 的初始化读走。
 */

import { contextBridge, ipcRenderer } from 'electron'

const bridge = {
  /** 运行时配置：后端地址等。壳决定，不在前端写死。 */
  runtimeConfig: () => ipcRenderer.invoke('fengmotion:runtime-config'),
  /** 桌面专属：选目录并拿到绝对路径（浏览器做不到）。取消时返回 null。 */
  pickDirectory: () => ipcRenderer.invoke('fengmotion:pick-directory'),
  /** 让前端能判断自己是不是跑在壳里。 */
  isDesktop: true,
  /**
   * 订阅更新状态。
   *
   * <p>主进程早就在发 `fengmotion:update-status`，但没有人接收 ——
   * 结果是「发现新版本」这件事只写进了日志，用户永远看不到。
   * 这里补上通道，返回取消订阅函数，避免组件卸载后回调泄漏。</p>
   *
   * @param handler 收到状态文案
   * @returns 取消订阅
   */
  onUpdateStatus: (handler: (message: string) => void) => {
    const listener = (_event: unknown, message: string) => handler(message)
    ipcRenderer.on('fengmotion:update-status', listener)
    return () => ipcRenderer.removeListener('fengmotion:update-status', listener)
  },
  /** 用户确认后开始下载更新（默认不自动下载，避免创作中途抢带宽）。 */
  downloadUpdate: () => ipcRenderer.invoke('fengmotion:download-update'),
}

try {
  contextBridge.exposeInMainWorld('fengmotion', bridge)
} catch (error) {
  // 隔离世界注入失败时不要让整个页面崩掉，只在主进程日志里留痕。
  console.error('[preload] exposeInMainWorld failed', error)
}

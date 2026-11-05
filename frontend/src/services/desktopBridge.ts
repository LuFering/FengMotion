/**
 * 桌面壳的运行时配置桥接。
 *
 * 存在的理由：前端的配置层只认 `VITE_FENGMOTION_API_BASE` 这类**构建期**注入的变量
 * （`src/services/api/config.ts` 的 readEnvConfig）。但桌面运行时才知道真正的后端地址 ——
 * 可能是动态端口，也可能由用户在设置里改过。壳不把地址送过来，前端就会一直打默认的 8080。
 *
 * 这里只做「读取 + 兜底」，不缓存结果：地址随时可能变（用户改设置、壳重启）。
 * 读不到（非桌面环境、preload 没注入）就返回 null，由调用方按原逻辑走默认配置。
 */

/** 壳注入到 window 上的对象（由 electron/preload.ts 的 contextBridge 暴露）。 */
export interface DesktopBridge {
  runtimeConfig(): Promise<{ apiBaseUrl: string; packaged: boolean; platform: string; arch: string; distRoot?: string }>
  pickDirectory(): Promise<string | null>
  isDesktop: boolean
  /**
   * 订阅更新状态。可缺省：老版本壳没有这个通道，调用方必须容错。
   *
   * @param handler 收到状态文案
   * @returns 取消订阅
   */
  onUpdateStatus?(handler: (message: string) => void): () => void
  /** 用户确认后开始下载更新。 */
  downloadUpdate?(): Promise<void>
}

declare global {
  interface Window {
    fengmotion?: DesktopBridge
  }
}

/** 读取壳给的运行时配置；不在桌面环境返回 null。 */
export async function readDesktopRuntimeConfig(): Promise<{
  apiBaseUrl: string
  packaged: boolean
  platform: string
  arch: string
} | null> {
  const bridge = typeof window === 'undefined' ? undefined : window.fengmotion
  if (!bridge?.runtimeConfig) return null
  try {
    const config = await bridge.runtimeConfig()
    if (!config || typeof config.apiBaseUrl !== 'string' || config.apiBaseUrl === '') return null
    return {
      apiBaseUrl: config.apiBaseUrl,
      packaged: config.packaged === true,
      platform: typeof config.platform === 'string' ? config.platform : 'unknown',
      arch: typeof config.arch === 'string' ? config.arch : 'unknown',
    }
  } catch {
    // 壳没起好时不能拖垮整个应用：返回 null，按默认配置走
    return null
  }
}

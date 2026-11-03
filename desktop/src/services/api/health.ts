/**
 * 系统域：健康检查、能力声明、应用设置（README §3.1 / settings.md）。
 *
 * 为什么单独成一个 resource：这三件事都不是业务数据，而是「界面能显示什么、能点什么」的输入。
 * 启动时序上它们是第一批请求 —— 先 `/health` 判断本地服务在不在，再 `/capabilities` 决定按钮闸门，
 * 所以放在一起，让调用方不必跨模块拼装。
 *
 * 贯穿本文件的一条硬规则：**服务端没说 ≠ 可用**。缺项、连不上、`demo` 都不放行真实写操作
 * （README §2.10、settings.md §1）；错误一律由 HttpClient 抛出，这里不做「拿不到就返回默认值」的兜底。
 */
import type { AppSettings, Capabilities, HealthStatus, SettingsUpdateRequest } from '@/types/contracts'
import type { HttpClient } from './http'
import { demoOriginOf } from './compat'
import { normalizeServerCapabilities } from './capabilities'

export interface SystemProbe {
  health: HealthStatus
  /**
   * 演示数据标记。
   *
   * 现运行骨架在 `/health` 里带 `demo: true`，而冻结的 `HealthStatus` 没有该字段
   * （02 §3 记录了这处差异，属契约缺口）。两种偷懒做法都被排除：
   * 塞进 `HealthStatus` 会改契约类型（本层无权改）；直接丢掉等于把演示服务说成真实服务
   * （02 §1 兼容红线：不能把 `true` 硬改 `false`）。所以如实并列透出，由界面决定怎么标注。
   */
  demo: boolean
}

export interface UpdateSettingsOptions {
  /** 上一次读到的 ETag；有就带上，412 表示设置已被其他窗口改过。 */
  etag?: string
  signal?: AbortSignal
}

export interface SystemResource {
  health(): Promise<HealthStatus>
  probe(): Promise<SystemProbe>
  capabilities(): Promise<Capabilities>
  getSettings(): Promise<AppSettings>
  updateSettings(body: SettingsUpdateRequest, options?: UpdateSettingsOptions): Promise<AppSettings>
}

export function createSystemResource(http: HttpClient): SystemResource {
  return {
    health() {
      return http.get<HealthStatus>('/health')
    },

    async probe() {
      // 这里按 unknown 读，不按 HealthStatus 读：泛型标注会把契约里没有的 demo 字段隐藏掉，
      // 而「是不是演示服务」正是本方法要回答的问题。
      const payload = await http.get<unknown>('/health')
      return { health: payload as HealthStatus, demo: demoOriginOf(payload) === 'demo' }
    },

    async capabilities() {
      // 缺项判定交给 normalizeServerCapabilities：缺失一律 unavailable 且带原因，
      // 绝不因为「服务端没提这一项」就当成可用（settings.md §1：能力是按钮可用性的唯一依据）。
      const payload = await http.get<unknown>('/capabilities')
      return normalizeServerCapabilities(payload)
    },

    getSettings() {
      return http.get<AppSettings>('/settings')
    },

    updateSettings(body, options = {}) {
      // settings.md §2 没要求 If-Match，但 02 §2 的通用规则要求可变资源走条件更新。
      // 折中方式：etag 由调用方决定带不带 —— 读不到版本时仍能改（不把功能卡死），
      // 读到了就必须带，否则两个窗口会互相覆盖主题与工作区根目录。
      return http.patch<AppSettings>('/settings', body, {
        ifMatch: options.etag,
        signal: options.signal,
      })
    },
  }
}

/**
 * API 层组装：一个 `HttpClient` + 九个域客户端 + 能力闸门。
 *
 * 用法（视图/ hook 只经这一层取数，不自己拼请求 —— docs/dev/前后端协议.md §1）：
 * ```ts
 * const api = studioHttpApi()
 * const page = await api.tasks.list(projectId)
 * const handle = api.tasks.stream(taskId, { onEvent: (e) => append(e) })
 * ```
 *
 * 三条边界写在这里，避免调用方误解：
 * 1. **本层只讲 HTTP**。`config.mode === 'demo'` 表示「应该走演示适配器」，此时不要用这个客户端
 *    去冒充真实执行 —— 演示模式仍由既有 `MockStudioApi` 承担（02 §1 兼容红线）。
 * 2. **不做自动降级**：连不上后端就抛 `network_error`，不会退回演示数据。
 * 3. **默认实例是惰性的**：模块加载不读 localStorage/环境变量，第一次调用才解析配置，
 *    这样设置页改完地址可以直接 `resetStudioHttpApi()` 生效，也不会在非浏览器环境炸。
 */
import type { Capabilities } from '@/types/contracts'
import type { ApiConfig, ApiConfigPatch, ApiMode, CapabilityGate, ClientCapabilities } from './types'
import { resolveApiConfig, type ResolveApiConfigOptions } from './config'
import { HttpClient, type HttpClientDeps } from './http'
import { CAPABILITY_LABELS, buildCapabilityViews, capabilityGate, type CapabilityKey } from './capabilities'
import { createSystemResource, type SystemResource } from './health'
import { createProjectsResource, type ProjectsResource } from './projects'
import { createArtifactsResource, type ArtifactsResource } from './artifacts'
import { createTaskClient, type TaskClient } from './taskClient'
import { createTasksResource, type TasksResource } from './tasks'
import { createChatResource, type ChatResource } from './chat'
import { createHarnessResource, type HarnessResource } from './harnesses'
import { readDesktopRuntimeConfig } from '../desktopBridge'
import { createAssetsResource } from './assets'
import { createRendersResource } from './renders'
import { createChecksResource } from './checks'
import { createWorkflowsResource } from './workflows'
import { createLibraryResource } from './library'

export interface StudioApiClient {
  readonly http: HttpClient
  readonly config: ApiConfig
  /** 配置里的模式（`http`/`demo`）；为 `demo` 时本客户端不应被用于真实执行。 */
  readonly mode: ApiMode
  readonly system: SystemResource
  readonly projects: ProjectsResource
  /** 项目目录里的真实文件（AI 产出的视频、脚本等） */
  readonly artifacts: ArtifactsResource
  /** 制作任务（真实后端，非演示） */
  readonly task: TaskClient
  readonly tasks: TasksResource
  readonly chat: ChatResource
  /** 引擎探测（`/harnesses`、`/harnesses/{id}/models`）。后端尚未实现，调用方需处理 404/503。 */
  readonly harnesses: HarnessResource
  readonly assets: ReturnType<typeof createAssetsResource>
  readonly renders: ReturnType<typeof createRendersResource>
  readonly checks: ReturnType<typeof createChecksResource>
  readonly workflows: ReturnType<typeof createWorkflowsResource>
  readonly library: ReturnType<typeof createLibraryResource>
  /** 改基址/超时等（设置页保存后调用）。返回新配置，供界面显示来源。 */
  patchConfig(patch: ApiConfigPatch): ApiConfig
  /** 七项能力的合并视图（服务端 + 本机），用于显示「能力来自哪里」。 */
  capabilityViews(server: Capabilities, client?: ClientCapabilities): Record<CapabilityKey, ReturnType<typeof buildCapabilityViews>[CapabilityKey]>
  /** 把能力视图变成按钮闸门：只有 `available` 放行，`demo`/`unavailable` 都给原因。 */
  capabilityGates(server: Capabilities, client?: ClientCapabilities): Record<CapabilityKey, CapabilityGate>
}

export interface CreateApiClientOptions {
  /** 直接给完整配置（最优先），或给一份覆盖项。 */
  config?: ApiConfig | ApiConfigPatch
  /** 走配置解析链（显式 > 环境变量 > 本机存储 > 默认值）。给了 `config` 就不再解析。 */
  resolve?: ResolveApiConfigOptions
  deps?: HttpClientDeps
}

function isFullConfig(value: ApiConfig | ApiConfigPatch): value is ApiConfig {
  return typeof (value as ApiConfig).source === 'string' && typeof (value as ApiConfig).baseUrl === 'string'
}

export function createStudioApiClient(options: CreateApiClientOptions = {}): StudioApiClient {
  const config = options.config
    ? isFullConfig(options.config)
      ? options.config
      : resolveApiConfig({ ...options.resolve, overrides: { ...options.resolve?.overrides, ...options.config } })
    : resolveApiConfig(options.resolve ?? {})

  const http = new HttpClient(config, options.deps)

  return {
    http,
    get config() {
      return http.config
    },
    mode: config.mode,
    system: createSystemResource(http),
    projects: createProjectsResource(http),
    artifacts: createArtifactsResource(http),
    task: createTaskClient(http),
    tasks: createTasksResource(http),
    chat: createChatResource(http),
    harnesses: createHarnessResource(http),
    assets: createAssetsResource(http),
    renders: createRendersResource(http),
    checks: createChecksResource(http),
    workflows: createWorkflowsResource(http),
    library: createLibraryResource(http),

    patchConfig(patch) {
      return http.patchConfig(patch)
    },

    capabilityViews(server, client) {
      return buildCapabilityViews(server, client)
    },

    capabilityGates(server, client) {
      const views = buildCapabilityViews(server, client)
      const gates = {} as Record<CapabilityKey, CapabilityGate>
      for (const key of Object.keys(views) as CapabilityKey[]) {
        gates[key] = capabilityGate(views[key], CAPABILITY_LABELS[key])
      }
      return gates
    },
  }
}

/**
 * 桌面壳初始化：把壳运行时才知道的后端地址注入配置。
 *
 * 为什么必须显式调用：配置解析链（resolveApiConfig）是**同步**的，而壳的地址要经 IPC 异步取；
 * 而且壳给的地址必须**压过**构建期注入的 VITE_ 变量与本机存储（用户可能在壳里改过地址），
 * 所以它走 `explicit` 一档。
 *
 * 不在桌面环境（浏览器里跑）时是空操作，调用方可以无条件调。
 */
export async function initDesktopApiBase(): Promise<ApiConfig | null> {
  const runtime = await readDesktopRuntimeConfig()
  if (!runtime) return null
  const config = resolveApiConfig({ explicit: { baseUrl: runtime.apiBaseUrl } })
  installStudioHttpApi(createStudioApiClient({ config }))
  return config
}

let cached: StudioApiClient | null = null

/** 默认实例（惰性）。第一次调用时解析配置，之后复用。 */
export function studioHttpApi(options: CreateApiClientOptions = {}): StudioApiClient {
  if (!cached) cached = createStudioApiClient(options)
  return cached
}

/**
 * 丢弃默认实例，下次调用重新解析配置。
 * 设置页改了后端地址、或退出登录后调用（token 只放内存，本层不保存它）。
 */
export function resetStudioHttpApi(): void {
  cached = null
}

/** 注入自定义实例（测试或桌面壳提供 fetch/token 时用）。传 null 等于 reset。 */
export function installStudioHttpApi(client: StudioApiClient | null): void {
  cached = client
}

export * from './types'
export * from './config'
export * from './errors'
export * from './http'
export * from './sse'
export * from './streams'
export * from './compat'
export * from './capabilities'
export * from './validate'
export type { SystemResource } from './health'
export type { ProjectsResource } from './projects'
export type { TasksResource } from './tasks'
export type { ChatResource } from './chat'
export type { HarnessResource, HarnessDescriptor, HarnessModel, HarnessCapabilities } from './harnesses'

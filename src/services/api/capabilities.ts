/**
 * 能力视图：把服务端声明的能力与本机真实能力合成 UI 可用性。
 *
 * 为什么不是「以 `/capabilities` 为唯一来源」：02 §3.1 明确 —— 不能用服务端
 * `unavailable` 隐藏本机已有的编辑器能力（当前项目已有本机场景编辑器）。
 * 所以两边各留一份，合并时取更强的一档，并把差异写进 note，让界面能说清
 * 「为什么这个按钮能点/不能点、能力来自哪里」。
 *
 * 另一条硬规则：`demo` **不等于**可用。演示能力不能驱动真实写操作（README §2.10），
 * 所以 `capabilityGate` 只放行 `available`。
 */
import type { Capabilities, Capability, CapabilityStatus } from '@/types/contracts'
import type { CapabilityGate, CapabilityView, ClientCapabilities } from './types'

export type CapabilityKey = keyof Capabilities

/** 中文名，供界面拼「××未接入」这类说明，避免各页面自己起名字。 */
export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  agent: 'Agent 执行',
  remotionEditor: '本机编辑器',
  previewVideo: '预览视频',
  cloudRender: '云端渲染',
  referenceAnalysis: '参考片解析',
  asr: '语音转写',
  checkExecution: '检查执行',
}

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  available: '可用',
  demo: '仅演示',
  unavailable: '未接入',
}

const RANK: Record<CapabilityStatus, number> = { unavailable: 0, demo: 1, available: 2 }

export function mergeCapability(server?: Capability, client?: Capability): CapabilityView {
  const view: CapabilityView = { status: 'unavailable', server, client }
  const candidates = [server, client].filter((item): item is Capability => item !== undefined)
  if (candidates.length === 0) {
    view.note = '服务端与本机都没有声明这项能力。'
    return view
  }
  const best = candidates.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a))
  view.status = best.status
  const notes: string[] = []
  if (best.note) notes.push(best.note)
  if (server && client && server.status !== client.status) {
    notes.push(`服务端${STATUS_LABEL[server.status]}，本机${STATUS_LABEL[client.status]}`)
  }
  if (notes.length > 0) view.note = notes.join('；')
  return view
}

export function buildCapabilityViews(
  server: Capabilities,
  client?: ClientCapabilities,
): Record<CapabilityKey, CapabilityView> {
  const keys = Object.keys(CAPABILITY_LABELS) as CapabilityKey[]
  const views = {} as Record<CapabilityKey, CapabilityView>
  for (const key of keys) views[key] = mergeCapability(server[key], client?.[key])
  return views
}

/**
 * 动作闸门。只有 `available` 放行；
 * `demo` 明确不放行真实写操作，避免「演示点了像成功了」。
 */
export function capabilityGate(view: CapabilityView, label: string): CapabilityGate {
  if (view.status === 'available') return { enabled: true, reason: '' }
  if (view.status === 'demo') {
    return { enabled: false, reason: view.note ?? `${label}当前只有演示数据，不能执行真实操作。` }
  }
  return { enabled: false, reason: view.note ?? `${label}未接入，暂不能执行。` }
}

/** `/capabilities` 缺项时的兜底：缺失按 unavailable 处理，绝不当成可用。 */
export function normalizeServerCapabilities(payload: unknown): Capabilities {
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const keys = Object.keys(CAPABILITY_LABELS) as CapabilityKey[]
  const result = {} as Capabilities
  for (const key of keys) {
    const raw = record[key]
    if (typeof raw === 'object' && raw !== null && typeof (raw as { status?: unknown }).status === 'string') {
      const status = (raw as { status: string }).status
      const capability: Capability = {
        status: status === 'available' || status === 'demo' ? status : 'unavailable',
      }
      const note = (raw as { note?: unknown }).note
      if (typeof note === 'string' && note !== '') capability.note = note
      result[key] = capability
    } else {
      result[key] = { status: 'unavailable', note: '服务端没有声明这项能力。' }
    }
  }
  return result
}

import { REFERENCE_COLLECTIONS, type ReferenceStatus } from '@/features/reference/model/referenceLibrary'

export type StatusFilter = ReferenceStatus | 'all'

export interface Filters {
  cameraMove: string
  transition: string
  status: StatusFilter
}

export interface StoredLibrary {
  favorites: string[]
  recent: string[]
  memberships: Record<string, string[]>
}

export const STORE_KEY = 'fm-reference-library-v1'

export const OUTBOX_KEY = 'fm-reference-outbox-v1'

/** 拖拽时按片段 ID 暂存参数包（DataTransfer 只能传字符串） */
export const REF_STASH_KEY = 'fm-ref-card-stash-v1'

export function defaultMemberships(): Record<string, string[]> {
  return Object.fromEntries(REFERENCE_COLLECTIONS.map((c) => [c.id, [...c.segmentIds]]))
}

export function defaultStored(): StoredLibrary {
  return { favorites: [], recent: [], memberships: defaultMemberships() }
}

export function readStored(): StoredLibrary {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return defaultStored()
    const parsed = JSON.parse(raw) as Partial<StoredLibrary>
    /* 不再在这里校验 ID 是否存在：偏好以服务端为准，
       本地这份只在首屏渲染前充当占位，真实数据随后覆盖。
       用模块级 Map 校验会让「加载中」误判成一堆失效 ID。 */
    const valid = (ids: unknown) =>
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    return {
      favorites: valid(parsed.favorites),
      recent: valid(parsed.recent),
      memberships: { ...defaultMemberships(), ...(parsed.memberships ?? {}) },
    }
  } catch {
    return defaultStored()
  }
}

export function readOutbox(): string[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : []
  } catch {
    return []
  }
}

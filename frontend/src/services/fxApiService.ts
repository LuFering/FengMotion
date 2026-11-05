/**
 * 特效库的**服务端**数据源（替代静态 `FX_TECHNIQUES` + localStorage）。
 *
 * 为什么单独一层：
 *   1. 视图用的是本地模型 `FxTechnique`（`previewImage`/`previewVideo`、`localStorage` 里存的
 *      收藏与最近），后端用契约模型（`previewImageUrl`/`previewVideoUrl`、`userState`）。
 *      转换只在这里做一次。
 *   2. **执行状态必须来自服务端**：本地数据里的 `execType` 是源库声明的标签，
 *      而「这台机器能不能跑」是服务端的 `executionStatus`。两层混用就会出现
 *      「界面说可直接执行、点下去什么都没有」。
 *
 * 与旧数据的兼容：`localStorage` 里的收藏与最近不会自动出现在服务端。
 * 迁移策略与素材一致 —— 首次连接时把本地收藏批量推上去，成功后清理本地标记。
 */
import { studioHttpApi } from '@/services/api'
import type { FxTechnique as ContractFxTechnique } from '@/types/contracts'
import type { FxCategory, FxExecType, FxImpl, FxInputKind, FxTechnique } from '@/data/fxTechniques'

/** 服务端返回的技法形状（与契约 `FxTechnique` + `userState` 对齐）。 */
interface ServerFxTechnique {
  id: string
  name: string
  nameEn: string
  aliases: string[]
  keywords: string[]
  intent: string
  category: string
  categoryLabel: string
  scenes: string[]
  antiScenes: string[]
  execType: string
  execLabel: string
  executionStatus: string
  impl: string
  implLabel: string
  complexity: number
  inputKinds: string[]
  inputLabels: string[]
  inputRequirement: string
  output: string
  dependencies: string[]
  steps: string[]
  compatibility: string[]
  limitations: string[]
  failures: string[]
  params: Array<{ key: string; label: string; value: string; hint: string }>
  previewImageUrl: string
  previewVideoUrl: string | null
  previewCaption: string
  related: string[]
  alternatives: string[]
  featured: boolean
  version: string
  updatedAt: string
  demo: boolean
  userState?: { favorited: boolean; lastViewedAt: string | null }
}

export interface FxListPage {
  items: FxTechnique[]
  total: number
  nextCursor: string | null
}

/**
 * 服务端技法 → 视图模型。
 *
 * 只做字段改名与取值收窄，**不改写语义**：
 * `execType` 仍是源库标签，本机可执行性单独通过 {@link executionStatusOf} 判断。
 */
function toLocal(item: ServerFxTechnique): FxTechnique & { executionStatus?: string } {
  return {
    id: item.id,
    name: item.name,
    nameEn: item.nameEn,
    aliases: item.aliases ?? [],
    keywords: item.keywords ?? [],
    intent: item.intent,
    category: item.category as FxCategory,
    categoryLabel: item.categoryLabel,
    scenes: item.scenes ?? [],
    antiScenes: item.antiScenes ?? [],
    execType: item.execType as FxExecType,
    execLabel: item.execLabel,
    impl: item.impl as FxImpl,
    implLabel: item.implLabel,
    complexity: item.complexity,
    inputKinds: (item.inputKinds ?? []) as FxInputKind[],
    inputLabels: item.inputLabels ?? [],
    inputRequirement: item.inputRequirement,
    output: item.output,
    dependencies: item.dependencies ?? [],
    steps: item.steps ?? [],
    compatibility: item.compatibility ?? [],
    limitations: item.limitations ?? [],
    failures: item.failures ?? [],
    params: item.params ?? [],
    previewImage: item.previewImageUrl,
    previewVideo: item.previewVideoUrl,
    previewCaption: item.previewCaption,
    related: item.related ?? [],
    alternatives: item.alternatives ?? [],
    featured: item.featured,
    version: item.version,
    updatedAt: item.updatedAt,
    // 本机可执行状态随条目一起带出来，供界面判断，不影响 execType 的展示。
    executionStatus: item.executionStatus,
  }
}

/**
 * 本机是否**真的**能执行这条技法。
 *
 * <p>唯一判据是服务端的 `executionStatus === 'available'`。
 * <strong>不要用 `execType === 'runnable'` 判断</strong> —— 那是源库的说法，不是本机事实。</p>
 */
export function canExecuteNow(technique: { executionStatus?: string } | null | undefined): boolean {
  return technique?.executionStatus === 'available'
}

/** 列出全部技法（分页取完）。 */
export async function listTechniques(): Promise<FxTechnique[]> {
  const all: FxTechnique[] = []
  let cursor: string | null | undefined
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await studioHttpApi().library.fx.listTechniques({
      cursor: cursor ?? undefined,
      limit: 200,
    })
    for (const item of page.items) all.push(toLocal(item as unknown as ServerFxTechnique))
    cursor = page.nextCursor
    if (!cursor) break
  }
  return all
}

/**
 * 语义检索技法与能力库，返回**排序后的 ID**。
 *
 * <p>为什么只返回 ID 而不返回技法对象：技法的展示字段由 `listTechniques()`
 * 那份目录提供，这里只决定「怎么排、哪些优先」。两处各拿一份完整对象，
 * 迟早会出现同一技法在两个来源里字段不一致。</p>
 *
 * <p>为什么要把状态一起返回：`degraded` 为 true 时结果是字面匹配，
 * 界面必须标明「非语义命中」，否则用户会高估检索质量。</p>
 *
 * @param query 用户的自然语言查询
 * @param limit 最多返回的候选数
 * @return 命中排序与检索状态；查询为空时返回空结果
 */
export async function searchTechniqueIds(
  query: string,
  limit = 40,
): Promise<{ ids: string[]; degraded: boolean; usable: boolean; reason?: string }> {
  const trimmed = query.trim()
  if (!trimmed) return { ids: [], degraded: false, usable: false }
  try {
    /* 只查 technique 与 capability：特效库页面不该被素材或参考片结果污染。
       后端在重建能力库索引时会清理失效条目，因此这里拿到的 ID 一定对应真实条目。 */
    const result = await studioHttpApi().retrieval.search({
      q: trimmed,
      kinds: 'technique,capability',
      limit,
    })
    return {
      /* 库内技法的 ID 形如 fx-dolly-zoom（`technique` 来源直接可用）；
         capability 来源的 ID 带前缀（lemo: / shotcraft: / scene:），
         它们尚未入库为特效条目，先不参与本地目录的排序。 */
      /* 必须按 id 去重：一个技法在索引里被切成多段（名称/用途/做法…），
         同一技法可能有 3–4 段同时命中。不去重就会在界面里重复出现同一张卡片，
         用户会以为库里有多条同名技法。保留首次出现的顺序 = 该技法最高分那一段的排名。 */
      ids: [
        ...new Set(
          result.hits.filter((hit) => hit.kind === 'technique').map((hit) => hit.id),
        ),
      ],
      degraded: result.degraded,
      usable: result.usable,
      reason: result.reason,
    }
  } catch {
    /* 网络或服务异常：这里静默退回本地字面匹配，由调用方照常过滤。
       检索是「让搜索更好」，不是「让搜索能用」—— 它挂掉不能连带搜索挂掉。 */
    return { ids: [], degraded: false, usable: false }
  }
}

/** 读取技法详情。 */
export async function getTechnique(id: string): Promise<FxTechnique | null> {
  try {
    const item = await studioHttpApi().library.fx.getTechnique(id)
    return toLocal(item as unknown as ServerFxTechnique)
  } catch {
    return null
  }
}

/** 用户状态：收藏与最近浏览。 */
export interface FxUserState {
  favorited: Set<string>
  /** 最近浏览，新的在前。 */
  recent: string[]
}

/**
 * 读用户状态。
 *
 * <p>服务端把 `userState` 挂在每条技法上，这里从列表里收集出来，
 * 避免再为一个「哪些被收藏了」单独拉一遍。</p>
 */
export async function loadUserState(): Promise<FxUserState> {
  const api = studioHttpApi().library.fx
  const favorited = new Set<string>()
  const recent: Array<{ id: string; at: string }> = []
  let cursor: string | null | undefined
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await api.listTechniques({ cursor: cursor ?? undefined, limit: 200 })
    for (const item of page.items) {
      const state = (item as unknown as ServerFxTechnique).userState
      if (state?.favorited) favorited.add(item.id)
      if (state?.lastViewedAt) recent.push({ id: item.id, at: state.lastViewedAt })
    }
    cursor = page.nextCursor
    if (!cursor) break
  }
  recent.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return { favorited, recent: recent.map((r) => r.id) }
}

/** 切换收藏。返回切换后的状态。 */
export async function setFavorite(id: string, favorited: boolean): Promise<boolean> {
  const state = await studioHttpApi().library.fx.updateState(id, { favorited })
  return state.favorited
}

/** 记一次浏览。失败不抛：记浏览失败不该打断用户看详情。 */
export async function markViewed(id: string): Promise<void> {
  try {
    await studioHttpApi().library.fx.updateState(id, { viewed: true })
  } catch {
    /* 浏览记录是锦上添花，失败静默 */
  }
}

/**
 * 把旧版 localStorage 里存的收藏推到服务端。
 *
 * <p>用户之前收藏过的技法不该因为换了存储就消失。逐个推送，失败的跳过并汇总 ——
 * 不因为一条失败而中断其余。</p>
 *
 * @param favoriteIds 旧版收藏的技法 ID
 * @returns 成功推送的数量
 */
export async function importLegacyFavorites(favoriteIds: string[]): Promise<number> {
  let pushed = 0
  for (const id of favoriteIds) {
    try {
      await setFavorite(id, true)
      pushed += 1
    } catch {
      /* 单条失败不影响其他 */
    }
  }
  return pushed
}

/** 供诊断：服务端当前技法总数。 */
export async function techniqueCount(): Promise<number> {
  const page = await studioHttpApi().library.fx.listTechniques({ limit: 1 })
  // total 缺失时不猜 0 —— 0 会被界面显示成「技法库是空的」。
  if (typeof page.total !== 'number') {
    throw new Error('服务端未返回技法总数')
  }
  return page.total
}

export type { ContractFxTechnique }

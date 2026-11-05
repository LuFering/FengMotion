import { useCallback, useEffect, useState } from 'react'
import { studioHttpApi, ApiError, type HarnessDescriptor, type HarnessModel } from '@/services/api'
import type { CapabilityStatus } from '@/types/contracts'
import { readDesktopRuntimeConfig } from '@/services/desktopBridge'

/**
 * DSH 接入状态。
 *
 * 判据是 `/api/capabilities` 的 `agent.status` —— 后端文档明确以它为准：
 *   · `接口清单-供前端改造.md` §3：「`agent` 接入 SDK 后应变成 `available`」
 *   · `harness集成与接口清单.md` §3.2：「`agent` 一项应按真实探测结果返回，而不是硬编码 `unavailable`」
 * 所以：
 *   · `unavailable` → **未接入**（当前真实状态）
 *   · `available`   → 已接入
 *   · `demo`        → 只有演示数据，不能当真实执行
 */
/**
 * `probing` = 还没探测完。
 *
 * 与 `unknown`（探测完了但读不到，是**结论**）必须分开：首屏探测要 1~3 秒
 * （后端要拉起 dsh 探一次），这段时间若报「状态未知」，用户看到的是
 * 每次刷新都闪一下「未接入 / 状态未知」，会以为坏了。还没测就别下结论。
 */
export type DshAccess = 'available' | 'demo' | 'unavailable' | 'unknown' | 'probing'

/**
 * 引擎清单的来源状态。
 *
 * 与「DSH 是否接入」是**两件事**，不能混：
 *   · `not_implemented` —— `/api/harnesses` 还没实现（404/501/503），后端文档标它 🔨「可做，未实现」
 *   · `failed`          —— 网络或 5xx
 *   · `ready`           —— 拿到了清单
 */
export type HarnessListState = 'loading' | 'ready' | 'not_implemented' | 'failed'

export interface HarnessProbe {
  /** DSH 是否接入（来自 `/api/capabilities` 的 agent 项）。 */
  access: DshAccess
  /** 引擎清单的读取状态（来自 `/api/harnesses`）。 */
  listState: HarnessListState
  harnesses: HarnessDescriptor[]
  cachedAt: string | null
  /** 失败/未实现时给人看的原因。 */
  note: string | null
  /** 后端给出的模型目录（按引擎 id 索引）。来自 `/api/harnesses/{id}/models`。 */
  modelsByHarness: Record<string, HarnessModel[]>
}

/** 模型目录的读取状态（与引擎清单一样分「没实现」和「读不到」）。 */
export type ModelListState = 'loading' | 'ready' | 'not_implemented' | 'failed'

/** 单个引擎最终呈现的可用性：把「DSH 是否接入」与「该引擎自身状态」合成一个结论。 */
export type HarnessAvailability = 'available' | 'not_connected' | 'misconfigured' | 'unknown' | 'checking'

/**
 * 把本地引擎 id 对上后端的 harness 条目。
 *
 * 为什么要模糊匹配：后端实测的 id 是 `dsh-sdk`（harness 集成文档 §3.1 的示例），
 * 而本地 `data/harnesses.ts` 用的是 `deepseek`（产品名）。两边不是同一套命名，
 * 直接按 id 比较会一个都匹配不上，把已接入的引擎误判成「状态未知」。
 *
 * 匹配顺序（先精确后模糊，避免把 claude 匹配到 dsh）：
 *   1. id 精确相等
 *   2. name 精确相等
 *   3. 本地 id 是后端 id 的一部分，或反之（`deepseek` ↔ `dsh-sdk` 不适用，
 *      但 `deepseek` ↔ `deepseek-account` 这类可以）
 *   4. 本地 id 出现在后端 name 里，或后端 id/name 出现在本地 id 里
 */
export function matchHarness(list: HarnessDescriptor[], localId: string) {
  const byId = list.find((h) => h.id === localId)
  if (byId) return byId
  const byName = list.find((h) => h.name === localId)
  if (byName) return byName
  const lower = localId.toLowerCase()
  return list.find(
    (h) =>
      h.id.toLowerCase().includes(lower) ||
      lower.includes(h.id.toLowerCase()) ||
      h.name.toLowerCase().includes(lower) ||
      lower.includes(h.name.toLowerCase()),
  )
}

/**
 * 合成单个引擎的可用性。
 *
 * 关键：**DSH 未接入时，所有引擎一律是「未接入」**，不管 `/api/harnesses` 有没有返回它 ——
 * 一个还没接上的 Agent 谈不上「可用」。反过来，DSH 已接入但该引擎自身 unavailable，
 * 才是「该引擎不可用」。
 *
 * `unknown` 只留给「确实无法判断」的情形（能力声明读不到），不是用来兜住「未接入」的。
 */
export function availabilityOf(
  probe: HarnessProbe,
  harnessId: string,
): { state: HarnessAvailability; note: string | null } {
  // 0) 还在探测 → 不下结论。首屏这段大约 1~3 秒，说「检测中」比说「未接入」诚实。
  if (probe.access === 'probing' || (probe.access === 'unknown' && probe.listState === 'loading')) {
    return { state: 'checking', note: null }
  }
  // 1) DSH 层面没接上 → 一律未接入（这是当前真实状态）
  if (probe.access === 'unavailable') {
    return { state: 'not_connected', note: 'DSH 尚未接入，引擎不能执行。' }
  }
  if (probe.access === 'demo') {
    return { state: 'not_connected', note: 'DSH 目前只有演示数据，不能执行真实任务。' }
  }
  // 2) 能力声明读不到 → 只能如实说未知
  if (probe.access === 'unknown') {
    return { state: 'unknown', note: probe.note ?? '读不到能力声明，无法判断是否已接入。' }
  }
  // 3) DSH 已接入，再看该引擎自身状态
  if (probe.listState !== 'ready') {
    return {
      state: 'unknown',
      note:
        probe.listState === 'not_implemented'
          ? '后端还没有引擎清单接口。'
          : probe.note ?? '读不到引擎清单。',
    }
  }
  const found = matchHarness(probe.harnesses, harnessId)
  /**
   * 后端清单里没有这个引擎 → **未接入**（不是「状态未知」）。
   *
   * 依据：后端 `/api/harnesses` 返回的是「本机真正装了的引擎」清单。
   * 清单里没有 = 本机没有这个引擎 = 未接入，这是**确定的结论**，不是「读不到」。
   * 只有「能力声明读不到」才是真的无法判断。
   */
  if (!found) return { state: 'not_connected', note: '本机未接入这个引擎。' }
  if (found.status === 'available') return { state: 'available', note: null }
  if (found.status === 'misconfigured') {
    return { state: 'misconfigured', note: found.note ?? '引擎配置有误。' }
  }
  return { state: 'not_connected', note: found.note ?? '该引擎未接入。' }
}

/**
 * 取某个引擎的模型列表。
 *
 * 返回 `{ models, source }`：
 *   · `source: 'server'` —— 后端给的目录（权威）
 *   · `source: 'none'`   —— 后端明确返回空（该引擎没有可用模型）
 *   · `source: 'unknown'` —— 读不到模型目录
 *
 * 注意：**不再回退到本地硬编码列表**。本地 `data/harnesses.ts` 的模型名是产品侧写的
 * （`deepseek-chat` / `deepseek-reasoner`），而 DSH 路由里实际只有 `deepseek-v4.1-flash`
 * （后端实测）。拿本地列表冒充后端目录，会让用户选一个根本不存在的模型，然后失败。
 */
export function modelsOf(
  probe: HarnessProbe,
  harnessId: string,
): { models: HarnessModel[]; source: 'server' | 'none' | 'unknown' } {
  // 后端清单里的 id 才是取模型的键（本地 id 与后端 id 可能是两套命名）
  const matched = matchHarness(probe.harnesses, harnessId)
  const key = matched?.id ?? harnessId
  const fromServer = probe.modelsByHarness[key]
  if (fromServer && fromServer.length > 0) {
    return {
      models: fromServer.map((m) => ({
        id: m.id,
        label: m.label || m.id,
        default: m.default,
        ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
      })),
      source: 'server',
    }
  }
  // 引擎清单里都没有这个引擎 → 没有模型
  if (probe.listState === 'ready' && !matched) {
    return { models: [], source: 'none' }
  }
  // 引擎在清单里但模型目录为空 → 明确没有可用模型
  if (probe.listState === 'ready' && matched && fromServer) {
    return { models: [], source: 'none' }
  }
  // 模型目录还没拉到 / 拉失败 → 未知
  return { models: [], source: 'unknown' }
}

/** 状态 → 界面文案。集中一处，避免各处自己拼。 */
export const AVAILABILITY_LABEL: Record<HarnessAvailability, string> = {
  available: '已接入',
  not_connected: '未接入',
  misconfigured: '配置有误',
  unknown: '状态未知',
  checking: '检测中…',
}

function readAgentStatus(payload: unknown): CapabilityStatus | null {
  if (typeof payload !== 'object' || payload === null) return null
  const agent = (payload as Record<string, unknown>).agent
  if (typeof agent !== 'object' || agent === null) return null
  const status = (agent as { status?: unknown }).status
  return status === 'available' || status === 'demo' || status === 'unavailable' ? status : null
}

/**
 * 读「DSH 是否接入」+「引擎清单」。
 *
 * 两个请求独立失败：能力声明读不到时 access=unknown，但引擎清单仍可能读到，反之亦然。
 * 刻意不做「拿不到就回退本地硬编码引擎清单」—— 本地 `data/harnesses.ts` 是展示信息，
 * 不是探测结果，拿它冒充可用性等于把未接入说成已接入。
 */
export function useHarnesses() {
  const [probe, setProbe] = useState<HarnessProbe>({
    // 初始必须是 probing 而不是 unknown：unknown 是「测了但读不到」的结论，
    // 拿它当初始值会让首屏误报「状态未知」。
    access: 'probing',
    listState: 'loading',
    harnesses: [],
    cachedAt: null,
    note: null,
    modelsByHarness: {},
  })

  const refresh = useCallback(async () => {
    setProbe((prev) => ({ ...prev, access: 'probing', listState: 'loading', note: null }))

    // 两个请求互不阻塞，也不互相拖垮
    const [accessResult, listResult] = await Promise.allSettled([
      studioHttpApi().system.capabilities(),
      studioHttpApi().harnesses.list(),
    ])

    let access: DshAccess = 'unknown'
    let accessNote: string | null = null
    if (accessResult.status === 'fulfilled') {
      const status = readAgentStatus(accessResult.value)
      access = status ?? 'unknown'
      if (status === null) accessNote = '能力声明里没有 agent 项。'
    } else {
      accessNote =
        accessResult.reason instanceof Error ? accessResult.reason.message : '读不到能力声明'
    }

    let listState: HarnessListState = 'ready'
    let harnesses: HarnessDescriptor[] = []
    let cachedAt: string | null = null
    let listNote: string | null = null
    if (listResult.status === 'fulfilled') {
      harnesses = listResult.value.items
      cachedAt = listResult.value.cachedAt
    } else {
      const cause = listResult.reason
      // 404 / 501 / 503 = 端点尚未实现（后端文档把 /api/harnesses 标为 🔨）
      const notImplemented =
        cause instanceof ApiError &&
        (cause.isNotFound ||
          cause.code === 'capability_unavailable' ||
          cause.code === 'agent_unavailable')
      listState = notImplemented ? 'not_implemented' : 'failed'
      listNote = notImplemented
        ? '后端还没有引擎清单接口。'
        : cause instanceof Error
          ? cause.message
          : '读不到引擎清单'
    }

    /**
     * 模型目录：逐个引擎拉 `/api/harnesses/{id}/models`。
     *
     * 为什么要单独拉：模型目录不在 `/api/harnesses` 里（后端实测该端点只给引擎元信息）。
     * 拉失败按引擎记，不影响其他引擎 —— 一个引擎的模型探测失败不该让整份清单作废。
     */
    const modelsByHarness: Record<string, HarnessModel[]> = {}
    await Promise.all(
      harnesses.map(async (h) => {
        try {
          modelsByHarness[h.id] = await studioHttpApi().harnesses.models(h.id)
        } catch {
          // 读不到就留空：这个引擎的模型列表为空，界面据此显示「模型目录未知」
        }
      }),
    )

    setProbe({ access, listState, harnesses, cachedAt, note: accessNote ?? listNote, modelsByHarness })
  }, [])

  /**
   * 挂载时探测一次。不直接调 refresh()：它内部同步 setState，
   * react 规则（set-state-in-effect）会判定为级联渲染。
   *
   * 先等桌面壳注入后端地址（initDesktopApiBase）：地址没就绪就发请求，
   * 会打到默认的 8080 而不是壳里配的地址，探测结果就是错的。
   */
  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(() => readDesktopRuntimeConfig())
      .then(() => {
        if (!cancelled) return refresh()
      })
      .catch(() => {
        if (!cancelled) return refresh()
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  return { ...probe, refresh }
}

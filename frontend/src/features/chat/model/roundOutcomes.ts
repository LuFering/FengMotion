/**
 * 按轮次保存「本轮未改动工程」这类结果 —— 工作台侧栏与完整对话区共用。
 *
 * <p>为什么需要独立一份：此前它是工作台里的**单条** state，
 * 新一轮结论会直接替换上一轮。于是：
 * · 同一会话两轮都有结论时，只能看到最后一轮；
 * · 切走再回来，历史结论全部丢失；
 * · 完整对话区根本读不到。</p>
 *
 * <p>现在按 <strong>项目 + 会话 + 用户消息 id</strong> 存一份映射，
 * 两处界面都按「这条回复属于哪条用户消息」去查。缺少可靠身份的历史记录
 * **不猜**：查不到就不显示。</p>
 */

/** 一条「本轮未改动工程」结果。 */
export interface RoundOutcome {
  /** 结论正文（agent 的提问/说明） */
  reply: string
  /** 触发这一轮的用户消息 id —— **唯一可靠的归属依据** */
  userMessageId: string
  /** 创作请求 id，用于核对是不是同一次任务 */
  requestId?: string
  /** 产生时间，用于同 key 覆盖时保留最新 */
  at: number
}

type Store = Map<string, RoundOutcome>
const stores = new Map<string, Store>()
const listeners = new Map<string, Set<() => void>>()

/** 作用域 key：同一项目同一会话内隔离，绝不跨会话串味。 */
function scopeKey(projectId: string | null | undefined, sessionId: string | null | undefined): string {
  return `${projectId ?? ''}::${sessionId ?? ''}`
}

function storeOf(scope: string): Store {
  let s = stores.get(scope)
  if (!s) {
    s = new Map()
    stores.set(scope, s)
  }
  return s
}

/** 每个 scope 的变更版本号：useSyncExternalStore 需要稳定的快照值。 */
const versions = new Map<string, number>()
function storeVersion(scope: string): number {
  return versions.get(scope) ?? 0
}

function emit(scope: string) {
  versions.set(scope, storeVersion(scope) + 1)
  const set = listeners.get(scope)
  if (!set) return
  for (const fn of set) {
    try { fn() } catch { /* 单个订阅者出错不影响其他 */ }
  }
}

/**
 * 记录一轮结果。
 *
 * <p>没有 `userMessageId` 的结果**拒绝写入** —— 没有归属依据的记录
 * 一旦存进来，渲染时只能靠猜，那正是要避免的。</p>
 */
export function recordRoundOutcome(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
  outcome: { reply: string; userMessageId?: string; requestId?: string },
): boolean {
  if (!outcome.userMessageId) return false
  const scope = scopeKey(projectId, sessionId)
  storeOf(scope).set(outcome.userMessageId, {
    reply: outcome.reply,
    userMessageId: outcome.userMessageId,
    ...(outcome.requestId ? { requestId: outcome.requestId } : {}),
    at: Date.now(),
  })
  emit(scope)
  return true
}

/** 读取某一轮的结果；没有就返回 null（**不猜**）。 */
export function getRoundOutcome(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
  userMessageId: string | null | undefined,
): RoundOutcome | null {
  if (!userMessageId) return null
  return storeOf(scopeKey(projectId, sessionId)).get(userMessageId) ?? null
}

/** 清掉某一轮的结果（用户关闭提示时）。 */
export function clearRoundOutcome(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
  userMessageId: string | null | undefined,
): void {
  if (!userMessageId) return
  const scope = scopeKey(projectId, sessionId)
  if (storeOf(scope).delete(userMessageId)) emit(scope)
}

/** 订阅某个项目+会话的结果变化。 */
export function subscribeRoundOutcomes(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
  listener: () => void,
): () => void {
  const scope = scopeKey(projectId, sessionId)
  let set = listeners.get(scope)
  if (!set) {
    set = new Set()
    listeners.set(scope, set)
  }
  set.add(listener)
  return () => {
    const cur = listeners.get(scope)
    if (cur) {
      cur.delete(listener)
      if (cur.size === 0) listeners.delete(scope)
    }
  }
}

/**
 * 判断「这条 AI 回复」是否就是某一轮结果的归属回复。
 *
 * <p>判据是消息自带的 `taskId`（创作回复保存时它存的就是触发它的用户消息 id）。
 * 没有 `taskId` 的消息**一律不认** —— 宁可少显示，也不贴错轮次。</p>
 */
export function outcomeBelongsToReply(
  aiMessage: { id: string; role: string; taskId?: string },
  messages: Array<{ id: string; role: string; taskId?: string }>,
  userMessageId: string | undefined,
): boolean {
  if (!userMessageId) return false
  /* 1) 回复自带 taskId：直接比对，不依赖顺序 */
  if (aiMessage.taskId) return aiMessage.taskId === userMessageId
  /* 2) 回复没带 taskId（本地占位消息）：在列表里找声明了该归属的回复，
        只认那一条；存在别的那条就不显示 */
  const owner = messages.find(
    (m) => m.role === 'ai' && m.taskId && m.taskId === userMessageId,
  )
  if (owner) return owner.id === aiMessage.id
  /* 3) 没有任何声明 → 降级不显示 */
  return false
}

/* ── React 绑定 ─────────────────────────────────────────────── */

import { useSyncExternalStore, useCallback } from 'react'

/**
 * 订阅某个项目+会话的全部轮次结果。
 *
 * <p>返回 `getFor(userMessageId)` —— 界面按「这条回复对应的用户消息」去取，
 * 取不到就是 null（不猜）。</p>
 */
export function useRoundOutcomes(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
): (userMessageId: string | undefined) => RoundOutcome | null {
  /* 用版本号驱动重渲染：store 内部是 Map，直接返回它不会被 useSyncExternalStore 认作变化 */
  const subscribe = useCallback(
    (onChange: () => void) => subscribeRoundOutcomes(projectId, sessionId, onChange),
    [projectId, sessionId],
  )
  const getSnapshot = useCallback(
    () => storeVersion(scopeKey(projectId, sessionId)),
    [projectId, sessionId],
  )
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return useCallback(
    (userMessageId: string | undefined) => getRoundOutcome(projectId, sessionId, userMessageId),
    [projectId, sessionId],
  )
}

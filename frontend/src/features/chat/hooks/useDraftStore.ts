import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { SessionDraft } from '@/features/chat/model/draft/draftTypes'
import {
  clearSessionDraft, draftKey, flushSessionDraftText, getSessionDraft, listeners, setSessionDraft,
} from '@/features/chat/model/draft/draftStore'

/* 草稿存储的实现按职责拆在 model/draft/ 下（类型、等价判断、本机持久化、逐字段版本、存储本体），
   这里只放 React hook，并转出原有接口，旧的 import 路径不用改。 */
export type { DraftAttachment, TargetSnapshot, SessionDraft } from '@/features/chat/model/draft/draftTypes'
export type { EditableField, FieldVersions } from '@/features/chat/model/draft/draftVersions'
export { isEquivalentSnapshotForTest } from '@/features/chat/model/draft/draftEquivalence'
export {
  draftKey, getSessionDraft, setSessionDraft, currentFieldVersions, noteDraftInput,
  clearSentPartsOnly, markDraftSent, flushSessionDraftText, clearSessionDraft,
} from '@/features/chat/model/draft/draftStore'

/** React Hook：用于组件绑定指定会话的草稿 */
export function useSessionDraft(projectId?: string | null, sessionId?: string | null) {
  const key = draftKey(projectId, sessionId)
  /* 会话尚未解析出来时（activeThread 还在加载），不要用 __global__ 键初始化草稿：
     那会在内存里占位一份空草稿，等真正的 projectId/sessionId 到了，
     getSessionDraft 仍可能先命中那份占位，导致刷新后草稿文字显示不出来。
     这里在没有 sessionId 时先给空值，等 key 就绪后由下面的 effect 真正读取。 */
  const [draft, setDraftState] = useState<SessionDraft>(() =>
    sessionId ? getSessionDraft(projectId, sessionId) : { text: '', attachments: [], targetSnapshot: null, continuationScopeMode: null, pendingSubmission: null, updatedAt: Date.now() })
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    /* 会话 id 还没就绪时不要读：那时 key 是 __global__，
       读出来会把空草稿写进状态，覆盖掉真正的草稿。 */
    if (!sessionId) return
    // 切换会话或项目时，自动同步对应草稿
    setDraftState(getSessionDraft(projectId, sessionId))

    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }

    const handler = () => {
      setDraftState({ ...getSessionDraft(projectId, sessionId) })
    }

    set.add(handler)
    return () => {
      set?.delete(handler)
      if (set && set.size === 0) {
        listeners.delete(key)
      }
    }
  }, [key, projectId, sessionId])

  const updateDraft = useCallback(
    (updater: Partial<SessionDraft> | ((prev: SessionDraft) => Partial<SessionDraft>)) => {
      return setSessionDraft(projectId, sessionId, updater)
    },
    [projectId, sessionId]
  )

  const flushText = useCallback(
    (text: string) => {
      flushSessionDraftText(projectId, sessionId, text)
    },
    [projectId, sessionId]
  )

  const clear = useCallback(() => {
    clearSessionDraft(projectId, sessionId)
  }, [projectId, sessionId])

  return useMemo(
    () => ({
      draft,
      updateDraft,
      flushText,
      clearDraft: clear,
      key,
    }),
    [draft, updateDraft, flushText, clear, key]
  )
}

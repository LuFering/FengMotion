import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import { useHarnessSelection } from '@/features/harness/hooks/useHarnessSelection'
import { useHarnesses, modelsOf } from '@/features/harness/hooks/useHarnesses'
import { useCallback } from 'react'
import type { WorkbenchProps } from '@/features/workbench/Workbench'

export interface UseDraftTextArgs {
  boundSessionId: string | null
  chat: WorkbenchProps['chat']
  projectId: WorkbenchProps['projectId']
}

/** 从 Workbench.tsx 的 Workbench 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useDraftText({ boundSessionId, chat, projectId }: UseDraftTextArgs) {
  const sessionDraft = useSessionDraft(projectId, boundSessionId)
  const engineSelection = useHarnessSelection()
  const engineProbe = useHarnesses()
  const engineModels = modelsOf(engineProbe, engineSelection.harness).models
  const submissionEngine = { ...engineSelection,
    model: engineModels.find((m) => m.id === engineSelection.model)?.id
      ?? engineModels.find((m) => m.default)?.id ?? engineModels[0]?.id,
  }

  // 统一程序化草稿写入：同时更新 React 状态与 sessionDraft 统一草稿库
  const setWorkbenchDraftText = useCallback((text: string) => {
    chat.setDraft(text)
    sessionDraft.updateDraft({ text })
  }, [chat, sessionDraft])

  const appendWorkbenchDraftText = useCallback((extra: string) => {
    const current = sessionDraft.draft.text || chat.draft
    const next = current.trim() ? `${current}\n${extra}` : extra
    chat.setDraft(next)
    sessionDraft.updateDraft({ text: next })
  }, [chat, sessionDraft])
  return { sessionDraft, appendWorkbenchDraftText, submissionEngine, setWorkbenchDraftText }
}

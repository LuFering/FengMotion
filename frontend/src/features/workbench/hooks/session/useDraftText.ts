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

/** 工作台输入草稿与提交引擎：程序化写入或追加草稿（同步到会话草稿库），并解析本次提交用的引擎与模型。 */
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

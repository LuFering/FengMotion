import type * as React from 'react'
import { copyText } from '@/features/fx/model/fxRecipe'
import { OUTBOX_KEY } from '@/features/fx/model/fxLibraryStore'
import type { FxTechnique } from '@/features/fx/model/fxTechniques'

export interface UseFxRecipeActionsArgs {
  copyTimer: React.RefObject<number | null>
  current: FxTechnique | null
  setCopied: React.Dispatch<React.SetStateAction<'idle' | 'ok' | 'fail'>>
  setWorkflowFor: React.Dispatch<React.SetStateAction<FxTechnique | null>>
  showToast: (msg: string) => void
  workflowFor: FxTechnique | null
}

/** 技法详情里的操作：复制做法说明，以及把「用到某个项目」记入本地意向清单（尚未接入执行）。 */
export function useFxRecipeActions({ copyTimer, current, setCopied, setWorkflowFor, showToast, workflowFor }: UseFxRecipeActionsArgs) {
  async function copyRecipe() {
    if (!current) return
    try {
      await navigator.clipboard.writeText(copyText(current))
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied('idle'), 1800)
  }

  function recordWorkflowIntent(projectId: string, projectName: string) {
    if (!workflowFor) return
    try {
      const raw = localStorage.getItem(OUTBOX_KEY)
      const list = raw ? (JSON.parse(raw) as unknown[]) : []
      list.push({
        techniqueId: workflowFor.id,
        techniqueName: workflowFor.name,
        projectId,
        projectName,
        at: new Date().toISOString(),
      })
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(list))
    } catch {
      /* 记录失败不阻塞 */
    }
    setWorkflowFor(null)
    showToast(`已记入意向清单：${workflowFor.name} → ${projectName}（调用链未接入，不会执行）`)
  }
  return { copyRecipe, recordWorkflowIntent }
}

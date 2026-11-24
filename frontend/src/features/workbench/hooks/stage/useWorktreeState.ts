import { useCallback, useEffect, useState } from 'react'
import { readWorktreeState, type WorktreeState } from '@/features/workbench/services/worktreeClient'

export function useWorktreeState(projectId: string, enabled: boolean) {
  const [saved, setSaved] = useState<{ key: string; state: WorktreeState } | null>(null)
  const refresh = useCallback(async () => {
    if (!enabled) return
    const state = await readWorktreeState(projectId)
    if (state.projectId === projectId) setSaved({ key: projectId, state })
  }, [projectId, enabled])
  useEffect(() => {
    let active = true
    const update = () => {
      if (document.hidden) return
      void readWorktreeState(projectId).then(state => {
        if (active && state.projectId === projectId) setSaved({ key: projectId, state })
      }).catch(() => undefined)
    }
    if (!enabled) return
    update()
    const timer = window.setInterval(update, 5000)
    window.addEventListener('focus', update)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', update) }
  }, [projectId, enabled])
  return { state: enabled && saved?.key === projectId ? saved.state : null, refresh }
}

import { useRef, useState } from 'react'
import type { TaskRequest } from '@/services/studioApi'
import { newReviewId, readWorkbenchReview, saveWorkbenchReview, type WorkbenchReviewState } from '@/services/workbenchReviewService'

export function useWorkbenchReview(projectId: string, original: string) {
  const [state, setState] = useState(() => readWorkbenchReview(projectId))
  const stateRef = useRef(state)
  const [saved, setSaved] = useState(true)
  const commit = (change: (state: WorkbenchReviewState) => WorkbenchReviewState) => {
    const next = change({ ...stateRef.current, original: stateRef.current.original || original })
    stateRef.current = next
    setState(next)
    setSaved(saveWorkbenchReview(projectId, next))
  }
  const brief = { original: state.original || original, corrections: state.corrections, keepNotes: state.keepNotes }
  return {
    ...state, brief, saved,
    addCorrection(text: string) {
      if (!text.trim()) return
      commit((s) => ({ ...s, corrections: [...s.corrections, { id: newReviewId(), text: text.trim(), createdAt: new Date().toISOString() }] }))
    },
    setKeepNotes(keepNotes: string) { commit((s) => ({ ...s, keepNotes })) },
    record(request: TaskRequest) {
      const id = newReviewId()
      const snapshot = structuredClone({ ...request, feedbackId: id, creativeBrief: brief })
      commit((s) => ({ ...s, opinions: [{ id, createdAt: new Date().toISOString(), request: snapshot, status: 'open' }, ...s.opinions] }))
      return snapshot
    },
    resolve(id: string, reviewedVisualId?: string) {
      commit((s) => ({ ...s, opinions: s.opinions.map((o) => o.id === id ? { ...o, status: 'resolved', resolvedAt: new Date().toISOString(), reviewedVisualId } : o) }))
    },
    reopen(id: string) {
      commit((s) => ({ ...s, opinions: s.opinions.map((o) => o.id === id ? { ...o, status: 'open', resolvedAt: undefined, reviewedVisualId: undefined } : o) }))
    },
  }
}
export type WorkbenchReview = ReturnType<typeof useWorkbenchReview>

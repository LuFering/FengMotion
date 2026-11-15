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
    setOriginal(original: string) { commit((s) => ({ ...s, original: original.trim() })) },
    setKeepNotes(keepNotes: string) { commit((s) => ({ ...s, keepNotes: keepNotes.trim() })) },
    record(request: TaskRequest, options?: {
      includeBrief?: boolean
      baseVersion?: number
      baseVisualId?: string
      baseOrigin?: 'scene' | 'workflow' | 'editor'
      resultVersion?: number
      resultVisualId?: string
      resultOrigin?: 'scene' | 'workflow' | 'editor'
      resultSummary?: string
    }) {
      const id = newReviewId()
      const snapshot = structuredClone({ ...request, feedbackId: id, ...(options?.includeBrief === false ? {} : { creativeBrief: brief }) })
      commit((s) => ({
        ...s,
        opinions: [
          {
            id,
            createdAt: new Date().toISOString(),
            request: snapshot,
            status: 'open',
            ...(options?.baseVersion !== undefined ? { baseVersion: options.baseVersion } : {}),
            ...(options?.baseVisualId ? { baseVisualId: options.baseVisualId } : {}),
            ...(options?.baseOrigin ? { baseOrigin: options.baseOrigin } : {}),
            ...(options?.resultVersion !== undefined ? { resultVersion: options.resultVersion } : {}),
            ...(options?.resultVisualId ? { resultVisualId: options.resultVisualId } : {}),
            ...(options?.resultOrigin ? { resultOrigin: options.resultOrigin } : {}),
            ...(options?.resultSummary ? { resultSummary: options.resultSummary } : {}),
          },
          ...s.opinions,
        ],
      }))
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

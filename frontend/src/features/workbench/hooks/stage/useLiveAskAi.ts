import { useEffect, useRef } from 'react'
import type { SessionDraft } from '@/features/chat/hooks/useDraftStore'
import type { LiveAiSubmit, SourceTargetContext } from '@/api/sourceRender'

/**
 * 实时画面里的「交给 AI」：把带源码位置的要求按「修改工程」发出去。
 *
 * <p>提交去向由草稿决定（见 chat/model/sendPlan.ts）：草稿若还停在「提问」或挂着旧的画面目标，
 * 这句话会变成普通对话或改错地方。所以先把草稿改成「修改 · 不带旧目标」，
 * 等草稿真的更新了再提交 —— 提交读的是当次渲染的草稿，同一拍里改完立刻提交会读到旧值。</p>
 */
export function useLiveAskAi({ draft, updateDraft, submit, onSent }: {
  draft: SessionDraft
  updateDraft: (patch: Partial<SessionDraft>) => unknown
  submit: LiveAiSubmit
  onSent?: () => void
}) {
  const pending = useRef<{ prompt: string; target?: SourceTargetContext; resolve: (ok: boolean) => void } | null>(null)
  const submitRef = useRef(submit)
  useEffect(() => { submitRef.current = submit })

  const ready = (d: SessionDraft) => d.intentAction === 'modify' && !d.targetSnapshot && d.continuationScopeMode !== 'target_required'

  useEffect(() => {
    const p = pending.current
    if (!p || !ready(draft)) return
    pending.current = null
    void submitRef.current(p.prompt, p.target).then((ok) => { if (ok) onSent?.(); p.resolve(ok) }).catch(() => p.resolve(false))
  }, [draft, onSent])

  return (prompt: string, target?: SourceTargetContext) => new Promise<boolean>((resolve) => {
    if (ready(draft)) {
      void submitRef.current(prompt, target).then((ok) => { if (ok) onSent?.(); resolve(ok) }).catch(() => resolve(false))
      return
    }
    pending.current?.resolve(false)
    pending.current = { prompt, target, resolve }
    updateDraft({
      intentAction: 'modify',
      targetSnapshot: null,
      /* 源码位置已经写在要求里，范围按整个工程，由 AI 只改那一处 */
      ...(draft.continuationScopeMode === 'target_required' ? { continuationScopeMode: 'whole_confirmed' as const } : {}),
    })
  })
}

import { useEffect, useState } from 'react'
import { studioHttpApi } from '@/api'
import '@/features/chat/styles/components/creation-progress.css'

/** 实时预告属于运行中的创作任务，不当作最终回复保存。 */
export function CreationProgress({ projectId, sessionId }: { projectId?: string | null; sessionId?: string | null }) {
  const [progress, setProgress] = useState<{ scope: string; text: string } | null>(null)
  const scope = `${projectId ?? ''}:${sessionId ?? ''}`
  useEffect(() => {
    if (!projectId || !sessionId) return
    let alive = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const result = await studioHttpApi().workflowContext.creationProgress(projectId, sessionId)
        if (alive) setProgress(result.requestId && result.text.trim() ? { scope, text: result.text } : null)
      } catch {
        if (alive) setProgress(null)
      } finally {
        if (alive) timer = window.setTimeout(() => void poll(), 2000)
      }
    }
    void poll()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [projectId, sessionId, scope])
  if (!progress || progress.scope !== scope) return null
  return <div className="creation-progress" role="status"><strong>正在进行</strong><div>{progress.text}</div></div>
}

import type * as React from 'react'
import { useEffect } from 'react'
import { studioHttpApi } from '@/api'
import type { WorkbenchProps } from '@/features/workbench/Workbench'

export interface UseUnsavedRepliesArgs {
  boundSessionId: string | null
  projectId: WorkbenchProps['projectId']
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setUnsavedReplies: React.Dispatch<React.SetStateAction<{ userMessageId: string; reply: string; sessionId: string; requestId?: string }[]>>
  threads: WorkbenchProps['threads']
  unsavedReplies: { userMessageId: string; reply: string; sessionId: string; requestId?: string }[]
}

/** 从 Workbench.tsx 的 Workbench 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useUnsavedReplies({ boundSessionId, projectId, setNotice, setUnsavedReplies, threads, unsavedReplies }: UseUnsavedRepliesArgs) {
  // 跨刷新与多轮可靠恢复待补存回复：以服务端任务记录为依据，合并本地未落盘项
  useEffect(() => {
    if (!projectId) return
    let active = true
    const loadUnsaved = async () => {
      try {
        const serverList = await studioHttpApi().workflowContext.unsavedReplies(projectId, boundSessionId ?? undefined)
        if (!active) return
        const map = new Map<string, { userMessageId: string; reply: string; sessionId: string; requestId?: string }>()
        serverList.forEach(item => {
          map.set(item.userMessageId, {
            userMessageId: item.userMessageId,
            reply: item.reply,
            sessionId: item.sessionId,
            requestId: item.requestId,
          })
        })
        try {
          const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
          if (raw) {
            const localMap: Record<string, { userMessageId: string; reply: string; sessionId: string; requestId?: string }> = JSON.parse(raw)
            Object.values(localMap).forEach(item => {
              if (!boundSessionId || item.sessionId === boundSessionId) {
                if (!map.has(item.userMessageId)) {
                  map.set(item.userMessageId, item)
                }
              }
            })
          }
        } catch {}
        if (active) {
          setUnsavedReplies(Array.from(map.values()))
        }
      } catch {
        try {
          const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
          if (raw && active) {
            const localMap: Record<string, { userMessageId: string; reply: string; sessionId: string; requestId?: string }> = JSON.parse(raw)
            const list = Object.values(localMap).filter(item => !boundSessionId || item.sessionId === boundSessionId)
            setUnsavedReplies(list)
          }
        } catch {
          if (active) setUnsavedReplies([])
        }
      }
    }
    void loadUnsaved()
    return () => { active = false }
  }, [projectId, boundSessionId])

  const handleRetrySaveReply = async (targetItem?: { userMessageId: string; reply: string; sessionId: string; requestId?: string }) => {
    const item = targetItem ?? unsavedReplies[0]
    if (!item || !threads) return
    try {
      await threads.sendMessage(item.sessionId, item.reply, {
        role: 'assistant',
        taskId: item.userMessageId,
        idempotencyKey: `idem-reply-${item.userMessageId}`,
      })
      if (item.requestId) {
        try {
          await studioHttpApi().workflowContext.syncReply(projectId, item.requestId)
        } catch { /* 辅助标记失败不阻断 */ }
      }
      try {
        const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
        if (raw) {
          const map = JSON.parse(raw)
          delete map[item.userMessageId]
          localStorage.setItem(`fm_unsaved_replies_${projectId}`, JSON.stringify(map))
        }
      } catch { /* 忽略本地存储清理异常 */ }
      setUnsavedReplies(prev => prev.filter(r => r.userMessageId !== item.userMessageId))
      setNotice('该回复已成功同步到会话。')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setNotice(`重试保存失败：${msg}`)
    }
  }

  const handleRetrySaveAllReplies = async () => {
    if (!unsavedReplies.length || !threads) return
    let count = 0
    for (const item of [...unsavedReplies]) {
      try {
        await threads.sendMessage(item.sessionId, item.reply, {
          role: 'assistant',
          taskId: item.userMessageId,
          idempotencyKey: `idem-reply-${item.userMessageId}`,
        })
        if (item.requestId) {
          try {
            await studioHttpApi().workflowContext.syncReply(projectId, item.requestId)
          } catch {}
        }
        try {
          const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
          if (raw) {
            const map = JSON.parse(raw)
            delete map[item.userMessageId]
            localStorage.setItem(`fm_unsaved_replies_${projectId}`, JSON.stringify(map))
          }
        } catch {}
        count++
      } catch (err) {
        console.warn('批量补存中断：', err)
        break
      }
    }
    // 重新加载待补存列表
    try {
      const remaining = await studioHttpApi().workflowContext.unsavedReplies(projectId, boundSessionId ?? undefined)
      setUnsavedReplies(remaining)
    } catch {}
    setNotice(`已完成 ${count} 条回复的同步保存。`)
  }
  return { handleRetrySaveReply, handleRetrySaveAllReplies }
}

import type * as React from 'react'
import type { SourceTargetContext } from '@/api/sourceRender'
import { resolveSendPlanFromDraft } from '@/features/chat/model/sendPlan'
import { studioHttpApi } from '@/api'
import { notifyProjectRendered } from '@/features/project/services/projectRenderEvents'
import { chatStreamManager } from '@/features/chat/services/chatStreamManager'
import { useEffect } from 'react'
import { useStageTimeRange } from '@/features/workbench/components/StageTimeRange'
import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import type { CapabilityResult } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { AgentReference, AgentTask, ModificationConstraints, TaskRequest } from '@/api/studioApi'
import type { Session } from '@/features/chat/hooks/useSessions'
import type { PendingSubmit } from '@/features/workbench/model/workbenchSession'
import type { TimeSpan } from '@/features/workbench/model/timeRange'
import type { ExecutableLocalTargetResult } from '@/features/workbench/services/workbenchTargetEvaluator'

export interface UseWorkbenchSubmitArgs {
  adjustPendingConfirm: boolean
  aiModifyTargetCapability: CapabilityResult
  boundSessionId: string | null
  capturedPreview: React.RefObject<{ id: string; image: string } | null>
  chat: WorkbenchProps['chat']
  currentProjectRef: AgentReference
  currentSession: Session | null
  holdQueue: boolean
  isLiveTask: (task: AgentTask | null | undefined) => boolean
  pendingSubmits: PendingSubmit[]
  projectId: WorkbenchProps['projectId']
  range: ReturnType<typeof useStageTimeRange>
  references: AgentReference[]
  sessionDraft: ReturnType<typeof useSessionDraft>
  setConstraints: React.Dispatch<React.SetStateAction<ModificationConstraints>>
  setHoldQueue: React.Dispatch<React.SetStateAction<boolean>>
  setLoopSpan: React.Dispatch<React.SetStateAction<boolean>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPendingSubmits: React.Dispatch<React.SetStateAction<PendingSubmit[]>>
  setPreviewLocation: React.Dispatch<React.SetStateAction<{ visualId: string; timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>>
  setRealModifyError: React.Dispatch<React.SetStateAction<string>>
  setReferences: React.Dispatch<React.SetStateAction<AgentReference[]>>
  setScope: React.Dispatch<React.SetStateAction<'project' | 'scene' | 'selection'>>
  spanModifyCapability: CapabilityResult
  startNow: (item: { prompt: string; request: TaskRequest; messageId?: string }) => string
  submissionEngine: { model: string; harness: string; reasoningEffort?: string }
  submitRealModify: (prompt: string, span?: TimeSpan, previewImage?: string, target?: SourceTargetContext) => Promise<boolean>
  submitTimeSpan: (span: TimeSpan, requirement: string) => Promise<boolean>
  targetEvaluation: ExecutableLocalTargetResult
  tasks: WorkbenchProps['tasks']
  threads: WorkbenchProps['threads']
}

/**
 * 工作台意见的发送：按草稿判定去向，提问走会话回复流，修改按目标分到画面、时间段或整片修改；
 * 另含确认整片修改、任务结束后自动启动排队意见、停止任务时按住队列。
 */
export function useWorkbenchSubmit({ adjustPendingConfirm, aiModifyTargetCapability, boundSessionId, capturedPreview, chat, currentProjectRef, currentSession, holdQueue, isLiveTask, pendingSubmits, projectId, range, references, sessionDraft, setConstraints, setHoldQueue, setLoopSpan, setNotice, setPendingSubmits, setPreviewLocation, setRealModifyError, setReferences, setScope, spanModifyCapability, startNow, submissionEngine, submitRealModify, submitTimeSpan, targetEvaluation, tasks, threads }: UseWorkbenchSubmitArgs) {
  /**
   * 提交修改：优先真实后端，只有用户显式选择演示才走 Mock。
   *
   * <p>此前所有提交都进演示路径，界面看起来「能用」，实际什么都没改。
   * 现在默认打真实接口；演示入口保留为独立按钮，标注清楚。</p>
   */
  const submit = async (prompt: string, sourceTarget?: SourceTargetContext): Promise<boolean> => {
    /* 去向由唯一判定函数决定 —— 与对话区发送、与胶囊显示共用同一份结果。
       这里不再自己读一遍意图：两套顺序一旦分叉，界面就会说谎。 */
    const plan = resolveSendPlanFromDraft(sessionDraft.draft, Boolean(projectId))

    /* 继续调整保护模式缺目标：这里也要拦，不能因为工作台默认显示「全局工程」就当成整片修改。 */
    if (plan.kind === 'blocked') {
      setRealModifyError('继续调整已清空上一轮目标。请在播放器中框选画面或选择时间段；若确需调整整片工程，请点击【确认整片修改】后再提交。')
      return false
    }

    if (sourceTarget) {
      if (sourceTarget.projectId !== projectId) { setRealModifyError('源码目标不属于当前项目，请重新选择'); return false }
      return submitRealModify(prompt, undefined, undefined, sourceTarget)
    }

    /* 明确提问意图：仅作为会话对话发送并启动真实 AI 回复，绝不触发视频修改 */
    const isQueryIntent = plan.kind === 'chat'
    if (isQueryIntent) {
      const effectiveSid = boundSessionId || currentSession?.id || null
      if (!effectiveSid) {
        setRealModifyError('当前项目尚未绑定或选择会话，无法发起会话提问。请先在对话区选择会话。')
        return false
      }

      const target = references.find((ref) => ref.role === 'target')
      const targetLabel = sessionDraft.draft.targetSnapshot?.label || target?.label || '当前目标'
      const queryReferences: any[] = [
        ...(references || []).map((r) => ({ ...r, role: 'context' as const })),
        {
          id: `ref-query-${projectId}`,
          role: 'context' as const,
          kind: 'project' as const,
          projectId,
          label: targetLabel,
          action: 'workflow_query',
        },
      ]

      try {
        let savedMsgId: string | undefined = undefined
        if (threads) {
          const savedMsg = await threads.sendMessage(effectiveSid, prompt, {
            idempotencyKey: crypto.randomUUID(),
            references: queryReferences as any,
          })
          savedMsgId = savedMsg.id
          chat.appendMessage(savedMsg)
        } else {
          savedMsgId = chat.addUserMessage(prompt, undefined, projectId, effectiveSid)
        }

        // 启动真实 AI 流式回复：明确附带 projectId 与 sessionId，确保在工作台过滤白名单内实时可见
        const aiId = chat.startAiMessage({ demo: false, projectId, sessionId: effectiveSid })
        try {
          const streamHandle = studioHttpApi().chat.stream(effectiveSid, {
            onReasoning: (_mid, delta) => {
              chat.appendAiReasoning(aiId, delta)
            },
            onDelta: (_mid, delta, replaceFrom) => {
              chat.appendAiText(aiId, delta, replaceFrom)
            },
            onTodo: (todos) => {
              chat.setAiTodos(aiId, todos)
            },
            /* 工具调用必须实时接上 —— 原先这里没有 onStatus，侧栏执行过程中
               看不到任何步骤，只有 onCompleted 之后重读历史才有。
               用户在最关心「AI 到底改了什么」的地方，反而看不到执行过程。 */
            onStatus: (status) => {
              chat.recordToolCall(aiId, status)
            },
            /* 这一轮改动了工程：后端自动渲染，出片后刷新版本，画面区直接播新片 */
            onRender: (render) => {
              if (render.message) setNotice(render.message)
              if (render.state === 'rendered') notifyProjectRendered(projectId, render.version)
            },
            onCompleted: (message) => {
              chatStreamManager.notifyCompleted(effectiveSid)
              chat.finishAiMessage(aiId, message.text, message.toolCalls, message.reasoning, message.todos, message.deliverables)
              if (threads) {
                void threads.loadMessages(effectiveSid, { force: true })
              }
            },
            onError: (err) => {
              chatStreamManager.notifyError(effectiveSid, err.message)
              chat.failAiMessage(aiId, err.message)
            },
            onStopped: () => {
              /* 服务端已确认这一轮停止（收到 stopped 事件），这里只做本地清理。
                 **不再调用 chatStreamManager.stop** —— 停止请求由用户点击时发出，
                 这里再调一次会重复打 /stop，也会把已是 stopped 的状态重新广播。
                 与对话区同一套语义：用户消息在启动回复流之前已写入服务端，
                 停止后不保存的只是这条未完成的 AI 回复，撤掉占位避免半截回复留在侧栏。 */
              chat.removeMessage(aiId)
              setNotice('已停止生成。你的消息已保存，这条回复没有保存。')
            },
          }, submissionEngine)
          chatStreamManager.register({
            sessionId: effectiveSid,
            userMessageId: savedMsgId,
            aiMessageId: aiId,
            stop: () => streamHandle.close(),
            startedAt: Date.now(),
          })
        } catch (streamErr: unknown) {
          const msg = streamErr instanceof Error ? streamErr.message : String(streamErr)
          chatStreamManager.notifyError(effectiveSid, msg)
          chat.failAiMessage(aiId, `AI 回复流连接失败：${msg}`)
        }

        setNotice(`已就「${targetLabel}」在会话中发起提问。`)
        return true
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setRealModifyError(`提问发送失败：${msg}`)
        return false
      }
    }

    /* 真实路径是默认。失败已由 submitRealModify 写好错误并保留输入；
       这里**不回退演示** —— 静默换成假执行会让用户以为改动生效了。 */
    // 1. 若处于继续调整保护模式且没有有效可执行局部目标，严格拦截！
    if (adjustPendingConfirm) {
      setRealModifyError('继续调整已清空上一轮目标。请在播放器中框选画面或选择时间段；若确需调整整片工程，请点击【确认整片修改】后再提交。')
      return false
    }

    // 2. 检查选中的目标是否属于不支持局部修改的类型，明确报错拦截，绝不放行滑入无范围整片修改！
    if (targetEvaluation.status === 'unsupported_target') {
      setRealModifyError(targetEvaluation.reason)
      return false
    }

    // 3. 严格按支持的局部修改能力分发执行：
    if (targetEvaluation.status === 'valid_frame') {
      /* 提交前再核一次能力：界面状态可能因服务变化而滞后，真正发请求时必须以当下为准。 */
      if (!aiModifyTargetCapability.allowed) {
        setRealModifyError(aiModifyTargetCapability.reason || '当前无法提交画面修改')
        return false
      }
      return submitRealModify(prompt, undefined, targetEvaluation.image)
    }
    if (targetEvaluation.status === 'valid_span') {
      if (!spanModifyCapability.allowed) {
        setRealModifyError(spanModifyCapability.reason || '当前无法提交时间段修改')
        return false
      }
      const requirement = targetEvaluation.target.id.startsWith('clip:')
        ? `修改目标：${targetEvaluation.target.label}。\n${prompt}`
        : prompt
      return submitTimeSpan(targetEvaluation.span, requirement)
    }

    // 4. 只有当明确没有任何局部目标（targetEvaluation.status === 'none' 且已确认整片或常规制作）时，才调用整片修改
    return submitRealModify(prompt)
  }

  const handleConfirmWholeProject = () => {
    // 1. 显式设置项目目标，并将原本的局部 target 降级为 context 作为参考，杜绝 buildRequest 回退到当前画面
    setReferences((old) => [
      currentProjectRef,
      ...old
        .filter((ref) => ref.id !== currentProjectRef.id)
        .map((ref) => (ref.role === 'target' && ref.kind !== 'project' ? { ...ref, role: 'context' as const } : ref)),
    ])
    // 2. 清除局部范围约束（重置 limitToSelection 为 false）
    setConstraints((old) => ({
      ...old,
      limitToSelection: false,
    }))
    // 3. 清理局部选区与画面抓取
    range.reset()
    setLoopSpan(false)
    capturedPreview.current = null
    setPreviewLocation(null)
    // 4. 明确修改范围为整片工程
    setScope('project')
    setRealModifyError('')
    // 5. 同步更新共享草稿：确认整片模式，清空局部目标快照
    sessionDraft.updateDraft({
      continuationScopeMode: 'whole_confirmed',
      targetSnapshot: null,
    })
    setNotice('已确认本轮修改范围为整片工程，已设置项目目标并清除局部选区约束。')
  }
  useEffect(() => {
    if (holdQueue) return
    const active = tasks.active?.task
    if (isLiveTask(active)) return
    const head = pendingSubmits.find((p) => p.status === 'waiting')
    if (!head) return
    setPendingSubmits((old) => old.filter((p) => p.key !== head.key))
    startNow(head)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.active?.task.status, holdQueue])
  /* 右栏（对话流 / 任务记录）里点停止：中止任务，并按住排队 —— 别在用户刚叫停时
     就把排队的下一条悄悄启动。底部托盘的停止走同一处理。 */
  const cancelTaskAndHold = (taskId: string) => {
    tasks.cancel(taskId)
    setHoldQueue(true)
  }
  return { cancelTaskAndHold, handleConfirmWholeProject, submit }
}

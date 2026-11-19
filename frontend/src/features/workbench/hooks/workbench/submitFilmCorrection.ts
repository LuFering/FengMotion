import { timeSpanBrief } from '@/features/workbench/model/timeRange'
import { studioHttpApi } from '@/api'
import { formatMediaTime } from '@/features/workbench/model/previewGeometry'
import type { ChatMessage as ContractMessage } from '@/api/contracts'
import { libraryReferences, creationIntent } from '@/features/creation/services/creationResources'
import { submitCreation } from '@/features/creation/services/creationClient'
import type { ChatMessage as ChatItem } from '@/features/chat/hooks/useChat'
import { recordRoundOutcome } from '@/features/chat/model/roundOutcomes'
import { invalidateBackfill } from '@/features/chat/services/roundOutcomeBackfill'
import type { UseRealModifyArgs, RealModifyInput } from '@/features/workbench/hooks/workbench/useRealModify'

/** 修改前读到的工程上下文与当前场景（由主流程统一读取一次）。 */
export interface FilmCorrectionBase {
  context: Awaited<ReturnType<ReturnType<typeof studioHttpApi>['workflowContext']['state']>>
  baseline: Awaited<ReturnType<UseRealModifyArgs['tasks']['currentScene']>>
  /** 写进 corrections.md 的修改说明（带时间段时已标出是哪一段） */
  correctionText: string
}

/**
 * Remotion 工程的修改路径：意见写进 corrections.md，由 agent 改工程源码，再渲染出新的版本。
 *
 * <p>从 submitRealModify 原样拆出：每条分支都会返回，异常在这里就地处理。</p>
 */
export async function submitFilmCorrection(
  { buildRequest, capturedPreview, chat, constraints, correctionAttempt, currentSceneState, ensureBoundSession, pendingSubmissionRef, projectId, rereadRuns, review, sceneVersions, setAgentReply, setAwaitingActive, setComparison, setCurrentSceneState, setExecutionPhase, setNotice, setPendingPlayback, setRealModifyError, setSelectedArtifactId, setSelectedVisual, setUnsavedReplies, setUsedResources, submissionEngine, tasks, threads, updatePendingSubmission, viewedPreview }: UseRealModifyArgs,
  { prompt, span, previewImage, context, baseline, correctionText }: RealModifyInput & FilmCorrectionBase,
): Promise<boolean> {
  try {
    // 确保有绑定的服务端会话，若无则自动为当前项目创建；失败则明确报错阻断
    const sessionResult = await ensureBoundSession(prompt)
    if (sessionResult.error || !sessionResult.sessionId) {
      setRealModifyError(`会话未保存：${sessionResult.error || '未能创建项目会话'}。输入已保留，未提交创作修改。`)
      return false
    }
    const effectiveSid = sessionResult.sessionId
    const targetedCorrection = Boolean(span || previewImage)
    const userPromptText = span ? `${prompt}\n（${formatMediaTime(span.start)}–${formatMediaTime(span.end)}）` : prompt

    /* 提前构建请求引用，确保服务端持久化明确的创作目标引用与 workflow_modify 类型标记，
       彻底防止切回对话区时被误判为未回复的普通聊天而自动二次起流 */
    const request = buildRequest(prompt, 'modify', constraints)
    const targetRef: NonNullable<ContractMessage['references']>[number] = {
      id: `ref-target-${projectId}`,
      role: 'target',
      kind: 'project',
      projectId,
      label: span ? `时间段修改（${formatMediaTime(span.start)}–${formatMediaTime(span.end)}）` : '工作台创作修改',
      action: 'workflow_modify',
    }
    const creationReferences: NonNullable<ContractMessage['references']> = [targetRef,...libraryReferences(request.references ?? [])] as NonNullable<ContractMessage['references']>

    // 核心点 1 & 2：真实持久化写入服务端会话，解耦幂等键与任务状态，重试时复用已落库消息
    const promptKey = JSON.stringify([effectiveSid,projectId,userPromptText,request.references,request.constraints,previewImage,baseline.scene?.version,submissionEngine])
    const isRetrySamePrompt = pendingSubmissionRef.current?.promptKey === promptKey
    let userMessageId = isRetrySamePrompt && pendingSubmissionRef.current?.userMessageId ? pendingSubmissionRef.current.userMessageId : null
    const idempotencyKey = isRetrySamePrompt && pendingSubmissionRef.current?.idempotencyKey ? pendingSubmissionRef.current.idempotencyKey : crypto.randomUUID()

    if (!userMessageId) {
      const nextPending = {
        promptKey,
        idempotencyKey,
        sessionId: effectiveSid,
        createdAt: Date.now(),
      }
      updatePendingSubmission(nextPending)

      if (threads) {
        try {
          const savedMsg = await threads.sendMessage(effectiveSid, userPromptText, {
            idempotencyKey,
            references: creationReferences,
          })
          userMessageId = savedMsg.id
          updatePendingSubmission({ ...nextPending, userMessageId })
        } catch (sendErr: unknown) {
          const msg = sendErr instanceof Error ? sendErr.message : String(sendErr)
          setRealModifyError(`会话消息未能写入服务端：${msg}。输入内容已保留，未提交创作修改。`)
          return false
        }
      } else {
        userMessageId = `m-wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        updatePendingSubmission({ ...nextPending, userMessageId })
      }

      // 单一稳定 ID 写入前端 chat，消除多处各造 ID 导致的重复显示
      chat.appendMessage({
        id: userMessageId,
        role: 'user',
        text: userPromptText,
        projectId,
        sessionId: effectiveSid,
        references: creationReferences,
        at: Date.now(),
      })
    }

    /* 先落盘再让 agent 改：意见写进 corrections.md 是持久依据，
       agent 下一轮（甚至换个会话）都能读到。只发对话不落盘，
       刷新一次就没了，而用户以为已经提了。 */
    if (context.initialized && !targetedCorrection) {
      await studioHttpApi().workflowContext.recordCorrection(projectId, correctionText)
      review.addCorrection(correctionText)
    } else if (!context.initialized) {
      await studioHttpApi().workflowContext.init(projectId, review.brief.original || prompt)
      if (!targetedCorrection && review.brief.original && review.brief.original !== prompt) {
        await studioHttpApi().workflowContext.recordCorrection(projectId, correctionText)
        review.addCorrection(correctionText)
      }
    }
    setNotice(targetedCorrection ? '正在提交修改请求，正在核对目标版本…' : '修改意见已记入。Agent 正在按它改工程…')

    /* 只传三库资源：project/scene/frame 这些由原有链路处理，
       agent 侧只认「用户明确交给它的素材/参考片/特效」。
       时间段作为明确参数追加在意图末尾 —— 混在用户那句话里，agent 只能猜。 */
    const baseIntent = creationIntent(prompt, request.references ?? [], constraints, review.keepNotes)
    const previewPath = viewedPreview ? (new URL(viewedPreview.file, window.location.href).searchParams.get('path') ?? viewedPreview.file.split('?')[0]) : null
    const intent = span ? `${baseIntent}\n\n${timeSpanBrief(span, prompt, { version: viewedPreview?.origin === 'scene' ? viewedPreview.revision : currentSceneState?.version ?? null, file: previewPath?.split('/').pop() ?? null })}` : previewImage
      ? `${baseIntent}\n\n随本次请求附带的是用户选择时的完整画面；如目标包含 bbox，请按归一化坐标定位该区域，无法识别时先询问。`
      : baseIntent
    const attemptKey = JSON.stringify([projectId, baseline.scene?.version, intent, capturedPreview.current?.id, request.references, constraints, submissionEngine])
    if (targetedCorrection && correctionAttempt.current?.key !== attemptKey) {
      correctionAttempt.current = { key: attemptKey, id: crypto.randomUUID() }
      try { sessionStorage.setItem(`fm-correction-attempt:${projectId}`, JSON.stringify(correctionAttempt.current)) } catch { /* 保留本页的重试标识 */ }
    }
    const currentTaskId = targetedCorrection ? correctionAttempt.current?.id : userMessageId
    updatePendingSubmission({
      promptKey,
      idempotencyKey,
      sessionId: effectiveSid,
      userMessageId,
      taskId: currentTaskId,
      createdAt: Date.now(),
    })
    setExecutionPhase('analyzing')
    const phasePollTimer = window.setInterval(async () => {
      try {
        if (currentTaskId) {
          const st = await studioHttpApi().workflowContext.creation(projectId, currentTaskId)
          if (st && st.phase) {
            setExecutionPhase(st.phase)
          }
        }
      } catch {
        // 忽略轮询网络抖动
      }
    }, 2000)
    let result
    try {
      result = await submitCreation({
        projectId, intent, references:libraryReferences(request.references ?? []), previewImage,
        baseVersion:targetedCorrection ? baseline.scene?.version : undefined,
        correction:targetedCorrection ? correctionText : undefined,
        requestId:currentTaskId!, sessionId:effectiveSid, userMessageId,
        selection:submissionEngine,
      }, (job)=>setExecutionPhase(job.phase))
    } finally {
      window.clearInterval(phasePollTimer)
      setExecutionPhase('')
    }
    if (targetedCorrection) {
      correctionAttempt.current = null
      try { sessionStorage.removeItem(`fm-correction-attempt:${projectId}`) } catch { /* 存储不可用时无需清理 */ }
      review.addCorrection(correctionText)
    }
    if (result.state === 'failed') {
      setAwaitingActive(false)
      const errorMsg = result.reply || '创作任务执行失败，工程代码未产生新版本。'
      setRealModifyError(errorMsg)
      setNotice(`创作未成功：${errorMsg}`)
      updatePendingSubmission(null)
      return false
    }

    setAgentReply(result.reply)
    if (result.reply) {
      // 核心点 1：AI 回复真实持久化写入服务端会话，保证更换浏览器或清缓存后多轮回复不丢失
      let serverAiId = `m-ai-${userMessageId}`
      if (threads) {
        try {
          const savedAi = await threads.sendMessage(effectiveSid, result.reply, {
            role: 'assistant',
            taskId: userMessageId,
            idempotencyKey: `idem-reply-${userMessageId}`,
          })
          serverAiId = savedAi.id
          setUnsavedReplies(prev => prev.filter(r => r.userMessageId !== userMessageId))
          try {
            const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
            if (raw) {
              const map = JSON.parse(raw)
              delete map[userMessageId ?? '']
              localStorage.setItem(`fm_unsaved_replies_${projectId}`, JSON.stringify(map))
            }
          } catch { /* 忽略清理异常 */ }
        } catch (aiSaveErr) {
          console.warn('[Workbench] 助手回复写入服务端失败，使用本地与服务端双重兜底:', aiSaveErr)
          const item = {
            userMessageId: userMessageId ?? '',
            reply: result.reply,
            sessionId: effectiveSid,
            requestId: currentTaskId ?? '',
          }
          setUnsavedReplies(prev => [...prev.filter(r => r.userMessageId !== item.userMessageId), item])
          try {
            const raw = localStorage.getItem(`fm_unsaved_replies_${projectId}`)
            const map = raw ? JSON.parse(raw) : {}
            map[item.userMessageId] = { ...item, timestamp: Date.now() }
            localStorage.setItem(`fm_unsaved_replies_${projectId}`, JSON.stringify(map))
          } catch { /* 忽略本地存储写入异常 */ }
        }
      }
      const aiItem: ChatItem = {
        id: serverAiId,
        role: 'ai',
        text: result.reply,
        projectId,
        sessionId: effectiveSid,
        /* 带上**触发这条回复的用户消息 id**。
           不带的话，本地即时显示的消息没有身份，归属判断只能等服务端
           历史重新读回才成立 —— 那之前提示会缺失（补存失败时更是永远缺）。
           服务端保存时也是用同一个值作 taskId，两处必须一致。 */
        ...(userMessageId ? { taskId: userMessageId } : {}),
        at: Date.now(),
      }
      chat.appendMessage(aiItem)
      threads?.appendExtraMessage(effectiveSid, aiItem)
    }
    setUsedResources(result.resources ?? [])

    /* agent 只提问、没有改动工程：没有产物也没有新版本。
       这时绝不能提示「已渲染出版本 vN」—— 旧工程本来就能渲，
       渲出来的还是上一版画面，用户会误以为改动生效了。
       界面上给出「等待补充信息」，并把 agent 的问题留在对话里，同时如实记入审阅记录。 */
    if (result.state === 'awaiting_info') {
      /* 按**轮次**记进共享 store：项目 + 会话 + 用户消息 id。
         拿不到 userMessageId 时不写（不猜），界面上就不显示。 */
      const recorded = recordRoundOutcome(projectId, effectiveSid, {
        reply: result.reply,
        ...(result.userMessageId ? { userMessageId: result.userMessageId } : {}),
        ...(result.requestId ? { requestId: result.requestId } : {}),
      })
      /* 本页产生了新轮次 → 回填缓存立刻失效（否则切走再回来不再拉取） */
      invalidateBackfill(projectId, effectiveSid)
      setAwaitingActive(recorded)
      rereadRuns()
      setRealModifyError('')
      setNotice('Agent 本轮没有改动工程，因此没有渲染新片。')
      const baseVer = baseline.scene?.version
      const baseVisual = viewedPreview && viewedPreview.origin === 'scene' && viewedPreview.revision === baseVer ? viewedPreview : undefined
      review.record(request, {
        baseVersion: baseVer,
        baseVisualId: baseVisual?.id,
        baseOrigin: baseVisual?.origin ?? 'scene',
        resultSummary: result.reply ? `Agent 提问：${result.reply}` : 'Agent 本轮未修改工程，等待补充信息',
      })
      updatePendingSubmission(null)
      return true
    }

    setAwaitingActive(false)
    const baseVer = baseline.scene?.version
    const baseVisual = viewedPreview && viewedPreview.origin === 'scene' && viewedPreview.revision === baseVer ? viewedPreview : undefined
    review.record(request, {
      baseVersion: baseVer,
      baseVisualId: baseVisual?.id,
      baseOrigin: baseVisual?.origin ?? 'scene',
      resultVersion: result.version ?? undefined,
      resultOrigin: 'scene',
      resultSummary: result.reply,
    })
    if (span && result.version !== null) setPendingPlayback({ version: result.version, start: span.start })
    setSelectedVisual(null); setSelectedArtifactId(null); setComparison(null)
    setNotice(result.version !== null
      ? `Agent 已完成修改，渲染出版本 v${result.version}。`
      : 'Agent 已返回渲染结果，正在更新版本列表。')
    /* 刷新版本与画面：让用户立刻看到新一版，并能与上一版对比。 */
    void sceneVersions.refresh(true)
    const probe = await tasks.currentScene(projectId)
    if (probe.scene) setCurrentSceneState(probe.scene)
    rereadRuns()
    setRealModifyError('')
    updatePendingSubmission(null)
    return true
  } catch (error) {
    /* 失败必须说清是「意见没记下」还是「agent 没改出来」——
       两者下一步完全不同。 */
    const message = error instanceof Error ? error.message : String(error)
    setRealModifyError(`Agent 修改未完成：${message}。意见可能已写入项目，重试前请先检查执行记录与项目状态。`)
    setNotice(`修改未完成：${message.slice(0, 120)}`)
    return false
  }
}

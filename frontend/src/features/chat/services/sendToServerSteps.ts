import { messageFingerprint, creationFingerprint } from '@/features/chat/model/sendFingerprint'
import { markDraftSent, clearSentPartsOnly } from '@/features/chat/hooks/useDraftStore'
import { studioHttpApi } from '@/api'
import { submitCreation } from '@/features/creation/services/creationClient'
import { resolveReplySaveState, replySaveNotice } from '@/features/chat/model/roundRestoreRules'
import { recordRoundOutcome } from '@/features/chat/model/roundOutcomes'
import { invalidateBackfill } from '@/features/chat/services/roundOutcomeBackfill'
import { correctionTextFor, previewImageOf, requestIdFor } from '@/features/chat/model/sendRequest'
import { findStoredReply } from '@/features/chat/services/sendSupport'
import type { SessionDraft } from '@/features/chat/hooks/useDraftStore'
import type { MessageReferences } from '@/features/chat/model/sendRequest'
import type { ConversationProps } from '@/features/chat/Conversation'
import type { UseSendMessageArgs } from '@/features/chat/hooks/reply/useSendMessage'

/* sendToServer 里的两个阶段，从原函数原样拆出。
   原来在阶段里直接 return 结束整次发送；拆出后改成返回布尔值，由调用方照旧 return，控制流不变。 */

export interface BaseVersionCheck {
  isModifyIntent: boolean
  targetSnapshot: SessionDraft['targetSnapshot']
  isSubmissionVisible: () => boolean
  showSubmissionError: (message: string) => void
}

/** 修改意图带基准版本时，保存用户消息之前先核对工程当前版本。返回 false 表示已拦下，本次发送到此为止。 */
export async function confirmBaseVersion(
  { activeThread, setStageLeadVersion }: UseSendMessageArgs,
  { isModifyIntent, targetSnapshot, isSubmissionVisible, showSubmissionError }: BaseVersionCheck,
): Promise<boolean> {
  // 1. 若是修改意图且带有明确基准版本，必须在保存用户消息之前严格核对工程当前最新版本！
  // 绝不先存消息再报错，杜绝在会话历史中留下未执行修改的孤立消息
  if (isModifyIntent && targetSnapshot && activeThread?.projectId) {
    if (targetSnapshot.version !== null && targetSnapshot.version !== undefined) {
      const targetVer = Number(targetSnapshot.version)
      try {
        /* 【基准必须与显示同源】提交前的「工程当前版本」以**当前场景版本**为准。
           原实现先用 creation().version —— 那是「上一轮创作产出的版本」，
           工程可能又往前走了；它甚至可能落后于场景版本，导致
           「界面显示 v18、校验按 v17 比」，两边结论不一致。

           顺序：当前场景版本（权威）→ 场景版本历史最大值（兜底）→ 不猜。 */
        let confirmedVer: number | null = null
        try {
          const scene = await studioHttpApi().task.currentScene(activeThread.projectId)
          if (scene?.initialized && typeof scene.version === 'number') {
            confirmedVer = Number(scene.version)
          }
        } catch { /* 读不到就走下一步 */ }

        /* 【不得用历史最大值完成确认】场景版本列表里最高的一版**不等于**
           当前工程版本：工程可能已经改到 v17，而这一版还没渲出片，
           列表最高仍是 v16。拿它当「当前工程版本」会让提交前校验
           放行一个其实已过期的基准。
           所以这里**只**认 currentScene 的权威值；读不到就保持 null，
           由下面分支明确阻止并说明原因。 */
        if (confirmedVer !== null) {
          if (isSubmissionVisible()) setStageLeadVersion(confirmedVer)
          if (targetVer < confirmedVer) {
            showSubmissionError(`目标引用的基准版本（v${targetVer}）已过期，工程当前最新版本为 v${confirmedVer}。新版画面与时间轴可能已变动，请点击输入框上方胶囊核对后再提交。`)
            return false
          }
        } else {
          showSubmissionError(`未能确认工程当前版本（目标引用基准版本为 v${targetVer}）。为防止基于错误基准进行修改，请检查网络或重新选择画面目标后再提交。`)
          return false
        }
      } catch (verErr: unknown) {
        const msg = verErr instanceof Error ? verErr.message : String(verErr)
        showSubmissionError(`未能确认工程当前版本（${msg}）。为防止基于错误基准进行修改，请稍后重试。`)
        return false
      }
    }
  }
  return true
}

export interface CreationRound {
  isModifyIntent: boolean
  text: string
  sessionId: string
  targetSnapshot: SessionDraft['targetSnapshot']
  creationReferences: MessageReferences
  messageIdFp: ReturnType<typeof messageFingerprint>
  key: string
  saved: Awaited<ReturnType<ConversationProps['threads']['sendMessage']>>
  isRetryOfPending: boolean
  sentSnapshot: Parameters<typeof clearSentPartsOnly>[2]
  isSubmissionVisible: () => boolean
  showSubmissionError: (message: string) => void
}

/** 修改意图：用户消息落库后发起创作并落盘回复。返回 true 表示本次发送已在这里结束（含失败与复用旧任务）。 */
export async function runCreationRound(
  { activeThread, chat, effectiveEffort, effectiveModel, harnessId, idemKeyRef, idemTextRef, props, selectedHarness, sessionDraft, setReplySaveRetry }: UseSendMessageArgs,
  { isModifyIntent, text, sessionId, targetSnapshot, creationReferences, messageIdFp, key, saved, isRetryOfPending, sentSnapshot, isSubmissionVisible, showSubmissionError }: CreationRound,
): Promise<boolean> {
  // 3. 若用户明确选择修改视频（含带目标快照修改或已确认的整片续改），真实触发后端创作修改任务；若仅为提问，则走普通对话回复
  if (isModifyIntent && activeThread?.projectId) {
    const correctionText = correctionTextFor(text, targetSnapshot?.rangeSpan)
    const validPreviewImg = previewImageOf(targetSnapshot?.previewImage)

    /* 【关键】只有「同一份内容的原样重试」才能复用 requestId。
       用户改了要求再发，那是一个**新的创作请求**，必须用新的 requestId ——
       否则会把新要求提交成上一轮的任务，或复用到旧任务状态上、
       把用户刚写的新内容丢掉。判据是完整发送快照（isRetryOfPending）。 */
    /* 创作请求身份：入参就是下面真正要 POST 的那几个字段。 */
    const creationIdFp = creationFingerprint({
      projectId: activeThread.projectId,
      intent: text.trim(),
      references: creationReferences,
      previewImage: validPreviewImg ?? null,
      baseVersion: targetSnapshot?.version ?? null,
      correction: correctionText,
      selection: { harness: selectedHarness?.id ?? harnessId, model: effectiveModel, reasoningEffort: effectiveEffort ?? undefined },
    })
    /* 【连接层核对】只有当这次创作字段与上次记录**完全一致**时才复用旧任务。
       isRetryOfPending 保证「是同一条消息」；creationIdFp 保证「是同一份创作请求」。
       两者都成立才允许把旧任务状态当成这次的结果 ——
       否则会出现「新要求提交后却显示旧任务已完成」。 */
    const recordedCreationFp = sessionDraft.draft.pendingSubmission?.creationFingerprint
    /* 必须**确认**创作字段一致才复用旧任务。
       旧记录没有 creationFingerprint 时无法确认 —— 不能默认放行
       （那等于把「不知道」当成「一致」，会把新要求接到旧任务上）。 */
    const oldReqId = (isRetryOfPending && recordedCreationFp !== undefined
      && recordedCreationFp === creationIdFp)
      ? sessionDraft.draft.pendingSubmission?.requestId
      : null
    const reqId = requestIdFor(oldReqId)

    /* 【发起前先落盘恢复信息】。
       原先 pendingSubmission 只在 create() 失败或抛错后才写 ——
       若请求仍在等待时用户刷新页面，身份全丢，重发会多落一条用户消息、
       并新建一个创作任务。所以这里在**发请求之前**先把恢复所需的三项
       写进草稿（消息 id、消息幂等键、创作 requestId）。
       失败分支随后会用更完整的内容覆盖它，二者不冲突。 */
    sessionDraft.updateDraft({
      pendingSubmission: {
        requestId: reqId,
        promptKey: messageIdFp,
        messageFingerprint: messageIdFp,
        creationFingerprint: creationIdFp,
        idempotencyKey: key,
        sessionId,
        userMessageId: saved.id,
        createdAt: Date.now(),
        targetSnapshot,
      },
    })

    // 重试前置幂等检查：若服务端已有该请求且正在运行或已完成，直接复用状态，不重复调用 create
    if (oldReqId) {
      try {
        const existing = await studioHttpApi().workflowContext.creation(activeThread.projectId, reqId)
        if (existing && (existing.state === 'running' || existing.state === 'rendered')) {
          idemKeyRef.current = null
          idemTextRef.current = null
          if (isSubmissionVisible()) chat.setDraft('')
          /* 这条分支同样要登记「这段文字已发出」再清草稿 ——
             它清草稿后直接 return，不走下面的成功路径；
             漏登记的话输入框的迟来 flush 会把原文写回草稿
             （探针实测：markDraftSent 从未被调用，草稿却已被清空）。 */
          markDraftSent(activeThread.projectId, sessionId, text)
          /* 只清「这次发出去的那份」：用户若已输入新内容则保留。
             附件也交给同一个函数判断 —— 无条件 setAttachments([]) 会把
             用户在等待期间新加的附件一起清掉。 */
          clearSentPartsOnly(activeThread.projectId, sessionId, sentSnapshot)
          if (isSubmissionVisible()) chat.appendMessage(saved)
          return true
        }
      } catch {
        // 未找到历史任务，继续执行发起
      }
    }

    try {
      const outcome = await submitCreation({
        projectId: activeThread.projectId, intent:text.trim(), references:creationReferences as any,
        previewImage:validPreviewImg, baseVersion:targetSnapshot?.version ?? undefined,
        correction:correctionText, requestId:reqId, sessionId, userMessageId:saved.id,
        selection:{harness:selectedHarness?.id ?? harnessId,model:effectiveModel,reasoningEffort:effectiveEffort ?? undefined},
      })
      /* 从**对话区**发起的创作：结果要落两处，缺一处界面就会说谎。
         1. AI 回复写进会话 —— 工作台一直是显式 sendMessage 落库的，
            对话区此前没有这一步，于是「发起后当场看不到回复，
            刷新一次才出现」。实测确认。
         2. 轮次结论写进共享 store —— 此前只有工作台写、对话区只读。

         身份核对与工作台同一口径：
         · 会话：用**这次请求自己带的 sessionId**（发起这轮创作的就是它），
           不拿别的会话顶替；
         · 消息：后端回显的 userMessageId 必须等于这次落库的用户消息 id，
           不等就说明不是这一轮，宁可不写。 */
      if (outcome.reply && outcome.state !== 'failed') {
        try {
          const savedAi = await props.threads.sendMessage(sessionId, outcome.reply, {
            role: 'assistant',
            taskId: saved.id,
            idempotencyKey: `idem-reply-${saved.id}`,
          })
          /* 用服务端返回的真实消息 id 追加，别自造一个本地 id ——
             刷新后同一条会以另一个 id 再出现一次。 */
          if (isSubmissionVisible()) chat.appendMessage({
            id: savedAi.id,
            role: 'ai',
            text: outcome.reply,
            projectId: activeThread.projectId,
            sessionId,
            /* 带上触发这条回复的用户消息 id：两处界面都按它查轮次结论 */
            taskId: saved.id,
            at: Date.now(),
          })
        } catch (replyErr) {
          /* 【保存失败 ≠ 一定没保存】后端可能在返回前就已自动落库
             （或这次请求其实成功、只是响应没回来）。所以不能凭这一个异常
             断言结果，必须回头核对服务端**实际**有没有这条回复。
             未确认落库时，界面要明确标出「没存进会话」并给重试入口 ——
             像正常回复一样显示，用户就无从判断，也无从补救。 */
          const cause = replyErr instanceof Error ? replyErr.message : String(replyErr)
          const lookup = await findStoredReply(sessionId, saved.id, outcome.reply)
          const saveState = resolveReplySaveState(lookup)
          if (saveState === 'saved' && lookup.kind === 'found') {
            /* 服务端确实有：用真实 id 显示，不标失败 */
            if (isSubmissionVisible()) chat.appendMessage({
              id: lookup.messageId,
              role: 'ai',
              text: lookup.text,
              projectId: activeThread.projectId,
              sessionId,
              taskId: saved.id,
              at: Date.now(),
            })
          } else {
            /* 未保存(absent) 或 结果未知(unknown)：都要显示可见状态 + 重试，
               但文案必须不同 —— unknown 时不能说「没有存进会话」。 */
            const localId = `m-ai-${saved.id}`
            console.warn(`[Conversation] 创作回复保存状态=${saveState}:`, cause)
            if (isSubmissionVisible()) chat.appendMessage({
              id: localId,
              role: 'ai',
              text: outcome.reply,
              projectId: activeThread.projectId,
              sessionId,
              taskId: saved.id,
              at: Date.now(),
              failed: replySaveNotice(saveState, cause.slice(0, 80)) ?? undefined,
            })
            if (isSubmissionVisible()) setReplySaveRetry({
              sessionId,
              userMessageId: saved.id,
              reply: outcome.reply,
              localId,
            })
          }
        }
      }
      if (outcome.state === 'awaiting_info' && outcome.userMessageId
          && outcome.userMessageId === saved.id) {
        recordRoundOutcome(activeThread.projectId, sessionId, {
          reply: outcome.reply ?? '',
          userMessageId: outcome.userMessageId,
          ...(outcome.requestId ? { requestId: outcome.requestId } : {}),
        })
        /* 本页刚产生了新轮次：缓存里的时间点已经旧了，主动失效。
           不失效的话，切走再切回来会因为「缓存没过期」而不再拉取，
           别的窗口/后台刚写入的结果也就一直看不到。 */
        invalidateBackfill(activeThread.projectId, sessionId)
      }
      if (outcome.state === 'failed') {
        const errText = outcome.reply || '视频修改任务未能成功执行'
        showSubmissionError(errText)
        sessionDraft.updateDraft({
          pendingSubmission: {
            requestId: reqId,
            /* 存真实消息请求身份；创作身份单独记一份，便于核对
               「新消息是否错配到旧任务」。 */
            promptKey: messageIdFp,
            messageFingerprint: messageIdFp,
            creationFingerprint: creationIdFp,
            idempotencyKey: key,
            sessionId,
            userMessageId: saved.id,
            createdAt: Date.now(),
            error: errText,
            targetSnapshot,
          }
        })
        return true
      }
    } catch (taskErr: unknown) {
      const msg = taskErr instanceof Error ? taskErr.message : String(taskErr)
      showSubmissionError(`消息已送达会话，制作结果尚未完成确认：${msg}`)
      sessionDraft.updateDraft({
        pendingSubmission: {
          requestId: reqId,
          /* 存完整指纹而不是「会话+项目+文字」：
               重试身份要按整份请求判定，只记文字会让
               「改了目标/附件但文字没变」被误认成同一请求。 */
            promptKey: messageIdFp,
          messageFingerprint: messageIdFp,
          creationFingerprint: creationIdFp,
          idempotencyKey: key,
          sessionId,
          userMessageId: saved.id,
          createdAt: Date.now(),
          error: msg,
          targetSnapshot,
        }
      })
      return true
    }
  }
  return false
}

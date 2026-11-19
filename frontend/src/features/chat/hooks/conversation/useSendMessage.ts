import type * as React from 'react'
import { resolveSendPlan } from '@/features/chat/model/sendPlan'
import { DRAFT_SESSION, MODULE_FAILED_IDS } from '@/features/chat/model/conversationSession'
import { chatApi } from '@/features/chat/services/chatService'
import { deliveredReferences } from '@/features/creation/services/creationResources'
import type { AssetPurpose } from '@/features/assets/hooks/usePendingAssets'
import { messageFingerprint, isSameRequest, creationFingerprint } from '@/features/chat/model/sendFingerprint'
import { newIdempotencyKey } from '@/api/config'
import { currentFieldVersions, markDraftSent, clearSentPartsOnly, useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import { studioHttpApi } from '@/api'
import { ensureCreationContext } from '@/features/creation/services/creationEntry'
import { submitCreation } from '@/features/creation/services/creationClient'
import { resolveReplySaveState, replySaveNotice } from '@/features/chat/model/roundRestoreRules'
import { recordRoundOutcome } from '@/features/chat/model/roundOutcomes'
import { invalidateBackfill } from '@/features/chat/services/roundOutcomeBackfill'
import { useCallback } from 'react'
import type { Session } from '@/features/chat/hooks/useSessions'
import type { ConversationProps } from '@/features/chat/Conversation'
import type { ComposerAttachment } from '@/features/chat/model/composerAttachment'
import type { ChatMessage } from '@/features/chat/hooks/useChat'
import type { HarnessDescriptor } from '@/api/harnesses'
import { readyAttachments, withProjectTarget, correctionTextFor, previewImageOf, requestIdFor } from '@/features/chat/model/sendRequest'
import { findStoredReply, sendErrorText } from '@/features/chat/services/sendSupport'

export interface UseSendMessageArgs {
  activeIsServer: boolean
  activeSessionRef: React.RefObject<string | null>
  activeThread: Session | null
  attachments: ComposerAttachment[]
  chat: ConversationProps['chat']
  effectiveEffort: string | null
  effectiveModel: string
  harnessId: string
  idemKeyRef: React.RefObject<string | null>
  idemTextRef: React.RefObject<string | null>
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  messages: ChatMessage[]
  mountedRef: React.RefObject<boolean>
  pending: boolean
  projectPending: boolean
  props: ConversationProps
  replySaveRetry: { sessionId: string; userMessageId: string; reply: string; localId: string } | null
  selectedHarness: HarnessDescriptor | undefined
  servedRef: Set<string>
  sessionDraft: ReturnType<typeof useSessionDraft>
  setAttachments: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
  setPending: React.Dispatch<React.SetStateAction<boolean>>
  setReplySaveRetry: React.Dispatch<React.SetStateAction<{ sessionId: string; userMessageId: string; reply: string; localId: string } | null>>
  setSendError: React.Dispatch<React.SetStateAction<string | null>>
  setStageLeadVersion: React.Dispatch<React.SetStateAction<number | null>>
  setSubmitting: React.Dispatch<React.SetStateAction<boolean>>
  startServerReply: (mode?: { attach?: boolean; rerun?: boolean }) => void
  submissionInFlight: React.RefObject<boolean>
}

/** 从 Conversation.tsx 的 Conversation 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useSendMessage({ activeIsServer, activeSessionRef, activeThread, attachments, chat, effectiveEffort, effectiveModel, harnessId, idemKeyRef, idemTextRef, inputRef, messages, mountedRef, pending, projectPending, props, replySaveRetry, selectedHarness, servedRef, sessionDraft, setAttachments, setPending, setReplySaveRetry, setSendError, setStageLeadVersion, setSubmitting, startServerReply, submissionInFlight }: UseSendMessageArgs) {

  const send = (text: string) => {
    const v = text.trim()
    if (pending || submissionInFlight.current || projectPending) return
    if (!v) {
      if (attachments.length) setSendError('请填写一条消息后再发送附件。')
      return
    }
    if (attachments.length && !activeIsServer) {
      setSendError('当前对话未保存到项目，附件无法随消息发送。请先创建或选择项目会话。')
      return
    }
    /* 拦截必须在**两条路径分叉之前**。
       之前只在 sendToServer（服务端会话）里拦，而未归属项目的会话是 origin='local'，
       在下面 `if (activeIsServer)` 处就分流走了本地路径 —— 于是界面显示
       「请先关联项目」，消息却照样发出去、还起了普通对话回复。实测复现。
       所以这里按同一份判定先拦一次，两条路径都绕不过去。 */
    {
      const gate = resolveSendPlan({
        targetSnapshot: sessionDraft.draft.targetSnapshot,
        draftIntent: sessionDraft.draft.intentAction,
        continuationScopeMode: sessionDraft.draft.continuationScopeMode,
        hasProject: Boolean(activeThread?.projectId),
        /* 本地草稿（含服务端创建失败后的降级会话）即使有 projectId，
           也走不了修改分支 —— 它在这一行下面就被分流到本地路径了。 */
        isServerSession: Boolean(activeIsServer),
      })
      if (gate.kind === 'blocked') {
        setSendError(
          gate.reason === 'missing_target'
            ? '当前草稿处于继续调整流程，尚未选定修改目标。请先在工作台圈定时间段或画面，或选择【确认整片修改】后再提交。'
            : gate.reason === 'unsaved_session'
              ? '这条会话还没有保存到项目，无法发起工程修改。请先在左栏重试保存这条对话，或新建一个已保存的项目会话。'
              : '这条会话还没有归属项目，无法发起工程修改。请先在「我的创作」里打开或新建一个项目会话，再提交修改意见。')
        return
      }
    }
    /* 上传状态只对**真实文件素材**有意义。
       参考片段与技法没有文件可上传，它们的价值是「借鉴什么」，
       拿 fileId / MIME 去校验会把它们全判成「不合格附件」而发不出去。 */
    const fileAttachments = attachments.filter((a) => !a.assetId && (a.source ?? 'asset') === 'asset')
    if (fileAttachments.some((a) => !a.fileId || a.uploading || a.uploadError)) {
      setSendError('请等待附件上传完成；上传失败的附件请移除后重新添加。')
      return
    }
    if (fileAttachments.some((a) => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(a.mimeType ?? ''))) {
      setSendError('当前 AI 只能接收 PNG、JPEG、WebP 或 GIF 图片，请移除其他附件。')
      return
    }
    if (activeIsServer) { void sendToServer(v); return }
    chat.addUserMessage(v)
    /* 同时交给服务层：回复流按「服务端收到的最后一条用户消息」起流，
       只加在界面上的话，适配器找不到这条提问，会去回上一条。
       原话原样传，不截断、不摘要。
       附件暂不随消息提交：契约要求附件先上传为 Asset、再以 fileId 引用，
       而上传能力还没接（见 docs/contracts/agent.md §6）。宁可不带，
       也不要拿 size=0 / 假 MIME 冒充「已上传」。 */
    const serviceSessionId = props.activeSessionId ?? DRAFT_SESSION
    chatApi.sendMessage(serviceSessionId, { text: v }).catch((err: unknown) => {
      /* 落不下去就说清楚，不假装已发送（契约 agent.md §6） */
      const note = err instanceof Error ? err.message : '消息没能提交。'
      const id = chat.startAiMessage()
      chat.failAiMessage(id, note)
      setPending(false)
    })
    chat.setDraft('')
    /* 发送成功后附件才离开输入框 —— 失败/中断时保留，用户不必重新挑一遍。
       （这里 addUserMessage 之后没有失败分支：真正的投递能力尚未接入，
       所以"成功"= 消息已进入对话。） */
    setAttachments([])
  }

  /**
   * 服务端会话发送：先落库，再显示。
   *
   * 为什么不做乐观插入：契约（agent.md §3）要求「服务端先保存真实用户消息」，
   * 没落库就显示成已发送是假的。这里等服务端 202 返回 `message` 之后才写进会话 ——
   * 失败时消息根本不会出现在对话里，草稿留在输入框，用户能直接重试。
   *
   * 幂等键（README §2.7）：同一个草稿重复提交必须复用同一个键，否则会写出两条
   * 一样的消息。键随草稿内容绑定，发送成功后清掉，下次新输入换新键。
   */
  const sendToServer = async (text: string) => {
    const sessionId = props.activeSessionId
    if (!sessionId || !activeIsServer || submissionInFlight.current) return
    // Keep service/draft work bound to the submitted session after navigation.
    // View-only state must never leak into the session now on screen.
    const isSubmissionVisible = () => mountedRef.current && activeSessionRef.current === sessionId
    const showSubmissionError = (message: string) => {
      if (isSubmissionVisible()) setSendError(message)
    }
    submissionInFlight.current = true
    setSubmitting(true)
    setSendError(null)
    try {
      const ready = readyAttachments(attachments)
      /* 参考片与特效走 references 通道。
         它们没有文件可传，但必须让 agent 知道「这是要借鉴的片段/技法」——
         塞进 attachments 会被 fileId 校验挡掉，等于送不进去。 */
      const refs = deliveredReferences(attachments
        .filter((item) => item.assetId)
        .map((item) => ({ ...item, assetId: item.assetId!, purpose: (item.purpose ?? 'unspecified') as AssetPurpose })))

      const targetSnapshot = sessionDraft.draft.targetSnapshot
      const continuationMode = sessionDraft.draft.continuationScopeMode

      /* 发送去向由唯一判定函数决定（显示端调的是同一个函数）。
         这里不再自己写一套顺序 —— 两套一旦分叉，界面就会说谎。 */
      const plan = resolveSendPlan({
        targetSnapshot,
        draftIntent: sessionDraft.draft.intentAction,
        continuationScopeMode: continuationMode,
        /* 项目归属与会话来源都必须传真实值：
           没有项目、或仍是本地草稿，都发不出创作任务。
           不传的话判定会说「修改」，实际却落回普通回复 —— 界面在说谎。 */
        hasProject: Boolean(activeThread?.projectId),
        isServerSession: Boolean(activeIsServer),
      })

      // 1. 拦截态：缺目标、缺项目、或会话未保存，都不能当作普通聊天吞掉
      if (plan.kind === 'blocked') {
        setSendError(
          plan.reason === 'missing_target'
            ? '当前草稿处于继续调整流程，尚未选定修改目标。请先在工作台圈定时间段或画面，或选择【确认整片修改】后再提交。'
            : plan.reason === 'unsaved_session'
              ? '这条会话还没有保存到项目，无法发起工程修改。请先在左栏重试保存这条对话，或新建一个已保存的项目会话。'
              : '这条会话还没有归属项目，无法发起工程修改。请先在「我的创作」里打开或新建一个项目会话，再提交修改意见。')
        return
      }

      /* 2. 意图直接取判定结果：
         · 显式 query 优先（用户最后一次主动选择，范围确认不能推翻）；
         · 显式 modify **没有目标也算修改**（旧注释写成「只有确认整片才修改」不准确）；
         · 无目标、无意图、未确认整片 → 普通对话。 */
      const isModifyIntent = plan.kind === 'modify'
      const isWholeConfirmedContinuation = continuationMode === 'whole_confirmed'

      const creationReferences = withProjectTarget(refs, {
        projectId: activeThread?.projectId,
        targetSnapshot,
        isModifyIntent,
        isWholeConfirmedContinuation,
      })

      /* ── 发送身份：在**请求组装完成之后**计算 ──
         不再手写「等价标识」：直接用即将发出去的真实字段算身份。
         早期版本漏掉了素材引用（refs）和目标图片，导致「文字不变、只换参考素材」
         仍被认成旧请求 —— 现在入参就是真正要发送的那份对象。 */
      const messageIdFp = messageFingerprint({
        sessionId,
        text: text.trim(),
        references: creationReferences.length > 0 ? creationReferences : null,
        attachments: ready.length > 0 ? ready : null,
      })
      /* 消息幂等键：同一份消息请求才复用。刷新后靠 pendingSubmission 恢复，
         否则「消息已保存、创作结果不确定」时刷新再发会重复落一条用户消息。 */
      const pending = sessionDraft.draft.pendingSubmission
      const recoveredKey = (pending && pending.requestId && pending.idempotencyKey
        && isSameRequest(messageIdFp, pending))
        ? pending.idempotencyKey
        : null
      const key = recoveredKey
        ?? ((idemKeyRef.current && idemTextRef.current === messageIdFp) ? idemKeyRef.current : newIdempotencyKey())
      idemKeyRef.current = key
      idemTextRef.current = messageIdFp
      /* 是不是上一轮的重试 —— 创作 requestId 能否复用的唯一判据。 */
      const isRetryOfPending = isSameRequest(messageIdFp, pending)
      /* 提交快照：记录「这次到底发了什么」。
         成功后只清与这份快照相同的部分 —— 用户在等待期间改过的
         目标/附件/意图会被保留（见 clearSentPartsOnly）。 */
      const sentSnapshot = {
        text: sessionDraft.draft.text,
        attachments: [...attachments],
        targetSnapshot: sessionDraft.draft.targetSnapshot,
        continuationScopeMode: sessionDraft.draft.continuationScopeMode ?? null,
        intentAction: sessionDraft.draft.intentAction,
        /* 逐字段版本在「即将发请求」处取：
           之后流程内部写 pendingSubmission 不属于任何用户可编辑字段，不会推进版本。 */
        versions: currentFieldVersions(activeThread?.projectId, sessionId),
        idempotencyKey: key,
      }

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
                return
              }
            } else {
              showSubmissionError(`未能确认工程当前版本（目标引用基准版本为 v${targetVer}）。为防止基于错误基准进行修改，请检查网络或重新选择画面目标后再提交。`)
              return
            }
          } catch (verErr: unknown) {
            const msg = verErr instanceof Error ? verErr.message : String(verErr)
            showSubmissionError(`未能确认工程当前版本（${msg}）。为防止基于错误基准进行修改，请稍后重试。`)
            return
          }
        }
      }

      // 2. 版本核对通过后，将用户消息正式写入服务端会话
      if (isModifyIntent && activeThread?.projectId) {
        await ensureCreationContext(activeThread.projectId, text.trim(), studioHttpApi().workflowContext)
      }
      const saved = await props.threads.sendMessage(sessionId, text, {
        idempotencyKey: key,
        ...(ready.length > 0 ? { attachments: ready } : {}),
        ...(creationReferences.length > 0 ? { references: creationReferences } : {}),
      })
      // A saved creation message must still register its durable job even when
      // the user has left this view. Ordinary chat can resume when reopened.
      if (!isSubmissionVisible() && !isModifyIntent) return

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
              return
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
            return
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
          return
        }
      }

      /* 【一次发送尝试到此结束】清空幂等键。
         幂等键保护的是「同一次尚未确认的发送」，不是「同一段文字」：
         用户上一轮成功后**主动再发同一句话**，那是两次发送，必须产生两条消息。
         若像早先那样「内容相同就永远复用同一把键」，这两次会被服务端当成一次，
         用户第二次的话就静默丢失了。
         失败/结果未知的路径不会走到这里（那之前就 return 了），
         所以「原样重试复用旧键」由 pendingSubmission 负责，与这里互不冲突。 */
      idemKeyRef.current = null
      idemTextRef.current = null
      if (isSubmissionVisible()) chat.setDraft('')
      /* 先登记「这段文字已发出」，再清草稿：
         输入框的 blur 回调稍后还会 flush 一次原文，不拦就会被写回草稿。 */
      markDraftSent(activeThread?.projectId, sessionId, text)
      /* 只清「这次发出去的那份」：用户若已输入新内容则保留（含附件）。 */
      clearSentPartsOnly(activeThread?.projectId, sessionId, sentSnapshot)
      if (isSubmissionVisible()) chat.appendMessage(saved)
      if (!isModifyIntent && isSubmissionVisible()) {
        /* 先登记再起流：下面的自动起流 effect 也会因为「最后一条是用户消息」
           尝试 startServerReply。若这里不先登记，effect 会在 stream 注册完成前
           看到 has()===false，于是起第二条流 —— 实测表现为早停时出现两条 stream
           和两次 /stop。登记后 effect 的 servedRef 守卫能立刻生效。 */
        servedRef.add(saved.id)
        startServerReply()
      }
    } catch (cause) {
      // 没有发出去：消息不显示、草稿保留、给出原因；幂等键保留以便原样重试
      showSubmissionError(sendErrorText(cause))
    } finally {
      submissionInFlight.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }

  /** 补存这条创作回复：失败标记清掉，重新写一次会话。 */
  const retrySaveReply = useCallback(async () => {
    const target = replySaveRetry
    if (!target) return
    setReplySaveRetry(null)
    try {
      const savedAi = await props.threads.sendMessage(target.sessionId, target.reply, {
        role: 'assistant',
        taskId: target.userMessageId,
        idempotencyKey: `idem-reply-${target.userMessageId}`,
      })
      /* 换成服务端 id 并清掉失败标记：重试用的是同一把幂等键，
         服务端不会因为补存而多出一条。
         没有 replaceMessage，用「先移除本地占位、再追加服务端那条」实现 ——
         顺序不能反，否则 appendMessage 的去重会按 id 判定，两条都在。 */
      chat.removeMessage(target.localId)
      chat.appendMessage({
        id: savedAi.id,
        role: 'ai',
        text: target.reply,
        taskId: target.userMessageId,
        sessionId: target.sessionId,
        at: Date.now(),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSendError(`回复仍未存进会话（${msg.slice(0, 80)}）。刷新后这条会消失，请再试一次。`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replySaveRetry, chat, props.threads])

  /**
   * 重试这一轮：把最后一条用户消息原样再发一次。
   *
   * 为什么不是「重新请求服务端生成」：本项目的回复来自一轮真实的 Agent 执行，
   * 后端不支持断点续读（Last-Event-ID 只校验格式），所以「接着刚才那条继续」
   * 做不到。能做的是把同一句话再发一遍 —— 幂等键保证服务端不会重复落库。
   */
  const retryLastRound = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser || pending) return
    /* 用户主动重试：清掉失败标记，否则自动路径与手动路径都被挡住 */
    MODULE_FAILED_IDS.delete(lastUser.id)
    servedRef.delete(lastUser.id)
    send(lastUser.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, pending])

  /* 输入框换成官方组件后文字由它自己持有，这里接收它交上来的正文 */
  const submit = (text?: string) => {
    send(text ?? chat.draft)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) el.style.height = 'auto'
    })
  }
  return { send, retrySaveReply, retryLastRound, submit }
}

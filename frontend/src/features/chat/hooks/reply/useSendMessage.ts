import type * as React from 'react'
import { resolveSendPlan } from '@/features/chat/model/sendPlan'
import { DRAFT_SESSION, MODULE_FAILED_IDS } from '@/features/chat/model/conversationSession'
import { chatApi } from '@/features/chat/services/chatService'
import { deliveredReferences } from '@/features/creation/services/creationResources'
import type { AssetPurpose } from '@/features/assets/hooks/usePendingAssets'
import { messageFingerprint, isSameRequest } from '@/features/chat/model/sendFingerprint'
import { newIdempotencyKey } from '@/api/config'
import { currentFieldVersions, markDraftSent, clearSentPartsOnly, useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import { studioHttpApi } from '@/api'
import { ensureCreationContext } from '@/features/creation/services/creationEntry'
import { useCallback } from 'react'
import type { Session } from '@/features/chat/hooks/useSessions'
import type { ConversationProps } from '@/features/chat/Conversation'
import type { ComposerAttachment } from '@/features/chat/model/composerAttachment'
import type { ChatMessage } from '@/features/chat/hooks/useChat'
import type { HarnessDescriptor } from '@/api/harnesses'
import { readyAttachments, withProjectTarget } from '@/features/chat/model/sendRequest'
import { sendErrorText } from '@/features/chat/services/sendSupport'
import { confirmBaseVersion, runCreationRound } from '@/features/chat/services/sendToServerSteps'

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

/** 对话区的发送流程：发送前校验与拦截，本地或服务端会话的消息提交（含幂等与创作任务），以及补存回复、重试本轮。 */
export function useSendMessage(args: UseSendMessageArgs) {
  const { activeIsServer, activeSessionRef, activeThread, attachments, chat, idemKeyRef, idemTextRef, inputRef, messages, mountedRef, pending, projectPending, props, replySaveRetry, servedRef, sessionDraft, setAttachments, setPending, setReplySaveRetry, setSendError, setSubmitting, startServerReply, submissionInFlight } = args

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

      if (!(await confirmBaseVersion(args, { isModifyIntent, targetSnapshot, isSubmissionVisible, showSubmissionError }))) return

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

      if (await runCreationRound(args, { isModifyIntent, text, sessionId, targetSnapshot, creationReferences, messageIdFp, key, saved, isRetryOfPending, sentSnapshot, isSubmissionVisible, showSubmissionError })) return


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

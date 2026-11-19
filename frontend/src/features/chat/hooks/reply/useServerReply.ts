import type * as React from 'react'
import { studioHttpApi } from '@/api'
import { notifyProjectRendered } from '@/features/project/services/projectRenderEvents'
import { chatStreamManager } from '@/features/chat/services/chatStreamManager'
import { MODULE_FAILED_IDS } from '@/features/chat/model/conversationSession'
import { userMessageForError } from '@/api/errors'
import type { JobView } from '@/features/chat/components/JobPanel'
import type { Session } from '@/features/chat/hooks/useSessions'
import type { HarnessModel, HarnessDescriptor } from '@/api/harnesses'
import type { ConversationProps } from '@/features/chat/Conversation'
import type { ChatMessage } from '@/features/chat/hooks/useChat'
import type { ContextBreakdown } from '@/api/contracts'

export interface UseServerReplyArgs {
  activeThread: Session | null
  backendModels: HarnessModel[]
  chat: ConversationProps['chat']
  clearRoundTrace: () => void
  deliverablesRef: React.RefObject<{ path: string; description?: string }[]>
  effectiveEffort: string | null
  effectiveModel: string
  harnessId: string
  lastUserId: string | null
  loadMessages: (sessionId: string, options?: { force?: boolean }) => Promise<void>
  messages: ChatMessage[]
  props: ConversationProps
  selectedHarness: HarnessDescriptor | undefined
  setAgentPhase: React.Dispatch<React.SetStateAction<{ phase: string; label?: string; callId?: string; arguments?: string; isError?: boolean } | null>>
  setBreakdown: React.Dispatch<React.SetStateAction<ContextBreakdown | null>>
  setContextUsed: React.Dispatch<React.SetStateAction<number | null>>
  setContextWindow: React.Dispatch<React.SetStateAction<number | null>>
  setJobs: React.Dispatch<React.SetStateAction<JobView[]>>
  setPending: React.Dispatch<React.SetStateAction<boolean>>
  setPendingStartedAt: React.Dispatch<React.SetStateAction<number | null>>
  setReplyNote: React.Dispatch<React.SetStateAction<string | null>>
  setStopping: React.Dispatch<React.SetStateAction<boolean>>
  setToolsTokens: React.Dispatch<React.SetStateAction<number | null>>
  setUnfinishedReply: React.Dispatch<React.SetStateAction<boolean>>
  setUsage: React.Dispatch<React.SetStateAction<{ inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; totalTokens?: number } | null>>
  streamStopRef: React.RefObject<(() => void) | null>
}

/** 对话区发起服务端会话的一轮回复，并把回复流的各类事件写回消息与本轮状态；同时提供停止入口。 */
export function useServerReply({ activeThread, backendModels, chat, clearRoundTrace, deliverablesRef, effectiveEffort, effectiveModel, harnessId, lastUserId, loadMessages, messages, props, selectedHarness, setAgentPhase, setBreakdown, setContextUsed, setContextWindow, setJobs, setPending, setPendingStartedAt, setReplyNote, setStopping, setToolsTokens, setUnfinishedReply, setUsage, streamStopRef }: UseServerReplyArgs) {
  /**
   * 服务端会话的回复流（SSE）。
   *
   * 后端端点已就绪，但 Agent 进程还没接：服务端会如实返回 `agent_unavailable`。
   * 这种情况**不是**「回复失败」，而是「还没有能力回复」—— 界面要说清楚差在哪，
   * 不能显示成红色的「这条回复没有完成」（那会让人以为重试就能好），
   * 更不能编一段回复顶上。所以这里单独用 `replyNote` 状态渲染，不走 `failed`。
   *
   * 真接上 Agent 之后这里不用改：delta/completed 走与演示适配器同一套收尾逻辑。
   */
  /* attach：只接上还在跑（或刚跑完）的那一轮，不新开；rerun：用户点了「重新执行」 */
  const startServerReply = (mode: { attach?: boolean; rerun?: boolean } = {}) => {
    const sessionId = props.activeSessionId
    if (!sessionId) return
    setUnfinishedReply(false)
    /* 开新一轮前只需断掉本地旧流，**不能**调 streamStopRef ——
       它内部会请求后端 /stop，等于每次发送都先给上一轮发一次停止请求。
       这里清 ref 即可：旧连接由 chatStreamManager 在 register 新流时接管。 */
    streamStopRef.current = null
    const aiId = chat.startAiMessage({ demo: false, projectId: activeThread?.projectId ?? undefined, sessionId })
    let produced = false
    setPendingStartedAt(Date.now())
    setPending(true)
    // 新的一轮从零开始记工具调用：上一轮的记录属于上一条回复，留着会串味。
    // 产物同理：上一轮交付的文件不属于这一条回复。
    deliverablesRef.current = []
    setUsage(null)
    const handle = studioHttpApi().chat.stream(sessionId, {
      /* 推理增量进「思考过程」块，不进正文 */
      onReasoning: (_messageId, delta, position) => {
        chat.appendAiReasoning(aiId, delta, position)
      },
      /* 这一轮改动了工程：后端自动渲染。进度写在回复下方，出片后通知工作台刷新 */
      onRender: (render) => {
        if (render.message) setReplyNote(render.message)
        const pid = activeThread?.projectId
        if (render.state === 'rendered' && pid) notifyProjectRendered(pid, render.version)
      },
      onDelta: (_messageId, delta, replaceFrom) => {
        produced = true
        chat.appendAiText(aiId, delta, replaceFrom)
      },
      onTodo: (todos) => {
        /* 任务清单整表替换：模型每次 todo_write 都给完整清单。 */
        chat.setAiTodos(aiId, todos)
      },
      onDiagnostic: (kind, detail) => {
        /* 压缩 / token 上限 / 重试：不改变正文，但解释了「为什么这次不对劲」。
           以前后端直接丢弃，用户只能看到答复怪却无从判断。 */
        chat.addAiDiagnostic(aiId, kind, detail)
      },
      onCompleted: (message) => {
        chatStreamManager.notifyCompleted(sessionId)
        produced = true
        // 带上本轮工具记录：completed 到服务端消息读回之间有个异步空档，
        // 不先挂上去，列表会在这一瞬间闪空。
        chat.finishAiMessage(aiId, message.text, message.toolCalls, message.reasoning, message.todos,
                             deliverablesRef.current, message.reasoningSegments)
        /* 服务端会话的内容以 server 消息数组为准（见上方 serverMirror 的说明）。
           这里必须把刚落库的回复重新读回来：否则下一次发消息、或任何让
           `activeThread.messages` 身份变化的操作，都会用「只有用户消息」的数组
           覆盖 chat，把这条回复冲掉 —— 实测就是这样丢掉上一轮回答的。
           只对 server 会话做：本地草稿没有服务端历史可读。 */
        if (props.threads.sessions.some((t) => t.id === sessionId && t.origin === 'server')) {
          void loadMessages(sessionId, { force: true })
        }
      },
      onError: (error) => {
        chatStreamManager.notifyError(sessionId, error.message || '回复流中断')
        // 能力缺口：删掉占位，改用「Agent 未接入」说明，不当作回复失败
        chat.removeMessage(aiId)
        /* 记下这条失败，自动路径不再重试 —— 否则删掉占位后
           「最后一轮没有 AI 回复」又成立，effect 会无限重起流。 */
        const failedUser = [...messages].reverse().find((mm) => mm.role === 'user')
        if (failedUser) MODULE_FAILED_IDS.add(failedUser.id)
        setPending(false)
        setPendingStartedAt(null)
        setAgentPhase(null)
        if (error.details?.rawCode === 'turn_not_running') {
          setUnfinishedReply(true)
          setReplyNote('这一轮没有完成，也没有保存回复（应用可能重启过）。')
          return
        }
        setReplyNote(error.isCapabilityGap
          ? 'Agent 暂时不可用：这条消息已保存在服务端，但没有收到回复。'
          : `没有拿到回复：${userMessageForError(error, '回复流中断了。')}`)
      },
      onStatus: (status) => {
        chat.recordToolCall(aiId, status)
        if (status.phase === 'thinking') {
          setAgentPhase({ phase: 'thinking' })
        } else if (status.phase === 'tool') {
          /* 工具阶段保留结构化字段。同一 callId 的结果帧只翻转 isError，
             不把 name/label/arguments 清空 —— 后端结果帧不带 name（避免重复下发），
             若整个覆盖，界面上「正在调用 bash」的名字会在结束瞬间消失。 */
          setAgentPhase((prev) => {
            const sameCall = prev?.phase === 'tool' && status.callId !== undefined
              && prev.callId === status.callId
            const name = status.name ?? (sameCall ? prev?.label : undefined)
            return {
              phase: 'tool',
              ...(name ? { label: name } : {}),
              ...(status.callId ? { callId: status.callId } : (sameCall && prev?.callId ? { callId: prev.callId } : {})),
              /* 参数只在开始帧有；结果帧沿用上一次的值，避免中途被抹掉 */
              ...(status.arguments !== undefined
                ? { arguments: status.arguments }
                : (sameCall && prev?.arguments !== undefined ? { arguments: prev.arguments } : {})),
              ...(status.isError ? { isError: true } : {}),
            }
          })
          /* 同时维护整轮调用记录。规则：
             · 有 arguments → 这是一次新调用的开始帧，追加条目
             · 没有 arguments 且带 callId → 结果帧，回填对应条目的 done/isError
             不按「有没有 isError」判断开始还是结束：失败的结果帧才有 isError，
             成功的结果帧两者都没有，只能靠 arguments 的有无来区分。 */
          /* 每处更新都同时写 ref：`onCompleted` 的闭包读不到最新 state，
             只能靠 ref 取本轮完整记录。两处（state / ref）必须在同一个更新函数里，
             拆开写会漏掉其中一条路径。 */
        } else {
          setAgentPhase(null)
        }
      },
      onState: (state) => {
        if (state.phase === 'ended' || state.phase === 'failed' || state.phase === 'aborted') {
          setPending(false)
          setAgentPhase(null)
          // 结束但没有产出任何内容：撤掉空占位，别留一个「正在回复…」看起来像卡死
          if (!produced) chat.removeMessage(aiId)
        }
      },
      onTitle: (title) => {
        /* 引擎给会话命了名：同步到左栏，用户不用刷新就能看到。
           后端已经落库，这里只是把同一事实反映到界面，不是本地伪造。 */
        props.threads.adoptServerTitle(sessionId, title)
      },
      onUsage: (u) => {
        /* 按桶累加：一轮里每个模型调用都会报一次，用户关心的是「这一轮总共花了多少」。
           缺失的桶保持 undefined 而不是 0 —— 界面上显示「未报告」比显示「0」诚实。 */
        setUsage((prev) => {
          const add = (a: number | undefined, b: number | undefined) =>
            a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)
          return {
            ...(add(prev?.inputTokens, u.inputTokens) !== undefined
              ? { inputTokens: add(prev?.inputTokens, u.inputTokens) } : {}),
            ...(add(prev?.outputTokens, u.outputTokens) !== undefined
              ? { outputTokens: add(prev?.outputTokens, u.outputTokens) } : {}),
            ...(add(prev?.cacheReadTokens, u.cacheReadTokens) !== undefined
              ? { cacheReadTokens: add(prev?.cacheReadTokens, u.cacheReadTokens) } : {}),
            ...(add(prev?.totalTokens, u.totalTokens) !== undefined
              ? { totalTokens: add(prev?.totalTokens, u.totalTokens) } : {}),
          }
        })
        /* 上下文占用要的是**最后一次请求的 prompt 大小**，不是累加值 ——
           所以单独存一份，绝不能复用上面那个按桶累加的 `usage`。
           公式与 DSH 一致：未缓存输入 + 缓存读 + 缓存写（不含输出，
           因为输出还没回到上下文里）。inputTokens 为 0 的样本要跳过：
           压缩刚结束时上游只报 output，直接用会把进度条打到 0。 */
        const prompt = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0)
        if ((u.inputTokens ?? 0) > 0 && prompt > 0) {
          setContextUsed(prompt)
        }
      },
      onDeliverables: (f) => {
        /* 合并去重：同一 path 后到的覆盖前面的（说明可能更完整）。 */
        const map = new Map(deliverablesRef.current.map((x) => [x.path, x]))
        for (const item of f.files) map.set(item.path, item)
        deliverablesRef.current = [...map.values()]
      },
      onJob: (j) => {
        /* 同一 jobId 会来两帧：registered（running）与 settled（终态）。
           按 id 覆盖，不能追加 —— 追加会变成两条同名记录。
           startedAt 只在本机记一次：settled 帧不带开始时间，若覆盖掉就
           算不出「它跑了多久」。 */
        setJobs((prev) => {
          const at = prev.find((x) => x.jobId === j.jobId)
          const next: JobView = {
            jobId: j.jobId,
            kind: j.kind,
            label: j.label,
            status: j.status,
            startedAt: at?.startedAt ?? Date.now(),
            ...(j.durationMs !== undefined ? { durationMs: j.durationMs } : {}),
            ...(j.detail !== undefined ? { detail: j.detail } : {}),
          }
          return at
            ? prev.map((x) => (x.jobId === j.jobId ? next : x))
            : [...prev, next]
        })
      },
      onStopped: () => {
        /* 服务端确认了这一轮已停止（收到 stopped 事件）。
           注意：这里**不再**调用 chatStreamManager.stop —— 那会再发一次 /stop 请求，
           且会把已是 stopped 的状态重新广播一遍。清理只做本地。
           注意保存边界：**用户那条消息在启动回复流之前就已经写入服务端了**
           （见发送流程里 sendMessage 先于 stream），停止后不保存的是这条
           未完成的 AI 回复 —— 半截正文撤掉，避免下次读历史时它又消失。
           文案不能说成「这一轮没有保存」，那会让人以为自己的话也没了。 */
        /* 只清本地，且与 phase effect 去重：若管理器登记的「确认停止」标记
           已被 takeConfirmedStop 取走，说明那条路径已经清理过，这里不重复。
           反之（服务端主动推 stopped 事件、非用户点击）则在这里清理。 */
        const confirmed = chatStreamManager.takeConfirmedStop(sessionId)
        if (!confirmed) {
          chat.removeMessage(aiId)
          clearRoundTrace()
          setReplyNote('已停止生成。你的消息已保存，这条回复没有保存。')
        }
        setPending(false)
        setPendingStartedAt(null)
        setAgentPhase(null)
      },
      onBackground: (info) => {
        chatStreamManager.release(sessionId)
        /* 超时转后台 ≠ 失败。任务还在跑，完成时会落库。
           这里必须放在 replyNote（中性说明）而不是失败提示里，
           否则用户会以为挂了而重发一遍 —— 那才是真的重复消耗。 */
        setPending(false)
        setPendingStartedAt(null)
        setAgentPhase(null)
        setReplyNote(info.message)
      },
      onContext: (c) => {
        /* 窗口大小只跟模型走，不随轮次变 —— 覆盖即可，不累加。
           引擎没报（适配器不上报）时这帧根本不会来，保持 null = 「不知道」。
           工具 schema 同理：每次请求都一样，覆盖。 */
        if (c.contextWindow !== undefined) setContextWindow(c.contextWindow)
        if (c.toolsTokens !== undefined) setToolsTokens(c.toolsTokens)
        /* 分档是整块快照，直接覆盖。它是「此刻上下文里有什么」，
           不是累计值 —— 累加会把压缩掉的内容也算进去。 */
        if (c.breakdown !== undefined) setBreakdown(c.breakdown)
      },
    }, { harness: selectedHarness?.id ?? harnessId, model: backendModels.length ? effectiveModel : undefined, reasoningEffort: effectiveEffort ?? undefined,
      attach: mode.attach, rerun: mode.rerun })
    chatStreamManager.register({
      sessionId,
      userMessageId: lastUserId ?? undefined,
      aiMessageId: aiId,
      stop: () => handle.close(),
      startedAt: Date.now(),
    })
    streamStopRef.current = () => {
      /* 停止必须打到后端，而且**不能在这里顺手 close()**：
         管理器会在后端确认后自行断开本地流。这里若提前 close，
         就变成「先断 SSE、再等后端」—— 与设计相反：
         · 停止失败时，用户再也收不到仍在生成的那条回复；
         · 后端确认时，stopped 事件也可能因为连接已断而收不到，半截回复留在界面上。
         所以这里只发起停止请求，本地收尾交给管理器与事件流。 */
      setStopping(true)
      void chatStreamManager.stop(sessionId).then((outcome) => {
        setStopping(false)
        /* 按后端真实答复分开说，不把 stopped:false 当成「已停止」：
           · stopped：管理器已断流并广播，这里不必再做什么；
           · supersededRound：后端停掉了，但那条回复已经不在了（刚跑完或
             已换新一轮），本地没有需要收尾的东西，如实说明；
           · not_running：后端没找到在跑的进程（可能刚好跑完，也可能是停止
             早于进程登记）—— 保持连接，让真实终态自己到达，并重新读一次历史；
           · failed：请求没送达，后端状态未知，同样保持连接。 */
        if (outcome.supersededRound) {
          setReplyNote('这次停止针对的回复已经结束了；如果还有新的回复在生成，请再点一次停止。')
          void props.threads.loadMessages(sessionId, { force: true })
        } else if (outcome.status === 'not_running') {
          setReplyNote('这次没有停止到正在运行的回复；回复可能继续，也可能已经结束。已重新读取会话，请以最新回复为准。')
          void props.threads.loadMessages(sessionId, { force: true })
        } else if (outcome.status === 'failed') {
          setReplyNote(`停止请求没有送达（${(outcome.error ?? '').slice(0, 60)}）。回复可能继续，请再点一次停止或稍后重新读取会话确认。`)
        }
      })
    }
  }
  return { startServerReply }
}

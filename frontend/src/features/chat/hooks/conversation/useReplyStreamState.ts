import type * as React from 'react'
import { useState, useRef, useEffect } from 'react'
import { useSessionStream, chatStreamManager } from '@/features/chat/services/chatStreamManager'
import type { ContextBreakdown } from '@/api/contracts'
import type { JobView } from '@/features/chat/components/JobPanel'
import type { ConversationProps } from '@/features/chat/Conversation'

export interface UseReplyStreamStateArgs {
  chat: ConversationProps['chat']
  props: ConversationProps
  setReplyNote: React.Dispatch<React.SetStateAction<string | null>>
}

/** 从 Conversation.tsx 的 Conversation 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useReplyStreamState({ chat, props, setReplyNote }: UseReplyStreamStateArgs) {
  const [pending, setPending] = useState(false)
  /** 本轮开始时间：给 ThinkingIndicator 的计时器用。
      记在 state 里而不是渲染时 Date.now()，否则每帧都会变、计时器会抖。 */
  const [pendingStartedAt, setPendingStartedAt] = useState<number | null>(null)

  /**
   * 停止请求是否还在等后端答复。
   *
   * <p>轮次核对能防止「迟到的停止响应误伤新流」，但更省事的是不给这个机会：
   * 结果没确定之前输入框继续保持忙碌，用户就无法在这一瞬发出下一轮。
   * 管理器对在途请求做了去重，连点只会打一次 /stop。</p>
   */
  const [stopping, setStopping] = useState(false)

  const loadMessages = props.threads.loadMessages
  const handledStreamPhaseRef = useRef<{ phase: string; sessionId?: string | null }>({ phase: 'idle' })

  /**
   * 清空「本轮」的过程痕迹：工具调用、token 用量、上下文分档、当前阶段。
   *
   * <p>停止生成时这一轮的 AI 消息会被撤掉，但这些是**独立 state**，
   * 不随消息一起消失。真机验收发现：点了停止，正文没了，
   * 「思考 / bash · 1 次 / 11.5K 上下文条」还留在界面上 ——
   * 用户看到的就是「停了但没停干净」。所以凡是撤销本轮回复的地方，
   * 都要连同这些痕迹一起清掉。</p>
   */
  const clearRoundTrace = () => {
    setUsage(null)
    setAgentPhase(null)
    /* 上下文分档与实测 prompt 大小也是**这一轮**的读数：
       不清掉的话，停止后界面会留着一根「11.5K / 1M」的占用条，
       指向一条已经被撤销的回复。窗口大小（分母）保留 —— 它来自模型目录，
       与本轮无关。 */
    setBreakdown(null)
    setContextUsed(null)
  }

  // 响应式订阅全局会话回复流状态（支持工作台与对话区无缝跨页状态同步）
  const streamInfo = useSessionStream(props.activeSessionId)
  useEffect(() => {
    const isNewEvent = handledStreamPhaseRef.current.phase !== streamInfo.phase ||
      handledStreamPhaseRef.current.sessionId !== props.activeSessionId
    handledStreamPhaseRef.current = { phase: streamInfo.phase, sessionId: props.activeSessionId }

    if (streamInfo.phase === 'streaming') {
      setPending(true)
      if (streamInfo.startedAt) setPendingStartedAt(streamInfo.startedAt)
    } else if (streamInfo.phase === 'completed' || streamInfo.phase === 'stopped') {
      setPending(false)
      setPendingStartedAt(null)
      setAgentPhase(null)
      /* 确认停止的清理放在这里，而不是只挂在 SSE 的 onStopped 上：
         后端一确认，管理器就会断开连接，onStopped 事件很可能不再到达，
         半截回复会留在界面上。管理器登记了「哪一轮被确认停止」，
         这里读一次即删（takeConfirmedStop），保证与事件路径不重复清理。 */
      if (streamInfo.phase === 'stopped' && props.activeSessionId) {
        const confirmed = chatStreamManager.takeConfirmedStop(props.activeSessionId)
        if (confirmed) {
          if (confirmed.aiMessageId) chat.removeMessage(confirmed.aiMessageId)
          clearRoundTrace()
          setReplyNote('已停止生成。你的消息已保存，这条回复没有保存。')
        }
      }
      // 严格保证：每次完成只在首次进入 completed 阶段时触发一次同步，绝不反复重读
      if (isNewEvent && props.activeSessionId && streamInfo.phase === 'completed') {
        void loadMessages(props.activeSessionId, { force: true })
      }
    } else if (streamInfo.phase === 'error') {
      setPending(false)
      setPendingStartedAt(null)
      setAgentPhase(null)
      if (streamInfo.error) {
        setReplyNote(`没有拿到回复：${streamInfo.error}`)
      }
    }
  }, [streamInfo.phase, streamInfo.startedAt, streamInfo.error, props.activeSessionId, loadMessages])
  /**
   * 每秒自增一次，只为驱动思考态计时器的重渲染。
   *
   * 不在渲染里直接 Date.now()：那样要等别的原因触发重渲染，数字才会跳，
   * 实测会一直停在 0:00（没有 state 变化就没有重渲染）。
   */
  /* tick 的值本身不参与渲染，它只是「让这个组件每秒重算一次」的开关：
     elapsed 是算出来的（now - startedAt），父组件不重渲染就不会更新。 */
  const [tick, setTick] = useState(0)
  void tick
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [pending])
  /**
   * Agent 当前阶段。
   *
   * 正文由 `delta` 逐 token 到达（见后端 §11），所以这里的阶段只负责回答
   * 「模型在想、还是在跑工具」。工具阶段额外带 `callId` / `arguments`：
   * 后端把 DSH 的 `tool/call` 结构化透传过来了，界面才有机会显示
   * 「在跑哪个工具、参数是什么」，而不是只有一句「正在调用工具」。
   */
  const [agentPhase, setAgentPhase] = useState<{
    phase: string
    label?: string
    callId?: string
    arguments?: string
    isError?: boolean
  } | null>(null)

  /**
   * 本轮的完整工具调用记录。
   *
   * 与 `agentPhase` 的区别：`agentPhase` 只描述**当前**在做什么，流结束时清空；
   * `toolCalls` 保留整轮的每一次调用，让用户能回头看「刚才跑了什么、哪个失败了」。
   * 视频任务里一轮可能有十几次工具调用，只看当前一个等于没有记录。
   *
   * 按 `callId` 归并：开始帧建条目，结果帧翻转状态。没有 callId 的帧
   * （理论上不该出现，后端在缺 ID 时不下发）单独成条，不硬塞进上一条。
   */

  /**
   * `toolCalls` 的镜像。
   *
   * 为什么需要：`onCompleted` 的闭包是建流那一刻捕获的，读 `toolCalls` 只会拿到
   * 当时的空数组（state 更新不会改已捕获的闭包）。用 ref 才能取到本轮最新的记录。
   */

  /**
   * 本轮累计的 token 用量。
   *
   * 一轮可能有多次模型调用（每步一次），所以按桶累加而不是覆盖最后一次。
   * `cacheReadTokens` 单独累计：它含在 `totalTokens` 里，不重复加进 input。
   */
  const [usage, setUsage] = useState<{
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    totalTokens?: number
  } | null>(null)

  /**
   * 上下文窗口大小 —— 占用率的分母。
   *
   * 和 `usage` 刻意分开：usage 是**累计账单**（按桶累加，回答「这条会话花了多少」），
   * 这里要的是**此刻装了多少**（最后一次请求的 prompt 有多大）。
   * 混成一个数会得出「占了 300%」这种荒谬结论。
   *
   * `null` 表示引擎没报（适配器不上报），此时不画占用率，而不是编一个分母。
   */
  const [contextWindow, setContextWindow] = useState<number | null>(null)

  /**
   * 工具 schema 的估算占用（token）。来源是 DSH 的 `request/header`。
   *
   * 分档里的 System / Messages 两档只能拿到「合起来多少」——
   * 要靠这个值和 System 提示长度反推，所以它是独立一份。
   * `null` 表示还没发过请求（或引擎没给）。
   */
  const [toolsTokens, setToolsTokens] = useState<number | null>(null)

  /**
   * 上下文分档：把「已用 N token」拆成 system / memory / files / results / chat。
   *
   * `null` 表示后端还没上报（跑完一轮后才有）。分档口径对齐 magpie 的
   * prompt.parts —— 它回答了 usage 总数回答不了的问题：哪一块在膨胀。
   */
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null)

  /**
   * 此刻上下文里装了多少 token —— 占用率的分子。
   *
   * 取**最后一次**请求的 prompt 大小（覆盖，不累加）。与上面的 `usage`
   * 是两码事：那个是累计账单，问「这条会话一共花了多少」；这个是当前水位，
   * 问「现在装了几成」。用累加值算占用会得到超过 100% 的荒谬结果。
   */
  const [contextUsed, setContextUsed] = useState<number | null>(null)

  /**
   * 正在跑、或刚跑完的后台任务。
   *
   * 同一个 jobId 会来两帧（running → 终态），所以按 id 覆盖而不是追加 ——
   * 追加会得到两条同名记录。完成的短任务由 JobPanel 自己移除，
   * 这里只负责维护事实，不管「该不该显示」。
   */
  const [jobs, setJobs] = useState<JobView[]>([])

  /**
   * 本轮交付的产物。
   *
   * 用 ref 而不是 state：它只在收尾时用到一次（挂到消息上），
   * 中途不驱动渲染 —— 每来一帧都 setState 会白跑一次渲染。
   * 按 path 去重：一条回复可能分多次 present，同一文件不重复列。
   */
  const deliverablesRef = useRef<{ path: string; description?: string }[]>([])
  return { loadMessages, pending, setPending, setPendingStartedAt, breakdown, contextUsed, contextWindow, toolsTokens, clearRoundTrace, deliverablesRef, setAgentPhase, setBreakdown, setContextUsed, setContextWindow, setJobs, setStopping, setToolsTokens, setUsage, jobs, agentPhase, pendingStartedAt, usage, stopping }
}

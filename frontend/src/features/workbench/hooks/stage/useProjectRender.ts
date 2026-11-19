import type * as React from 'react'
import { useRef, useEffect, useState, useCallback } from 'react'
import type { FilmProjectState } from '@/api/workflowContext'
import { useRoundOutcomes, recordRoundOutcome } from '@/features/chat/model/roundOutcomes'
import type { OverlayGuidesState } from '@/features/workbench/components/WorkbenchTopBar'
import { studioHttpApi } from '@/api'
import type { ChatMessage as ChatItem } from '@/features/chat/hooks/useChat'
import { shouldRestoreLatestState, backfillRoundOutcomes } from '@/features/chat/services/roundOutcomeBackfill'
import { onProjectRendered } from '@/features/project/services/projectRenderEvents'
import { useWorkbenchReview } from '@/features/workbench/hooks/useWorkbenchReview'
import { useSceneVersions } from '@/features/workbench/hooks/useSceneVersions'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { ProjectSceneState } from '@/api/taskClient'
import type { AgentReference } from '@/api/studioApi'

export interface UseProjectRenderArgs {
  boundSessionId: string | null
  chat: WorkbenchProps['chat']
  editorExportTick: number
  notice: string
  panelOpen: boolean
  projectId: WorkbenchProps['projectId']
  realModifyBusy: boolean
  referencesEdited: React.RefObject<boolean>
  remoteCreationBusy: boolean
  rereadRuns: () => void
  restoredCreationAt: React.RefObject<string | null>
  review: ReturnType<typeof useWorkbenchReview>
  runsTick: number
  sceneVersions: ReturnType<typeof useSceneVersions>
  setCurrentSceneState: React.Dispatch<React.SetStateAction<ProjectSceneState | null>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setRealModifyError: React.Dispatch<React.SetStateAction<string>>
  setReferences: React.Dispatch<React.SetStateAction<AgentReference[]>>
  setRemoteCreationBusy: React.Dispatch<React.SetStateAction<boolean>>
  sourceOperation: React.RefObject<boolean>
  tasks: WorkbenchProps['tasks']
  threads: WorkbenchProps['threads']
  workflowRunning: boolean
}

/**
 * 工作台的工程状态与真实渲染：读取 Remotion 工程与创作记录，恢复并回填各轮结论，渲染工程并在出新版本后刷新画面。
 * 另管全屏时隐藏主导航、提示条自动消失、辅助覆盖层与资源库引用面板的开合。
 */
export function useProjectRender({ boundSessionId, chat, editorExportTick, notice, panelOpen, projectId, realModifyBusy, referencesEdited, remoteCreationBusy, rereadRuns, restoredCreationAt, review, runsTick, sceneVersions, setCurrentSceneState, setNotice, setRealModifyError, setReferences, setRemoteCreationBusy, sourceOperation, tasks, threads, workflowRunning }: UseProjectRenderArgs) {
  // 工作台全屏时隐藏主导航栏 hm-sidebar 并清除残留标记，退出时平滑恢复
  const prevNavHiddenRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (!panelOpen) {
      if (prevNavHiddenRef.current === null) {
        prevNavHiddenRef.current = document.body.classList.contains('hm-nav-hidden')
      }
      document.body.classList.add('hm-nav-hidden')
      document.body.classList.add('wb-fullscreen-active')
    } else {
      if (prevNavHiddenRef.current === false) {
        document.body.classList.remove('hm-nav-hidden')
      }
      prevNavHiddenRef.current = null
      document.body.classList.remove('wb-fullscreen-active')
    }
    return () => {
      if (prevNavHiddenRef.current === false) {
        document.body.classList.remove('hm-nav-hidden')
      }
      document.body.classList.remove('wb-fullscreen-active')
    }
  }, [panelOpen])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])
  /* 真实渲染：状态与提交。
     与「运行演示」不同，这条走真实后端 —— 会在项目目录里产出一个能播放的 mp4。
     界面必须让用户分清两者，所以按钮文案与结果提示都写明「真实」。 */
  const [realRenderBusy, setRealRenderBusy] = useState(false)
  /* 项目工程：agent 写的 Remotion 源码。ready=true 表示有可渲染的工程。
     就绪时「真实渲染」渲染的是这份工程，而不是内置标题卡 ——
     后者只是占位，渲出来的不是用户要的片子。 */
  const [filmProject, setFilmProject] = useState<FilmProjectState | null>(null)
  const [filmRenderError, setFilmRenderError] = useState('')
  /* agent 最近一次改工程后的说明。用户需要知道「它到底改了什么」，
     而不是只看到画面变了却不知道为什么。 */
  const [agentReply, setAgentReply] = useState('')
  /* 这次创作实际解析到的三库资源。
     消息里存了引用不等于 agent 用上了 —— 把解析结果显示出来，
     用户才能核对「我选的素材/参考片/特效有没有真的传下去」。 */
  /* agent 在等用户补充信息时的原文说明。
     非空表示这一轮它只提问、没有改工程 —— 界面据此显示等待条，
     而不是把上一版画面当成「刚改好」播放。 */
  /**
   * 「本轮未改动工程」的结论 —— **必须带消息身份**。
   *
   * <p>原先是项目级单值（只存一段文本）：它没有消息 id，
   * 界面上只能靠「最后一条 AI 回复」推断该挂给哪一轮，
   * 于是历史上每条回复都会读到同一个当前值 —— 把上一轮的结果
   * 贴到错误的轮次上。</p>
   *
   * <p>现在记录 `userMessageId`（触发这轮修改的用户消息）与 `requestId`，
   * 渲染时按消息 id 精确匹配；匹配不上就**明确降级**（不显示），
   * 绝不猜。</p>
   */
  /**
   * 「本轮未改动工程」结果 —— 改为**按轮次**存在共享 store 里
   * （`shell/roundOutcomes`），工作台侧栏与完整对话区读同一份。
   *
   * <p>此前它是单条 state：新一轮结论会替换上一轮，历史结论丢失，
   * 对话区也读不到。现在按「项目 + 会话 + 用户消息 id」存，
   * 两轮结论可以同时存在、各显示各的。</p>
   */
  const getRoundOutcome = useRoundOutcomes(projectId, boundSessionId)
  /* 仍在执行/刚完成时用于顶部状态；不再承担「哪一轮」的语义 */
  const [awaitingActive, setAwaitingActive] = useState(false)
  /* 辅助查看覆盖层（三分构图线、安全区、画面规格） */
  const [overlayGuides, setOverlayGuides] = useState<OverlayGuidesState>({
    safeArea: false,
    thirds: false,
    mediaFacts: false,
  })
  const toggleOverlayGuide = useCallback((key: keyof OverlayGuidesState) => {
    setOverlayGuides((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])
  /* 「从资源库引用」面板：素材/参考片/特效要在提交前挂到这一轮的意见上。
     没有这个入口时，用户选不到三库资源，只能靠调接口验证 —— 界面上走不通。 */
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false)
  const [usedResources, setUsedResources] = useState<NonNullable<import('@/api/workflowContext').FilmCreateResult['resources']>>([])
  useEffect(() => {
    let active = true
    void studioHttpApi().workflowContext.film(projectId)
      .then((state) => { if (active) setFilmProject(state) })
      .catch(() => { if (active) setFilmProject(null) })
    return () => { active = false }
  }, [projectId, runsTick, editorExportTick])

  /* 最新消息引用：恢复/回填的回调是异步到达的，闭包里直接读 `chat.messages`
     会拿到挂载那一刻的旧值，判断「本页有没有这条」就会永远为否。 */
  const chatMessagesRef = useRef<ChatItem[]>([])
  useEffect(() => { chatMessagesRef.current = chat.messages }, [chat.messages])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const restore = async () => {
      try {
        const saved = await studioHttpApi().workflowContext.creation(projectId)
        if (!active || !saved) return
        const running = saved.state === 'running'
        setRemoteCreationBusy(running)
        if (!sourceOperation.current && !workflowRunning && saved.updatedAt !== restoredCreationAt.current) {
          restoredCreationAt.current = saved.updatedAt
          /* 恢复路径：把结论写回**正确的轮次**。
             两个身份都要对上才写：
             · `sessionId` —— 这个状态属于哪条会话。恢复请求只带 projectId，
               拿到的是「项目最近一次」，它可能属于另一个会话；用当前界面会话
               顶替就会把 B 的结论写进 A 的作用域。
             · `userMessageId` —— 属于哪一轮。
             任一缺失或不符就**不写**（降级不显示），绝不按「最近一轮」猜。

             ⚠️ 两个前提：
             1. 必须在会话校验**之后**处理：`chat` 是 App 层共享实例
                （对话区读同一份），先写会让别的会话的内容跟过去。
             2. **不要自造消息 id**：这条回复在服务端已经有真实记录
                （创作完成时会自动落库），这里再追加一条 `creation:...` 的本地消息，
                与历史加载回来的真实消息 id 不同 —— 两者会同时存在，变成重复回复。

             所以这里只恢复**轮次结论**与侧栏说明；回复本体交给消息历史。
             如果本页确实还没有这条（历史尚未加载），强制重读一次真实消息。 */
          if (shouldRestoreLatestState(saved, projectId, boundSessionId)) {
            /* agentReply 也是「这一轮改了什么」的说明，同样属于当前会话 ——
               在校验之前写会让别的会话的说明显示在当前会话侧栏里。 */
            setAgentReply(saved.reply ?? '')
            recordRoundOutcome(projectId, boundSessionId, {
              reply: saved.reply ?? '',
              userMessageId: saved.userMessageId!,
              ...(saved.requestId ? { requestId: saved.requestId } : {}),
            })
            /* 本页缺这条真实回复时重读历史；已有就不动，避免重复。 */
            const hasReply = chatMessagesRef.current.some(
              (m) => m.role === 'ai' && m.taskId === saved.userMessageId,
            )
            if (!hasReply && threads && boundSessionId) {
              void threads.loadMessages(boundSessionId, { force: true })
            }
          }
          setAwaitingActive(saved.state === 'awaiting_info')
          setRealModifyError(saved.error ?? '')
          if (!referencesEdited.current && saved.references) setReferences(saved.references)
        }
        if (running) timer = setTimeout(() => void restore(), 4000)
        else {
          void sceneVersions.refresh(true)
          void tasks.currentScene(projectId).then((probe) => { if (active && probe.scene) setCurrentSceneState(probe.scene) })
        }
      } catch (error) {
        if (active) setRealModifyError(`读取创作记录失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    void restore()
    return () => { active = false; if (timer) clearTimeout(timer) }
    /* 依赖里必须有 boundSessionId：它可能由「自动选出会话」在挂载之后才赋值，
       也可能因用户切换会话而变。漏掉它的话，切换/自动绑定之后不会重新读取，
       于是「切回 A 成功过一次」不能代表所有进入顺序都可靠。 */
    // 按项目、会话与运行轮次恢复，不随 hooks 的对象引用重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, boundSessionId, runsTick])

  /* 历史轮次回填：按「项目 + 会话」拉该会话真实发生过的创作轮次，逐条写进共享 store。
     与上面「读最近一次状态」是两件事 —— 那个只能恢复最近一轮，这里补全历史。 */
  useEffect(() => {
    if (!projectId || !boundSessionId) return
    let active = true
    const sid = boundSessionId
    void backfillRoundOutcomes(projectId, sid, {
      onRoundsFound: (userMessageIds) => {
        if (!active) return
        /* 服务端有、本页没有的轮次：只写结论没用，回复本身也要读回来，
           否则界面上找不到可挂载的消息（外部窗口/后台任务的典型情况）。 */
        const known = new Set(
          chatMessagesRef.current.map((m) => m.taskId).filter(Boolean) as string[],
        )
        if (userMessageIds.some((id) => !known.has(id))) {
          void threads?.loadMessages(sid, { force: true })
        }
      },
    })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, boundSessionId])

  /* 进工作台就把该项目的任务历史读回来。
     任务已经落库，但前端记录只在内存 —— 不回读的话刷新一次历史就"没了"，
     用户会以为渲染结果丢了。切换项目时也重新读。 */
  useEffect(() => {
    void tasks.loadHistory(projectId)
    // tasks 每次渲染都是新对象，放进依赖会无限循环；只跟项目走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  /**
   * 提交一次真实渲染。
   *
   * <p>当前用项目名与简报生成一个最小影片（标题 + 副标题），
   * 先让链路可点可验；等场景编辑器能导出结构化分镜后，
   * 这里的 film 换成编辑器产出的那份。</p>
   */
  /**
   * 渲染项目工程。
   *
   * <p>这是「真实创作」的出口：渲的是 agent 写在项目里的 Remotion 源码。
   * 与 {@link submitRealRender} 的区别不只是实现，而是产物性质 ——
   * 那个渲的是内置标题卡，只能验证链路通不通；这个渲的是用户要的片子。</p>
   *
   * @returns 是否成功
   */
  const submitProjectRender = async (): Promise<boolean> => {
    if (sourceOperation.current || realRenderBusy || realModifyBusy || workflowRunning || remoteCreationBusy) return false
    sourceOperation.current = true
    setRealRenderBusy(true)
    setFilmRenderError('')
    try {
      const result = await studioHttpApi().workflowContext.renderFilm(projectId, review.brief.original || undefined)
      setNotice(`已渲染工程 ${result.entry} · 版本 v${result.version}`)
      /* 渲染提交了新版本：刷新版本列表与当前场景，让画面区立刻能播这一版。
         不刷新的话用户要手动重开才知道片子变了。 */
      void sceneVersions.refresh(true)
      void tasks.currentScene(projectId).then((probe) => { if (probe.scene) setCurrentSceneState(probe.scene) })
      rereadRuns()
      return true
    } catch (error) {
      /* 失败原因要透出来：渲染失败可能是语法错误、超时、缺入口，
         每种都指向不同的下一步，一句「渲染失败」等于没说。 */
      const message = error instanceof Error ? error.message : String(error)
      setFilmRenderError(message)
      setNotice(`渲染失败：${message.slice(0, 160)}`)
      return false
    } finally {
      sourceOperation.current = false
      setRealRenderBusy(false)
    }
  }

  /* 对话里自动渲染出了新版本（无论在对话页还是工作台侧栏发的消息）：和手动渲染成功后一样刷新，
     画面区立刻能播这一版，不用手动重开。 */
  useEffect(() => onProjectRendered((event) => {
    if (event.projectId !== projectId) return
    void sceneVersions.refresh(true)
    void tasks.currentScene(projectId).then((probe) => { if (probe.scene) setCurrentSceneState(probe.scene) })
    rereadRuns()
    // sceneVersions / tasks 每次渲染都是新对象，放进依赖会反复订阅；只跟项目走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projectId])
  return { realRenderBusy, filmProject, setAgentReply, setAwaitingActive, setUsedResources, getRoundOutcome, setResourcePickerOpen, overlayGuides, toggleOverlayGuide, awaitingActive, submitProjectRender, usedResources, agentReply, filmRenderError, setFilmRenderError, resourcePickerOpen }
}

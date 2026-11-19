import type * as React from 'react'
import { timeSpanBrief, type TimeSpan } from '@/features/workbench/model/timeRange'
import { studioHttpApi } from '@/api'
import { ApiError } from '@/api/errors'
import { formatMediaTime } from '@/features/workbench/model/previewGeometry'
import type { ChatMessage as ContractMessage } from '@/api/contracts'
import { libraryReferences, creationIntent } from '@/features/creation/services/creationResources'
import { submitCreation } from '@/features/creation/services/creationClient'
import type { ChatMessage as ChatItem } from '@/features/chat/hooks/useChat'
import { recordRoundOutcome } from '@/features/chat/model/roundOutcomes'
import { invalidateBackfill } from '@/features/chat/services/roundOutcomeBackfill'
import { useWorkbenchReview } from '@/features/workbench/hooks/useWorkbenchReview'
import { useSceneVersions } from '@/features/workbench/hooks/useSceneVersions'
import type { TaskRequest, ModificationConstraints } from '@/api/studioApi'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { ProjectSceneState } from '@/api/taskClient'
import type { FilmProjectState } from '@/api/workflowContext'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { MonitorVisualItem } from '@/features/workbench/components/MonitorZones'

export interface UseRealModifyArgs {
  buildRequest: (prompt: string, kind: TaskRequest['kind'], useConstraints: ModificationConstraints) => TaskRequest
  capturedPreview: React.RefObject<{ id: string; image: string } | null>
  chat: WorkbenchProps['chat']
  constraints: ModificationConstraints
  correctionAttempt: React.RefObject<{ key: string; id: string } | null>
  currentSceneState: ProjectSceneState | null
  ensureBoundSession: (firstPrompt: string) => Promise<{ sessionId: string | null; error?: string }>
  filmProject: FilmProjectState | null
  focusFeedback: () => void
  pendingSubmissionRef: React.RefObject<{ promptKey: string; idempotencyKey: string; sessionId: string; userMessageId?: string; taskId?: string; path?: 'main' | 'alt'; createdAt: number } | null>
  previewDuration: number
  previewMediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>
  projectId: WorkbenchProps['projectId']
  projectVersionLead: StageVisual | null
  realModifyBusy: boolean
  realRenderBusy: boolean
  refreshCurrentScene: (reason: string) => Promise<void>
  remoteCreationBusy: boolean
  rereadRuns: () => void
  review: ReturnType<typeof useWorkbenchReview>
  sceneVersions: ReturnType<typeof useSceneVersions>
  setAgentReply: React.Dispatch<React.SetStateAction<string>>
  setAwaitingActive: React.Dispatch<React.SetStateAction<boolean>>
  setBottomTab: React.Dispatch<React.SetStateAction<'activity' | 'changes' | 'versions'>>
  setComparison: React.Dispatch<React.SetStateAction<[StageVisual, StageVisual] | null>>
  setCurrentSceneState: React.Dispatch<React.SetStateAction<ProjectSceneState | null>>
  setExecutionPhase: React.Dispatch<React.SetStateAction<string>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPendingPlayback: React.Dispatch<React.SetStateAction<{ version: number; start: number } | null>>
  setRealModifyBusy: React.Dispatch<React.SetStateAction<boolean>>
  setRealModifyError: React.Dispatch<React.SetStateAction<string>>
  setSelectedArtifactId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedVisual: (item: MonitorVisualItem | null) => void
  setSourceCreationBusy: React.Dispatch<React.SetStateAction<boolean>>
  setUnsavedReplies: React.Dispatch<React.SetStateAction<{ userMessageId: string; reply: string; sessionId: string; requestId?: string }[]>>
  setUsedResources: React.Dispatch<React.SetStateAction<{ kind: string; id: string; label: string; usage: string; path: string | null; startMs: number | null; endMs: number | null }[]>>
  sourceOperation: React.RefObject<boolean>
  submissionEngine: { model: string; harness: string; reasoningEffort?: string }
  tasks: WorkbenchProps['tasks']
  threads: WorkbenchProps['threads']
  updatePendingSubmission: (state: { promptKey: string; idempotencyKey: string; sessionId: string; userMessageId?: string; taskId?: string; path?: 'main' | 'alt'; createdAt: number } | null) => void
  viewedPreview: StageVisual | null
  workflowRunning: boolean
}

/** 从 Workbench.tsx 的 Workbench 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useRealModify({ buildRequest, capturedPreview, chat, constraints, correctionAttempt, currentSceneState, ensureBoundSession, filmProject, focusFeedback, pendingSubmissionRef, previewDuration, previewMediaRef, projectId, projectVersionLead, realModifyBusy, realRenderBusy, refreshCurrentScene, remoteCreationBusy, rereadRuns, review, sceneVersions, setAgentReply, setAwaitingActive, setBottomTab, setComparison, setCurrentSceneState, setExecutionPhase, setNotice, setPendingPlayback, setRealModifyBusy, setRealModifyError, setSelectedArtifactId, setSelectedVisual, setSourceCreationBusy, setUnsavedReplies, setUsedResources, sourceOperation, submissionEngine, tasks, threads, updatePendingSubmission, viewedPreview, workflowRunning }: UseRealModifyArgs) {
  /**
   * 提交一次真实修改。
   *
   * <p>与演示路径的分工（两条入口刻意分开，不互相顶替）：
   * 这里是**真实后端**，请求体只带后端第一版真正解释的字段
   * （kind/prompt/scope/sceneIds/baseVersion）。参考定位与保留约束没有实现，
   * 带上会被「收下但不执行」，所以根本不发。</p>
   *
   * <p>失败一律如实显示并保留用户输入，**不回退到演示**：
   * 后端不可用时让用户以为改成功了，比明说「连不上」糟得多。
   * 只有用户自己点演示入口才会走 Mock。</p>
   *
   * @param prompt 用户原话
   * @param span   只看这几秒（「按时间段修改」入口传进来）；不传就是整条片子的意见
   * @returns 是否已成功提交
   */
  const submitRealModify = async (prompt: string, span?: TimeSpan, previewImage?: string): Promise<boolean> => {
    if (!prompt.trim()) { setRealModifyError('请先写下制作要求'); focusFeedback(); return false }
    /* 时间段修改的基准是**当前工程版本**，不是画面列表首项：
       首项可能是编辑器试片，拿它比会把「看着当前工程版本」误判成历史。 */
    if (span && (!viewedPreview || viewedPreview.id !== projectVersionLead?.id || !Number.isFinite(previewDuration) || span.start < 0 || span.end <= span.start || span.end > previewDuration)) {
      setRealModifyError('请选择当前最新视频中有效的时间范围；历史版本请先恢复后再修改。')
      return false
    }
    /* 段落修改是同一件事的窄范围版本：落盘与请求里都要带「哪一段」。
       只把用户那句话写进去，下一轮（或换个会话）就再也看不出他指的是第 3–6 秒。 */
    const correctionText = span ? `${timeSpanBrief(span, prompt)}\n\n用户原话：${prompt.trim()}` : prompt
    if (sourceOperation.current || realModifyBusy || realRenderBusy || workflowRunning || remoteCreationBusy) return false
    sourceOperation.current = true
    setRealModifyBusy(true)
    setSourceCreationBusy(true)
    try {
      if (previewImage || span) {
        let capability: { supported: boolean; baseVersionCheck?: boolean; atomicCorrection?: boolean; correctionRetryId?: boolean }
        try {
          capability = await studioHttpApi().workflowContext.previewImageCapability(projectId)
        } catch (error) {
          setRealModifyError(error instanceof ApiError && error.httpStatus === 404
            ? '当前后端不支持安全地提交画面或时间范围，请更新并重启应用后重试。'
            : '无法确认目标版本校验是否可用，请检查本地服务连接后重试；输入和引用已保留。')
          return false
        }
        if (!capability.baseVersionCheck || !capability.atomicCorrection || !capability.correctionRetryId || (previewImage && !capability.supported)) {
          setRealModifyError('当前后端不支持所需的画面引用或版本校验，请更新并重启应用后重试。')
          return false
        }
      }
      /* 项目有 Remotion 工程时，修改走另一条路：
         意见写进 corrections.md，由 agent 改工程源码，再渲染出新的版本。
         不能走 modify 任务 —— 那条改的是 scenes 数据，
         而这个项目的画面在源码里，改数据不会让画面变。 */
      const context = await studioHttpApi().workflowContext.state(projectId)
      const baseline = await tasks.currentScene(projectId)
      /* 这里以**服务端当前场景版本**为准（baseline.scene.version），
         再要求正在看的是那条场景画面。不再要求「等于画面列表首项」——
         首项可能是试片，那个条件与服务端事实无关，只会误拒当前版本。 */
      if ((span || previewImage) && (viewedPreview?.origin !== 'scene' || !baseline.scene || viewedPreview.revision !== baseline.scene.version || viewedPreview.id !== projectVersionLead?.id)) {
        setRealModifyError('当前预览无法确认与项目最新工程版本一致，请先切换或恢复到当前版本。')
        return false
      }
      if (!baseline.scene && !context.initialized && !filmProject?.ready) {
        throw new Error(baseline.failure.message || '无法读取项目当前版本')
      }
      if (filmProject?.ready || context.initialized || !baseline.scene?.initialized) {
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

      if (span) {
        setRealModifyError('当前项目的场景修改方式暂不支持按时间段修改，未提交请求。')
        return false
      }

      /* 先读当前场景：既拿到 baseVersion 做版本预检，也确认项目确实有场景。
         没有场景时不能提交 —— 后端会拒绝，前端也不该把一个注定失败的请求发出去。 */
      const probe = await tasks.currentScene(projectId)
      if (!probe.scene) {
        setRealModifyError(probe.failure.message || '读取当前场景失败')
        return false
      }
      if (!probe.scene.initialized) {
        /* 修改需要已有场景做基线，没有就明确拒绝。
           这里刻意不再自己造一条「从一句话生成」的旁路：项目已有的
           workflow-v0.1.1 才是创作路径，绕开它另做一条简化管线
           （比如只生成文字卡片）会偏离产品方向，也让两套流程并存。
           真正的创作入口应走工作流，等它接通后替换这句提示。 */
        setRealModifyError('项目还没有场景。请先在工作流里创作一条片子，再对它提出修改。')
        return false
      }

      /* 范围沿用 buildRequest 的推导结果：它在到处都在用，另写一份
         「哪一段」的判定迟早会和它给出不同答案。selection 第一版后端不支持，
         按 project 提交前必须先告诉用户，不能悄悄放大范围。 */
      const derived = buildRequest(prompt, 'modify', constraints)
      if (review.keepNotes.trim()) {
        setRealModifyError('已保存的保留要求暂不参与真实修改。请先清除该要求；当前无法保证这些保留条件。')
        return false
      }
      if (derived.references?.some((ref) => ref.role === 'context')) {
        setRealModifyError('当前场景修改模式暂不支持带入参考上下文。若需提交，请先在引用栏中移除参考引用或清空后再试。')
        return false
      }
      if (derived.scope === 'selection') {
        setRealModifyError('选区修改暂不支持，请改为选定某个场景或整片后再试')
        return false
      }
      // 备用路径同样严格接入服务端会话与持久化，杜绝孤儿消息
      const sessionResult = await ensureBoundSession(prompt)
      if (sessionResult.error || !sessionResult.sessionId) {
        setRealModifyError(`会话未保存：${sessionResult.error || '未能创建项目会话'}。输入已保留，未提交修改任务。`)
        return false
      }
      const effectiveSid = sessionResult.sessionId

      const useScene = derived.scope === 'scene' && derived.sceneIds.length > 0
      const altTargetRef: NonNullable<ContractMessage['references']>[number] = useScene && derived.sceneIds[0]
        ? {
            id: `ref-scene-${derived.sceneIds[0]}`,
            role: 'target',
            kind: 'scene',
            sceneId: derived.sceneIds[0],
            label: '场景修改',
            action: 'workflow_modify',
          }
        : {
            id: `ref-project-${projectId}`,
            role: 'target',
            kind: 'project',
            projectId,
            label: '全局项目修改',
            action: 'workflow_modify',
          }
      const altReferences: NonNullable<ContractMessage['references']> = [altTargetRef]

      // 统一两条提交路径的重试幂等与状态解耦
      const promptKey = `${effectiveSid}:${projectId}:${prompt}:alt`
      const isRetrySamePrompt = pendingSubmissionRef.current?.promptKey === promptKey
      let userMsgId = isRetrySamePrompt && pendingSubmissionRef.current?.userMessageId ? pendingSubmissionRef.current.userMessageId : null
      const altIdempotencyKey = isRetrySamePrompt && pendingSubmissionRef.current?.idempotencyKey ? pendingSubmissionRef.current.idempotencyKey : crypto.randomUUID()

      if (!userMsgId) {
        const nextPending = {
          promptKey,
          idempotencyKey: altIdempotencyKey,
          sessionId: effectiveSid,
          path: 'alt' as const,
          createdAt: Date.now(),
        }
        updatePendingSubmission(nextPending)

        if (threads) {
          try {
            const savedMsg = await threads.sendMessage(effectiveSid, prompt, {
              idempotencyKey: altIdempotencyKey,
              references: altReferences,
            })
            userMsgId = savedMsg.id
            updatePendingSubmission({ ...nextPending, userMessageId: savedMsg.id })
          } catch (saveErr: unknown) {
            const msg = saveErr instanceof Error ? saveErr.message : String(saveErr)
            setRealModifyError(`会话消息未能写入服务端：${msg}。输入内容已保留，未提交修改任务。`)
            return false
          }
        } else {
          userMsgId = `m-wb-alt-${Date.now().toString(36)}`
          updatePendingSubmission({ ...nextPending, userMessageId: userMsgId })
        }

        chat.appendMessage({
          id: userMsgId,
          role: 'user',
          text: prompt,
          projectId,
          sessionId: effectiveSid,
          references: altReferences,
          at: Date.now(),
        })
      }

      // 消息已落盘后，启动后台任务
      const result = await tasks.startModify(projectId, {
        kind: 'modify',
        prompt,
        scope: useScene ? 'scene' : 'project',
        sceneIds: useScene ? derived.sceneIds : [],
        baseVersion: probe.scene.version,
      }, (status) => {
        /* 任务结束后重新读取当前场景：
           - completed：场景已被后端提交为新版本，界面必须立刻反映新内容与新版本
           - 其它：也重读一次，以免界面停留在提交前的旧版本上继续修改
           这一步失败不提示：任务结果本身还没展示完，再弹一个错误会盖住它。 */
        void refreshCurrentScene(status)
      })
      if (!result.taskId) {
        const failure = result.failure
        /* 冲突单独给一句：用户需要知道「刷新后重试」，而不是以为要求写错了 */
        const hint = failure?.reason === 'conflict'
          ? '场景已被其他操作更新，请刷新后再试'
          : failure?.message
        setRealModifyError(`任务启动失败：${hint || '提交失败'}。意见已记录在会话中。`)
        return false
      }
      setRealModifyError('')
      updatePendingSubmission(null)
      // 审阅记录只包含真实提交的目标与文字，不把本地需求、引用或保留条件当成发送记录。
      review.record({
        ...derived,
        scope: useScene ? 'scene' : 'project',
        sceneIds: useScene ? derived.sceneIds : [],
        references: (derived.references ?? []).filter((ref) => ref.role === 'target' && (ref.kind === 'project' || (useScene && ref.kind === 'scene'))),
        constraints: { preserveCamera: false, preserveCaptions: false, limitToSelection: useScene, reuseExistingComponents: false },
      }, { includeBrief: false })

      // 真实落盘至前端 chat，带有确定性 ID、taskId 与 target 引用
      chat.appendMessage({
        id: userMsgId,
        role: 'user',
        text: prompt,
        projectId,
        sessionId: effectiveSid,
        taskId: result.taskId,
        references: altReferences,
        at: Date.now(),
      })
      setBottomTab('activity')
      return true
    } catch (error) {
      setRealModifyError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      sourceOperation.current = false
      setRealModifyBusy(false)
      setSourceCreationBusy(false)
      rereadRuns()
    }
  }

  /**
   * 提交一次「只改这段时间」的修改。
   *
   * <p>为什么不复用对话输入框那条路：那边的范围由引用与作用域推导，
   * 时间段只是标签里的一句话，agent 读到的仍是一句自然语言。
   * 这里把起止秒数当成独立参数拼进意图（见 {@link timeSpanBrief}），
   * 并在用户的话之外写清「其余时间段尽量不变」只是目标而非承诺。</p>
   *
   * <p>提交前先暂停播放：用户刚圈定的那几秒正在播的话，
   * 等新版本回来时播放头早已跑过那一段，他会以为改的不是自己看的地方。</p>
   *
   * @param span 用户圈定的时间段（已按片长钳过）
   * @param requirement 对这几秒的要求
   */
  const submitTimeSpan = async (span: TimeSpan, requirement: string): Promise<boolean> => {
    if (previewMediaRef.current instanceof HTMLVideoElement) previewMediaRef.current.pause()
    return submitRealModify(requirement, span)
  }
  return { submitRealModify, submitTimeSpan }
}

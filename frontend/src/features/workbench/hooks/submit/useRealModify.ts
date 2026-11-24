import type * as React from 'react'
import type { SourceTargetContext } from '@/api/sourceRender'
import { timeSpanBrief, type TimeSpan } from '@/features/workbench/model/timeRange'
import { studioHttpApi } from '@/api'
import { ApiError } from '@/api/errors'
import { useWorkbenchReview } from '@/features/workbench/hooks/useWorkbenchReview'
import { useSceneVersions } from '@/features/workbench/hooks/useSceneVersions'
import type { TaskRequest, ModificationConstraints } from '@/api/studioApi'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { ProjectSceneState } from '@/api/taskClient'
import type { FilmProjectState } from '@/api/workflowContext'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { MonitorVisualItem } from '@/features/workbench/components/MonitorZones'
import { submitFilmCorrection } from '@/features/workbench/services/submitFilmCorrection'
import { submitSceneModify } from '@/features/workbench/services/submitSceneModify'

/** 两条提交路径共用的这一次提交的输入。 */
export interface RealModifyInput {
  prompt: string
  span?: TimeSpan
  previewImage?: string
  target?: SourceTargetContext
}

export interface UseRealModifyArgs {
  draftOnly?: boolean
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

/** 工作台的真实修改提交（含按时间段修改）：校验目标版本与后端能力后，按项目形态走工程修正或场景修改；失败如实报错并保留输入。 */
export function useRealModify(args: UseRealModifyArgs) {
  const { filmProject, focusFeedback, previewDuration, previewMediaRef, projectId, projectVersionLead, realModifyBusy, realRenderBusy, remoteCreationBusy, rereadRuns, setRealModifyBusy, setRealModifyError, setSourceCreationBusy, sourceOperation, tasks, viewedPreview, workflowRunning } = args
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
  const submitRealModify = async (prompt: string, span?: TimeSpan, previewImage?: string, target?: SourceTargetContext): Promise<boolean> => {
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
        return await submitFilmCorrection(args, { prompt, span, previewImage, target, context, baseline, correctionText })
      }

      return await submitSceneModify(args, { prompt, span })
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

import type * as React from 'react'
import { ConsoleChrome } from '@/features/workbench/components/ConsoleChrome'
import { SceneVersionPanel } from '@/features/workbench/components/SceneVersionPanel'
import { WorkbenchReviewDesk } from '@/features/workbench/components/WorkbenchReviewDesk'
import { BriefPanel } from '@/features/workbench/components/BriefPanel'
import { TaskRecordPanel } from '@/features/workbench/components/TaskRecordPanel'
import { RightPanel } from '@/features/workbench/components/RightPanel'
import { clearRoundOutcome } from '@/features/chat/model/roundOutcomes'
import { useTimelineManifest } from '@/features/workbench/hooks/modify-target/useTimelineManifest'
import { useSubmitQueue } from '@/features/workbench/hooks/submit/useSubmitQueue'
import { useWorkbenchSubmit } from '@/features/workbench/hooks/submit/useWorkbenchSubmit'
import { useTargetReferences } from '@/features/workbench/hooks/modify-target/useTargetReferences'
import { useReviewOpinionLocate } from '@/features/workbench/hooks/review/useReviewOpinionLocate'
import { useTimeRangeTarget } from '@/features/workbench/hooks/modify-target/useTimeRangeTarget'
import { useProjectRender } from '@/features/workbench/hooks/stage/useProjectRender'
import { useUnsavedReplies } from '@/features/workbench/hooks/session/useUnsavedReplies'
import { useVisualSelection } from '@/features/workbench/hooks/stage/useVisualSelection'
import { useStageTimeRange } from '@/features/workbench/components/StageTimeRange'
import { useWorkbenchReview } from '@/features/workbench/hooks/useWorkbenchReview'
import { useWorkbenchExport } from '@/features/workbench/hooks/stage/useWorkbenchExport'
import { useSceneVersions } from '@/features/workbench/hooks/useSceneVersions'
import { useSessionDraft } from '@/features/chat/hooks/useDraftStore'
import type { BriefSection } from '@/features/workbench/components/BriefDetailWorkspace'
import type { ModificationConstraints, AgentReference } from '@/api/studioApi'
import type { ProjectSceneState } from '@/api/taskClient'
import type { Session } from '@/features/chat/hooks/useSessions'
import type { SideTab } from '@/features/workbench/model/workbenchConsole'
import type { TaskRecord } from '@/features/creation/hooks/useAgentTasks'
import type { ProjectVersionInfo } from '@/features/workbench/model/versionIdentity'
import type { WorkflowDef } from '@/features/workflow/services/workflowService'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { WorkbenchProps } from '@/features/workbench/Workbench'

export interface WorkbenchConsoleProps {
  adjustPendingConfirm: ReturnType<typeof useTimelineManifest>['adjustPendingConfirm']
  boundSessionId: string | null
  briefSection: BriefSection
  cancelQueued: ReturnType<typeof useSubmitQueue>['cancelQueued']
  cancelTaskAndHold: ReturnType<typeof useWorkbenchSubmit>['cancelTaskAndHold']
  chat: WorkbenchProps['chat']
  clearReferences: ReturnType<typeof useTargetReferences>['clearReferences']
  closeEdit: () => void
  constraints: ModificationConstraints
  continueOpinion: ReturnType<typeof useReviewOpinionLocate>['continueOpinion']
  currentProjectRef: ReturnType<typeof useTimeRangeTarget>['currentProjectRef']
  currentSceneState: ProjectSceneState | null
  currentSession: Session | null
  defaultTarget: ReturnType<typeof useTimeRangeTarget>['defaultTarget']
  editMode: boolean
  effectiveTarget: ReturnType<typeof useTimeRangeTarget>['effectiveTarget']
  executionPhase: string
  filmProject: ReturnType<typeof useProjectRender>['filmProject']
  focusChatKey: number
  focusFeedback: ReturnType<typeof useTargetReferences>['focusFeedback']
  getRoundOutcome: ReturnType<typeof useProjectRender>['getRoundOutcome']
  handleConfirmWholeProject: ReturnType<typeof useWorkbenchSubmit>['handleConfirmWholeProject']
  handleRetrySaveAllReplies: ReturnType<typeof useUnsavedReplies>['handleRetrySaveAllReplies']
  handleRetrySaveReply: ReturnType<typeof useUnsavedReplies>['handleRetrySaveReply']
  locateReference: ReturnType<typeof useTargetReferences>['locateReference']
  locateReviewOpinion: ReturnType<typeof useReviewOpinionLocate>['locateReviewOpinion']
  onNavigate: WorkbenchProps['onNavigate']
  onSelectSession: WorkbenchProps['onSelectSession']
  openReview: (tab: SideTab) => void
  openTaskRecords: ReturnType<typeof useTimeRangeTarget>['openTaskRecords']
  pendingSubmits: ReturnType<typeof useSubmitQueue>['pendingSubmits']
  projectId: WorkbenchProps['projectId']
  projectName: ReturnType<typeof useVisualSelection>['projectName']
  projectRecords: TaskRecord[]
  projectSessions: Session[]
  projectTask: TaskRecord | null
  projectVersion: ProjectVersionInfo
  projectVersionNumber: number | null
  projectWorkflows: WorkflowDef[]
  range: ReturnType<typeof useStageTimeRange>
  realModifyBusy: boolean
  realModifyError: string
  realRenderBusy: ReturnType<typeof useProjectRender>['realRenderBusy']
  references: AgentReference[]
  remoteCreationBusy: boolean
  removeReference: ReturnType<typeof useTargetReferences>['removeReference']
  review: ReturnType<typeof useWorkbenchReview>
  runQuickAction: ReturnType<typeof useWorkbenchExport>['runQuickAction']
  sceneVersions: ReturnType<typeof useSceneVersions>
  scope: 'scene' | 'project' | 'selection'
  scopeShort: ReturnType<typeof useTimeRangeTarget>['scopeShort']
  selectSideTab: ReturnType<typeof useTargetReferences>['selectSideTab']
  selectedTaskRecordId: string | null
  sessionDraft: ReturnType<typeof useSessionDraft>
  setBoundSessionId: React.Dispatch<React.SetStateAction<string | null>>
  setBriefSection: React.Dispatch<React.SetStateAction<BriefSection>>
  setCanvasView: React.Dispatch<React.SetStateAction<'brief' | 'task' | 'monitor'>>
  setComparison: React.Dispatch<React.SetStateAction<[StageVisual, StageVisual] | null>>
  setComparisonAt: React.Dispatch<React.SetStateAction<{ timeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } } | null>>
  setConstraints: React.Dispatch<React.SetStateAction<ModificationConstraints>>
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>
  setLoopSpan: React.Dispatch<React.SetStateAction<boolean>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setRealModifyError: React.Dispatch<React.SetStateAction<string>>
  setReferences: React.Dispatch<React.SetStateAction<AgentReference[]>>
  setResourcePickerOpen: ReturnType<typeof useProjectRender>['setResourcePickerOpen']
  setScope: React.Dispatch<React.SetStateAction<'scene' | 'project' | 'selection'>>
  setSelectedArtifactId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedTaskRecordId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedVisual: ReturnType<typeof useVisualSelection>['setSelectedVisual']
  setSideTab: React.Dispatch<React.SetStateAction<SideTab>>
  setTargetReference: ReturnType<typeof useTimeRangeTarget>['setTargetReference']
  setTrayOpen: React.Dispatch<React.SetStateAction<boolean>>
  setWorkbenchDraftText: (text: string) => void
  showPreview: ReturnType<typeof useSubmitQueue>['showPreview']
  sideTab: SideTab
  sourceCreationBusy: boolean
  stage: { visuals: StageVisual[]; hasRun: boolean; lastRunStatus: 'none' | 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_info'; requestOnly: boolean }
  stageLead: StageVisual
  startQueued: ReturnType<typeof useSubmitQueue>['startQueued']
  submit: ReturnType<typeof useWorkbenchSubmit>['submit']
  targetEvaluation: ReturnType<typeof useTimelineManifest>['targetEvaluation']
  taskReturnTab: SideTab
  threads: WorkbenchProps['threads']
  toggleReferenceRole: ReturnType<typeof useTargetReferences>['toggleReferenceRole']
  unsavedReplies: { userMessageId: string; reply: string; sessionId: string; requestId?: string }[]
  viewedPreview: ReturnType<typeof useVisualSelection>['viewedPreview']
  workflowRunning: boolean
}

/**
 * 工作台右栏：按页签在对话、版本、修改审阅、创作要求和执行记录之间切换内容，
 * 场景编辑态下改为提示并提供返回对话的入口。
 */
export function WorkbenchConsole({ adjustPendingConfirm, boundSessionId, briefSection, cancelQueued, cancelTaskAndHold, chat, clearReferences, closeEdit, constraints, continueOpinion, currentProjectRef, currentSceneState, currentSession, defaultTarget, editMode, effectiveTarget, executionPhase, filmProject, focusChatKey, focusFeedback, getRoundOutcome, handleConfirmWholeProject, handleRetrySaveAllReplies, handleRetrySaveReply, locateReference, locateReviewOpinion, onNavigate, onSelectSession, openReview, openTaskRecords, pendingSubmits, projectId, projectName, projectRecords, projectSessions, projectTask, projectVersion, projectVersionNumber, projectWorkflows, range, realModifyBusy, realModifyError, realRenderBusy, references, remoteCreationBusy, removeReference, review, runQuickAction, sceneVersions, scope, scopeShort, selectSideTab, selectedTaskRecordId, sessionDraft, setBoundSessionId, setBriefSection, setCanvasView, setComparison, setComparisonAt, setConstraints, setEditMode, setLoopSpan, setNotice, setRealModifyError, setReferences, setResourcePickerOpen, setScope, setSelectedArtifactId, setSelectedTaskRecordId, setSelectedVisual, setSideTab, setTargetReference, setTrayOpen, setWorkbenchDraftText, showPreview, sideTab, sourceCreationBusy, stage, stageLead, startQueued, submit, targetEvaluation, taskReturnTab, threads, toggleReferenceRole, unsavedReplies, viewedPreview, workflowRunning }: WorkbenchConsoleProps) {
  return (
    <div className="open-workbench-conversation">
      {/* 标题与页签栏是这一列所有面板共用的底座：
          对话 / 创作要求 / 执行记录 / 版本 / 修改审阅 都在这条页签上，
          切换时只换下面的内容区，导航本身在任何情况下（包括编辑态）均不消失。 */}
      <ConsoleChrome
        sideTab={sideTab}
        onChange={(next) => { if (editMode) setEditMode(false); selectSideTab(next) }}
        sessions={projectSessions}
        currentSessionId={currentSession?.id}
        onSelectSession={(sid) => {
          setBoundSessionId(sid)
          onSelectSession?.(sid)
        }}
        projectName={projectName}
      />
      {editMode ? (
        <div className="fw-scroll flex flex-col h-full p-4">
          <div className="font-medium text-sm text-[var(--tx)]">场景对象与属性</div>
          <p className="text-xs text-[var(--tx2)] mt-2 leading-relaxed">
            当前正在右侧工作区编辑 Remotion 场景。点击上方“对话”或任意页签可随时退出编辑态返回对话。
          </p>
          <div className="mt-4">
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-[var(--tx)] hover:border-blue-500/40 transition-colors"
              onClick={closeEdit}
            >
              退出编辑，返回对话
            </button>
          </div>
        </div>
      ) : sideTab === 'versions' ? (
        <SceneVersionPanel projectId={projectId} scene={currentSceneState} versions={sceneVersions}
          viewedVersion={viewedPreview?.origin === 'scene' ? viewedPreview.revision : undefined}
          onView={(visual) => showPreview(visual)}
          onCompare={(left, right) => { setEditMode(false); setSelectedArtifactId(null); setSelectedVisual(null); setComparison([left, right]); setComparisonAt(null); setTrayOpen(false) }}
          onClose={() => { selectSideTab('chat'); void sceneVersions.refresh(true) }}/>
      ) : sideTab === 'review' ? (
        <WorkbenchReviewDesk projectId={projectId} review={review} visuals={stage.visuals} viewedId={viewedPreview?.id}
          onClose={() => { focusFeedback() }} onDiscuss={focusFeedback}
          onView={showPreview} onCompare={(left, right, opinion) => {
            setEditMode(false); setSelectedArtifactId(null); setComparison([left, right]); setTrayOpen(false)
            const at = opinion?.request.references?.find((ref) => ref.role === 'target') ?? effectiveTarget
            setComparisonAt(at.kind === 'preview' && 'timeSeconds' in at ? { timeSeconds: at.timeSeconds, bbox: at.bbox } : null)
          }}
          onLocate={locateReviewOpinion}
          onContinue={continueOpinion}/>
      ) : sideTab === 'brief' || (sideTab as string) === 'settings' ? (
        <BriefPanel
          review={review}
          onDiscuss={focusFeedback}
          activeSection={briefSection}
          onSelectSection={(sec) => {
            setBriefSection(sec)
            setCanvasView('brief')
          }}
        />
      ) : sideTab === 'task' ? (
        <TaskRecordPanel
          activeTask={projectTask?.task ?? null}
          records={projectRecords}
          cancelTask={cancelTaskAndHold}
          selectedTaskId={selectedTaskRecordId}
          onSelectTaskId={(id) => {
            setSelectedTaskRecordId(id)
            setCanvasView('task')
          }}
          onResumeRequest={(request) => {
            setReferences(structuredClone(request.references ?? [])); setConstraints(structuredClone(request.constraints)); setScope(request.scope); setWorkbenchDraftText(request.prompt); focusFeedback()
          }}
          onDiscuss={focusFeedback}
        />
      ) : (
        <RightPanel sourceMode={!!filmProject?.ready || projectWorkflows.length > 0 || !currentSceneState?.initialized} realModifyBusy={realModifyBusy || realRenderBusy || workflowRunning || remoteCreationBusy} realModifyError={realModifyError}
                   projectVersion={projectVersion}
                   projectVersionNumber={projectVersionNumber}
                   projectVersionAuthoritative={projectVersion.authoritative}
                   executionPhase={executionPhase}
                   unsavedReplies={unsavedReplies}
                   onRetrySaveReply={handleRetrySaveReply}
                   onRetrySaveAllReplies={handleRetrySaveAllReplies}
                   onClearRealModifyError={() => setRealModifyError('')}
                   adjustPendingConfirm={adjustPendingConfirm}
                   canConfirmWholeProject={Boolean(adjustPendingConfirm || targetEvaluation.status === 'unsupported_target')}
                   onConfirmWholeProject={handleConfirmWholeProject}
                   getRoundOutcome={getRoundOutcome}
                   onClearRoundOutcome={(userMessageId) => clearRoundOutcome(projectId, boundSessionId, userMessageId)}
                   currentSession={currentSession}
                   /* 工程任务（改工程/渲染/工作流/远程）不能用会话流停止，
                      单独传下去，让输入框只在「确实能停」时显示停止键。 */
                   engineeringBusy={realModifyBusy || realRenderBusy || workflowRunning || remoteCreationBusy || sourceCreationBusy}
                   onNotice={setNotice}
                   onRetryMessages={(sid) => void threads?.loadMessages(sid, { force: true })}
                   isSessionLoading={currentSession && threads ? threads.isSessionLoadingMessages(currentSession.id) : false}
                   chat={chat} sideTab={sideTab} setSideTab={selectSideTab}
                   focusChatKey={focusChatKey}
                   scope={scope}
                   scopeShort={scopeShort} projectId={projectId} target={effectiveTarget} preview={viewedPreview ?? stageLead}
                   stageLead={stageLead}
                   sessionDraft={sessionDraft}
                   onRestoreVersion={(ver) => void sceneVersions.restore(ver)}
                   onViewLead={() => showPreview(stageLead)}
                   rangeSpan={range.active && range.span ? range.span : null}
                   onOpenTask={openTaskRecords}
                   onBackFromTask={() => { setEditMode(false); setSideTab(taskReturnTab) }}
                   constraints={constraints} setConstraints={setConstraints}
                   activeTask={projectTask?.task ?? null} cancelTask={cancelTaskAndHold}
                   records={projectRecords} onSubmit={submit} onQuickAction={runQuickAction}
                   pending={pendingSubmits} onStartQueued={startQueued} onCancelQueued={cancelQueued}
                   onNavigate={onNavigate}
                   references={references} onRemoveReference={removeReference}
                   onLocateReference={locateReference} onToggleReferenceRole={toggleReferenceRole}
                   onClearReferences={clearReferences} onOpenResourcePicker={() => setResourcePickerOpen(true)} onScopeChange={(next) => { setScope(next); setTargetReference(next === 'project' ? currentProjectRef : defaultTarget) }}
                   onResumeRequest={(request) => {
                     setReferences(structuredClone(request.references ?? [])); setConstraints(structuredClone(request.constraints)); setScope(request.scope); setWorkbenchDraftText(request.prompt); focusFeedback()
                   }} onOpenReview={openReview} keepNotes={review.keepNotes}
                   onCompareVersions={(before, after) => {
                     setEditMode(false); setSelectedArtifactId(null); setComparison([before, after]); setTrayOpen(false)
                   }}
                   onShowPreview={(visual) => showPreview(visual)}
                   onClearRange={() => { range.reset(); setLoopSpan(false) }}
                   onResetScope={() => { setScope('project'); setTargetReference(currentProjectRef) }}
        />
      )}
    </div>
  )
}

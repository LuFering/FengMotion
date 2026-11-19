import { TargetSummaryPill } from '@/features/chat/components/TargetSummaryPill'
import { versionSeriesOf, type ProjectVersionInfo } from '@/features/workbench/model/versionIdentity'
import { ReferenceChips } from '@/features/workbench/components/rightpanel/ReferenceChips'
import type { AgentReference } from '@/api/studioApi'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { TimeSpan } from '@/features/workbench/model/timeRange'
import type { SessionDraft } from '@/features/chat/model/draft/draftTypes'

export interface ComposeContextBarProps {
  onClearRange: (() => void) | undefined
  onClearReferences: () => void
  onLocateReference: (ref: AgentReference) => void
  onOpenResourcePicker: () => void
  onRemoveReference: (id: string) => void
  onResetScope: (() => void) | undefined
  onRestoreVersion: ((version: number) => void) | undefined
  onToggleReferenceRole: (id: string) => void
  onViewLead: (() => void) | undefined
  preview: StageVisual | null
  projectId: string
  projectVersion: ProjectVersionInfo | undefined
  projectVersionNumber: number | null | undefined
  rangeSpan: TimeSpan | null | undefined
  references: AgentReference[]
  scope: 'project' | 'scene' | 'selection'
  sessionDraft: { draft: SessionDraft; updateDraft: (updater: Partial<SessionDraft> | ((prev: SessionDraft) => Partial<SessionDraft>)) => SessionDraft; flushText: (text: string) => void; clearDraft: () => void; key: string }
}

/** 从 RightPanel.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function ComposeContextBar({ onClearRange, onClearReferences, onLocateReference, onOpenResourcePicker, onRemoveReference, onResetScope, onRestoreVersion, onToggleReferenceRole, onViewLead, preview, projectId, projectVersion, projectVersionNumber, rangeSpan, references, scope, sessionDraft }: ComposeContextBarProps) {
  return (
    <div className="wb-compose-context">
      <TargetSummaryPill
        version={preview ? preview.revision : null}
        /* 版本来源必须一起传：跨序列比大小会报假「历史」 */
        versionSeries={preview ? versionSeriesOf(preview) : null}
        /* 工程版本**只在可信时**传数字；不可信时传标记，让胶囊降级措辞，
           而不是拿「已知画面最高」去断言「已推进至 vN」。 */
        stageLeadVersion={projectVersion?.authoritative ? projectVersionNumber : null}
        versionUnconfirmed={!projectVersion?.authoritative}
        scope={scope}
        targetSnapshot={sessionDraft.draft.targetSnapshot}
        draftIntent={sessionDraft.draft.intentAction}
        continuationScopeMode={sessionDraft.draft.continuationScopeMode}
        hasProject={Boolean(projectId)}
        rangeSpan={rangeSpan}
        references={references}
        onClearRange={onClearRange}
        onResetScope={onResetScope}
        onRestoreVersion={onRestoreVersion}
        onViewLead={onViewLead}
        onIntentChange={(intent) => {
          /* 意图必须独立落盘：没有显式目标时 targetSnapshot 是 null，
             只写进去等于什么都没存，用户点了「关于此提问」发出去仍会改工程。 */
          sessionDraft.updateDraft({
            intentAction: intent,
            ...(sessionDraft.draft.targetSnapshot
              ? { targetSnapshot: { ...sessionDraft.draft.targetSnapshot, intentAction: intent } }
              : {}),
          })
        }}
        onRemoveTarget={() => {
          sessionDraft.updateDraft({ targetSnapshot: null })
          onClearRange?.()
          onResetScope?.()
        }}
      />
      <ReferenceChips references={references} onRemoveReference={onRemoveReference} onLocateReference={onLocateReference} onToggleReferenceRole={onToggleReferenceRole} onClearReferences={onClearReferences} onOpenResourcePicker={onOpenResourcePicker} />
    </div>
  )
}

import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { FileCode01, Square } from '@untitledui/icons'
import { type ReactNode } from 'react'
import { useHarnesses, availabilityOf } from '@/features/harness/hooks/useHarnesses'
import { type TaskRecord } from '@/features/creation/hooks/useAgentTasks'
import { type StageVisual } from '@/features/workbench/model/stageVisual'
import { TASK_STATUS_LABEL } from '@/shared/lib/status'
import { SegmentedControl } from '@/shared/ui/segmented-control'
import { type RoundDelta, type RoundSummary } from '@/features/workbench/services/workbenchReviewService'
import { CONSTRAINT_LABELS } from '@/features/workbench/model/workbenchConsole'

/** 「这次改了什么」里差异项的显示名（键名在 service 里，中文标签在界面里） */
export const DELTA_LABEL: Record<RoundDelta['key'], string> = {
  target: '针对画面', time: '时间位置', region: '框选区域', prompt: '文字意见', brief: '需求快照',
}

export const CONSTRAINT_LABEL_MAP = Object.fromEntries(CONSTRAINT_LABELS) as Record<string, string>

/* ── 底部任务面板 ───────────────────────────────────────────── */
export function BottomTray({ previews, onPreview, workflowLog, records, rounds, activeId, onCancel, tab, setTab }:
  { previews: StageVisual[]; onPreview: (visual: StageVisual) => void; workflowLog: ReactNode; records: TaskRecord[]; rounds: RoundSummary[]; activeId: string | null; onCancel: (id: string) => void
    tab: 'activity'|'changes'|'versions'; setTab: (t: 'activity'|'changes'|'versions') => void }) {
  /* 底部托盘的 Agent 状态同样读真实探测，不再写死「离线」。 */
  const trayProbe = useHarnesses()
  const trayAgent = availabilityOf(trayProbe, 'deepseek').state
  const trayReady = trayAgent === 'available'
  return (
    <div className="fw-tray">
      <div className="fw-tray-hd">
        <SegmentedControl value={tab} onChange={setTab} ariaLabel="执行与版本"
                          className="fw-tray-seg"
                          options={[
                            { value: 'activity', label: '执行过程' },
                            { value: 'changes', label: '变更审阅' },
                            { value: 'versions', label: '预览记录' },
                          ]} />
        <span className="spacer" />
        <span className="num tray-note" title={trayReady ? 'Agent 已连接' : 'Agent 未连接'}>
          {trayReady ? '已连接' : trayAgent === 'checking' ? '检测中' : '未连接'}
        </span>
      </div>
      <div className="fw-scroll">
        <div className="fw-tray-body">
          {tab === 'activity' && workflowLog}
          {tab === 'activity' && (records.length === 0
            ? <div className="fw-tray-empty">还没有修改请求。</div>
            : <div className="flex flex-col gap-0.5">
                {records.map((r) => (
                  <div key={r.task.id} className="fw-tray-row" data-status={r.task.status}>
                    <span className="num">{r.task.createdAt}</span>
                    <span className="tray-msg">{r.events.at(-1)?.message ?? r.task.title}</span>
                    <span className="fw-count">{TASK_STATUS_LABEL[r.task.status] ?? r.task.status}</span>
                    {activeId === r.task.id && ['queued', 'running', 'building'].includes(r.task.status) && (
                      <button className="iconbtn" type="button" title="停止" onClick={() => onCancel(r.task.id)}>
                        <UiIcon icon={Square} className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
          )}
          {tab === 'changes' && (
            <div className="wb-changes">
              {/* 先如实说清「为什么没有文件变更」：不是功能坏了，是演示执行器不写文件。
                  这一栏能给的是每一轮真实提交了什么、与上一轮比改了什么。 */}
              <p className="wb-changes-note">
                <UiIcon icon={FileCode01} className="size-3 shrink-0" />
                没有文件变更记录：演示执行器不写文件、不产成片。下面记的是每一轮的输入，以及它和上一轮的差异。
              </p>
              {rounds.length === 0
                ? <div className="fw-tray-empty">还没有提交过修改意见。</div>
                : rounds.map((round, index) => {
                  const changed = round.deltas.filter((delta) => delta.changed && delta.key !== 'prompt')
                  const added = round.constraintsAdded.map((key) => CONSTRAINT_LABEL_MAP[key] ?? key)
                  const removed = round.constraintsRemoved.map((key) => CONSTRAINT_LABEL_MAP[key] ?? key)
                  return (
                    <div key={round.id} className="wb-round">
                      <div className="wb-round-hd">
                        <b>第 {rounds.length - index} 轮</b>
                        {round.preview?.revision !== undefined && (
                          <span className="wb-round-ver">
                            {round.preview.origin === 'editor' ? '编辑版本' : '工作流'} v{round.preview.revision}
                          </span>
                        )}
                        <span className="num">{new Date(round.createdAt).toLocaleString('zh-CN')}</span>
                        <span className="wb-round-on">保留 {round.constraintsOn.length} 项</span>
                      </div>
                      <p className="wb-round-prompt" title={round.prompt}>{round.prompt}</p>
                      <p className="wb-round-scale">
                        针对 {round.preview ? round.preview.label : '整个项目'}
                        {round.contextCount > 0 ? ` · 上下文引用 ${round.contextCount} 条` : ''}
                      </p>
                      <p className="wb-round-diff">
                        {round.isFirstRound
                          ? '第一轮：没有上一轮可比'
                          : changed.length === 0
                            ? '与上一轮相比：输入没有变化'
                            : `与上一轮相比：${changed.map((delta) => `${DELTA_LABEL[delta.key]} ${delta.before} → ${delta.after}`).join(' ｜ ')}`}
                        {added.length > 0 && ` ｜ 新增保留：${added.join('、')}`}
                        {removed.length > 0 && ` ｜ 取消保留：${removed.join('、')}`}
                      </p>
                    </div>
                  )
                })}
            </div>
          )}
          {tab === 'versions' && (previews.length === 0 ? <div className="fw-tray-empty">还没有预览版本。执行结束不代表生成了新画面。</div> : <div className="wb-preview-history">{previews.map((visual) => <button type="button" key={visual.id} onClick={() => onPreview(visual)}><UiIcon icon={SemIcons.film} size="sm" /><span><b>{visual.name}</b><small>{visual.tierLabel} · {visual.origin === 'editor' ? '编辑版本' : '工作流'} v{visual.revision} · {new Date(visual.createdAt).toLocaleString('zh-CN')}</small></span><UiIcon icon={SemIcons.expand} size="sm" /></button>)}</div>)}

        </div>
      </div>
    </div>
  )
}

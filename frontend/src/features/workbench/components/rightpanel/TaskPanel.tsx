import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { ChevronLeft, Square } from '@untitledui/icons'
import { type TaskRecord } from '@/features/creation/hooks/useAgentTasks'
import type { AgentTask, ModificationConstraints, TaskRequest } from '@/api/studioApi'
import { TASK_STATUS_LABEL } from '@/shared/lib/status'
import { RequestSnapshot } from '@/features/workbench/components/WorkbenchReview'
import { CONSTRAINT_LABELS } from '@/features/workbench/model/workbenchConsole'

/* ── 右栏：当前任务 ─────────────────────────────────────────── */
export function TaskPanel({ activeTask, records, cancelTask, scope, constraints, onBack, onResumeRequest }:
  { activeTask: AgentTask | null; records: TaskRecord[]; cancelTask: (id: string) => void
    scope: 'project'|'scene'|'selection'; constraints: ModificationConstraints
    onBack: () => void; onResumeRequest: (request: TaskRequest) => void }) {
  const record = activeTask ? records.find((r) => r.task.id === activeTask.id) : null
  /* 作用范围只说「当前场景」：原来拼的是 `场景 · s01`，又把数据层 id 露出来了。 */
  const recordedConstraints = record?.request?.constraints ?? constraints
  const recordedScope = record?.request?.scope ?? scope
  const scopeLabel = recordedScope === 'project' ? '整个项目' : recordedScope === 'scene' ? '当前场景' : '所选范围'
  return (
    <div className="fw-scroll">
      <div className="flex flex-col gap-3 p-3.5">
        <button className="wb-btn-ghost wb-insp-back" type="button" onClick={onBack}>
          <UiIcon icon={ChevronLeft} className="size-3" />返回
        </button>
        <div className="fw-scene-hd">当前任务</div>
        {activeTask ? (
          <div className="fw-task-card">
            <div className="flex items-center gap-2">
              {(activeTask.status === 'queued' || activeTask.status === 'running' || activeTask.status === 'building')
                ? <UiIcon icon={SemIcons.loading} className="size-3 animate-spin text-acc" />
                : <span className="fm-dot" data-s={activeTask.status === 'completed' ? 'done' : activeTask.status === 'failed' ? 'failed' : 'idle'} />}
              <b>{activeTask.title}</b>
              <span className="fw-count ml-auto">{TASK_STATUS_LABEL[activeTask.status] ?? activeTask.status}</span>
            </div>
            {record?.events.slice(-5).map((e) => (
              <div key={e.id} className="mt-1.5 text-[10.5px] text-dim">· {e.message}</div>
            ))}
            {(activeTask.status === 'queued' || activeTask.status === 'running' || activeTask.status === 'building') && (
              <button className="mini mt-2 h-6 px-2 text-[10.5px]" type="button" onClick={() => cancelTask(activeTask.id)}>
                <UiIcon icon={Square} className="size-2.5" />停止任务
              </button>
            )}
          </div>
        ) : (
          <div className="fw-tray-empty">没有正在执行的任务。</div>
        )}
        <div className="wb-sep" />
        <RequestSnapshot request={record?.request}/>
        {record?.request && activeTask && ['failed', 'cancelled'].includes(activeTask.status) && <button type="button" className="wb-btn-ghost" onClick={() => onResumeRequest(record.request!)}><UiIcon icon={SemIcons.back} size="xs" />带回对话继续编辑</button>}
        <div className="fw-scene-hd">发送时的作用范围</div>
        <div className="fw-chips"><span className="fw-chip">{scopeLabel}</span></div>
        <div className="fw-scene-hd">保留条件</div>
        {record?.modify ? (
          /* 真实修改：如实说「本次没有提交保留条件」。
             不能拿界面当前的约束顶替 —— 那是用户此刻的勾选状态，
             不是这次任务实际发送的内容，展示出来等于编一份没发生的请求。 */
          <div className="wb-insp-kv"><span>本次未提交保留约束</span><b>不保留</b></div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {CONSTRAINT_LABELS.map(([key, label]) => (
              <span key={key} className="wb-insp-kv"><span>{label}</span><b>{recordedConstraints[key] ? '保留' : '不保留'}</b></span>
            ))}
          </div>
        )}
        {record?.modify && (
          <>
            <div className="fw-scene-hd">本次实际提交</div>
            <div className="flex flex-col gap-1.5">
              <span className="wb-insp-kv"><span>基于场景版本</span><b>v{record.modify.baseVersion}</b></span>
              <span className="wb-insp-kv"><span>目标场景</span><b>{record.modify.sceneIds.length > 0 ? record.modify.sceneIds.join('、') : '整片'}</b></span>
            </div>
            <div className="wb-constraint-note">
              当前只支持修改文字或颜色，暂不支持参考定位与保留约束。
            </div>
          </>
        )}
        <div className="wb-sep" />
        <div className="text-[10.5px] leading-relaxed text-dim">
          任务 ≠ 质量验收。完成只代表这次执行结束，是否接受还要看变更与验证。
        </div>
      </div>
    </div>
  )
}

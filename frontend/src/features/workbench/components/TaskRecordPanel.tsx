import type { AgentTask, TaskRequest } from '@/api/studioApi'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { CheckSquare, MessageSquare01 } from '@untitledui/icons'
import type { TaskRecord } from '@/features/creation/hooks/useAgentTasks'
import { TASK_STATUS_LABEL } from '@/shared/lib/status'

const fmtTime = (ts?: string | number) => {
  if (!ts) return ''
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

export function TaskRecordPanel({
  activeTask,
  records,
  selectedTaskId,
  onSelectTaskId,
  onDiscuss,
}: {
  activeTask: AgentTask | null
  records: TaskRecord[]
  selectedTaskId?: string | null
  onSelectTaskId?: (id: string) => void
  cancelTask?: (id: string) => void
  onResumeRequest?: (request: TaskRequest) => void
  onDiscuss?: () => void
}) {
  const allTasks: {
    id: string
    title: string
    status: AgentTask['status']
    createdAt: string
    baseVersion?: number
    record?: TaskRecord
    isLive: boolean
  }[] = []

  if (activeTask && !records.some((r) => r.task.id === activeTask.id)) {
    allTasks.push({
      id: activeTask.id,
      title: activeTask.title || '正在执行修改任务',
      status: activeTask.status,
      createdAt: new Date().toISOString(),
      isLive: ['queued', 'running', 'building'].includes(activeTask.status),
    })
  }

  records.forEach((r) => {
    const isLive = activeTask?.id === r.task.id && ['queued', 'running', 'building'].includes(activeTask.status)
    allTasks.push({
      id: r.task.id,
      title: r.task.title || r.modify?.prompt || r.request?.prompt || '修改任务',
      status: isLive ? activeTask!.status : r.task.status,
      createdAt: r.task.createdAt || String((r.events[0] as any)?.at || (r.events[0] as any)?.timestamp || ''),
      baseVersion: r.modify?.baseVersion,
      record: r,
      isLive,
    })
  })

  const currentSelectionId = selectedTaskId ?? null

  return (
    <div className="fw-scroll flex flex-col h-full bg-transparent p-3">
      {/* 顶部标题与数量 */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--line)]">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm text-[var(--tx)]">执行记录</span>
          <span className="text-xs text-[var(--tx3)]">({allTasks.length})</span>
        </div>
        {onDiscuss && (
          <button
            type="button"
            className="text-xs text-blue-500 hover:underline flex items-center gap-1"
            onClick={onDiscuss}
            title="在对话中提交新修改"
          >
            <UiIcon icon={MessageSquare01} size="xs" />
            <span>提修改</span>
          </button>
        )}
      </div>

      {/* 任务列表 */}
      {allTasks.length === 0 ? (
        <div className="py-12 text-center text-xs text-[var(--tx3)] flex flex-col items-center justify-center">
          <UiIcon icon={CheckSquare} size="xl" className="mb-2 opacity-30 text-[var(--tx)]" />
          <p className="text-[var(--tx2)] text-[13px]">暂无执行记录</p>
          <p className="mt-1 text-xs text-[var(--tx3)]">发起修改后，每次任务的进度与日志将保存在此。</p>
          {onDiscuss && (
            <button
              type="button"
              className="mt-3 text-xs text-blue-500 hover:underline"
              onClick={onDiscuss}
            >
              去对话发起修改 →
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1 mt-2">
          {allTasks.map((t) => {
            const isSelected = t.id === currentSelectionId
            const isDone = t.status === 'completed'
            const isFail = t.status === 'failed' || t.status === 'cancelled'

            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTaskId?.(t.id)}
                className={`w-full p-2.5 rounded-lg text-left transition-colors flex flex-col gap-1 ${
                  isSelected
                    ? 'bg-blue-500/10 text-blue-500'
                    : 'hover:bg-[var(--hover)] text-[var(--tx2)] hover:text-[var(--tx)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {t.isLive && (
                      <UiIcon icon={SemIcons.loading} size="xs" className="animate-spin text-blue-500 shrink-0" />
                    )}
                    <span className={`text-[13px] font-medium truncate ${isSelected ? 'text-blue-500' : 'text-[var(--tx)]'}`}>
                      {t.title}
                    </span>
                  </div>
                  <span
                    className={`text-xs shrink-0 ${
                      t.isLive
                        ? 'text-blue-500'
                        : isDone
                        ? 'text-emerald-500'
                        : isFail
                        ? 'text-red-500'
                        : 'text-[var(--tx3)]'
                    }`}
                  >
                    {TASK_STATUS_LABEL[t.status] ?? t.status}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-[var(--tx3)]">
                  <span>{t.baseVersion !== undefined ? `基于 v${t.baseVersion}` : '修改任务'}</span>
                  <time>{fmtTime(t.createdAt)}</time>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

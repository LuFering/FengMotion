import { useState } from 'react'
import { UiIcon, SemIcons } from '@/components/icons/UiIcon'
import { Monitor01, Square } from '@untitledui/icons'
import type { AgentTask, TaskRequest } from '@/services/studioApi'
import type { TaskRecord } from '@/hooks/useAgentTasks'
import { TASK_STATUS_LABEL } from '@/shell/status'

const fmtTime = (iso?: string) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

export function TaskDetailWorkspace({
  task,
  record,
  cancelTask,
  onResumeRequest,
  onClose,
}: {
  task: AgentTask | null
  record?: TaskRecord | null
  cancelTask?: (id: string) => void
  onResumeRequest?: (request: TaskRequest) => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  if (!task) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full text-xs text-[var(--tx3)] bg-[var(--bg)]">
        <p>未选择任何执行任务</p>
        <button
          type="button"
          className="mt-3 px-3 py-1.5 rounded-lg bg-[var(--hole)] text-[var(--tx)] hover:bg-[var(--line)]"
          onClick={onClose}
        >
          返回画面监看
        </button>
      </div>
    )
  }

  const isLive = ['queued', 'running', 'building'].includes(task.status)
  const isDone = task.status === 'completed'
  const isFail = task.status === 'failed' || task.status === 'cancelled'
  const errorMessage = (task as any)?.error?.message || (task as any)?.error || ''

  const handleCopyLogs = () => {
    if (!record?.events?.length) return
    const text = record.events.map((e: any) => `[${fmtTime((e as any).at || (e as any).timestamp)}] ${e.message}`).join('\n')
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg)] text-[var(--tx)]">
      {/* 顶部轻量栏 */}
      <div className="h-10 border-b border-[var(--line)] px-6 flex items-center justify-between shrink-0 bg-[var(--surf)]">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-[var(--tx)]">任务详情</span>
          <span className="text-xs text-[var(--tx3)] font-mono">#{task.id.slice(0, 8)}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded font-medium ${
              isLive
                ? 'bg-blue-500/15 text-blue-500 flex items-center gap-1'
                : isDone
                ? 'bg-emerald-500/15 text-emerald-500'
                : isFail
                ? 'bg-red-500/15 text-red-500'
                : 'bg-[var(--line)] text-[var(--tx3)]'
            }`}
          >
            {isLive && <UiIcon icon={SemIcons.loading} size="xs" className="animate-spin" />}
            {TASK_STATUS_LABEL[task.status] ?? task.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isLive && cancelTask && (
            <button
              type="button"
              className="text-xs px-2.5 py-1 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors flex items-center gap-1"
              onClick={() => cancelTask(task.id)}
            >
              <UiIcon icon={Square} size="xs" />
              <span>停止任务</span>
            </button>
          )}
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 font-medium transition-colors flex items-center gap-1"
            onClick={onClose}
            title="返回画面监看"
          >
            <UiIcon icon={Monitor01} size="xs" />
            <span>返回画面监看</span>
          </button>
        </div>
      </div>

      {/* 主体内容：收窄至 680px */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[680px] w-full mx-auto flex flex-col gap-5">
          {/* 失败告警 */}
          {isFail && (
            <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-600 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 font-medium text-sm">
                <UiIcon icon={SemIcons.warning} size="sm" />
                <span>任务执行未完成</span>
              </div>
              <p className="text-xs leading-relaxed font-mono whitespace-pre-wrap">
                {errorMessage || '执行发生异常或被主动取消。可带回对话重新发起。'}
              </p>
              {record?.request && onResumeRequest && (
                <div className="pt-1">
                  <button
                    type="button"
                    className="px-3 py-1 rounded bg-blue-600 text-white font-medium hover:bg-blue-500 transition-colors flex items-center gap-1 text-xs"
                    onClick={() => {
                      if (record?.request) onResumeRequest(record.request)
                      onClose()
                    }}
                  >
                    <UiIcon icon={SemIcons.refresh} size="xs" />
                    <span>带回对话重新发起</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 任务要求 */}
          <section className="flex flex-col gap-1.5">
            <h3 className="font-medium text-sm text-[var(--tx)]">修改要求</h3>
            <div className="p-3 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-[13px] text-[var(--tx)] leading-relaxed whitespace-pre-wrap">
              {task.title || record?.modify?.prompt || record?.request?.prompt || '常规修改任务'}
            </div>
          </section>

          {/* 目标与范围 */}
          <section className="flex flex-col gap-1.5">
            <h3 className="font-medium text-sm text-[var(--tx)]">修改范围</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] flex flex-col gap-0.5">
                <span className="text-[var(--tx3)]">修改范围</span>
                <span className="font-medium text-[var(--tx)]">{record?.request?.scope === 'project' ? '整部影片' : '选定场景 / 镜头'}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] flex flex-col gap-0.5">
                <span className="text-[var(--tx3)]">基准版本</span>
                <span className="font-medium text-[var(--tx)]">{record?.modify?.baseVersion ? `v${record.modify.baseVersion}` : '初始版本'}</span>
              </div>
            </div>
          </section>

          {/* 执行日志流 */}
          <section className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm text-[var(--tx)] flex items-center gap-1.5">
                <UiIcon icon={SemIcons.terminal} size="sm" className="text-[var(--tx3)]" />
                <span>执行日志流</span>
              </h3>
              {record?.events && record.events.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                  onClick={handleCopyLogs}
                >
                  {copied ? <UiIcon icon={SemIcons.check} size="xs" /> : <UiIcon icon={SemIcons.copy} size="xs" />}
                  <span>{copied ? '已复制' : '复制日志'}</span>
                </button>
              )}
            </div>

            {record?.events && record.events.length > 0 ? (
              <div className="p-3 rounded-lg bg-[#0e0e11] text-xs font-mono text-[var(--tx2)] max-h-72 overflow-y-auto flex flex-col gap-1.5 border border-[var(--line)]">
                {record.events.map((e: any) => (
                  <div key={e.id} className="leading-relaxed flex items-start gap-2">
                    <span className="text-[#6b7280] select-none shrink-0 text-[11px]">
                      [{fmtTime((e as any).at || (e as any).timestamp)}]
                    </span>
                    <span className="text-[#e5e7eb] break-all">{e.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-[var(--tx3)] bg-[var(--hole)] rounded-lg border border-[var(--line)]">
                尚未产生事件日志
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

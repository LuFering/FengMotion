/**
 * 窄栏（工作台右栏）里的执行步骤抽屉。
 *
 * <p>与对话页同一套方案：执行中展开，步骤用对话页那套逐行长出的步骤树（连接线 + 文件标签），
 * 新的一步只在底部长出；头部运行中写「正在执行 bash · 命令说明」并扫光，
 * 结束后写「执行了 N 步」加按工具分类的小计。一轮结束后整轮过程由上层收成一行。</p>
 *
 * <p><strong>只显示消息里真实携带的数据</strong>：没有工具记录就整个不渲染；
 * 不按消息长度猜步骤数，也不根据「有没有新版本」倒推做过什么。</p>
 */
import { useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { TaskList } from '@/features/chat/components/TaskList'
import { ToolIcon } from '@/features/chat/components/ToolIcons'
import { shortArgs, toolCallsRevealed, toolCallsToTasks } from '@/features/chat/components/toolDisplay'
import { summarizeTools, type ProcessToolCall } from '@/features/chat/model/processSummaryModel'
import '@/features/chat/styles/components/process-drawer.css'

export function ProcessDrawer({ tools, running = false }: { tools?: ProcessToolCall[]; running?: boolean }) {
  /* null = 跟随状态：执行中展开、结束后收起；用户点过就以用户为准 */
  const [manual, setManual] = useState<boolean | null>(null)
  if (!tools || tools.length === 0) return null
  const open = manual ?? running
  const failed = tools.filter((t) => t.isError).length
  const current = running ? [...tools].reverse().find((t) => t.done !== true) : undefined
  const latest = current ?? tools[tools.length - 1]
  const detail = current?.arguments ? shortArgs(current.arguments) : ''
  const title = running
    ? `正在执行 ${latest.name}${detail ? ` · ${detail}` : ''}`
    : `执行了 ${tools.length} 步`

  return (
    <div className="pd" data-running={running || undefined} data-open={open || undefined}>
      <button type="button" className="pd-head" aria-expanded={open} onClick={() => setManual(!open)}>
        <span className="pd-icon" aria-hidden="true"><ToolIcon name={latest.name} className="pd-icon-svg" /></span>
        <span className="pd-title">
          {running ? <span className="tl-shimmer" aria-label={title}>{title}</span> : title}
        </span>
        {!running && <span className="pd-tally">{summarizeTools(tools)}</span>}
        {failed > 0 && (
          <span className="pd-failed"><UiIcon icon={SemIcons.error} size="xs" />{failed} 步失败</span>
        )}
        <UiIcon icon={SemIcons.collapse} size="xs" className={`pd-caret${open ? ' is-open' : ''}`} />
      </button>
      {open && (
        <div className="pd-body">
          <TaskList tasks={toolCallsToTasks(tools, running)} revealed={toolCallsRevealed(tools)} run={false} working={false} />
        </div>
      )}
    </div>
  )
}

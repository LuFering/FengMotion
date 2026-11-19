import { CheckSquare, ClipboardCheck, Clock, File01, MessageSquare01 } from '@untitledui/icons'
import type { UntIcon } from '@/shared/icons/UiIcon'
import { sessionDisplayTitle, sessionOptionLabel, sessionOptionText, sessionTimeFull } from '@/features/chat/model/sessionDisplay'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import type { Session } from '@/features/chat/hooks/useSessions'
import { type SideTab } from '@/features/workbench/model/workbenchConsole'

/* 控制台常驻五入口：图标 + 悬浮文字，全部直接平铺展示，无多余折叠箭头 */
export const CONSOLE_TABS: { id: 'chat' | 'brief' | 'task' | 'versions' | 'review'; label: string; icon: UntIcon }[] = [
  { id: 'chat', label: '对话', icon: MessageSquare01 },
  { id: 'brief', label: '创作要求', icon: File01 },
  { id: 'task', label: '执行记录', icon: CheckSquare },
  { id: 'versions', label: '版本', icon: Clock },
  { id: 'review', label: '修改审阅', icon: ClipboardCheck },
]

/* ── 控制台顶栏：标题 + 五大常驻图标导航 ──────────────────────────
   全部 5 个入口平铺展示，取消折叠箭头。切换面板时导航常驻，
   保证用户在任何子视图下都能一键切回对话与主要工作区。 */
export function ConsoleChrome({
  sideTab,
  onChange,
  sessions,
  currentSessionId,
  onSelectSession,
  projectName,
}: {
  sideTab: SideTab
  onChange: (v: SideTab) => void
  sessions?: Session[]
  currentSessionId?: string | null
  onSelectSession?: (id: string) => void
  /** 当前项目名：侧栏要标出这些会话属于哪个项目 */
  projectName?: string | null
}) {
  const normalizedTab: 'chat' | 'brief' | 'task' | 'versions' | 'review' =
    sideTab === 'brief' || sideTab === 'settings' ? 'brief'
    : sideTab === 'task' ? 'task'
    : sideTab === 'versions' ? 'versions'
    : sideTab === 'review' ? 'review'
    : 'chat'

  const activeSession = sessions?.find((s) => s.id === currentSessionId) ?? sessions?.[0]

  return (
    <>
      <div className="wb-assistant-heading flex items-center justify-between">
        <strong>控制台</strong>
        {sideTab === 'chat' && sessions && sessions.length > 0 && (
          <div className="wb-console-session" title={projectName ? `所属项目：${projectName}` : undefined}>
            {/* 项目归属在**框外**说一次即可 —— 这些会话本来就都属于当前项目。
                放进每个选项里会挤掉会话名和时间（下拉只有一百多像素）。 */}
            <span className="wb-console-session-label">当前对话</span>
            {sessions.length > 1 ? (
              /* 关闭状态的选框也要能拿到当前会话的完整时间：
                 原生 <option title> 在不同系统上的表现不一致，不能只靠它。
                 这里把完整时间放在 select 自身的 title 上，键盘聚焦同样可读。 */
              <select
                value={activeSession?.id ?? ''}
                onChange={(e) => onSelectSession?.(e.target.value)}
                aria-label="选择对话"
                title={activeSession
                  ? `${sessionDisplayTitle(activeSession)} · ${sessionTimeFull(activeSession.updatedAt)}`
                  : undefined}
                className="wb-console-session-select"
              >
                {/* 标题与时间来自 sessionDisplay —— 与对话区同一套规则。
                    选项里不再重复项目名，宽度全部留给会话名与时间；
                    悬停 title 仍给带项目的完整标识。 */}
                {sessions.map((s) => (
                  <option key={s.id} value={s.id} title={sessionOptionLabel(s, projectName)}>
                    {sessionOptionText(s)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="wb-console-session-single"
                    title={activeSession
                      ? `${sessionDisplayTitle(activeSession)} · ${sessionTimeFull(activeSession.updatedAt)}`
                      : undefined}>
                {activeSession ? sessionOptionText(activeSession) : '当前对话'}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="fw-ing-hd fw-panel-hd wb-console-tabs">
        <div className="wb-console-tablist" role="tablist" aria-label="控制台视图">
          {CONSOLE_TABS.map((t) => {
            const active = normalizedTab === t.id
            return (
              <Tooltip key={t.id}>
                <TooltipTrigger asChild>
                  <button type="button" role="tab" aria-selected={active} aria-label={t.label}
                          className="wb-console-tab" data-active={active || undefined}
                          onClick={() => onChange(t.id)}>
                    <t.icon size={15} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>{t.label}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        <span className="wb-console-current" aria-hidden="true">
          {CONSOLE_TABS.find((tab) => tab.id === normalizedTab)?.label}
        </span>
      </div>
    </>
  )
}

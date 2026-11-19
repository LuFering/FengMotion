import type * as React from 'react'
import { fmtWhen, fmtAgo } from '@/features/chat/model/conversationFormat'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Pin01, Pencil01, Archive } from '@untitledui/icons'
import { sessionDisplayTitle, sessionTimeFull } from '@/features/chat/model/sessionDisplay'
import type { Session } from '@/features/chat/hooks/useSessions'
import type { ProjectSummary } from '@/features/project/model/projects'
import type { ConversationProps } from '@/features/chat/Conversation'

export interface SessionGroupBodyProps {
  dragId: string | null
  editText: string
  editing: string | null
  flat: boolean
  g: { key: string; projectId: string; sessions: Session[]; latest: number } | { key: string; projectId: string; sessions: Session[] }
  isUng: boolean
  proj: ProjectSummary | null
  props: ConversationProps
  rowMenu: string | null
  setDragId: React.Dispatch<React.SetStateAction<string | null>>
  setDropTarget: React.Dispatch<React.SetStateAction<string | null>>
  setEditText: React.Dispatch<React.SetStateAction<string>>
  setEditing: React.Dispatch<React.SetStateAction<string | null>>
  setRowMenu: React.Dispatch<React.SetStateAction<string | null>>
  setViewMenu: React.Dispatch<React.SetStateAction<boolean>>
}

/** 从 SessionGroup.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function SessionGroupBody({ dragId, editText, editing, flat, g, isUng, proj, props, rowMenu, setDragId, setDropTarget, setEditText, setEditing, setRowMenu, setViewMenu }: SessionGroupBodyProps) {
  return (
    <div className="cv3-group-body">
      {g.sessions.length === 0 ? (
        <p className="cv3-side-hint">{flat ? '暂无会话' : isUng ? '没有未分组的对话。' : '还没有对话。'}</p>
      ) : g.sessions.map((t) => (
        <div key={t.id} className="cv3-session"
             draggable
             data-current={t.id === props.activeSessionId || undefined}
             data-dragging={dragId === t.id || undefined}
             data-archived={t.archived || undefined}
             onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move' }}
             onDragEnd={() => { setDragId(null); setDropTarget(null) }}
             onClick={() => {
               if (editing === t.id) return
               props.onOverviewChange?.(false)
               props.threads.setActiveId(t.id)
               if (!isUng && !flat && proj) props.onSelectProject(proj.id)
             }}
             title={`${t.title} · 创建于 ${fmtWhen(t.createdAt)}`}>
          {editing === t.id ? (
            <input className="cv3-session-edit" autoFocus value={editText}
                   onChange={(e) => setEditText(e.target.value)}
                   onBlur={() => { props.threads.rename(t.id, editText); setEditing(null) }}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter') { props.threads.rename(t.id, editText); setEditing(null) }
                     if (e.key === 'Escape') setEditing(null)
                   }}
                   onClick={(e) => e.stopPropagation()} />
          ) : (
            <>
              {t.pinned && <UiIcon icon={Pin01} size="xs" className="cv3-session-pin" aria-label="已置顶" />}
              {/* 标题走共享规则：空白标题的兜底必须与侧栏一致，
                  否则同一个会话在两处可能显示成不同的名字。 */}
              <span className="cv3-session-name">{sessionDisplayTitle(t)}</span>
              {t.archived
                ? <span className="cv3-session-flag">已归档</span>
                : t.origin === 'local'
                  ? <span className="cv3-session-flag" title={t.localNote ?? '未保存到服务端'}>仅本页</span>
                  : (
                    /* 悬停给完整时间：列表里为紧凑用了相对时间，
                       但用户要能核对准确时刻。 */
                    <span className="cv3-session-time num" title={sessionTimeFull(t.updatedAt)}>
                      {fmtAgo(t.updatedAt)}
                    </span>
                  )}
            </>
          )}
          <div className="cv3-rowmenu-wrap">
            <button type="button" className="cv3-row-more" aria-label={`${t.title} 的操作`}
                    aria-expanded={rowMenu === t.id}
                    onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === t.id ? null : t.id); setViewMenu(false) }}>
              <UiIcon icon={SemIcons.more} size="xs" />
            </button>
            {rowMenu === t.id && (
              /* 菜单整体拦掉点击冒泡：菜单项在会话行内部，而整行点击=切换会话。
                 不拦的话，点「删除对话」会先把会话切成这一条，删完再清空当前对话 ——
                 用户只是想删掉一条不相关的会话。 */
              <div className="cv3-menu cv3-rowmenu" role="menu"
                   onClick={(e) => e.stopPropagation()}
                   onKeyDown={(e) => e.stopPropagation()}>
                {/* 服务端会话暂无重命名端点：不提供会「只改本页却像已保存」的操作 */}
                {t.origin === 'local' ? (
                  <button type="button" role="menuitem"
                          onClick={() => { setEditing(t.id); setEditText(t.title); setRowMenu(null) }}>
                    <UiIcon icon={Pencil01} size="sm" /><span>重命名</span>
                  </button>
                ) : (
                  <button type="button" role="menuitem" disabled
                          title="服务端尚未提供会话重命名">
                    <UiIcon icon={Pencil01} size="sm" /><span>重命名（暂不可用）</span>
                  </button>
                )}
                {t.origin === 'local' && t.projectId && (
                  <button type="button" role="menuitem"
                          onClick={() => {
                            setRowMenu(null)
                            // 失败原因由 threads.createError 统一显示，这里不重复
                            void props.threads.retryCreate(t.id)
                          }}>
                    <UiIcon icon={SemIcons.check} size="xs" /><span>重试保存到服务端</span>
                  </button>
                )}
                <button type="button" role="menuitem"
                        onClick={() => { props.threads.setPinned(t.id, !t.pinned); setRowMenu(null) }}>
                  {t.pinned ? <UiIcon icon={Pin01} size="sm" /> : <UiIcon icon={Pin01} size="sm" />}
                  <span>{t.pinned ? '取消置顶' : '置顶会话'}</span>
                </button>
                <button type="button" role="menuitem"
                        onClick={() => { props.threads.setArchived(t.id, !t.archived); setRowMenu(null) }}>
                  {t.archived ? <UiIcon icon={Archive} size="sm" /> : <UiIcon icon={Archive} size="sm" />}
                  <span>{t.archived ? '取消归档' : '归档会话'}</span>
                </button>
                <button type="button" role="menuitem" data-danger
                        onClick={() => {
                          setRowMenu(null)
                          // 服务端会话是真的删（软删除，服务端保留审计），先确认再删：
                          // 删错了没法在本页撤销，恢复要另走接口。
                          if (t.origin === 'server'
                              && !window.confirm(`删除对话「${t.title}」？服务端将不再返回这条对话。`)) return
                          void props.threads.remove(t.id)
                        }}>
                  <UiIcon icon={SemIcons.trash} size="xs" />
                  <span>{t.origin === 'local' ? '丢弃这条草稿' : '删除对话'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Menu01, Pencil01, Archive, MessageSquare01 } from '@untitledui/icons'
import type { Session } from '@/features/chat/hooks/useSessions'
import type { ProjectSummary } from '@/features/project/model/projects'
import type { ConversationProps } from '@/features/chat/Conversation'

export interface SessionGroupRowProps {
  collapsed: boolean
  dropTarget: string | null
  editText: string
  editing: string | null
  g: { key: string; projectId: string; sessions: Session[]; latest: number } | { key: string; projectId: string; sessions: Session[] }
  isUng: boolean
  newSession: (intoProject?: string | null) => void
  proj: ProjectSummary | null
  props: ConversationProps
  rowMenu: string | null
  setArchivingProject: React.Dispatch<React.SetStateAction<ProjectSummary | null>>
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>
  setDeleteConfirmText: React.Dispatch<React.SetStateAction<string>>
  setDeletingProject: React.Dispatch<React.SetStateAction<ProjectSummary | null>>
  setEditText: React.Dispatch<React.SetStateAction<string>>
  setEditing: React.Dispatch<React.SetStateAction<string | null>>
  setRowMenu: React.Dispatch<React.SetStateAction<string | null>>
  setViewMenu: React.Dispatch<React.SetStateAction<boolean>>
  showProjectError: (error: unknown) => void
}

/** 左栏分组的项目头一行：展开/切换项目、就地改名、项目操作菜单，以及在该项目下新建对话的入口。 */
export function SessionGroupRow({ collapsed, dropTarget, editText, editing, g, isUng, newSession, proj, props, rowMenu, setArchivingProject, setCollapsedGroups, setDeleteConfirmText, setDeletingProject, setEditText, setEditing, setRowMenu, setViewMenu, showProjectError }: SessionGroupRowProps) {
  return (
    <div className="cv3-group-row">
      {/* 新建后立刻在这里就地改名（dsh 的 renameInput：建完就打字，
          不用先填弹窗里的表单再确认一遍） */}
      {!isUng && proj && editing === proj.id ? (
        <div className="cv3-group-head cv3-group-editrow">
          <UiIcon icon={SemIcons.expand} size="xs" className="cv3-group-caret" data-open={!collapsed || undefined} />
          <input className="cv3-group-edit" autoFocus value={editText}
                 aria-label="项目名称"
                 onChange={(e) => setEditText(e.target.value)}
                 onBlur={() => {
                   void props.onRenameProject?.(proj.id, editText).catch(showProjectError)
                   setEditing(null)
                 }}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') {
                     e.currentTarget.blur()
                   }
                   if (e.key === 'Escape') setEditing(null)
                 }} />
        </div>
      ) : (
      <button type="button" className="cv3-group-head"
              data-drop={dropTarget === g.projectId || undefined}
              /* 点项目头 = 展开 + 选中该项目。原先只做折叠，导致
                 「新建对话」拿不到 projectId、只能落到未分组 —— 用户
                 明明是在项目里点的新建，对话却不在项目下（真机三次踩到）。
                 收起时不改选中态：收起只是视觉折叠，不该顺手切走当前项目。 */
              data-current={!isUng && proj && props.openProject === proj.id || undefined}
              onClick={() => {
                /* 点项目头 = 选中并展开该项目。
                   为什么选中时强制展开：用户切到某个项目，就是要看它的会话；
                   若这个项目上次被手动折叠过，切过去只看到一行项目名，
                   会以为会话没了。折叠只在「已经在这个项目里」时生效。 */
                const switchingIn = !isUng && proj && props.openProject !== proj.id
                if (!isUng && proj) props.onSelectProject(proj.id)
                setCollapsedGroups((prev) => {
                  const next = new Set(prev)
                  if (switchingIn) {
                    /* 切进来：一律展开，并记下显式展开，覆盖之前的折叠。 */
                    next.delete(g.key)
                    next.add(`__open:${g.key}`)
                  } else if (collapsed) {
                    next.delete(g.key)
                    next.add(`__open:${g.key}`)
                  } else {
                    next.delete(`__open:${g.key}`)
                    next.add(g.key)
                  }
                  return next
                })
              }}
              title={isUng ? '没有归属项目的对话，可拖到项目下' : `${proj?.name ?? ''}（点击展开并切换到此项目）`}>
        <UiIcon icon={SemIcons.expand} size="xs" className="cv3-group-caret" data-open={!collapsed || undefined} />
        <span className="cv3-group-name">{isUng ? '未分组' : proj?.name ?? '未命名项目'}</span>
        {/* 0 不显示：空项目挂一个「0」只是噪音，还会和下面的
            「还没有对话。」重复表达同一件事。dsh 的行也没有计数。 */}
        {g.sessions.length > 0 && (
          <span className="cv3-group-count num">{g.sessions.length}</span>
        )}
      </button>
      )}
      {!isUng && proj && (
        <>
          <div className="cv3-rowmenu-wrap">
            <button type="button" className="cv3-row-more" aria-label={`${proj.name} 的操作`}
                    aria-expanded={rowMenu === proj.id}
                    onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === proj.id ? null : proj.id); setViewMenu(false) }}>
              <UiIcon icon={SemIcons.more} size="sm" />
            </button>
            {rowMenu === proj.id && (
              <div className="cv3-menu cv3-rowmenu" role="menu">
                <button type="button" role="menuitem"
                        onClick={() => { props.onSelectProject(proj.id); setRowMenu(null) }}>
                  <UiIcon icon={Menu01} size="sm" /><span>打开项目</span>
                </button>
                <button type="button" role="menuitem"
                        onClick={() => { setEditing(proj.id); setEditText(proj.name); setRowMenu(null) }}>
                  <UiIcon icon={Pencil01} size="sm" /><span>重命名项目</span>
                </button>
                <button type="button" role="menuitem"
                        onClick={() => { setRowMenu(null); setArchivingProject(proj) }}>
                  <UiIcon icon={Archive} size="sm" /><span>归档项目</span>
                </button>
                <button type="button" role="menuitem" data-danger
                        onClick={() => {
                          setRowMenu(null)
                          /* 打开时就清空确认框：上一次删除留下的文字
                             不能出现在这一次里 —— 那等于替用户预填了
                             一个可能恰好匹配的项目名。 */
                          setDeleteConfirmText('')
                          setDeletingProject(proj)
                        }}>
                  <UiIcon icon={SemIcons.trash} size="xs" /><span>删除项目</span>
                </button>
              </div>
            )}
          </div>
          {/* 在此项目里新建对话（对齐 dsh ProjectRowItem 的 rowActions：
              小图标、悬停才现身，放在操作钮最右，点一下就把新会话挂到这个项目下） */}
          <button type="button" className="cv3-row-new" aria-label={`在 ${proj.name} 中新建对话`}
                  title={`在 ${proj.name} 中新建对话`}
                  onClick={(e) => { e.stopPropagation(); newSession(proj.id) }}>
            <UiIcon icon={MessageSquare01} size="sm" />
          </button>
        </>
      )}
    </div>
  )
}

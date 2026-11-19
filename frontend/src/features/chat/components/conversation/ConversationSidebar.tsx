import type * as React from 'react'
import { Search as SeekSearch } from '@/features/chat/components/Search'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { LayoutGrid01, MessageSquare01 } from '@untitledui/icons'
import { UNGROUPED, type Session } from '@/features/chat/hooks/useSessions'
import { SessionGroup } from '@/features/chat/components/conversation/SessionGroup'
import type { ConversationProps } from '@/features/chat/Conversation'
import type { ProjectSummary } from '@/features/project/model/projects'

export interface ConversationSidebarProps {
  archiveFilter: 'hide' | 'show' | 'only'
  collapsedGroups: Set<string>
  createProjectInline: () => Promise<void>
  dragId: string | null
  drawer: boolean
  dropTarget: string | null
  editText: string
  editing: string | null
  groupMode: 'project' | 'flat'
  grouped: { key: string; projectId: string; sessions: Session[]; latest: number }[] | { key: string; projectId: string; sessions: Session[] }[]
  newSession: (intoProject?: string | null) => void
  noMatches: boolean
  orderMode: 'updated' | 'manual'
  projectError: string | null
  projectPending: boolean
  props: ConversationProps
  query: string
  rowMenu: string | null
  setArchiveFilter: React.Dispatch<React.SetStateAction<'hide' | 'show' | 'only'>>
  setArchivingProject: React.Dispatch<React.SetStateAction<ProjectSummary | null>>
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>
  setDeleteConfirmText: React.Dispatch<React.SetStateAction<string>>
  setDeletingProject: React.Dispatch<React.SetStateAction<ProjectSummary | null>>
  setDragId: React.Dispatch<React.SetStateAction<string | null>>
  setDropTarget: React.Dispatch<React.SetStateAction<string | null>>
  setEditText: React.Dispatch<React.SetStateAction<string>>
  setEditing: React.Dispatch<React.SetStateAction<string | null>>
  setGroupMode: React.Dispatch<React.SetStateAction<'project' | 'flat'>>
  setOrderMode: React.Dispatch<React.SetStateAction<'updated' | 'manual'>>
  setQuery: React.Dispatch<React.SetStateAction<string>>
  setRowMenu: React.Dispatch<React.SetStateAction<string | null>>
  setViewMenu: React.Dispatch<React.SetStateAction<boolean>>
  showProjectError: (error: unknown) => void
  viewMenu: boolean
}

/** 从 Conversation.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function ConversationSidebar({ archiveFilter, collapsedGroups, createProjectInline, dragId, drawer, dropTarget, editText, editing, groupMode, grouped, newSession, noMatches, orderMode, projectError, projectPending, props, query, rowMenu, setArchiveFilter, setArchivingProject, setCollapsedGroups, setDeleteConfirmText, setDeletingProject, setDragId, setDropTarget, setEditText, setEditing, setGroupMode, setOrderMode, setQuery, setRowMenu, setViewMenu, showProjectError, viewMenu }: ConversationSidebarProps) {
  return (
    <aside className="cv3-side" data-drawer={drawer || undefined} aria-label="项目与对话">
      {/* 左栏标题与项目/对话操作同层，视图选项靠近下面的列表。 */}
      <div className="cv3-side-top">
        <span className="cv3-side-title">项目与对话</span>
        {/* 搜索并进这一排：收起时和旁边的图标按钮同款，点开时占满整条，
            同排其他按钮随即隐去，收起后再回来（见 conversation.css）。 */}
        <SeekSearch value={query} onChange={setQuery} width={248} size={28}
                    placeholder="搜索对话名称" ariaLabel="搜索对话" />
        <div className="cv3-top-actions">
        {props.onOverviewChange && <button type="button" className="cv3-icon-btn" aria-label="查看全部项目" title="查看全部项目" aria-pressed={props.overviewOpen ?? false} data-on={props.overviewOpen || undefined} onClick={() => props.onOverviewChange?.(true)}><UiIcon icon={LayoutGrid01} size="sm" /></button>}
        <button type="button" className="cv3-icon-btn" aria-label="新建对话" title="新建对话"
                onClick={() => newSession()}>
          <UiIcon icon={MessageSquare01} size="sm" />
        </button>
        <button type="button" className="cv3-icon-btn" aria-label="新建项目" title="新建项目"
                disabled={projectPending} onClick={() => void createProjectInline()}>
          <UiIcon icon={SemIcons.folder} size="sm" />
        </button>
        {/* 视图选项（对齐 dsh viewOptions：分组方式 / 排序方式 / 归档筛选） */}
        <div className="cv3-viewwrap">
          <button type="button" className="cv3-icon-btn" aria-label="视图选项" title="视图选项"
                  aria-expanded={viewMenu} data-on={viewMenu || undefined}
                  onClick={() => { setViewMenu((o) => !o); setRowMenu(null) }}>
            <UiIcon icon={SemIcons.sliders} size="sm" />
          </button>
          {viewMenu && (
            <div className="cv3-menu cv3-viewmenu" role="menu">
              <div className="cv3-menu-sec">分组方式</div>
              <button type="button" role="menuitemradio" aria-checked={groupMode === 'project'}
                      onClick={() => { setGroupMode('project'); setViewMenu(false) }}>
                <span>按项目</span>{groupMode === 'project' && <UiIcon icon={SemIcons.check} size="sm" />}
              </button>
              <button type="button" role="menuitemradio" aria-checked={groupMode === 'flat'}
                      onClick={() => { setGroupMode('flat'); setViewMenu(false) }}>
                <span>单列表</span>{groupMode === 'flat' && <UiIcon icon={SemIcons.check} size="sm" />}
              </button>
              <div className="cv3-menu-sec">排序方式</div>
              <button type="button" role="menuitemradio" aria-checked={orderMode === 'updated'}
                      onClick={() => { setOrderMode('updated'); setViewMenu(false) }}>
                <span>最近更新</span>{orderMode === 'updated' && <UiIcon icon={SemIcons.check} size="sm" />}
              </button>
              <button type="button" role="menuitemradio" aria-checked={orderMode === 'manual'}
                      onClick={() => { setOrderMode('manual'); setViewMenu(false) }}>
                <span>手动排序</span>{orderMode === 'manual' && <UiIcon icon={SemIcons.check} size="sm" />}
              </button>
              <div className="cv3-menu-sec">筛选会话</div>
              {([['hide', '隐藏已归档'], ['show', '全部对话（显示已归档）'], ['only', '仅显示已归档']] as const).map(([v, label]) => (
                <button key={v} type="button" role="menuitemradio" aria-checked={archiveFilter === v}
                        onClick={() => { setArchiveFilter(v); setViewMenu(false) }}>
                  <span>{label}</span>{archiveFilter === v && <UiIcon icon={SemIcons.check} size="sm" />}
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* 读取/创建的项目与对话状态：放在标题下方，标题始终锚在左栏顶部，
          不因一条错误被推下去。 */}
      {props.projectsLoading && <p role="status" className="cv3-side-hint">正在加载项目…</p>}
      {props.projectsError && (
        <p role="alert" className="cv3-side-error">
          项目加载失败：{props.projectsError}
          <button type="button" onClick={props.onRefreshProjects}>重试</button>
        </p>
      )}
      {projectError && <p role="alert" className="cv3-side-error">{projectError}</p>}
      {props.threads.createError && (
        <p role="alert" className="cv3-side-error">
          新建对话失败：{props.threads.createError}
          <button type="button" onClick={props.threads.clearCreateError}>知道了</button>
        </p>
      )}
      {/* 删除失败：服务端没有确认删除，那条对话仍在列表里 —— 明说，别让「点了没反应」被当成删掉了 */}
      {props.threads.removeError && (
        <p role="alert" className="cv3-side-error">
          删除对话失败：{props.threads.removeError}
          <button type="button" onClick={props.threads.clearRemoveError}>知道了</button>
        </p>
      )}
      {/* 会话列表读取：加载中 / 失败(可重试) / 未读到都如实显示，
          不让「没读到」看起来像「没有对话」。 */}
      {props.threads.loading && <p role="status" className="cv3-side-hint">正在加载对话…</p>}
      {props.sessionsError && (
        <p role="alert" className="cv3-side-error">
          对话加载失败：{props.sessionsError}
          <button type="button" onClick={props.onRetrySessions}>重试</button>
        </p>
      )}

      <div className="cv3-side-list">
        {/* 只有「真的一条会话都没有、也没有任何项目」时才整块换成提示。
            原来用 noMatches（= 没有会话）挡掉整个列表，导致左栏直建出来的
            空项目根本不显示 —— 新建项目点了没反应。dsh 的项目行是常驻的，
            哪怕它下面一条会话都没有。 */}
        {query.trim() && noMatches ? (
          <p className="cv3-side-hint">无匹配结果</p>
        ) : grouped.length === 0 ? (
          <p className="cv3-side-hint">暂无会话</p>
        ) : grouped.map((g) => {
          const isUng = g.projectId === UNGROUPED
          const flat = g.key === 'flat'
          const proj = isUng || flat ? null : props.projects.find((p) => p.id === g.projectId) ?? null
          /* 当前项目默认展开，其他项目默认收起：
             左栏挂着所有项目的会话，全展开时用户要滚过几十个别人的项目才能看到自己的。
             用户手动展开过的项目按用户的选择来（collapsedGroups 里记的是显式切换）。 */
          const isCurrentGroup = !isUng && !flat && g.projectId === props.openProject
          const collapsed = collapsedGroups.has(g.key)
            ? true
            : (collapsedGroups.has(`__open:${g.key}`) ? false : !isCurrentGroup && g.sessions.length > 0)
          return (
            <SessionGroup key={g.key}
              collapsed={collapsed}
              dragId={dragId}
              dropTarget={dropTarget}
              editText={editText}
              editing={editing}
              flat={flat}
              g={g}
              isUng={isUng}
              newSession={newSession}
              proj={proj}
              props={props}
              rowMenu={rowMenu}
              setArchivingProject={setArchivingProject}
              setCollapsedGroups={setCollapsedGroups}
              setDeleteConfirmText={setDeleteConfirmText}
              setDeletingProject={setDeletingProject}
              setDragId={setDragId}
              setDropTarget={setDropTarget}
              setEditText={setEditText}
              setEditing={setEditing}
              setRowMenu={setRowMenu}
              setViewMenu={setViewMenu}
              showProjectError={showProjectError}
            />
          )
        })}
      </div>
      {/* 底部的整行「新建项目」已移除（dsh 左栏没有整行大按钮）：
          新建入口收到顶部图标条，项目行上另有「在此项目新建对话」。 */}
    </aside>
  )
}

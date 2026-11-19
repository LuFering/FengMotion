import type * as React from 'react'
import type { Session } from '@/features/chat/hooks/useSessions'
import type { ProjectSummary } from '@/features/project/model/projects'
import type { ConversationProps } from '@/features/chat/Conversation'
import { SessionGroupBody } from '@/features/chat/components/conversation/SessionGroupBody'
import { SessionGroupRow } from '@/features/chat/components/conversation/SessionGroupRow'

export interface SessionGroupProps {
  collapsed: boolean
  dragId: string | null
  dropTarget: string | null
  editText: string
  editing: string | null
  flat: boolean
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
  setDragId: React.Dispatch<React.SetStateAction<string | null>>
  setDropTarget: React.Dispatch<React.SetStateAction<string | null>>
  setEditText: React.Dispatch<React.SetStateAction<string>>
  setEditing: React.Dispatch<React.SetStateAction<string | null>>
  setRowMenu: React.Dispatch<React.SetStateAction<string | null>>
  setViewMenu: React.Dispatch<React.SetStateAction<boolean>>
  showProjectError: (error: unknown) => void
}

/** 从 Conversation.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function SessionGroup({ collapsed, dragId, dropTarget, editText, editing, flat, g, isUng, newSession, proj, props, rowMenu, setArchivingProject, setCollapsedGroups, setDeleteConfirmText, setDeletingProject, setDragId, setDropTarget, setEditText, setEditing, setRowMenu, setViewMenu, showProjectError }: SessionGroupProps) {
  return (
    <div className="cv3-group" data-ungrouped={isUng && !flat || undefined}
      onDragOver={(e) => {
        if (!dragId || flat) return
        e.preventDefault()
        setDropTarget(g.projectId)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDropTarget((t) => (t === g.projectId ? null : t))
      }}
      onDrop={(e) => {
        e.preventDefault()
        if (dragId && !flat) props.threads.moveTo(dragId, isUng ? null : g.projectId)
        setDragId(null)
        setDropTarget(null)
      }}>
                {!flat && (
                  <SessionGroupRow
                    collapsed={collapsed}
                    dropTarget={dropTarget}
                    editText={editText}
                    editing={editing}
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
                    setEditText={setEditText}
                    setEditing={setEditing}
                    setRowMenu={setRowMenu}
                    setViewMenu={setViewMenu}
                    showProjectError={showProjectError}
                  />
                )}
                {!collapsed && (
                  <SessionGroupBody
                    dragId={dragId}
                    editText={editText}
                    editing={editing}
                    flat={flat}
                    g={g}
                    isUng={isUng}
                    proj={proj}
                    props={props}
                    rowMenu={rowMenu}
                    setDragId={setDragId}
                    setDropTarget={setDropTarget}
                    setEditText={setEditText}
                    setEditing={setEditing}
                    setRowMenu={setRowMenu}
                    setViewMenu={setViewMenu}
                  />
                )}
    </div>
  )
}

import type * as React from 'react'
import { useState, useCallback } from 'react'
import type { ProjectSummary } from '@/features/project/model/projects'
import type { ConversationProps } from '@/features/chat/Conversation'

export interface UseSidebarUiArgs {
  props: ConversationProps
  setProjectError: React.Dispatch<React.SetStateAction<string | null>>
  showProjectError: (error: unknown) => void
}

/** 从 Conversation.tsx 的 Conversation 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useSidebarUi({ props, setProjectError, showProjectError }: UseSidebarUiArgs) {
  /* dsh 响应式：1024 以下左栏自动收为 56px 轨，手动展开为覆盖式抽屉 */
  const [narrow, setNarrow] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 1024))
  const [sideExpanded, setSideExpanded] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024))
  /* 左栏两级树：折叠状态、正在拖的会话、拖放目标组 */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /* ── 左栏视图选项（对齐 dsh 的 viewOptions / groupBy / orderBy / filterBy）──
     query=搜索会话名称；groupMode=按项目/单列表；orderMode=最近更新/手动；
     archiveFilter=隐藏已归档/全部/仅已归档 */
  const [query, setQuery] = useState('')
  const [groupMode, setGroupMode] = useState<'project' | 'flat'>('project')
  const [orderMode, setOrderMode] = useState<'updated' | 'manual'>('updated')
  const [archiveFilter, setArchiveFilter] = useState<'hide' | 'show' | 'only'>('hide')
  const [viewMenu, setViewMenu] = useState(false)
  /* 每行的「更多」菜单：记录当前展开的是哪个 id（项目/会话共用一套浮层） */
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  /* 引擎/模型弹窗：modelOpen = 是否展开，modelPane = 当前在哪一级
     （null = 引擎列表；某引擎 id = 该引擎的模型页）。对齐首页的 harnessPane。 */
  /* 模型/引擎选择状态：输入框已换成 LeiBox 官方组件（它自带模型与推理
     档位菜单），这几个状态暂时没有消费方，但引擎切换、会话偏好仍要用到，
     保留并显式标记，避免被当成死代码删掉。 */
  const [modelOpen, setModelOpen] = useState(false)
  const [modelPane, setModelPane] = useState<string | null>(null)
  void modelOpen; void setModelOpen; void modelPane; void setModelPane
  /* 行内重命名：editing = 正在编辑的 id，editText = 输入值 */
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  /* 归档确认：待归档的项目；null = 没在归档。归档只是移出列表，文件留着。 */
  const [archivingProject, setArchivingProject] = useState<ProjectSummary | null>(null)
  /* 删除确认：待删的项目；null = 没在删。
     删除走物理删除，项目目录真的被删掉，所以确认框要用户输入项目名。 */
  const [deletingProject, setDeletingProject] = useState<ProjectSummary | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  /* 删除确认框里输入的项目名：必须与项目名完全一致才让删。
     不可撤销的操作不能靠一次点击就生效 —— 手滑点错的代价太大。 */
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  /**
   * 确认归档项目：移出列表，文件留着。
   *
   * <p>失败时关掉对话框并把原因留在左栏：项目仍在列表里，
   * 让用户看见「没删掉」比对话框一直卡在原地有用。</p>
   */
  const confirmArchiveProject = useCallback(async () => {
    if (!archivingProject) return
    if (!props.onArchiveProject) {
      setProjectError('归档项目未接入')
      setArchivingProject(null)
      return
    }
    setDeletingBusy(true)
    try {
      await props.onArchiveProject(archivingProject.id)
      setArchivingProject(null)
    } catch (error) {
      showProjectError(error)
      setArchivingProject(null)
    } finally {
      setDeletingBusy(false)
    }
  }, [archivingProject, props])

  /**
   * 确认删除项目：物理删除，目录与成片真的被删掉。
   *
   * <p>要求项目名逐字一致才放行：这一步不可撤销，
   * 一次误点就可能丢掉几十分钟的渲染成果。</p>
   */
  const confirmDeleteProject = useCallback(async () => {
    if (!deletingProject) return
    /* 没接上删除实现时如实说「没删」，不能关掉对话框装作删掉了 ——
       项目还在列表里，用户会以为是自己看错了。 */
    if (!props.onDeleteProject) {
      setProjectError('删除项目未接入')
      setDeletingProject(null)
      return
    }
    setDeletingBusy(true)
    try {
      await props.onDeleteProject(deletingProject.id)
      setDeletingProject(null)
      /* 连输入框一起清掉：这段文字是上一次删除的残留，
         留在 state 里会让下一个删除框直接带着上次的项目名出现 ——
         上次输的恰好就是这次的项目名时，按钮会直接可点。 */
      setDeleteConfirmText('')
    } catch (error) {
      showProjectError(error)
      setDeletingProject(null)
      setDeleteConfirmText('')
    } finally {
      setDeletingBusy(false)
    }
  }, [deletingProject, props])
  return { setNarrow, archiveFilter, groupMode, narrow, orderMode, query, sideExpanded, setEditing, setEditText, setCollapsedGroups, setSideExpanded, setQuery, viewMenu, setViewMenu, setRowMenu, setGroupMode, setOrderMode, setArchiveFilter, collapsedGroups, dragId, setDropTarget, setDragId, editing, editText, dropTarget, rowMenu, setArchivingProject, setDeleteConfirmText, setDeletingProject, archivingProject, deletingBusy, confirmArchiveProject, deletingProject, deleteConfirmText, confirmDeleteProject }
}

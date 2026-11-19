import type * as React from 'react'
import { useWorkbenchSplit } from '@/features/workbench/hooks/useWorkbenchSplit'
import { PROJECTS } from '@/features/project/model/projects'
import { useState, useEffect, useMemo } from 'react'
import { workflowService } from '@/features/workflow/services/workflowService'
import type { WorkbenchProps } from '@/features/workbench/Workbench'

export interface UseBoundSessionArgs {
  boundSessionId: string | null
  onSelectSession: WorkbenchProps['onSelectSession']
  pendingSubmissionRef: React.RefObject<{ promptKey: string; idempotencyKey: string; sessionId: string; userMessageId?: string; taskId?: string; path?: 'main' | 'alt'; createdAt: number } | null>
  projectId: WorkbenchProps['projectId']
  projects: WorkbenchProps['projects']
  propSessionId: WorkbenchProps['sessionId']
  setBoundSessionId: React.Dispatch<React.SetStateAction<string | null>>
  tasks: WorkbenchProps['tasks']
  threads: WorkbenchProps['threads']
}

/** 从 Workbench.tsx 的 Workbench 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useBoundSession({ boundSessionId, onSelectSession, pendingSubmissionRef, projectId, projects, propSessionId, setBoundSessionId, tasks, threads }: UseBoundSessionArgs) {
  const split = useWorkbenchSplit()
  /** 打开的哪个项目 —— 从一级目录传下来的 id 解析。
      ⚠️ 必须用传入的目录：对话视图里新建的项目只存在于内存态，
        拿静态 PROJECTS 查不到会静默落回第一个种子项目（顶栏名字对不上）。 */
  const catalog = projects?.length ? projects : PROJECTS
  const project = catalog.find((p) => p.id === projectId) ?? catalog[0]
  /* 当前项目的工作流实例：没有就按默认 Prompt-first 建一个。
     左栏「待你决定」与执行确认都挂在它上面 —— 这是数据源，不是装饰。
     Prompt-first 主干是 提示词 → 创作与渲染 → 看片与修改；
     看片节点的 checks 就是「等你决定」的真实载体。 */
  const [workflow, setWorkflow] = useState(() => {
    if (!projectId) return null
    const existing = workflowService.listWorkflows().find((w) => w.projectId === projectId)
    if (existing) return existing
    return workflowService.createFromPath('prompt-first', 'general', project?.name ?? '未命名创作', { projectId })
  })
  const refreshWorkflow = () => {
    if (workflow) setWorkflow(workflowService.getWorkflow(workflow.id))
  }
  /* 待你决定：本项目所有工作流里真正等你拍板的节点。
     Prompt-first 的看片结论 + Structured 的门禁（Gate，pending 态）。
     没有数据就不出现，不编造待办；结论写回各自节点，与工作流编辑器
     读同一份状态。上一版堆叠把 Gate 的结论写进了 status 字段，
     而 evaluateGate 只读 decision——通过后卡片根本不会离开待办，
     这次按 decision/confirmedFor 写，与编辑器确认卡同一口径。
     渲染里不直接读存储：快照 state 由决定写回时刷新，视图切换重挂载
     时重取，计算本身是快照的纯函数。 */
  /* id 必须带上工作流：节点 id 在各自图里唯一，但跨工作流会重名（每个 prompt-first
     图都叫 n-review）。牌堆是按 id 认卡的，重名会让两张卡被当成同一张、只渲染出一张。
     写回工作流时要的是原始 nodeId，所以两个字段分开存，不要合成一个。 */
  const projectRecords = tasks.records.filter((r) => !r.request?.projectId || r.request.projectId === projectId)
  const projectTask = tasks.active && (!tasks.active.request?.projectId || tasks.active.request.projectId === projectId) ? tasks.active : null

  useEffect(() => {
    if (propSessionId !== undefined) {
      setBoundSessionId(propSessionId)
    }
  }, [propSessionId])

  /** 当前项目名下的所有会话列表 */
  const projectSessions = useMemo(() => {
    if (!threads) return []
    return threads.sessions.filter((s) => s.projectId === projectId)
  }, [threads, projectId])

  /** 当前激活的具体会话对象 */
  const currentSession = useMemo(() => {
    if (!boundSessionId) {
      // 若当前未指定会话，但该项目已有会话，默认选用最新的一条
      return [...projectSessions].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
    }
    return projectSessions.find((s) => s.id === boundSessionId) ?? null
  }, [projectSessions, boundSessionId])

  // 当自动选出会话时，同步回 boundSessionId 与外层
  useEffect(() => {
    if (!boundSessionId && currentSession) {
      setBoundSessionId(currentSession.id)
      onSelectSession?.(currentSession.id)
    }
  }, [boundSessionId, currentSession, onSelectSession])

  // 若服务端会话未加载过消息，自动触发拉取（加载失败时停止自动轮询，停在错误卡片等待用户手动重试）
  useEffect(() => {
    if (!currentSession || currentSession.origin !== 'server' || currentSession.messagesLoaded || currentSession.messagesError || !threads) return
    void threads.loadMessages(currentSession.id)
  }, [currentSession, threads])

  /** 确保当前有可用会话，无则自动为本项目创建服务端真实新会话（坚决不串用其他项目，草稿未同步绝不冒充，失败明确报错） */
  const ensureBoundSession = async (firstPrompt: string): Promise<{ sessionId: string | null; error?: string }> => {
    if (currentSession?.id) {
      if (currentSession.origin === 'local') {
        if (!threads) return { sessionId: null, error: '会话服务未就绪' }
        const res = await threads.retryCreate(currentSession.id)
        if (res.error || !res.session || res.session.origin !== 'server') {
          return { sessionId: null, error: res.error || '当前会话仅保存在本地草稿，未能同步至服务端，请重试' }
        }
        setBoundSessionId(res.session.id)
        onSelectSession?.(res.session.id)
        return { sessionId: res.session.id }
      }
      return { sessionId: currentSession.id }
    }
    if (!threads) return { sessionId: null, error: '会话服务未就绪' }
    try {
      const res = await threads.create({
        projectId,
        firstText: firstPrompt,
      })
      if (res.error) {
        return { sessionId: null, error: res.error }
      }
      if (!res.session || res.session.origin !== 'server') {
        return { sessionId: null, error: '未能建立服务端会话，会话未保存' }
      }
      setBoundSessionId(res.session.id)
      onSelectSession?.(res.session.id)
      return { sessionId: res.session.id }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { sessionId: null, error: msg }
    }
  }

  const updatePendingSubmission = (state: {
    promptKey: string
    idempotencyKey: string
    sessionId: string
    userMessageId?: string
    taskId?: string
    path?: 'main' | 'alt'
    createdAt: number
  } | null) => {
    pendingSubmissionRef.current = state
    try {
      if (!state) {
        sessionStorage.removeItem(`fm-pending-sub:${projectId}`)
      } else {
        sessionStorage.setItem(`fm-pending-sub:${projectId}`, JSON.stringify(state))
      }
    } catch {
      /* 存储不可用时忽略 */
    }
  }
  return { updatePendingSubmission, projectRecords, projectTask, workflow, refreshWorkflow, catalog, project, ensureBoundSession, currentSession, split, projectSessions }
}

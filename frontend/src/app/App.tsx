import '@/styles/interface-polish.css'
import '@/styles/card-details.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@/features/chat/hooks/useChat'
import { initDesktopApiBase } from '@/api'
import { useSessions } from '@/features/chat/hooks/useSessions'
import { useProjects } from '@/features/project/hooks/useProjects'
import { useAgentTasks } from '@/features/creation/hooks/useAgentTasks'
import { VIEW_META, type ViewId } from '@/shared/navigation/views'
import { AppShell } from '@/app/AppShell'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { loadSettings, saveSettings, type Settings } from '@/features/settings/model/settings-model'
import { Home, type StartPayload } from '@/features/home/Home'
import { prepareCreationEntry } from '@/features/creation/services/creationEntry'
import { setSessionDraft } from '@/features/chat/hooks/useDraftStore'
import { Workbench } from '@/features/workbench/Workbench'
import { Assets } from '@/features/assets/Assets'
import { ProjectBar, PickProject } from '@/features/project/components/ProjectBar'
import { RenderDelivery } from '@/features/creation/RenderDelivery'
import { FxLibrary } from '@/features/fx/FxLibrary'
import { RefLibrary } from '@/features/reference/RefLibrary'
import { Workflow } from '@/features/workflow/Workflow'
import { StartCreation } from '@/features/creation/StartCreation'
import { ProjectsHome } from '@/features/project/ProjectsHome'
import { Conversation } from '@/features/chat/Conversation'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { NavigationGuardProvider } from '@/shared/navigation/NavigationGuardProvider'
import { useNavigationGuard } from '@/shared/navigation/navigationGuardContext'
import { LocalDocumentsBoundary } from '@/shared/local-documents/LocalDocumentsBoundary'

/**
 * 应用外壳 —— 结构对应 paba.tv 的 #app：
 *
 *   #app
 *   ├── <aside id="hm-sidebar">     68px 图标轨（悬停出展开按钮 → 216px）
 *   ├── <div id="pane-home">        首页
 *   ├── <div id="pane-flow">        工作台
 *   └── <main id="pane-*">          其余视图
 *
 * 侧栏壳在 shell/AppShell.tsx；本文件只做状态与视图分发。
 * 顶部标签栏（paba 的 .tabbar）已删除：它与侧栏是同一份导航，且运行时不可见。
 * 导航内容来自 shell/views.ts，不在这里硬编码。
 */

type View = ViewId

export default function App() {
  return <LocalDocumentsBoundary><NavigationGuardProvider><AppContent /></NavigationGuardProvider></LocalDocumentsBoundary>
}

function AppContent() {
  const navigation = useNavigationGuard()
  const [projectHome,setProjectHome]=useState(false)
  /** 开发调试入口：?view=production&project=token 直接进工作台；普通访问不变。 */
  const initialQuery = new URLSearchParams(window.location.search)
  const initialView = initialQuery.get('view') as View | null
  /** 启动视图：?view= 参数 > 设置里的「默认进入视图」> 首页 */
  const [view, setView] = useState<View>(initialView && initialView in VIEW_META
    ? initialView
    : loadSettings().startView)
  /**
   * 制作工作台是**两级**的：
   *   null      → 一级：项目目录（铺满页面）
   *   '<id>'    → 二级：该项目的工作台
   * 用独立的 openProject 而不是复用 view，因为「目录」和「工作台」
   * 共用一个 ViewId（production），但页面完全不同。
   */
  const [openProject, setOpenProject] = useState<string | null>(initialQuery.get('project'))
  /** 新建项目对话卡（演示：只在内存里建，不落盘） */
  const tasks = useAgentTasks()
  const projects = useProjects()
  const threads = useSessions()
  /* 调试入口：?session=<id> 直达某条会话（配合 ?view=conversation&project=）。
     会话列表加载完成后才认这个 id，否则会被「默认选第一条」的逻辑覆盖掉。 */
  const deepLinkSession = initialQuery.get('session')
  useEffect(() => {
    if (!deepLinkSession) return
    /* 会话列表还没回来时先不动 —— 否则会被「默认选第一条」覆盖掉 */
    if (!threads.sessions.some((s) => s.id === deepLinkSession)) return
    if (threads.activeId !== deepLinkSession) threads.setActiveId(deepLinkSession)
  }, [deepLinkSession, threads])
  /** 当前项目 —— 项目管理组的每个视图都要它 */
  const current = projects.list.find((p) => p.id === openProject) ?? null
  /** 项目加载完成后读取各项目的已存会话（后端契约 agent.md §2）。
      只读一次/项目：refresh 内部按项目去重，切换视图不会反复打请求。 */
  const refreshSessionsForProjects = threads.refresh
  const loadedProjectIds = projects.list.map((p) => p.id).join(',')
  /** 按项目分别触发（逐项 await 会串行；这里并行发起，loading 计数由 hook 汇总） */
  useEffect(() => {
    if (projects.loading) return
    for (const id of loadedProjectIds ? loadedProjectIds.split(',') : []) {
      void refreshSessionsForProjects([id])
    }
    // loadedProjectIds 以字符串作依赖：projects.list 每次渲染是新数组，会让 effect 每帧重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.loading, loadedProjectIds, refreshSessionsForProjects])
  /** 重试会话读取：对全部项目强制重读（失败的项目、以及新项目都在其中） */
  const retrySessions = () => {
    void threads.refresh(projects.list.map((p) => p.id), { force: true })
  }
  /* 切换项目 / 回到对话视图时，强制重读当前项目的会话。
     会话列表是服务端的快照：在工作台或别处新建的会话，不重读就永远不出现
     （原先 refresh 按项目去重，读过一次之后再也不拉，新会话等于不可见）。 */
  const conversationVisible = view === 'conversation'
  useEffect(() => {
    if (!conversationVisible || !openProject) return
    void threads.reload(openProject)
    // 只在「进入对话视图」或「换项目」时重读；threads.reload 是稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationVisible, openProject])
  /* 「返回项目目录」：项目列表页已移除，回「我的创作」（对话视图）。
     保留当前选中项目，便于从对话视图一键回工作台。 */
  /** 工作台与对话区共享的当前项目激活会话：
   *  1. 优先读取 threads.activeId（若属于当前 openProject）；
   *  2. 其次恢复该项目上次在工作台明确选择的会话；
   *  3. 再次回退到当前 openProject 下最新活跃的一条会话；
   *  4. 若该项目暂无任何会话，则为 null。
   */
  const activeWorkbenchSessionId = useMemo(() => {
    if (!openProject) return null
    if (threads.activeId) {
      const s = threads.sessions.find((x) => x.id === threads.activeId)
      if (s && s.projectId === openProject) return threads.activeId
    }
    try {
      const saved = localStorage.getItem(`fengmotion:workbench-session:${openProject}`)
      if (saved) {
        const matched = threads.sessions.find((x) => x.id === saved && x.projectId === openProject)
        if (matched) return saved
      }
    } catch { /* 忽略存储不可用 */ }

    const projectSessions = threads.sessions
      .filter((s) => s.projectId === openProject)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return projectSessions[0]?.id ?? null
  }, [openProject, threads.activeId, threads.sessions])

  /* 当前项目跟着打开的对话走。
     启动时会恢复上次打开的对话，但当前项目（openProject）只认地址栏，于是对话内容显示出来了，
     左栏却没选中、「工作台」也是灰的，非要点一下那条对话才能用。现在对话一确定，就把它所属的项目设为当前项目。
     只在对话所属项目变化时跟一次：之后用户在左栏换项目、或在工作台切项目，不会被拉回去。 */
  const activeSessionProject = threads.sessions.find((s) => s.id === threads.activeId)?.projectId ?? null
  const urlProject = useRef(initialQuery.get('project'))
  useEffect(() => {
    if (!activeSessionProject || activeSessionProject === openProject) return
    /* 地址栏指定了项目（调试直达）时，首次不覆盖它 */
    if (urlProject.current && openProject === urlProject.current) { urlProject.current = null; return }
    setOpenProject(activeSessionProject)
    // 只跟「对话所属项目」的变化；openProject 不进依赖，否则用户手动换项目会被拉回
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionProject])

  /* 启动时没有上次打开的对话（第一次用、或那条已被删）：会话列表读完后，打开最近活跃的一条。
     只做一次，不在之后用户主动清空选择时又自动选上。 */
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current || projects.loading || threads.loading || threads.sessions.length === 0) return
    /* 会话按项目分批读回：所有项目都读完才判断，否则上次那条可能只是所在项目还没读到 */
    if (!projects.list.every((p) => threads.loadedProjects.has(p.id))) return
    autoOpened.current = true
    if (threads.activeId && threads.sessions.some((s) => s.id === threads.activeId)) return
    const latest = [...threads.sessions].filter((s) => !s.archived).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (latest) threads.setActiveId(latest.id)
  }, [projects.loading, projects.list, threads.loading, threads.loadedProjects, threads.sessions, threads.activeId, threads])

  const handleSelectWorkbenchSession = useCallback((sessionId: string) => {
    threads.setActiveId(sessionId)
    if (openProject) {
      try {
        localStorage.setItem(`fengmotion:workbench-session:${openProject}`, sessionId)
      } catch { /* 忽略存储不可用 */ }
    }
  }, [openProject, threads])

  /* 「返回项目目录」：项目列表页已移除，回「我的创作」（对话视图）。
     精准切回工作台当前绑定的同一会话，保留当前选中项目。 */
  const openList = useCallback(() => {
    if (activeWorkbenchSessionId) threads.setActiveId(activeWorkbenchSessionId)
    setProjectHome(false)
    setView('conversation')
  }, [activeWorkbenchSessionId, threads.setActiveId])
  // 复刻页（项目指挥中心）通过 postMessage 请求跨页导航
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string; projectId?: string } | null
      if (!d) return
      if (d.type !== 'fm-nav' || !d.id) return
      navigation.request(() => {
        if (d.id === '__list') { openList(); return }
        if (d.id === '__home') { setView('home'); return }
        if (d.projectId) setOpenProject(d.projectId)
        if (d.id === 'conversation') setProjectHome(false)
        setView(d.id as Parameters<typeof setView>[0])
      })
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [navigation, openList])
  /** 创作启动层（M1）：首页发送后带着草稿打开，null = 关闭
      原型分支：首页发送改走项目对话视图（见 Home 的 onStart），启动层本体保留未删，
      目前没有入口触发它；M1 去留待定案后再统一收口。 */
  const [startDraft, setStartDraft] = useState<string | null>(null)
  const [homeTransfer, setHomeTransfer] = useState<{ sessionId: string; draft: string; files: { file: File; kind: 'file' | 'image' | 'video' }[]; intent: 'create' | 'chat' } | null>(null)
  const homeStarting = useRef(false)
  const homePreparedProject = useRef<string | null>(null)
  /** 启动层刚建好的「本次制作」：双路径都落工作台，由工作台的任务面执行与呈现 */
  const [pendingLaunch, setPendingLaunch] = useState<{ workflowId: string; projectId: string | null; autoRun: boolean } | null>(null)
  /** 落工作台的统一入口：启动层与对话视图共用。
      落点 = 工作台（创作者做片子的地方）；工作流编辑器只是方法工坊，
      从工作台的「本次制作」深链回去，不再作为创作落点。 */
  const handleLaunch = (r: { workflowId: string; projectId: string | null; autoRun: boolean }) => {
    setPendingLaunch(r)
    if (r.projectId) setOpenProject(r.projectId)
    setStartDraft(null)
    setView('production')
  }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  /* 更新状态文案。只在桌面壳里有；浏览器/开发态恒为 null。
     有值时在页面顶部显示一条窄条 —— 用户必须能看到「有新版本」，
     否则更新检查等于没做（主进程早就发状态，但此前没人接收）。 */
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const chat = useChat()
  /**
   * 壳注入后端地址的完成信号。
   * 引擎探测等依赖 API 客户端的视图要等它就绪，否则会用默认地址发第一个请求。
   */
  const [, setApiBaseReady] = useState(0)

  /** 切视图**不清**项目上下文：项目管理组的子视图（素材/交付）都挂在
      当前项目上；要回列表就走 openList()（项目条上的「全部项目」或总览的返回）。 */
  const go = (v: string) => { if (v !== view || v === 'conversation') navigation.request(() => {if(v==='conversation')setProjectHome(false);setView(v as View)}) }
  /* 侧栏现在是「隐藏 / 显示」，不再做 68 ↔ 216 的展开切换：
     作者要求 logo 当开关 —— 工具型界面要的是"把导航让出来给画布"，
     半展开的图标轨既不省空间也没多给信息。
     hm-nav-hidden 由 CSS 把 --hm-sidebar 归零、侧栏移出视口，主区自然占满。
     状态记在 localStorage，刷新后保持用户的选择。 */
  const toggleNav = () => {
    const hidden = document.body.classList.toggle('hm-nav-hidden')
    try { localStorage.setItem('fengmotion:nav-hidden', hidden ? '1' : '0') } catch { /* 隐私模式下忽略 */ }
  }
  /** 切主题：加一个短暂的 theme-switching 类，让过渡不闪 */
  const changeTheme = (theme: Settings['theme']) => {
    document.documentElement.classList.add('theme-switching')
    setSettings((prev) => ({ ...prev, theme }))
    window.setTimeout(() => document.documentElement.classList.remove('theme-switching'), 320)
  }

  /**
   * paba 的真实做法（源码 HM["select"]）：
   *   body.classList.toggle('studio-shell', ['home','video','image','audio','objects'].includes(view))
   *
   * ⚠️ 侧栏与主区的大量尺寸规则挂在 `body.studio-shell` 下；
   *    首页纸片样式挂在 `body.homeon` 下。不加这两个类，布局会塌。
   */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme)
    document.body.classList.add('studio-shell')   // 本产品所有视图都在 shell 内
    /* 恢复上次的侧栏隐藏状态 */
    try {
      if (localStorage.getItem('fengmotion:nav-hidden') === '1') document.body.classList.add('hm-nav-hidden')
    } catch { /* 忽略 */ }
    document.body.classList.toggle('flowon', view === 'production')
  }, [view, settings.theme])
  /** 设置即改即存（loadSettings 读回；旧版 fengmotion:theme 由它迁移） */
  useEffect(() => { saveSettings(settings) }, [settings])

  /**
   * 桌面壳初始化：把壳运行时才知道的后端地址注入 API 客户端。
   *
   * 必须在任何数据请求之前完成，否则第一个请求会用默认的 8080 地址发出去。
   * 浏览器里跑时是空操作。
   */
  useEffect(() => {
    let cancelled = false
    void initDesktopApiBase().then(() => {
      if (!cancelled) setApiBaseReady((n) => n + 1)
    })
    return () => { cancelled = true }
  }, [])
  /**
   * 订阅桌面壳的更新状态。
   *
   * 壳的 preload 可能没有这个通道（老版本），所以按可选处理：
   * 拿不到就什么都不做，不报错。
   */
  useEffect(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.fengmotion
    if (!bridge?.onUpdateStatus) return
    return bridge.onUpdateStatus((message) => setUpdateStatus(message))
  }, [])

  /**
   * 当前视图该不该显示壁纸 —— 显示范围只在命中时挂载壁纸层。
   * 「仅首页」按 home 判断；单视图范围按视图 id 判断；
   * global 一律显示。壁纸永远垫在内容之下，工作台画面不受影响。
   */
  const activeWallpaper = (() => {
    if (settings.wallpaper === 'none') return null
    if (settings.wallpaper === 'custom' && !settings.wallpaperCustom) return null
    const scope = settings.wallpaperScope
    const hit = scope === 'global' || scope === view
    if (!hit) return null
    return {
      id: settings.wallpaper,
      src: settings.wallpaper === 'custom' ? settings.wallpaperCustom : null,
      dim: settings.wallpaperDim,
    }
  })()

  /** 减弱动效：手动开启时压平全局动画/过渡（CSS 见 settings.css） */
  useEffect(() => {
    document.documentElement.dataset.motion = settings.reduceMotion ? 'reduce' : 'normal'
  }, [settings.reduceMotion])

  /** 制作工作台：必须有当前项目（列表已归项目管理，这里不再兼当目录） */
  const isFlow = view === 'production' && current !== null
  /** production 无项目时不再落项目列表（已移除），回对话视图 */
  const isCatalog = false
  const SUB_VIEWS = ['assets', 'render']
  const isSub = SUB_VIEWS.includes(view as string)

  return (
    <TooltipProvider delayDuration={300}>
      <AppShell view={view as ViewId} onNavigate={go}
                wallpaper={activeWallpaper}
                onOpenSettings={() => setSettingsOpen(true)}
                onToggleNav={toggleNav}>

        {/* 更新提示条。只在桌面壳报告状态时出现，用户点掉后不再显示。
            没有它的话，「发现新版本」只存在于日志里 —— 用户永远看不到。 */}
        {updateStatus && (
          <div className="fm-update-bar" role="status">
            <span>{updateStatus}</span>
            <button type="button" onClick={() => setUpdateStatus(null)} aria-label="关闭更新提示">×</button>
          </div>
        )}

        {/* 首页先准备真实项目/会话和带意图的草稿，不预先保存消息或起流。 */}
        {view === 'home' && (
          <div id="pane-home">
            <Home projects={projects.list}
                  onStart={async (payload: StartPayload) => {
              if (homeStarting.current) return
              homeStarting.current = true
              try {
                const project = payload.workdir ? projects.list.find((p) => p.path === payload.workdir!.path) : null
                let projectId: string | null = project?.id ?? null
                let sessionId: string
                if (payload.intent === 'create') {
                  const prepared = await prepareCreationEntry({
                    projectId: projectId ?? homePreparedProject.current, title: payload.draft,
                  }, {
                    createProject: () => projects.createBlank(payload.draft.trim().split('\n')[0]?.slice(0, 32) || undefined),
                    createSession: threads.create,
                    onProjectReady: (id) => { if (!projectId) homePreparedProject.current = id },
                  })
                  projectId = prepared.projectId
                  sessionId = prepared.sessionId
                } else {
                  const result = await threads.create({ projectId, firstText: payload.draft, workdir: payload.workdir })
                  if (result.error || !result.session) throw new Error(result.error || '对话尚未准备好，请重试。')
                  sessionId = result.session.id
                }
                // Only prepare the draft. Sending always remains an explicit composer action.
                setSessionDraft(projectId, sessionId, { text: payload.draft, intentAction: payload.intent === 'create' ? 'modify' : 'query' })
                setHomeTransfer({ sessionId, draft: payload.draft, files: payload.attachments, intent: payload.intent })
                setOpenProject(projectId)
                setProjectHome(false)
                setView('conversation')
                homePreparedProject.current = null
              } finally { homeStarting.current = false }
            }} />
          </div>
        )}

        {/* 项目对话视图 —— 与工作台共用 useChat 会话；
            左栏是「我的项目」（原项目列表页的那份数据），所以这里也是项目入口 */}
        {view === 'conversation' && (
          <div id="pane-conversation">
            <Conversation chat={chat}
                          overviewOpen={projectHome}
                          onOverviewChange={setProjectHome}
                          projectOverview={projectHome ? <ProjectsHome embedded projects={projects.list} loading={projects.loading} error={projects.error} onRefresh={()=>void projects.refresh()}
                            onChat={()=>setProjectHome(false)}
                            onCreate={async()=>{const p=await projects.createBlank();const result=await threads.create({projectId:p.id});if(!result.session||result.error)throw new Error(result.error??'会话创建失败');setSessionDraft(p.id,result.session.id,{intentAction:'modify'});setOpenProject(p.id);setProjectHome(false)}}
                            onOpen={(id,mode)=>{setOpenProject(id);const sid=threads.sessions.filter(s=>s.projectId===id).sort((a,b)=>b.updatedAt-a.updatedAt)[0]?.id;threads.setActiveId(sid??null);setProjectHome(false);setView(mode)}}/> : null}
                          homeTransfer={homeTransfer}
                          onHomeTransferConsumed={() => setHomeTransfer(null)}
                          threads={threads}
                          activeSessionId={threads.activeId}
                          projects={projects.list}
                          projectsLoading={projects.loading}
                          projectsError={projects.error}
                          onRefreshProjects={() => void projects.refresh()}
                          sessionsError={threads.error}
                          onRetrySessions={retrySessions}
                          onCreateProject={(input) => projects.create(input)}
                          openProject={openProject}
                          onSelectProject={(id) => setOpenProject(id)}
                          /* 左栏直建（dsh workspace.create）：不弹表单，建完在行内改名 */
                          onNewProject={async () => {
                            const p = await projects.createBlank()
                            setOpenProject(p.id)
                            return p
                          }}
                          onRenameProject={(id, name) => projects.rename(id, name)}
                          /* 归档：移出列表，文件留着。
                             删除当前打开的项目时要一起清掉 openProject：
                             否则工作台还停在一个已经不在列表里的项目上，
                             界面看着正常，点任何操作都会报「项目不存在」。 */
                          onArchiveProject={async (id) => {
                            await projects.archive(id)
                            if (openProject === id) setOpenProject(null)
                          }}
                          onDeleteProject={async (id) => {
                            await projects.purge(id)
                            if (openProject === id) setOpenProject(null)
                          }}
                          onOpenWorkbench={(sid) => {
                            if (sid) handleSelectWorkbenchSession(sid)
                            else if (activeWorkbenchSessionId) handleSelectWorkbenchSession(activeWorkbenchSessionId)
                            if (openProject) setView('production')
                          }} />
          </div>
        )}

        {/* 制作工作台 · 二级：三栏工作台。
            原先这里有个 `current.id !== 'token'` 的分支，只有硬编码的演示项目
            `token` 能进工作台，其余项目一律显示「尚未接入」。结果是：用户在真实
            项目里点「带着这段对话去工作台」，被带到一堵墙前（真机验收可见）。
            工作台本身是完整的（Workbench.tsx），不该由项目 id 决定能不能进。 */}
        {isFlow && current && (
          <div id="pane-flow">
            <Workbench key={openProject!} chat={chat} tasks={tasks}
                       threads={threads}
                       sessionId={activeWorkbenchSessionId}
                       onSelectSession={handleSelectWorkbenchSession}
                       onNavigate={(next) => {
                         if (next === 'conversation' && activeWorkbenchSessionId) {
                           threads.setActiveId(activeWorkbenchSessionId)
                         }
                         setProjectHome(false)
                         setView(next)
                       }}
                       projectId={openProject!}
                       projects={projects.list}
                       onBack={openList}
                       onSwitchProject={(id) => setOpenProject(id)}
                       launch={pendingLaunch && pendingLaunch.projectId === openProject
                         ? { workflowId: pendingLaunch.workflowId, autoRun: pendingLaunch.autoRun }
                         : null}
                       onOpenWorkflowEditor={(workflowId) => {
                         try {
                           localStorage.setItem('fm-open-workflow-v1', JSON.stringify({ id: workflowId, autoRun: false }))
                         } catch { /* localStorage 不可用时仅跳视图 */ }
                         setView('methods')
                       }}
                       onDismissLaunch={() => setPendingLaunch(null)} />
          </div>
        )}

        {/* 其余视图（对话视图已在上面单独分发）
            home 必须排除：它上面已有专门的一屏（#pane-home + 首页动效），
            这里再进来一次会生成一个空的 .hm-main，顶着同一个 id，
            把 #app 撑高一整个视口 —— 页面多出一屏空白、滚动条乱跳。 */}
        {!isFlow && !isCatalog && view !== 'conversation' && view !== 'home' && (
          <div id={`pane-${view}`} className="hm-main">
            <div className="hm-content" data-view={view}>
              {/* 项目管理组的视图都挂在当前项目上：顶上先给一条项目条
                  （创作资产 = 全幅复刻页，无项目条） */}
              {isSub && current && view !== 'assets' && (
                <ProjectBar project={current} view={view}
                            onNav={(id) => go(id)} onBack={openList}
                            onOpenWorkbench={() => setView('production')} />
              )}
              {isSub && !current && view !== 'assets' && (
                <PickProject onBack={openList} />
              )}
              {/* 进入「工作台」但没有当前项目：原先这里什么都不渲染，
                  整页只剩侧栏 —— 看起来像白屏，用户不知道发生了什么。
                  明确告诉他还没选项目，并给一条回列表的路。 */}
              {view === 'production' && !current && (
                <PickProject onBack={openList} />
              )}
              {/* 创作资产是例外：既可作为项目内的上下文视图，
                  也可作为不带项目过滤的全局入口 */}
              {/* key 跟随当前项目：换项目时分类重新停在新项目上 */}
              {isSub && view === 'assets' && (
                <Assets key={current?.id ?? 'all'} currentProjectId={current?.id ?? null}
                        projects={projects.list.map((p) => ({ id: p.id, name: p.name }))} />
              )}
              {isSub && current && view === 'render' && (
                <RenderDelivery project={current} tasks={tasks} />
              )}
              {view === 'knowledge' && <FxLibrary />}
              {view === 'reference' && <RefLibrary />}
              {view === 'methods' && <Workflow />}
            </div>
          </div>
        )}
        {/* 设置：居中弹窗（Esc / 遮罩 / X 关闭），即改即生效存本机 */}
        <SettingsScreen open={settingsOpen} onClose={() => setSettingsOpen(false)}
                        settings={settings} onChange={setSettings}
                        onThemeChange={changeTheme} />

        {/* 创作启动层：承接首页需求 → 建项目与工作流 → 落工作台呈现「本次制作」
            （快速路径在工作台自动运行；专业路径只创建不运行） */}
        {startDraft !== null && (
          <StartCreation
            initialDraft={startDraft}
            projects={projects.list}
            onClose={() => setStartDraft(null)}
            onCreateProject={(input) => projects.create(input)}
            onBrowseLibrary={(v) => { setStartDraft(null); setView(v) }}
            onLaunch={handleLaunch}
          />
        )}

        {/* 新建项目不再走弹窗：左栏「新建项目」直接建出来并就地改名
            （dsh workspace.create 的语义 —— 只接管，不问片型/时长）。 */}
      </AppShell>
    </TooltipProvider>
  )
}


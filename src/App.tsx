import '@/styles/interface-polish.css'
import '@/styles/card-details.css'
import { useEffect, useState } from 'react'
import { useChat } from '@/shell/useChat'
import { useSessions } from '@/shell/useSessions'
import { useProjects } from '@/shell/useProjects'
import { useAgentTasks } from '@/hooks/useAgentTasks'
import { VIEW_META, type ViewId } from '@/shell/views'
import { AppShell } from '@/shell/AppShell'
import { SettingsScreen } from '@/shell/SettingsScreen'
import { loadSettings, saveSettings, type Settings } from '@/shell/settings-model'
import { Home } from '@/views/Home'
import { Workbench } from '@/views/Workbench'
import { Assets } from '@/views/Assets'
import { ProjectBar, PickProject } from '@/views/ProjectBar'
import { RenderDelivery } from '@/views/RenderDelivery'
import { FxLibrary } from '@/views/FxLibrary'
import { RefLibrary } from '@/views/RefLibrary'
import { Workflow } from '@/views/Workflow'
import { StartCreation } from '@/views/StartCreation'
import { Conversation } from '@/views/Conversation'
import { TooltipProvider } from '@/components/ui/tooltip'

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
  /** 当前项目 —— 项目管理组的每个视图都要它 */
  const current = projects.list.find((p) => p.id === openProject) ?? null
  /* 「返回项目目录」：项目列表页已移除，回「我的创作」（对话视图）。
     保留当前选中项目，便于从对话视图一键回工作台。 */
  const openList = () => { setView('conversation') }
  // 复刻页（项目指挥中心）通过 postMessage 请求跨页导航
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string; projectId?: string } | null
      if (!d) return
      if (d.type !== 'fm-nav' || !d.id) return
      if (d.id === '__list') { openList(); return }
      if (d.id === '__home') { setView('home'); return }
      if (d.projectId) setOpenProject(d.projectId)
      setView(d.id as Parameters<typeof setView>[0])
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  /** 创作启动层（M1）：首页发送后带着草稿打开，null = 关闭
      原型分支：首页发送改走项目对话视图（见 Home 的 onStart），启动层本体保留未删，
      目前没有入口触发它；M1 去留待定案后再统一收口。 */
  const [startDraft, setStartDraft] = useState<string | null>(null)
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
  const chat = useChat()
  const threads = useSessions()

  /** 切视图**不清**项目上下文：项目管理组的子视图（素材/交付）都挂在
      当前项目上；要回列表就走 openList()（项目条上的「全部项目」或总览的返回）。 */
  const go = (v: string) => setView(v as View)
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

        {/* 首页 · 首屏 from home-film-v3
            原型分支：发送后不再开启动层，需求直接作为首条消息进项目对话视图 */}
        {view === 'home' && (
          <div id="pane-home">
            <Home projects={projects.list}
                  onStart={(payload) => {
              /* 发送 → 建一条会话：选了工作目录的会话挂在该目录对应的项目下，
                 没选的落进未分组（之后可拖到项目里） */
              const project = payload.workdir
                ? projects.list.find((p) => p.path === payload.workdir!.path) ?? null
                : null
              /* 只建会话，不往 chat 里再塞一份：会话是唯一来源，
                 对话视图装载时会把它的消息装进 chat。
                 两边都塞会出现两个不同 id 的同一条需求 → 演示回复各排一次 → 回两条。 */
              const s = threads.create({
                firstText: payload.draft,
                projectId: project?.id ?? null,
                workdir: payload.workdir,
                messages: [{ id: `m-${Date.now().toString(36)}`, role: 'user', text: payload.draft, at: Date.now() }],
              })
              if (project) setOpenProject(project.id)
              else setOpenProject(null)
              void s
              setView('conversation')
            }} />
          </div>
        )}

        {/* 项目对话视图 —— 与工作台共用 useChat 会话；
            左栏是「我的项目」（原项目列表页的那份数据），所以这里也是项目入口 */}
        {view === 'conversation' && (
          <div id="pane-conversation">
            <Conversation chat={chat}
                          threads={threads}
                          activeSessionId={threads.activeId}
                          projects={projects.list}
                          onCreateProject={(input) => projects.create(input)}
                          openProject={openProject}
                          onSelectProject={(id) => setOpenProject(id)}
                          /* 左栏直建（dsh workspace.create）：不弹表单，建完在行内改名 */
                          onNewProject={() => {
                            const p = projects.createBlank()
                            setOpenProject(p.id)
                            return p
                          }}
                          onRenameProject={(id, name) => projects.rename(id, name)}
                          onLaunch={handleLaunch}
                          onOpenWorkbench={() => { if (openProject) setView('production') }} />
          </div>
        )}

        {/* 制作工作台 · 二级：三栏工作台 */}
        {isFlow && (
          <div id="pane-flow">
            <Workbench key={openProject!} chat={chat} tasks={tasks} onNavigate={(next) => setView(next)}
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

        {/* 其余视图（对话视图已在上面单独分发） */}
        {!isFlow && !isCatalog && view !== 'conversation' && (
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
              {/* 创作资产是例外：既可作为项目内的上下文视图，
                  也可作为不带项目过滤的全局入口 */}
              {isSub && view === 'assets' && <Assets projectName={current?.name} />}
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


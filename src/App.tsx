import { useEffect, useState } from 'react'
import { useChat } from '@/shell/useChat'
import { useProjects } from '@/shell/useProjects'
import { useAgentTasks } from '@/hooks/useAgentTasks'
import { VIEW_META, type ViewId } from '@/shell/views'
import { SidebarNav, SidebarFooter } from '@/shell/SidebarNav'
import { SettingsDialog, DEFAULT_SETTINGS, type Settings } from '@/shell/SettingsDialog'
import { Home } from '@/views/Home'
import { Workbench } from '@/views/Workbench'
import { WorkbenchCatalog } from '@/views/WorkbenchCatalog'
import { Assets } from '@/views/Assets'
import { ProjectOverview, ProjectBar, PickProject } from '@/views/ProjectOverview'
import { NewProjectDialog } from '@/shell/NewProjectDialog'
import { ScriptVoice } from '@/views/ScriptVoice'
import { AudioTime } from '@/views/AudioTime'
import { RenderDelivery } from '@/views/RenderDelivery'
import { FxLibrary } from '@/views/FxLibrary'
import { RefLibrary } from '@/views/RefLibrary'
import { KnowledgeSources } from '@/views/KnowledgeSources'
import { RuleCases } from '@/views/RuleCases'
import { WorkflowGallery } from '@/views/WorkflowGallery'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * 应用外壳 —— 结构对应 paba.tv 的 #app：
 *
 *   #app
 *   ├── <nav class="tabbar">        顶部标签栏
 *   ├── <aside id="hm-sidebar">     68px 图标轨（悬停出展开按钮 → 216px）
 *   ├── <div id="pane-home">        首页
 *   ├── <div id="pane-flow">        工作台
 *   └── <main id="pane-*">          其余视图
 *
 * 导航内容来自 shell/views.ts，不在这里硬编码。
 */

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`/assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

type View = ViewId

/** 顶栏标签（paba 的 .tabbar）：只放最常用的几个 */
const TABS: Array<{ id: View; label: string; icon: string }> = [
  { id: 'home',       label: '首页',   icon: 'house' },
  { id: 'production', label: '工作台', icon: 'clapperboard' },
  { id: 'assets',     label: '素材',   icon: 'image' },
  { id: 'knowledge',  label: '特效',   icon: 'panels-top-left' },
  { id: 'render',     label: '交付',   icon: 'upload' },
]

export default function App() {
  /** 开发调试入口：?view=production&project=token 直接进工作台；普通访问不变。 */
  const initialQuery = new URLSearchParams(window.location.search)
  const initialView = initialQuery.get('view') as View | null
  const [view, setView] = useState<View>(initialView && initialView in VIEW_META ? initialView : 'home')
  /**
   * 制作工作台是**两级**的：
   *   null      → 一级：项目目录（铺满页面）
   *   '<id>'    → 二级：该项目的工作台
   * 用独立的 openProject 而不是复用 view，因为「目录」和「工作台」
   * 共用一个 ViewId（production），但页面完全不同。
   */
  const [openProject, setOpenProject] = useState<string | null>(initialQuery.get('project'))
  /** 新建项目对话卡（演示：只在内存里建，不落盘） */
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const tasks = useAgentTasks()
  const projects = useProjects()
  /** 当前项目 —— 项目管理组的每个视图都要它 */
  const current = projects.list.find((p) => p.id === openProject) ?? null
  const openList = () => { setOpenProject(null); setView('project') }
  // 复刻页（项目指挥中心 / 时序校验）通过 postMessage 请求跨页导航
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string } | null
      if (!d) return
      if (d.type === 'fm-audio-back') { openList(); return } // 时序校验复刻页的返回键
      if (d.type !== 'fm-nav' || !d.id) return
      if (d.id === '__list') { openList(); return }
      if (d.id === '__home') { setView('home'); return }
      setView(d.id as Parameters<typeof setView>[0])
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem('fengmotion:theme')
    return saved === 'dark' || saved === 'light' || saved === 'tactile'
      ? { ...DEFAULT_SETTINGS, theme: saved }
      : DEFAULT_SETTINGS
  })
  const chat = useChat()

  /** 切视图**不清**项目上下文：项目管理组的子视图（素材/脚本/音频/渲染）都挂在
      当前项目上；要回列表就走 openList()（项目条上的「全部项目」或总览的返回）。 */
  const go = (v: string) => setView(v as View)
  const toggleNav = () => document.body.classList.toggle('hm-nav-expanded')

  /**
   * paba 的真实做法（源码 HM["select"]）：
   *   body.classList.toggle('studio-shell', ['home','video','image','audio','objects'].includes(view))
   *
   * ⚠️ 侧栏与主区的大量尺寸规则挂在 `body.studio-shell` 下；
   *    首页纸片样式挂在 `body.homeon` 下。不加这两个类，布局会塌。
   */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme)
    try { localStorage.setItem('fengmotion:theme', settings.theme) } catch { /* local-only */ }
    document.body.classList.add('studio-shell')   // 本产品所有视图都在 shell 内
    document.body.classList.toggle('flowon', view === 'production')
  }, [view, settings.theme])

  /** 制作工作台：必须有当前项目（列表已归项目管理，这里不再兼当目录） */
  const isFlow = view === 'production' && current !== null
  /** 项目列表：制作工作台没项目时、项目总览没项目时，都落到它 */
  const isCatalog = (view === 'production' || view === 'project') && current === null
  /** 项目这一层：总览 / 四个子视图 */
  const isOverview = view === 'project' && current !== null
  const SUB_VIEWS = ['assets', 'script', 'audio', 'render']
  const isSub = SUB_VIEWS.includes(view as string)

  return (
    <TooltipProvider delayDuration={300}>
      <div id="app">
        {/* 顶栏标签（paba .tabbar）*/}
        <nav className="tabbar" aria-label="创作视图">
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className="tab" type="button"
                      aria-pressed={view === t.id}
                      onClick={() => go(t.id)}>
                <Icon name={t.icon} />{t.label}
              </button>
            ))}
          </div>
        </nav>

        {/* 侧栏（paba #hm-sidebar，默认 68px 图标轨）*/}
        <aside className="hm-sidebar" id="hm-sidebar" aria-label="主导航">
          <div className="hm-sidebar-head">
            <a className="hm-brand" href="#project" aria-label="FengMotion 项目"
               onClick={(e) => { e.preventDefault(); go('project') }}>
              <span className="hm-brand-mark">
                <img src="/assets/brand/fengmotion-mark.png" alt="" width={26} height={26} />
              </span>
              <span className="hm-brand-word app-brand-logo">
                <img src="/assets/brand/fengmotion-word.png" alt="FengMotion" style={{ height: 14, width: "auto" }} />
              </span>
            </a>
            <button className="hm-sidebar-toggle" id="hm-sidebar-toggle" type="button"
                    aria-label="展开边栏" aria-expanded={false} onClick={toggleNav}>
              <Icon name="panel-left-open" className="ui-icon hm-icon-open" />
              <Icon name="panel-left-close" className="ui-icon hm-icon-close" />
            </button>
          </div>

          <SidebarNav current={view as ViewId} onNavigate={(id) => go(id)} />

          <SidebarFooter onOpenSettings={() => setSettingsOpen(true)} theme={settings.theme}
                       onThemeChange={(theme) => {
                         document.documentElement.classList.add('theme-switching')
                         setSettings((prev) => ({ ...prev, theme }))
                         window.setTimeout(() => document.documentElement.classList.remove('theme-switching'), 320)
                       }} />
        </aside>

        {/* 项目列表（一级）—— 「列表 → 项目 → 子视图」的第一层 */}
        {isCatalog && (
          <main id="pane-project" className="hm-main">
            <WorkbenchCatalog projects={projects.list}
                              onOpen={(id) => { setOpenProject(id); setView('project') }}
                              onNew={() => setNewProjectOpen(true)}
                              onRename={projects.rename}
                              onRemove={(id) => { projects.remove(id); if (id === openProject) openList() }} />
          </main>
        )}

        {/* 项目指挥中心（二级）—— 顶栏由复刻页自带（callour-studio v2 整包挂载） */}
        {isOverview && current && (
          <main id="pane-project" className="hm-main">
            <div className="hm-content" data-view="project">
              <ProjectOverview project={current} records={tasks.records}
                               onBack={openList}
                               onOpenView={(id) => go(id)}
                               onOpenWorkbench={() => setView('production')} />
            </div>
          </main>
        )}

        {/* 首页 · 首屏 from home-film-v3 */}
        {view === 'home' && (
          <div id="pane-home">
            <Home />
          </div>
        )}

        {/* 制作工作台 · 二级：三栏工作台 */}
        {isFlow && (
          <div id="pane-flow">
            <Workbench chat={chat} tasks={tasks} onNavigate={(next) => setView(next)}
                       projectId={openProject!}
                       onBack={openList}
                       onSwitchProject={(id) => setOpenProject(id)} />
          </div>
        )}

        {/* 其余视图 */}
        {!isFlow && !isCatalog && (
          <>
            {/* 项目指挥中心 / 创作资产 / 时序校验 / 工作流广场：全幅复刻页，这层标题栏不渲染 */}
            {view !== 'home' && view !== 'project' && view !== 'assets' && view !== 'audio' && view !== 'methods' && view !== 'knowledge' && view !== 'reference' && (
            <header className="app-header">
              <span className="logo">
                <img src="/assets/brand/fengmotion-mark.png" alt="" width={22} height={22} />
              </span>
              <h1>{VIEW_META[view as ViewId].title}</h1>
              <span className="spacer" />
              <span className="chip"><span className="dot off" />Agent 未连接</span>
              <button className="iconbtn" type="button" title="返回项目" onClick={() => go('project')}>
                <Icon name="house" />
              </button>
            </header>
            )}
            <div id={`pane-${view}`} className="hm-main">
              <div className="hm-content" data-view={view}>
                {/* 项目管理组的视图都挂在当前项目上：顶上先给一条项目条
                    （创作资产 / 时序校验 = 全幅复刻页，无项目条） */}
                {isSub && current && view !== 'assets' && view !== 'audio' && (
                  <ProjectBar project={current} view={view}
                              onNav={(id) => go(id)} onBack={openList}
                              onOpenWorkbench={() => setView('production')} />
                )}
                {isSub && !current && view !== 'assets' && view !== 'audio' && (
                  <PickProject onBack={openList} />
                )}
                {/* 创作资产 / 时序校验是例外：既可作为项目内的上下文视图，
                    也可作为不带项目过滤的全局入口 */}
                {isSub && view === 'assets' && <Assets projectName={current?.name} />}
                {isSub && view === 'audio' && <AudioTime projectName={current?.name} />}
                {isSub && current && view === 'script' && <ScriptVoice project={current} />}
                {isSub && current && view === 'render' && (
                  <RenderDelivery project={current} tasks={tasks} />
                )}
                {view === 'sources' && <KnowledgeSources onOpen={go} />}
                {view === 'knowledge' && <FxLibrary />}
                {view === 'reference' && <RefLibrary />}
                {view === 'rules' && <RuleCases />}
                {view === 'methods' && <WorkflowGallery />}
              </div>
            </div>
          </>
        )}
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)}
                        settings={settings} onChange={setSettings} />

        {/* 新建项目 —— 建完直接落在它的总览页（列表 → 项目） */}
        <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)}
                          onCreate={(input) => {
                            const p = projects.create(input)
                            setNewProjectOpen(false)
                            setOpenProject(p.id)
                            setView('project')
                            return p
                          }} />
      </div>
    </TooltipProvider>
  )
}


import { useMemo, useRef, useState } from 'react'
import {
  AlertCircle, ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Check,
  ChevronDown, ChevronLeft, Clock3, FileCode2, FolderOpen, History, LoaderCircle, Maximize2,
  PanelBottom, Pause, Play, Plus, RotateCcw, Send, Settings2,
  SkipBack, SkipForward, Square, Volume2, X,
} from 'lucide-react'
import { ACTIVE_SCENES, SCENES } from '@/data/projectModel'
import { PROJECTS } from '@/data/projects'
import type { StoryboardEntry } from '@/data/projectModel'
import { ACTIVE_DURATION, FILM_FPS } from '@/data/timeline'
import { useAgentTasks, type TaskRecord } from '@/hooks/useAgentTasks'
import type { AgentTask, ModificationConstraints, ProjectVersion, TaskRequest } from '@/services/studioApi'
import { studioAdapter } from '@/services/studioAdapter'
import type { ChatState } from '@/shell/useChat'
import { statusOf } from '@/shell/status'
import { cn } from '@/lib/utils'
import { FilmPlayer, type PlayerRef } from '@/remotion/FilmPlayer'
import { StoryTimeline } from '@/views/StoryTimeline'
import type { ViewId } from '@/shell/views'

/**
 * 制作工作台 · 二级 —— 三栏工具面板
 *
 * ⚠️ 这一层用 **paba 的工作台语言**（.wb-* / .fw-* / .mini），
 *    不是首页那套纸层（.hm-* / --ht-*）。
 *    paba 自己就分两套：
 *      首页    .hm-*      纸 + 墨（--ht-*）—— 24px 纸片、胶囊、阴影
 *      工作台  .wb-/.fw-  工具面板（--surf/--hole/--line）—— 平、密、6px 圆角
 *    工作台要能长时间盯着干活，所以**不用纸、不用大圆角、不用阴影**。
 *
 * 三栏：镜头列表（.fw-ing）/ 监看器（.fw-canvas）/ 对话设置（.fw-bar）
 */

/** 项目里实际存在的那份成片。演示适配器不改它，只播放/下载。 */
const EXISTING_FILM_SOURCE = '/media/token-full-legacy.mp4'

const quickActions = [
  { id: 'undo', label: '撤销', icon: RotateCcw, prompt: '撤销上一次修改。' },
  { id: 'redo', label: '重做', icon: RotateCcw, prompt: '重做上一次修改。' },
  { id: 'compare', label: '对比版本', icon: ArrowLeftRight, compare: true },
  { id: 'camera', label: '锁定运镜', icon: Settings2, constraint: 'preserveCamera' as const },
  { id: 'captions', label: '保留字幕', icon: Check, constraint: 'preserveCaptions' as const },
  { id: 'assets', label: '替换素材', icon: Plus, constraint: 'attachment' as const },
  { id: 'duration', label: '调整时长', icon: Clock3, prompt: '调整当前镜头时长。请先询问目标时长。' },
  { id: 'resolution', label: '修改分辨率', icon: Settings2, prompt: '调整项目分辨率。请先询问目标分辨率。' },
  { id: 'regenerate', label: '重做当前镜头', icon: ArrowUpRight, prompt: '重新生成当前镜头，保留现有镜头运动和字幕。' },
]

interface WorkbenchProps {
  chat: ChatState
  /** 任务记录（含执行过程）—— 由 App 注入：总览页的「任务活动」读的是同一份 */
  tasks: ReturnType<typeof useAgentTasks>
  onNavigate: (view: ViewId) => void
  /** 当前打开的项目 id —— 由一级目录传入 */
  projectId: string
  /** 返回项目列表 */
  onBack: () => void
  /** 换一个项目（工作台里直接切，不用先回列表） */
  onSwitchProject: (id: string) => void
}

export function Workbench({ chat, tasks, onNavigate, projectId, onBack, onSwitchProject }: WorkbenchProps) {
  const playerRef = useRef<PlayerRef | null>(null)
  /** 打开的哪个项目 —— 从一级目录传下来的 id 解析 */
  const project = PROJECTS.find((p) => p.id === projectId) ?? PROJECTS[0]
  const [selectedId, setSelectedId] = useState('s01')
  const [selectedStoryboardId, setSelectedStoryboardId] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)
  const [playerReady, setPlayerReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [previewRate, setPreviewRate] = useState(1)
  const [scope, setScope] = useState<'project'|'scene'|'selection'>('scene')
  const [constraints, setConstraints] = useState<ModificationConstraints>({
    preserveCamera: true, preserveCaptions: true, limitToSelection: true, reuseExistingComponents: true,
  })
  const [sideTab, setSideTab] = useState<'chat'|'settings'>('chat')
  const [bottomTab, setBottomTab] = useState<'activity'|'changes'|'versions'>('activity')
  const [trayOpen, setTrayOpen] = useState(false)
  const [compare, setCompare] = useState(false)
  const [compareSplit, setCompareSplit] = useState(50)
  const [railOpen, setRailOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [switchOpen, setSwitchOpen] = useState(false)
  const selectedScene = useMemo(() => SCENES.find((s) => s.id === selectedId) ?? SCENES[0], [selectedId])
  const storyboard = selectedStoryboardId && selectedScene.storyboard?.段 !== selectedStoryboardId
    ? null : selectedScene.storyboard
  const selectedVersion = studioAdapter.versions()[0]
  const totalFrames = Math.round(ACTIVE_DURATION * FILM_FPS)

  const selectScene = (id: string, storyboardId?: string | null) => {
    setSelectedId(id)
    setSelectedStoryboardId(storyboardId ?? null)
    const clip = ACTIVE_SCENES.find((item) => item.id === id)
    if (clip) seek(clip.startFrame)
    setRailOpen(false)                    // 窄屏选完就收起抽屉
  }
  const seek = (nextFrame: number) => {
    const next = Math.max(0, Math.min(totalFrames - 1, Math.round(nextFrame)))
    playerRef.current?.seekTo(next)
    setFrame(next)
    const clip = [...ACTIVE_SCENES].reverse().find((item) => next / FILM_FPS >= item.start)
    if (clip) { setSelectedId(clip.id); setSelectedStoryboardId(clip.storyboardId) }
  }
  const submit = (prompt: string, kind: TaskRequest['kind'] = 'modify') => {
    const request: TaskRequest = { kind, prompt, scope, sceneIds: scope === 'project' ? [] : [selectedId], constraints, attachments: [] }
    const id = tasks.start(request)
    chat.addUserMessage(prompt, id)
    setBottomTab('activity')
    setTrayOpen(true)
  }
  const runQuickAction = (action: (typeof quickActions)[number]) => {
    if (action.compare) { setCompare((v) => !v); return }
    if (action.constraint === 'attachment') { setNotice('演示模式：素材上传未连接。'); return }
    if (action.constraint) {
      const enabled = !constraints[action.constraint]
      setConstraints((old) => ({ ...old, [action.constraint as keyof ModificationConstraints]: enabled }))
      submit(`快捷约束：${action.label}（${enabled ? '开启' : '关闭'}）`)
      return
    }
    if (action.id === 'undo' || action.id === 'redo') {
      setNotice('演示适配器没有改动源文件；没有可撤销或重做的真实修改。')
      return
    }
    if (action.prompt) submit(action.prompt)
  }
  const playToggle = () => {
    if (playing) playerRef.current?.pause()
    else playerRef.current?.play()
    setPlaying((v) => !v)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-fg">

      {/* ═══ 顶栏（paba .wb-projectbar）═════════════════════════
          左：返回 + 项目；右：撤销/重做 + 历史 + 导出 */}
      <div className="wb-projectbar">
        <button className="iconbtn" type="button" title="返回项目目录" onClick={onBack}>
          <ChevronLeft className="size-4" />
        </button>
        <button className="mini fw-mobile" type="button" title="镜头列表"
                onClick={() => setRailOpen((v) => !v)}>
          <PanelBottom className="size-3.5" />
        </button>
        {/* 项目切换器：这是个真控件（原来是个只有一个 option 的假 select） */}
        <div className="wb-switch" data-open={switchOpen ? '' : undefined}>
          <button className="wb-switch-btn" type="button"
                  aria-expanded={switchOpen} aria-haspopup="menu"
                  onClick={() => setSwitchOpen((v) => !v)}>
            <span className="truncate">{project.name}</span>
            <ChevronDown className="wb-caret" />
          </button>
          {switchOpen && (
            <div className="wb-switch-menu" role="menu"
                 onPointerLeave={() => setSwitchOpen(false)}>
              {PROJECTS.map((p) => (
                <button key={p.id} type="button" role="menuitem"
                        aria-current={p.id === project.id ? 'true' : undefined}
                        onClick={() => { setSwitchOpen(false); if (p.id !== project.id) onSwitchProject(p.id) }}>
                  <span className="truncate">{p.name}</span>
                  <em className="num">{p.doneClips}/{p.totalClips} 镜</em>
                </button>
              ))}
              <button type="button" role="menuitem" className="wb-switch-all"
                      onClick={() => { setSwitchOpen(false); onBack() }}>
                <FolderOpen className="size-3.5" />全部项目
              </button>
            </div>
          )}
        </div>
        <span className="chip"><span className="dot off" />Agent 未连接</span>
        <span className="spacer" />
        <button className="iconbtn" type="button" title="撤销 (Ctrl+Z)"
                onClick={() => runQuickAction(quickActions[0])}>
          <RotateCcw />
        </button>
        <button className="iconbtn" type="button" title="重做 (Ctrl+Shift+Z)"
                onClick={() => runQuickAction(quickActions[1])}>
          <RotateCcw className="scale-x-[-1]" />
        </button>
        <button className="mini" type="button" onClick={() => { setBottomTab('versions'); setTrayOpen(true) }}>
          <History className="size-3.5" /><span>生成历史</span>
        </button>
        <button className="mini mini-strong" type="button" disabled={!playerReady}
                onClick={() => {
                  const a = document.createElement('a')
                  a.href = EXISTING_FILM_SOURCE; a.download = 'token-full-legacy.mp4'; a.click()
                  setNotice('下载现有本地影片；没有启动新渲染。')
                }}>
          <ArrowDownToLine className="size-3.5" /><span>导出成片</span>
        </button>
      </div>

      {/* ═══ 三栏（paba .fw 网格）══════════════════════════════ */}
      <div className="fw relative">
        {railOpen && <button className="fw-scrim" aria-label="收起镜头列表" onClick={() => setRailOpen(false)} />}

        <ProjectRail selectedId={selectedId} onSelect={selectScene} projectName={project.name}
                     open={railOpen} onClose={() => setRailOpen(false)} />

        {/* 中栏：监看器 */}
        <main className="fw-canvas">
          <div className="fw-toolbar">
            <h2 className="num">{selectedId.toUpperCase()}</h2>
            <span className="t-title truncate">{selectedScene.label}</span>
            {storyboard && <span className="fw-count">V3 段 {storyboard.段}</span>}
            {!selectedScene.inTimeline && <span className="chip"><span className="dot warn" />未排入剪辑</span>}
            <span className="spacer" />
          </div>

          {/* 舞台：paba .fw-stage */}
          <div className="fw-stage">
            {!compare ? (
              <FilmPlayer onPlayer={(p) => { playerRef.current = p }} onFrame={setFrame} onReady={setPlayerReady} />
            ) : (
              <div className="relative flex size-full overflow-hidden bg-black">
                <div className="relative h-full overflow-hidden" style={{ width: `${compareSplit}%` }}>
                  <img src={selectedScene.frame ?? '/frames/u01.jpg'} alt="项目抽帧"
                       className="absolute inset-0 size-full object-contain" />
                  <span className="absolute left-2 top-2 bg-black/75 px-1.5 py-1 text-[10px]">已存抽帧</span>
                </div>
                <div className="relative h-full flex-1 overflow-hidden border-l border-acc">
                  <FilmPlayer onPlayer={(p) => { playerRef.current = p }} onFrame={setFrame} onReady={setPlayerReady} />
                  <span className="absolute left-2 top-2 z-10 bg-black/75 px-1.5 py-1 text-[10px]">当前影片</span>
                </div>
                <input aria-label="调整对比画面分割" type="range" min={25} max={75} value={compareSplit}
                       onChange={(e) => setCompareSplit(Number(e.target.value))}
                       className="absolute bottom-2 left-2 z-20 w-[calc(100%-16px)] accent-[var(--acc)]" />
              </div>
            )}
            {!playerReady && (
              <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-md border border-warn/30 bg-surf px-2 py-1 text-[11px] text-warn">
                <LoaderCircle className="size-3 animate-spin" />正在加载项目影片
              </div>
            )}
            {notice && (
              <button className="absolute bottom-3 right-3 z-20 max-w-[75%] rounded-md border border-warn/30 bg-surf px-2 py-1 text-[10px] text-warn"
                      onClick={() => setNotice('')}>
                {notice}<X className="ml-1 inline size-3" />
              </button>
            )}
          </div>

          <PlayerBar playerRef={playerRef} frame={frame} onSeek={seek} playing={playing}
                     onToggle={playToggle} rate={previewRate} onRate={setPreviewRate} totalFrames={totalFrames} />

          <div className="tl-wrap">
            <StoryTimeline selectedId={selectedId} onSelect={selectScene} activeFrame={frame} onSeek={seek} />
          </div>

          <div className="fw-subbar">
            <button className="mini" type="button" onClick={() => setTrayOpen((v) => !v)}>
              <PanelBottom className="size-3" />{trayOpen ? '收起任务面板' : '展开任务面板'}
            </button>
            <span className="hint">
              {tasks.active?.task.title ?? '没有正在执行的任务'}
            </span>
          </div>

          {trayOpen && (
            <BottomTray records={tasks.records} activeId={tasks.active?.task.id ?? null}
                        onCancel={tasks.cancel} tab={bottomTab} setTab={setBottomTab} />
          )}
        </main>

        {/* 右栏：对话 / 设置 */}
        <RightPanel chat={chat} sideTab={sideTab} setSideTab={setSideTab}
                    scope={scope} setScope={setScope} selectedId={selectedId}
                    scene={selectedScene} storyboard={storyboard}
                    constraints={constraints} setConstraints={setConstraints}
                    activeTask={tasks.active?.task ?? null} cancelTask={tasks.cancel}
                    records={tasks.records} onSubmit={submit} onQuickAction={runQuickAction}
                    onNavigate={onNavigate} selectedVersion={selectedVersion} />
      </div>
    </div>
  )
}

/* ── 左栏：镜头列表（paba .fw-ing）────────────────────────── */
function ProjectRail({ selectedId, onSelect, projectName, open, onClose }:
  { selectedId: string; onSelect: (id: string, storyboardId?: string | null) => void
    projectName: string; open: boolean; onClose: () => void }) {
  const acts = [...new Set(ACTIVE_SCENES.map((s) => s.scene?.storyboard?.幕 ?? (s.storyboardId ? 'V3 草稿' : '当前剪辑')))]
  return (
    <aside className="fw-ing" data-open={open ? '' : undefined} aria-label="镜头列表">
      <div className="fw-ing-hd">
        <h2>镜头列表</h2>
        <span className="fw-count">{ACTIVE_SCENES.length} 镜</span>
        <span className="spacer" />
        <button className="iconbtn fw-mobile" type="button" title="收起" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>

      <div className="fw-ing-list">
        {acts.map((act) => {
          const list = ACTIVE_SCENES.filter((s) => (s.scene?.storyboard?.幕 ?? (s.storyboardId ? 'V3 草稿' : '当前剪辑')) === act)
          return (
            <section key={act}>
              <div className="fw-scene-hd" style={{ margin: '10px 0 4px' }}>
                <span>{act}</span>
                <span className="spacer" />
                <span className="hint num">{list.length}</span>
              </div>
              {list.map((scene) => {
                const sel = scene.id === selectedId
                const state = statusOf(scene.status)
                return (
                  <button key={`${scene.id}-${scene.start}`} type="button"
                          onClick={() => onSelect(scene.id, scene.storyboardId)}
                          aria-current={sel ? 'true' : undefined}
                          className="fm-unit" style={{ marginBottom: 2 }}>
                    <span className="fm-unit-frame">
                      {scene.frame
                        ? <img src={scene.frame} alt="" loading="lazy" />
                        : <span className="grid size-full place-items-center text-[10px] text-dim">无帧</span>}
                    </span>
                    <span className="fm-unit-body">
                      <b className={cn(sel && 'text-acc')}>{scene.title}</b>
                      <span>
                        <span>{scene.id}</span>
                        <span>{scene.start.toFixed(1)}–{(scene.start + scene.duration).toFixed(1)}s</span>
                      </span>
                    </span>
                    {/* 状态：正常态安静一个点，异常态必须带文字（shell/status.ts 是唯一来源） */}
                    {state.s === 'done'
                      ? <span className="fm-dot" data-s="done" title={state.label} />
                      : <span className="fm-tag" data-s={state.s}>{state.label}</span>}
                  </button>
                )
              })}
            </section>
          )
        })}
      </div>

      <div className="fw-ing-footer">{projectName}</div>
    </aside>
  )
}

/* ── 播放条 ─────────────────────────────────────────────────── */
function PlayerBar({ playerRef, frame, onSeek, playing, onToggle, rate, onRate, totalFrames }:
  { playerRef: React.RefObject<PlayerRef | null>; frame: number; onSeek: (n: number) => void
    playing: boolean; onToggle: () => void; rate: number; onRate: (n: number) => void; totalFrames: number }) {
  return (
    <div className="fw-playbar">
      <button className="iconbtn" type="button" title="上一帧" onClick={() => onSeek(frame - 1)}><SkipBack /></button>
      <button className="iconbtn" type="button" title={playing ? '暂停' : '播放'} onClick={onToggle}>
        {playing ? <Pause /> : <Play />}
      </button>
      <button className="iconbtn" type="button" title="下一帧" onClick={() => onSeek(frame + 1)}><SkipForward /></button>
      <span className="time">
        {formatTime(frame / 30)} / {formatTime(ACTIVE_DURATION)}
      </span>
      {/* paba .nc-pp-range —— 填充用 --acc，不是 shadcn 的圆头灰轨 */}
      <div className="pp-range">
        <input type="range" min={0} max={totalFrames - 1} step={1} value={frame}
               aria-label="播放进度"
               style={{ '--fill': `${(frame / Math.max(1, totalFrames - 1)) * 100}%` } as React.CSSProperties}
               onChange={(e) => onSeek(Number(e.target.value))} />
      </div>
      <div className="fw-zoom">
        <button type="button" disabled={rate <= 0.5} onClick={() => onRate(Math.max(0.5, rate - 0.5))} title="减速">−</button>
        <span className="num w-9 text-center">{rate}×</span>
        <button type="button" disabled={rate >= 2} onClick={() => onRate(Math.min(2, rate + 0.5))} title="加速">+</button>
      </div>
      <button className="iconbtn" type="button" title="切换静音"
              onClick={() => { const p = playerRef.current; if (p) p.setVolume(p.getVolume() ? 0 : 1) }}>
        <Volume2 />
      </button>
      <button className="iconbtn" type="button" title="全屏"
              onClick={() => playerRef.current?.requestFullscreen()}><Maximize2 /></button>
    </div>
  )
}

/* ── 右栏：对话 / 修改设置 ──────────────────────────────────── */
function RightPanel({ chat, sideTab, setSideTab, scope, setScope, selectedId, scene, storyboard,
  constraints, setConstraints, activeTask, cancelTask, records, onSubmit, onQuickAction,
  onNavigate, selectedVersion }:
  { chat: ChatState; sideTab: 'chat'|'settings'; setSideTab: (v: 'chat'|'settings') => void
    scope: 'project'|'scene'|'selection'; setScope: (v: 'project'|'scene'|'selection') => void
    selectedId: string; scene: (typeof SCENES)[number]; storyboard: StoryboardEntry | null
    constraints: ModificationConstraints
    setConstraints: React.Dispatch<React.SetStateAction<ModificationConstraints>>
    activeTask: AgentTask | null; cancelTask: (id: string) => void; records: TaskRecord[]
    onSubmit: (p: string) => void; onQuickAction: (a: (typeof quickActions)[number]) => void
    onNavigate: (v: ViewId) => void; selectedVersion: ProjectVersion }) {
  const submit = () => { const v = chat.draft.trim(); if (v) { onSubmit(v); chat.setDraft('') } }

  return (
    <aside className="fw-panel" aria-label="AI 对话">
      <div className="fw-ing-hd" style={{ padding: '0 14px' }}>
        <button className="mini h-7" type="button" aria-pressed={sideTab === 'chat'}
                onClick={() => setSideTab('chat')}>AI 对话</button>
        <button className="mini h-7" type="button" aria-pressed={sideTab === 'settings'}
                onClick={() => setSideTab('settings')}>修改设置</button>
        <span className="spacer" />
        <span className="chip"><span className="dot warn" />演示</span>
      </div>

      {sideTab === 'chat' ? (
        <>
          <div className="fw-scroll">
            <div className="flex flex-col gap-3 p-3.5">
              {/* 上下文条（paba .fw-ctx）：你在改哪一镜 */}
              <div className="fw-ctx">
                {scene.frame && <img src={scene.frame} alt="" />}
                <div className="min-w-0">
                  <b>{scene.label}</b>
                  <div className="num truncate">{selectedId.toUpperCase()} · 当前镜头</div>
                </div>
              </div>

              {/* 消息：AI 不用气泡，用户用 --soft 底（fm-components §9） */}
              <div className="fw-msg">
                <span className="fw-msg-avatar">AI</span>
                <p className="fm-msg-ai">{chat.messages[0]?.text}</p>
              </div>
              {chat.messages.slice(1).map((m) => (
                m.role === 'user'
                  ? <p key={m.id} className="fm-msg-user">{m.text}</p>
                  : (
                    <div key={m.id} className="fw-msg">
                      <span className="fw-msg-avatar">AI</span>
                      <p className="fm-msg-ai">{m.text}</p>
                    </div>
                  )
              ))}

              {storyboard && (
                <div className="ml-8 rounded-md border border-line bg-hole p-2.5">
                  <div className="text-[10.5px] text-dim">当前段 {storyboard.段} · {storyboard.幕}</div>
                  <div className="mt-1 text-[11.5px] leading-relaxed">{storyboard.旁白}</div>
                  <details className="mt-1 text-[10.5px] text-dim">
                    <summary className="cursor-pointer">查看画面与动效要求</summary>
                    <p className="mt-1">画面：{storyboard.画面}</p>
                    <p className="mt-1">动效：{storyboard.动效}</p>
                    <p className="mt-1">衔接：{storyboard.衔接}</p>
                  </details>
                </div>
              )}

              {activeTask && (
                <div className="ml-8 rounded-md border border-line bg-hole p-2.5">
                  <div className="flex items-center gap-2 text-[11.5px]">
                    <LoaderCircle className="size-3 animate-spin text-acc" />{activeTask.title}
                    <span className="fw-count ml-auto">{activeTask.status}</span>
                  </div>
                  {records.find((r) => r.task.id === activeTask.id)?.events.slice(-3).map((e) => (
                    <div key={e.id} className="mt-1 text-[10.5px] text-dim">{e.message}</div>
                  ))}
                  <button className="mini mt-1.5 h-6 px-2 text-[10.5px]" type="button" onClick={() => cancelTask(activeTask.id)}>
                    <Square className="size-2.5" />停止
                  </button>
                </div>
              )}

              {/* 演示模式：全栏只留这一处说明（原来聊天区还重复了一句） */}
              <div className="fw-demo">
                <AlertCircle className="size-3.5" />
                <div>
                  <b>演示模式</b>
                  <span>提交只模拟队列与状态，不连接 Agent、不改项目文件；接上 Agent 后这里会出真实执行日志。</span>
                </div>
              </div>
            </div>
          </div>

          {/* 对话输入：与首页同一张纸片（.fw-sheet），主按钮是胶囊 */}
          <form className="fw-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
            <div className="fw-sheet">
              <textarea className="wb-input" rows={3}
                        value={chat.draft} onChange={(e) => chat.setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                        placeholder="告诉 AI 要如何修改当前镜头…" />
              <div className="mt-1.5 flex items-center gap-2">
                <button className="iconbtn" type="button" title="素材上传尚未连接" disabled><Plus /></button>
                <span className="flex-1 text-[10.5px] text-dim">
                  作用范围：{scope === 'project' ? '整个项目' : scope === 'scene' ? selectedId : '所选镜头'}
                </span>
                <button className="mini mini-strong" type="submit" disabled={!chat.draft.trim()}>
                  <Send className="size-3" />提交
                </button>
              </div>
            </div>
          </form>
        </>
      ) : (
        <div className="fw-scroll">
          <div className="flex flex-col gap-3 p-3.5">
            <div className="fw-scene-hd">修改作用范围</div>
            <div className="fw-chips">
              {([['scene', `当前镜头 · ${selectedId}`], ['selection', '所选镜头'], ['project', '整个项目']] as const).map(([v, label]) => (
                <button key={v} className="mini h-7 text-[11px]" type="button"
                        onClick={() => setScope(v as typeof scope)}
                        aria-pressed={scope === v}>
                  {label}
                </button>
              ))}
            </div>

            <div className="wb-sep" />
            <div className="fw-scene-hd">保留条件</div>
            {([['preserveCamera', '保留当前运镜'], ['preserveCaptions', '保留字幕与配音'],
               ['limitToSelection', '不修改其他镜头'], ['reuseExistingComponents', '尽量复用现有组件']] as const).map(([key, label]) => (
              <label key={key} className="wb-check">
                <input type="checkbox" checked={constraints[key]}
                       onChange={(e) => setConstraints((c) => ({ ...c, [key]: e.target.checked }))} />
                {label}
              </label>
            ))}

            <div className="wb-sep" />
            <div className="fw-scene-hd">快捷操作</div>
            <div className="grid grid-cols-3 gap-1.5">
              {quickActions.map((a) => (
                <button key={a.id} type="button" onClick={() => onQuickAction(a)}
                        className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-md border border-line bg-hole p-1 text-center text-[10px] text-dim transition-colors hover:border-acc/60 hover:text-fg">
                  <a.icon className="size-3.5" />{a.label}
                </button>
              ))}
            </div>

            <div className="wb-sep" />
            <div className="fw-scene-hd">预览来源</div>
            <div className="rounded-md border border-line bg-hole p-2.5 text-[10.5px] leading-relaxed text-dim">
              播放的是 {selectedVersion.source}（152 秒旧版混合剪辑）。
              Remotion Player 包装真实影片播放；原始可编辑合成仍是 HyperFrames HTML/GSAP。
            </div>
            <button className="mini h-7 justify-start text-[11px]" type="button" onClick={() => onNavigate('render')}>
              <ArrowUpRight className="size-3" />打开渲染与交付
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}

/* ── 底部任务面板 ───────────────────────────────────────────── */
function BottomTray({ records, activeId, onCancel, tab, setTab }:
  { records: TaskRecord[]; activeId: string | null; onCancel: (id: string) => void
    tab: 'activity'|'changes'|'versions'; setTab: (t: 'activity'|'changes'|'versions') => void }) {
  return (
    <div className="fw-tray">
      <div className="fw-tray-hd">
        {(['activity', 'changes', 'versions'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
                  className="mini" aria-pressed={tab === t}>
            {t === 'activity' ? '执行过程' : t === 'changes' ? '代码变更' : '版本记录'}
          </button>
        ))}
        <span className="spacer" />
        <span className="num tray-note">演示数据 · 未连接 Agent</span>
      </div>
      <div className="fw-scroll">
        <div className="fw-tray-body">
          {tab === 'activity' && (records.length === 0
            ? <div className="fw-tray-empty">尚无任务。提交自然语言请求后，这里显示可验证的接受、队列和构建状态事件。</div>
            : <div className="flex flex-col gap-0.5">
                {records.map((r) => (
                  <div key={r.task.id} className="fw-tray-row">
                    <span className="num">{r.task.createdAt}</span>
                    <span className="tray-msg">{r.events.at(-1)?.message ?? r.task.title}</span>
                    <span className="fw-count">{r.task.status}</span>
                    {activeId === r.task.id && (
                      <button className="iconbtn" type="button" title="停止" onClick={() => onCancel(r.task.id)}>
                        <Square className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
          )}
          {tab === 'changes' && (
            <div className="fw-tray-empty">
              <FileCode2 className="size-3 shrink-0" />
              演示适配器未写入代码，因此没有 ChangeSet、diff 或构建结果。接入 Agent API 后显示实际文件变更。
            </div>
          )}
          {tab === 'versions' && (
            <div className="fw-tray-cards">
              {studioAdapter.versions().map((v) => (
                <div key={v.id} className="fw-card">
                  <div className="fw-card-hd">
                    <FileCode2 className="size-3 text-acc" />{v.name}
                  </div>
                  <div className="fw-card-note">{v.summary}</div>
                  <div className="num fw-card-src">{v.source}</div>
                  <button className="mini mini-s" type="button"
                          disabled={!v.restorable} title="当前来源只读，未连接版本后端">
                    {v.restorable ? '恢复版本' : '只读来源'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60); const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

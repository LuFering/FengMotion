/**
 * 项目指挥中心 —— 用户提供的复刻工程（callour-studio v2）整包挂载。
 *
 * 复刻是独立 Vite 工程（Remotion Player + 绝对定位画布 1440×827），
 * 构建产物在 public/replica/callour/（vite build --base=/replica/callour/），
 * 本组件用 iframe 原样装载并等比缩放居中适配；顶栏由复刻页自带，
 * 左侧 Agent 状态芯片由壳层职责移入复刻页顶栏。
 *
 * 数据边界：复刻页当前仍是其示范内容（Callour Studio / Key Scenes 及示例图）；
 * 下一阶段把其中数据换成 FengMotion 真实项目数据（UNITS / 分镜备注）。
 */
import { useState } from 'react'
import { PROJECT_SUBVIEWS, STAGE_LABEL, type ProjectSummary } from '@/data/projects'
import type { TaskRecord } from '@/hooks/useAgentTasks'

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

export function ProjectOverview(_props: {
  project: ProjectSummary
  records: TaskRecord[]
  onBack: () => void
  onOpenView: (id: string) => void
  onOpenWorkbench: () => void
}) {
  // Round 1：与 RenderDelivery 同一壳层问题，iframe onLoad 前盖骨架提示。
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="acr" style={{ background: '#000801', overflow: 'hidden' }}>
      {!loaded && (
        <div className="acr-loading" role="status" aria-live="polite">
          <span className="acr-loading-spin" aria-hidden="true" />
          正在加载项目指挥中心…
        </div>
      )}
      <iframe
        className="acr-frame"
        src="./replica/callour/index.html"
        title="项目指挥中心"
        style={{ width: '100%', height: '100%', borderRadius: 0, background: '#000801' }}
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}

export function ProjectBar({ project: p, view, onNav, onBack, onOpenWorkbench }: {
  project: ProjectSummary
  view: string
  onNav: (id: string) => void
  onBack: () => void
  onOpenWorkbench: () => void
}) {
  return (
    <div className="pj-bar">
      <button className="pj-bar-back" type="button" onClick={onBack} title="回项目列表">
        <Icon name="folder-open" />全部项目
      </button>
      <button className="pj-bar-name" type="button" onClick={() => onNav('project')} title="回项目指挥中心">
        {p.name}
      </button>
      <span className="pj-stage" data-s={p.stage}>{STAGE_LABEL[p.stage]}</span>
      <span className="spacer" />
      <nav className="pj-tabs" aria-label="项目子视图">
        <button type="button" aria-pressed={view === 'project'}
                onClick={() => onNav('project')}>项目指挥中心</button>
        {PROJECT_SUBVIEWS.map((v) => (
          <button key={v.id} type="button" aria-pressed={view === v.id}
                  onClick={() => onNav(v.id)}>
            {v.label}{v.state === 'todo' && <i title="未实现">·</i>}
          </button>
        ))}
      </nav>
      <span className="chip"><span className="dot off" />Agent 未连接</span>
      <button className="mini" type="button" onClick={onOpenWorkbench} disabled={!!p.planned}>
        <Icon name="clapperboard" />进工作台
      </button>
    </div>
  )
}

/** 没有项目时的兜底：项目管理组里的子视图都要"当前项目" */
export function PickProject({ onBack }: { onBack: () => void }) {
  return (
    <div className="pj-pick">
      <Icon name="folder-open" />
      <h2>先选一个项目</h2>
      <p>这几个视图都是"某个项目的"素材 / 脚本 / 音频 / 渲染 —— 从项目列表里挑一个再进来。</p>
      <button className="mini mini-strong" type="button" onClick={onBack}>去项目列表</button>
    </div>
  )
}

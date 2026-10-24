/**
 * 项目条 —— 项目下的子视图（素材 / 交付）共用的一行导航。
 *
 * 原先这里还有「项目指挥中心」（callour-studio v2 复刻页整包 iframe 挂载），
 * 作者看过之后判定没用，已删除；项目列表也移进了创作对话的左栏。
 * 现在项目条只保留：回全部项目 / 当前项目名与阶段 / 子视图切换 / Agent 状态 / 进工作台。
 */
import { PROJECT_SUBVIEWS, STAGE_LABEL, type ProjectSummary } from '@/data/projects'

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
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
      <button className="pj-bar-back" type="button" onClick={onBack} title="回全部项目">
        <Icon name="folder-open" />全部项目
      </button>
      <span className="pj-bar-name" title={p.name}>{p.name}</span>
      <span className="pj-stage" data-s={p.stage}>{STAGE_LABEL[p.stage]}</span>
      <span className="spacer" />
      <nav className="pj-tabs" aria-label="项目子视图">
        {PROJECT_SUBVIEWS.map((v) => (
          <button key={v.id} type="button" aria-pressed={view === v.id}
                  onClick={() => onNav(v.id)}>
            {v.label}{v.state === 'todo' && <i title="未实现">·</i>}
          </button>
        ))}
      </nav>
      <span className="chip"><span className="dot off" />离线</span>
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
      <h2>还没选项目</h2>
      <p>素材和交付都挂在具体项目上。</p>
      <button className="mini mini-strong" type="button" onClick={onBack}>去项目列表</button>
    </div>
  )
}

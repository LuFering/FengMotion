/**
 * 项目条 —— 项目下的子视图（素材 / 交付）共用的一行导航。
 *
 * 原先这里还有「项目指挥中心」（callour-studio v2 复刻页整包 iframe 挂载），
 * 作者看过之后判定没用，已删除；项目列表也移进了创作对话的左栏。
 * 现在项目条只保留：回我的创作 / 当前项目名与阶段 / 子视图切换 / Agent 状态 / 进工作台。
 */
import { PROJECT_SUBVIEWS, STAGE_LABEL, type ProjectSummary } from '@/data/projects'
import { useHarnesses, availabilityOf } from '@/shell/useHarnesses'

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
  /* 与工作台同一判据：/api/capabilities 的 agent 项。 */
  const probe = useHarnesses()
  const agentState = availabilityOf(probe, 'deepseek').state
  const agentReady = agentState === 'available'
  const agentLabel = agentState === 'checking' ? '检测中' : agentState === 'misconfigured' ? '配置有误' : agentState === 'unknown' ? '状态未知' : '未连接'

  return (
    <div className="pj-bar">
      <button className="pj-bar-back" type="button" onClick={onBack} title="回我的创作">
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
      {/* Agent 状态读真实探测。原先固定「离线」，在 DSH 已接入后会误导用户。 */}
      <span className="chip" title={agentReady ? 'Agent 已连接' : `Agent ${agentLabel}`}>
        <span className={agentReady ? 'dot on' : 'dot off'} />{agentReady ? '已连接' : agentLabel}
      </span>
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

/**
 * 工作流（v5 重构）
 *
 * 内容模型对齐 workflow-v5：Prompt-first 是默认创作路径（首页主入口），
 * Structured 是按需的阶段+Gate 协议（次级入口）；题材只是预设。
 * 首页工作流卡显示路径、最近产物与真实 Gate 进度（服务层同一评估口径）。
 * 数据只经 workflowService。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  Copy,
  Flag,
  History,
  Layers,
  Plus,
  Sparkles,
  Trash2,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import { SearchField } from '@/components/SearchField'
import { WF_PRESETS, type WfPath } from '../data/workflowTemplates'
import { workflowService, gateSummaryOf, type WorkflowDef, type WorkflowRun } from '../services/workflowService'
import { WorkflowEditor } from './WorkflowEditor'
import '../styles/workflow.css'

type Page = { kind: 'home' } | { kind: 'create' } | { kind: 'editor'; id: string }

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `今天 ${hh}:${mm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

const RUN_STATUS_LABEL: Record<WorkflowRun['status'], string> = {
  queued: '排队中',
  running: '进行中',
  building: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const GATE_DECISION_SHORT: Record<string, string> = {
  confirmed: '已确认',
  pending: '待确认',
  'not-started': '未开始',
}

export function Workflow() {
  const [page, setPage] = useState<Page>({ kind: 'home' })
  /* 外部入口交接（创作启动层）：挂载时读一次 fm-open-workflow-v1，
     命中就直开对应工作流的编辑器；autoRun 的在编辑器里自动跑一次。 */
  const [autoRunId, setAutoRunId] = useState<string | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fm-open-workflow-v1')
      if (!raw) return
      localStorage.removeItem('fm-open-workflow-v1')
      const h = JSON.parse(raw) as { id?: string; autoRun?: boolean }
      if (h.id && workflowService.getWorkflow(h.id)) {
        if (h.autoRun) setAutoRunId(h.id)
        setPage({ kind: 'editor', id: h.id })
      }
    } catch { /* 交接数据损坏则忽略，停在首页 */ }
  }, [])
  const [tick, setTick] = useState(0)
  const refresh = () => setTick((t) => t + 1)

  const workflows = useMemo(() => workflowService.listWorkflows(), [tick])
  const runs = useMemo(() => workflowService.listRuns(), [tick])

  if (page.kind === 'editor') {
    return (
      <div className="wfl">
        <WorkflowEditor workflowId={page.id} autoRun={autoRunId === page.id} onBack={() => { setPage({ kind: 'home' }); refresh() }} />
      </div>
    )
  }

  if (page.kind === 'create') {
    return (
      <div className="wfl">
        <CreatePage
          onBack={() => setPage({ kind: 'home' })}
          onCreated={(id) => setPage({ kind: 'editor', id })}
        />
      </div>
    )
  }

  return (
    <div className="wfl">
      <WorkflowHome
        workflows={workflows}
        runs={runs}
        onOpen={(id) => setPage({ kind: 'editor', id })}
        onCreate={() => setPage({ kind: 'create' })}
        onChanged={refresh}
      />
    </div>
  )
}

/* ── 首页 ─────────────────────────────────────────────────────────── */

function WorkflowHome(props: {
  workflows: WorkflowDef[]
  runs: WorkflowRun[]
  onOpen: (id: string) => void
  onCreate: () => void
  onChanged: () => void
}) {
  const { workflows, runs } = props
  const [query, setQuery] = useState('')
  const filtered = workflows.filter((w) => !query || w.name.includes(query) || w.description.includes(query))
  const latestRunOf = (id: string) => runs.find((r) => r.workflowId === id)

  const quickStart = (path: WfPath) => {
    const wf = workflowService.createFromPath(path, 'general')
    props.onOpen(wf.id)
  }

  return (
    <section className="wfh" aria-label="工作流首页">
      <div className="wfh-cmd">
        <h1 className="wfh-cmd-title">工作流</h1>
        <div className="wfh-cmd-search">
          <SearchField value={query} onChange={setQuery} placeholder="搜索我的工作流…" ariaLabel="搜索我的工作流" />
        </div>
        <button type="button" className="wfh-btn is-primary" onClick={props.onCreate}>
          <Plus size={14} strokeWidth={2.2} /> 新建工作流
        </button>
      </div>
      <div className="wfh-meta">
        <span><b className="num">{workflows.length}</b> 个工作流</span>
        <span>默认路径 Prompt-first · Structured 按需</span>
        <span className="wfh-meta-demo">演示执行器 · Mock 数据（Agent 后端未连接）</span>
      </div>

      <div className="wfh-body">
        <div className="wfh-main">
          <section aria-label="创作入口">
            <div className="wfh-paths">
              <div className="wfh-path is-hero">
                <span className="wfh-path-tag"><Sparkles size={12} strokeWidth={2.2} /> 默认推荐 · Prompt-first</span>
                <b>从提示词直接开始创作</b>
                <p>写下原始需求就能进入创作与渲染；Lookdev、Film-plan 是随手可用的工作稿，不是审批门。需要时再加入参考、能力检索和 Finishing。</p>
                <div className="wfh-path-actions">
                  <button type="button" className="wfh-btn is-primary" onClick={() => quickStart('prompt-first')}>
                    从提示词开始 <ArrowRight size={13} strokeWidth={2.2} />
                  </button>
                  <button type="button" className="wfh-btn" onClick={props.onCreate}>选预设创建</button>
                </div>
              </div>
              <div className="wfh-path">
                <span className="wfh-path-tag is-alt"><Layers size={12} strokeWidth={2.2} /> 按需 · Structured</span>
                <b>需要阶段与确认门时用</b>
                <p>复杂、多人或客户项目：8 个阶段泳道管理产物版本，Gate A–D 的确认绑定具体产物版本，阻塞原因可追溯。</p>
                <div className="wfh-path-actions">
                  <button type="button" className="wfh-btn is-ghost" onClick={() => quickStart('structured')}>
                    新建结构化制作 <ArrowRight size={13} strokeWidth={2.2} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section aria-label="我的工作流">
            <h2 className="wfh-sect">我的工作流</h2>
            {filtered.length === 0 ? (
              <p className="wfh-empty">{query ? '没有匹配的工作流。换个关键词试试。' : '还没有工作流。用上面的入口从提示词开始，或点右上角「新建工作流」选预设。'}</p>
            ) : (
              <ul className="wfh-list">
                {filtered.map((w) => {
                  const last = latestRunOf(w.id)
                  const gates = w.path === 'structured' ? gateSummaryOf(w) : []
                  const rank = (g: (typeof gates)[number]) =>
                    g.stale ? 0 : g.decision === 'pending' ? 1 : g.blocked.length > 0 ? 2 : g.decision === 'confirmed' ? 3 : 4
                  const primaryGate = gates.length > 0 ? [...gates].sort((a, b) => rank(a) - rank(b))[0] : null
                  return (
                    <li key={w.id} className="wfh-row">
                      <button type="button" className="wfh-row-main" onClick={() => props.onOpen(w.id)}>
                        <span className="wfh-row-info">
                          <span className="wfh-row-title">
                            <b>{w.name}</b>
                            <span className="wfh-pathbadge" data-p={w.path}>{w.path === 'structured' ? 'Structured' : 'Prompt-first'}</span>
                          </span>
                          <span className="wfh-row-meta">
                            {w.nodes.filter((n) => n.type !== 'lane').length} 个节点 · 修订 {w.revision} · {fmtTime(w.updatedAt)}
                            {last ? ` · 最近${w.path === 'structured' ? '评估' : '运行'}：${last.artifacts[0]?.summary ?? RUN_STATUS_LABEL[last.status]}` : ' · 尚未运行'}
                          </span>
                        </span>
                        {primaryGate && (
                          <span className="wfh-row-gate">
                            <span className="wfh-gate-chip" data-d={primaryGate.stale ? 'stale' : primaryGate.decision}>
                              <Flag size={11} strokeWidth={2.2} />
                              {primaryGate.label.replace(' · ', ' ')} {primaryGate.stale ? '已确认·已失效' : GATE_DECISION_SHORT[primaryGate.decision]}
                              {primaryGate.blocked.length > 0 ? ` · 阻塞 ${primaryGate.blocked.length}` : ''}
                            </span>
                            {gates.length > 1 && <span className="wfh-gate-more">另有 {gates.length - 1} 个门</span>}
                          </span>
                        )}
                      </button>
                      <span className="wfh-row-actions">
                        <button
                          type="button"
                          className="wfh-iconbtn"
                          aria-label={`复制 ${w.name}`}
                          title="复制"
                          onClick={() => { workflowService.duplicateWorkflow(w.id); props.onChanged() }}
                        >
                          <Copy size={14} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          className="wfh-iconbtn"
                          aria-label={`删除 ${w.name}`}
                          title="删除"
                          onClick={() => { workflowService.deleteWorkflow(w.id); props.onChanged() }}
                        >
                          <Trash2 size={14} strokeWidth={2} />
                        </button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="wfh-side">
          <section aria-label="最近运行">
            <h2 className="wfh-sect"><History size={13} strokeWidth={2.2} /> 最近运行 / 评估</h2>
            {runs.length === 0 ? (
              <p className="wfh-empty">尚无运行记录。在编辑器里运行或评估一次，记录会出现在这里。</p>
            ) : (
              <ul className="wfh-runs">
                {runs.slice(0, 5).map((r) => {
                  const owner = workflows.find((w) => w.id === r.workflowId)
                  return (
                    <li key={r.id}>
                      <button type="button" className="wfh-run" onClick={() => props.onOpen(r.workflowId)}>
                        <span className="wfh-run-top">
                          <b>{r.workflowName}</b>
                          <span className="wfh-run-status" data-s={r.status}>{RUN_STATUS_LABEL[r.status]}</span>
                        </span>
                        <span className="wfh-run-sub">
                          <Clock3 size={11} strokeWidth={2} /> {fmtTime(r.startedAt)}
                          {owner ? ` · ${owner.path === 'structured' ? 'Structured' : 'Prompt-first'}` : ''}
                          {` · ${r.artifacts.length} 项产物 · 演示`}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          <section aria-label="说明">
            <h2 className="wfh-sect"><WorkflowIcon size={13} strokeWidth={2.2} /> 路径说明</h2>
            <dl className="wfh-pathnote">
              <div>
                <dt>Prompt-first</dt>
                <dd>直接创作、渲染、看片、修改；工作稿不是审批门。</dd>
              </div>
              <div>
                <dt>Structured</dt>
                <dd>阶段产物 + 范围确认；确认绑产物版本，推荐不等于确认。</dd>
              </div>
            </dl>
            <p className="wfh-pathnote-foot">演示运行只产出工作稿、引用与请求记录快照，不生成视频。</p>
          </section>
        </div>
      </div>
    </section>
  )
}

/* ── 创建页：路径 × 预设 ─────────────────────────────────────────── */

function CreatePage(props: { onBack: () => void; onCreated: (id: string) => void }) {
  const create = (path: WfPath, presetId: string) => {
    const wf = workflowService.createFromPath(path, presetId)
    props.onCreated(wf.id)
  }
  return (
    <section className="wfh" aria-label="新建工作流">
      <div className="wfh-cmd">
        <button type="button" className="wfh-iconbtn" onClick={props.onBack} aria-label="返回工作流首页">
          <ArrowLeft size={16} strokeWidth={2.2} />
        </button>
        <h1 className="wfh-cmd-title">新建工作流</h1>
      </div>
      <div className="wfh-meta">
        <span>先选路径，再选题材预设；预设只提供提示词结构与默认参数，不复制独立节点图</span>
      </div>
      <div className="wfh-create">
        {([
          { path: 'prompt-first' as WfPath, title: 'Prompt-first · 默认推荐', note: '从提示词直接创作；工作稿不是审批门。' },
          { path: 'structured' as WfPath, title: 'Structured · 按需', note: '阶段泳道 + Gate 检查点；适合复杂、多人、客户项目。' },
        ]).map((sec) => (
          <section key={sec.path} aria-label={sec.title}>
            <h2 className="wfh-sect">{sec.title}</h2>
            <p className="wfh-create-note">{sec.note}</p>
            <div className="wfh-tplgrid is-inline">
              {WF_PRESETS.map((preset) => (
                <article key={`${sec.path}-${preset.id}`} className="wfh-tpl">
                  {preset.cover ? (
                    <img className="wfh-tpl-cover" src={preset.cover} alt={`${preset.name}题材封面`} loading="lazy" />
                  ) : (
                    <div className="wfh-tpl-cover is-none">{preset.name.slice(0, 2)}</div>
                  )}
                  <span className="wfh-tpl-top">
                    <span className="wfh-tpl-cat">{sec.path === 'structured' ? 'Structured 预设' : 'Prompt-first 预设'}</span>
                    <span className="wfh-tpl-status" data-s={preset.status}>{preset.status === 'ready' ? '可创建' : '规划中'}</span>
                  </span>
                  <b>{preset.name}</b>
                  <p>{preset.description}</p>
                  <button
                    type="button"
                    className="wfh-btn"
                    disabled={preset.status !== 'ready'}
                    onClick={() => create(sec.path, preset.id)}
                  >
                    {preset.status === 'ready' ? '用此预设创建' : '尚未接入'}
                  </button>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

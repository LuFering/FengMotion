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
  Copy,
  Plus,
  Trash2,
} from 'lucide-react'
import { SearchField } from '@/components/SearchField'
import { WF_PRESETS, defForNode, type WfPath } from '../data/workflowTemplates'
import { workflowService, type WorkflowDef, type WorkflowRun } from '../services/workflowService'
import { WorkflowEditor } from './WorkflowEditor'
import '../styles/workflow.css'
import '../styles/workflow-editor.css'

type Page = { kind: 'home' } | { kind: 'create' } | { kind: 'editor'; id: string }

/* 去 AI 味：工作流显示名——去掉名字里拼的路径后缀；纯数字 / 空 / 只有标点
   的名字（多为测试输入直接当了名字，如“1”）一律显示“未命名创作” */
function displayWorkflowName(name: string): string {
  const base = name.split(' · ')[0]?.trim() ?? ''
  if (!base || /^[\d\s\p{P}]+$/u.test(base)) return '未命名创作'
  return base
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `今天 ${hh}:${mm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
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
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'used' | 'community'>('all')
  const q = query.trim().toLocaleLowerCase()
  const filtered = props.workflows.filter((w) => {
    const matches = `${w.name} ${w.description}`.toLocaleLowerCase().includes(q)
    return matches && (filter !== 'used' || props.runs.some((r) => r.workflowId === w.id))
  })
  return (
    <section className="wfshop" aria-label="工作流首页">
      <header className="wfshop-header">
        <div className="wfshop-heading-line"><h1>工作流</h1></div>
        <div className="wfshop-header-actions">
          <div className="wfshop-search"><SearchField value={query} onChange={setQuery} placeholder="搜索工作流" ariaLabel="搜索工作流" /></div>
          <button type="button" className="wfshop-create" onClick={props.onCreate}><Plus size={17} /> 新建工作流</button>
        </div>
      </header>
      <div className="wfshop-intro">
        <div className="wfshop-intro-copy"><span className="wfshop-label">CREATE YOUR WAY <span>✳</span></span><h2>让想法，<br />找到自己的路径。</h2><p>从一条适合自己的制作流程开始。查看、调整、复用，让每一次创作都有迹可循。</p><button type="button" onClick={props.onCreate}>探索创建方式 <ArrowRight size={16} /></button></div>
        <div className="wfshop-intro-art" aria-hidden="true"><div className="wfshop-orbit orbit-one"/><div className="wfshop-orbit orbit-two"/><div className="wfshop-art-node node-one">灵感 <span>01</span></div><div className="wfshop-art-node node-two">画面 <span>02</span></div><div className="wfshop-art-node node-three">成片 <span>03</span></div><div className="wfshop-art-star">✳</div></div>
      </div>
      <div className="wfshop-toolbar">
        <div className="wfshop-tabs" aria-label="工作流分类">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>我的工作流<span>{props.workflows.length}</span></button>
          <button type="button" className={filter === 'used' ? 'active' : ''} onClick={() => setFilter('used')}>最近使用</button>
          <button type="button" className={filter === 'community' ? 'active' : ''} onClick={() => setFilter('community')}>社区 <small>即将开放</small></button>
        </div>
      </div>
      {filter === 'community' ? <div className="wfshop-empty"><span>✳</span><h3>好灵感，值得分享</h3><p>工作流社区正在筹备中，未来你可以在这里发现和获取其他创作者的工作流。</p></div> : <>
        {filtered.length === 0 ? <div className="wfshop-empty"><span>✳</span><h3>{q ? '没有找到相关工作流' : filter === 'used' ? '还没有使用记录' : '从第一条工作流开始'}</h3><p>{q ? '试试其他关键词。' : filter === 'used' ? '运行过的工作流会出现在这里。' : '创建一条工作流，保存你的创作方法。'}</p>{!q && filter === 'all' && <button type="button" onClick={props.onCreate}>新建工作流 <ArrowRight size={14}/></button>}</div> :
          <div className="wfshop-grid">{filtered.map((w, index) => {
            const last = props.runs.find((r) => r.workflowId === w.id)
            const preset = WF_PRESETS.find((p) => p.id === w.presetId)
            const steps = w.nodes.filter((n) => n.type !== 'lane').slice(0, 3)
            return <article className="wfshop-card" key={w.id}>
              <button type="button" className={`wfshop-card-art art-${index % 4}`} onClick={() => props.onOpen(w.id)} aria-label={`打开 ${w.name}`}><span className="wfshop-card-number">WORKFLOW / {String(index + 1).padStart(2, '0')}</span><span className="wfshop-card-symbol">{w.path === 'structured' ? '◈' : '✳'}</span><span className="wfshop-card-flow">{steps.map((n, i) => <span key={n.id}>{i > 0 && <i>→</i>}{defForNode(n)?.label || n.type}</span>)}</span><span className="wfshop-card-open">↗</span></button>
              <div className="wfshop-card-body"><div className="wfshop-card-tags"><span>{w.path === 'structured' ? '结构化制作' : '自由创作'}</span><span>{preset?.name || '通用'}</span></div><button type="button" className="wfshop-card-title" onClick={() => props.onOpen(w.id)}>{displayWorkflowName(w.name)}{w.name.includes(' · 副本') ? ' · 副本' : ''}</button><p>{w.description || (w.path === 'structured' ? '适合需要分阶段规划与确认的创作。' : '从你的想法出发，逐步构思、制作和修改。')}</p><div className="wfshop-card-footer"><span>{last ? `最近使用 ${fmtTime(last.startedAt)}` : `更新于 ${fmtTime(w.updatedAt)}`}</span><div><button type="button" aria-label={`复制 ${w.name}`} title="复制" onClick={() => { workflowService.duplicateWorkflow(w.id); props.onChanged() }}><Copy size={15}/></button><button type="button" aria-label={`删除 ${w.name}`} title="删除" onClick={() => { if (window.confirm(`删除“${w.name}”？`)) { workflowService.deleteWorkflow(w.id); props.onChanged() } }}><Trash2 size={15}/></button></div></div></div>
            </article>
          })}</div>}
      </>}
      <p className="wfshop-footnote">工作流运行目前为演示，生成工作稿与请求记录，尚未接入真实视频生成。</p>
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

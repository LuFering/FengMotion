/**
 * 工作流（v5 重构）
 *
 * 内容模型对齐 workflow-v0.1.0：Prompt-first 是默认创作路径（首页主入口），
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
  X,
  Folder,
  HardDrive,
  ArrowUpRight,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import { SearchField } from '@/components/SearchField'
import { WF_PRESETS, promptFirstGraph, structuredGraph, type WfPath } from '../data/workflowTemplates'
import { workflowService, type WorkflowDef, type WorkflowRun } from '../services/workflowService'
import { useProjects } from '../shell/useProjects'
import { workflowBrief, workflowProjectLabel } from '../services/workflowPresentation'
import { WorkflowGraphPreview } from '../components/WorkflowGraphPreview'
import { WorkflowEditor } from './WorkflowEditor'
import '../styles/workflow.css'
import '../styles/workflow-editor.css'
import '../styles/workflow-library.css'

type Page = { kind: 'home' } | { kind: 'create' } | { kind: 'editor'; id: string }

/* Preserve user-entered names; only genuinely empty names need a fallback. */
function displayWorkflowName(name: string): string {
  return name.trim() || '未命名工作流'
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
  const [library, setLibrary] = useState(() => ({ workflows: workflowService.listWorkflows(), runs: workflowService.listRuns() }))
  const refresh = () => setLibrary({ workflows: workflowService.listWorkflows(), runs: workflowService.listRuns() })
  const { workflows, runs } = library

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

function WorkflowHome(props: {
  workflows: WorkflowDef[]
  runs: WorkflowRun[]
  onOpen: (id: string) => void
  onCreate: () => void
  onChanged: () => void
}) {
  const projects = useProjects()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'used'>('all')
  const [sort, setSort] = useState('updated')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const recentById = useMemo(() => {
    const map = new Map<string, WorkflowRun>()
    for (const run of props.runs) if (!map.has(run.workflowId)) map.set(run.workflowId, run)
    return map
  }, [props.runs])
  const q = query.trim().toLocaleLowerCase()
  const filtered = props.workflows.filter((w) => `${w.name} ${workflowBrief(w)} ${projects.list.find((p) => p.id === w.projectId)?.name ?? ''}`.toLocaleLowerCase().includes(q)
    && (filter !== 'used' || recentById.has(w.id))).sort((a, b) => sort === 'name'
      ? a.name.localeCompare(b.name, 'zh-CN')
      : filter === 'used'
        ? (recentById.get(b.id)?.startedAt ?? '').localeCompare(recentById.get(a.id)?.startedAt ?? '')
        : b.updatedAt.localeCompare(a.updatedAt))
  return <section className="wf-library" aria-label="工作流首页">
    <header className="wf-library-header">
      <div><h1>工作流</h1><p>编排制作步骤，把适合你的工作方式保存下来。</p></div>
      <button className="wf-primary" type="button" onClick={props.onCreate}><Plus size={16}/>新建工作流</button>
    </header>
    <div className="wf-library-tools">
      <div className="wf-view-tabs" aria-label="工作流分类">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>我的工作流 <span>{props.workflows.length}</span></button>
        <button type="button" aria-pressed={filter === 'used'} onClick={() => setFilter('used')}>最近使用</button>
      </div>
      <div className="wf-library-search"><SearchField value={query} onChange={setQuery} placeholder="搜索工作流" ariaLabel="搜索工作流"/></div>
      <label className="wf-sort"><span className="wf-sr-only">排序</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="updated">最近编辑</option><option value="name">名称排序</option></select></label>
    </div>
    {notice && <p className="wf-inline-notice" role="status">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={14}/></button></p>}
    {!filtered.length ? <div className="wf-library-empty"><WorkflowIcon size={32} strokeWidth={1.2}/><h2>{q ? '没有找到相关工作流' : filter === 'used' ? '还没有运行记录' : '创建你的第一条工作流'}</h2><p>{q ? '试试其他名称或关键词。' : filter === 'used' ? '运行过的工作流会出现在这里。' : '从空白画布或现有预设开始，自由添加节点与连线。'}</p><button type="button" className="wf-secondary" onClick={() => { if(q) setQuery(''); else props.onCreate() }}>{q ? '清除搜索' : '新建工作流'}</button></div> :
      <div className="wf-library-grid">{filtered.map((w) => {
        const last = recentById.get(w.id)
        const count = w.nodes.filter((n) => n.type !== 'lane').length
        return <article className="wf-library-card" key={w.id}>
          <div className="wf-card-heading">
            <button type="button" className="wf-card-name" title={w.name} onClick={() => props.onOpen(w.id)}>{displayWorkflowName(w.name)}</button>
            <ArrowUpRight className="wf-card-enter" size={16} aria-hidden="true"/>
            <div className="wf-card-type"><span>{w.path === 'structured' ? '分阶段评估' : '自由创作'}</span><span>{count} 个节点</span><span className="wf-card-version">v{w.revision}</span></div>
          </div>
          <button type="button" className="wf-card-preview" onClick={() => props.onOpen(w.id)} aria-label={`打开工作流：${w.name}`}><WorkflowGraphPreview nodes={w.nodes} edges={w.edges}/></button>
          <div className="wf-card-content">
            {workflowBrief(w) && <p title={workflowBrief(w)}>{workflowBrief(w)}</p>}
            <div className="wf-card-context"><Folder size={13}/><span title={workflowProjectLabel(w.projectId, projects.list, projects.loading, Boolean(projects.error))}>{workflowProjectLabel(w.projectId, projects.list, projects.loading, Boolean(projects.error))}</span></div>
          </div>
          <footer className="wf-card-footer"><time dateTime={last?.startedAt ?? w.updatedAt} title={new Date(last?.startedAt ?? w.updatedAt).toLocaleString('zh-CN')}>{last ? '使用于' : '编辑于'} {fmtTime(last?.startedAt ?? w.updatedAt)}</time>
            <div><button type="button" className="wf-icon" title="复制工作流" aria-label={`复制 ${w.name}`} onClick={() => { try { workflowService.duplicateWorkflow(w.id); props.onChanged(); setNotice('已复制工作流') } catch (e) { setNotice(e instanceof Error ? e.message : '复制失败，请重试。') } }}><Copy size={15}/></button><button type="button" className="wf-icon" title="删除工作流" aria-label={`删除 ${w.name}`} onClick={() => setDeleting(deleting === w.id ? null : w.id)}><Trash2 size={15}/></button></div>
          </footer>
          {deleting === w.id && <div className="wf-delete-confirm"><p>删除「{displayWorkflowName(w.name)}」？此操作不可撤销。</p><div><button type="button" className="wf-secondary" onClick={() => setDeleting(null)}>取消</button><button type="button" className="wf-danger" onClick={() => { try { workflowService.deleteWorkflow(w.id); props.onChanged(); setDeleting(null); setNotice('已删除工作流') } catch (e) { setNotice(e instanceof Error ? e.message : '删除失败，请重试。') } }}>确认删除</button></div></div>}
        </article>
      })}</div>}
    <footer className="wf-library-footnote"><HardDrive size={13}/><span>工作流与运行记录保存在本机。关联项目后按连线执行；演示与状态评估会单独标明。</span></footer>
  </section>
}

function CreatePage(props: { onBack: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState<WfPath>('prompt-first')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const ready = WF_PRESETS.filter((p) => p.status === 'ready')
  const create = (presetId: string | null) => {
    if (creating) return
    setCreating(true)
    try {
      const wf = presetId === null ? workflowService.createEmpty(name.trim() || '未命名工作流')
        : workflowService.createFromPath(path, presetId, name.trim() || (path === 'structured' ? '分阶段工作流' : `${WF_PRESETS.find((p) => p.id === presetId)?.name ?? '新建'}工作流`))
      props.onCreated(wf.id)
    } catch (e) { setError(e instanceof Error ? e.message : '创建失败，请重试。'); setCreating(false) }
  }
  return <section className="wf-new" aria-label="新建工作流">
    <header className="wf-new-header"><button type="button" className="wf-secondary" onClick={props.onBack}><ArrowLeft size={15}/>工作流</button><span>新建工作流</span></header>
    <div className="wf-new-body">
      <div className="wf-new-heading"><h1>从你的制作方式开始</h1><p>选一个起点，接下来在画布上自由编排。</p></div>
      <label className="wf-new-name">工作流名称 <span>可稍后修改</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="未命名工作流" maxLength={120}/></label>
      <button type="button" className="wf-blank-start" disabled={creating} onClick={() => create(null)}><span className="wf-blank-icon"><Plus size={23}/></span><span><b>空白工作流</b><small>从零添加节点，自己决定每一步。</small></span><ArrowRight size={19}/></button>
      <div className="wf-preset-heading"><h2>从预设开始</h2><div className="wf-view-tabs" aria-label="预设类型"><button type="button" aria-pressed={path === 'prompt-first'} onClick={() => setPath('prompt-first')}>自由创作</button><button type="button" aria-pressed={path === 'structured'} onClick={() => setPath('structured')}>分阶段评估</button></div></div>
      <p className="wf-preset-note">{path === 'prompt-first' ? '以创作需求、制作与渲染、审片与修改为起点，按需扩展。' : '以阶段、产物和检查点为起点。当前仅评估状态，不会自动制作视频。'}</p>
      <div className="wf-preset-grid">{ready.map((preset) => {
        const graph = path === 'prompt-first' ? promptFirstGraph(preset.id) : structuredGraph()
        return <button type="button" className="wf-preset" key={preset.id} disabled={creating} onClick={() => create(preset.id)}><div className="wf-preset-preview"><WorkflowGraphPreview nodes={graph.nodes} edges={graph.edges}/></div><div className="wf-preset-copy"><h3>{preset.name}</h3><p>{preset.id === 'general' ? '不限定题材，直接填写你的创作需求。' : '带入已有口播科普的初始要求，所有节点均可继续修改。'}</p><span>使用预设 <ArrowRight size={14}/></span></div></button>
      })}</div>
      {error && <p className="wf-inline-notice" role="alert">{error}</p>}
      <p className="wf-new-storage"><HardDrive size={14}/>新工作流保存在本机。进入编辑器后可选择关联项目。</p>
    </div>
  </section>
}

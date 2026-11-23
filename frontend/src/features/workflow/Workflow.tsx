/**
 * 工作流（v5 重构）
 *
 * 内容模型对齐 workflow-v0.1.1：Prompt-first 是默认创作路径（首页主入口），
 * Structured 是按需的阶段+Gate 协议（次级入口）；题材只是预设。
 * 首页工作流卡显示路径、最近产物与真实 Gate 进度（服务层同一评估口径）。
 * 数据只经 workflowService。
 */
import { useEffect, useMemo, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Download01 } from '@untitledui/icons'
import { RUN_STATUS_TXT } from './model/editorNodes'
import { SearchField } from '@/shared/components/SearchField'
import { WF_PRESETS, promptFirstGraph, structuredGraph, type WfPath } from './model/workflowTemplates'
import { workflowService, type WorkflowDef, type WorkflowRun } from './services/workflowService'
import { buildGraphFromSkillPreset } from './services/workflowPresetBinding'
import { workflowArtifactMedia } from './services/workflowGraph'
import { studioHttpApi } from '@/api'
import type { WorkflowPreset } from '@/api/skillPresets'
import { useProjects } from '@/features/project/hooks/useProjects'
import { workflowBrief, workflowProjectLabel } from './services/workflowPresentation'
import { WorkflowGraphPreview } from './components/WorkflowGraphPreview'
import { MenuSelect } from '@/shared/components/MenuSelect'
import { GithubImportPanel } from './components/import/GithubImportPanel'
import { WorkflowEditor } from './WorkflowEditor'
import './styles/workflow.css'
import './styles/workflow-editor.css'
import './styles/workflow-library.css'
import './styles/workflow-nodes.css'
import './styles/workflow-controls.css'

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
  const [presetStudioOpen, setPresetStudioOpen] = useState(false)
  const [presetsTick, setPresetsTick] = useState(0)
  const refresh = () => setLibrary({ workflows: workflowService.listWorkflows(), runs: workflowService.listRuns() })
  const { workflows, runs } = library
  /* 导入面板里启用的预设可以直接拿来新建工作流，建好就进画布 */
  const usePreset = (preset: WorkflowPreset) => {
    const wf = workflowService.createFromSkillPreset(preset, `${preset.name || preset.mapping.name}工作流`)
    setPresetStudioOpen(false)
    setPage({ kind: 'editor', id: wf.id })
  }
  const importPanel = presetStudioOpen && (
    <GithubImportPanel
      open={presetStudioOpen}
      onClose={() => setPresetStudioOpen(false)}
      onPresetsChanged={() => setPresetsTick((n) => n + 1)}
      onUsePreset={usePreset}
    />
  )

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
          presetsTick={presetsTick}
          onBack={() => setPage({ kind: 'home' })}
          onOpenPresets={() => setPresetStudioOpen(true)}
          onCreated={(id) => setPage({ kind: 'editor', id })}
        />
        {importPanel}
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
        onOpenPresets={() => setPresetStudioOpen(true)}
        onChanged={refresh}
      />
      {importPanel}
    </div>
  )
}

function WorkflowHome(props: {
  workflows: WorkflowDef[]
  runs: WorkflowRun[]
  onOpen: (id: string) => void
  onCreate: () => void
  onOpenPresets: () => void
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
  /* 真实渲染过的工作流：取最近一次成片当海报（runs 已按时间倒序） */
  const posterById = useMemo(() => {
    const map = new Map<string, string>()
    for (const run of props.runs) {
      if (run.demo || map.has(run.workflowId)) continue
      for (const artifact of run.artifacts) {
        const file = workflowArtifactMedia(artifact)
        if (file) { map.set(run.workflowId, file); break }
      }
    }
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
      <h1>工作流</h1>
      <div className="wf-library-actions">
        <button className="wf-secondary" type="button" onClick={props.onOpenPresets}><UiIcon icon={Download01} size="sm" />从 GitHub 导入</button>
        <button className="wf-primary" type="button" onClick={props.onCreate}><UiIcon icon={SemIcons.plus} size="sm" />新建工作流</button>
      </div>
    </header>
    <div className="wf-library-tools">
      <div className="wf-view-tabs" aria-label="工作流分类">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>我的工作流 <span>{props.workflows.length}</span></button>
        <button type="button" aria-pressed={filter === 'used'} onClick={() => setFilter('used')}>最近使用</button>
      </div>
      <div className="wf-library-search"><SearchField value={query} onChange={setQuery} placeholder="搜索工作流" ariaLabel="搜索工作流"/></div>
      <MenuSelect className="wf-sort" label="" quiet align="end" ariaLabel="排序" value={sort} onChange={setSort}
        options={[{ value: 'updated', label: '最近编辑' }, { value: 'name', label: '名称排序' }]} />
    </div>
    {notice && <p className="wf-inline-notice" role="status">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><UiIcon icon={SemIcons.close} size="sm" /></button></p>}
    {!filtered.length ? <div className="wf-library-empty"><UiIcon icon={SemIcons.workflow} size="xl" /><h2>{q ? '没有找到相关工作流' : filter === 'used' ? '还没有运行记录' : '创建你的第一条工作流'}</h2>{q && <p>换个名称或关键词试试。</p>}<button type="button" className="wf-secondary" onClick={() => { if(q) setQuery(''); else props.onCreate() }}>{q ? '清除搜索' : '新建工作流'}</button></div> :
      <div className="wf-library-grid">{filtered.map((w) => {
        const last = recentById.get(w.id)
        const count = w.nodes.filter((n) => n.type !== 'lane').length
        const brief = workflowBrief(w)
        const runState = last ? (last.status === 'completed' ? 'done' : last.status === 'failed' ? 'failed' : last.status === 'running' ? 'running' : last.status === 'awaiting_info' ? 'waiting' : 'idle') : null
        const projectLabel = w.projectId ? workflowProjectLabel(w.projectId, projects.list, projects.loading, Boolean(projects.error)) : ''
        const poster = posterById.get(w.id)
        const meta = [w.path === 'structured' ? '分阶段评估' : '自由创作', `${count} 个节点`, `v${w.revision}`, ...(w.skillPresetMeta ? [`来自 GitHub：${w.skillPresetMeta.sourceRepo}`] : [])]
        return <article className="wf-library-card" key={w.id} data-poster={poster ? '' : undefined}>
          <div className="wf-card-stage" aria-hidden="true">
            {poster && <video className="wf-card-poster" src={`${poster}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} />}
            <div className="wf-card-graph"><WorkflowGraphPreview nodes={w.nodes} edges={w.edges}/></div>
          </div>
          <button type="button" className="wf-card-hit" onClick={() => props.onOpen(w.id)} aria-label={`打开工作流：${displayWorkflowName(w.name)}`} />
          {last && runState && <span className="wf-card-run" data-s={runState}><i className="fm-dot" data-s={runState} />{last.demo ? '演示' : ''}{RUN_STATUS_TXT[last.status] ?? last.status}</span>}
          <div className="wf-card-actions" data-confirming={deleting === w.id || undefined}><button type="button" title="复制工作流" aria-label={`复制 ${w.name}`} onClick={() => { try { workflowService.duplicateWorkflow(w.id); props.onChanged(); setNotice('已复制工作流') } catch (e) { setNotice(e instanceof Error ? e.message : '复制失败，请重试。') } }}><UiIcon icon={SemIcons.copy} size="sm" /></button><button type="button" title="删除工作流" aria-label={`删除 ${w.name}`} onClick={() => setDeleting(deleting === w.id ? null : w.id)}><UiIcon icon={SemIcons.trash} size="sm" /></button></div>
          <div className="wf-card-body">
            <h3 className="wf-card-name" title={w.name}>{displayWorkflowName(w.name)}</h3>
            {/* 写了需求才显示；没写是默认状态，不逐卡重复一句空值 */}
            {brief && <p className="wf-card-brief" title={brief}>{brief}</p>}
            {/* 版本与节点数常驻：同名工作流（多张「通用创作工作流」）靠它和时间区分 */}
            <div className="wf-card-meta">
              <span className="wf-card-facts" title={meta.join('，')}>
                <span className="num">v{w.revision} · {count} 个节点</span>
                {w.projectId && <span className="wf-card-project" title={projectLabel}><UiIcon icon={SemIcons.folder} size="xs" /><span>{projectLabel}</span></span>}
                {/* 一行放不下三样：有关联项目时来源只进悬停提示（与改版前一致） */}
                {w.skillPresetMeta && !w.projectId && <span className="wf-card-source" title={w.skillPresetMeta.sourceRepo}>来自 GitHub</span>}
              </span>
              <time dateTime={last?.startedAt ?? w.updatedAt} title={`${last ? '运行于' : '编辑于'} ${new Date(last?.startedAt ?? w.updatedAt).toLocaleString('zh-CN')}`}>{fmtTime(last?.startedAt ?? w.updatedAt)}</time>
            </div>
          </div>
          {deleting === w.id && <div className="wf-delete-confirm"><p>删除「{displayWorkflowName(w.name)}」？此操作不可撤销。</p><div><button type="button" className="wf-secondary" onClick={() => setDeleting(null)}>取消</button><button type="button" className="wf-danger" onClick={() => { try { workflowService.deleteWorkflow(w.id); props.onChanged(); setDeleting(null); setNotice('已删除工作流') } catch (e) { setNotice(e instanceof Error ? e.message : '删除失败，请重试。') } }}>确认删除</button></div></div>}
        </article>
      })}</div>}
  </section>
}

function CreatePage(props: { presetsTick: number; onBack: () => void; onOpenPresets: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState<WfPath>('prompt-first')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [skillPresets, setSkillPresets] = useState<WorkflowPreset[]>([])
  const [presetLoadWarn, setPresetLoadWarn] = useState('')

  useEffect(() => {
    let alive = true
    setPresetLoadWarn('')
    void studioHttpApi().skillPresets.listPresets('active')
      .then((list) => { if (alive) setSkillPresets(list) })
      .catch(() => { if (alive) setPresetLoadWarn('来自 GitHub 的预设暂时读不到，内置预设仍可使用') })
    return () => { alive = false }
  }, [props.presetsTick])

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
  const createFromSkill = (preset: WorkflowPreset) => {
    if (creating) return
    setCreating(true)
    try {
      const wf = workflowService.createFromSkillPreset(preset, name.trim() || `${preset.name || preset.mapping.name}工作流`)
      props.onCreated(wf.id)
    } catch (e) { setError(e instanceof Error ? e.message : '创建失败，请重试。'); setCreating(false) }
  }
  return <section className="wf-new" aria-label="新建工作流">
    <header className="wf-new-header"><button type="button" className="wf-secondary" onClick={props.onBack}><UiIcon icon={SemIcons.back} size="sm" />工作流</button><span>新建工作流</span></header>
    <div className="wf-new-body">
      <div className="wf-new-heading"><h1>从你的制作方式开始</h1></div>
      <label className="wf-new-name">工作流名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="未命名工作流" maxLength={120}/></label>
      <button type="button" className="wf-blank-start" disabled={creating} onClick={() => create(null)}><span className="wf-blank-icon"><UiIcon icon={SemIcons.plus} size="xl" /></span><span><b>空白工作流</b></span><UiIcon icon={SemIcons.forward} size="md" /></button>
      <div className="wf-preset-heading">
        <h2>从预设开始</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="button" className="wf-secondary" onClick={props.onOpenPresets}><UiIcon icon={Download01} size="sm" />从 GitHub 导入</button>
          <div className="wf-view-tabs" aria-label="预设类型"><button type="button" aria-pressed={path === 'prompt-first'} onClick={() => setPath('prompt-first')}>自由创作</button><button type="button" aria-pressed={path === 'structured'} onClick={() => setPath('structured')}>分阶段评估</button></div>
        </div>
      </div>
      {/* 只保留能力边界：分阶段预设不会制作视频，选之前必须知道。自由创作的节点已画在预览里，不再复述。 */}
      {path === 'structured' && <p className="wf-preset-note">仅评估阶段产物与检查点，不会自动制作视频。</p>}
      {presetLoadWarn && path === 'prompt-first' && <p className="wf-preset-note">{presetLoadWarn}</p>}
      <div className="wf-preset-grid">
        {ready.map((preset) => {
          const graph = path === 'prompt-first' ? promptFirstGraph(preset.id) : structuredGraph()
          return <button type="button" className="wf-preset" key={preset.id} disabled={creating} onClick={() => create(preset.id)}><div className="wf-preset-preview"><WorkflowGraphPreview nodes={graph.nodes} edges={graph.edges}/></div><div className="wf-preset-copy"><h3>{preset.name}</h3><p>{preset.id === 'general' ? '不限定题材，直接填写你的创作需求。' : '带入已有口播科普的初始要求，所有节点均可继续修改。'}</p><span>使用预设 <UiIcon icon={SemIcons.forward} size="sm" /></span></div></button>
        })}
        {path === 'prompt-first' && skillPresets.map((preset) => {
          const graph = buildGraphFromSkillPreset(preset)
          const title = preset.name || preset.mapping.name
          return (
            <button type="button" className="wf-preset" key={preset.id} disabled={creating} onClick={() => createFromSkill(preset)}>
              <div className="wf-preset-preview"><WorkflowGraphPreview nodes={graph.nodes} edges={graph.edges}/></div>
              <div className="wf-preset-copy">
                <h3>{title}<span className="wf-preset-tag" title={`${preset.sourceRepo}@${preset.commitSha.slice(0, 7)}`}>来自 GitHub</span></h3>
                <p>{preset.description || preset.mapping.description || `来自 ${preset.skillPath}`}</p>
                <span>使用预设 <UiIcon icon={SemIcons.forward} size="sm" /></span>
              </div>
            </button>
          )
        })}
      </div>
      {error && <p className="wf-inline-notice" role="alert">{error}</p>}
    </div>
  </section>
}

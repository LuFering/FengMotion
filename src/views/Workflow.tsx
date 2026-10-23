/**
 * 工作流（原生模块，第一期）
 *
 * 结构定案（《工作流定案-两轮对话结论》）：首页以「我的工作流」为主体、
 * 模板广场是创建入口、编辑器是构建与执行；旧 replica iframe 已降级为
 * 参考原型，不再挂载。顶部套三库统一规则：一条命令行 + 一行元信息。
 *
 * 数据只经 workflowService（Mock 适配器 + 本地持久化，契约形状）。
 */
import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  Copy,
  FilePlus2,
  History,
  LayoutTemplate,
  Play,
  Plus,
  Search,
  Trash2,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import { SearchField } from '@/components/SearchField'
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '../data/workflowTemplates'
import { workflowService, type WorkflowDef, type WorkflowRun } from '../services/workflowService'
import { WorkflowEditor } from './WorkflowEditor'
import '../styles/workflow.css'

type Page =
  | { kind: 'home' }
  | { kind: 'templates' }
  | { kind: 'template'; id: string }
  | { kind: 'editor'; id: string }

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `今天 ${hh}:${mm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

const RUN_STATUS_LABEL: Record<WorkflowRun['status'], string> = {
  queued: '排队中',
  running: '运行中',
  building: '生成产物中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export function Workflow() {
  const [page, setPage] = useState<Page>({ kind: 'home' })
  const [tick, setTick] = useState(0)
  const refresh = () => setTick((t) => t + 1)

  const workflows = useMemo(() => workflowService.listWorkflows(), [tick])
  const runs = useMemo(() => workflowService.listRuns(), [tick])

  if (page.kind === 'editor') {
    return (
      <div className="wfl">
        <WorkflowEditor workflowId={page.id} onBack={() => { setPage({ kind: 'home' }); refresh() }} />
      </div>
    )
  }

  if (page.kind === 'templates' || page.kind === 'template') {
    return (
      <div className="wfl">
        <TemplatesPage
          page={page}
          onBack={() => setPage({ kind: 'home' })}
          onOpen={(id) => setPage({ kind: 'template', id })}
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
        onTemplates={() => setPage({ kind: 'templates' })}
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
  onTemplates: () => void
  onChanged: () => void
}) {
  const { workflows, runs } = props
  const [query, setQuery] = useState('')
  const readyCount = WORKFLOW_TEMPLATES.filter((t) => t.status === 'ready').length
  const filtered = workflows.filter((w) => !query || w.name.includes(query) || w.description.includes(query))
  const recent = workflows.slice(0, 3)
  const featured = WORKFLOW_TEMPLATES.find((t) => t.status === 'ready')!

  const newBlank = () => {
    const wf = workflowService.createBlank('未命名工作流')
    props.onOpen(wf.id)
  }

  return (
    <section className="wfh" aria-label="工作流首页">
      <div className="wfh-cmd">
        <h1 className="wfh-cmd-title">工作流</h1>
        <div className="wfh-cmd-search">
          <SearchField value={query} onChange={setQuery} placeholder="搜索我的工作流…" ariaLabel="搜索我的工作流" />
        </div>
        <button type="button" className="wfh-btn is-primary" onClick={newBlank}>
          <Plus size={14} strokeWidth={2.2} /> 新建工作流
        </button>
      </div>
      <div className="wfh-meta">
        <span><b className="num">{workflows.length}</b> 个工作流</span>
        <span><b className="num">{WORKFLOW_TEMPLATES.length}</b> 个模板 · <b className="num">{readyCount}</b> 个可创建</span>
        <span className="wfh-meta-demo">演示执行器 · Mock 数据（Agent 后端未连接）</span>
      </div>

      <div className="wfh-body">
        <div className="wfh-main">
          {recent.length > 0 && (
            <section aria-label="最近使用">
              <h2 className="wfh-sect">最近使用</h2>
              <div className="wfh-recent">
                {recent.map((w) => (
                  <button key={w.id} type="button" className="wfh-recent-card" onClick={() => props.onOpen(w.id)}>
                    <span className="wfh-recent-top">
                      <WorkflowIcon size={15} strokeWidth={2} />
                      <b>{w.name}</b>
                    </span>
                    <span className="wfh-recent-sub">
                      {w.sourceTemplateId ? '来自模板 · ' : ''}修订 {w.revision} · {fmtTime(w.updatedAt)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section aria-label="我的工作流">
            <h2 className="wfh-sect">我的工作流</h2>
            {filtered.length === 0 ? (
              <p className="wfh-empty">{query ? '没有匹配的工作流。' : '还没有工作流，从模板创建或新建一个空白工作流。'}</p>
            ) : (
              <ul className="wfh-list">
                {filtered.map((w) => (
                  <li key={w.id} className="wfh-row">
                    <button type="button" className="wfh-row-main" onClick={() => props.onOpen(w.id)}>
                      <b>{w.name}</b>
                      <span>
                        {w.nodes.length} 个节点 · 修订 {w.revision}
                        {w.sourceTemplateId ? ' · 来自模板' : ' · 空白创建'}
                        {' · '}{fmtTime(w.updatedAt)}
                      </span>
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
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="wfh-side">
          <section aria-label="从模板创建">
            <h2 className="wfh-sect">从模板创建</h2>
            <div className="wfh-feature">
              <span className="wfh-feature-badge"><LayoutTemplate size={13} strokeWidth={2} /> 可创建</span>
              <b>{featured.name}</b>
              <p>{featured.description}</p>
              {featured.sourceNote && <p className="wfh-feature-note">{featured.sourceNote}</p>}
              <button type="button" className="wfh-btn" onClick={props.onTemplates}>
                查看模板并创建 <ArrowRight size={13} strokeWidth={2.2} />
              </button>
            </div>
            <button type="button" className="wfh-textbtn" onClick={props.onTemplates}>
              浏览全部 {WORKFLOW_TEMPLATES.length} 个模板
            </button>
          </section>

          <section aria-label="最近运行">
            <h2 className="wfh-sect"><History size={13} strokeWidth={2.2} /> 最近运行</h2>
            {runs.length === 0 ? (
              <p className="wfh-empty">暂无运行记录。在编辑器里运行工作流后，记录会出现在这里。</p>
            ) : (
              <ul className="wfh-runs">
                {runs.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <button type="button" className="wfh-run" onClick={() => props.onOpen(r.workflowId)}>
                      <span className="wfh-run-top">
                        <b>{r.workflowName}</b>
                        <span className="wfh-run-status" data-s={r.status}>{RUN_STATUS_LABEL[r.status]}</span>
                      </span>
                      <span className="wfh-run-sub">
                        <Clock3 size={11} strokeWidth={2} /> {fmtTime(r.startedAt)} · 演示运行 · {r.artifacts.length} 项产物
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}

/* ── 模板广场与详情 ─────────────────────────────────────────────── */

function TemplatesPage(props: {
  page: { kind: 'templates' } | { kind: 'template'; id: string }
  onBack: () => void
  onOpen: (id: string) => void
  onCreated: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const detail = props.page.kind === 'template' ? WORKFLOW_TEMPLATES.find((t) => t.id === (props.page as { id: string }).id) : null

  if (detail) {
    return <TemplateDetail template={detail} onBack={props.onBack} onCreated={props.onCreated} />
  }

  const list = WORKFLOW_TEMPLATES.filter((t) => !query || t.name.includes(query) || t.description.includes(query))
  return (
    <section className="wfh" aria-label="模板广场">
      <div className="wfh-cmd">
        <button type="button" className="wfh-iconbtn" onClick={props.onBack} aria-label="返回工作流首页">
          <ArrowLeft size={16} strokeWidth={2.2} />
        </button>
        <h1 className="wfh-cmd-title">从模板创建</h1>
        <div className="wfh-cmd-search">
          <SearchField value={query} onChange={setQuery} placeholder="搜索模板…" ariaLabel="搜索模板" />
        </div>
      </div>
      <div className="wfh-meta">
        <span><b className="num">{WORKFLOW_TEMPLATES.length}</b> 个模板</span>
        <span>只有带真实流程定义的模板可创建，其余如实标注规划中</span>
      </div>
      <div className="wfh-tplgrid">
        {list.map((t) => (
          <article key={t.id} className="wfh-tpl">
            <span className="wfh-tpl-top">
              <span className="wfh-tpl-cat">{t.category}</span>
              <span className="wfh-tpl-status" data-s={t.status}>{t.status === 'ready' ? '可创建' : '规划中'}</span>
            </span>
            <b>{t.name}</b>
            <p>{t.description}</p>
            {t.sourceNote && <p className="wfh-tpl-note">{t.sourceNote}</p>}
            <button type="button" className="wfh-btn" onClick={() => props.onOpen(t.id)}>
              {t.status === 'ready' ? '查看模板并创建' : '查看说明'}
            </button>
          </article>
        ))}
        {list.length === 0 && <p className="wfh-empty">没有匹配的模板。</p>}
      </div>
    </section>
  )
}

function TemplateDetail(props: { template: WorkflowTemplate; onBack: () => void; onCreated: (id: string) => void }) {
  const t = props.template
  const create = () => {
    const wf = workflowService.createFromTemplate(t.id)
    if (wf) props.onCreated(wf.id)
  }
  return (
    <section className="wfh" aria-label={`模板：${t.name}`}>
      <div className="wfh-cmd">
        <button type="button" className="wfh-iconbtn" onClick={props.onBack} aria-label="返回模板广场">
          <ArrowLeft size={16} strokeWidth={2.2} />
        </button>
        <h1 className="wfh-cmd-title">{t.name}</h1>
        <span className="wfh-tpl-status" data-s={t.status}>{t.status === 'ready' ? `可创建 · ${t.version}` : '规划中'}</span>
        <span className="wfh-spacer" />
        {t.status === 'ready' && (
          <button type="button" className="wfh-btn is-primary" onClick={create}>
            <FilePlus2 size={14} strokeWidth={2.2} /> 基于模板创建工作流
          </button>
        )}
      </div>
      <div className="wfh-detail">
        <p className="wfh-detail-desc">{t.description}</p>
        {t.sourceNote && <p className="wfh-feature-note">{t.sourceNote}</p>}
        {t.graph ? (
          <>
            <h2 className="wfh-sect">流程结构（{t.graph.nodes.length} 个节点）</h2>
            <ol className="wfh-chain">
              {t.graph.nodes.map((n) => (
                <li key={n.id} className="wfh-chain-node">
                  <Play size={11} strokeWidth={2.4} aria-hidden="true" />
                  {n.type === 'script' && '脚本输入'}
                  {n.type === 'media' && '素材引用'}
                  {n.type === 'voiceover' && '配音计划'}
                  {n.type === 'shotplan' && '分镜设计'}
                  {n.type === 'technique' && '技法引用'}
                  {n.type === 'compose' && 'Remotion 合成'}
                </li>
              ))}
            </ol>
            <p className="wfh-detail-note">创建后得到一份可编辑的副本，模板来源与版本会记录在工作流上；演示执行器只生成结构化产物，不渲染视频。</p>
          </>
        ) : (
          <p className="wfh-detail-note">该模板的流程定义尚未建立，目前只能查看说明，不能创建工作流。流程定义完成后会在这里开放创建。</p>
        )}
        <p className="wfh-detail-note"><Search size={12} strokeWidth={2} aria-hidden="true" /> 模板数据来自前端模板目录（src/data/workflowTemplates.ts），与素材库、技法库共用同一份真实工程数据。</p>
      </div>
    </section>
  )
}

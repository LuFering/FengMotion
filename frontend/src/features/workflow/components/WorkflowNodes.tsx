import { memo, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { CheckCircle, File01, Film01, Image01, Flag01, Package, Scan, Star01 } from '@untitledui/icons'
import { Handle, Position } from '@xyflow/react'
import { ARTIFACT_KIND_MAP, WF_PORT_COLORS, defForNode, type WfPortType } from '@/features/workflow/model/workflowTemplates'
import { BUILTIN_ASSETS } from '@/features/assets/model/myAssets'
import { QUALITY_QUESTIONS } from '@/features/workflow/services/workflowService'
import { statusOf } from '@/shared/lib/status'
import { type FmNodeData, NODE_COPY, pfSummary, ARTIFACT_STATUS_LABEL } from '@/features/workflow/model/editorNodes'

export function Ports({ node }: { node: { type: string; params: Record<string, unknown> } }) {
  const def = defForNode(node, { includeLegacy: true })
  if (!def) return null
  return (
    <div className="wfn-ports">
      <div className="wfn-col">
        {def.inputs.map((p) => (
          <span key={p.id} className="wfn-port in">
            <Handle type="target" position={Position.Left} id={p.id} className="wfn-handle" style={{ background: WF_PORT_COLORS[p.type] }} />
            <span className="wfn-port-label">{p.label}</span>
            {p.required && <em>*</em>}
          </span>
        ))}
      </div>
      <div className="wfn-col out">
        {def.outputs.map((p) => (
          <span key={p.id} className="wfn-port out">
            <span className="wfn-port-label">{p.label}</span>
            <Handle type="source" position={Position.Right} id={p.id} className="wfn-handle" style={{ background: WF_PORT_COLORS[p.type] }} />
          </span>
        ))}
      </div>
    </div>
  )
}

export function NodeMark({ type }: { type: string }) {
  const Icon = type === 'prompt' || type === 'artifact' ? File01 : type === 'refs' ? Image01 : type === 'create' ? Film01 : type === 'review' ? Scan : type === 'capability' ? Package : type === 'delivery' ? CheckCircle : type === 'gate' ? Flag01 : Star01
  return <span className="wfn-mark" data-kind={type}><Icon size={16} /></span>
}

export function NodeState({ status }: { status: FmNodeData['status'] }) {
  const state = statusOf(status === 'completed' ? 'done' : status === 'running' ? 'running' : status === 'failed' ? 'failed' : 'idle')
  return <span className="wfn-state"><i className="fm-dot" data-s={state.s}/>{status === 'idle' ? '未运行' : status === 'pending' ? '待运行' : status === 'awaiting_info' ? '未生成新版本' : status === 'completed' ? '已完成' : status === 'skipped' ? '已跳过' : state.label}</span>
}

export const FmNodeView = memo(function FmNodeView({ data, selected }: { data: FmNodeData; selected?: boolean }) {
  const pseudoNode = { type: data.defType, params: data.params }
  const def = defForNode(pseudoNode, { includeLegacy: true })
  if (!def) return null
  const p = data.params
  const kind = data.defType === 'artifact' ? ARTIFACT_KIND_MAP[String(p.kind ?? '')] : undefined
  const copy = NODE_COPY[data.defType]
  const title = copy?.title ?? kind?.label ?? def.label
  const ev = data.gateEval
  const decision = ev?.stale ? 'confirmed-stale' : (ev?.decision ?? 'not-started')
  const assets = data.defType === 'refs' ? ((p.assetIds as string[] | undefined) ?? []).map((id) => BUILTIN_ASSETS.find((a) => a.id === id)).filter((a) => a?.thumbnailPath).slice(0, 3) : []
  const checks = (p.checks as Record<string, boolean> | undefined) ?? {}
  const customChecklist = Array.isArray(p.customChecklist) ? p.customChecklist.map(String).filter(Boolean) : []
  const allReviewQuestions = Array.from(new Set([...customChecklist, ...QUALITY_QUESTIONS]))
  const reviewDone = allReviewQuestions.filter((q) => checks[q]).length
  const reviewApproved = !!checks.done && !checks.rework
  const reviewRework = !!checks.rework && !checks.done
  const requiredInputs = data.defType === 'refs' && Array.isArray(p.requiredInputs)
    ? (p.requiredInputs as Array<{ label?: unknown; required?: unknown } | string>)
        .map((x) => (typeof x === 'string' ? x : String(x?.label ?? '')))
        .filter(Boolean)
    : []
  return (
    <div className={`wfn wfn-${data.defType}${data.defType === 'artifact' ? ' is-doc' : ''}${data.defType === 'gate' ? ' is-gate' : ''}`} data-selected={selected || undefined} data-status={data.status} data-d={decision}>
      <div className="wfn-head"><NodeMark type={data.defType}/><div className="wfn-heading"><b>{title}</b></div><NodeState status={data.status}/></div>
      <div className="wfn-content">
        {data.defType === 'prompt' ? <><p className="wfn-prompt-text">{String(p.text ?? '').trim() || '还没有创作需求'}</p><div className="wfn-specs">{[p.ratio, p.duration, p.audience].filter(Boolean).map((item, i) => <span key={i}>{String(item)}</span>)}</div></> :
        data.defType === 'refs' ? <><div className="wfn-media-strip">{assets.length ? assets.map((asset) => <img key={asset!.id} src={asset!.thumbnailPath} alt={asset!.name}/>) : <span className="wfn-no-media"><UiIcon icon={SemIcons.image} size="lg" /><span>{requiredInputs.length ? `需：${requiredInputs[0]}` : '尚未选择素材'}</span></span>}</div><p className="wfn-caption">{pfSummary(data.defType, p)}</p></> :
        data.defType === 'create' ? <>{data.renderFile ? <video className="wfn-output-video nodrag nowheel" src={data.renderFile} controls preload="metadata" aria-label="该节点最近一次真实渲染产物"/> : <div className="wfn-render-slot"><UiIcon icon={SemIcons.film} size="xl" /><span>{data.status === 'running' ? '正在制作与渲染' : data.renderMode === 'real' ? '可制作与渲染' : '流程演示'}</span></div>}<div className="wfn-specs"><span>{String(p.resolution ?? '1080p')}</span><span>{p.mode === 'sketch' ? '草稿制作' : p.mode === 'prototype' ? '原型制作' : '正式制作'}</span></div></> :
        data.defType === 'review' ? <>
          <div className="wfn-review-count"><UiIcon icon={Scan} size="xl" /><span><b>{reviewDone} / {allReviewQuestions.length}</b><small>{reviewApproved ? '审片通过' : reviewRework ? '需要修改 · 待返工' : '审片检查已确认'}</small></span></div>
          <div className="wfn-specs"><span data-review={reviewApproved ? 'ok' : reviewRework ? 'rework' : 'pending'}>{reviewApproved ? '审片通过' : reviewRework ? '需要修改' : '待审片'}</span>{p.reviewedVersion != null && <span>针对 v{String(p.reviewedVersion)}</span>}</div>
          <p className="wfn-caption">{String(p.issues ?? '').trim() || '等待预览与修改意见'}</p>
        </> :
        data.defType === 'delivery' ? <>
          <p className="wfn-document-text">{data.status === 'completed' ? '审片已通过最新渲染，已输出本次成片' : data.status === 'awaiting_info' ? '等待审片通过最新渲染' : '确定性交付：需审片通过最新渲染'}</p>
          <div className="wfn-specs"><span>{data.status === 'completed' ? '可交付成片' : '等待审片通过'}</span></div>
        </> :
        data.defType === 'artifact' ? <><p className="wfn-document-text">{String(p.summary ?? '').trim() || '尚未添加阶段产物'}</p><div className="wfn-specs"><span>{ARTIFACT_STATUS_LABEL[String(p.status ?? 'missing')] ?? String(p.status)}</span>{!!p.version && <span>{String(p.version)}</span>}</div></> :
        data.defType === 'gate' ? <><p className="wfn-document-text">{def.description}</p><span className="wfn-gate-chip" data-d={decision}>{decision === 'confirmed' ? '已确认' : decision === 'confirmed-stale' ? '版本已变更' : decision === 'pending' ? '待确认' : '未开始'}</span>{!!ev?.blocked.length && <p className="wfn-blocked">{ev.blocked[0]}</p>}</> :
        <p className="wfn-document-text">{String(p.summary ?? p.notes ?? '').trim() || copy?.description || def.description}</p>}
      </div>
      <Ports node={pseudoNode}/>
    </div>
  )
})

export function LaneView({ data }: { data: FmNodeData }) {
  const collapsed = !!data.params.collapsed
  return (
    <div className="wflane" data-collapsed={collapsed || undefined}>
      <div className="wflane-head">
        <b><span className="wflane-no">阶段 {Number(data.params.stage) + 1}</span> {String(data.params.label ?? '')}</b>
        <span className="wflane-q">{String(data.params.question ?? '')}</span>
        {data.laneSummary && <span className="wflane-sum">{data.laneSummary}</span>}
        <button
          type="button"
          className="wflane-toggle nodrag"
          onClick={(e) => {
            e.stopPropagation()
            data.onToggleLane?.()
          }}
          aria-expanded={!collapsed}
        >
          {collapsed ? '展开' : '折叠'}
        </button>
      </div>
    </div>
  )
}

export const nodeTypes = { fm: FmNodeView, lane: LaneView }

/* 释放连线推荐菜单：候选已按端口类型过滤，选中即生成节点并自动连好 */
export function ConnectMenuView(props: {
  x: number
  y: number
  portType: WfPortType
  fromSource: boolean
  candidates: Array<{ key: string; label: string; sub: string; defType: string; params: Record<string, unknown>; portId: string }>
  onPick: (cand: { key: string; label: string; sub: string; defType: string; params: Record<string, unknown>; portId: string }) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const list = props.candidates.filter((c) => !q.trim() || c.label.includes(q.trim()))
  return (
    <>
      <div className="wfe-menu-scrim" onClick={props.onClose} onContextMenu={(e) => { e.preventDefault(); props.onClose() }} />
      <div
        className="wfe-connectmenu"
        style={{ left: Math.max(8, props.x - 10), top: Math.max(8, props.y - 10) }}
        role="menu"
        aria-label="选择要连接的节点"
        onKeyDown={(e) => { if (e.key === 'Escape') props.onClose() }}
      >
        <div className="wfe-connectmenu-head">
          <span className="wfe-connectmenu-dot" style={{ background: WF_PORT_COLORS[props.portType] }} />
          {props.fromSource ? '连接到下一个节点' : '从上一个节点接入'}
          <span className="wfe-connectmenu-type">{props.portType}</span>
        </div>
        <label className="wfe-connectmenu-search">
          <UiIcon icon={SemIcons.search} size="xs" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索节点" aria-label="搜索节点" />
        </label>
        <div className="wfe-connectmenu-list">
          {list.length === 0 && <p className="wfe-hint">没有类型兼容的节点可加。</p>}
          {list.map((c) => (
            <button key={c.key} type="button" className="wfe-connectmenu-item" onClick={() => props.onPick(c)}>
              <b>{c.label}</b>
              <span>{c.sub}</span>
            </button>
          ))}
        </div>
        <p className="wfe-connectmenu-foot">仅列类型兼容的节点 · 选中即生成并连好 · Esc 取消</p>
      </div>
    </>
  )
}

import { memo, useState } from 'react'
import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { CheckCircle, File01, Film01, Image01, Flag01, Package, Scan, Star01 } from '@untitledui/icons'
import { Handle, Position } from '@xyflow/react'
import { ARTIFACT_KIND_MAP, WF_PORT_COLORS, defForNode, type WfPortType } from '@/features/workflow/model/workflowTemplates'
import { BUILTIN_ASSETS } from '@/features/assets/model/myAssets'
import { QUALITY_QUESTIONS } from '@/features/workflow/services/workflowService'
import { statusOf } from '@/shared/lib/status'
import { type FmNodeData, NODE_COPY, pfSummary, ARTIFACT_STATUS_LABEL } from '@/features/workflow/model/editorNodes'
import { nodeCategory } from '@/features/workflow/model/nodeCategories'

/**
 * 端口：圆点贴在卡片左右边缘，标签在卡片里。颜色按数据类型（WF_PORT_COLORS），
 * 拖线时画布按 data-type 把不能接的端口变暗（workflow-editor.css「连线」一节）。
 */
export function Ports({ node }: { node: { type: string; params: Record<string, unknown> } }) {
  const def = defForNode(node, { includeLegacy: true })
  if (!def || (!def.inputs.length && !def.outputs.length)) return null
  /* 输入在左、输出在右，按行配对：连线从对应那一行直接出来，不用在卡片底部另找端口栏 */
  const rows = Math.max(def.inputs.length, def.outputs.length)
  return (
    <div className="wfn-ports">
      {Array.from({ length: rows }, (_, i) => {
        const inp = def.inputs[i], out = def.outputs[i]
        return (
          <div className="wfn-port-row" key={i}>
            {inp ? (
              <span className="wfn-port in" data-type={inp.type} style={{ '--port': WF_PORT_COLORS[inp.type] } as React.CSSProperties}>
                <Handle type="target" position={Position.Left} id={inp.id} className="wfn-handle" />
                <span className="wfn-port-label">{inp.label}</span>
                {inp.required && <em title="必须连接" aria-label="必须连接">*</em>}
              </span>
            ) : <span />}
            {out && (
              <span className="wfn-port out" data-type={out.type} style={{ '--port': WF_PORT_COLORS[out.type] } as React.CSSProperties}>
                <span className="wfn-port-label">{out.label}</span>
                <Handle type="source" position={Position.Right} id={out.id} className="wfn-handle" />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function NodeMark({ type }: { type: string }) {
  const Icon = type === 'prompt' || type === 'artifact' ? File01 : type === 'refs' ? Image01 : type === 'create' ? Film01 : type === 'review' ? Scan : type === 'capability' ? Package : type === 'delivery' ? CheckCircle : type === 'gate' ? Flag01 : Star01
  return <span className="wfn-mark" data-kind={type} data-cat={nodeCategory(type)}><Icon size={14} /></span>
}

const STATE_TEXT: Partial<Record<FmNodeData['status'], string>> = {
  idle: '未运行', pending: '排队中', awaiting_info: '等你处理', completed: '已完成', skipped: '已跳过',
}

/** 状态：圆点 + 文字（不只靠颜色） */
export function NodeState({ status }: { status: FmNodeData['status'] }) {
  const state = statusOf(status === 'completed' ? 'done' : status === 'running' ? 'running' : status === 'failed' ? 'failed' : status === 'awaiting_info' ? 'waiting' : 'idle')
  return <span className="wfn-state" data-s={status}><i className="fm-dot" data-s={state.s}/>{STATE_TEXT[status] ?? state.label}</span>
}

/* 审片取景框四角：画在 16:9 的 viewBox 里，跟着屏幕一起缩放 */
const VIEWFINDER = 'M10 26V10h16M134 10h16v16M150 64v16h-16M26 80H10V64'

/**
 * 节点卡片：头部（类型图标 · 标题 · 执行方式 · 状态）→ 画面窗口 → 端口。
 * 画面窗口画的是这个节点产出的东西：需求是一页稿纸，参考是素材拼片，
 * 制作、审片、交付是一块 16:9 的监看屏（有真实成片就直接放成片）。长配置都在右侧检查器里。
 */
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
  const assets = data.defType === 'refs' ? ((p.assetIds as string[] | undefined) ?? []).map((id) => BUILTIN_ASSETS.find((a) => a.id === id)).filter((a) => a?.thumbnailPath).slice(0, 4) : []
  const checks = (p.checks as Record<string, boolean> | undefined) ?? {}
  const customChecklist = Array.isArray(p.customChecklist) ? p.customChecklist.map(String).filter(Boolean) : []
  const allReviewQuestions = Array.from(new Set([...customChecklist, ...QUALITY_QUESTIONS]))
  const reviewDone = allReviewQuestions.filter((q) => checks[q]).length
  const reviewState = checks.done && !checks.rework ? 'ok' : checks.rework && !checks.done ? 'rework' : 'pending'
  const requiredInputs = data.defType === 'refs' && Array.isArray(p.requiredInputs)
    ? (p.requiredInputs as Array<{ label?: unknown; required?: unknown } | string>)
        .map((x) => (typeof x === 'string' ? x : String(x?.label ?? '')))
        .filter(Boolean)
    : []
  const promptText = String(p.text ?? '').trim()
  const cap = data.capability
  const running = data.status === 'running'
  const facts = (items: unknown[]) => {
    const list = items.filter((x) => x !== undefined && x !== null && String(x).trim() !== '').map(String)
    return list.length ? <span className="wfn-facts">{list.map((item, i) => <span key={i}>{item}</span>)}</span> : null
  }
  const paper = (text: string, empty: boolean, extra?: React.ReactNode) => (
    <div className="wfn-window wfn-paper"><p data-empty={empty || undefined}>{text}</p>{extra}</div>
  )
  const stage = (() => {
    switch (data.defType) {
      case 'prompt':
        return paper(promptText || (String(p.promptScaffold ?? '').trim() ? '按预设的需求骨架填写' : '还没有填写需求'), !promptText, facts([p.ratio, p.duration]))
      case 'refs':
        return assets.length
          ? <div className="wfn-window wfn-tiles" data-n={assets.length}>{assets.map((asset) => <img key={asset!.id} src={asset!.thumbnailPath} alt={asset!.name}/>)}</div>
          : <div className="wfn-window wfn-slot"><span>{requiredInputs.length ? `需要 ${requiredInputs.slice(0, 2).join('、')}${requiredInputs.length > 2 ? ` 等 ${requiredInputs.length} 项` : ''}` : '可留空，直接制作'}</span></div>
      case 'capability':
        return paper(pfSummary(data.defType, p), !((p.techniqueIds as string[] | undefined) ?? []).length)
      case 'create':
        return (
          <div className="wfn-window wfn-screen" data-running={running || undefined}>
            {data.renderFile
              ? <video className="wfn-output-video nodrag nowheel" src={data.renderFile} controls preload="metadata" aria-label="这个节点最近一次真实渲染的成片"/>
              : <>
                  <span className="wfn-screen-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9.5 7.5v9l7-4.5z"/></svg></span>
                  <span className="wfn-screen-cap">{running ? '正在制作' : <>{facts([p.resolution ?? '1080p', p.mode === 'sketch' ? '草稿' : p.mode === 'prototype' ? '原型' : '正式'])}</>}</span>
                </>}
          </div>
        )
      case 'review':
        return (
          <div className="wfn-window wfn-screen" data-review={reviewState}>
            <svg className="wfn-viewfinder" viewBox="0 0 160 90" aria-hidden="true"><path d={VIEWFINDER}/></svg>
            <b className="wfn-screen-title">{reviewState === 'ok' ? '通过' : reviewState === 'rework' ? '需要修改' : '待审片'}{p.reviewedVersion != null && <small> v{String(p.reviewedVersion)}</small>}</b>
            <span className="wfn-screen-cap">检查项 {reviewDone}/{allReviewQuestions.length}</span>
            <i className="wfn-screen-meter" style={{ '--v': allReviewQuestions.length ? reviewDone / allReviewQuestions.length : 0 } as React.CSSProperties} aria-hidden="true"/>
          </div>
        )
      case 'delivery':
        return (
          <div className="wfn-window wfn-screen" data-done={data.status === 'completed' || undefined}>
            <span className="wfn-screen-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7.5 12.5l3 3 6-7"/></svg></span>
            <span className="wfn-screen-cap">{data.status === 'completed' ? '已输出本次成片' : '审片通过最新渲染后输出'}</span>
          </div>
        )
      case 'artifact':
        return paper(String(p.summary ?? '').trim() || '还没有阶段产物', !String(p.summary ?? '').trim(), facts([ARTIFACT_STATUS_LABEL[String(p.status ?? 'missing')] ?? String(p.status), p.version]))
      case 'gate':
        return paper(def.description, false, <>
          <span className="wfn-gate-chip" data-d={decision}>{decision === 'confirmed' ? '已确认' : decision === 'confirmed-stale' ? '版本已变更' : decision === 'pending' ? '待确认' : '未开始'}</span>
          {!!ev?.blocked.length && <span className="wfn-blocked">{ev.blocked[0]}</span>}
        </>)
      default:
        return paper(String(p.summary ?? p.notes ?? '').trim() || copy?.description || def.description, false)
    }
  })()
  return (
    <div className={`wfn wfn-${data.defType}${data.defType === 'artifact' ? ' is-doc' : ''}${data.defType === 'gate' ? ' is-gate' : ''}`} data-selected={selected || undefined} data-status={data.status} data-d={decision} data-exec={cap?.execution} data-cat={nodeCategory(data.defType)}>
      <div className="wfn-head">
        <NodeMark type={data.defType}/>
        <div className="wfn-heading">
          <b>{title}</b>
          {cap && <small className="wfn-exec" data-x={cap.execution} title={cap.detail}>{cap.label}</small>}
        </div>
        {data.status !== 'idle' && <NodeState status={data.status}/>}
      </div>
      {stage}
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

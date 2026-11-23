import { useMemo, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Archive } from '@untitledui/icons'
import { studioHttpApi } from '@/api'
import { ApiError } from '@/api/errors'
import {
  INSTRUCTED_COMMAND_DECISION_OPTIONS,
  extractPresetValidationErrors,
  normalizePresetMapping,
  type InstructedCommandDecision,
  type MappingRequiredInput,
  type SkillPresetMapping,
  type WorkflowPreset,
} from '@/api/skillPresets'
import {
  INPUT_KIND_LABEL, REVIEW_SECTIONS, STATUS_LABEL, TARGET_NODE_LABEL,
  groupProblems, problemPlace, shortSha, type FieldProblem, type ReviewSectionId,
} from './importDisplay'

const linesToArray = (text: string) => text.split('\n').map((x) => x.trim()).filter(Boolean)

/** 422 带 problems 时按字段挂到分组；其他错误只有一句话，放在顶部 */
function problemsFrom(err: unknown): FieldProblem[] {
  const raw = err instanceof ApiError ? err.details?.problems : null
  if (Array.isArray(raw) && raw.length) return groupProblems(raw as Array<{ field?: string; message?: string }>)
  return extractPresetValidationErrors(err).map((message) => ({ field: '', message, section: null, index: null }))
}

/**
 * 父组件须以 key={preset.id} 渲染。
 *
 * 第 4、5 步：审阅预设草稿并启用。按「基本信息 / 需求骨架 / 输入 / 审片项 / 工作稿模板 / 步骤 / 方法指引 / 组件 / 命令」分组，
 * 后端校验问题挂在对应分组旁边；启用后直接给出「用这个预设新建工作流」。
 */
export function PresetReview(props: {
  preset: WorkflowPreset
  onUpdated: (next: WorkflowPreset, event?: 'activated') => void
  onArchived: (id: string) => void
  onUse: (preset: WorkflowPreset) => void
}) {
  const { preset, onUpdated, onArchived, onUse } = props
  const [draft, setDraft] = useState<SkillPresetMapping>(() => normalizePresetMapping(preset.mapping))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'save' | 'activate' | 'archive' | null>(null)
  const [problems, setProblems] = useState<FieldProblem[]>([])
  const [notice, setNotice] = useState('')
  const [confirmArchive, setConfirmArchive] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  /* 换预设时由父组件按 preset.id 重新挂载（key），草稿、问题、提示都从头开始，不在 effect 里重置 */

  const readOnly = preset.status !== 'draft'
  const bySection = useMemo(() => {
    const map = new Map<ReviewSectionId | null, FieldProblem[]>()
    for (const p of problems) map.set(p.section, [...(map.get(p.section) ?? []), p])
    return map
  }, [problems])

  const update = (patch: Partial<SkillPresetMapping>) => {
    if (readOnly) return
    setDraft((prev) => ({ ...prev, ...patch }))
    setDirty(true)
    setNotice('')
  }

  const save = async (): Promise<boolean> => {
    if (readOnly || busy) return false
    setBusy('save'); setProblems([]); setNotice('')
    try {
      const saved = await studioHttpApi().skillPresets.updatePresetMapping(preset.id, draft)
      onUpdated(saved)
      setDirty(false)
      setNotice('草稿已保存')
      return true
    } catch (err) {
      setProblems(problemsFrom(err))
      return false
    } finally {
      setBusy(null)
    }
  }

  const activate = async () => {
    if (readOnly || busy) return
    if (dirty && !(await save())) return
    setBusy('activate'); setProblems([]); setNotice('')
    try {
      const activated = await studioHttpApi().skillPresets.activatePreset(preset.id)
      onUpdated(activated, 'activated')
      setNotice('预设已启用。新建工作流时可以选它。')
    } catch (err) {
      setProblems(problemsFrom(err))
    } finally {
      setBusy(null)
    }
  }

  const archive = async () => {
    if (busy) return
    setBusy('archive'); setProblems([])
    try {
      await studioHttpApi().skillPresets.archivePreset(preset.id)
      onArchived(preset.id)
    } catch (err) {
      setProblems(problemsFrom(err))
      setBusy(null)
    }
  }

  const jump = (id: ReviewSectionId) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-section='${id}']`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const setInput = (idx: number, patch: Partial<MappingRequiredInput>) =>
    update({ requiredInputs: draft.requiredInputs.map((item, j) => (j === idx ? { ...item, ...patch } : item)) })

  const sectionProblems = (id: ReviewSectionId) => {
    const list = bySection.get(id)
    return list?.length ? (
      <ul className="gi-field-problems" role="alert">
        {list.map((p, i) => <li key={i}>{problemPlace(p) && <em>{problemPlace(p)}：</em>}{p.message}</li>)}
      </ul>
    ) : null
  }
  const section = (id: ReviewSectionId, children: React.ReactNode, extra?: React.ReactNode) => {
    const meta = REVIEW_SECTIONS.find((s) => s.id === id)!
    return (
      <section className="gi-section gi-review-section" data-section={id} data-invalid={bySection.get(id)?.length ? '' : undefined}>
        <div className="gi-section-head"><h4>{meta.label}</h4>{extra}</div>
        {sectionProblems(id)}
        {children}
      </section>
    )
  }
  const unplaced = bySection.get(null) ?? []

  return (
    <div className="gi-review" ref={scroller}>
      <header className="gi-head gi-review-head">
        <div className="gi-review-title">
          <div className="gi-title-row">
            <h3>{draft.name || preset.name || '未命名预设'}</h3>
            <span className="gi-status" data-status={preset.status}>{STATUS_LABEL[preset.status]}</span>
          </div>
          <p className="gi-meta">
            来自 GitHub · <span className="gi-mono">{preset.sourceRepo}@{shortSha(preset.commitSha)}</span><i /><code>{preset.skillPath}</code>
          </p>
        </div>
        <div className="gi-review-actions">
          {preset.status === 'draft' && <>
            <button type="button" className="wf-secondary" disabled={!!busy || !dirty} onClick={() => void save()}>{busy === 'save' ? '正在保存…' : '保存草稿'}</button>
            <button type="button" className="wf-primary" disabled={!!busy} onClick={() => void activate()}>{busy === 'activate' ? '正在校验…' : '启用'}</button>
          </>}
          {preset.status === 'active' && (
            <button type="button" className="wf-primary" onClick={() => onUse(preset)}>用这个预设新建工作流<UiIcon icon={SemIcons.forward} size="sm" /></button>
          )}
          {preset.status !== 'archived' && (confirmArchive
            ? <span className="gi-confirm">
                <span>归档后不能再新建，已用它的工作流不受影响</span>
                <button type="button" className="wf-secondary sm" onClick={() => setConfirmArchive(false)}>取消</button>
                <button type="button" className="wf-danger sm" disabled={!!busy} onClick={() => void archive()}>归档</button>
              </span>
            : <button type="button" className="wf-icon" title="归档预设" aria-label="归档预设" onClick={() => setConfirmArchive(true)}><UiIcon icon={Archive} size="md" /></button>)}
        </div>
      </header>

      {notice && <p className="gi-alert" data-tone="ok" role="status">{notice}</p>}
      {preset.status === 'active' && !notice && <p className="gi-muted gi-readonly-note">已启用的预设只读，保证用它的工作流都按同一份内容执行。要改请重新生成一份草稿。</p>}
      {draft.truncatedSources.length > 0 && (
        <div className="gi-alert" data-tone="warn">
          <b>这些文件没有完整交给模型</b>
          <p>{draft.truncatedSources.join('、')}</p>
        </div>
      )}
      {unplaced.length > 0 && (
        <div className="gi-alert" data-tone="bad" role="alert">
          <b>{preset.status === 'draft' ? '没有通过校验' : '操作没有完成'}</b>
          <ul>{unplaced.map((p, i) => <li key={i}>{p.field && <em>{p.field}：</em>}{p.message}</li>)}</ul>
        </div>
      )}

      <nav className="gi-review-nav" aria-label="预设分组">
        {REVIEW_SECTIONS.map((s) => {
          const n = bySection.get(s.id)?.length ?? 0
          return <button key={s.id} type="button" data-invalid={n ? '' : undefined} onClick={() => jump(s.id)}>{s.label}{n > 0 && <span>{n}</span>}</button>
        })}
      </nav>

      {section('basics', <>
        <div className="gi-grid2">
          <label className="gi-field"><span>名称</span><input disabled={readOnly} value={draft.name} maxLength={40} onChange={(e) => update({ name: e.target.value })} /></label>
          <label className="gi-field"><span>标识</span><input disabled={readOnly} value={draft.slug} onChange={(e) => update({ slug: e.target.value })} placeholder="小写字母、数字、连字符" spellCheck={false} /></label>
          <label className="gi-field"><span>默认时长</span><input disabled={readOnly} value={draft.defaults.duration ?? ''} placeholder="不指定" onChange={(e) => update({ defaults: { ...draft.defaults, duration: e.target.value || null } })} /></label>
          <label className="gi-field"><span>默认画幅</span>
            <select disabled={readOnly} value={draft.defaults.ratio ?? ''} onChange={(e) => update({ defaults: { ...draft.defaults, ratio: e.target.value || null } })}>
              <option value="">不指定</option>{['16:9', '9:16', '1:1', '4:5'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <label className="gi-field"><span>说明</span><textarea rows={2} disabled={readOnly} value={draft.description} maxLength={300} onChange={(e) => update({ description: e.target.value })} /></label>
      </>)}

      {section('prompt', <>
        <p className="gi-hint">新建工作流时放进「创作需求」节点，作为填写提示，不会当成你的原话。</p>
        <textarea className="gi-textarea" rows={5} disabled={readOnly} value={draft.promptScaffold} onChange={(e) => update({ promptScaffold: e.target.value })} aria-label="需求骨架" />
      </>)}

      {section('inputs', <>
        <p className="gi-hint">「素材与参考」节点会提示用户准备这些。</p>
        {draft.requiredInputs.length === 0 ? <p className="gi-muted">没有特定要求</p> : (
          <ul className="gi-inputs">
            {draft.requiredInputs.map((req, idx) => (
              <li key={idx} data-invalid={bySection.get('inputs')?.some((p) => p.index === idx) || undefined}>
                <select disabled={readOnly} value={req.kind} onChange={(e) => setInput(idx, { kind: e.target.value })} aria-label="类型">
                  {Object.entries(INPUT_KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input disabled={readOnly} value={req.label} onChange={(e) => setInput(idx, { label: e.target.value })} placeholder="名称" aria-label="名称" />
                <label className="gi-check"><input type="checkbox" disabled={readOnly} checked={req.required} onChange={(e) => setInput(idx, { required: e.target.checked, requiredWhen: null })} />每次都需要</label>
                {!req.required && <input disabled={readOnly} value={req.requiredWhen ?? ''} maxLength={200} placeholder="什么情况下需要（可留空）" aria-label={`${req.label || '这一项'}的适用条件`} onChange={(e) => setInput(idx, { requiredWhen: e.target.value || null })} />}
                {!readOnly && <button type="button" className="wf-icon" aria-label={`删除 ${req.label || '这一项'}`} onClick={() => update({ requiredInputs: draft.requiredInputs.filter((_, j) => j !== idx) })}><UiIcon icon={SemIcons.trash} size="sm" /></button>}
              </li>
            ))}
          </ul>
        )}
      </>, !readOnly && <button type="button" className="wf-secondary sm" onClick={() => update({ requiredInputs: [...draft.requiredInputs, { kind: 'asset', label: '', required: true }] })}><UiIcon icon={SemIcons.plus} size="sm" />添加一项</button>)}

      {section('review', <>
        <p className="gi-hint">「审片与修改」节点的检查项，每行一项。</p>
        <textarea className="gi-textarea" rows={4} disabled={readOnly} value={draft.reviewChecklist.join('\n')} onChange={(e) => update({ reviewChecklist: linesToArray(e.target.value) })} aria-label="审片检查项" />
      </>)}

      {section('drafts', (
        <div className="gi-grid2">
          <label className="gi-field"><span>视觉构想（lookdev-brief.md）</span><textarea rows={5} disabled={readOnly} value={draft.lookdevTemplate ?? ''} placeholder="不提供" onChange={(e) => update({ lookdevTemplate: e.target.value || null })} /></label>
          <label className="gi-field"><span>导演处理（film-plan.md）</span><textarea rows={5} disabled={readOnly} value={draft.filmPlanTemplate ?? ''} placeholder="不提供" onChange={(e) => update({ filmPlanTemplate: e.target.value || null })} /></label>
        </div>
      ))}

      {section('steps', <>
        {draft.stepMapping.length === 0 ? <p className="gi-muted">没有步骤</p> : (
          <ol className="gi-steps">
            {draft.stepMapping.map((s, i) => (
              <li key={i} data-invalid={bySection.get('steps')?.some((p) => p.index === i && p.field.startsWith('stepMapping')) || undefined}>
                <span className="gi-step-text">{s.step}{s.note && <small>{s.note}</small>}</span>
                <span className="gi-node-tag">{TARGET_NODE_LABEL[s.node] ?? s.node}</span>
              </li>
            ))}
          </ol>
        )}
        {draft.unmapped.length > 0 && <>
          <h5>放不进节点的步骤</h5>
          <ul className="gi-rows">{draft.unmapped.map((u, i) => <li key={i}><b>{u.step}</b><span>{u.reason}</span></li>)}</ul>
        </>}
      </>)}

      {section('guide', (
        <div className="gi-guide">
          <p className="gi-hint">写进项目的 skill-guide.md，制作时 Agent 先读。与你的原话、纠正冲突时以原话和纠正为准。</p>
          {draft.guide.map((sec, idx) => (
            <div key={idx} className="gi-guide-item" data-invalid={bySection.get('guide')?.some((p) => p.index === idx) || undefined}>
              <input disabled={readOnly} value={sec.title} aria-label={`第 ${idx + 1} 段标题`} onChange={(e) => update({ guide: draft.guide.map((item, j) => (j === idx ? { ...item, title: e.target.value } : item)) })} />
              <textarea rows={4} disabled={readOnly} value={sec.body} aria-label={`第 ${idx + 1} 段正文`} onChange={(e) => update({ guide: draft.guide.map((item, j) => (j === idx ? { ...item, body: e.target.value } : item)) })} />
              <div className="gi-sources" aria-label="出处">{sec.sources.map((src) => <code key={src} title={src}>{src.split('/').pop()}</code>)}</div>
            </div>
          ))}
        </div>
      ), <span className="gi-count">{draft.guide.length} 段</span>)}

      {section('components', (
        draft.components.length === 0 ? <p className="gi-muted">没有引用组件</p> : (
          <>
            <p className="gi-hint">写入项目时复制源码给 Agent 参考，依赖会一并复制。</p>
            <ul className="gi-rows">{draft.components.map((c, i) => <li key={i}><code>{c.path}</code><span>{c.purpose}</span></li>)}</ul>
          </>
        )
      ), <span className="gi-count">{draft.components.length} 个</span>)}

      {section('commands', (
        draft.instructedCommands.length === 0 ? <p className="gi-muted">Skill 没有要求运行命令</p> : (
          <>
            <p className="gi-hint">这些命令不会自动运行。为每一条选一种处理方式。</p>
            <ul className="gi-commands">
              {draft.instructedCommands.map((cmd, idx) => (
                <li key={idx}>
                  <span className="gi-step-text"><code>{cmd.command}</code>{cmd.note && <small>{cmd.note}</small>}</span>
                  <select disabled={readOnly} aria-label={`处理方式：${cmd.command}`} value={cmd.decision}
                          onChange={(e) => update({ instructedCommands: draft.instructedCommands.map((item, j) => (j === idx ? { ...item, decision: e.target.value as InstructedCommandDecision } : item)) })}>
                    {INSTRUCTED_COMMAND_DECISION_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </>
        )
      ))}
    </div>
  )
}

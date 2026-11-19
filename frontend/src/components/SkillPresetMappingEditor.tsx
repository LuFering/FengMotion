import { useEffect, useState } from 'react'
import {
  INSTRUCTED_COMMAND_DECISION_OPTIONS,
  extractPresetValidationErrors,
  normalizePresetMapping,
  type InstructedCommandDecision,
  type MappingRequiredInput,
  type SkillPresetMapping,
  type WorkflowPreset,
} from '@/services/api/skillPresets'
import { studioHttpApi } from '@/services/api'

const TARGET_NODE_LABEL: Record<string, string> = {
  prompt: '创作需求 (prompt)',
  refs: '素材与参考 (refs)',
  capability: '创作能力 (capability)',
  create: '制作与渲染 (create)',
  review: '审片与修改 (review)',
  delivery: '交付 (delivery)',
  drafts: '工作稿 (lookdev / film-plan)',
}

const STATUS_LABEL: Record<WorkflowPreset['status'], string> = {
  draft: '草稿 · 可编辑',
  active: '已启用 · 只读',
  archived: '已归档',
}

function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
}

export function SkillPresetMappingEditor(props: {
  preset: WorkflowPreset
  onUpdated: (next: WorkflowPreset) => void
  onArchived: (id: string) => void
}) {
  const { preset, onUpdated, onArchived } = props
  const [draft, setDraft] = useState<SkillPresetMapping>(() => normalizePresetMapping(preset.mapping))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setDraft(normalizePresetMapping(preset.mapping))
    setDirty(false)
    setErrors([])
    setNotice('')
  }, [preset])

  const readOnly = preset.status !== 'draft'

  const update = (patch: Partial<SkillPresetMapping>) => {
    if (readOnly) return
    setDraft((prev) => ({ ...prev, ...patch }))
    setDirty(true)
    setNotice('')
  }

  const handleSave = async (): Promise<WorkflowPreset | null> => {
    if (readOnly || busy) return null
    setBusy(true)
    setErrors([])
    setNotice('')
    try {
      const saved = await studioHttpApi().skillPresets.updatePresetMapping(preset.id, draft)
      onUpdated(saved)
      setDirty(false)
      setNotice('已保存映射草稿')
      return saved
    } catch (err) {
      setErrors(extractPresetValidationErrors(err))
      return null
    } finally {
      setBusy(false)
    }
  }

  const handleActivate = async () => {
    if (readOnly || busy) return
    setErrors([])
    setNotice('')
    if (dirty) {
      const saved = await handleSave()
      if (!saved) return
    }
    setBusy(true)
    try {
      const activated = await studioHttpApi().skillPresets.activatePreset(preset.id)
      onUpdated(activated)
      setDirty(false)
      setNotice('已启用为视频类型，现在可在新建工作流中选用')
    } catch (err) {
      setErrors(extractPresetValidationErrors(err))
    } finally {
      setBusy(false)
    }
  }

  const handleArchive = async () => {
    if (busy) return
    setBusy(true)
    setErrors([])
    try {
      await studioHttpApi().skillPresets.archivePreset(preset.id)
      onArchived(preset.id)
    } catch (err) {
      setErrors(extractPresetValidationErrors(err))
    } finally {
      setBusy(false)
    }
  }

  const updateRequiredInput = (idx: number, patch: Partial<MappingRequiredInput>) => {
    const next = draft.requiredInputs.map((item, j) => (j === idx ? { ...item, ...patch } : item))
    update({ requiredInputs: next })
  }

  return (
    <div className="skm-wrap">
      <div className="skm-head">
        <div>
          <div className="skm-title-row">
            <h3>{draft.name || preset.name}</h3>
            <span className="skm-status" data-status={preset.status}>{STATUS_LABEL[preset.status]}</span>
          </div>
          <p className="skm-meta">
            来源：{preset.sourceRepo ? `${preset.sourceRepo}@${preset.commitSha.slice(0, 7)}` : preset.commitSha.slice(0, 7)}
            {' · '}
            {preset.skillPath}
            {' · '}
            映射版本 v{preset.mappingVersion}
          </p>
        </div>
        <div className="skm-actions">
          {preset.status === 'draft' && (
            <>
              <button type="button" className="wf-secondary" disabled={busy || !dirty} onClick={() => void handleSave()}>
                保存草稿
              </button>
              <button type="button" className="wf-primary" disabled={busy} onClick={() => void handleActivate()}>
                {busy ? '处理中…' : '启用为视频类型'}
              </button>
            </>
          )}
          {preset.status !== 'archived' && (
            <button type="button" className="wf-danger" disabled={busy} onClick={() => void handleArchive()}>
              归档
            </button>
          )}
        </div>
      </div>

      {readOnly && (
        <p className="skm-banner is-info">
          该预设已{preset.status === 'active' ? '启用' : '归档'}（只读，保证绑定同一 commit 的项目行为一致；如需变更请重新导入或生成新草稿）。
        </p>
      )}

      {draft.truncatedSources.length > 0 && (
        <div className="skm-banner is-warn" role="status">
          <b>上下文预算截断提示（约 60KB 上限）</b>
          <p>以下文档超出上下文预算未传给模型：{draft.truncatedSources.join('、')}</p>
        </div>
      )}

      {errors.length > 0 && (
        <div className="skm-banner is-err" role="alert">
          <b>映射校验未通过</b>
          <ul>
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {notice && <p className="skm-banner is-ok" role="status">{notice}</p>}

      <section className="skm-section">
        <h4>基本信息与默认规格</h4>
        <div className="skm-grid2">
          <label className="skm-field">
            <span>类型名称</span>
            <input disabled={readOnly} value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="例如：Logo 动画" />
          </label>
          <label className="skm-field">
            <span>标识（slug）</span>
            <input disabled={readOnly} value={draft.slug} onChange={(e) => update({ slug: e.target.value })} placeholder="例如：logo-animation" />
          </label>
          <label className="skm-field">
            <span>默认时长</span>
            <input
              disabled={readOnly}
              value={draft.defaults.duration ?? ''}
              onChange={(e) => update({ defaults: { ...draft.defaults, duration: e.target.value || null } })}
              placeholder="例如：8 秒"
            />
          </label>
          <label className="skm-field">
            <span>默认画幅</span>
            <select
              disabled={readOnly}
              value={draft.defaults.ratio ?? ''}
              onChange={(e) => update({ defaults: { ...draft.defaults, ratio: e.target.value || null } })}
            >
              <option value="">未指定（创建时选择）</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="4:5">4:5</option>
            </select>
          </label>
        </div>
        <label className="skm-field">
          <span>类型说明</span>
          <textarea rows={2} disabled={readOnly} value={draft.description} onChange={(e) => update({ description: e.target.value })} />
        </label>
      </section>

      <section className="skm-section">
        <h4>节点映射预设</h4>
        <label className="skm-field">
          <span>创作需求骨架（promptScaffold → 创作需求节点）</span>
          <textarea rows={5} disabled={readOnly} value={draft.promptScaffold} onChange={(e) => update({ promptScaffold: e.target.value })} />
        </label>

        <div className="skm-field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>素材输入提示（requiredInputs → 素材节点）</span>
            {!readOnly && (
              <button
                type="button"
                className="sks-link"
                onClick={() => update({ requiredInputs: [...draft.requiredInputs, { kind: 'asset', label: '', required: true }] })}
              >
                + 添加一项素材提示
              </button>
            )}
          </div>
          {draft.requiredInputs.length === 0 ? (
            <p className="skm-empty">无特定素材提示</p>
          ) : (
            <div className="skm-cmd-list">
              {draft.requiredInputs.map((req, idx) => (
                <div key={idx} className="skm-cmd-row">
                  <select
                    disabled={readOnly}
                    style={{ width: 110 }}
                    value={req.kind}
                    onChange={(e) => updateRequiredInput(idx, { kind: e.target.value })}
                  >
                    <option value="asset">asset</option>
                    <option value="reference">reference</option>
                    <option value="text">text</option>
                  </select>
                  <input
                    disabled={readOnly}
                    style={{ flex: 1 }}
                    value={req.label}
                    onChange={(e) => updateRequiredInput(idx, { label: e.target.value })}
                    placeholder="素材或输入名称"
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, whiteSpace: 'nowrap' }}>
                    <input
                      type="checkbox"
                      disabled={readOnly}
                      style={{ width: 'auto' }}
                      checked={req.required}
                      onChange={(e) => updateRequiredInput(idx, { required: e.target.checked, requiredWhen: null })}
                    />
                    全部场景必需
                  </label>
                  {!req.required && <input aria-label={`${req.label || '素材'}的适用条件`} placeholder="仅在何种情况下必需（可留空）"
                    disabled={readOnly} value={req.requiredWhen ?? ''} maxLength={200}
                    onChange={(e) => updateRequiredInput(idx, { requiredWhen: e.target.value || null })} />}
                  {!readOnly && (
                    <button
                      type="button"
                      className="sks-link"
                      onClick={() => update({ requiredInputs: draft.requiredInputs.filter((_, j) => j !== idx) })}
                    >
                      删除
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="skm-field">
          <span>审片检查项（reviewChecklist，每行一项 → 审片节点）</span>
          <textarea
            rows={4}
            disabled={readOnly}
            value={draft.reviewChecklist.join('\n')}
            onChange={(e) => update({ reviewChecklist: linesToArray(e.target.value) })}
          />
        </label>

        <div className="skm-grid2">
          <label className="skm-field">
            <span>视觉构想模板（lookdevTemplate → lookdev-brief.md）</span>
            <textarea
              rows={5}
              disabled={readOnly}
              value={draft.lookdevTemplate ?? ''}
              onChange={(e) => update({ lookdevTemplate: e.target.value || null })}
            />
          </label>
          <label className="skm-field">
            <span>导演处理模板（filmPlanTemplate → film-plan.md）</span>
            <textarea
              rows={5}
              disabled={readOnly}
              value={draft.filmPlanTemplate ?? ''}
              onChange={(e) => update({ filmPlanTemplate: e.target.value || null })}
            />
          </label>
        </div>
      </section>

      <section className="skm-section">
        <h4>步骤映射与未映射步骤</h4>
        {draft.stepMapping.length === 0 ? (
          <p className="skm-empty">暂无步骤映射</p>
        ) : (
          <table className="skm-table">
            <thead>
              <tr><th>Skill 步骤</th><th>落入节点</th><th>说明</th></tr>
            </thead>
            <tbody>
              {draft.stepMapping.map((s, i) => (
                <tr key={i}>
                  <td>{s.step}</td>
                  <td><span className="skm-chip">{TARGET_NODE_LABEL[s.node] ?? s.node}</span></td>
                  <td>{s.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="skm-unmapped">
          <h5>放不进节点的步骤（unmapped）</h5>
          {draft.unmapped.length === 0 ? (
            <p className="skm-empty">无放不进节点的步骤</p>
          ) : (
            <ul>
              {draft.unmapped.map((u, i) => (
                <li key={i}><b>{u.step}</b>：<span>{u.reason}</span></li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="skm-section">
        <h4>方法指引（写入 skill-guide.md，共 {draft.guide.length} 段）</h4>
        {draft.guide.map((sec, idx) => (
          <div key={idx} className="skm-card">
            <div className="skm-card-head">
              <input
                disabled={readOnly}
                value={sec.title}
                onChange={(e) => {
                  const next = draft.guide.map((item, j) => (j === idx ? { ...item, title: e.target.value } : item))
                  update({ guide: next })
                }}
              />
              <span className="skm-source" title="出处文件">{sec.sources.join('、')}</span>
            </div>
            <textarea
              rows={4}
              disabled={readOnly}
              value={sec.body}
              onChange={(e) => {
                const next = draft.guide.map((item, j) => (j === idx ? { ...item, body: e.target.value } : item))
                update({ guide: next })
              }}
            />
          </div>
        ))}
      </section>

      <section className="skm-section">
        <h4>候选组件（共 {draft.components.length} 项 · 仅复制源码到项目供 Agent 参考）</h4>
        {draft.components.length === 0 ? (
          <p className="skm-empty">未引用外部组件文件</p>
        ) : (
          <ul className="skm-list">
            {draft.components.map((c, i) => (
              <li key={i}>
                <code className="num">{c.path}</code>
                <span>{c.purpose}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="skm-section">
        <h4>Skill 要求运行的脚本命令（禁止自动运行）</h4>
        {draft.instructedCommands.length === 0 ? (
          <p className="skm-empty">无指令要求运行的脚本</p>
        ) : (
          <div className="skm-cmd-list">
            {draft.instructedCommands.map((cmd, idx) => (
              <div key={idx} className="skm-cmd-row">
                <div className="skm-cmd-text">
                  <code>{cmd.command}</code>
                  {cmd.note && <small>{cmd.note}</small>}
                </div>
                <select
                  disabled={readOnly}
                  aria-label={`命令策略：${cmd.command}`}
                  value={cmd.decision}
                  onChange={(e) => {
                    const decision = e.target.value as InstructedCommandDecision
                    const next = draft.instructedCommands.map((item, j) => (j === idx ? { ...item, decision } : item))
                    update({ instructedCommands: next })
                  }}
                >
                  {INSTRUCTED_COMMAND_DECISION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

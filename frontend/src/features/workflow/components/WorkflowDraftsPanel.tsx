import { useCallback, useEffect, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { studioHttpApi } from '@/api'
import { ApiError } from '@/api/errors'
import type {
  WorkflowContextState,
  WorkflowDraft,
  WorkflowDraftName,
} from '@/api/workflowContext'
import type { WorkflowLegacyDrafts } from '@/features/workflow/model/workflowTemplates'

interface DraftSlotState {
  summary: WorkflowDraft | null
  detail: WorkflowDraft | null
  draftText: string
  loading: boolean
  saving: boolean
  error: string
  conflict: boolean
}

const DRAFT_META: Record<WorkflowDraftName, { title: string; filename: string; legacyKey: keyof WorkflowLegacyDrafts; placeholder: string }> = {
  'lookdev-brief': {
    title: '视觉构想',
    filename: 'lookdev-brief.md',
    legacyKey: 'lookdev',
    placeholder: '视觉基调、材质、色彩、光线、动势…',
  },
  'film-plan': {
    title: '导演处理',
    filename: 'film-plan.md',
    legacyKey: 'filmplan',
    placeholder: '叙事推进、镜头节奏、视听策略…',
  },
}

const INITIAL_SLOT: DraftSlotState = {
  summary: null,
  detail: null,
  draftText: '',
  loading: false,
  saving: false,
  error: '',
  conflict: false,
}

function isConflictError(err: unknown): boolean {
  if (err instanceof ApiError) return err.httpStatus === 409 || err.code === 'conflict'
  if (err && typeof err === 'object') {
    const rec = err as { httpStatus?: unknown; status?: unknown; code?: unknown }
    return rec.httpStatus === 409 || rec.status === 409 || rec.code === 'conflict'
  }
  return false
}

export function WorkflowDraftsPanel(props: {
  open: boolean
  onClose: () => void
  projectId: string | null
  legacyDrafts?: WorkflowLegacyDrafts
  onClearLegacyDraft: (key: keyof WorkflowLegacyDrafts) => void
}) {
  const { open, onClose, projectId, legacyDrafts, onClearLegacyDraft } = props
  const [active, setActive] = useState<WorkflowDraftName>('lookdev-brief')
  const [slots, setSlots] = useState<Record<WorkflowDraftName, DraftSlotState>>({
    'lookdev-brief': { ...INITIAL_SLOT },
    'film-plan': { ...INITIAL_SLOT },
  })
  const [ctxState, setCtxState] = useState<WorkflowContextState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')

  const refreshAll = useCallback(async (preserveEdits = false) => {
    if (!projectId) return
    setLoadError('')
    setSlots((prev) => ({
      'lookdev-brief': { ...prev['lookdev-brief'], loading: true, error: '' },
      'film-plan': { ...prev['film-plan'], loading: true, error: '' },
    }))
    try {
      const api = studioHttpApi().workflowContext
      const [summaries, state, lookdev, filmPlan] = await Promise.all([
        api.listDrafts(projectId),
        api.state(projectId).catch(() => null),
        api.getDraft(projectId, 'lookdev-brief'),
        api.getDraft(projectId, 'film-plan'),
      ])
      if (state) setCtxState(state)
      const byName = new Map(summaries.map((s) => [s.name, s]))
      setSlots((prev) => ({
        'lookdev-brief': {
          summary: byName.get('lookdev-brief') ?? null,
          detail: lookdev,
          draftText: preserveEdits ? prev['lookdev-brief'].draftText : (lookdev.content ?? ''),
          loading: false,
          saving: false,
          error: '',
          conflict: false,
        },
        'film-plan': {
          summary: byName.get('film-plan') ?? null,
          detail: filmPlan,
          draftText: preserveEdits ? prev['film-plan'].draftText : (filmPlan.content ?? ''),
          loading: false,
          saving: false,
          error: '',
          conflict: false,
        },
      }))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '读取项目工作稿失败')
      setSlots((prev) => ({
        'lookdev-brief': { ...prev['lookdev-brief'], loading: false },
        'film-plan': { ...prev['film-plan'], loading: false },
      }))
    }
  }, [projectId])

  useEffect(() => {
    if (!open || !projectId) return
    setNotice('')
    void refreshAll(false)
  }, [open, projectId, refreshAll])

  // 若打开面板时当前 tab 没有旧草稿而另一份有，自动定位到待处理的草稿
  useEffect(() => {
    if (!open) return
    if (!legacyDrafts?.lookdev?.trim() && legacyDrafts?.filmplan?.trim()) {
      setActive('film-plan')
    } else if (legacyDrafts?.lookdev?.trim()) {
      setActive('lookdev-brief')
    }
  }, [open, legacyDrafts?.lookdev, legacyDrafts?.filmplan])

  if (!open) return null

  const meta = DRAFT_META[active]
  const slot = slots[active]
  const serverContent = slot.detail?.content ?? ''
  const isDirty = slot.draftText !== serverContent
  const currentDraft = slot.detail ?? slot.summary
  const isTemplateOrMissing = currentDraft
    ? (!currentDraft.exists || currentDraft.template === true)
    : false
  const legacyText = legacyDrafts?.[meta.legacyKey]?.trim() ?? ''

  const saveContent = async (name: WorkflowDraftName, content: string, clearLegacyKey?: keyof WorkflowLegacyDrafts) => {
    if (!projectId) return
    const target = slots[name]
    setNotice('')
    setSlots((prev) => ({
      ...prev,
      [name]: { ...prev[name], saving: true, error: '', conflict: false },
    }))
    try {
      const saved = await studioHttpApi().workflowContext.saveDraft(projectId, name, {
        content,
        baseSha256: target.detail?.sha256 ?? target.summary?.sha256 ?? null,
      })
      const summaries = await studioHttpApi().workflowContext.listDrafts(projectId).catch(() => [])
      const nextSummary = summaries.find((s) => s.name === name) ?? saved
      setSlots((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          summary: nextSummary,
          detail: saved,
          draftText: saved.content ?? content,
          saving: false,
          error: '',
          conflict: false,
        },
      }))
      if (clearLegacyKey) onClearLegacyDraft(clearLegacyKey)
      setNotice(`已保存 ${DRAFT_META[name].filename}`)
    } catch (err) {
      const conflict = isConflictError(err)
      const msg = err instanceof Error ? err.message : '保存工作稿失败'
      setSlots((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          saving: false,
          conflict,
          error: conflict
            ? `保存冲突（409）：${msg || '文件已被外部修改或当前有制作任务正在运行，请刷新后再合并。'}`
            : msg,
        },
      }))
    }
  }

  return (
    <div className="wfe-drafts-overlay" role="dialog" aria-modal="true" aria-label="项目工作稿">
      <div className="wfe-drafts-panel">
        <header className="wfe-drafts-head">
          <div>
            <b>项目工作稿（落盘文件）</b>
            <span>lookdev-brief.md · film-plan.md，由 Agent 在制作阶段读取，不占用画布连线</span>
          </div>
          <div className="wfe-drafts-head-actions">
            {projectId && (
              <button type="button" className="wfe-btn sm" disabled={slot.loading || slot.saving} onClick={() => void refreshAll(false)}>
                刷新
              </button>
            )}
            <button type="button" className="wfe-iconbtn" aria-label="关闭工作稿面板" onClick={onClose}>
              <UiIcon icon={SemIcons.close} size="md" />
            </button>
          </div>
        </header>

        {ctxState?.originalIntegrity === 'suspect' && (
          <div className="wfe-drafts-alert is-warn" role="alert">
            <b>原始需求（prompt.original.md）完整性存疑</b>
            <p>{ctxState.originalIntegrityReasons?.length ? ctxState.originalIntegrityReasons.join('；') : '检测到原文存在重复段落或混入了工作稿模板标题。系统只做报告，不会自动改写原文。'}</p>
          </div>
        )}

        {!projectId ? (
          <div className="wfe-drafts-empty">
            <p>当前工作流尚未关联项目。请先在顶部工具栏关联一个项目，再查看和保存 `lookdev-brief.md` 与 `film-plan.md`。</p>
            {(legacyDrafts?.lookdev?.trim() || legacyDrafts?.filmplan?.trim()) && (
              <div className="wfe-drafts-legacy-readonly">
                <b>迁移保留的旧工作稿内容</b>
                {legacyDrafts.lookdev?.trim() && (
                  <div><span>视觉构想（lookdev）：</span><pre>{legacyDrafts.lookdev}</pre></div>
                )}
                {legacyDrafts.filmplan?.trim() && (
                  <div><span>导演处理（filmplan）：</span><pre>{legacyDrafts.filmplan}</pre></div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="wfe-drafts-tabs" role="tablist" aria-label="工作稿文件">
              {(['lookdev-brief', 'film-plan'] as WorkflowDraftName[]).map((name) => {
                const m = DRAFT_META[name]
                const hasLeg = Boolean(legacyDrafts?.[m.legacyKey]?.trim())
                const sum = slots[name].summary
                return (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={active === name}
                    data-on={active === name ? '' : undefined}
                    onClick={() => { setActive(name); setNotice('') }}
                  >
                    <span>{m.title}</span>
                    <small>{m.filename}</small>
                    {sum && (
                      <em className="wfe-drafts-badge">
                        {!sum.exists ? '未建' : sum.template === true ? '模板' : sum.template === null ? '已存' : '已写'}
                      </em>
                    )}
                    {hasLeg && <em className="wfe-drafts-badge is-warn">待迁移</em>}
                  </button>
                )
              })}
            </div>

            {loadError && <div className="wfe-drafts-alert is-err" role="alert">{loadError}</div>}
            {notice && <div className="wfe-drafts-alert is-ok" role="status">{notice}</div>}

            {legacyText && (
              <div className="wfe-drafts-legacy-banner">
                <div className="wfe-drafts-legacy-banner-head">
                  <b>旧工作流保留的「{meta.title}」内容尚未写入 {meta.filename}</b>
                  <div className="wfe-drafts-legacy-actions">
                    {isTemplateOrMissing ? (
                      <button
                        type="button"
                        className="wfe-btn sm is-primary"
                        disabled={slot.loading || slot.saving}
                        onClick={() => void saveContent(active, legacyText, meta.legacyKey)}
                      >
                        一键写入
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="wfe-btn sm is-primary"
                        disabled={slot.loading || slot.saving}
                        onClick={() => {
                          const merged = serverContent.trimEnd()
                            ? `${serverContent.trimEnd()}\n\n${legacyText}`
                            : legacyText
                          void saveContent(active, merged, meta.legacyKey)
                        }}
                      >
                        追加到文件末尾
                      </button>
                    )}
                    <button
                      type="button"
                      className="wfe-btn sm"
                      disabled={slot.saving}
                      onClick={() => {
                        onClearLegacyDraft(meta.legacyKey)
                        setNotice(`已放弃旧版「${meta.title}」草稿`)
                      }}
                    >
                      放弃
                    </button>
                  </div>
                </div>

                {isTemplateOrMissing ? (
                  <pre className="wfe-drafts-legacy-preview">{legacyText}</pre>
                ) : (
                  <div className="wfe-drafts-compare">
                    <div className="wfe-drafts-compare-col">
                      <span>项目当前文件（{meta.filename}）</span>
                      <pre>{serverContent || '（空）'}</pre>
                    </div>
                    <div className="wfe-drafts-compare-col">
                      <span>旧画布保留内容（待处理）</span>
                      <pre>{legacyText}</pre>
                    </div>
                  </div>
                )}
              </div>
            )}

            {slot.error && (
              <div className={`wfe-drafts-alert ${slot.conflict ? 'is-warn' : 'is-err'}`} role="alert">
                <span>{slot.error}</span>
                {slot.conflict && (
                  <div className="wfe-drafts-conflict-actions">
                    <button type="button" className="wfe-btn sm" onClick={() => void refreshAll(false)}>
                      放弃当前修改并拉取最新版本
                    </button>
                    <button type="button" className="wfe-btn sm" onClick={() => void refreshAll(true)}>
                      仅更新 sha256（保留输入以便覆盖）
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="wfe-drafts-editor">
              <div className="wfe-drafts-meta">
                <span>状态：{!currentDraft?.exists ? '尚未创建' : currentDraft.template === true ? '模板原样' : currentDraft.template === null ? '已有文件（未比对模板）' : '已有内容'}</span>
                {slot.detail?.sha256 && <span className="num">sha256: {slot.detail.sha256.slice(0, 12)}</span>}
                {(slot.detail?.updatedAt ?? slot.summary?.updatedAt) && <span>更新于 {new Date((slot.detail?.updatedAt ?? slot.summary?.updatedAt)!).toLocaleString('zh-CN')}</span>}
              </div>
              <textarea
                rows={14}
                disabled={slot.loading || slot.saving}
                value={slot.draftText}
                onChange={(e) => {
                  const val = e.target.value
                  setSlots((prev) => ({ ...prev, [active]: { ...prev[active], draftText: val } }))
                }}
                placeholder={meta.placeholder}
              />
              <div className="wfe-drafts-foot">
                <span className="wfe-hint">{isDirty ? '有未保存更改' : '已与项目文件同步'}</span>
                <button
                  type="button"
                  className="wfe-btn is-primary"
                  disabled={slot.loading || slot.saving || !isDirty}
                  onClick={() => void saveContent(active, slot.draftText)}
                >
                  {slot.saving ? '保存中…' : `保存 ${meta.filename}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { studioHttpApi } from '@/api'
import { extractPresetValidationErrors, type SkillPackage, type WorkflowPreset } from '@/api/skillPresets'
import { ImportAddressStep } from './ImportAddressStep'
import { PackageInventoryStep } from './PackageInventoryStep'
import { PresetReview } from './PresetReview'
import { useMappingGeneration } from './useMappingGeneration'
import { IMPORT_STEPS, STATUS_LABEL, packageLabel, shortSha, type ImportStep } from './importDisplay'
import '@/features/workflow/styles/github-import.css'

type View = { kind: 'import' } | { kind: 'package'; id: string } | { kind: 'preset'; id: string }

/**
 * 从 GitHub 导入：地址 → 清点 → 生成 → 审阅 → 启用，五步在一个面板里走完。
 * 左栏是已导入的 Skill 包，各自生成的预设挂在包下面；启用后可以直接用它新建工作流。
 */
export function GithubImportPanel(props: {
  open: boolean
  onClose: () => void
  onPresetsChanged?: () => void
  onUsePreset: (preset: WorkflowPreset) => void
}) {
  const { open, onClose, onPresetsChanged, onUsePreset } = props
  const [packages, setPackages] = useState<SkillPackage[] | null>(null)
  const [presets, setPresets] = useState<WorkflowPreset[]>([])
  const [details, setDetails] = useState<Record<string, SkillPackage>>({})
  const [view, setView] = useState<View>({ kind: 'import' })
  const [listError, setListError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const dialog = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      const api = studioHttpApi().skillPresets
      const [pkgs, all] = await Promise.all([api.listSkillPackages(), api.listPresets('all').catch(() => [] as WorkflowPreset[])])
      setPackages(pkgs)
      setPresets(all.filter((p) => p.status !== 'archived'))
      setListError('')
      return pkgs
    } catch (err) {
      setPackages((prev) => prev ?? [])
      setListError(extractPresetValidationErrors(err)[0] ?? '读取失败')
      return null
    }
  }, [])

  /* 打开时（父组件只在打开时挂载本面板，状态每次从头开始）：有包就停在第一个包，没有就停在填地址 */
  useEffect(() => {
    if (!open) return
    void refresh().then((pkgs) => setView(pkgs?.length ? { kind: 'package', id: pkgs[0].id } : { kind: 'import' }))
  }, [open, refresh])

  const presetOf = view.kind === 'preset' ? presets.find((p) => p.id === view.id) ?? null : null
  const packageId = view.kind === 'package' ? view.id : presetOf?.skillPackageId ?? null

  useEffect(() => {
    if (!open || !packageId || details[packageId]?.report) return
    let alive = true
    void studioHttpApi().skillPresets.getSkillPackage(packageId)
      .then((d) => { if (alive) setDetails((prev) => ({ ...prev, [d.id]: d })) })
      .catch((err) => { if (alive) setListError(extractPresetValidationErrors(err)[0] ?? '读取失败') })
    return () => { alive = false }
  }, [open, packageId, details])

  const generation = useMappingGeneration(view.kind === 'package' ? view.id : null, {
    onDone: (preset) => {
      setPresets((prev) => [preset, ...prev.filter((p) => p.id !== preset.id)])
      setView({ kind: 'preset', id: preset.id })
      setNotice('预设草稿已生成，并通过了格式和职责校验。逐项看一遍，再启用。')
      onPresetsChanged?.()
    },
    onCancelled: () => setNotice('已取消生成'),
  })

  /* Esc 关闭；焦点留在面板里 */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose() }
    window.addEventListener('keydown', onKey)
    dialog.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const step: ImportStep = useMemo(() => {
    if (view.kind === 'import') return 0
    if (view.kind === 'package') return generation.generating?.packageId === view.id ? 2 : 1
    return presetOf?.status === 'active' ? 4 : 3
  }, [view, generation.generating, presetOf])

  if (!open) return null

  const byPackage = (id: string) => presets.filter((p) => p.skillPackageId === id)
  const orphans = presets.filter((p) => !packages?.some((pkg) => pkg.id === p.skillPackageId))
  const current = packageId ? details[packageId] : null

  const removePackage = async (id: string) => {
    try {
      await studioHttpApi().skillPresets.deleteSkillPackage(id)
      setDeleting(null)
      const pkgs = await refresh()
      if (packageId === id) setView(pkgs?.length ? { kind: 'package', id: pkgs[0].id } : { kind: 'import' })
      setNotice('已删除 Skill 包。用它生成的预设保留，但草稿不能再修改。')
    } catch (err) {
      setNotice(extractPresetValidationErrors(err)[0] ?? '删除失败')
    }
  }

  const presetRow = (p: WorkflowPreset) => (
    <button key={p.id} type="button" className="gi-rail-preset" aria-current={view.kind === 'preset' && view.id === p.id ? 'true' : undefined}
            onClick={() => { setNotice(''); setView({ kind: 'preset', id: p.id }) }}>
      <span>{p.name || p.mapping.name || p.skillPath}</span>
      <em className="gi-status" data-status={p.status}>{STATUS_LABEL[p.status]}</em>
    </button>
  )

  return (
    <div className="gi-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="gi-dialog" role="dialog" aria-modal="true" aria-labelledby="gi-title" tabIndex={-1} ref={dialog}>
        <header className="gi-top">
          <h2 id="gi-title">从 GitHub 导入</h2>
          <ol className="gi-stepper" aria-label="导入进度">
            {IMPORT_STEPS.map((label, i) => (
              <li key={label} data-state={i < step ? 'done' : i === step ? 'current' : undefined} aria-current={i === step ? 'step' : undefined}>
                <span className="gi-stepper-dot">{i < step ? <UiIcon icon={SemIcons.check} size="xs" /> : i + 1}</span>{label}
              </li>
            ))}
          </ol>
          <button type="button" className="wf-icon" aria-label="关闭" onClick={onClose}><UiIcon icon={SemIcons.close} size="md" /></button>
        </header>

        <div className="gi-body">
          <aside className="gi-rail" aria-label="已导入的 Skill 包">
            <button type="button" className="gi-rail-new" aria-current={view.kind === 'import' ? 'true' : undefined} onClick={() => { setNotice(''); setView({ kind: 'import' }) }}>
              <UiIcon icon={SemIcons.plus} size="sm" />导入新仓库
            </button>
            <div className="gi-rail-label">已导入<span>{packages?.length ?? ''}</span></div>
            {packages === null && <p className="gi-muted gi-rail-note">读取中…</p>}
            {packages?.length === 0 && !listError && <p className="gi-muted gi-rail-note">还没有导入过</p>}
            {listError && <p className="gi-bad-text gi-rail-note" role="alert">{listError}</p>}
            {packages?.map((p) => (
              <div key={p.id} className="gi-rail-group">
                <div className="gi-rail-pkg" aria-current={view.kind === 'package' && view.id === p.id ? 'true' : undefined}>
                  <button type="button" className="gi-rail-pkg-main" onClick={() => { setNotice(''); setDeleting(null); setView({ kind: 'package', id: p.id }) }}>
                    <b>{packageLabel(p)}</b>
                    <small>@{shortSha(p.commitSha)}{p.subPath ? ` · ${p.subPath}` : ''}</small>
                  </button>
                  <button type="button" className="wf-icon gi-rail-del" aria-label={`删除 ${packageLabel(p)}`} title="删除 Skill 包" onClick={() => setDeleting(deleting === p.id ? null : p.id)}>
                    <UiIcon icon={SemIcons.trash} size="sm" />
                  </button>
                </div>
                {deleting === p.id && (
                  <div className="gi-rail-confirm">
                    <span>删除包和下载的文件？</span>
                    <button type="button" className="wf-secondary sm" onClick={() => setDeleting(null)}>取消</button>
                    <button type="button" className="wf-danger sm" onClick={() => void removePackage(p.id)}>删除</button>
                  </div>
                )}
                {byPackage(p.id).length > 0 && <div className="gi-rail-presets">{byPackage(p.id).map(presetRow)}</div>}
              </div>
            ))}
            {orphans.length > 0 && (
              <div className="gi-rail-group">
                <div className="gi-rail-label">来源已删除</div>
                <div className="gi-rail-presets">{orphans.map(presetRow)}</div>
              </div>
            )}
          </aside>

          <main className="gi-main">
            <div className="gi-main-inner">
              {notice && view.kind !== 'preset' && <p className="gi-alert" data-tone="ok" role="status">{notice}</p>}
              {view.kind === 'import' && (
                <ImportAddressStep onImported={(res) => {
                  setDetails((prev) => ({ ...prev, [res.skillPackage.id]: res.skillPackage }))
                  setView({ kind: 'package', id: res.skillPackage.id })
                  setNotice(res.reused ? `这个 commit（${shortSha(res.skillPackage.commitSha)}）已经导入过，下面是当时的清点结果。` : '')
                  void refresh()
                }} />
              )}
              {view.kind === 'package' && (current
                ? <PackageInventoryStep
                    pkg={current}
                    presets={byPackage(current.id)}
                    generating={generation.generating}
                    elapsedMs={generation.elapsedMs}
                    failure={generation.failure}
                    onGenerate={(path) => { setNotice(''); void generation.start(path) }}
                    onCancel={() => void generation.cancel()}
                    onOpenPreset={(p) => { setNotice(''); setView({ kind: 'preset', id: p.id }) }}
                  />
                : <p className="gi-muted">正在读取清点结果…</p>)}
              {view.kind === 'preset' && (presetOf
                ? <>
                    {notice && <p className="gi-alert" data-tone="ok" role="status">{notice}</p>}
                    <PresetReview
                      key={presetOf.id}
                      preset={presetOf}
                      onUpdated={(next, event) => {
                        setPresets((prev) => prev.map((x) => (x.id === next.id ? next : x)))
                        if (event === 'activated') setNotice('')
                        onPresetsChanged?.()
                      }}
                      onArchived={(id) => {
                        setPresets((prev) => prev.filter((x) => x.id !== id))
                        setView(presetOf.skillPackageId && packages?.some((p) => p.id === presetOf.skillPackageId) ? { kind: 'package', id: presetOf.skillPackageId } : { kind: 'import' })
                        setNotice('预设已归档')
                        onPresetsChanged?.()
                      }}
                      onUse={onUsePreset}
                    />
                  </>
                : <p className="gi-muted">这个预设已经不在了。</p>)}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

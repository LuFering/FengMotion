import { useCallback, useEffect, useState } from 'react'
import { UiIcon, SemIcons } from '@/components/icons/UiIcon'
import { studioHttpApi } from '@/services/api'
import {
  extractPresetValidationErrors,
  type SkillPackage,
  type WorkflowPreset,
} from '@/services/api/skillPresets'
import { SkillPresetMappingEditor } from './SkillPresetMappingEditor'
import '@/styles/skill-presets.css'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function SkillPresetStudio(props: {
  open: boolean
  onClose: () => void
  onPresetsChanged?: () => void
}) {
  const { open, onClose, onPresetsChanged } = props

  const [repoInput, setRepoInput] = useState('')
  const [refInput, setRefInput] = useState('')
  const [pathInput, setPathInput] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [packages, setPackages] = useState<SkillPackage[]>([])
  const [presets, setPresets] = useState<WorkflowPreset[]>([])
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null)
  const [pkgDetail, setPkgDetail] = useState<SkillPackage | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<WorkflowPreset | null>(null)
  const [rightMode, setRightMode] = useState<'inventory' | 'mapping'>('inventory')
  const [invTab, setInvTab] = useState<'skills' | 'scripts' | 'deps'>('skills')

  const [loadingList, setLoadingList] = useState(false)
  const [importing, setImporting] = useState(false)
  const [generatingSkill, setGeneratingSkill] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState('')

  const refreshLists = useCallback(async () => {
    setLoadingList(true)
    try {
      const api = studioHttpApi().skillPresets
      const [pkgs, allPresets] = await Promise.all([
        api.listSkillPackages(),
        api.listPresets('all').catch(() => [] as WorkflowPreset[]),
      ])
      setPackages(pkgs)
      setPresets(allPresets.filter((p) => p.status !== 'archived'))
      if (!selectedPkgId && pkgs.length > 0) setSelectedPkgId(pkgs[0].id)
    } catch (err) {
      setErrors(extractPresetValidationErrors(err))
    } finally {
      setLoadingList(false)
    }
  }, [selectedPkgId])

  useEffect(() => {
    if (!open) return
    setErrors([])
    setNotice('')
    void refreshLists()
  }, [open, refreshLists])

  useEffect(() => {
    if (!open || !selectedPkgId) { setPkgDetail(null); return }
    let alive = true
    void studioHttpApi().skillPresets.getSkillPackage(selectedPkgId)
      .then((detail) => { if (alive) setPkgDetail(detail) })
      .catch((err) => { if (alive) setErrors(extractPresetValidationErrors(err)) })
    return () => { alive = false }
  }, [open, selectedPkgId])

  if (!open) return null

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    const repository = repoInput.trim()
    if (!repository || importing) return
    setImporting(true)
    setErrors([])
    setNotice('')
    try {
      const res = await studioHttpApi().skillPresets.importSkillPackage({
        repository,
        ...(refInput.trim() ? { ref: refInput.trim() } : {}),
        ...(pathInput.trim() ? { path: pathInput.trim() } : {}),
      })
      setRepoInput('')
      setRefInput('')
      setPathInput('')
      setSelectedPkgId(res.skillPackage.id)
      setPkgDetail(res.skillPackage)
      setRightMode('inventory')
      setNotice(
        res.reused
          ? `同一 commit（${res.skillPackage.commitSha.slice(0, 7)}）已导入，已加载现有静态清单。`
          : `已导入 ${res.skillPackage.owner}/${res.skillPackage.repo}@${res.skillPackage.commitSha.slice(0, 7)}（只读清点完成，未执行任何脚本）。`,
      )
      await refreshLists()
    } catch (err) {
      setErrors(extractPresetValidationErrors(err))
    } finally {
      setImporting(false)
    }
  }

  const handleGenerateMapping = async (pkg: SkillPackage, skillPath: string) => {
    if (generatingSkill) return
    setGeneratingSkill(skillPath)
    setErrors([])
    setNotice('')
    try {
      const created = await studioHttpApi().skillPresets.generateMapping(pkg.id, skillPath)
      setSelectedPreset(created)
      setRightMode('mapping')
      setNotice('已生成映射草稿并通过后端校验，请审阅细节后启用。')
      await refreshLists()
    } catch (err) {
      setErrors(extractPresetValidationErrors(err))
    } finally {
      setGeneratingSkill(null)
    }
  }

  const openPreset = async (preset: WorkflowPreset) => {
    setErrors([])
    setNotice('')
    try {
      const fresh = await studioHttpApi().skillPresets.getPreset(preset.id)
      setSelectedPreset(fresh)
      setRightMode('mapping')
    } catch (err) {
      setErrors(extractPresetValidationErrors(err))
    }
  }

  const handleDeletePackage = async (pkgId: string) => {
    setErrors([])
    try {
      await studioHttpApi().skillPresets.deleteSkillPackage(pkgId)
      if (selectedPkgId === pkgId) { setSelectedPkgId(null); setPkgDetail(null) }
      await refreshLists()
    } catch (err) {
      setErrors(extractPresetValidationErrors(err))
    }
  }

  const report = pkgDetail?.report

  return (
    <div className="sks-overlay" role="dialog" aria-modal="true" aria-label="Skill 包导入与视频类型映射">
      <div className="sks-modal">
        <header className="sks-header">
          <div>
            <h2>视频类型与 Skill 预设</h2>
            <p>导入 GitHub Skill 包 → 静态清点风险 → 模型建议并校验映射 → 人工审阅后启用为视频类型</p>
          </div>
          <button type="button" className="wf-icon" aria-label="关闭 Skill 预设管理" onClick={onClose}>
            <UiIcon icon={SemIcons.close} size="md" />
          </button>
        </header>

        <div className="sks-body">
          <aside className="sks-side">
            <form className="sks-import-form" onSubmit={(e) => void handleImport(e)}>
              <label>
                <span>导入 GitHub Skill 仓库</span>
                <input
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  placeholder="https://github.com/owner/repo 或 owner/repo"
                  disabled={importing}
                />
              </label>
              <button type="button" className="sks-link" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? '收起可选参数' : '指定分支 / commit / 子目录'}
              </button>
              {showAdvanced && (
                <div className="sks-adv">
                  <input value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="分支 / tag / commit（可选）" disabled={importing} />
                  <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder="只导入的子目录（可选）" disabled={importing} />
                </div>
              )}
              <button type="submit" className="wf-primary" disabled={importing || !repoInput.trim()}>
                {importing ? '正在拉取并静态清点…' : '导入并查看清单'}
              </button>
            </form>

            <div className="sks-group">
              <div className="sks-group-head">
                <b>已导入 Skill 包</b>
                <span>{packages.length}</span>
              </div>
              {loadingList && packages.length === 0 && <p className="sks-empty">读取中…</p>}
              {!loadingList && packages.length === 0 && <p className="sks-empty">尚未导入任何 Skill 包</p>}
              <div className="sks-items">
                {packages.map((p) => (
                  <div key={p.id} className="sks-item" data-on={rightMode === 'inventory' && selectedPkgId === p.id ? '' : undefined}>
                    <button type="button" className="sks-item-main" onClick={() => { setSelectedPkgId(p.id); setRightMode('inventory'); setErrors([]) }}>
                      <b>{p.owner}/{p.repo}</b>
                      <small className="num">@{p.commitSha.slice(0, 7)} · {p.fileCount} 文件</small>
                    </button>
                    <button type="button" className="wf-icon" title="删除包" aria-label={`删除 ${p.owner}/${p.repo}`} onClick={() => void handleDeletePackage(p.id)}>
                      <UiIcon icon={SemIcons.trash} size="xs" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="sks-group">
              <div className="sks-group-head">
                <b>工作流预设（草稿 / 已启用）</b>
                <span>{presets.length}</span>
              </div>
              {presets.length === 0 && <p className="sks-empty">暂无生成预设；从右侧选 SKILL.md 生成</p>}
              <div className="sks-items">
                {presets.map((pr) => (
                  <button
                    key={pr.id}
                    type="button"
                    className="sks-item sks-preset-item"
                    data-on={rightMode === 'mapping' && selectedPreset?.id === pr.id ? '' : undefined}
                    onClick={() => void openPreset(pr)}
                  >
                    <b>{pr.name || pr.mapping.name || pr.skillPath}</b>
                    <span className="skm-status" data-status={pr.status}>
                      {pr.status === 'active' ? '已启用' : pr.status === 'draft' ? '草稿' : '归档'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <main className="sks-main">
            {errors.length > 0 && (
              <div className="skm-banner is-err" role="alert">
                <b>操作未通过</b>
                <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
            {notice && <p className="skm-banner is-ok" role="status">{notice}</p>}

            {rightMode === 'mapping' && selectedPreset ? (
              <SkillPresetMappingEditor
                preset={selectedPreset}
                onUpdated={(next) => {
                  setSelectedPreset(next)
                  setPresets((prev) => prev.map((x) => (x.id === next.id ? next : x)))
                  onPresetsChanged?.()
                }}
                onArchived={(id) => {
                  setPresets((prev) => prev.filter((x) => x.id !== id))
                  setSelectedPreset(null)
                  setRightMode('inventory')
                  setNotice('已归档该预设')
                  onPresetsChanged?.()
                }}
              />
            ) : pkgDetail && report ? (
              <div className="sks-inv">
                <div className="sks-inv-head">
                  <div>
                    <h3>{pkgDetail.owner}/{pkgDetail.repo}</h3>
                    <p className="skm-meta">
                      commit <code className="num">{pkgDetail.commitSha.slice(0, 12)}</code>
                      {pkgDetail.subPath ? ` · 子目录 ${pkgDetail.subPath}` : ''}
                      {' · '}共 {report.summary.files} 个文件（{formatBytes(report.summary.totalBytes)}）
                      {' · '}许可证 <b>{report.license.spdx || 'unknown'}</b>
                    </p>
                  </div>
                </div>

                {report.warnings.length > 0 && (
                  <div className="skm-banner is-warn">
                    <b>清点警告</b>
                    <ul>{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </div>
                )}

                <div className="sks-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={invTab === 'skills'} data-on={invTab === 'skills' ? '' : undefined} onClick={() => setInvTab('skills')}>
                    包含 Skill（{report.skills.length}）
                  </button>
                  <button type="button" role="tab" aria-selected={invTab === 'scripts'} data-on={invTab === 'scripts' ? '' : undefined} onClick={() => setInvTab('scripts')}>
                    脚本与命令风险（{report.scripts.length + report.instructedCommands.length}）
                  </button>
                  <button type="button" role="tab" aria-selected={invTab === 'deps'} data-on={invTab === 'deps' ? '' : undefined} onClick={() => setInvTab('deps')}>
                    依赖与许可证
                  </button>
                </div>

                {invTab === 'skills' && (
                  <div className="sks-skill-list">
                    {report.skills.length === 0 && <p className="sks-empty">该包中没有检测到 SKILL.md。</p>}
                    {report.skills.map((s) => (
                      <article key={s.path} className="sks-skill-card">
                        <div className="sks-skill-copy">
                          <b>{s.name || s.directory || s.path}</b>
                          <code className="num">{s.path}</code>
                          {s.description && <p>{s.description}</p>}
                          {s.frontmatterError && <p className="sks-err">frontmatter 解析错误：{s.frontmatterError}</p>}
                        </div>
                        <button
                          type="button"
                          className="wf-primary"
                          disabled={generatingSkill !== null}
                          onClick={() => void handleGenerateMapping(pkgDetail, s.path)}
                        >
                          {generatingSkill === s.path ? '正在生成映射（最多 120s）…' : '生成工作流映射'}
                        </button>
                      </article>
                    ))}
                  </div>
                )}

                {invTab === 'scripts' && (
                  <div className="sks-risks">
                    <p className="skm-banner is-info">所有脚本均未执行；生成映射后需人工在策略中选择「用本项目自己的检查替代 / 需人工批准 / 忽略」。</p>
                    <h4>脚本文件 / npm scripts（{report.scripts.length}）</h4>
                    {report.scripts.length === 0 ? <p className="sks-empty">无脚本文件</p> : (
                      <ul className="skm-list">
                        {report.scripts.map((sc, i) => (
                          <li key={i}>
                            <code className="num">{sc.path}{sc.name ? ` (${sc.name})` : ''}</code>
                            <span>[{sc.kind}] {sc.reason}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <h4>SKILL.md 要求运行的命令（{report.instructedCommands.length}）</h4>
                    {report.instructedCommands.length === 0 ? <p className="sks-empty">无命令指令</p> : (
                      <ul className="skm-list">
                        {report.instructedCommands.map((c, i) => (
                          <li key={i}>
                            <code>{c.command}</code>
                            <span>来自 {c.skillPath}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {invTab === 'deps' && (
                  <div className="sks-deps">
                    <dl className="sks-kv">
                      <dt>许可证 SPDX</dt><dd>{report.license.spdx || 'unknown'}</dd>
                      <dt>许可证文件</dt><dd>{report.license.files.join('、') || '无'}</dd>
                      <dt>声明的依赖</dt><dd>{Object.keys(report.dependencies.declared).length} 项</dd>
                      <dt>Remotion 依赖</dt><dd>{Object.entries(report.dependencies.remotionPackages).map(([k, v]) => `${k}@${v}`).join('、') || '无'}</dd>
                      <dt>未声明但使用的包</dt><dd>{report.dependencies.undeclared.join('、') || '无'}</dd>
                      <dt>无法解析的本地引用</dt><dd>{report.summary.unresolvedImports} 处</dd>
                    </dl>
                    {report.dependencies.approximate && (
                      <p className="sks-empty">依赖通过静态正则提取（approximate），仅作审阅参考。</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="sks-placeholder">
                <b>从左侧导入或选择一个 Skill 包</b>
                <p>导入后可查看 Skill 列表、脚本风险、依赖与许可证，并将任一 SKILL.md 映射为工作流视频类型。</p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

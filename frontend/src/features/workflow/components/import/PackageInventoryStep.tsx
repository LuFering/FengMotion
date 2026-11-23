import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import type { SkillPackage, WorkflowPreset } from '@/api/skillPresets'
import type { GenerationFailure, GenerationState } from './useMappingGeneration'
import { STAGE_LABEL, STATUS_LABEL, formatBytes, formatElapsed, groupProblems, packageLabel, problemLabel, shortSha } from './importDisplay'

/**
 * 第 2、3 步：清点结果一屏摘要 + 选 SKILL.md 生成预设草稿。
 * 脚本、命令和依赖的明细收在下面，需要时再展开。
 */
export function PackageInventoryStep(props: {
  pkg: SkillPackage
  presets: WorkflowPreset[]
  generating: GenerationState | null
  elapsedMs: number
  failure: GenerationFailure | null
  onGenerate: (skillPath: string) => void
  onCancel: () => void
  onOpenPreset: (preset: WorkflowPreset) => void
}) {
  const { pkg, presets, generating, elapsedMs, failure, onGenerate, onCancel, onOpenPreset } = props
  const report = pkg.report
  if (!report) return <p className="gi-muted">正在读取清点结果…</p>

  const single = report.skills.length === 1
  const busyHere = generating?.packageId === pkg.id
  const commands = report.instructedCommands.length
  const license = report.license.spdx || 'unknown'

  return (
    <div className="gi-inventory">
      <header className="gi-head">
        <h3>{packageLabel(pkg)}</h3>
        <p className="gi-meta">
          <a href={`https://github.com/${pkg.owner}/${pkg.repo}/tree/${pkg.commitSha}${pkg.subPath ? `/${pkg.subPath}` : ''}`} target="_blank" rel="noreferrer" className="gi-mono" title={pkg.commitSha}>@{shortSha(pkg.commitSha)}</a>
          {pkg.subPath && <><i />子目录 <code>{pkg.subPath}</code></>}
          <i />{report.summary.files} 个文件 · {formatBytes(report.summary.totalBytes)}
          <i />导入于 {new Date(pkg.importedAt).toLocaleDateString('zh-CN')}
        </p>
      </header>

      <dl className="gi-facts">
        <div><dt>Skill</dt><dd>{report.skills.length} 个</dd></div>
        <div><dt>脚本</dt><dd>{report.scripts.length} 个<small>均未运行</small></dd></div>
        <div data-tone={commands ? 'warn' : undefined}><dt>要求运行的命令</dt><dd>{commands} 条{commands > 0 && <small>审阅时由你决定</small>}</dd></div>
        <div data-tone={license === 'unknown' ? 'warn' : undefined}><dt>许可证</dt><dd>{license === 'unknown' ? '未识别' : license}</dd></div>
      </dl>

      {report.warnings.length > 0 && (
        <div className="gi-alert" data-tone="warn">
          <b>清点时发现</b>
          <ul>{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      <section className="gi-section">
        <h4>{single ? '生成预设' : '选一个 Skill 生成预设'}</h4>
        {report.skills.length === 0 && <p className="gi-muted">这个包里没有 SKILL.md，不能生成预设。</p>}
        <ul className="gi-skills">
          {report.skills.map((s) => {
            const existing = presets.filter((p) => p.skillPath === s.path)
            const running = busyHere && generating?.skillPath === s.path
            const failed = failure?.skillPath === s.path && !running ? failure : null
            const blocked = !!generating && !running
            return (
              <li key={s.path} className="gi-skill" data-running={running || undefined}>
                <div className="gi-skill-main">
                  <div className="gi-skill-copy">
                    <b>{s.name || s.directory || s.path}</b>
                    <code>{s.path}</code>
                    {s.description && <p>{s.description}</p>}
                    {s.frontmatterError && <p className="gi-bad-text">frontmatter 解析失败：{s.frontmatterError}</p>}
                  </div>
                  <div className="gi-skill-actions">
                    {existing.map((p) => (
                      <button key={p.id} type="button" className="gi-chip" data-status={p.status} onClick={() => onOpenPreset(p)} title={`打开${STATUS_LABEL[p.status]}「${p.name || p.mapping.name}」`}>
                        {STATUS_LABEL[p.status]}<UiIcon icon={SemIcons.forward} size="xs" />
                      </button>
                    ))}
                    {!running && (
                      <button type="button" className={single && !existing.length ? 'wf-primary' : 'wf-secondary'} disabled={blocked} onClick={() => onGenerate(s.path)}
                              title={blocked ? '另一个预设正在生成，完成后再试' : undefined}>
                        {existing.length ? '重新生成' : '生成预设草稿'}
                      </button>
                    )}
                  </div>
                </div>

                {running && generating && (
                  <div className="gi-progress" role="status" aria-live="polite">
                    <UiIcon icon={SemIcons.loading} size="sm" className="gi-spin" />
                    <span className="gi-progress-stage">{generating.stage ? STAGE_LABEL[generating.stage] : '正在生成预设草稿'}</span>
                    <span className="gi-progress-time">已用 {formatElapsed(elapsedMs)}</span>
                    {generating.mode === 'job'
                      ? <button type="button" className="wf-secondary sm" disabled={generating.cancelling} onClick={onCancel}>{generating.cancelling ? '正在取消…' : '取消'}</button>
                      : <span className="gi-muted">通常 30–120 秒，生成中不能取消</span>}
                  </div>
                )}

                {failed && (
                  <div className="gi-alert" data-tone="bad" role="alert">
                    <b>{failed.problems.length ? '模型给出的预设没有通过校验，没有保存' : failed.message}</b>
                    {failed.problems.length > 0 && (
                      <ul>{groupProblems(failed.problems).map((p, i) => <li key={i}>{problemLabel(p) && <em>{problemLabel(p)}：</em>}{p.message}</li>)}</ul>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <details className="gi-details">
        <summary>脚本与命令<span>{report.scripts.length + commands}</span></summary>
        <h5>脚本文件与 npm scripts</h5>
        {report.scripts.length === 0 ? <p className="gi-muted">没有脚本</p> : (
          <ul className="gi-rows">{report.scripts.map((sc, i) => <li key={i}><code>{sc.path}{sc.name ? ` · ${sc.name}` : ''}</code><span>{sc.reason}</span></li>)}</ul>
        )}
        <h5>SKILL.md 要求运行的命令</h5>
        {commands === 0 ? <p className="gi-muted">没有</p> : (
          <ul className="gi-rows">{report.instructedCommands.map((c, i) => <li key={i}><code>{c.command}</code><span>{c.skillPath}</span></li>)}</ul>
        )}
      </details>

      <details className="gi-details">
        <summary>依赖与许可证</summary>
        <dl className="gi-kv">
          <dt>许可证</dt><dd>{license === 'unknown' ? '未识别' : license}{report.license.files.length ? `（${report.license.files.join('、')}）` : ''}</dd>
          <dt>声明的依赖</dt><dd>{Object.keys(report.dependencies.declared).length} 项</dd>
          <dt>Remotion 包</dt><dd>{Object.entries(report.dependencies.remotionPackages).map(([k, v]) => `${k}@${v}`).join('、') || '无'}</dd>
          <dt>用到但没声明</dt><dd>{report.dependencies.undeclared.join('、') || '无'}</dd>
          <dt>解析不了的引用</dt><dd>{report.summary.unresolvedImports} 处</dd>
        </dl>
        <p className="gi-muted">依赖是按 import 语句静态提取的，可能有出入。</p>
      </details>
    </div>
  )
}

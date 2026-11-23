import { useEffect, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { ShieldTick } from '@untitledui/icons'
import { studioHttpApi } from '@/api'
import { extractPresetValidationErrors, type ImportSkillPackageResponse } from '@/api/skillPresets'
import { formatElapsed, parseRepository } from './importDisplay'

/** 第 1 步：填 GitHub 地址。只在本地校验格式（导入预检接口未实现，见契约 §3.3） */
export function ImportAddressStep({ onImported }: { onImported: (res: ImportSkillPackageResponse) => void }) {
  const [repo, setRepo] = useState('')
  const [ref, setRef] = useState('')
  const [path, setPath] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [importing, setImporting] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (importing === null) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [importing])

  const parsed = parseRepository(repo)
  const invalid = repo.trim() !== '' && !parsed
  /* 单独填的分支、子目录优先于地址里的（契约 skill-package.md §4） */
  const effectiveRef = ref.trim() || parsed?.ref
  const effectivePath = path.trim() || parsed?.path

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed || importing !== null) return
    const started = Date.now()
    setImporting(started)
    setNow(started)
    setErrors([])
    try {
      const res = await studioHttpApi().skillPresets.importSkillPackage({
        repository: repo.trim(),
        ...(ref.trim() ? { ref: ref.trim() } : {}),
        ...(path.trim() ? { path: path.trim() } : {}),
      })
      setRepo(''); setRef(''); setPath('')
      onImported(res)
    } catch (err) {
      setErrors(extractPresetValidationErrors(err))
    } finally {
      setImporting(null)
    }
  }

  const busy = importing !== null
  return (
    <form className="gi-address" onSubmit={(e) => void submit(e)}>
      <h3>导入 Skill 包</h3>
      <p className="gi-lead">从 GitHub 下载一个 Skill 仓库，固定在当前 commit，清点里面有什么。</p>

      <label className="gi-field">
        <span>仓库地址</span>
        <input
          autoFocus
          value={repo}
          onChange={(e) => { setRepo(e.target.value); setErrors([]) }}
          placeholder="owner/repo 或 https://github.com/owner/repo"
          disabled={busy}
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby="gi-address-hint"
        />
      </label>
      <p id="gi-address-hint" className="gi-address-hint" data-tone={invalid ? 'bad' : parsed ? 'ok' : undefined}>
        {invalid ? '地址格式不对。支持 owner/repo，或 github.com 上的仓库、分支、子目录链接。'
          : parsed ? <>将导入 <b>{parsed.owner}/{parsed.repo}</b>{effectiveRef ? <> · 分支 <code>{effectiveRef}</code></> : ' · 默认分支'}{effectivePath ? <> · 子目录 <code>{effectivePath}</code></> : ''}</>
            : ' '}
      </p>

      <button type="button" className="gi-disclosure" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
        <UiIcon icon={SemIcons.expand} size="xs" className={advanced ? 'is-open' : ''} />
        指定分支或子目录
      </button>
      {advanced && (
        <div className="gi-adv">
          <label className="gi-field"><span>分支、标签或 commit</span><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="默认分支" disabled={busy} spellCheck={false} /></label>
          <label className="gi-field"><span>只导入子目录</span><input value={path} onChange={(e) => setPath(e.target.value)} placeholder="整个仓库" disabled={busy} spellCheck={false} /></label>
        </div>
      )}

      {errors.length > 0 && (
        <div className="gi-alert" data-tone="bad" role="alert">
          <b>没有导入</b>
          <ul>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      <div className="gi-address-foot">
        <button type="submit" className="wf-primary" disabled={!parsed || busy}>
          {busy ? <><UiIcon icon={SemIcons.loading} size="sm" className="gi-spin" />正在下载并清点 · {formatElapsed(now - (importing ?? now))}</> : '导入'}
        </button>
        <span className="gi-safety"><UiIcon icon={ShieldTick} size="sm" />不运行包里的任何脚本，文件只读保存</span>
      </div>
    </form>
  )
}

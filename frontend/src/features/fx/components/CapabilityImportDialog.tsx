import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import '@/features/fx/styles/fx-import.css'
import { studioHttpApi } from '@/api'
import { listTechniques } from '@/features/fx/services/fxApiService'

/**
 * 从 GitHub 导入画面源码。
 *
 * 为什么是「粘贴一个仓库地址」而不是「扫描本机目录」：
 * 上一版把「导入来源」做成了扫描本机 capabilities 目录的预览表 ——
 * 用户的心智是「我知道某个 GitHub 仓库里有技能，想拿进来」，
 * 而本机目录对他不可见、不可选，也不知道扫了什么。地址才是唯一自然的入口。
 *
 * 识别规则来自仓库自身的约定，不猜：技能仓库的通行约定是一个目录一份
 * SKILL.md，开头一段 front matter 写 name / description。这里只认这个约定：
 * 拉文件树 → 找 SKILL.md → 读 front matter。没有 front matter 的 SKILL.md
 * 仍然算技能（目录名就是名字），但描述如实留空，不从正文里编一句话。
 *
 * 边界：只读 GitHub 的公开接口，不下载仓库、不执行仓库里的任何代码；
 * 识别与导入分成两步，勾选之后才提交。
 */

type RepoRef = { owner: string; repo: string; branch?: string; subPath?: string }

/** 从各种 GitHub 链接形态里取出 owner/repo 与可选的分支、子目录 */
function parseRepoUrl(raw: string): RepoRef | null {
  const text = raw.trim()
  if (!text) return null
  /* 允许直接粘贴 owner/repo —— 用户经常只记得这个 */
  const bare = /^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+)$/.exec(text)
  if (bare) return { owner: bare[1], repo: bare[2].replace(/\.git$/, '') }
  let url: URL
  try {
    url = new URL(text.startsWith('http') ? text : `https://${text}`)
  } catch {
    return null
  }
  if (!/^(www\.)?github\.com$/.test(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/, '')
  /* /tree/<branch>/<path...> 与 /blob/<branch>/<path> 都要能识别 */
  if (parts[2] === 'tree' || parts[2] === 'blob') {
    return { owner, repo, branch: parts[3], subPath: parts.slice(4).join('/') || undefined }
  }
  return { owner, repo }
}

type SkillItem = {
  id: string
  name: string
  description: string
  path: string
  category: string
  action: 'add' | 'update' | 'possible_duplicate'
}

type Phase = 'idle' | 'scanning' | 'done'

async function listRepoFiles(ref: RepoRef): Promise<{ branch: string; paths: string[] }> {
  const base = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`
  const metaResponse = await fetch(base, { headers: { Accept: 'application/vnd.github+json' } })
  if (!metaResponse.ok) throw new Error(`无法读取公开仓库（HTTP ${metaResponse.status}）`)
  const metadata = await metaResponse.json() as { default_branch?: string }
  const branch = ref.branch || metadata.default_branch
  if (!branch) throw new Error('无法确定仓库默认分支')
  const revisionResponse = await fetch(`${base}/commits/${encodeURIComponent(branch)}`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!revisionResponse.ok) throw new Error(`无法读取分支版本（HTTP ${revisionResponse.status}）`)
  const revision = await revisionResponse.json() as { sha?: string }
  if (!revision.sha || !/^[0-9a-f]{40}$/.test(revision.sha)) throw new Error('仓库版本无效')
  const treeResponse = await fetch(`${base}/git/trees/${revision.sha}?recursive=1`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!treeResponse.ok) throw new Error(`无法读取文件列表（HTTP ${treeResponse.status}）`)
  const tree = await treeResponse.json() as { tree?: Array<{path: string; type: string}>; truncated?: boolean }
  if (tree.truncated) throw new Error('仓库文件列表过大，GitHub 返回不完整，暂不能安全识别')
  return { branch: revision.sha, paths: (tree.tree ?? []).filter((item) => item.type === 'blob').map((item) => item.path) }
}

async function entryId(repo: string, path: string): Promise<string> {
  const data = new TextEncoder().encode(`${repo.toLowerCase()}\n${path}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return `github:${Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('')}`
}

export function CapabilityImportDialog({ open, onOpenChange, onImported }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [repoName, setRepoName] = useState('')
  const [branch, setBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /* 每次打开都回到干净状态：上一轮的地址和勾选不该出现在下一次 */
  useEffect(() => {
    if (!open) return
    setUrl('')
    setPhase('idle')
    setError('')
    setSkills([])
    setSelected([])
    setRepoName('')
    setBranch('')
    setBusy(false)
    const t = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(t)
  }, [open])

  async function scan() {
    const ref = parseRepoUrl(url)
    if (!ref) {
      setError('无法识别这个地址。请粘贴形如 https://github.com/owner/repo 的仓库链接。')
      setPhase('idle')
      return
    }
    setPhase('scanning')
    setError('')
    setSkills([])
    setSelected([])
    try {
      const { branch: defBranch, paths } = await listRepoFiles(ref)

      let candidates = paths.filter((path) => /\.tsx$/i.test(path) && !/(^|\/)(node_modules|__tests__|test|tests|dist|build)\//i.test(path) && !/(^|\/)index\.tsx$/i.test(path) && !/\.(test|spec|stories)\.tsx$/i.test(path))
      if (ref.subPath) candidates = candidates.filter((path) => path.startsWith(`${ref.subPath}/`))
      if (candidates.length === 0) throw new Error('没有找到可识别的 TSX 画面源码。当前仅支持 TSX 文件。')
      if (candidates.length > 2000) throw new Error('源码文件超过 2000 个，请使用仓库子目录链接缩小范围。')
      const repo = `${ref.owner}/${ref.repo}`
      const existing = await listTechniques()
      const known = new Set(existing.map((item) => item.id))
      const withAction = await Promise.all(candidates.map(async (path): Promise<SkillItem> => {
        const id = await entryId(repo, path)
        const name = path.split('/').pop()?.replace(/\.tsx$/i, '') || path
        const possibleDuplicate = existing.some((item) => item.sourceProject?.toLowerCase() === ref.repo.toLowerCase() && item.sourcePath === path && !item.sourceUrl)
        return { id, name, description: '', path, category: path.split('/').slice(-2, -1)[0] || '', action: known.has(id) ? 'update' : possibleDuplicate ? 'possible_duplicate' : 'add' }
      }))

      setRepoName(`${ref.owner}/${ref.repo}`)
      setBranch(defBranch)
      setSkills(withAction)
      /* 新增的默认全选；更新的不默认勾选，避免误覆盖已有条目 */
      setSelected([])
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : '识别失败')
      setPhase('idle')
    }
  }

  async function confirm() {
    if (selected.length === 0) return
    setBusy(true)
    const picked = skills.filter((s) => selected.includes(s.id))
    try {
      if (picked.length > 60) throw new Error('每次最多导入 60 个文件，请减少选择后分批导入。')
      const ref = parseRepoUrl(url)
      if (!ref || !/^[0-9a-f]{40}$/.test(branch)) throw new Error('仓库信息已失效，请重新识别')
      const files = await Promise.all(picked.map(async (item) => {
        const encodedPath = item.path.split('/').map(encodeURIComponent).join('/')
        const response = await fetch(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${branch}/${encodedPath}`)
        if (!response.ok) throw new Error(`读取 ${item.path} 失败（HTTP ${response.status}）`)
        const code = await response.text()
        if (new TextEncoder().encode(code).length > 300_000) throw new Error(`${item.path} 超过 300 KB`)
        return { path: item.path, code }
      }))
      const result = await studioHttpApi().http.post<{ imported: number }>('/fx-techniques/github/import', { owner: ref.owner, repo: ref.repo, commit: branch, files })
      onOpenChange(false)
      onImported()
      window.dispatchEvent(new CustomEvent('fm-toast', { detail: `已导入 ${result.imported} 条源码（${repoName}）` }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败，请重试')
    } finally { setBusy(false) }
  }

  const adds = skills.filter((s) => s.action === 'add').length
  const updates = skills.filter((s) => s.action === 'update').length
  const selectable = skills.filter((s) => s.action !== 'possible_duplicate')
  const allChecked = selected.length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => { if (phase !== 'scanning' && !busy) onOpenChange(next) }}>
      <DialogContent className="fxi-dlg" showCloseButton aria-describedby={undefined}>
        <div className="fxi-head">
          <DialogTitle className="fxi-title">从 GitHub 导入画面源码</DialogTitle>
          <p className="fxi-sub">粘贴公开仓库地址，识别 TSX 源码候选，选择后保存到特效库。</p>
        </div>

        <div className="fxi-body">
          <div className="fxi-field">
            <label className="fxi-label" htmlFor="fxi-url">仓库地址</label>
            <div className="fxi-row">
              <input
                id="fxi-url"
                ref={inputRef}
                className="fxi-input"
                value={url}
                spellCheck={false}
                autoComplete="off"
                placeholder="https://github.com/owner/repo"
                onChange={(e) => { setUrl(e.target.value); if (error) setError('') }}
                onKeyDown={(e) => { if (e.key === 'Enter' && phase !== 'scanning') void scan() }}
              />
              <button type="button" className="fxi-go" disabled={phase === 'scanning' || !url.trim()} onClick={() => void scan()}>
                {phase === 'scanning' ? '识别中…' : '识别源码'}
              </button>
            </div>
            <p className="fxi-hint">支持完整仓库地址、owner/repo，以及带分支或子目录的 /tree/ 链接。</p>
          </div>

          {error && <div className="fxi-error" role="alert">{error}</div>}

          {phase === 'scanning' && (
            <div className="fxi-loading" role="status"><span className="fxi-spin" />正在读取仓库文件列表…</div>
          )}

          {phase === 'idle' && !error && (
            /* 原先是居中虚线大框，看起来像空状态占位；改成输入框下方的两条要点 */
            <ul className="fxi-rules" aria-label="识别规则">
              <li>只识别 TSX 文件，候选不保证都能独立渲染；每次最多导入 60 个。</li>
              <li>只保存所选源码，不会执行；依赖、许可证与预览暂不自动导入。</li>
            </ul>
          )}

          {phase === 'done' && (
            <div className="fxi-result">
              <div className="fxi-summary">
                <span><b>{repoName}</b> · {branch}</span>
                <div className="fxi-chips">
                  <span className="fxi-chip">新增 <b>{adds}</b></span>
                  <span className="fxi-chip">更新 <b>{updates}</b></span>
                  <button type="button" className="fxi-selectall" onClick={() => setSelected(allChecked ? [] : selectable.slice(0, 60).map((s) => s.id))}>
                    {allChecked ? '取消选择' : selectable.length > 60 ? '选择前 60 项' : '全选'}
                  </button>
                </div>
              </div>
              <ul className="fxi-list">
                {skills.map((s) => {
                  const on = selected.includes(s.id)
                  return (
                    <li key={s.id} className="fxi-item" data-skip={!on || undefined}>
                      <Checkbox checked={on} disabled={s.action === 'possible_duplicate'} aria-label={`选择 ${s.name}`} onCheckedChange={(v) => {
                        setSelected((prev) => (v === true ? [...prev, s.id] : prev.filter((x) => x !== s.id)))
                      }} />
                      <div className="fxi-item-main">
                        <div className="fxi-item-top">
                          <span className="fxi-item-name">{s.name}</span>
                          <span className="fxi-tag" data-kind={s.action}>{s.action === 'add' ? '新增' : s.action === 'update' ? '更新' : '可能已存在，需核对来源'}</span>
                          {/* 分类与名字相同时不重复显示：技能库常见「目录名 = 技能名」 */}
                          {s.category && s.category !== s.name && <span className="fxi-tag">{s.category}</span>}
                        </div>
                        {s.description && <span className="fxi-item-desc">{s.description}</span>}
                        <span className="fxi-item-src">{s.path}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="fxi-foot">
          <span className="fxi-foot-n">{phase === 'done' ? `已选 ${selected.length} / ${skills.length}` : ''}</span>
          <span className="fxi-spacer" />
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
          <Button size="sm" disabled={busy || phase !== 'done' || selected.length === 0} onClick={() => void confirm()}>
            导入 {selected.length > 0 ? `${selected.length} 条` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

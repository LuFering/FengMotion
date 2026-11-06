import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import '@/styles/fx-import.css'

/**
 * 从 GitHub 导入技能。
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

/** front matter 里取值：支持中英文键名，与后端解析器保持同一套候选词 */
function fmValue(block: string, keys: string[]): string {
  for (const key of keys) {
    const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'im')
    const hit = re.exec(block)
    if (hit) return hit[1].trim().replace(/^['"]|['"]$/g, '')
  }
  return ''
}

type SkillItem = {
  id: string
  name: string
  description: string
  path: string
  category: string
  action: 'add' | 'update'
}

type Phase = 'idle' | 'scanning' | 'done'

const NAME_KEYS = ['name', 'title', '名称', '标题']
const DESC_KEYS = ['description', 'summary', '一句话', '简介', '说明', 'intent', '用途']

/** 技能目录的上一层目录名，用它做分类（多数库用它表达「这是一类什么技能」） */
function categoryOf(path: string): string {
  const segs = path.split('/')
  return segs.length >= 2 ? segs[segs.length - 2] : ''
}

/**
 * 列出仓库文件。
 *
 * 优先走 jsDelivr：它不受 GitHub 未登录接口「每小时 60 次」的限流，
 * 而且允许跨域。实测限流打满时 GitHub API 直接 403，jsDelivr 仍然正常。
 * GitHub API 作为回退 —— 仓库太新、jsDelivr 还没索引时它往往已经有了。
 */
async function listRepoFiles(ref: RepoRef): Promise<{ branch: string; paths: string[] }> {
  const errors: string[] = []

  /* 路径 1：jsDelivr 包清单（跨域可用、不限流） */
  for (const branch of ref.branch ? [ref.branch] : ['main', 'master']) {
    try {
      const res = await fetch(`https://data.jsdelivr.com/v1/packages/gh/${ref.owner}/${ref.repo}@${branch}?structure=flat`)
      if (res.ok) {
        const data = await res.json() as { files?: Array<{ name: string }> }
        const paths = (data.files ?? []).map((f) => f.name.replace(/^\//, ''))
        if (paths.length > 0) return { branch, paths }
      } else if (res.status === 404) {
        errors.push(`${branch}: 仓库或分支不存在`)
      } else {
        errors.push(`${branch}: HTTP ${res.status}`)
      }
    } catch (e) {
      errors.push(`${branch}: ${e instanceof Error ? e.message : '网络失败'}`)
    }
  }

  /* 路径 2：GitHub API（可能限流） */
  try {
    const api = `https://api.github.com/repos/${ref.owner}/${ref.repo}`
    const metaRes = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } })
    if (metaRes.status === 404) throw new Error('仓库不存在或不是公开仓库')
    if (metaRes.status === 403) throw new Error('GitHub 接口限流')
    if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`)
    const meta = await metaRes.json() as { default_branch?: string }
    const branch = ref.branch || meta.default_branch || 'main'
    const treeRes = await fetch(`${api}/git/trees/${branch}?recursive=1`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!treeRes.ok) throw new Error(`读取文件列表 HTTP ${treeRes.status}`)
    const tree = await treeRes.json() as { tree?: Array<{ path: string; type: string }> }
    const paths = (tree.tree ?? []).filter((n) => n.type === 'blob').map((n) => n.path)
    if (paths.length > 0) return { branch, paths }
    errors.push('文件列表为空')
  } catch (e) {
    errors.push(e instanceof Error ? e.message : '网络失败')
  }

  throw new Error(`无法读取这个仓库（${errors.join('；')}）。请确认地址正确、仓库是公开的。`)
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

      /* 只认 SKILL.md：技能仓库的通行约定。README / AGENTS / 指南都不是技能。 */
      let candidates = paths.filter((p) => /(^|\/)skill\.md$/i.test(p))
      if (ref.subPath) candidates = candidates.filter((p) => p.startsWith(`${ref.subPath}/`))
      if (candidates.length === 0) throw new Error('这个仓库里没有找到 SKILL.md —— 它看起来不是技能仓库。')
      /* 一次最多读 60 个，避免把超大的仓库整份拉下来 */
      candidates = candidates.slice(0, 60)

      const raw = (p: string) => `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${defBranch}/${p}`
      const items = await Promise.all(candidates.map(async (path): Promise<SkillItem | null> => {
        try {
          const res = await fetch(raw(path))
          if (!res.ok) return null
          const text = await res.text()
          const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
          const block = head?.[1] ?? ''
          const dirName = path.split('/').slice(-2, -1)[0] ?? path
          const name = fmValue(block, NAME_KEYS) || dirName
          const description = fmValue(block, DESC_KEYS)
          const owner = ref.owner.toLowerCase()
          return {
            id: `${owner}-${ref.repo.toLowerCase()}-${path.replace(/\/skill\.md$/i, '').replace(/\//g, '-').toLowerCase()}`,
            name,
            description,
            path,
            category: categoryOf(path),
            action: 'add' as const,
          }
        } catch {
          return null
        }
      }))
      const found = items.filter((i): i is SkillItem => i !== null)
      if (found.length === 0) throw new Error('找到了 SKILL.md，但内容读取失败')

      /* 与库里已有条目比对：同 ID 就是更新，让用户知道这次是覆盖而不是新增 */
      const existing = await fetch('/api/fx-techniques?limit=200', { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null) as { items?: Array<{ techniqueId?: string; id?: string }> } | null
      const known = new Set((existing?.items ?? []).map((t) => (t.techniqueId ?? t.id ?? '').toLowerCase()).filter(Boolean))
      const withAction = found.map((s) => (known.has(s.id.toLowerCase()) ? { ...s, action: 'update' as const } : s))

      setRepoName(`${ref.owner}/${ref.repo}`)
      setBranch(defBranch)
      setSkills(withAction)
      /* 新增的默认全选；更新的不默认勾选，避免误覆盖已有条目 */
      setSelected(withAction.filter((s) => s.action === 'add').map((s) => s.id))
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
    /* 写入接口尚未提供，这里如实说明，不假装已经写进特效库 */
    setError('')
    setBusy(false)
    onOpenChange(false)
    onImported()
    window.dispatchEvent(new CustomEvent('fm-toast', {
      detail: `已识别 ${picked.length} 条技能（${repoName}）；导入写入接口尚未接入，本次未改动特效库。`,
    }))
  }

  const adds = skills.filter((s) => s.action === 'add').length
  const updates = skills.filter((s) => s.action === 'update').length
  const allChecked = skills.length > 0 && selected.length === skills.length

  return (
    <Dialog open={open} onOpenChange={(next) => { if (phase !== 'scanning') onOpenChange(next) }}>
      <DialogContent className="fxi-dlg" showCloseButton aria-describedby={undefined}>
        <div className="fxi-head">
          <DialogTitle className="fxi-title">从 GitHub 导入技能</DialogTitle>
          <p className="fxi-sub">粘贴技能仓库的地址，自动识别其中的技能，勾选后导入特效库。</p>
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
                {phase === 'scanning' ? '识别中…' : '识别技能'}
              </button>
            </div>
            <p className="fxi-hint">支持完整仓库地址、owner/repo，以及带分支或子目录的 /tree/ 链接。</p>
          </div>

          {error && <div className="fxi-error" role="alert">{error}</div>}

          {phase === 'scanning' && (
            <div className="fxi-loading" role="status"><span className="fxi-spin" />正在读取仓库文件列表…</div>
          )}

          {phase === 'idle' && !error && (
            <div className="fxi-note">
              <b>识别规则</b>
              技能仓库的约定是一个目录一份 SKILL.md，开头的 front matter 写名称与描述。<br />
              只读取这些文件，不下载仓库，也不执行仓库里的代码。
            </div>
          )}

          {phase === 'done' && (
            <div className="fxi-result">
              <div className="fxi-summary">
                <span><b>{repoName}</b> · {branch}</span>
                <div className="fxi-chips">
                  <span className="fxi-chip">新增 <b>{adds}</b></span>
                  <span className="fxi-chip">更新 <b>{updates}</b></span>
                  <button type="button" className="fxi-selectall" onClick={() => setSelected(allChecked ? [] : skills.map((s) => s.id))}>
                    {allChecked ? '取消全选' : '全选'}
                  </button>
                </div>
              </div>
              <ul className="fxi-list">
                {skills.map((s) => {
                  const on = selected.includes(s.id)
                  return (
                    <li key={s.id} className="fxi-item" data-skip={!on || undefined}>
                      <Checkbox checked={on} aria-label={`选择 ${s.name}`} onCheckedChange={(v) => {
                        setSelected((prev) => (v === true ? [...prev, s.id] : prev.filter((x) => x !== s.id)))
                      }} />
                      <div className="fxi-item-main">
                        <div className="fxi-item-top">
                          <span className="fxi-item-name">{s.name}</span>
                          <span className="fxi-tag" data-kind={s.action}>{s.action === 'add' ? '新增' : '更新'}</span>
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

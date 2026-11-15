import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  Layers,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import '@/styles/fx-import.css'

export type ParsedCapabilityItem = {
  id: string
  name: string
  nameEn?: string
  description?: string
  path?: string
  category?: string
  action: 'add' | 'update'
  code?: string
  props?: string[]
  apis?: string[]
  steps?: string[]
  sourceProject?: string
  sourcePath?: string
}

type RepoRef = { owner: string; repo: string; branch?: string; subPath?: string }

function parseRepoUrl(raw: string): RepoRef | null {
  const text = raw.trim()
  if (!text) return null
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
  if (parts[2] === 'tree' || parts[2] === 'blob') {
    return { owner, repo, branch: parts[3], subPath: parts.slice(4).join('/') || undefined }
  }
  return { owner, repo }
}

const PRESET_REPOS = [
  {
    id: 'remotion-scenes',
    name: 'remotion-scenes',
    label: 'Remotion 画面代码库',
    desc: '包含 204 个基于 Remotion 的 React 动态场景组件与动画源码',
    count: '204 个场景',
    badge: 'TSX 源码',
    url: 'https://github.com/lifeprompt-team/remotion-scenes',
  },
  {
    id: 'video-shotcraft',
    name: 'video-shotcraft',
    label: '电影运镜与分镜技法库',
    desc: '包含 124 种专业运镜公式、景别切换与摄影机运动方案',
    count: '124 项技法',
    badge: '运镜配方',
    url: 'https://github.com/video-shotcraft/video-shotcraft',
  },
  {
    id: 'lemo-opuscar',
    name: 'lemo-opuscar',
    label: '视觉风格与调色库',
    desc: '包含 51 套电影级色板、质感与光影美学风格系统',
    count: '51 套风格',
    badge: '风格系统',
    url: 'https://github.com/lemo-opuscar/styles',
  },
]

type Phase = 'idle' | 'scanning' | 'done'

export function CapabilityImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (importedProject?: string) => void
}) {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [items, setItems] = useState<ParsedCapabilityItem[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [activeItem, setActiveItem] = useState<ParsedCapabilityItem | null>(null)
  const [repoName, setRepoName] = useState('')
  const [branch, setBranch] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setUrl('')
    setPhase('idle')
    setError('')
    setItems([])
    setSelected([])
    setActiveItem(null)
    setRepoName('')
    setBranch('')
    setFilterQuery('')
    setBusy(false)
    setCopied(false)
    const t = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(t)
  }, [open])

  async function scanPreset(presetId: string) {
    setPhase('scanning')
    setError('')
    setItems([])
    setSelected([])
    setActiveItem(null)
    try {
      const res = await fetch(`/api/fx-techniques/scan-repo?repo=${encodeURIComponent(presetId)}`)
      if (!res.ok) throw new Error(`服务端解析失败 (HTTP ${res.status})`)
      const data = await res.json() as {
        success: boolean
        items: Array<{
          id: string
          name: string
          nameEn?: string
          category?: string
          intent?: string
          sourceProject?: string
          sourcePath?: string
          code?: string
          props?: string[]
          apis?: string[]
          steps?: string[]
          alreadyImported?: boolean
        }>
      }
      if (!data.success || !data.items || data.items.length === 0) {
        throw new Error('未在预置库中找到可用条目')
      }

      const parsed: ParsedCapabilityItem[] = data.items.map((i) => ({
        id: i.id,
        name: i.name,
        nameEn: i.nameEn,
        description: i.intent || (i.props && i.props.length > 0 ? `参数：${i.props.join('、')}` : ''),
        category: i.category,
        action: i.alreadyImported ? 'update' : 'add',
        code: i.code,
        props: i.props,
        apis: i.apis,
        steps: i.steps,
        sourceProject: i.sourceProject || presetId,
        sourcePath: i.sourcePath,
      }))

      setRepoName(presetId)
      setBranch('local-capabilities')
      setItems(parsed)
      setActiveItem(parsed[0] ?? null)
      setSelected(parsed.map((p) => p.id))
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析预置库失败')
      setPhase('idle')
    }
  }

  async function scan() {
    const raw = url.trim()
    if (!raw) return

    // 检查是否输入了预置库名称
    const matchedPreset = PRESET_REPOS.find((p) =>
      p.id.toLowerCase() === raw.toLowerCase() ||
      p.name.toLowerCase() === raw.toLowerCase() ||
      raw.toLowerCase().includes(p.id.toLowerCase())
    )
    if (matchedPreset) {
      await scanPreset(matchedPreset.id)
      return
    }

    const ref = parseRepoUrl(raw)
    if (!ref) {
      setError('无法识别这个地址。请粘贴完整仓库链接（如 https://github.com/owner/repo）或直接选择预置资源库。')
      setPhase('idle')
      return
    }

    // 如果链接匹配本地已知库
    for (const p of PRESET_REPOS) {
      if (ref.repo.toLowerCase() === p.id.toLowerCase() || ref.repo.toLowerCase().includes(p.id.toLowerCase())) {
        await scanPreset(p.id)
        return
      }
    }

    setPhase('scanning')
    setError('')
    setItems([])
    setSelected([])
    setActiveItem(null)

    try {
      const api = `https://api.github.com/repos/${ref.owner}/${ref.repo}`
      const metaRes = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } })
      if (metaRes.status === 404) throw new Error('仓库不存在或不是公开仓库')
      if (metaRes.status === 403) throw new Error('GitHub API 调用次数受限，请稍后再试')
      if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`)
      const meta = await metaRes.json() as { default_branch?: string }
      const branchName = ref.branch || meta.default_branch || 'main'

      const treeRes = await fetch(`${api}/git/trees/${branchName}?recursive=1`, { headers: { Accept: 'application/vnd.github+json' } })
      if (!treeRes.ok) throw new Error(`读取文件列表 HTTP ${treeRes.status}`)
      const tree = await treeRes.json() as { tree?: Array<{ path: string; type: string }> }
      const paths = (tree.tree ?? []).filter((n) => n.type === 'blob').map((n) => n.path)

      // 寻找场景代码 (.tsx) 或技能说明 (skill.md)
      const tsxFiles = paths.filter((p) => /\.tsx$/i.test(p) && !/(^|\/)index\.tsx$/i.test(p))
      const skillFiles = paths.filter((p) => /(^|\/)skill\.md$/i.test(p))

      let parsed: ParsedCapabilityItem[] = []

      if (tsxFiles.length > 0) {
        // 解析 TSX 画面代码组件
        const sample = tsxFiles.slice(0, 40)
        parsed = await Promise.all(
          sample.map(async (path): Promise<ParsedCapabilityItem> => {
            const fileName = path.split('/').pop()?.replace(/\.tsx$/i, '') || 'Scene'
            const segs = path.split('/')
            const category = segs.length > 2 ? segs[segs.length - 2] : 'scene'
            let code = ''
            try {
              const rawRes = await fetch(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${branchName}/${path}`)
              if (rawRes.ok) code = await rawRes.text()
            } catch {
              // ignore
            }
            return {
              id: `${ref.repo}-${fileName}`,
              name: fileName,
              category,
              action: 'add',
              code,
              sourceProject: ref.repo,
              sourcePath: path,
              description: `画面场景组件 (${path})`,
            }
          })
        )
      } else if (skillFiles.length > 0) {
        // 回退到 SKILL.md
        parsed = skillFiles.slice(0, 30).map((path) => {
          const segs = path.split('/')
          const name = segs.length >= 2 ? segs[segs.length - 2] : 'Skill'
          return {
            id: `${ref.repo}-${name}`,
            name,
            category: 'skill',
            action: 'add',
            sourceProject: ref.repo,
            sourcePath: path,
            description: `技能文件 ${path}`,
          }
        })
      } else {
        throw new Error('未在该仓库中发现可识别的画面代码 (.tsx) 或技能文件')
      }

      setRepoName(`${ref.owner}/${ref.repo}`)
      setBranch(branchName)
      setItems(parsed)
      setActiveItem(parsed[0] ?? null)
      setSelected(parsed.map((p) => p.id))
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : '识别仓库失败')
      setPhase('idle')
    }
  }

  async function handleCopy(text: string) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  async function confirm() {
    if (selected.length === 0) return
    setBusy(true)
    setError('')
    const picked = items.filter((s) => selected.includes(s.id))

    try {
      const isPreset = PRESET_REPOS.some((p) => p.id === repoName)
      if (isPreset) {
        // 调用预置库导入
        const res = await fetch(`/api/fx-techniques/import-preset?repo=${encodeURIComponent(repoName)}`, {
          method: 'POST',
        })
        if (!res.ok) throw new Error(`导入预置库失败 (HTTP ${res.status})`)
      } else {
        // 调用自定义导入
        const customItems = picked.map((item) => ({
          id: item.id,
          name: item.name,
          nameEn: item.nameEn || '',
          intent: item.description || '',
          category: item.category || 'compositing',
          impl: 'composite',
          code: item.code || '',
          keywords: [item.name.toLowerCase()],
          steps: item.steps || (item.code ? [`__SOURCE_CODE__:\n${item.code}`] : []),
          props: item.props || [],
          sourcePath: item.sourcePath || '',
        }))

        const res = await fetch('/api/fx-techniques/import-custom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceProject: repoName,
            sourceUrl: url,
            items: customItems,
          }),
        })
        if (!res.ok) throw new Error(`导入自定义代码条目失败 (HTTP ${res.status})`)
      }

      setBusy(false)
      onOpenChange(false)
      onImported(repoName)
      window.dispatchEvent(
        new CustomEvent('fm-toast', {
          detail: `已成功导入 ${picked.length} 项画面技法条目（来源：${repoName}）`,
        })
      )
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : '导入失败')
    }
  }

  const filteredItems = items.filter((it) => {
    if (!filterQuery.trim()) return true
    const q = filterQuery.toLowerCase()
    return (
      it.name.toLowerCase().includes(q) ||
      (it.category && it.category.toLowerCase().includes(q)) ||
      (it.description && it.description.toLowerCase().includes(q))
    )
  })

  const allFilteredChecked =
    filteredItems.length > 0 && filteredItems.every((it) => selected.includes(it.id))

  return (
    <Dialog open={open} onOpenChange={(next) => { if (phase !== 'scanning') onOpenChange(next) }}>
      <DialogContent className="fxi-dlg fxi-dlg-wide" showCloseButton aria-describedby={undefined}>
        <div className="fxi-head">
          <div className="fxi-head-icon">
            <Sparkles size={18} className="text-blue-500" />
          </div>
          <div>
            <DialogTitle className="fxi-title">导入特效技法与画面代码来源</DialogTitle>
            <p className="fxi-sub">
              支持粘贴 GitHub 仓库地址，或直接解析本地提取的 Remotion 画面代码库，导入后自动按仓库独立分类管理。
            </p>
          </div>
        </div>

        <div className="fxi-body">
          {/* 仓库输入与快速预置卡片 */}
          <div className="fxi-field">
            <label className="fxi-label" htmlFor="fxi-url">
              GitHub 仓库地址 或 本地提取库
            </label>
            <div className="fxi-row">
              <input
                id="fxi-url"
                ref={inputRef}
                className="fxi-input"
                value={url}
                spellCheck={false}
                autoComplete="off"
                placeholder="https://github.com/lifeprompt-team/remotion-scenes 或输入 remotion-scenes"
                onChange={(e) => {
                  setUrl(e.target.value)
                  if (error) setError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && phase !== 'scanning') void scan()
                }}
              />
              <button
                type="button"
                className="fxi-go"
                disabled={phase === 'scanning' || !url.trim()}
                onClick={() => void scan()}
              >
                {phase === 'scanning' ? '解析中…' : '解析代码库'}
              </button>
            </div>
          </div>

          {/* 快速选择本地三个已存资源库 */}
          {phase === 'idle' && (
            <div className="fxi-presets-wrap">
              <div className="fxi-presets-title">本地已提取的三大 GitHub 资源库（点击即时解析）</div>
              <div className="fxi-presets-grid">
                {PRESET_REPOS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="fxi-preset-card"
                    onClick={() => {
                      setUrl(preset.url)
                      void scanPreset(preset.id)
                    }}
                  >
                    <div className="fxi-preset-card-top">
                      <span className="fxi-preset-badge">{preset.badge}</span>
                      <span className="fxi-preset-count">{preset.count}</span>
                    </div>
                    <div className="fxi-preset-name">{preset.label}</div>
                    <div className="fxi-preset-repo">{preset.name}</div>
                    <div className="fxi-preset-desc">{preset.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="fxi-error" role="alert">{error}</div>}

          {phase === 'scanning' && (
            <div className="fxi-loading" role="status">
              <span className="fxi-spin" />
              正在解析仓库结构与 Remotion 场景代码，请稍候…
            </div>
          )}

          {/* 解析完成：左右两栏高保真预览 */}
          {phase === 'done' && (
            <div className="fxi-split-layout">
              {/* 左栏：组件列表 */}
              <div className="fxi-split-left">
                <div className="fxi-split-left-header">
                  <div className="fxi-repo-tag">
                    <b>{repoName}</b> {branch ? `(${branch})` : ''} · {items.length} 个条目
                  </div>
                  <div className="fxi-list-actions">
                    <button
                      type="button"
                      className="fxi-text-action"
                      onClick={() => {
                        if (allFilteredChecked) {
                          setSelected((prev) => prev.filter((id) => !filteredItems.some((f) => f.id === id)))
                        } else {
                          const newIds = new Set([...selected, ...filteredItems.map((f) => f.id)])
                          setSelected(Array.from(newIds))
                        }
                      }}
                    >
                      {allFilteredChecked ? '取消勾选' : '全部勾选'}
                    </button>
                  </div>
                </div>

                <div className="fxi-filter-box">
                  <input
                    type="text"
                    className="fxi-filter-input"
                    placeholder="在解析结果中筛选组件…"
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                  />
                </div>

                <ul className="fxi-items-scroll">
                  {filteredItems.map((item) => {
                    const isChecked = selected.includes(item.id)
                    const isActive = activeItem?.id === item.id
                    return (
                      <li
                        key={item.id}
                        className={`fxi-item-row ${isActive ? 'is-active' : ''}`}
                        onClick={() => setActiveItem(item)}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(val) => {
                            setSelected((prev) =>
                              val === true ? [...prev, item.id] : prev.filter((x) => x !== item.id)
                            )
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="fxi-item-info">
                          <div className="fxi-item-title-row">
                            <span className="fxi-item-title">{item.name}</span>
                            {item.category && <span className="fxi-item-cat">{item.category}</span>}
                          </div>
                          {item.description && <div className="fxi-item-desc">{item.description}</div>}
                        </div>
                        <ChevronRight size={14} className="fxi-item-arrow" />
                      </li>
                    )
                  })}
                </ul>
              </div>

              {/* 右栏：画面模拟 & Remotion TSX 源码高保真预览 */}
              <div className="fxi-split-right">
                {activeItem ? (
                  <div className="fxi-preview-container">
                    {/* 顶部：画面模拟看板与参数 */}
                    <div className="fxi-preview-stage">
                      <div className="fxi-stage-header">
                        <span className="fxi-stage-title">
                          <Eye size={13} className="text-blue-500" /> 画面渲染模拟
                        </span>
                        <span className="fxi-stage-fps">1080P · 30 FPS · Remotion Canvas</span>
                      </div>

                      <div className="fxi-stage-canvas">
                        <div className="fxi-mock-glow" />
                        <div className="fxi-mock-content">
                          <div className="fxi-mock-component-badge">
                            <Layers size={12} /> {activeItem.name}
                          </div>
                          <div className="fxi-mock-title">{activeItem.name}</div>
                          <div className="fxi-mock-sub">
                            {activeItem.category ? `[${activeItem.category}]` : 'Remotion Scene'}
                          </div>
                          <div className="fxi-mock-timeline-bar">
                            <div className="fxi-mock-timeline-fill" />
                          </div>
                        </div>
                      </div>

                      {/* 参数与 API 标签 */}
                      <div className="fxi-specs-bar">
                        {activeItem.apis && activeItem.apis.length > 0 && (
                          <div className="fxi-spec-group">
                            <span className="fxi-spec-label">Remotion API</span>
                            <div className="fxi-spec-chips">
                              {activeItem.apis.map((api) => (
                                <span key={api} className="fxi-spec-chip api">{api}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {activeItem.props && activeItem.props.length > 0 && (
                          <div className="fxi-spec-group">
                            <span className="fxi-spec-label">可调参数 Props</span>
                            <div className="fxi-spec-chips">
                              {activeItem.props.map((p) => (
                                <span key={p} className="fxi-spec-chip prop">{p}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 底部：TSX 源代码渲染区 */}
                    <div className="fxi-code-section">
                      <div className="fxi-code-header">
                        <div className="fxi-code-title">
                          <Code2 size={13} />
                          <span>画面源代码 · {activeItem.sourcePath || `${activeItem.name}.tsx`}</span>
                        </div>
                        {activeItem.code && (
                          <button
                            type="button"
                            className="fxi-copy-code-btn"
                            onClick={() => void handleCopy(activeItem.code || '')}
                          >
                            {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                            {copied ? '已复制代码' : '复制代码'}
                          </button>
                        )}
                      </div>

                      <div className="fxi-code-viewport">
                        {activeItem.code ? (
                          <pre className="fxi-code-pre">
                            <code>{activeItem.code}</code>
                          </pre>
                        ) : (
                          <div className="fxi-code-empty">
                            暂无内联源代码，包含步骤参考说明：
                            <ul className="mt-2 space-y-1">
                              {(activeItem.steps || []).map((s, idx) => (
                                <li key={idx}>· {s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="fxi-right-empty">
                    在左侧列表中点击任意组件，即可在此预览画面效果与 Remotion 源代码。
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="fxi-foot">
          <span className="fxi-foot-n">
            {phase === 'done' ? `已勾选 ${selected.length} / ${items.length} 个画面技法` : ''}
          </span>
          <span className="fxi-spacer" />
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={busy || phase !== 'done' || selected.length === 0}
            onClick={() => void confirm()}
          >
            {busy ? '导入写入中…' : `导入选中的 ${selected.length > 0 ? `${selected.length} 项` : ''}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

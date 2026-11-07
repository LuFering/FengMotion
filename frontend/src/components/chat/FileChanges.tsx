/**
 * 文件改动列表：这条回复动了哪些文件、各改了多少行。
 *
 * 参考 shadcn/ui 的 `File Tree`（AI Elements）与 open-design 的
 * `FileEditCard` 的信息密度：一行一个文件，右侧是 `+N −M` 计数，
 * 展开看片段级明细。不做成大卡片 —— 它是过程的补充说明，不是产物。
 *
 * **计数口径必须说清楚**：`write` 的行数按写入全文计，`edit` 按新旧片段计。
 * 两者都不是整文件快照，所以这是「改动量」的量级参考，不是精确的 diff 行号。
 * 界面用 tooltip 标注这一点，不让人误以为是完整 diff。
 */
import { useState } from 'react'
import { ChevronRight, FileDiff } from 'lucide-react'
import type { FileChange } from './fileChanges'
import './file-changes.css'

/** 取文件名：列表里显示短的，完整路径进展开区。 */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** 取目录，展开时用来定位文件放哪。 */
function dirName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : ''
}

function FileRow({ change }: { change: FileChange }) {
  const [open, setOpen] = useState(false)
  /* 有片段明细才给展开箭头 —— 否则点了没反应，是个假控件。 */
  const expandable = change.hunks.length > 0
  return (
    <li className="fc-row" data-open={open || undefined}>
      <button
        type="button"
        className="fc-head"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        title={change.path}
      >
        <ChevronRight size={11} className="fc-caret" aria-hidden="true" />
        <span className="fc-name num">{baseName(change.path)}</span>
        <span className="fc-kind">{change.kind === 'write' ? '写入' : '修改'}</span>
        <span className="fc-stat">
          {change.added > 0 && <span className="fc-add num">+{change.added}</span>}
          {change.deleted > 0 && <span className="fc-del num">−{change.deleted}</span>}
          {change.added === 0 && change.deleted === 0 && <span className="fc-none">无行变更</span>}
        </span>
      </button>
      {open && (
        <div className="fc-detail">
          <div className="fc-path num">{change.path || dirName(change.path)}</div>
          {change.hunks.map((h, i) => (
            <div key={i} className="fc-hunk">
              {h.before.map((line, j) => (
                <div key={`b${j}`} className="fc-line fc-line-del">
                  <span className="fc-sign" aria-hidden="true">−</span>
                  <span className="fc-text num">{line}</span>
                </div>
              ))}
              {h.after.map((line, j) => (
                <div key={`a${j}`} className="fc-line fc-line-add">
                  <span className="fc-sign" aria-hidden="true">+</span>
                  <span className="fc-text num">{line}</span>
                </div>
              ))}
            </div>
          ))}
          <p className="fc-note">片段级明细，不是整文件 diff</p>
        </div>
      )}
    </li>
  )
}

/**
 * 文件改动列表。
 *
 * @param changes 由 {@link collectFileChanges} 推导出的改动
 */
export function FileChanges({ changes }: { changes: FileChange[] }) {
  const [collapsed, setCollapsed] = useState(true)
  if (changes.length === 0) return null

  const totalAdded = changes.reduce((n, c) => n + c.added, 0)
  const totalDeleted = changes.reduce((n, c) => n + c.deleted, 0)

  return (
    <div className="fc">
      <button
        type="button"
        className="fc-summary"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <ChevronRight size={12} className="fc-caret" aria-hidden="true" />
        <FileDiff size={12} aria-hidden="true" />
        <span className="fc-title">改动 {changes.length} 个文件</span>
        {totalAdded > 0 && <span className="fc-add num">+{totalAdded}</span>}
        {totalDeleted > 0 && <span className="fc-del num">−{totalDeleted}</span>}
      </button>
      {!collapsed && (
        <ul className="fc-list">
          {changes.map((c) => (
            <FileRow key={c.path} change={c} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default FileChanges

/**
 * 文件改动列表：这条回复动了哪些文件、各改了多少行。
 *
 * ## 设计来源
 *
 * 行渲染照 shadcn/ui 的 `CodeBlock` diff 变体：
 * - 增行 `bg-muted` / 删行 `bg-destructive/10`
 * - `+` `−` 符号绝对定位在行首，**不占内容宽度**（内容不被推右）
 * - 行号等宽右对齐
 *
 * 外层折叠结构照 open-design 的 `FileEditCard`：一行一个文件，
 * 右侧 `+N −M`，点开看明细。不做成大卡片 —— 它是过程补充，不是产物。
 *
 * ## 计数口径必须说清楚
 *
 * `write` 的行数按写入全文计，`edit` 按新旧片段计。两者都不是整文件快照，
 * 所以这是「改动量」的量级参考，不是精确的 diff 行号。
 * 界面明确标注这一点，不让人误以为是完整 diff。
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

/** 一行代码。`sign` 为 + / − 时走 diff 配色。 */
function DiffLine({ text, sign, lineNo }: { text: string; sign?: '+' | '−'; lineNo?: number }) {
  return (
    <div className="fc-line" data-sign={sign ?? undefined}>
      {lineNo !== undefined && <span className="fc-lineno num" aria-hidden="true">{lineNo}</span>}
      {/* 符号单独一格，等宽 —— 它比内容更靠左，读的时候眼睛沿这一列扫 */}
      <span className="fc-sign" aria-hidden="true">{sign ?? ''}</span>
      <span className="fc-text num">{text}</span>
    </div>
  )
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
          <div className="fc-path num" title={change.path}>{change.path}</div>
          {change.hunks.map((h, i) => (
            /* 行号连续编下去，删行和增行**不各自从 1 重来** ——
               重来会让同一处改动看起来像两段不相干的内容。
               删掉的旧行在前、新增的行在后，序号一路递增，
               读起来就是「这里原来 1-2 行，现在变成 1-2 行」的同位置替换。 */
            <div key={i} className="fc-hunk">
              {(() => {
                let n = 0
                return [
                  ...h.before.map((line, j) => (
                    <DiffLine key={`b${j}`} text={line} sign="−" lineNo={++n} />
                  )),
                  ...h.after.map((line, j) => (
                    <DiffLine key={`a${j}`} text={line} sign="+" lineNo={++n} />
                  )),
                ]
              })()}
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

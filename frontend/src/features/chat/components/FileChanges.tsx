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
 * 外层照 dsh 的 ChangedFiles：一张轻卡，头部是图标块 +「已编辑 N 个文件」+ 等宽的 `+a −d`；
 * 下面默认列前 4 个文件，其余收在「全部 N 个文件」里。每行右侧是增删行数，点开看改动片段。
 *
 * ## 计数口径必须说清楚
 *
 * `write` 的行数按写入全文计，`edit` 按新旧片段计。两者都不是整文件快照，
 * 所以这是「改动量」的量级参考，不是精确的 diff 行号。
 * 界面明确标注这一点，不让人误以为是完整 diff。
 */
import { useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { FileKindIcon } from '@/features/chat/components/FileKindIcon'
import type { FileChange } from '@/features/chat/model/fileChangesModel'
import '@/features/chat/styles/components/file-changes.css'

/** 取文件名：列表里显示短的，完整路径进展开区。 */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/**
 * 去掉这批文件共同的上级目录：最后一级共同目录（通常是项目目录）作为根，在卡头写一次；
 * 行内只显示根以下的相对目录。
 *
 * <p>Agent 报的是绝对路径（/home/…/项目/src/a.ts）。原先每行都重复「项目/」，
 * 文件一多就是一列相同的前缀（打磨方案 §3.3）。完整路径仍在悬停提示里。</p>
 */
function splitDirs(paths: string[]): { root: string; rootFull: string; dirs: Map<string, string> } {
  const dirs = paths.map((p) => p.split(/[\\/]/).filter(Boolean).slice(0, -1))
  let common = dirs[0]?.length ?? 0
  for (const d of dirs) {
    let i = 0
    while (i < common && i < d.length && d[i] === dirs[0][i]) i++
    common = i
  }
  return {
    root: common > 0 ? dirs[0][common - 1] : '',
    rootFull: common > 0 ? `/${dirs[0].slice(0, common).join('/')}` : '',
    dirs: new Map(paths.map((p, i) => {
      const rest = dirs[i].slice(common)
      /* 末尾补 U+200E：.fc-dir 为从左省略用了 direction:rtl，结尾的「/」是中性字符会被排到最左（显示成「/src」） */
      return [p, rest.length > 0 ? `${rest.join('/')}/‎` : '']
    })),
  }
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

function FileRow({ change, dir }: { change: FileChange; dir: string }) {
  const [open, setOpen] = useState(false)
  const expandable = change.hunks.length > 0
  const name = baseName(change.path)
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
        <FileKindIcon name={name} size="sm" />
        <span className="fc-path-line">
          {dir ? <span className="fc-dir">{dir}</span> : null}
          <span className="fc-name">{name}</span>
        </span>
        {change.kind === 'write' ? <span className="fc-kind">新建</span> : null}
        <span className="fc-stat num">
          {change.added > 0 && <span className="fc-add">+{change.added}</span>}
          {change.deleted > 0 && <span className="fc-del">−{change.deleted}</span>}
          {change.added === 0 && change.deleted === 0 && <span className="fc-none">无行变更</span>}
        </span>
        <UiIcon icon={SemIcons.expand} size="xs" className="fc-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="fc-detail">
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
/** 默认直接列出的文件数；更多的收在「全部 N 个文件」里 */
const COLLAPSED_ROWS = 4

export function FileChanges({ changes }: { changes: FileChange[] }) {
  const [showAll, setShowAll] = useState(false)
  if (changes.length === 0) return null

  const totalAdded = changes.reduce((n, c) => n + c.added, 0)
  const totalDeleted = changes.reduce((n, c) => n + c.deleted, 0)
  const rows = showAll ? changes : changes.slice(0, COLLAPSED_ROWS)
  const { root, rootFull, dirs } = splitDirs(changes.map((c) => c.path))

  return (
    <section className="fc" aria-label="文件改动">
      <header className="fc-summary">
        <span className="fc-badge" aria-hidden="true">
          <FileKindIcon name="" size="md" />
        </span>
        <span className="fc-summary-text">
          {/* 单个文件也写「1 个文件」：文件名在下面那一行里，头部再写一遍就重复了 */}
          <span className="fc-title">
            已编辑 {changes.length} 个文件
            {root && <span className="fc-root" title={rootFull}>{root}/</span>}
          </span>
          <span className="fc-total num">
            {totalAdded > 0 && <span className="fc-add">+{totalAdded}</span>}
            {totalDeleted > 0 && <span className="fc-del">−{totalDeleted}</span>}
            {totalAdded === 0 && totalDeleted === 0 && <span className="fc-none">无行变更</span>}
          </span>
        </span>
      </header>
      <ul className="fc-list">
        {rows.map((c) => (
          <FileRow key={c.path} change={c} dir={dirs.get(c.path) ?? ''} />
        ))}
      </ul>
      {changes.length > COLLAPSED_ROWS && (
        <button type="button" className="fc-more" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
          {showAll ? '收起' : `全部 ${changes.length} 个文件`}
        </button>
      )}
    </section>
  )
}

export default FileChanges

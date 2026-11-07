/**
 * 产物卡片：模型通过 `present` 工具交付的文件。
 *
 * ## 为什么单独做一块
 *
 * 用户在对话里最想知道的一件事是「东西在哪」。此前这个信息只藏在正文里
 * （「已创建 /tmp/xxx.md」），要自己从一段话里抠路径。DSH 其实发
 * `deliverables/presented` 事件专门表达这件事，但后端以前整条丢弃 ——
 * 这块界面就是把它接出来。
 *
 * ## 只列出模型主动交付的
 *
 * `present` 是模型**主动声明**「这些是最终产物」的动作，和工具顺手写过的
 * 中间文件不是一回事。所以这里只显示 present 的结果，不去扫文件系统 ——
 * 扫出来的东西没法区分「产物」和「临时文件」。
 */
import { FileText, FolderOpen } from 'lucide-react'
import './deliverables.css'

/** 一个交付物。 */
export interface Deliverable {
  path: string
  description?: string
}

/** 取文件名：卡片上显示文件名，完整路径放 title，避免一屏都是长路径。 */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** 取目录：让用户知道文件放哪了，但不占一整行。 */
function dirName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : ''
}

/**
 * 产物卡片。
 *
 * @param files 本次交付的文件；通常 1–4 个
 */
export function Deliverables({ files }: { files: Deliverable[] }) {
  if (files.length === 0) return null
  return (
    <div className="dlv" role="group" aria-label="交付的产物">
      <div className="dlv-head">
        <FolderOpen size={12} aria-hidden="true" />
        <span>产物 · {files.length}</span>
      </div>
      <ul className="dlv-list">
        {files.map((f) => (
          <li key={f.path} className="dlv-item">
            <FileText size={13} className="dlv-icon" aria-hidden="true" />
            <div className="dlv-body">
              <div className="dlv-name num" title={f.path}>{baseName(f.path)}</div>
              {f.description && <div className="dlv-desc">{f.description}</div>}
              <div className="dlv-dir num" title={f.path}>{dirName(f.path)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Deliverables

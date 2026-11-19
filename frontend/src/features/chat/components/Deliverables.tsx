/**
 * 产物卡片：模型通过 `present` 工具交付的文件。
 *
 * ## 为什么单独做一块
 *
 * 用户在对话里最想知道的一件事是「东西在哪」。此前这个信息只藏在正文里
 * （「已创建 /tmp/xxx.md」），要自己从一段话里抠路径。DSH 其实发
 * `deliverables/presented` 事件专门表达这件事，但后端以前整条丢弃。
 *
 * ## 设计来源
 *
 * 结构照 shadcn/ui 的 `Attachment`（`ui.shadcn.com/docs/components/base/attachment`）：
 * 图标底色方块 + 标题 + 描述 的横向三段，`size` 递减尺寸，
 * `AttachmentGroup` 横向排布。第一版是自造的大卡片，块头大、留白多，
 * 塞在回复末尾比正文还抢眼 —— 而它只是「东西在哪」的告知，不该压过正文。
 *
 * 取的是它的**结构与尺寸梯度**，配色仍走本项目令牌（`--surf/--hole/--line/
 * --fg/--dim/--acc`），不引入 shadcn 的 CSS 变量体系。
 *
 * ## 只列出模型主动交付的
 *
 * `present` 是模型**主动声明**「这些是最终产物」的动作，和工具顺手写过的
 * 中间文件不是一回事。所以这里只显示 present 的结果，不去扫文件系统 ——
 * 扫出来的东西没法区分「产物」和「临时文件」。
 */
import '@/features/chat/styles/components/deliverables.css'
import { UiIcon } from '@/shared/icons/UiIcon'
import { File01 } from '@untitledui/icons'

/** 一个交付物。 */
export interface Deliverable {
  path: string
  description?: string
}

/** 取文件名：卡片上显示文件名，完整路径进 title，避免一屏都是长路径。 */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** 取扩展名，做成 `MD` / `MP4` 这样的短标签 —— 和 shadcn 的「PDF · 2.4 MB」同位置。 */
function extLabel(p: string): string {
  const name = baseName(p)
  const i = name.lastIndexOf('.')
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toUpperCase() : 'FILE'
}

/**
 * 产物卡片。
 *
 * @param files 本次交付的文件；通常 1–4 个
 */
export function Deliverables({ files }: { files: Deliverable[] }) {
  if (files.length === 0) return null
  return (
    <div className="dlv">
      <div className="dlv-head">
        <span>产物</span>
        <span className="dlv-count num">{files.length}</span>
      </div>
      <div className="dlv-group">
        {files.map((f) => (
          <div key={f.path} className="dlv-item" title={f.path}>
            <span className="dlv-media" aria-hidden="true">
              <UiIcon icon={File01} size="sm" />
            </span>
            <span className="dlv-content">
              <span className="dlv-name">{baseName(f.path)}</span>
              {/* 描述与类型同处第二行：描述是给人读的，类型是元数据。
                  两者都可能有也都没有，用分隔点连起来，缺一个就不分隔。 */}
              <span className="dlv-meta">
                <span className="dlv-ext">{extLabel(f.path)}</span>
                {f.description && <span className="dlv-desc">{f.description}</span>}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Deliverables

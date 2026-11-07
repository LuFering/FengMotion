/**
 * ComposerAttachments —— 输入框内的待发送附件区。
 *
 * 形态参考 dsh 网页版插件的输入框附件：每张附件是一块**方形卡片**
 * （图标 + 文件名，右上角移除），横向排列，整体嵌在输入框内部上方，
 * 而不是飘在输入框外侧的一行 chip。
 *
 * 为什么改掉原来的 chip：
 *   · 原来的 chip 只有 24px 高、一行一个，文件名一长就挤在一起，
 *     看不出这是「文件」还是「标签」
 *   · 卡片式能一眼区分文件类型（图标占主要视觉），且与下方文字区
 *     属于同一块白色容器，用户的阅读顺序是「附件 → 我要说什么」，
 *     而不是「外面一堆标签 → 输入框」
 *
 * 图标按文件类型着色：图像 / 视频 / 表格 / 文档 / 其他各一色，
 * 颜色全部取自品牌 token（--acc 系列），不引入外部调色盘。
 */

import { FileText, FileSpreadsheet, Image as ImageIcon, Film, File, X, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import './composer-attachments.css'

/** 一张待发送附件。 */
export interface ComposerAttachment {
  /** 文件名（含扩展名） */
  name: string
  /** 粗分类，决定图标与配色 */
  kind: 'image' | 'video' | 'sheet' | 'doc' | 'other'
  /** 上传中 */
  uploading?: boolean
  /** 上传失败原因 */
  uploadError?: string
  /** 附件用途（项目资源引用时才有） */
  purpose?: string
  /** 用途的中文说明 */
  purposeLabel?: string
  /** 补充说明，作为 title 提示 */
  note?: string
}

export interface ComposerAttachmentsProps {
  items: ComposerAttachment[]
  onRemove: (index: number) => void
}

/** 每种类型一组图标与配色 token。 */
const KIND_META = {
  image: { Icon: ImageIcon, tone: 'img' },
  video: { Icon: Film, tone: 'vid' },
  sheet: { Icon: FileSpreadsheet, tone: 'sheet' },
  doc: { Icon: FileText, tone: 'doc' },
  other: { Icon: File, tone: 'other' },
} as const

/**
 * 去掉扩展名，只留主文件名。
 *
 * 卡片宽度固定，长文件名必须截断；保留扩展名信息由底部的
 * 大写小字后缀单独呈现，所以这里剥掉避免「.mp4」占掉正文宽度。
 */
function stem(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

/** 取扩展名（大写，不含点）；没有则返回空串。 */
function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toUpperCase() : ''
}

export function ComposerAttachments({ items, onRemove }: ComposerAttachmentsProps) {
  if (items.length === 0) {
    return null
  }
  return (
    <ul className="ca-row" aria-label="待发送的附件">
      {items.map((item, i) => {
        const { Icon, tone } = KIND_META[item.kind] ?? KIND_META.other
        const suffix = ext(item.name)
        return (
          <li
            key={`${item.name}-${i}`}
            className="ca-card"
            data-tone={tone}
            data-busy={item.uploading ? '' : undefined}
            data-error={item.uploadError ? '' : undefined}
            title={[item.name, item.purposeLabel, item.note].filter(Boolean).join(' · ')}
          >
            {/* 图标区：占据卡片上半部的主体视觉，颜色由 data-tone 决定 */}
            <span className="ca-figure" aria-hidden>
              <Icon size={19} strokeWidth={1.6} />
            </span>

            {/* 文件名：主名截断 + 后缀小字。两行结构保证长名也不会把卡片撑破 */}
            <span className="ca-name">{stem(item.name)}</span>
            {suffix ? <span className="ca-ext">{suffix}</span> : null}

            {/* 用途角标：只有项目资源引用才出现，标出「这张图是干吗用的」 */}
            {item.purposeLabel ? <span className="ca-purpose">{item.purposeLabel}</span> : null}

            {/* 上传中：盖住图标显示进度环，避免用户重复添加 */}
            {item.uploading ? (
              <span className="ca-busy" role="status" aria-label={`${item.name} 上传中`}>
                <Loader2 size={15} className="ca-spin" />
              </span>
            ) : null}

            {/* 上传失败：图标换成警示色，并在 title 里给出原因 */}
            {item.uploadError ? (
              <span className="ca-fail" aria-label={`${item.name} 上传失败：${item.uploadError}`}>
                <AlertCircle size={14} />
              </span>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ca-remove"
              aria-label={`移除附件 ${item.name}`}
              onClick={() => onRemove(i)}
            >
              <X />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

export default ComposerAttachments

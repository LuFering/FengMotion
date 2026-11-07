/**
 * ComposerAttachments —— 输入框内的待发送附件。
 *
 * 按 BoardUI「Composer 附件」组件的真实实现还原。
 * 所有数值取自该组件线上 DOM 的计算样式（不是估算）：
 *   图块        56×56、圆角 12px、边框 1px #EBEBEB
 *   缩略图      图片占满 56×56，圆角 11px，object-cover
 *   类型图标    24×24，位置 top:4px / left:3px
 *   文件名      9px / 行高 15px / 字重 500 / 字距 0.2px
 *               位置 top:36px / left:6px，max-width:44px 截断
 *   进度文字    9px，位置 top:3px / right:3px，等宽数字
 *   移除按钮    16×16 圆形，50% 透明白底，× 为 7×7 描边
 *   进度环      沿圆角矩形顺时针描边，pathLength=100
 *
 * 图标资源是组件同款 SVG（src/assets/composer-icons），原样保留，
 * 因为它们自带多层渐变与内阴影，手绘只能做出近似。
 */

import { useState } from 'react'
import codeIcon from '@/assets/composer-icons/code.svg'
import documentIcon from '@/assets/composer-icons/document.svg'
import presentationIcon from '@/assets/composer-icons/presentation.svg'
import spreadsheetIcon from '@/assets/composer-icons/spreadsheet.svg'
import videoIcon from '@/assets/composer-icons/video.svg'
import './composer-attachments.css'

/** 附件的六种类型，对应组件里的六种图块。 */
export type ComposerAttachmentKind =
  | 'image'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'code'
  | 'video'

/** 一张待发送附件。 */
export interface ComposerAttachment {
  name: string
  kind: ComposerAttachmentKind
  /** 图片附件的本地预览地址；有则直接铺满图块 */
  src?: string
  /**
   * 上传进度 0–100。
   * 有值（含 0）时显示进度环并在角落计数；
   * `undefined` 表示已落地 —— 环消失、角标消失，图块不再变暗。
   */
  progress?: number
  /** 上传失败原因 */
  error?: string
  /** 补充说明（如附件用途）。图块放不下，写进 title 提示。 */
  note?: string
}

export interface ComposerAttachmentsProps {
  items: ComposerAttachment[]
  onRemove: (index: number) => void
}

/** 非图片类型的图标。 */
const KIND_ICON: Record<Exclude<ComposerAttachmentKind, 'image'>, string> = {
  document: documentIcon,
  spreadsheet: spreadsheetIcon,
  presentation: presentationIcon,
  code: codeIcon,
  video: videoIcon,
}

/**
 * 进度环的路径。
 *
 * 取自组件真实 SVG：一个 56×56 圆角矩形，顺时针从顶部中点开始。
 * 用 pathLength="100" 把长度归一化，这样 strokeDasharray 可以直接
 * 写百分比，不用自己算周长。
 */
const RING_PATH = 'M 28 1 H 44 A 11 11 0 0 1 55 12 V 44 A 11 11 0 0 1 44 55 H 12 A 11 11 0 0 1 1 44 V 12 A 11 11 0 0 1 12 1 Z'

/** 去掉扩展名，只留主文件名（截断交给 CSS）。 */
function stem(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

export function ComposerAttachments({ items, onRemove }: ComposerAttachmentsProps) {
  /* 悬停的是哪一张：用来决定移除按钮显不显示。
     组件原版是 hover 才显现（触屏常显），与它保持一致。 */
  const [hovered, setHovered] = useState<number | null>(null)

  if (items.length === 0) {
    return null
  }

  return (
    <ul className="cat-strip" aria-label="待发送的附件">
      {items.map((item, i) => {
        const uploading = item.progress !== undefined
        const pct = uploading ? Math.min(100, Math.max(0, item.progress ?? 0)) : 100
        return (
          <li
            key={`${item.name}-${i}`}
            className="cat-tile"
            data-uploading={uploading ? '' : undefined}
            data-error={item.error ? '' : undefined}
            title={[item.name, item.note, item.error ? `上传失败：${item.error}` : null]
              .filter(Boolean).join(' · ')}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
          >
            {/* 内容层：图片铺缩略图，其他类型显示 24px 图标 + 文件名。
                上传中整层变暗（组件原版就是这样表示「还没落地」）。 */}
            <div className="cat-body" data-dim={uploading ? '' : undefined}>
              {item.kind === 'image' && item.src ? (
                <img className="cat-thumb" src={item.src} alt="" />
              ) : (
                <>
                  <img
                    className="cat-icon"
                    src={KIND_ICON[item.kind as Exclude<ComposerAttachmentKind, 'image'>]}
                    alt=""
                    aria-hidden
                  />
                  <span className="cat-name">{stem(item.name)}</span>
                </>
              )}
            </div>

            {/* 进度环：只在 0–99 之间画；到 100 即视为落地，环与角标一起消失 */}
            {uploading && pct < 100 ? (
              <>
                <svg className="cat-ring" viewBox="0 0 56 56" aria-hidden>
                  <path
                    d={RING_PATH}
                    fill="none"
                    stroke="var(--acc)"
                    strokeWidth={2}
                    strokeLinecap="round"
                    pathLength={100}
                    strokeDasharray={`${pct} 200`}
                  />
                </svg>
                <span className="cat-pct" aria-hidden>{Math.round(pct)}%</span>
              </>
            ) : null}

            <button
              type="button"
              className="cat-remove"
              data-visible={hovered === i || item.error ? '' : undefined}
              aria-label={item.error
                ? `移除附件 ${item.name}（上传失败：${item.error}）`
                : `移除附件 ${item.name}`}
              onClick={() => onRemove(i)}
            >
              <svg viewBox="0 0 6.8 6.8" width="7" height="7" aria-hidden>
                <path d="M0.57 0.57L6.23 6.23" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M6.23 0.57L0.57 6.23" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default ComposerAttachments

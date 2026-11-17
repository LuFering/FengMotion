/**
 * ComposerAttachments —— 输入框内的待发送附件。
 *
 * 结构与尺寸取自 LeiBox「Agent 对话输入框」的官方原版源码
 * （components/ComposerAttachmentList.tsx 与 ComposerAttachButton.tsx）：
 *
 *   容器      flex / 间距 10px（gap-2.5）/ 横向可滚 / 上下留 6px、4px
 *   图片项    68×68 方图、圆角 10px、1px 描边、bg-ui-tint
 *             移除按钮 20×20、-right-1 -top-1、2px 与底色的描边环
 *   文件项    高 56（h-14）、最宽 220px、圆角 16px（rounded-2xl）
 *             底色 bg-black/5；图标块 40×40 / 圆角 12px / 白底
 *             文件名 12px·500；状态 11px 次级色；移除按钮 24×24
 *
 * 与官方原版的一处差异（有明确理由）：
 *   上传中用**进度环**表示，而不是原版底部那条「识别中…」文字。
 *   本项目的上传是真传（选文件即 POST /api/uploads，发送时只带 fileId），
 *   XHR 能给到真实百分比，画环比写一句"处理中"信息量更高。
 *   环沿图块/卡片外缘描一圈，角落显示百分比，落地后一起消失。
 */

import { CircleAlert, File, FileText, Image as ImageIcon, X } from 'lucide-react'
import { SpringDisclosure } from './SpringDisclosure'
import './composer-attachments.css'

/** 附件分类，对应两种视觉形态。 */
export type ComposerAttachmentKind = 'image' | 'file'

/** 一张待发送附件。 */
export interface ComposerAttachment {
  name: string
  kind: ComposerAttachmentKind
  /** 图片的本地预览地址（object URL）；有则铺满方图 */
  src?: string
  /** 真实上传进度 0–100；undefined 表示已落地 */
  progress?: number
  /** 失败原因 */
  error?: string
  /** 补充说明（用途等），进 title */
  note?: string
  /** 文件项副标题：类型说明或错误。缺省按「文件」显示 */
  caption?: string
}

export interface ComposerAttachmentsProps {
  items: ComposerAttachment[]
  onRemove: (index: number) => void
}

/**
 * 进度环路径：一个贴合 68/56 方框的圆角矩形。
 *
 * 用 viewBox="0 0 100 100" 的归一化坐标 + preserveAspectRatio="none"，
 * 这样同一段 path 能同时用在 68×68 的方块和 220×56 的长条上 ——
 * 不必为两种形状各写一条弧线。
 */
/**
 * 圆角矩形路径：从顶部中点起顺时针一圈。
 *
 * 用 100 单位宽的标准坐标系，pathLength="100" 让 dasharray 直接等于百分比。
 * 宽高分别适配图片（正方形）与文件（长条），避免同一个框被拉伸。
 */
function ringPath(isImage: boolean): string {
  const w = 100
  const h = isImage ? 100 : 46   // 68:68 与 220:56，与 CSS 中的实际比例接近
  const r = isImage ? 7 : 14
  return [
    `M ${w / 2} 1`,
    `H ${w - r}`, `A ${r} ${r} 0 0 1 ${w - 1} ${r + 1}`,
    `V ${h - r - 1}`, `A ${r} ${r} 0 0 1 ${w - r} ${h - 1}`,
    `H ${r}`, `A ${r} ${r} 0 0 1 1 ${h - r - 1}`,
    `V ${r + 1}`, `A ${r} ${r} 0 0 1 ${r} 1`,
    'Z',
  ].join(' ')
}

/** 与 ringPath 配套的 viewBox；文件项允许横向拉伸以匹配真实宽度。 */
function ringViewBox(isImage: boolean): string {
  return isImage ? '0 0 100 100' : '0 0 100 46'
}

/** 去掉扩展名，只留主文件名（截断交给 CSS）。 */
function stem(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

export function ComposerAttachments({ items, onRemove }: ComposerAttachmentsProps) {
  if (items.length === 0) {
    return null
  }

  return (
    /* 外层用高度弹簧：附件出现/消失时输入框不会被"撑一下再回落"，
       而是弹性地长高/收起（对照原版 SpringDisclosure） */
    <SpringDisclosure open={items.length > 0} unmountOnExit={false}>
    <ul className="cat-strip" aria-label="待发送的附件">
      {items.map((item, i) => {
        const uploading = item.progress !== undefined
        const pct = uploading ? Math.min(99, Math.max(0, item.progress ?? 0)) : 100
        const isImage = item.kind === 'image'

        return (
          <li
            key={`${item.name}-${i}`}
            className={`${isImage ? 'cat-image' : 'cat-file'} cat-enter`}
            data-error={item.error ? '' : undefined}
            title={[item.name, item.note, item.error ? `上传失败：${item.error}` : null]
              .filter(Boolean).join(' · ')}
          >
            {isImage ? (
              <>
                {item.src ? (
                  <img className="cat-thumb" src={item.src} alt="" />
                ) : (
                  <span className="cat-thumb-empty" aria-hidden>
                    <ImageIcon size={20} />
                  </span>
                )}

                {/* 失败的图片：底部压一条错误提示（原版的 status 条位置） */}
                {item.error ? (
                  <span className="cat-badge" role="alert">
                    <CircleAlert size={12} />
                    <span>{stem(item.name)}</span>
                  </span>
                ) : null}
              </>
            ) : (
              <>
                <span className="cat-file-icon" aria-hidden>
                  <FileIcon name={item.name} />
                </span>
                <span className="cat-file-text">
                  <span className="cat-file-name">{stem(item.name)}</span>
                  <span className="cat-file-meta" data-error={item.error ? '' : undefined}>
                    {item.error ? item.error : item.caption ?? '文件'}
                  </span>
                </span>
              </>
            )}

            {/* 进度环：上传中才画，覆盖整块外缘。
                图片是正方形、文件是长条，两者用同一段路径会被拉伸，
                所以按形态给不同的 viewBox（见 ringViewBox）。 */}
            {uploading && pct < 100 ? (
              <>
                <svg className="cat-ring" viewBox={ringViewBox(isImage)} aria-hidden>
                  <path
                    d={ringPath(isImage)}
                    fill="none"
                    stroke="var(--acc)"
                    strokeWidth={2}
                    strokeLinecap="round"
                    /* 不用 pathLength + 百分比：Chrome 里 dasharray 仍按
                       真实的 px 长度解释，于是 "3 200" 几乎是空的，
                       环只画出顶部一小段（实测 getTotalLength=260）。
                       这里直接给一个足够长的路径，把 dasharray 写成本形状
                       的近似周长比例，两种形状各自成立。 */
                    strokeDasharray={`${pct * (isImage ? 3.6 : 5.4)} ${isImage ? 400 : 700}`}
                  />
                </svg>
                <span className="cat-pct" aria-hidden>{Math.round(pct)}%</span>
              </>
            ) : null}

            <button
              type="button"
              className={isImage ? 'cat-remove cat-remove-image' : 'cat-remove cat-remove-file'}
              aria-label={item.error
                ? `移除附件 ${item.name}（上传失败：${item.error}）`
                : `移除附件 ${item.name}`}
              onClick={() => onRemove(i)}
            >
              <X size={isImage ? 10 : 11} strokeWidth={2.6} />
            </button>
          </li>
        )
      })}
    </ul>
    </SpringDisclosure>
  )
}

/** 文件类型图标：文本类与普通文件区分（对齐原版 file-lines / file）。 */
function FileIcon({ name }: { name: string }) {
  return /\.(txt|md|markdown|csv|json|ya?ml|log)$/i.test(name)
    ? <FileText size={18} />
    : <File size={18} />
}

export default ComposerAttachments

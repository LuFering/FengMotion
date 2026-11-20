import { Brackets, File02, FileCode02, Film01, Folder, Image01, MusicNote01, FileCheck02 } from '@untitledui/icons'
import { UiIcon } from '@/shared/icons/UiIcon'
import '@/features/chat/styles/components/file-kind.css'

import { fileKindOf } from '@/features/chat/model/fileKind'

const KIND_ICON = {
  code: FileCode02,
  data: Brackets,
  doc: FileCheck02,
  image: Image01,
  video: Film01,
  audio: MusicNote01,
  folder: Folder,
  file: File02,
} as const

/**
 * 按文件类型给图标：代码、配置数据、文档、图片、视频、音频、目录各一个，颜色由 `data-kind` 区分。
 * 文件标签、改动文件卡和产物卡共用同一套，同一种文件在三处长得一样。
 */
export function FileKindIcon({ name, size = 'xs', className }: { name: string; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const kind = fileKindOf(name)
  return (
    <span className={`fk-icon${className ? ` ${className}` : ''}`} data-kind={kind} aria-hidden="true">
      <UiIcon icon={KIND_ICON[kind]} size={size} />
    </span>
  )
}

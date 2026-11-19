import { STATUS_META } from '@/features/reference/model/referenceLibrary'
import { shortValue } from '@/features/reference/model/refBrowse'
import { useCurrentSegment } from '@/features/reference/hooks/library/useCurrentSegment'

export interface RefFilmHeaderProps {
  current: ReturnType<typeof useCurrentSegment>['current']
  film: ReturnType<typeof useCurrentSegment>['film']
  filmSegments: ReturnType<typeof useCurrentSegment>['filmSegments']
  hasSegment: ReturnType<typeof useCurrentSegment>['hasSegment']
  pendingCount: number
}

/** 从 RefLibrary.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function RefFilmHeader({ current, film, filmSegments, hasSegment, pendingCount }: RefFilmHeaderProps) {
  return (
    <header className="rfc-head">
      <div className="rfc-eyebrow">参考片库</div>
      <h1 className="rfc-title">{film.title}</h1>
      <p className="rfc-desc">{film.description}</p>
      {/* 去 AI 味：来源 / 进度 / 状态不再做成 pill 标签云，压成一行普通元信息；
          只留真正区分片段的属性（景别、运镜）作标签 */}
      <div className="rfc-meta-line">
        {/* 没有片段时不能显示「片段 1 / 0」—— 那个 1 是占位值，会让人以为已有片段。 */}
        {film.source}
        {hasSegment
          ? ` · 片段 ${current.index + 1} / ${filmSegments.length} · ${STATUS_META[current.status].label}`
          : ' · 还没有片段'}
        {hasSegment && pendingCount > 0 && ` · ${pendingCount} 项待分析`}
      </div>
      <div className="rfc-chips">
            
        {!current.analysis.cameraMove.pending && <span className="rfc-glass">{shortValue(current.analysis.cameraMove.value)}</span>}
      </div>
    </header>
  )
}

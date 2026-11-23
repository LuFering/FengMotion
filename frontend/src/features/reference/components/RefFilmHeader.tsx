import { STATUS_META, formatDuration } from '@/features/reference/model/referenceLibrary'
import { useCurrentSegment } from '@/features/reference/hooks/useCurrentSegment'

export interface RefFilmHeaderProps {
  film: NonNullable<ReturnType<typeof useCurrentSegment>['film']>
  filmSegments: ReturnType<typeof useCurrentSegment>['filmSegments']
}

/**
 * 当前参考片的标题区：片名、简介，以及一行元信息「来源 · 时长 · N 个片段 · 状态」。
 * 状态只在这里写一次（原先「待分析」「6 项待分析」写两遍）；片段级信息归分析面板。
 */
export function RefFilmHeader({ film, filmSegments }: RefFilmHeaderProps) {
  const meta = [
    film.source,
    film.durationMs > 0 ? formatDuration(film.durationMs / 1000) : '',
    filmSegments.length > 0 ? `${filmSegments.length} 个片段` : '还没有片段',
    STATUS_META[film.status]?.label ?? '',
  ].filter(Boolean)
  return (
    <header className="rfc-head">
      <div className="rfc-eyebrow">参考片库</div>
      <h1 className="rfc-title">{film.title}</h1>
      {film.description?.trim() && <p className="rfc-desc">{film.description}</p>}
      <div className="rfc-meta-line">{meta.join(' · ')}</div>
    </header>
  )
}

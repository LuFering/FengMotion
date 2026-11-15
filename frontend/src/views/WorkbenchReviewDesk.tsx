import { useState } from 'react'
import {
  Check, ClipboardList,
  GitCompareArrows, MessageSquarePlus,
  RotateCcw, Search, Target, X
} from 'lucide-react'
import type { WorkbenchReview } from '@/hooks/useWorkbenchReview'
import type { StageVisual } from '@/data/stageVisual'
import type { ReviewOpinion } from '@/services/workbenchReviewService'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const date = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

function findMatchingVisual(
  visuals: StageVisual[],
  revision?: number,
  visualId?: string,
  origin?: 'scene' | 'workflow' | 'editor'
): StageVisual | undefined {
  // 1. 若有明确记录的画面 ID，严格按 ID 查；找不到时说明该特定画面已不可用，绝不回退按版本号盲目匹配其他画面
  if (visualId) {
    return visuals.find((v) => v.id === visualId)
  }
  // 2. 只有在历史记录本身未保存画面 ID 时，才按来源和版本号谨慎兼容
  if (typeof revision === 'number') {
    const expectedOrigin = origin ?? 'scene'
    const byVerAndOrigin = visuals.find((v) => v.revision === revision && v.origin === expectedOrigin)
    if (byVerAndOrigin) return byVerAndOrigin
    // 仅在整个列表中该版本号唯一且为场景版本时匹配，绝不串配 workflow / editor 画面
    const matches = visuals.filter((v) => v.revision === revision)
    if (matches.length === 1 && matches[0].origin === 'scene') {
      return matches[0]
    }
  }
  return undefined
}

export function WorkbenchReviewDesk({
  review,
  visuals,
  viewedId,
  onCompare,
  onLocate,
  onContinue,
  onDiscuss,
  onView: _onView,
}: {
  review: WorkbenchReview
  visuals: StageVisual[]
  viewedId?: string
  onCompare: (left: StageVisual, right: StageVisual, opinion?: ReviewOpinion) => void
  onLocate?: (opinion: ReviewOpinion) => void
  onContinue?: (opinion: ReviewOpinion) => void
  onDiscuss: () => void
  projectId?: string
  onView?: (visual: StageVisual) => void
  onClose?: () => void
}) {
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open')
  const [search, setSearch] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)

  const openCount = review.opinions.filter((o) => o.status === 'open').length
  const totalCount = review.opinions.length
  const visible = review.opinions.filter((o) => {
    const matchesFilter = filter === 'all' || o.status === filter
    const searchTarget = `${o.request.prompt} ${o.request.references?.find((r) => r.role === 'target')?.label ?? ''}`.toLowerCase()
    return matchesFilter && (!search.trim() || searchTarget.includes(search.toLowerCase()))
  })

  return (
    <div className="fw-scroll flex flex-col h-full bg-transparent p-3">
      {/* 顶部标题与轻量工具组（图标 + 悬浮提示，不挂多余关闭钮） */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--line)]">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm text-[var(--tx)]">修改审阅</span>
          {totalCount > 0 && (
            <span className="text-xs text-[var(--tx3)]">
              ({openCount > 0 ? `${openCount} 条待核对` : '全部已处理'})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {totalCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={`p-1 rounded transition-colors ${
                    searchExpanded ? 'text-blue-500 bg-blue-500/10' : 'text-[var(--tx3)] hover:text-[var(--tx)]'
                  }`}
                  onClick={() => {
                    setSearchExpanded((v) => !v)
                    if (searchExpanded) setSearch('')
                  }}
                  aria-label="搜索意见"
                >
                  <Search size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">搜索意见描述与画面目标</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="p-1 rounded text-blue-500 hover:bg-blue-500/10 transition-colors"
                onClick={onDiscuss}
                aria-label="提新意见"
              >
                <MessageSquarePlus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">在对话中提出新修改意见</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* 搜索展开框 */}
      {searchExpanded && (
        <div className="relative mt-2">
          <input
            type="text"
            autoFocus
            aria-label="搜索意见或画面"
            className="w-full text-xs py-1.5 pl-6 pr-6 rounded-lg bg-[var(--hole)] border border-blue-500/40 text-[var(--tx)] placeholder:text-[var(--tx3)] focus:outline-none"
            placeholder="搜索意见描述、引用目标…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Search size={11} className="absolute left-2 top-2.5 text-[var(--tx3)] pointer-events-none" />
          {search && (
            <button
              type="button"
              className="absolute right-2 top-2 text-[var(--tx3)] hover:text-[var(--tx)]"
              onClick={() => setSearch('')}
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {/* 仅在有历史意见时才展示筛选分段器，避免 0 条时重复说明无内容 */}
      {totalCount > 0 && (
        <div className="grid grid-cols-3 p-0.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-xs text-center mt-2">
          <button
            type="button"
            className={`py-1 rounded-md transition-colors ${filter === 'open' ? 'bg-[var(--surf)] font-medium text-[var(--tx)] shadow-xs' : 'text-[var(--tx3)] hover:text-[var(--tx)]'}`}
            onClick={() => setFilter('open')}
          >
            待核对 ({openCount})
          </button>
          <button
            type="button"
            className={`py-1 rounded-md transition-colors ${filter === 'resolved' ? 'bg-[var(--surf)] font-medium text-[var(--tx)] shadow-xs' : 'text-[var(--tx3)] hover:text-[var(--tx)]'}`}
            onClick={() => setFilter('resolved')}
          >
            已处理 ({totalCount - openCount})
          </button>
          <button
            type="button"
            className={`py-1 rounded-md transition-colors ${filter === 'all' ? 'bg-[var(--surf)] font-medium text-[var(--tx)] shadow-xs' : 'text-[var(--tx3)] hover:text-[var(--tx)]'}`}
            onClick={() => setFilter('all')}
          >
            全部 ({totalCount})
          </button>
        </div>
      )}

      {/* 克制的空状态：一句事实 + 一个动作 */}
      {visible.length === 0 && (
        <div className="py-12 text-center text-xs text-[var(--tx3)] flex flex-col items-center justify-center">
          <ClipboardList size={24} className="mb-2 opacity-30 text-[var(--tx)]" />
          <p className="text-[var(--tx2)] text-[13px]">
            {totalCount ? '没有匹配的修改意见' : '暂无修改意见'}
          </p>
          <p className="mt-1 text-xs text-[var(--tx3)]">
            {totalCount ? '可切换过滤选项或清空搜索关键词' : '在右侧选定画面或时间段后，可在对话中提出意见。'}
          </p>
          <button
            type="button"
            className="mt-3 text-xs text-blue-500 hover:underline"
            onClick={onDiscuss}
          >
            去对话提意见 →
          </button>
        </div>
      )}

      {/* 意见列表 */}
      <div className="flex flex-col gap-2 mt-2">
        {visible.map((opinion) => {
          const target = opinion.request.references?.find((r) => r.role === 'target')
          // 前后对比只使用真实存在、明确归属且来源一致的双版本，杜绝不同来源同版本号混淆
          const before = findMatchingVisual(visuals, opinion.baseVersion, opinion.baseVisualId, opinion.baseOrigin)
          const after = findMatchingVisual(visuals, opinion.resultVersion, opinion.resultVisualId, opinion.resultOrigin)
          const canCompare = Boolean(
            before &&
            after &&
            before.id !== after.id &&
            before.file &&
            after.file &&
            before.file !== after.file &&
            before.media === after.media
          )

          // 版本推进文案（如实反映事实，绝不猜测伪造）
          const hasBase = typeof opinion.baseVersion === 'number'
          const hasResult = typeof opinion.resultVersion === 'number'
          const versionLabel = (hasBase && hasResult)
            ? `v${opinion.baseVersion} → v${opinion.resultVersion}`
            : hasBase
              ? `基准 v${opinion.baseVersion} · 未生成新版本`
              : hasResult
                ? `生成版本 v${opinion.resultVersion}`
                : '未关联版本'

          return (
            <article
              key={opinion.id}
              className={`p-2.5 rounded-lg border transition-colors ${
                opinion.status === 'resolved'
                  ? 'border-[var(--line)] bg-[var(--hole)]/50 opacity-80'
                  : 'border-[var(--line)] bg-[var(--hole)] hover:border-[var(--line2)]'
              }`}
            >
              {/* 顶栏：用户审阅结论标签 + AI 执行版本标签 + 时间 */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[11px] px-1.5 py-0.2 rounded font-medium ${
                    opinion.status === 'resolved' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-blue-500/10 text-blue-500'
                  }`}>
                    {opinion.status === 'resolved' ? '已处理' : '待核对'}
                  </span>
                  <span className="text-[11px] px-1.5 py-0.2 rounded bg-[var(--surf)] border border-[var(--line)] text-[var(--tx2)] font-mono">
                    {versionLabel}
                  </span>
                </div>
                <time className="text-[11px] text-[var(--tx3)] shrink-0">{date(opinion.createdAt)}</time>
              </div>

              {/* 用户原修改要求 */}
              <p className="text-[13px] text-[var(--tx)] leading-relaxed mt-2 whitespace-pre-wrap">
                {opinion.request.prompt}
              </p>

              {/* 当时的修改目标位置 */}
              {target && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-[var(--tx3)] bg-[var(--surf)]/60 px-2 py-1 rounded border border-[var(--line)]/40">
                  <Target size={12} className="shrink-0 text-blue-500" />
                  <span className="truncate flex-1 font-mono text-[11px]">{target.label}</span>
                  {onLocate && (
                    <button
                      type="button"
                      className="text-blue-500 hover:underline text-[11px] shrink-0"
                      onClick={() => onLocate(opinion)}
                      title="打开该目标所属版本并定位"
                    >
                      定位
                    </button>
                  )}
                </div>
              )}

              {/* AI 实际回复与改动说明 */}
              {opinion.resultSummary && (
                <div className="mt-2 p-2 rounded bg-[var(--surf)] border border-[var(--line)] text-xs text-[var(--tx2)]">
                  <div className="text-[11px] font-medium text-[var(--tx3)] mb-0.5 flex items-center gap-1">
                    <span>AI 执行说明</span>
                  </div>
                  <p className="whitespace-pre-wrap leading-relaxed text-[12px] text-[var(--tx)]">
                    {opinion.resultSummary}
                  </p>
                </div>
              )}

              {/* 动作组 */}
              <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-[var(--line)]/50 text-xs flex-wrap gap-2">
                <div className="flex items-center gap-2.5 flex-wrap">
                  {canCompare ? (
                    <button
                      type="button"
                      className="text-blue-500 hover:underline flex items-center gap-1 font-medium"
                      onClick={() => onCompare(before!, after!, opinion)}
                    >
                      <GitCompareArrows size={12} />
                      <span>对比前后</span>
                    </button>
                  ) : hasBase && hasResult ? (
                    <span className="text-[11px] text-[var(--tx3)]">
                      {!before || !after ? '版本画面已不可用' : before.file === after.file ? '前后画面一致' : '类型不匹配'}
                    </span>
                  ) : null}

                  {onContinue && (
                    <button
                      type="button"
                      className="text-[var(--tx)] hover:text-blue-500 hover:underline flex items-center gap-1 font-medium"
                      onClick={() => onContinue(opinion)}
                      title="基于上一轮意见继续调整（将打开最新版本由你确认新目标）"
                    >
                      <MessageSquarePlus size={12} />
                      <span>继续调整</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {opinion.status === 'open' ? (
                    <button
                      type="button"
                      className="text-emerald-500 hover:underline flex items-center gap-1 font-medium"
                      onClick={() => review.resolve(opinion.id, viewedId)}
                    >
                      <Check size={12} />
                      <span>标记已处理</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-[var(--tx3)] hover:text-[var(--tx)] flex items-center gap-1"
                      onClick={() => review.reopen(opinion.id)}
                    >
                      <RotateCcw size={12} />
                      <span>重新打开</span>
                    </button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

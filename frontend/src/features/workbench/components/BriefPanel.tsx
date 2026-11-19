import type { WorkbenchReview } from '@/features/workbench/hooks/useWorkbenchReview'
import { File01, LayersThree01, Plus, Tag01 } from '@untitledui/icons'
import type { BriefSection } from './BriefDetailWorkspace'

/**
 * 创作要求（BriefPanel —— 左侧目录）
 * 共享左栏统一透明底色，不套独立白底板。
 * 四项清晰目录：全部要求 + 三大分区，左侧选择直接联动右侧。
 */

export function BriefPanel({
  review,
  activeSection = 'all',
  onSelectSection,
  onDiscuss,
}: {
  review: WorkbenchReview
  activeSection?: BriefSection
  onSelectSection?: (section: BriefSection) => void
  onDiscuss?: () => void
}) {
  const briefStatus = review.brief.original ? '已录入' : '待录入'
  const keepStatus = review.keepNotes ? '随每轮提交' : '未设定'
  const correctionsCount = review.corrections.length

  const items: { id: BriefSection; title: string; hint: string; icon: typeof File01 }[] = [
    {
      id: 'all',
      title: '全部创作要求',
      hint: '完整视图',
      icon: LayersThree01,
    },
    {
      id: 'original',
      title: '原始制作需求',
      hint: briefStatus,
      icon: File01,
    },
    {
      id: 'keep',
      title: '文字保留要求',
      hint: keepStatus,
      icon: Tag01,
    },
    {
      id: 'corrections',
      title: '后续补充要求',
      hint: `${correctionsCount} 条`,
      icon: Plus,
    },
  ]

  return (
    <div className="fw-scroll flex flex-col h-full bg-transparent p-3">
      {/* 栏目头部 */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--line)]">
        <span className="font-medium text-sm text-[var(--tx)]">创作要求目录</span>
        <span className="text-[11px] text-[var(--tx3)]">
          {activeSection === 'all' ? '正在查看全部' : '单项查看'}
        </span>
      </div>

      {/* 目录项列表：点击直接切换右侧视图，关系直接无多余入口 */}
      <div className="flex flex-col gap-1 mt-2">
        {items.map((item) => {
          const active = activeSection === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection?.(item.id)}
              className={`w-full px-2.5 py-2 rounded-lg text-left transition-colors flex items-center justify-between ${
                active
                  ? 'bg-blue-500/10 text-blue-500 font-medium'
                  : 'hover:bg-[var(--hover)] text-[var(--tx2)] hover:text-[var(--tx)]'
              }`}
            >
              <span className="flex items-center gap-2 text-[13px]">
                <Icon size={14} className={active ? 'text-blue-500' : 'text-[var(--tx3)]'} />
                <span>{item.title}</span>
              </span>
              <span className={`text-xs ${active ? 'text-blue-500' : 'text-[var(--tx3)]'}`}>
                {item.hint}
              </span>
            </button>
          )
        })}
      </div>

      {onDiscuss && (
        <div className="mt-auto pt-3 border-t border-[var(--line)]">
          <button
            type="button"
            className="text-xs text-[var(--tx3)] hover:text-[var(--tx)] flex items-center gap-1 transition-colors"
            onClick={onDiscuss}
          >
            <span>← 返回对话提新要求</span>
          </button>
        </div>
      )}
    </div>
  )
}

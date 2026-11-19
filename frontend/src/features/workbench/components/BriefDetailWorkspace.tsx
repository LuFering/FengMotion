import React, { useEffect, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { File01, Monitor01, Tag01 } from '@untitledui/icons'
import type { WorkbenchReview } from '@/features/workbench/hooks/useWorkbenchReview'

export type BriefSection = 'all' | 'original' | 'keep' | 'corrections'

const date = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const getDraft = (key: string, fallback: string) => {
  try {
    const val = sessionStorage.getItem(key)
    return val !== null ? val : fallback
  } catch {
    return fallback
  }
}

const setDraft = (key: string, val: string) => {
  try {
    sessionStorage.setItem(key, val)
  } catch {
    /* 忽略存储异常 */
  }
}

const clearDraft = (key: string) => {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* 忽略存储异常 */
  }
}

export function BriefDetailWorkspace({
  review,
  projectId = '',
  activeSection = 'all',
  onClose,
  onDiscuss,
}: {
  review: WorkbenchReview
  projectId?: string
  activeSection?: BriefSection
  onClose: () => void
  onDiscuss?: () => void
}) {
  const keepDraftKey = `fm-brief-draft-keep:${projectId}`
  const correctionDraftKey = `fm-brief-draft-corr:${projectId}`
  const origDraftKey = `fm-brief-draft-orig:${projectId}`

  const [keepInput, setKeepInput] = useState(() => getDraft(keepDraftKey, review.keepNotes))
  const [correctionInput, setCorrectionInput] = useState(() => getDraft(correctionDraftKey, ''))
  const [originalInput, setOriginalInput] = useState(() => getDraft(origDraftKey, review.brief.original || ''))
  const [isEditingOriginal, setIsEditingOriginal] = useState(false)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)

  // 监听输入并实时缓存到当前项目草稿，避免切页或返回画面后丢失未保存内容
  useEffect(() => {
    setDraft(keepDraftKey, keepInput)
  }, [keepInput, keepDraftKey])

  useEffect(() => {
    setDraft(correctionDraftKey, correctionInput)
  }, [correctionInput, correctionDraftKey])

  useEffect(() => {
    setDraft(origDraftKey, originalInput)
  }, [originalInput, origDraftKey])

  const notify = (msg: string) => {
    setSavedNotice(msg)
    setTimeout(() => setSavedNotice(null), 2500)
  }

  const handleSaveKeepNotes = () => {
    review.setKeepNotes(keepInput.trim())
    clearDraft(keepDraftKey)
    notify('保留要求已保存')
  }

  const handleSaveOriginal = () => {
    if (review.setOriginal) {
      review.setOriginal(originalInput.trim())
    }
    clearDraft(origDraftKey)
    setIsEditingOriginal(false)
    notify('原始需求已更新')
  }

  const handleAddCorrection = (e: React.FormEvent) => {
    e.preventDefault()
    if (!correctionInput.trim()) return
    review.addCorrection(correctionInput.trim())
    setCorrectionInput('')
    clearDraft(correctionDraftKey)
    notify('已添加补充要求')
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg)] text-[var(--tx)]">
      {/* 顶部轻量栏 */}
      <div className="h-10 border-b border-[var(--line)] px-6 flex items-center justify-between shrink-0 bg-[var(--surf)]">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-[var(--tx)]">创作要求</span>
        </div>
        <div className="flex items-center gap-2">
          {savedNotice && (
            <span className="text-xs text-blue-500 flex items-center gap-1 font-medium animate-fade-in mr-2">
              <UiIcon icon={SemIcons.check} size="xs" />
              <span>{savedNotice}</span>
            </span>
          )}
          {onDiscuss && (
            <button
              type="button"
              className="text-xs px-2.5 py-1 rounded bg-[var(--hole)] hover:bg-[var(--line)] text-[var(--tx2)] hover:text-[var(--tx)] transition-colors flex items-center gap-1"
              onClick={onDiscuss}
            >
              <UiIcon icon={SemIcons.back} size="xs" />
              <span>带回对话讨论</span>
            </button>
          )}
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 font-medium transition-colors flex items-center gap-1"
            onClick={onClose}
            title="返回画面监看"
          >
            <UiIcon icon={Monitor01} size="xs" />
            <span>返回画面监看</span>
          </button>
        </div>
      </div>

      {/* 连续表单主体：限制宽度 640-700px，避免横跨拉伸 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[680px] w-full mx-auto flex flex-col gap-6">

          {/* 1. 原始制作需求 */}
          {(activeSection === 'all' || activeSection === 'original') && (
            <section className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm text-[var(--tx)] flex items-center gap-1.5">
                  <UiIcon icon={File01} size="sm" className="text-[var(--tx2)]" />
                  <span>原始制作需求</span>
                </h3>
                {!isEditingOriginal && review.brief.original && (
                  <button
                    type="button"
                    className="text-xs text-blue-500 hover:underline"
                    onClick={() => {
                      setOriginalInput(review.brief.original || '')
                      setIsEditingOriginal(true)
                    }}
                  >
                    修改
                  </button>
                )}
              </div>

              {isEditingOriginal ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    rows={3}
                    className="w-full text-[13px] p-2.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-[var(--tx)] placeholder:text-[var(--tx3)] focus:outline-none focus:border-blue-500/50 leading-relaxed"
                    placeholder="录入本项目的原始制作愿景或整体要求…"
                    value={originalInput}
                    onChange={(e) => setOriginalInput(e.target.value)}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="text-xs px-2.5 py-1 rounded text-[var(--tx3)] hover:text-[var(--tx)]"
                      onClick={() => setIsEditingOriginal(false)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 font-medium transition-colors"
                      onClick={handleSaveOriginal}
                    >
                      保存原始需求
                    </button>
                  </div>
                </div>
              ) : review.brief.original ? (
                <div className="text-[13px] text-[var(--tx2)] leading-relaxed bg-[var(--hole)] p-3 rounded-lg border border-[var(--line)] whitespace-pre-wrap">
                  {review.brief.original}
                </div>
              ) : (
                <div className="text-xs text-[var(--tx2)] bg-[var(--hole)] p-3 rounded-lg border border-[var(--line)] flex items-center justify-between">
                  <span className="text-[var(--tx3)]">暂无原始制作需求简述</span>
                  <button
                    type="button"
                    className="text-xs px-2.5 py-1 rounded bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 font-medium transition-colors"
                    onClick={() => setIsEditingOriginal(true)}
                  >
                    录入原始需求
                  </button>
                </div>
              )}
            </section>
          )}

          {/* 细分割线 */}
          {activeSection === 'all' && <div className="border-t border-[var(--line)]/60" />}

          {/* 2. 持续保留要求 */}
          {(activeSection === 'all' || activeSection === 'keep') && (
            <section className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-sm text-[var(--tx)] flex items-center gap-1.5">
                    <UiIcon icon={Tag01} size="sm" className="text-[var(--tx2)]" />
                    <span>文字保留要求</span>
                  </h3>
                  <p className="text-xs text-[var(--tx3)] mt-0.5">
                    告知 AI 必须保持原样的画面或要素（例如“背景色调与机位不要动，Logo 保持原样”），随每轮修改一同提交。
                  </p>
                </div>
              </div>

              <textarea
                rows={3}
                className="w-full text-[13px] p-2.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-[var(--tx)] placeholder:text-[var(--tx3)] focus:outline-none focus:border-blue-500/50 leading-relaxed"
                placeholder="输入需要 AI 始终遵从并保留的要求…"
                value={keepInput}
                onChange={(e) => setKeepInput(e.target.value)}
              />

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  className="text-xs px-3.5 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 font-medium transition-colors disabled:opacity-40"
                  disabled={keepInput === review.keepNotes}
                  onClick={handleSaveKeepNotes}
                >
                  保存保留要求
                </button>
              </div>
            </section>
          )}

          {/* 细分割线 */}
          {activeSection === 'all' && <div className="border-t border-[var(--line)]/60" />}

          {/* 3. 后续补充记录 */}
          {(activeSection === 'all' || activeSection === 'corrections') && (
            <section className="flex flex-col gap-3">
              <div>
                <h3 className="font-medium text-sm text-[var(--tx)] flex items-center gap-1.5">
                  <UiIcon icon={SemIcons.plus} size="sm" className="text-[var(--tx2)]" />
                  <span>后续补充要求</span>
                </h3>
                <p className="text-xs text-[var(--tx3)] mt-0.5">
                  制作推进过程中追加的规约记录（共 {review.corrections.length} 条）。
                </p>
              </div>

              {review.corrections.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {review.corrections.map((item, idx) => (
                    <div key={item.id} className="p-2.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-xs flex items-start gap-2.5">
                      <span className="text-[var(--tx3)] font-mono text-[11px] shrink-0 mt-0.5">
                        #{idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-[var(--tx)] leading-relaxed">{item.text}</p>
                        <time className="text-[11px] text-[var(--tx3)] mt-1 block">{date(item.createdAt)}</time>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-[var(--tx3)] bg-[var(--hole)] rounded-lg border border-[var(--line)]">
                  暂无后续补充记录
                </div>
              )}

              <form onSubmit={handleAddCorrection} className="flex flex-col gap-2 mt-1">
                <textarea
                  rows={2}
                  className="w-full text-[13px] p-2.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-[var(--tx)] placeholder:text-[var(--tx3)] focus:outline-none focus:border-blue-500/50"
                  placeholder="新增一条具体的制作要求或纠正…"
                  value={correctionInput}
                  onChange={(e) => setCorrectionInput(e.target.value)}
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!correctionInput.trim()}
                    className="text-xs px-3.5 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 font-medium transition-colors disabled:opacity-40"
                  >
                    添加补充要求
                  </button>
                </div>
              </form>
            </section>
          )}

        </div>
      </div>
    </div>
  )
}

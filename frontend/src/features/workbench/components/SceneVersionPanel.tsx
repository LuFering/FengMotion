import { useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { CheckSquare, Clock, Square, SwitchHorizontal01 } from '@untitledui/icons'
import type { ProjectSceneState } from '@/api/taskClient'
import type { SceneVersionsHook } from '@/features/workbench/hooks/useSceneVersions'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import { studioHttpApi } from '@/api'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

interface SceneVersionPanelProps {
  projectId: string
  scene?: ProjectSceneState | null
  versions: SceneVersionsHook
  viewedVersion?: number
  onView?: (visual: StageVisual) => void
  onCompare?: (left: StageVisual, right: StageVisual) => void
  onClose?: () => void
}

const when = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${m}/${day} ${h}:${min}`
}

function versionVisual(projectId: string, item: SceneVersionsHook['versions'][number]): StageVisual {
  const artifactUrl = item.artifactPath
    ? studioHttpApi().artifacts.contentUrl(projectId, item.artifactPath)
    : ''
  return {
    id: `scene:${item.version}`,
    name: item.editSummary || item.prompt || `场景版本 v${item.version}`,
    tierLabel: `版本 v${item.version}`,
    tier: 'final',
    media: 'video',
    file: artifactUrl,
    runId: '',
    artifactId: item.artifactPath || '',
    artifactPath: item.artifactPath || undefined,
    workflowId: '',
    createdAt: item.createdAt || '',
    artifactKind: 'render',
    stale: false,
    revision: item.version,
    origin: 'scene',
  }
}

/** 提炼面向创作的真实用户原话，彻底剥离注入的内部上下文 */
function cleanCreativeTitle(summary?: string, prompt?: string, version = 1): string {
  const isCodeMachineStr = (s?: string) =>
    !s || s.includes('渲染项目工程') || s.includes('src/index.tsx') || s.includes('DotFilm')

  const extractCleanUserText = (raw?: string): string => {
    if (!raw) return ''
    let cleaned = raw
    // 剥离向 AI 注入的上下文标记、定位坐标与约束词
    if (cleaned.includes('用户指定的目标与上下文')) {
      cleaned = cleaned.split('用户指定的目标与上下文')[0]
    }
    if (cleaned.includes('保留与修改要求：')) {
      cleaned = cleaned.split('保留与修改要求：')[0]
    }
    if (cleaned.includes('若无法定位目标')) {
      cleaned = cleaned.split('若无法定位目标')[0]
    }
    cleaned = cleaned.trim()
    // 过滤掉内部代码路径或占位字符串
    if (isCodeMachineStr(cleaned)) return ''
    return cleaned
  }

  const cleanPrompt = extractCleanUserText(prompt)
  if (cleanPrompt) return cleanPrompt

  const cleanSummary = extractCleanUserText(summary)
  if (cleanSummary) return cleanSummary

  if (version === 1) return '初始工程生成'
  return `第 ${version} 版调整`
}

export function SceneVersionPanel({
  projectId,
  scene,
  versions,
  viewedVersion,
  onView,
  onCompare,
  onClose,
}: SceneVersionPanelProps) {
  const { versions: items, loading, loadError, restoring, failure, restore, clearFailure } = versions
  const [confirming, setConfirming] = useState<number | null>(null)
  const [compareSelection, setCompareSelection] = useState<number[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastRestored = versions.lastRestored
  const currentVersion = scene?.initialized ? scene.version : (items[0]?.version ?? 0)

  const toggleCompare = (v: number) => {
    setCompareSelection((prev) => {
      if (prev.includes(v)) return prev.filter((id) => id !== v)
      if (prev.length >= 2) return [prev[1], v]
      return [...prev, v]
    })
  }

  const handleStartCompare = () => {
    if (compareSelection.length !== 2 || !onCompare) return
    const v1 = items.find((i) => i.version === compareSelection[0])
    const v2 = items.find((i) => i.version === compareSelection[1])
    if (v1 && v2) {
      onCompare(versionVisual(projectId, v1), versionVisual(projectId, v2))
    }
  }

  return (
    <div className="fw-scroll flex flex-col h-full bg-transparent p-3" ref={scrollRef}>
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--line)]">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm text-[var(--tx)]">创作版本</span>
          <span className="text-xs text-[var(--tx3)]">({items.length})</span>
        </div>
        {compareSelection.length === 2 && onCompare && (
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 font-medium flex items-center gap-1"
            onClick={handleStartCompare}
          >
            <UiIcon icon={SwitchHorizontal01} size="xs" />
            <span>对比 (v{compareSelection[0]} ↔ v{compareSelection[1]})</span>
          </button>
        )}
      </div>

      {failure && <FailureNotice failure={failure} onDismiss={clearFailure} />}

      {lastRestored && (
        <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 flex items-center gap-2 mt-2" role="status">
          <UiIcon icon={SemIcons.check} size="sm" className="shrink-0" />
          <span>已基于 v{lastRestored.fromVersion} 恢复，生成新版本 v{lastRestored.version}。</span>
        </div>
      )}

      {loading && <p className="text-xs text-[var(--tx3)] py-4 text-center">正在读取版本历史…</p>}
      {loadError && !loading && (
        <p className="text-xs text-red-500 py-3 text-center">读取失败：{loadError}</p>
      )}

      {!loading && !loadError && items.length === 0 && (
        <div className="py-12 text-center text-xs text-[var(--tx3)] flex flex-col items-center justify-center">
          <UiIcon icon={Clock} size="xl" className="mb-2 opacity-30 text-[var(--tx)]" />
          <p className="text-[var(--tx2)] text-[13px]">暂无历史版本</p>
          <p className="mt-1 text-xs text-[var(--tx3)]">向 AI 发起修改后，每次迭代产出都将保存在此。</p>
        </div>
      )}

      {/* 创作记录列表：采用极简设计，点击整行播放，选中仅用单一浅蓝背景 */}
      <div className="flex flex-col gap-1 mt-2">
        {items.map((item) => {
          const isCurrent = item.version === currentVersion
          const isViewing = viewedVersion !== undefined ? item.version === viewedVersion : isCurrent
          const isSelectedForCompare = compareSelection.includes(item.version)
          const isConfirming = confirming === item.version
          const sourceProject = 'kind' in item.film && item.film.kind === 'project-render'
          const canRestore = !sourceProject || ('sourceSnapshot' in item.film && !!item.film.sourceSnapshot)
          const currentItem = items.find((it) => it.version === currentVersion)
          const canCompareWithCurrent = !isCurrent && !!item.artifactPath && !!currentItem?.artifactPath
          const title = cleanCreativeTitle(item.editSummary, item.prompt, item.version)

          return (
            <div
              key={item.version}
              role="button"
              tabIndex={0}
              onClick={() => onView?.(versionVisual(projectId, item))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onView?.(versionVisual(projectId, item))
                }
              }}
              className={`w-full p-2.5 rounded-lg text-left transition-colors flex flex-col gap-1.5 cursor-pointer group border ${
                isViewing
                  ? 'bg-blue-500/8 border-blue-500/40'
                  : isSelectedForCompare
                  ? 'bg-indigo-500/10 border-indigo-500/30'
                  : 'bg-transparent border-transparent hover:bg-[var(--hover)] text-[var(--tx2)] hover:text-[var(--tx)]'
              }`}
            >
              {/* 第一行：创作标题（保留用户原话，正文保持正常可读色，避免全行蓝字压迫） */}
              <div className="flex items-start justify-between gap-2">
                <div
                  className="text-[13px] font-medium leading-snug line-clamp-2 flex-1 text-left text-[var(--tx)]"
                  title={item.prompt || item.editSummary || title}
                >
                  {title}
                </div>

                {/* 右侧轻量图标按钮（悬浮或选中时显示，平时不抢占宽度） */}
                <div
                  className={`flex items-center gap-1 shrink-0 transition-opacity ${
                    isSelectedForCompare ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {onCompare && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={`p-1 rounded transition-colors ${
                            isSelectedForCompare ? 'text-indigo-500' : 'text-[var(--tx3)] hover:text-[var(--tx)]'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleCompare(item.version)
                          }}
                          aria-label={isSelectedForCompare ? '取消对比' : '勾选对比'}
                        >
                          {isSelectedForCompare ? <UiIcon icon={CheckSquare} size="xs" /> : <UiIcon icon={Square} size="xs" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {isSelectedForCompare ? '已选为对比基准，点击取消' : '勾选此版加入两版对比'}
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {canCompareWithCurrent && onCompare && currentItem && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="p-1 rounded text-[var(--tx3)] hover:text-indigo-500 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation()
                            onCompare(versionVisual(projectId, item), versionVisual(projectId, currentItem))
                          }}
                          aria-label="与最新版对比"
                        >
                          <UiIcon icon={SwitchHorizontal01} size="xs" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        与最新版本 (v{currentItem.version}) 对比
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {!isCurrent && canRestore && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="p-1 rounded text-[var(--tx3)] hover:text-[var(--tx)] transition-colors"
                          aria-label="更多操作"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <UiIcon icon={SemIcons.more} size="xs" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="text-xs">
                        <DropdownMenuItem
                          className="text-amber-500 focus:text-amber-500 focus:bg-amber-500/10 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation()
                            clearFailure()
                            setConfirming(item.version)
                          }}
                        >
                          <span>恢复工程到此版本 (v{item.version})</span>
                        </DropdownMenuItem>
                        {item.artifactPath && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation()
                                window.open(studioHttpApi().artifacts.contentUrl(projectId, item.artifactPath!), '_blank')
                              }}
                            >
                              <span>在新窗口打开产物视频</span>
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>

              {/* 第二行：版本号 + 时间 · 状态标签（适度提高次要文字对比度） */}
              <div className="flex items-center gap-2 text-xs text-[var(--tx2)]">
                <span className={`font-semibold text-[11px] px-1.5 py-0.5 rounded ${
                  isViewing ? 'bg-blue-500/20 text-blue-400 font-bold' : 'bg-[var(--hole)] text-[var(--tx2)]'
                }`}>
                  v{item.version}
                </span>
                <span className="text-[11.5px] text-[var(--tx2)]">
                  {when(item.createdAt)}
                  {' · '}
                  <span className={isViewing ? 'text-blue-400 font-medium' : 'text-[var(--tx3)]'}>
                    {isCurrent ? '最新版本' : isViewing ? '正在查看' : '历史版本'}
                  </span>
                  {item.source === 'restore' && item.fromVersion && ` (自 v${item.fromVersion} 恢复)`}
                </span>
              </div>

              {/* 恢复确认浮层 */}
              {isConfirming && (
                <div
                  className="mt-2 p-2.5 rounded-lg bg-[var(--hole)] border border-[var(--line)] text-xs flex flex-col gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1.5 text-amber-500 font-medium">
                    <UiIcon icon={SemIcons.warning} size="xs" />
                    <span>确认恢复到此版本？</span>
                  </div>
                  <p className="text-[11px] text-[var(--tx2)] leading-relaxed">
                    将以 v{item.version} 的工程内容创建新版本继续编辑。
                  </p>
                  <div className="flex items-center justify-end gap-2 mt-1">
                    <button
                      type="button"
                      className="px-2 py-0.5 rounded text-xs text-[var(--tx3)] hover:text-[var(--tx)]"
                      onClick={() => setConfirming(null)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1 rounded bg-blue-600 text-white font-medium text-xs hover:bg-blue-500 transition-colors"
                      disabled={restoring !== null}
                      onClick={async () => {
                        const ok = await restore(item.version, currentVersion || undefined)
                        setConfirming(null)
                        if (ok && onClose) onClose()
                      }}
                    >
                      {restoring === item.version ? '恢复中…' : '确认恢复'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FailureNotice({ failure, onDismiss }: { failure: { reason?: string; message: string } | string; onDismiss: () => void }) {
  const msg = typeof failure === 'string' ? failure : failure.message
  return (
    <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-500 flex items-center justify-between gap-2 mt-2" role="alert">
      <span>{msg}</span>
      <button type="button" onClick={onDismiss} className="text-red-400 hover:text-red-600">×</button>
    </div>
  )
}

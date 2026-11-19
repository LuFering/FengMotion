import type * as React from 'react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { MediaIcon } from '@/shared/icons/MediaIcon'
import { versionItemLabel, versionSeriesOf } from '@/features/workbench/model/versionIdentity'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import type { StageVisual } from '@/features/workbench/model/stageVisual'

export interface TopBarVersionMenuProps {
  availableVisuals: StageVisual[]
  currentVersionLabel: string
  deliverableLead: StageVisual | null | undefined
  hasVersion: boolean
  isHistorical: boolean
  isOlderThanKnown: boolean
  onOpenVersionHistory: () => void
  onSelectVisual: (visual: StageVisual) => void
  projectVersionAuthoritative: boolean | undefined
  projectVersionNumber: number | null | undefined
  projectVersionVisual: StageVisual | null | undefined
  setVersionMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  versionMenuOpen: boolean
  viewedPreview: StageVisual | null
}

/** 工作台顶栏的版本菜单：显示正在查看的版本，展开后区分最新可下载与当前工程版本，可切换画面版本或打开完整版本历史。 */
export function TopBarVersionMenu({ availableVisuals, currentVersionLabel, deliverableLead, hasVersion, isHistorical, isOlderThanKnown, onOpenVersionHistory, onSelectVisual, projectVersionAuthoritative, projectVersionNumber, projectVersionVisual, setVersionMenuOpen, versionMenuOpen, viewedPreview }: TopBarVersionMenuProps) {
  return (
    <DropdownMenu open={versionMenuOpen} onOpenChange={setVersionMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="wb-topbar-version-pill"
          data-historical={isHistorical || undefined}
          disabled={!hasVersion}
          aria-label={`当前版本 ${currentVersionLabel}`}
        >
          {isHistorical && (
            <span className="wb-topbar-version-hist-tag">历史</span>
          )}
          <span className="wb-topbar-version-name">
            {currentVersionLabel}
          </span>
          <MediaIcon name="chevronDown" size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="wb-topbar-menu">
        <DropdownMenuLabel className="wb-topbar-menu-label">
          <span>版本清单</span>
          {/* 【来源必须写明】这里报的是「最新可下载整片」，不是当前工程版本。
              它可能来自工作流产物，编号与场景版本不是同一序列 ——
              只写「最新 v3」会让用户把它当成项目版本号。
              当前工程版本另有一行，两者分开表达。 */}
          {deliverableLead && (
            <span className="wb-topbar-menu-latest">
              最新可下载：{versionItemLabel(deliverableLead)}
            </span>
          )}
        </DropdownMenuLabel>
        {/* 当前工程版本单独一行，与「最新可下载」分开。
            非权威时明确说「未能确认」—— 不把「已知画面里最高的一版」
            冒充成当前工程版本。 */}
        <div className="wb-topbar-version-project" data-authoritative={projectVersionAuthoritative ? 'yes' : 'no'}>
          {typeof projectVersionNumber === 'number' ? (
            projectVersionAuthoritative ? (
              <span>当前工程版本 v{projectVersionNumber}</span>
            ) : (
              <span>
                当前工程版本未能确认（已知画面最高为 v{projectVersionNumber}，工程可能已更新）
              </span>
            )
          ) : (
            <span>当前工程版本未能确认</span>
          )}
        </div>
        <DropdownMenuSeparator />

        {/* 【回到当前工程版本】只跳到「当前工程版本对应的那条画面」。
            原先是跳 deliverableLead —— 它可能是工作流产物（另一条序列），
            也可能在「工程 v17、可下载画面仍是 v16」时把用户带到仍是历史的 v16。
            没有对应画面时如实说明「尚无对应画面」，不给会跳错的入口。 */}
        {(isHistorical || isOlderThanKnown) && (
          <>
            {projectVersionVisual ? (
              <DropdownMenuItem
                className="wb-topbar-menu-item wb-topbar-menu-item-jump"
                onClick={() => onSelectVisual(projectVersionVisual)}
              >
                {/* 命名必须与可信度一致：
                    权威时才能说「回到当前工程版本」；
                    非权威时那个数字只是「已知画面最高」，只能说「查看已知最新画面」。 */}
                {isHistorical ? (
                  <span>回到当前工程版本 (v{projectVersionNumber})</span>
                ) : (
                  <span>查看已知最新画面 (v{projectVersionNumber})</span>
                )}
              </DropdownMenuItem>
            ) : (
              <div className="wb-topbar-menu-item wb-topbar-menu-item-note">
                <span>
                  {isHistorical
                    ? `当前工程版本 v${projectVersionNumber} 还没有渲染出的画面，暂无可跳转的版本`
                    : `已知最新画面 v${projectVersionNumber} 不可跳转（工程版本未能确认）`}
                </span>
              </div>
            )}
            <DropdownMenuSeparator />
          </>
        )}

        {/* 版本列表 */}
        <div className="wb-topbar-version-list">
          {availableVisuals.map((visual) => {
            const isCurrent = viewedPreview?.id === visual.id
            /* 「最新」只在**权威工程版本**下才标，且必须是场景序列里版本号
               完全相等的那一条。两层限制缺一不可：
               · 版本号来自后端（authoritative）—— 否则只是「已知画面里最高」，
                 不能声称它就是当前工程版本；
               · 版本号相等 —— 工程已到 v17 但 v17 没渲出片时，列表里
                 没有任何一条等于 v17，于是谁都不标「最新」。
                 这是对的：把 v16 标成最新会让用户以为工程停在那里。 */
            const isLead = projectVersionAuthoritative === true
              && versionSeriesOf(visual) === 'scene'
              && typeof projectVersionNumber === 'number'
              && visual.revision === projectVersionNumber
            const dateStr = visual.createdAt
              ? new Date(visual.createdAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''

            return (
              <DropdownMenuItem
                key={visual.id}
                className="wb-topbar-menu-item"
                data-current={isCurrent || undefined}
                onClick={() => onSelectVisual(visual)}
              >
                <div className="wb-topbar-item-info">
                  <span className="wb-topbar-item-version">
                    {versionItemLabel(visual)}
                  </span>
                  <span className="wb-topbar-item-name truncate">
                    {visual.tierLabel || visual.name}
                  </span>
                  {isLead && (
                    <span className="wb-topbar-lead-pill">最新</span>
                  )}
                  {dateStr && (
                    <span className="wb-topbar-item-time">{dateStr}</span>
                  )}
                </div>
                {isCurrent && (
                  <UiIcon icon={SemIcons.check} size="sm" className="ml-auto text-[var(--acc)]" />
                )}
              </DropdownMenuItem>
            )
          })}
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="wb-topbar-menu-item text-[var(--portal-menu-tx2)]"
          onClick={onOpenVersionHistory}
        >
          <span>查看完整版本历史 ›</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

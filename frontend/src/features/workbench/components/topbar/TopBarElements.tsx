import { LayersTwo01, Type01 } from '@untitledui/icons'
import { UiIcon } from '@/shared/icons/UiIcon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { formatMediaTime } from '@/features/workbench/model/previewGeometry'
import type { ElementInspector } from '@/features/workbench/hooks/stage/useElementInspector'

/**
 * 顶栏「元素」列表：这一版所有可编辑元素。
 *
 * <p>元素只在自己的时间段里点得到，用户不一定知道标题在第几秒出现；
 * 从这里选一个就跳到它的第一帧并选中，属性小窗贴在元素右侧打开。</p>
 */
export function TopBarElements({ inspector, fps, suppressTooltip }: { inspector: ElementInspector; fps: number; suppressTooltip?: boolean }) {
  const { elements, declared, metaState, unavailable } = inspector
  const count = elements.length
  const label = metaState === 'loading' ? '正在读取画面元素' : declared ? `画面元素（${count}）` : '画面元素'
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" className="wb-topbar-icon-btn wb-topbar-elements-btn" aria-label={label}
                    disabled={!inspector.enabled || metaState === 'idle'}>
              <UiIcon icon={LayersTwo01} size="sm" />
              {declared && count > 0 && <span className="wb-topbar-count num">{count}</span>}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {!suppressTooltip && <TooltipContent side="bottom" sideOffset={6}>{label}</TooltipContent>}
      </Tooltip>
      <DropdownMenuContent align="start" className="wb-topbar-menu wb-elements-menu">
        <DropdownMenuLabel className="wb-topbar-menu-label">
          {declared ? `v${declared.version} 的可编辑元素` : '画面元素'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!declared || count === 0 ? (
          <p className="wb-elements-empty">{declared ? '这一版没有声明元素' : unavailable || '这一版没有可编辑的元素'}<br />可以在画面上点选或框选，交给 AI 修改。</p>
        ) : elements.map((el) => (
          <DropdownMenuItem key={el.id} className="wb-elements-item" disabled={!el.placement}
                            onSelect={() => inspector.pickFromList(el)}>
            <UiIcon icon={Type01} size="xs" className="wb-elements-icon" />
            <span className="wb-elements-text">
              <span className="wb-elements-name">{el.label}</span>
              <span className="wb-elements-sub">{el.properties.text || '（空）'}</span>
            </span>
            <span className="wb-elements-time num">
              {el.placement ? formatMediaTime(el.placement.startFrame / fps) : '无位置'}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

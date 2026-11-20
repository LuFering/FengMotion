import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

/**
 * 顶栏「实时 | 成片」切换：实时 = 运行工程源码（能点选真实元素、改了立刻看到）；成片 = 播放已渲染的视频。
 *
 * <p>只有在看当前版本时能切到实时：历史版本、对比、导出看的都是登记过的成片。</p>
 */
export function TopBarLiveToggle({ live, available, status, message, onChange, suppressTooltip }: {
  live: boolean
  available: boolean
  status: 'off' | 'starting' | 'ready' | 'unavailable'
  message: string
  onChange: (live: boolean) => void
  suppressTooltip?: boolean
}) {
  const hint = !available
    ? '实时预览只用于当前版本；历史版本播放的是成片'
    : status === 'unavailable'
      ? `实时预览不可用：${message || '启动失败'}`
      : live ? '正在实时运行工程源码' : '切到实时：运行工程源码，可以点选画面元素'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="wb-live-toggle" role="radiogroup" aria-label="画面来源" data-disabled={!available || undefined}>
          <button type="button" role="radio" aria-checked={live && available} disabled={!available}
                  data-state={live && available ? status : undefined} onClick={() => onChange(true)}>
            <i className="wb-live-dot" aria-hidden="true" />实时
          </button>
          <button type="button" role="radio" aria-checked={!live || !available} onClick={() => onChange(false)}>成片</button>
        </div>
      </TooltipTrigger>
      {!suppressTooltip && <TooltipContent side="bottom" sideOffset={6}>{hint}</TooltipContent>}
    </Tooltip>
  )
}

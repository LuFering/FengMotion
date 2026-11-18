import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UiIcon } from '@/components/icons/UiIcon'
import { Crop01, MessageSquare01 } from '@untitledui/icons'

export function PreviewReviewTools({ video, available, regionMode, onFrame, onRegion }: {
  video: boolean; available: boolean; regionMode: boolean
  onFrame: () => void; onRegion: () => void
}) {
  return <div className="wb-preview-tools"><div className="wb-preview-tools-main">
    <Tooltip><TooltipTrigger asChild><button type="button" disabled={!available} aria-label={video ? '引用此帧' : '引用图片'} onClick={onFrame}><UiIcon icon={MessageSquare01} size="md" /></button></TooltipTrigger><TooltipContent>{video ? '引用此帧' : '引用图片'}</TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger asChild><button type="button" disabled={!available} aria-label="框选区域" aria-pressed={regionMode} onClick={onRegion}><UiIcon icon={Crop01} size="md" /></button></TooltipTrigger><TooltipContent>框选区域</TooltipContent></Tooltip>
  </div></div>
}

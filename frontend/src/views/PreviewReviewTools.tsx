import { Crop, MessageSquareText } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function PreviewReviewTools({ video, available, regionMode, onFrame, onRegion }: {
  video: boolean; available: boolean; regionMode: boolean
  onFrame: () => void; onRegion: () => void
}) {
  return <div className="wb-preview-tools"><div className="wb-preview-tools-main">
    <Tooltip><TooltipTrigger asChild><button type="button" disabled={!available} aria-label={video ? '引用此帧' : '引用图片'} onClick={onFrame}><MessageSquareText size={16}/></button></TooltipTrigger><TooltipContent>{video ? '引用此帧' : '引用图片'}</TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger asChild><button type="button" disabled={!available} aria-label="框选区域" aria-pressed={regionMode} onClick={onRegion}><Crop size={16}/></button></TooltipTrigger><TooltipContent>框选区域</TooltipContent></Tooltip>
  </div></div>
}

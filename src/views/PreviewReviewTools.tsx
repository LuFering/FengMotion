import { useState } from 'react'
import { Crop, Flag, MessageSquarePlus, Scissors, X } from 'lucide-react'
import { formatMediaTime } from '@/data/previewGeometry'
export function PreviewReviewTools({ video, available, time, duration, regionMode, onFrame, onRegion, onRange, currentTime }: {
  video: boolean; available: boolean; time: number; duration: number; regionMode: boolean
  onFrame: () => void; onRegion: () => void; onRange: (start: number, end: number) => void; currentTime: () => number
}) {
  const [rangeOpen, setRangeOpen] = useState(false)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const valid = end > start && end <= duration && start >= 0
  return <div className="wb-preview-tools"><div className="wb-preview-tools-main"><span className="wb-preview-clock">{video ? formatMediaTime(time) : '当前图片'}</span><button type="button" disabled={!available} onClick={onFrame}><MessageSquarePlus size={13}/>{video ? '引用此帧' : '引用图片'}</button><button type="button" disabled={!available} aria-pressed={regionMode} onClick={onRegion}><Crop size={13}/>框选区域</button>{video && <button type="button" disabled={!available} aria-expanded={rangeOpen} onClick={() => { if (!rangeOpen) { const current = currentTime(); setStart(current); setEnd(Math.min(duration, current + 1)) } setRangeOpen(!rangeOpen) }}><Scissors size={13}/>引用选段</button>}</div>
    {rangeOpen && <div className="wb-preview-range"><div><label>开始<input aria-label="选段开始秒数" type="number" min={0} max={duration} step={0.001} value={start} onChange={(e) => setStart(Number(e.target.value))}/></label><button type="button" aria-label="将当前位置设为选段开始" title="以当前播放位置作为开始" onClick={() => setStart(Number(currentTime().toFixed(3)))}><Flag size={12}/></button></div><span>—</span><div><label>结束<input aria-label="选段结束秒数" type="number" min={0} max={duration} step={0.001} value={end} onChange={(e) => setEnd(Number(e.target.value))}/></label><button type="button" aria-label="将当前位置设为选段结束" title="以当前播放位置作为结束" onClick={() => setEnd(Number(currentTime().toFixed(3)))}><Flag size={12}/></button></div><button type="button" className="wb-range-submit" disabled={!valid} onClick={() => { onRange(start, end); setRangeOpen(false) }}>引用选段</button><button type="button" aria-label="取消选段" onClick={() => setRangeOpen(false)}><X size={12}/></button>{!valid && <p>结束时间须晚于开始时间，并在视频时长内。</p>}</div>}
  </div>
}

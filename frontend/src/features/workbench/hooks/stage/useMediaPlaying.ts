import { useEffect, useState } from 'react'
import type * as React from 'react'

/** 成片视频是否在播放：跟着 play / pause / ended 事件走；key 变了（换片）重新挂监听。 */
export function useMediaPlaying(ref: React.RefObject<HTMLVideoElement | HTMLImageElement | null>, key: unknown): boolean {
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const m = ref.current
    if (!(m instanceof HTMLVideoElement)) { setPlaying(false); return }
    const sync = () => setPlaying(!m.paused && !m.ended)
    sync()
    const events = ['play', 'pause', 'ended', 'emptied'] as const
    for (const e of events) m.addEventListener(e, sync)
    return () => { for (const e of events) m.removeEventListener(e, sync) }
  }, [ref, key])
  return playing
}

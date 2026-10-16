import { AlertCircle, LoaderCircle } from 'lucide-react'
import { ACTIVE_DURATION } from '@/data/timeline'
import { FilmPlayback } from '@/remotion/FilmPlayback'
import { Player, type PlayerRef } from '@remotion/player'
import { useRef, useState } from 'react'

const SOURCE = '/media/token-full-legacy.mp4'
const FPS = 30
const DURATION_FRAMES = Math.round(ACTIVE_DURATION * FPS)

/**
 * Stable Remotion Player wrapper for the current real rendered film.
 * The actual editable compositions remain HyperFrames/GSAP HTML, not Remotion;
 * this Player gives us deterministic MP4 playback and frame-seeking in the UI.
 */
/**
 * Remotion Player 包装：播放项目里真实存在的成片。
 *
 * ⚠️ Player 自己会把 1920×1080 的合成按比例缩放进容器（自动留黑边），
 *    所以外层不要再套 `aspect-ratio` —— 那会在高度受限时把比例压坏。
 *    给一个「填满可用空间」的容器即可。
 */
export function FilmPlayer({
  onPlayer,
  onFrame,
  onReady,
}: {
  onPlayer: (player: PlayerRef | null) => void
  onFrame: (frame: number) => void
  onReady: (ready: boolean) => void
}) {
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const callbackFrame = useRef(onFrame)
  const callbackReady = useRef(onReady)
  callbackFrame.current = onFrame
  callbackReady.current = onReady

  if (error) {
    return (
      <div className="grid size-full place-items-center bg-bg text-center">
        <div className="max-w-sm px-6">
          <AlertCircle className="mx-auto size-5 text-bad" />
          <p className="mt-2 text-sm">预览视频加载失败</p>
          <p className="mt-1 text-xs text-dim">{SOURCE}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative size-full">
      {!loaded && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-bg">
          <div className="flex items-center gap-2 text-xs text-dim">
            <LoaderCircle className="size-4 animate-spin text-acc" />
            正在加载真实影片 · {ACTIVE_DURATION.toFixed(1)} 秒
          </div>
        </div>
      )}
      <Player
        ref={(player) => {
          onPlayer(player)
          if (!player) return
          const frame = ({ detail }: { detail: { frame: number } }) => callbackFrame.current(detail.frame)
          const failed = () => { setError(true); callbackReady.current(false) }
          player.addEventListener('frameupdate', frame)
          player.addEventListener('error', failed)
          setLoaded(true)
          callbackReady.current(true)
          return () => {
            player.removeEventListener('frameupdate', frame)
            player.removeEventListener('error', failed)
          }
        }}
        component={FilmPlayback as React.ComponentType<Record<string, unknown>>}
        inputProps={{ src: SOURCE }}
        durationInFrames={DURATION_FRAMES}
        compositionWidth={1920}
        compositionHeight={1080}
        fps={FPS}
        controls={false}
        /* Remotion 要求显式声明已知晓其许可说明（公司/商用请自行确认条款） */
        acknowledgeRemotionLicense
        initiallyMuted
        showVolumeControls={false}
        allowFullscreen={false}
        clickToPlay={false}
        style={{ width: '100%', height: '100%' }}
        errorFallback={() => { setError(true); return null }}
      />
    </div>
  )
}

export type { PlayerRef }

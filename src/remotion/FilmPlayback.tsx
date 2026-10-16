import { AbsoluteFill } from 'remotion'
import { Video } from '@remotion/media'

/** Browser Player composition for the actual HyperFrames-rendered legacy film. */
export function FilmPlayback({ src }: { src: string }) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Video
        src={src}
        muted
        objectFit="contain"                         /* @remotion/media 要求用 prop，写在 style 里会告警 */
        style={{ width: '100%', height: '100%' }}
        disallowFallbackToOffthreadVideo
      />
    </AbsoluteFill>
  )
}

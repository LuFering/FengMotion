import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { Audio, Video } from '@remotion/media'
import type { EditorLayer, SceneDocument } from './types'
import { editorTheme } from './document'
const easing = Easing.bezier(0.16, 1, 0.3, 1)
const clamp = { easing, extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const }
function Layer({ layer }: { layer: EditorLayer }) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const length = Math.max(1, Math.round((layer.end - layer.start) * fps))
  const entrance = Math.max(1, Math.min(layer.entrance * fps, length * 0.4))
  const progress =
    layer.motion === 'none'
      ? 1
      : spring({ frame, fps, durationInFrames: entrance, config: { damping: 20, stiffness: 110, mass: 0.8 } })
  const exit =
    layer.motion === 'none' || !layer.exit
      ? 1
      : interpolate(frame, [Math.max(0, length - layer.exit * fps), length], [1, 0], clamp)
  const zoom = interpolate(frame, [0, Math.max(1, Math.min(length, durationInFrames) - 1)], [1, layer.zoom], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  })
  const y = layer.motion === 'rise' ? interpolate(progress, [0, 1], [layer.travel, 0], clamp) : 0
  const scale = layer.motion === 'none' ? 1 : interpolate(progress, [0, 1], [0.96, 1], clamp)
  if (layer.kind === 'audio')
    return layer.src ? (
      <Audio src={layer.src} volume={layer.volume} trimBefore={Math.round(layer.trimStart * fps)} />
    ) : null
  const box: React.CSSProperties = {
    position: 'absolute',
    left: layer.x,
    top: layer.y,
    width: layer.width,
    height: layer.height,
    transform: `translateY(${y}px) rotate(${layer.rotation}deg) scale(${scale})`,
    opacity: layer.opacity * progress * exit,
    overflow: 'hidden',
    borderRadius: layer.radius,
  }
  const media: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: layer.fit,
    transform: `scale(${zoom})`,
  }
  return (
    <div style={box}>
      {layer.kind === 'text' ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            fontFamily: editorTheme.font,
            fontSize: layer.fontSize,
            fontWeight: layer.fontWeight,
            color: layer.color,
            textAlign: layer.align,
            lineHeight: 1.2,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
          }}
        >
          {layer.text}
        </div>
      ) : layer.kind === 'shape' ? (
        <div style={{ width: '100%', height: '100%', background: layer.fill }} />
      ) : layer.src ? (
        layer.kind === 'image' ? (
          <Img src={layer.src} style={media} />
        ) : (
          <Video
            src={layer.src}
            style={media}
            volume={layer.volume}
            trimBefore={Math.round(layer.trimStart * fps)}
          />
        )
      ) : null}
    </div>
  )
}
export function SceneComposition({ document }: { document: SceneDocument }) {
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill style={{ background: document.background, fontFamily: editorTheme.font }}>
      {document.layers
        .filter((l) => l.visible)
        .map((layer) => (
          <Sequence
            key={layer.id}
            from={Math.round(layer.start * fps)}
            durationInFrames={Math.max(1, Math.round((layer.end - layer.start) * fps))}
            layout="none"
          >
            <Layer layer={layer} />
          </Sequence>
        ))}
    </AbsoluteFill>
  )
}

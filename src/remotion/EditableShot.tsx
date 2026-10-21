import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

export type ShotMotion = 'rise' | 'fade' | 'scale'
export type ShotAlign = 'left' | 'center'

export interface EditableShotSettings {
  title: string
  subtitle: string
  accent: string
  fontScale: number
  motion: ShotMotion
  align: ShotAlign
  durationSeconds: number
}

export interface EditableShotProps extends EditableShotSettings {
  poster?: string
}

/**
 * P0.2：一个真正可编辑的 Remotion 镜头 composition。
 *
 * 现在只覆盖“镜头封面 + 标题层”的可视参数；后续接真实 composition 时，
 * 同一个 Player 预览/参数面板可以替换为更完整的 shot props。
 */
export const EditableShot: React.FC<EditableShotProps> = ({
  poster, title, subtitle, accent, fontScale, motion, align,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const progress = spring({ frame, fps, config: { damping: 18, stiffness: 120, mass: 0.8 } })
  const opacity = motion === 'fade' ? progress : 1
  const translateY = motion === 'rise' ? interpolate(progress, [0, 1], [44, 0]) : 0
  const scale = motion === 'scale' ? interpolate(progress, [0.4, 1], [0.92, 1]) : 1
  const centered = align === 'center'

  return (
    <AbsoluteFill style={{ background: '#05070b', overflow: 'hidden', fontFamily: '"Noto Sans CJK SC","Source Han Sans SC",system-ui,sans-serif' }}>
      {poster && <Img src={poster} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.52 }} />}
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(5,7,11,.94) 0%, rgba(5,7,11,.72) 46%, rgba(5,7,11,.22) 100%)' }} />
      <div style={{
        position: 'absolute',
        left: centered ? '50%' : 104,
        bottom: 104,
        width: centered ? '78%' : '72%',
        transform: `translateX(${centered ? '-50%' : '0'}) translateY(${translateY}px) scale(${scale})`,
        textAlign: centered ? 'center' : 'left',
        opacity,
      }}>
        <div style={{ width: 58, height: 3, background: accent, marginBottom: 24, marginInline: centered ? 'auto' : 0 }} />
        <div style={{ color: accent, font: '600 12px "JetBrains Mono", "Noto Sans Mono", monospace', letterSpacing: '0.22em', marginBottom: 16 }}>
          FENGMOTION / SHOT COMPOSITION
        </div>
        <h1 style={{
          margin: 0, color: '#f4f7f6', fontSize: 104 * fontScale, lineHeight: 1.05,
          fontWeight: 650, letterSpacing: '-0.045em', textWrap: 'balance',
        }}>{title}</h1>
        <p style={{ margin: '20px 0 0', color: '#bdc8c3', fontSize: 19, lineHeight: 1.6, maxWidth: 680, marginInline: centered ? 'auto' : 0 }}>
          {subtitle}
        </p>
      </div>
      <div style={{ position: 'absolute', right: 36, bottom: 28, color: '#64706b', font: '10px "JetBrains Mono", monospace', letterSpacing: '0.14em' }}>
        REMOTION / EDITABLE PROPS
      </div>
    </AbsoluteFill>
  )
}

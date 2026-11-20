import React from 'react'
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import theme from './theme.json'
import { Frame } from './Frame'

const Outro = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const reveal = interpolate(frame / fps, [0, 0.42], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  })
  return (
    <AbsoluteFill style={{ padding: '54px 72px', justifyContent: 'center' }}>
      <div style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 18}px)` }}>
        <div style={{ color: theme.gold, fontSize: 17, letterSpacing: 4 }}>COFFEE / 02</div>
        <div style={{ marginTop: 20, fontSize: 67, fontWeight: 800, letterSpacing: -2 }}>Know your cup.</div>
        <div style={{ marginTop: 16, color: theme.muted, fontSize: 23 }}>Serving size matters as much as the brew.</div>
      </div>
    </AbsoluteFill>
  )
}

export const Shot = () => <Frame><Outro /></Frame>

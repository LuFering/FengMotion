import React from 'react'
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import theme from './theme.json'
import { Frame } from './Frame'

const drinks = [
  { name: 'Cold brew', amount: 200 },
  { name: 'Drip coffee', amount: 95 },
  { name: 'Instant', amount: 65 },
  { name: 'Espresso', amount: 63 },
]

const Ranking = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const titleIn = interpolate(frame / fps, [0, 0.28], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  })
  return (
    <AbsoluteFill style={{ padding: '54px 72px' }}>
      <div style={{ color: theme.gold, fontSize: 17, letterSpacing: 4 }}>COFFEE / 01</div>
      <h1 style={{ margin: '12px 0 28px', fontSize: 45, letterSpacing: -1.6, opacity: titleIn, transform: `translateY(${(1 - titleIn) * 18}px)` }}>From strongest to lightest</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {drinks.map(({ name, amount }, index) => {
          const reveal = spring({ frame, fps, delay: Math.round(fps * (0.12 + index * 0.13)), config: { damping: 18, stiffness: 145, overshootClamping: true } })
          const lead = index === 0
          return (
            <div key={name} style={{ padding: '14px 18px', minHeight: 83, border: `1px solid ${lead ? theme.gold : theme.border}`, borderRadius: 12, background: theme.panel, opacity: reveal, transform: `translateY(${(1 - reveal) * 24}px) scale(${0.94 + reveal * 0.06})` }}>
              <div style={{ color: theme.muted, fontSize: 17, letterSpacing: 0.8 }}>0{index + 1} / {name}</div>
              <div style={{ fontSize: 41, lineHeight: 1.35, fontWeight: 800, color: lead ? theme.gold : theme.paper, fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(amount * reveal)} <span style={{ color: theme.muted, fontSize: 17, fontWeight: 400 }}>mg</span>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 16, color: theme.muted, fontSize: 16 }}>Illustrative values · serving sizes differ</div>
    </AbsoluteFill>
  )
}

export const Shot = () => <Frame><Ranking /></Frame>

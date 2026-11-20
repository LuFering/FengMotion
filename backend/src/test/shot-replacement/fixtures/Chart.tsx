import React from 'react'
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import theme from './theme.json'
import { Frame } from './Frame'

const drinks = [
  { name: 'Espresso', amount: 63 },
  { name: 'Instant', amount: 65 },
  { name: 'Drip coffee', amount: 95 },
  { name: 'Cold brew', amount: 200 },
]

const Chart = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill style={{ padding: '54px 72px' }}>
      <div style={{ color: theme.gold, fontSize: 17, letterSpacing: 4 }}>COFFEE / 01</div>
      <h1 style={{ margin: '12px 0 36px', fontSize: 45, letterSpacing: -1.6 }}>Caffeine per serving</h1>
      {drinks.map(({ name, amount }, index) => {
        const reveal = interpolate(frame / fps, [index * 0.10, 0.52 + index * 0.10], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
        })
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 19, opacity: reveal, transform: `translateY(${(1 - reveal) * 12}px)` }}>
            <div style={{ width: 170, color: theme.muted, fontSize: 22 }}>{name}</div>
            <div style={{ width: amount * 2.35 * reveal, height: 33, borderRadius: 5, background: index === 3 ? theme.gold : theme.border }} />
            <strong style={{ fontSize: 22 }}>{amount} mg</strong>
          </div>
        )
      })}
      <div style={{ marginTop: 17, color: theme.muted, fontSize: 16 }}>Illustrative values · serving sizes differ</div>
    </AbsoluteFill>
  )
}

export const Shot = () => <Frame><Chart /></Frame>

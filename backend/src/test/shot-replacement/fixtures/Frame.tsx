import React, { type ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'
import theme from './theme.json'

export const Frame = ({ children }: { children: ReactNode }) => (
  <AbsoluteFill style={{ overflow: 'hidden', background: `radial-gradient(ellipse at 18% 0%, ${theme.light}, ${theme.back} 72%)`, color: theme.paper, fontFamily: theme.font }}>
    <AbsoluteFill style={{ backgroundImage: `repeating-linear-gradient(90deg, transparent 0 59px, ${theme.border}38 60px)` }} />
    {children}
    <AbsoluteFill style={{ pointerEvents: 'none', background: `radial-gradient(ellipse at center, transparent 56%, ${theme.back}70)` }} />
  </AbsoluteFill>
)

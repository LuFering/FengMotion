import React from 'react'

export const ThreeCanvas = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ width: '100%', height: '100%', background: '#0a0a0c' }}>
    {children}
  </div>
)

export const useThree = () => ({
  camera: { position: { set: () => {} }, lookAt: () => {} },
  scene: {},
  gl: { toneMapping: 0 },
})

export const MeshTransmissionMaterial = () => null
export const Environment = () => null
export const Text = () => null

export class Shape {
  moveTo() { return this }
  lineTo() { return this }
  bezierCurveTo() { return this }
  quadraticCurveTo() { return this }
}

export class ExtrudeGeometry {
  constructor(_shape?: any, _options?: any) {}
  center() { return this }
}

export const ACESFilmicToneMapping = 4

export const MathUtils = {
  degToRad: (deg: number) => (deg * Math.PI) / 180,
  lerp: (x: number, y: number, t: number) => x + (y - x) * t,
}

export default {
  Shape,
  ExtrudeGeometry,
  ACESFilmicToneMapping,
  MathUtils,
}

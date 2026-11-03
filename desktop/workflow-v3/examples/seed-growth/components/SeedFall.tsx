import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { SeedShell } from './SeedShell';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 场景 1：种子落下。
 * 运动机制：位移 + 旋转 + 落地压扁（spring），没有素材、没有相机推拉。
 */
export const SeedFall: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fall = interpolate(frame, [0, 58], [0, 1], {
    easing: Easing.in(Easing.quad),
    extrapolateRight: 'clamp',
  });
  const y = interpolate(fall, [0, 1], [-260, 560]);
  const rotation = interpolate(frame, [0, 58], [-14, 5], {
    extrapolateRight: 'clamp',
  });

  const impact = clamp01(
    spring({
      frame: frame - 58,
      fps,
      config: { damping: 9, stiffness: 160, mass: 0.6 },
    }),
  );
  const squash = 0.18 * impact;

  return (
    <AbsoluteFill>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080">
        <ellipse
          cx="960"
          cy="756"
          rx={70 + 80 * fall}
          ry={8 + 12 * fall}
          fill="#000"
          opacity={0.38 * fall}
        />
        <SeedShell
          x={960}
          y={y}
          open={0}
          crack={0}
          rotation={rotation}
          scaleX={1 + squash}
          scaleY={1 - squash}
          scale={4.2}
        />
      </svg>
    </AbsoluteFill>
  );
};

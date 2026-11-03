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
 * 场景 2：外壳裂开。
 * 裂纹是 path 的 strokeDashoffset；两半是旋转 + 位移；开壳用 spring。
 * 事件在 120 帧内完成（全局 90–209），之后保持打开到 539 帧。
 */
export const SeedCrack: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const crack = interpolate(frame, [0, 55], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateRight: 'clamp',
  });

  const open = clamp01(
    spring({
      frame: frame - 50,
      fps,
      config: { damping: 11, stiffness: 90, mass: 1 },
    }),
  );

  return (
    <AbsoluteFill>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080">
        {/* 接触阴影，避免种子悬浮 */}
        <ellipse cx="960" cy="766" rx="180" ry="20" fill="#000" opacity="0.38" />
        <ellipse
          cx="960"
          cy="560"
          rx={50 + 60 * crack}
          ry={80 + 70 * crack}
          fill="#6FAF6A"
          opacity={0.12 * crack}
        />
        <SeedShell x={960} y={560} open={open} crack={crack} scale={4.2} />
      </svg>
    </AbsoluteFill>
  );
};

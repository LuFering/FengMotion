import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 场景 4：嫩芽破土。
 * 茎是 pathLength 0→1；两片叶在 leafDelay 后用 spring 展开；顶端芽点最后出现。
 */
export const Sprout: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const stem = interpolate(frame, [0, 80], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });

  const leaf = clamp01(
    spring({
      frame: frame - 60,
      fps,
      config: { damping: 12, stiffness: 110, mass: 0.9 },
    }),
  );

  const bud = clamp01(
    spring({
      frame: frame - 100,
      fps,
      config: { damping: 10, stiffness: 120, mass: 0.8 },
    }),
  );

  return (
    <AbsoluteFill>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080">
        {/* 土面被顶开的裂缝 */}
        <path
          d="M928 762 Q 960 750 992 762"
          stroke="#6B4E2A"
          strokeWidth="3"
          fill="none"
          opacity={stem}
        />

        {/* 茎 */}
        <path
          d="M960 748 C 954 690 966 620 960 548"
          pathLength={1}
          stroke="#6FAF6A"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={1}
          strokeDashoffset={1 - stem}
        />

        {/* 左叶 */}
        <g transform={`translate(960 600) rotate(${-32 * leaf}) scale(${leaf})`}>
          <path
            d="M0 0 C -46 -26 -86 -12 -96 20 C -64 44 -24 34 0 0 Z"
            fill="#8CCB7A"
            stroke="#5E9B52"
            strokeWidth="2"
          />
        </g>

        {/* 右叶 */}
        <g transform={`translate(960 640) rotate(${32 * leaf}) scale(${leaf})`}>
          <path
            d="M0 0 C 46 -26 86 -12 96 20 C 64 44 24 34 0 0 Z"
            fill="#9BD08A"
            stroke="#5E9B52"
            strokeWidth="2"
          />
        </g>

        {/* 顶端芽点 */}
        <circle cx="960" cy="548" r={10 * bud} fill="#C9E3A8" opacity={bud} />
      </svg>
    </AbsoluteFill>
  );
};

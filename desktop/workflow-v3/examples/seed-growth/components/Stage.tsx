import { AbsoluteFill } from 'remotion';

/**
 * 舞台：天空 + 土壤 + 一条地平线。
 * 静态组件，不参与叙事；所有变化都在后面的组件里。
 */
export const Stage: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        'radial-gradient(1200px 720px at 50% 28%, #121A26 0%, #080B10 58%, #050607 100%)',
    }}
  >
    <svg width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs>
        <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1B130C" />
          <stop offset="1" stopColor="#090705" />
        </linearGradient>
        <radialGradient id="horizonGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#D8B77E" stopOpacity="0.16" />
          <stop offset="1" stopColor="#D8B77E" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="960" cy="760" rx="620" ry="150" fill="url(#horizonGlow)" />

      <path
        d="M0 762 Q 480 750 960 762 T 1920 762 L 1920 1080 L 0 1080 Z"
        fill="url(#soil)"
      />

      {Array.from({ length: 9 }).map((_, i) => (
        <path
          key={i}
          d={`M0 ${804 + i * 26} Q 480 ${794 + i * 26} 960 ${804 + i * 26} T 1920 ${804 + i * 26}`}
          stroke="#2C1F14"
          strokeWidth="1"
          fill="none"
          opacity={0.42 - i * 0.03}
        />
      ))}

      <path
        d="M0 762 Q 480 750 960 762 T 1920 762"
        stroke="#6B4E2A"
        strokeWidth="1.5"
        fill="none"
        opacity="0.55"
      />
    </svg>
  </AbsoluteFill>
);

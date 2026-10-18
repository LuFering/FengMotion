import { interpolate } from 'remotion';

const LEFT_HALF =
  'M0 -48 C -30 -46 -38 -16 -36 6 C -34 30 -20 48 0 48 L 0 -48 Z';
const RIGHT_HALF =
  'M0 -48 C 30 -46 38 -16 36 6 C 34 30 20 48 0 48 L 0 -48 Z';
const CRACK = 'M0 -46 L -5 -24 L 4 -4 L -3 18 L 2 46';

export type SeedShellProps = {
  x: number;
  y: number;
  /** 0 = 完整，1 = 完全打开 */
  open: number;
  /** 0 = 没有裂纹，1 = 裂纹贯穿 */
  crack?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  /** 整体缩放；默认 1 */
  scale?: number;
};

/**
 * 种子外壳：两条 SVG path，不是一张图。
 * 裂纹用 strokeDashoffset 逐帧画出来；两半用旋转/位移打开。
 */
export const SeedShell: React.FC<SeedShellProps> = ({
  x,
  y,
  open,
  crack = 0,
  rotation = 0,
  scaleX = 1,
  scaleY = 1,
  scale = 1,
}) => {
  const o = interpolate(open, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const c = interpolate(crack, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <g transform={`translate(${x} ${y}) rotate(${rotation}) scale(${scaleX * scale} ${scaleY * scale})`}>
      <ellipse cx="0" cy="0" rx="22" ry="40" fill="#E8C98F" opacity={0.28 * o} />

      {/* 打开后露出的内芯；闭合时被两半挡住 */}
      <ellipse cx="0" cy="8" rx="20" ry="32" fill="#5E6B42" opacity={0.95} />
      <ellipse cx="-5" cy="-2" rx="7" ry="12" fill="#7C8A58" opacity="0.55" />

      <g transform={`translate(${-13 * o} 0) rotate(${-17 * o} 0 0)`}>
        <path d={LEFT_HALF} fill="#C9A46A" stroke="#8A6A3E" strokeWidth="2.5" />
        <path
          d="M-26 -18 C -18 -30 -8 -34 -4 -30"
          stroke="#E8D3A9"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
          opacity="0.55"
        />
      </g>

      <g transform={`translate(${13 * o} 0) rotate(${17 * o} 0 0)`}>
        <path d={RIGHT_HALF} fill="#D8B77E" stroke="#8A6A3E" strokeWidth="2.5" />
      </g>

      <path
        d={CRACK}
        pathLength={1}
        stroke="#4A3218"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        strokeDasharray={1}
        strokeDashoffset={1 - c}
        opacity={1 - o}
      />
    </g>
  );
};

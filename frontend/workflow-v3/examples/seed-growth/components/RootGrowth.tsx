import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from 'remotion';

type Root = {
  d: string;
  delay: number;
  width: number;
  color: string;
};

const ROOTS: Root[] = [
  { d: 'M960 744 C 944 810 910 870 866 966', delay: 0, width: 7, color: '#B98B57' },
  { d: 'M960 744 C 972 820 992 900 1004 1020', delay: 12, width: 6, color: '#C9A46A' },
  { d: 'M960 744 C 926 800 862 838 806 906', delay: 24, width: 5, color: '#8E6A40' },
  { d: 'M960 744 C 994 802 1062 846 1118 936', delay: 36, width: 5, color: '#8E6A40' },
  { d: 'M960 744 C 952 850 944 952 936 1046', delay: 18, width: 4, color: '#A87C4C' },
];

const BRANCHES: Root[] = [
  { d: 'M900 870 C 878 890 858 900 842 920', delay: 50, width: 3, color: '#8E6A40' },
  { d: 'M1000 900 C 1024 918 1044 930 1060 952', delay: 62, width: 3, color: '#8E6A40' },
  { d: 'M862 852 C 838 864 822 880 810 898', delay: 74, width: 2.5, color: '#7A5A36' },
  { d: 'M1040 882 C 1066 894 1082 910 1094 932', delay: 86, width: 2.5, color: '#7A5A36' },
];

const HAIRS: Root[] = [
  { d: 'M920 830 C 900 842 890 856 884 872', delay: 40, width: 1.6, color: '#7A5A36' },
  { d: 'M980 860 C 1002 872 1012 886 1018 902', delay: 52, width: 1.6, color: '#7A5A36' },
  { d: 'M890 900 C 870 910 860 922 854 938', delay: 64, width: 1.4, color: '#6B4E2A' },
  { d: 'M1040 920 C 1060 930 1070 944 1076 960', delay: 76, width: 1.4, color: '#6B4E2A' },
  { d: 'M950 960 C 932 972 924 986 920 1002', delay: 88, width: 1.3, color: '#6B4E2A' },
  { d: 'M1000 990 C 1018 1000 1026 1014 1030 1030', delay: 100, width: 1.3, color: '#6B4E2A' },
];

const GROW_FRAMES = 110;

/**
 * 场景 3：根系生长。
 * 每条根是一个 path，按 pathLength 从 0 画到 1；主根错开 12 帧，侧根更晚。
 * 生长是路径本身在变长，不是缩放一张根系的图。
 */
export const RootGrowth: React.FC = () => {
  const frame = useCurrentFrame();

  const progress = (delay: number) =>
    interpolate(frame, [delay, delay + GROW_FRAMES], [0, 1], {
      easing: Easing.out(Easing.cubic),
      extrapolateRight: 'clamp',
    });

  return (
    <AbsoluteFill>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080">
        <ellipse cx="960" cy="760" rx={70 + 30 * progress(0)} ry="16" fill="#000" opacity="0.35" />

        {ROOTS.map((root) => {
          const p = progress(root.delay);
          return (
            <path
              key={root.d}
              d={root.d}
              pathLength={1}
              stroke={root.color}
              strokeWidth={root.width}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={1}
              strokeDashoffset={1 - p}
            />
          );
        })}

        {HAIRS.map((hair) => {
          const p = progress(hair.delay);
          return (
            <path
              key={hair.d}
              d={hair.d}
              pathLength={1}
              stroke={hair.color}
              strokeWidth={hair.width}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={1}
              strokeDashoffset={1 - p}
              opacity={0.75}
            />
          );
        })}

        {BRANCHES.map((branch) => {
          const p = progress(branch.delay);
          return (
            <path
              key={branch.d}
              d={branch.d}
              pathLength={1}
              stroke={branch.color}
              strokeWidth={branch.width}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={1}
              strokeDashoffset={1 - p}
              opacity={0.9}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

import { Composition } from 'remotion';
import { SeedGrowth } from './SeedGrowth';

/**
 * v3 端到端试验：种子生长。
 * 全片只有一个 Composition；时长、帧率、画幅只在这里给一次。
 */
export const RemotionRoot: React.FC = () => (
  <Composition
    id="SeedGrowth"
    component={SeedGrowth}
    durationInFrames={540}
    fps={60}
    width={1920}
    height={1080}
  />
);

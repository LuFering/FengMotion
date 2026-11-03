import { AbsoluteFill, Sequence } from 'remotion';
import { Stage } from './components/Stage';
import { SeedFall } from './components/SeedFall';
import { SeedCrack } from './components/SeedCrack';
import { RootGrowth } from './components/RootGrowth';
import { Sprout } from './components/Sprout';

/**
 * 组件树就是片子本身。
 *
 * 场景可以重叠：种壳留到 539 帧，根系从 210 帧开始长，
 * 嫩芽从 390 帧开始破土。画面是这一帧所有组件的合成结果，
 * 不是一条按顺序播放的剪辑时间线。
 */
export const SeedGrowth: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#07090C' }}>
    <Stage />

    {/* 0–89：种子落下 */}
    <Sequence from={0} durationInFrames={90}>
      <SeedFall />
    </Sequence>

    {/* 90–539：外壳裂开；事件在 209 帧完成，之后保持打开 */}
    <Sequence from={90} durationInFrames={450}>
      <SeedCrack />
    </Sequence>

    {/* 210–539：根系生长；事件在 389 帧完成，之后保持 */}
    <Sequence from={210} durationInFrames={330}>
      <RootGrowth />
    </Sequence>

    {/* 390–539：嫩芽破土、叶片展开 */}
    <Sequence from={390} durationInFrames={150}>
      <Sprout />
    </Sequence>
  </AbsoluteFill>
);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '../../..');
const spec = JSON.parse(fs.readFileSync(path.join(here, 'scene.spec.json'), 'utf8'));

const errors = [];
const isInt = (v) => Number.isInteger(v);
const need = (cond, msg) => { if (!cond) errors.push(msg); };

need(typeof spec.filmId === 'string' && spec.filmId.length > 0, 'filmId 缺失');
for (const k of ['fps', 'width', 'height', 'durationInFrames']) {
  need(isInt(spec[k]) && spec[k] > 0, `${k} 必须是正整数`);
}
need(Array.isArray(spec.scenes) && spec.scenes.length > 0, 'scenes 不能为空');

const ids = new Set();
const covered = new Array(spec.durationInFrames).fill(false);

for (const [i, s] of spec.scenes.entries()) {
  const tag = `scenes[${i}](${s.sceneId ?? '?'})`;
  need(typeof s.sceneId === 'string' && s.sceneId.length > 0, `${tag} sceneId 缺失`);
  need(!ids.has(s.sceneId), `${tag} sceneId 重复`);
  ids.add(s.sceneId);
  need(typeof s.intent === 'string' && s.intent.length >= 6, `${tag} intent 太短`);
  need(isInt(s.from) && s.from >= 0, `${tag} from 必须是 >=0 的整数`);
  need(isInt(s.durationInFrames) && s.durationInFrames > 0, `${tag} durationInFrames 必须是正整数`);
  need(s.from + s.durationInFrames <= spec.durationInFrames, `${tag} 超出全片时长`);

  need(Array.isArray(s.eventFrames) && s.eventFrames.length === 2 && s.eventFrames.every(isInt), `${tag} eventFrames 必须是 [int,int]`);
  if (Array.isArray(s.eventFrames) && s.eventFrames.length === 2) {
    const [a, b] = s.eventFrames;
    need(a >= s.from, `${tag} eventFrames 起点早于场景起点`);
    need(b >= a, `${tag} eventFrames 终点早于起点`);
    need(b < s.from + s.durationInFrames, `${tag} eventFrames 超出场景持续`);
    need(Array.isArray(s.acceptanceFrames) && s.acceptanceFrames.length >= 3, `${tag} 至少 3 个验收帧`);
    for (const f of s.acceptanceFrames ?? []) {
      need(isInt(f), `${tag} 验收帧必须是整数：${f}`);
      need(f >= a && f <= b, `${tag} 验收帧 ${f} 不在 eventFrames [${a},${b}] 内`);
    }
  }

  need(typeof s.component === 'string' && s.component.length > 0, `${tag} component 缺失`);
  if (typeof s.component === 'string') {
    const comp = path.join(project, 'remotion', 'city-night', 'scenes', `${s.component}.tsx`);
    need(fs.existsSync(comp), `${tag} 组件文件不存在：${comp}`);
  }
  need(s.props && typeof s.props === 'object' && !Array.isArray(s.props), `${tag} props 必须是对象`);
  need(Array.isArray(s.motion) && s.motion.length > 0, `${tag} motion 不能为空`);

  const complex = Array.isArray(s.motion) && s.motion.some((m) => ['path', 'mask', 'procedural'].includes(m));
  need(!complex || (Array.isArray(s.motionPlan) && s.motionPlan.length > 0), `${tag} 复杂运动缺少 motionPlan`);
  for (const [j, m] of (s.motionPlan ?? []).entries()) {
    need(typeof m.target === 'string' && m.target.length > 0, `${tag} motionPlan[${j}] target 缺失`);
    need(typeof m.from === 'string' && typeof m.to === 'string', `${tag} motionPlan[${j}] from/to 缺失`);
    need(isInt(m.start) && isInt(m.end) && m.start <= m.end, `${tag} motionPlan[${j}] start/end 无效`);
    const [a, b] = s.eventFrames;
    need(m.start >= a && m.end <= b, `${tag} motionPlan[${j}] 不在 eventFrames [${a},${b}] 内`);
  }

  for (let f = s.from; f < s.from + s.durationInFrames; f++) covered[f] = true;
}
for (let f = 0; f < covered.length; f++) {
  if (!covered[f]) errors.push(`第 ${f} 帧没有被任何场景覆盖`);
}

const rootSrc = fs.readFileSync(path.join(project, 'remotion', 'Root.tsx'), 'utf8');
const block = rootSrc.split('id="CityNightFilm"')[1]?.split('/>')[0] ?? '';
const num = (re) => {
  const m = block.match(re);
  return m ? Number(m[1]) : null;
};
need(num(/durationInFrames=\{(\d+)\}/) === spec.durationInFrames, 'Root.tsx durationInFrames 与 spec 不一致');
need(num(/fps=\{(\d+)\}/) === spec.fps, 'Root.tsx fps 与 spec 不一致');
need(num(/width=\{(\d+)\}/) === spec.width, 'Root.tsx width 与 spec 不一致');
need(num(/height=\{(\d+)\}/) === spec.height, 'Root.tsx height 与 spec 不一致');

if (errors.length) {
  console.error(`✗ scene.spec.json 未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ scene.spec.json 通过：${spec.scenes.length} 个场景，${spec.durationInFrames} 帧 @ ${spec.fps}fps`);

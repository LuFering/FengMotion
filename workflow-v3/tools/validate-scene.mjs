import fs from 'node:fs';
import path from 'node:path';

/**
 * 场景规格校验（唯一版本，不许每片复制一份）。
 *
 * 用法：
 *   node workflow-v3/tools/validate-scene.mjs --film workflow-v3/films/<id>
 *   node workflow-v3/tools/validate-scene.mjs --film workflow-v3/examples/seed-growth
 */

const args = process.argv.slice(2);
const filmArg = args.includes('--film') ? args[args.indexOf('--film') + 1] : null;
const specOnly = args.includes('--spec-only');
if (!filmArg) {
  console.error('用法：node workflow-v3/tools/validate-scene.mjs --film <片目录>');
  process.exit(2);
}

const film = path.resolve(process.cwd(), filmArg);
const specPath = ['02-scene.spec.json', 'scene.spec.json']
  .map((f) => path.join(film, f))
  .find((p) => fs.existsSync(p));

if (!specPath) {
  console.error(`✗ 找不到 02-scene.spec.json 或 scene.spec.json：${film}`);
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const errors = [];
const isInt = (v) => Number.isInteger(v);
const need = (cond, msg) => {
  if (!cond) errors.push(msg);
};

need(spec.schemaVersion === 1, 'schemaVersion 必须是 1');
need(typeof spec.filmId === 'string' && spec.filmId.length > 0, 'filmId 缺失');
need(spec.filmId === path.basename(film), `filmId=${spec.filmId} 与目录名 ${path.basename(film)} 不一致`);
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

  need(
    Array.isArray(s.eventFrames) && s.eventFrames.length === 2 && s.eventFrames.every(isInt),
    `${tag} eventFrames 必须是 [int,int]`,
  );

  if (Array.isArray(s.eventFrames) && s.eventFrames.length === 2) {
    const [a, b] = s.eventFrames;
    need(a >= s.from, `${tag} eventFrames 起点早于场景起点`);
    need(b >= a, `${tag} eventFrames 终点早于起点`);
    need(b < s.from + s.durationInFrames, `${tag} eventFrames 超出场景持续`);

    need(
      Array.isArray(s.acceptanceFrames) && s.acceptanceFrames.length >= 3,
      `${tag} 至少 3 个验收帧`,
    );
    for (const f of s.acceptanceFrames ?? []) {
      need(isInt(f), `${tag} 验收帧必须是整数：${f}`);
      need(f >= a && f <= b, `${tag} 验收帧 ${f} 不在 eventFrames [${a},${b}] 内`);
    }
  }

  need(typeof s.component === 'string' && s.component.length > 0, `${tag} component 缺失`);
  if (!specOnly && typeof s.component === 'string') {
    const comp = path.join(film, 'components', `${s.component}.tsx`);
    need(fs.existsSync(comp), `${tag} 组件文件不存在：components/${s.component}.tsx`);
  }

  need(s.props && typeof s.props === 'object' && !Array.isArray(s.props), `${tag} props 必须是对象`);
  need(Array.isArray(s.motion) && s.motion.length > 0, `${tag} motion 不能为空`);

  const complexMotion = Array.isArray(s.motion) && s.motion.some((m) => ['path', 'mask', 'procedural'].includes(m));
  need(!complexMotion || (Array.isArray(s.motionPlan) && s.motionPlan.length > 0), `${tag} 复杂运动缺少 motionPlan`);
  if (Array.isArray(s.motionPlan)) {
    for (const [j, m] of s.motionPlan.entries()) {
      need(typeof m.target === 'string' && m.target.length > 0, `${tag} motionPlan[${j}] target 缺失`);
      need(typeof m.from === 'string' && typeof m.to === 'string', `${tag} motionPlan[${j}] from/to 缺失`);
      need(isInt(m.start) && isInt(m.end) && m.start <= m.end, `${tag} motionPlan[${j}] start/end 无效`);
      if (Array.isArray(s.eventFrames)) {
        const [a, b] = s.eventFrames;
        need(m.start >= a && m.end <= b, `${tag} motionPlan[${j}] 不在 eventFrames [${a},${b}] 内`);
      }
    }
  }

  // tempo：场内的节奏纪律（阶段 / 缓动多样性 / 速度差 / stagger / hero frame）
  need(s.tempo && typeof s.tempo === 'object', `${tag} 缺 tempo（阶段/节奏规则）`);
  if (s.tempo && typeof s.tempo === 'object') {
    const t = s.tempo;
    const minDelay = Math.round(0.1 * spec.fps);
    const maxDelay = Math.round(0.3 * spec.fps);
    const maxStagger = Math.round(0.5 * spec.fps);

    need(Array.isArray(t.phases) && t.phases.length >= 2, `${tag} tempo.phases 至少 2 段（build/breathe/resolve）`);
    if (Array.isArray(t.phases) && t.phases.length >= 2) {
      need(t.phases[0].from === 0, `${tag} tempo.phases 第一段必须从 0 开始`);
      need(t.phases[t.phases.length - 1].to === 100, `${tag} tempo.phases 最后一段必须到 100`);
      for (const [k, ph] of t.phases.entries()) {
        need(typeof ph.name === 'string' && ph.name.length > 0, `${tag} tempo.phases[${k}] 缺 name`);
        need(isInt(ph.from) && isInt(ph.to) && ph.from >= 0 && ph.to <= 100 && ph.from < ph.to, `${tag} tempo.phases[${k}] from/to 非法`);
      }
      for (let k = 1; k < t.phases.length; k++) {
        need(t.phases[k].from >= t.phases[k - 1].from && t.phases[k].to > t.phases[k - 1].to, `${tag} tempo.phases 必须单调推进`);
      }
    }

    need(isInt(t.firstDelayFrames) && t.firstDelayFrames >= minDelay && t.firstDelayFrames <= maxDelay, `${tag} tempo.firstDelayFrames 应在 ${minDelay}–${maxDelay} 帧（0.1–0.3s）`);

    need(Array.isArray(t.eases) && t.eases.length >= 1, `${tag} tempo.eases 不能为空`);
    if (Array.isArray(t.eases)) {
      const counts = {};
      for (const e of t.eases) counts[e] = (counts[e] ?? 0) + 1;
      for (const [e, c] of Object.entries(counts)) need(c <= 2, `${tag} 同一条缓动 "${e}" 用了 ${c} 次；一场最多 2 次`);
    }

    need(t.durationRange && typeof t.durationRange.fastest === 'number' && typeof t.durationRange.slowest === 'number', `${tag} tempo.durationRange 缺 fastest/slowest`);
    if (t.durationRange && typeof t.durationRange.fastest === 'number' && typeof t.durationRange.slowest === 'number') {
      need(t.durationRange.slowest + 1e-9 >= 3 * t.durationRange.fastest, `${tag} tempo 最慢 ${t.durationRange.slowest}s 应 ≥ 最快 ${t.durationRange.fastest}s 的 3 倍`);
    }

    need(isInt(t.staggerTotalFrames) && t.staggerTotalFrames >= 0 && t.staggerTotalFrames < maxStagger, `${tag} tempo.staggerTotalFrames 应 < ${maxStagger} 帧（500ms）`);
    need(t.entranceExitRatio === 'hold' || (typeof t.entranceExitRatio === 'number' && t.entranceExitRatio >= 1.2), `${tag} tempo.entranceExitRatio 应 ≥ 1.2，或写 "hold"`);
    need(['none', 'drift', 'pulse', 'parallax', 'glow'].includes(t.ambient), `${tag} tempo.ambient 只能是 none/drift/pulse/parallax/glow`);

    need(isInt(t.heroFrame), `${tag} tempo.heroFrame 必须是整数`);
    if (isInt(t.heroFrame) && Array.isArray(s.eventFrames) && s.eventFrames.length === 2) {
      need(t.heroFrame >= s.eventFrames[0] && t.heroFrame <= s.eventFrames[1], `${tag} tempo.heroFrame 不在 eventFrames 内`);
    }
  }

  need(s.source && ['card', 'component', 'ref', 'self'].includes(s.source.type), `${tag} 缺 source.type`);
  need(s.source && typeof s.source.id === 'string' && s.source.id.length > 0, `${tag} 缺 source.id`);
  need(s.source && typeof s.source.proof === 'string' && s.source.proof.length >= 6, `${tag} 缺 source.proof`);

  need(
    ['procedural', 'svg-asset', 'generated-image', 'video-footage', '3d-scene'].includes(s.assetStrategy),
    `${tag} assetStrategy 不合法`,
  );

  for (let f = s.from; f < s.from + s.durationInFrames; f++) {
    if (f >= 0 && f < covered.length) covered[f] = true;
  }
}

for (let f = 0; f < covered.length; f++) {
  if (!covered[f]) errors.push(`第 ${f} 帧没有被任何场景覆盖`);
}

const rootPath = path.join(film, 'Root.tsx');
if (!specOnly && fs.existsSync(rootPath)) {
  const src = fs.readFileSync(rootPath, 'utf8');
  const num = (re) => {
    const m = src.match(re);
    return m ? Number(m[1]) : null;
  };
  const d = num(/durationInFrames=\{(\d+)\}/);
  const fps = num(/fps=\{(\d+)\}/);
  const w = num(/width=\{(\d+)\}/);
  const h = num(/height=\{(\d+)\}/);

  need(d === spec.durationInFrames, `Root.tsx durationInFrames=${d} 与 spec=${spec.durationInFrames} 不一致`);
  need(fps === spec.fps, `Root.tsx fps=${fps} 与 spec=${spec.fps} 不一致`);
  need(w === spec.width, `Root.tsx width=${w} 与 spec=${spec.width} 不一致`);
  need(h === spec.height, `Root.tsx height=${h} 与 spec=${spec.height} 不一致`);
}

if (errors.length) {
  console.error(`✗ scene.spec 未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(`✓ scene.spec 通过：${spec.scenes.length} 个场景，${spec.durationInFrames} 帧 @ ${spec.fps}fps`);

#!/usr/bin/env node
/**
 * 执行前检查（Preflight，v5）
 *
 * 用法：
 *   node tools/preflight.mjs <execution.config.json> [--out qa/preflight-report.json]
 *
 * 只回答：现在能不能开始渲染。不能，就列出缺什么；不要让渲染引擎帮模型发现前置错误。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const configArg = args.find((a) => !a.startsWith('--'));
if (!configArg) {
  console.error('用法：node tools/preflight.mjs <execution.config.json> [--out qa/preflight-report.json]');
  process.exit(2);
}
const outIdx = args.indexOf('--out');
const outArg = outIdx >= 0 ? args[outIdx + 1] : null;

const configPath = path.resolve(process.cwd(), configArg);
const baseDir = path.dirname(configPath);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const P = config.paths ?? {};
const abs = (p) => (p ? path.resolve(baseDir, p) : null);
const exists = (p) => !!p && fs.existsSync(p);
const readJson = (p) => (exists(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

const checks = [];
const blocking = [];
const add = (id, status, detail) => {
  checks.push({ id, status, detail });
  if (status === 'blocked') blocking.push(`${id}: ${detail}`);
};

// 1. 设计交接
const gate = readJson(abs(path.join(P.gates ?? '', 'direction-gate.json')));
add(
  'design-handoff/direction-gate',
  gate?.status === 'confirmed' ? 'pass' : 'blocked',
  gate?.status === 'confirmed' ? 'Gate A 方向已确认' : `Gate A 方向状态为 ${gate?.status ?? '缺失'}，需先确认方向`,
);

const approvals = readJson(abs(path.join(P.gates ?? '', 'approvals.json')));
const sceneApproved = (approvals?.records ?? []).some(
  (r) => r.stage === 'scene-layout' && ['approved', 'approved-with-changes'].includes(r.status),
);
add(
  'design-handoff/scene-layout',
  sceneApproved ? 'pass' : 'blocked',
  sceneApproved ? 'Gate B 场景布局已批准' : 'Gate B 场景布局未批准（approvals 中没有 scene-layout 记录）',
);

const blueprint = readJson(abs(path.join(P.animation ?? '', 'animation-blueprint.json')));
add(
  'design-handoff/animation-blueprint',
  blueprint?.status === 'approved' ? 'pass' : 'blocked',
  blueprint?.status === 'approved' ? '动画蓝图已批准' : `动画蓝图状态为 ${blueprint?.status ?? '缺失'}，需先通过动画设计门`,
);

const implementation = readJson(abs(path.join(P.animation ?? '', 'implementation-plan.json')));
add(
  'design-handoff/implementation-plan',
  implementation?.status === 'approved' ? 'pass' : 'blocked',
  implementation?.status === 'approved' ? '实现计划已批准' : `实现计划状态为 ${implementation?.status ?? '缺失'}`,
);

// 2. 组件 / 资产 / 规格
const comps = implementation?.components ?? [];
const badComps = comps.filter((c) => c.status !== 'available');
add(
  'spec/components-available',
  comps.length > 0 && badComps.length === 0 ? 'pass' : 'blocked',
  badComps.length ? `${badComps.length}/${comps.length} 个组件仍为 candidate/missing` : '所有组件均 available',
);

const assets = implementation?.assets ?? [];
const badAssets = assets.filter((a) => a.status !== 'available');
add(
  'spec/assets-available',
  assets.length > 0 && badAssets.length === 0 ? 'pass' : 'blocked',
  badAssets.length ? `${badAssets.length}/${assets.length} 项资产仍为 candidate/missing` : '所有资产均 available',
);

const specPath = [abs(path.join(P.animation ?? '', 'scene.spec.json')), abs(path.join(P.animation ?? '', 'scene.spec.draft.json'))].find(exists);
const spec = specPath ? readJson(specPath) : null;
add(
  'spec/scene-spec-approved',
  spec?.status === 'approved' ? 'pass' : 'blocked',
  spec?.status === 'approved' ? 'scene.spec 已批准' : `scene.spec 状态为 ${spec?.status ?? '缺失'}，需先通过动画设计审查`,
);

const contracts = abs(path.join(P.animation ?? '', 'component-contracts.md'));
add('spec/component-contracts', exists(contracts) ? 'pass' : 'blocked', exists(contracts) ? '组件合同存在' : '缺少 component-contracts.md');

const tc = implementation?.timingCompile ?? {};
add(
  'timing/compile-confirmed',
  tc.status === 'confirmed' ? 'pass' : 'blocked',
  tc.status === 'confirmed' ? 'fps/时长已确认' : `timingCompile 状态为 ${tc.status ?? '缺失'}，30s/30fps 仍为候选`,
);

if (spec && implementation) {
  const out = config.output ?? {};
  const timingOk = spec.fps === out.fps && spec.durationInFrames === out.durationInFrames && tc.totalFrames === out.durationInFrames;
  add(
    'timing/spec-config-match',
    timingOk ? 'pass' : 'blocked',
    timingOk
      ? 'scene.spec 与 execution.config 的 fps/帧数一致'
      : `spec(fps=${spec.fps}, frames=${spec.durationInFrames}) / config(fps=${out.fps}, frames=${out.durationInFrames}) / timingCompile(totalFrames=${tc.totalFrames}) 不一致`,
  );
}

// 3. 工程结构
const componentsDir = abs(P.components ?? 'components');
const tsx = exists(componentsDir) ? fs.readdirSync(componentsDir).filter((f) => f.endsWith('.tsx')) : [];
add('engineering/components-exist', tsx.length > 0 ? 'pass' : 'blocked', tsx.length ? `components/ 有 ${tsx.length} 个 .tsx` : 'components/ 没有 .tsx（执行层尚未实现组件）');

const assetsDir = abs(P.assets ?? 'assets');
add('engineering/assets-dir', exists(assetsDir) ? 'pass' : 'blocked', exists(assetsDir) ? 'assets/ 存在' : 'assets/ 不存在，资产未落盘');

// 4. 输出规格
const out = config.output ?? {};
const outputOk = Number.isInteger(out.width) && Number.isInteger(out.height) && Number.isInteger(out.fps) && Number.isInteger(out.durationInFrames);
add('output/config', outputOk ? 'pass' : 'blocked', outputOk ? `输出规格 ${out.width}×${out.height} / ${out.fps}fps / ${out.durationInFrames}f` : 'execution.config.output 缺宽高/fps/帧数');

const status = blocking.length ? 'blocked' : 'passed';
const report = {
  schemaVersion: '1.0',
  type: 'preflight-report',
  filmId: config.filmId,
  status,
  checks,
  blocking,
  config: { composition: out.composition, width: out.width, height: out.height, fps: out.fps, durationInFrames: out.durationInFrames },
  createdAt: new Date().toISOString(),
};

if (outArg) {
  const outPath = path.resolve(baseDir, outArg);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${outArg}`);
}
console.log(`preflight: ${status}${blocking.length ? `（${blocking.length} 项阻塞）` : ''}`);
for (const b of blocking) console.log('  - ' + b);
process.exit(status === 'passed' ? 0 : 1);

#!/usr/bin/env node
/**
 * 执行前检查（Preflight，v5）
 *
 * 用法：
 *   node tools/preflight.mjs <execution.config.json> [--out qa/preflight-report.json]
 *
 * 两级模式：
 * - prototype：允许 candidate 组件/资产，用于生成 10s 运动证明；仍要求文件真实存在、规格合法。
 * - production：要求 Gate A/B/C 通过、组件/资产 available、证明与当前规格/配置一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { computeBuildManifest } from './lib/build.mjs';

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
const sha256 = (p) => (exists(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null);

const checks = [];
const blocking = [];
const add = (id, status, detail) => {
  checks.push({ id, status, detail });
  if (status === 'blocked') blocking.push(`${id}: ${detail}`);
};

const mode = config.mode ?? 'production';
add('config/mode', ['sketch', 'prototype', 'production'].includes(mode) ? 'pass' : 'blocked', `mode=${mode}`);

// sketch：明确非交付，允许不完整依赖，不做正式门禁
if (mode === 'sketch') {
  const report = {
    schemaVersion: '1.0', type: 'preflight-report', filmId: config.filmId, mode, status: 'passed',
    checks: [{ id: 'mode/sketch', status: 'pass', detail: 'sketch 允许临时组件/占位素材；产物不可交付' }],
    blocking: [], hashes: {}, nonDeliverable: true, createdAt: new Date().toISOString(),
  };
  if (outArg) {
    const outPath = path.resolve(baseDir, outArg);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`wrote ${outArg}`);
  }
  console.log('preflight(sketch): passed（非交付；允许不完整依赖）');
  process.exit(0);
}

// 1. 设计交接
const gate = readJson(abs(path.join(P.gates ?? '', 'direction-gate.json')));
const gateAOk = gate?.status === 'confirmed' && gate?.confirmation?.status === 'approved' && gate.confirmation.version === gate.version && (!gate?.lookDev?.required || gate.lookDev?.status === 'passed') && (gate.confirmation.confirmedBy === 'user' || config.allowAutopilotApprovals === true);
add(
  'design-handoff/gate-a',
  mode === 'prototype' || gateAOk ? 'pass' : 'blocked',
  mode === 'prototype'
    ? 'prototype 不要求 Gate A（先验证方向和实现路线）'
    : gateAOk
      ? `Gate A 已确认（v${gate.version}）`
      : `Gate A 状态=${gate?.status ?? '缺失'} / 确认=${gate?.confirmation?.status ?? '无'} / lookDev=${gate?.lookDev?.status ?? '无'}，需当前版本 approved 且写实方向有 Look-dev`,
);

const intents = readJson(abs(path.join(P.gates ?? '', 'scene-intents.json')));
const approvals = readJson(abs(path.join(P.gates ?? '', 'approvals.json')));
const blueprint = readJson(abs(path.join(P.animation ?? '', 'animation-blueprint.json')));
const layoutDir = abs(path.join(P.gates ?? '', 'scene-layouts'));
const layoutFiles = exists(layoutDir) ? fs.readdirSync(layoutDir) : [];
const latestLayout = new Map();
for (const f of layoutFiles) {
  const m = f.match(/^(.+)-v(\d+)\.(svg|png|jpe?g|webp)$/i);
  if (!m) continue;
  const v = Number(m[2]);
  if (!latestLayout.has(m[1]) || latestLayout.get(m[1]) < v) latestLayout.set(m[1], v);
}
const records = approvals?.records ?? [];
const sceneIds = (blueprint?.scenes ?? []).map((s) => s.sceneId);
const sceneMissing = sceneIds.filter((id) => {
  const lv = latestLayout.get(id);
  if (!lv) return true;
  const r = records
    .filter((x) => x.stage === 'scene-layout' && x.sceneId === id)
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
  return !(r && r.status === 'approved' && r.version === lv && (r.confirmedBy === 'user' || config.allowAutopilotApprovals === true));
});
add(
  'design-handoff/gate-b',
  mode === 'prototype' || (sceneIds.length > 0 && sceneMissing.length === 0) ? 'pass' : 'blocked',
  mode === 'prototype'
    ? 'prototype 不要求 Gate B（布局确认留给 production）'
    : sceneIds.length === 0
      ? '没有场景意图/蓝图'
      : `${sceneMissing.length}/${sceneIds.length} 个场景没有当前版本 approved 布局（${sceneMissing.join(', ')}）`,
);

add('design-handoff/animation-blueprint', mode === 'prototype' || blueprint?.status === 'approved' ? 'pass' : 'blocked', mode === 'prototype' ? 'prototype 允许 draft 蓝图' : blueprint?.status === 'approved' ? '动画蓝图已批准' : `动画蓝图状态为 ${blueprint?.status ?? '缺失'}`);

const implementation = readJson(abs(path.join(P.animation ?? '', 'implementation-plan.json')));
add('design-handoff/implementation-plan', mode === 'prototype' || implementation?.status === 'approved' ? 'pass' : 'blocked', mode === 'prototype' ? 'prototype 允许 draft 实现计划' : implementation?.status === 'approved' ? '实现计划已批准' : `实现计划状态为 ${implementation?.status ?? '缺失'}`);

// 2. 组件 / 资产：prototype 只检查被选中场景实际引用的依赖
const comps = implementation?.components ?? [];
const assets = implementation?.assets ?? [];
const sceneMap = implementation?.sceneMap ?? [];
const selectedScenes = mode === 'prototype' && Array.isArray(config.prototypeScenes) && config.prototypeScenes.length > 0
  ? new Set(config.prototypeScenes)
  : null;
const relevantMap = selectedScenes ? sceneMap.filter((m) => selectedScenes.has(m.sceneId)) : sceneMap;
const relevantCompIds = relevantMap.length > 0 ? new Set(relevantMap.map((m) => m.component)) : null;
const relevantAssetIds = relevantMap.length > 0 ? new Set(relevantMap.flatMap((m) => m.assetIds ?? [])) : null;
const relevantComps = relevantCompIds ? comps.filter((c) => relevantCompIds.has(c.id)) : comps;
const relevantAssets = relevantAssetIds ? assets.filter((a) => relevantAssetIds.has(a.id)) : assets;
const badCompStatus = relevantComps.filter((c) => mode === 'production' && c.status !== 'available');
const badCompPath = relevantComps.filter((c) => !c.path || !exists(abs(c.path)));
add(
  'spec/components',
  mode === 'prototype'
    ? (relevantComps.length === 0 || badCompPath.length === 0) ? 'pass' : 'blocked'
    : relevantComps.length > 0 && badCompStatus.length === 0 && badCompPath.length === 0 ? 'pass' : 'blocked',
  mode === 'prototype'
    ? relevantComps.length === 0
      ? 'prototype：无组件计划（允许先写可运行代码）'
      : badCompPath.length
        ? `${badCompPath.length}/${relevantComps.length} 个被选中组件文件不存在（prototype 也要求真实文件）`
        : `prototype：${relevantComps.length} 个被选中组件文件存在（允许 candidate）`
    : badCompStatus.length
      ? `${badCompStatus.length}/${relevantComps.length} 个组件仍为 candidate/missing（production 不允许）`
      : badCompPath.length
        ? `${badCompPath.length}/${relevantComps.length} 个组件文件不存在（检查 path）`
        : '所有组件文件存在且可用',
);

const badAssetStatus = relevantAssets.filter((a) => mode === 'production' && a.status !== 'available');
const badAssetPath = relevantAssets.filter((a) => !a.path || !exists(abs(a.path)));
add(
  'spec/assets',
  mode === 'prototype'
    ? relevantAssets.length === 0 || badAssetPath.length === 0 ? 'pass' : 'blocked'
    : relevantAssets.length > 0 && badAssetStatus.length === 0 && badAssetPath.length === 0 ? 'pass' : 'blocked',
  mode === 'prototype'
    ? relevantAssets.length === 0
      ? 'prototype：零外部资产（纯程序化合法）'
      : badAssetPath.length
        ? `${badAssetPath.length}/${relevantAssets.length} 项被选中资产文件不存在（prototype 也要求真实文件）`
        : `prototype：${relevantAssets.length} 项被选中资产文件存在（允许 candidate）`
    : badAssetStatus.length
      ? `${badAssetStatus.length}/${relevantAssets.length} 项资产仍为 candidate/missing（production 不允许）`
      : badAssetPath.length
        ? `${badAssetPath.length}/${relevantAssets.length} 项资产文件不存在（检查 path）`
        : '所有资产文件存在且可用',
);

const specPath = [abs(path.join(P.animation ?? '', 'scene.spec.json')), abs(path.join(P.animation ?? '', 'scene.spec.draft.json'))].find(exists);
const spec = specPath ? readJson(specPath) : null;
add('spec/scene-spec-approved', mode === 'prototype' ? (spec ? 'pass' : 'blocked') : spec?.status === 'approved' ? 'pass' : 'blocked', mode === 'prototype' ? (spec ? 'prototype 允许 draft scene.spec' : '缺少 scene.spec') : spec?.status === 'approved' ? 'scene.spec 已批准' : `scene.spec 状态为 ${spec?.status ?? '缺失'}`);

const contracts = abs(path.join(P.animation ?? '', 'component-contracts.md'));
add('spec/component-contracts', exists(contracts) ? 'pass' : 'blocked', exists(contracts) ? '组件合同存在' : '缺少 component-contracts.md');

const tc = implementation?.timingCompile ?? {};
add('timing/compile-confirmed', mode === 'prototype' || tc.status === 'confirmed' ? 'pass' : 'blocked', mode === 'prototype' ? 'prototype 允许候选时长' : tc.status === 'confirmed' ? 'fps/时长已确认' : `timingCompile 状态为 ${tc.status ?? '缺失'}`);

if (spec && implementation) {
  const out = config.output ?? {};
  const ok =
    spec.fps === out.fps &&
    spec.width === out.width &&
    spec.height === out.height &&
    spec.durationInFrames === out.durationInFrames &&
    tc.totalFrames === out.durationInFrames;
  add('timing/spec-config-match', ok ? 'pass' : 'blocked', ok ? 'spec/config/fps/帧数一致' : 'spec/config/fps/帧数不一致');
}

// 3. Gate C：10s 运动证明
const proof = readJson(abs(path.join(P.qa ?? 'qa', 'motion-proof.json')));
const specHash = sha256(specPath);
const configHash = sha256(configPath);
const proofOk =
  proof?.status === 'passed' &&
  exists(abs(proof.video ?? '')) &&
  proof.specHash === specHash &&
  proof.configHash === configHash &&
  (proof.approvedBy === 'user' || (proof.approvedBy === 'autopilot' && config.allowAutopilotProduction === true && proof.approvalType === 'auto'));
add(
  'gate-c/motion-proof',
  mode === 'production' ? (proofOk ? 'pass' : 'blocked') : proof?.status === 'passed' ? (proofOk ? 'pass' : 'blocked') : 'pass',
  mode === 'production'
    ? proofOk
      ? '10s 运动证明通过，且与当前 spec/config 一致'
      : `Gate C 未通过：proof=${proof?.status ?? '缺失'}，video=${proof?.video ? '有' : '无'}，hash 需匹配当前 spec/config`
    : proof?.status === 'passed'
      ? proofOk
        ? 'prototype 已有通过的 proof'
        : 'prototype proof 存在但版本不一致'
      : 'prototype 模式允许重新生成 proof（旧 proof 不阻塞）',
);

// 4. 工程结构
const componentsDir = abs(P.components ?? 'components');
const tsx = exists(componentsDir) ? fs.readdirSync(componentsDir).filter((f) => f.endsWith('.tsx')) : [];
add('engineering/components-dir', mode === 'prototype' || tsx.length > 0 ? 'pass' : 'blocked', mode === 'prototype' ? 'prototype 由逐组件 path 检查' : tsx.length ? `components/ 有 ${tsx.length} 个 .tsx` : 'components/ 没有 .tsx');
const assetsDir = abs(P.assets ?? 'assets');
add('engineering/assets-dir', mode === 'prototype' || exists(assetsDir) ? 'pass' : 'blocked', mode === 'prototype' ? 'prototype 由逐资产 path 检查' : exists(assetsDir) ? 'assets/ 存在' : 'assets/ 不存在');

const buildManifest = readJson(abs(path.join(P.qa ?? 'qa', 'build-manifest.json')));
const currentBuild = computeBuildManifest({ root: baseDir, configPath, config });
const buildOk =
  buildManifest?.type === 'build-manifest' &&
  typeof buildManifest.buildHash === 'string' &&
  buildManifest.buildHash === currentBuild.buildHash &&
  Array.isArray(buildManifest.files) &&
  buildManifest.files.length >= 1;
add(
  'build/manifest',
  mode === 'sketch' || buildOk ? 'pass' : 'blocked',
  mode === 'sketch' ? 'sketch 不要求 build manifest' : buildOk ? `buildHash=${buildManifest.buildHash.slice(0, 12)}…（${buildManifest.fileCount ?? buildManifest.files.length} 个输入）` : '缺少/过期 qa/build-manifest.json（先跑 build-manifest.mjs；buildHash 必须匹配当前输入）',
);

const out = config.output ?? {};
const outputOk = Number.isInteger(out.width) && Number.isInteger(out.height) && Number.isInteger(out.fps) && Number.isInteger(out.durationInFrames);
add('output/config', outputOk ? 'pass' : 'blocked', outputOk ? `输出规格 ${out.width}×${out.height} / ${out.fps}fps / ${out.durationInFrames}f` : 'execution.config.output 缺宽高/fps/帧数');

const status = blocking.length ? 'blocked' : 'passed';
const report = {
  schemaVersion: '1.0',
  type: 'preflight-report',
  filmId: config.filmId,
  mode,
  status,
  checks,
  blocking,
  hashes: { specHash, configHash, buildHash: buildManifest?.buildHash ?? null },
  config: { composition: out.composition, width: out.width, height: out.height, fps: out.fps, durationInFrames: out.durationInFrames },
  createdAt: new Date().toISOString(),
};

if (outArg) {
  const outPath = path.resolve(baseDir, outArg);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${outArg}`);
}
console.log(`preflight(${mode}): ${status}${blocking.length ? `（${blocking.length} 项阻塞）` : ''}`);
for (const b of blocking) console.log('  - ' + b);
process.exit(status === 'passed' ? 0 : 1);

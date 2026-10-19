#!/usr/bin/env node
/**
 * 执行与验收链校验器（v5，无依赖）
 *
 * 用法：node tools/validate-execution.mjs examples/<film>
 *
 * 检查：preflight → component test → preview → final render manifest → acceptance → visual review → delivery。
 * preflight 为 blocked 时，只要求下游没有“已交付”的假状态。
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('用法：node tools/validate-execution.mjs <film-dir>');
  process.exit(2);
}
const dir = path.resolve(process.cwd(), target);
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`目录不存在：${target}`);
  process.exit(2);
}

const errors = [];
const need = (cond, msg) => {
  if (!cond) errors.push(msg);
};
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isArr = (v) => Array.isArray(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const existsRel = (p) => isStr(p) && fs.existsSync(path.resolve(dir, p));
const readJson = (rel) => {
  const p = path.resolve(dir, rel);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    errors.push(`${rel} 不是合法 JSON：${e.message}`);
    return null;
  }
};

const config = readJson('execution.config.json');
need(!!config, '缺少 execution.config.json');
const out = config?.output ?? {};
const animDir = path.resolve(dir, config?.paths?.animation ?? '.');
const readAbs = (p) => {
  if (!p || !fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};
const implementation = readAbs(path.join(animDir, 'implementation-plan.json'));
const spec = readAbs(path.join(animDir, 'scene.spec.json')) ?? readAbs(path.join(animDir, 'scene.spec.draft.json'));

const preflight = readJson('qa/preflight-report.json');
need(!!preflight, '缺少 qa/preflight-report.json（先跑 preflight）');
if (preflight) {
  need(preflight.schemaVersion === '1.0', 'preflight-report.schemaVersion 必须是 "1.0"');
  need(preflight.type === 'preflight-report', 'preflight-report.type 必须是 preflight-report');
  need(['passed', 'blocked'].includes(preflight.status), 'preflight-report.status 非法');
  need(isArr(preflight.checks) && preflight.checks.length >= 1, 'preflight-report.checks 至少 1 项');
  need(isArr(preflight.blocking), 'preflight-report.blocking 必须是数组');
  if (preflight.status === 'blocked') {
    need(preflight.blocking.length >= 1, 'preflight blocked 时必须写 blocking 原因');
    const delivery = readJson('qa/delivery-manifest.json');
    if (delivery) {
      need(delivery.status !== 'delivered', 'preflight blocked 时 delivery-manifest 不能是 delivered');
      need(delivery.status === 'blocked', 'preflight blocked 时 delivery-manifest 必须是 blocked');
    }
    const final = readJson('qa/render-manifest.json');
    if (final) need(final.status !== 'passed', 'preflight blocked 时不能有 passed 的正式 render-manifest');
    const proof = readJson('qa/motion-proof.json');
    if (proof) need(proof.status !== 'passed', 'preflight blocked 时不能有 passed 的 motion-proof');
    if (errors.length) {
      console.error(`✗ 执行链 blocked 状态记录不合法（${errors.length} 项）：`);
      for (const e of errors) console.error('  - ' + e);
      process.exit(1);
    }
    console.log(`✓ 执行链处于 blocked（符合预期）：${preflight.blocking.length} 项阻塞`);
    for (const b of preflight.blocking.slice(0, 5)) console.log('  - ' + b);
    console.log('  提示：preflight 未过时，不应有 component test / preview / final render / visual review 的“已通过”状态。');
    process.exit(0);
  }
}

// 以下只在 preflight passed 时检查
const buildManifest = readJson('qa/build-manifest.json');
need(!!buildManifest, '缺少 qa/build-manifest.json（先跑 build-manifest.mjs）');
if (buildManifest) {
  need(buildManifest.type === 'build-manifest', 'build-manifest.type 非法');
  need(isStr(buildManifest.buildHash) && buildManifest.buildHash.length >= 32, 'build-manifest.buildHash 不能为空');
  need(isArr(buildManifest.files) && buildManifest.files.length >= 1, 'build-manifest.files 至少 1 个输入');
}
const buildHash = buildManifest?.buildHash;

const proof = readJson('qa/motion-proof.json');
need(!!proof, '缺少 qa/motion-proof.json（Gate C）');
if (proof) {
  need(proof.type === 'motion-proof', 'motion-proof.type 非法');
  need(proof.status === 'passed', 'motion-proof.status 必须是 passed');
  need(existsRel(proof.video), `motion-proof.video 不存在：${proof.video}`);
  need(isStr(proof.specHash) && proof.specHash === preflight?.hashes?.specHash, 'motion-proof.specHash 必须与当前 scene.spec 一致');
  need(isStr(proof.configHash) && proof.configHash === preflight?.hashes?.configHash, 'motion-proof.configHash 必须与当前 execution.config 一致');
  need(isStr(proof.buildHash) && proof.buildHash === buildHash, 'motion-proof.buildHash 必须与当前 build manifest 一致');
  need(['user', 'autopilot'].includes(proof.approvedBy), 'motion-proof.approvedBy 非法');
}

const componentReport = readJson('qa/component-test-report.json');
need(!!componentReport, '缺少 qa/component-test-report.json');
if (componentReport) {
  need(componentReport.type === 'component-test-report', 'component-test-report.type 非法');
  need(componentReport.status === 'passed', 'component-test-report.status 必须是 passed');
  need(isArr(componentReport.components) && componentReport.components.length >= 1, 'component-test-report.components 至少 1 个');
  for (const [i, c] of (componentReport.components ?? []).entries()) {
    need(isStr(c.id), `components[${i}].id 不能为空`);
    need(c.status === 'passed', `components[${i}] 状态必须是 passed`);
    need(isInt(c.startFrame), `components[${i}].startFrame 必须是整数`);
    need(isArr(c.motionFrames) && c.motionFrames.length >= 1, `components[${i}].motionFrames 至少 1 帧`);
    need(isInt(c.endFrame), `components[${i}].endFrame 必须是整数`);
    need(isArr(c.evidence) && c.evidence.length >= 1, `components[${i}].evidence 至少 1 张证据`);
    for (const e of c.evidence ?? []) need(existsRel(e), `components[${i}] 证据不存在：${e}`);
  }
  const requiredComps = new Set((implementation?.components ?? []).filter((c) => (implementation?.sceneMap ?? []).some((m) => m.component === c.id)).map((c) => c.id));
  const tested = new Set((componentReport.components ?? []).map((c) => c.id));
  for (const id of requiredComps) need(tested.has(id), `component-test-report 缺少组件 ${id} 的独立测试`);
}

const preview = readJson('qa/preview-report.json');
need(!!preview, '缺少 qa/preview-report.json');
if (preview) {
  need(preview.type === 'preview-report', 'preview-report.type 非法');
  need(preview.status === 'passed', 'preview-report.status 必须是 passed');
  need(isArr(preview.scenes) && preview.scenes.length >= 1, 'preview-report.scenes 至少 1 项');
  for (const [i, s] of (preview.scenes ?? []).entries()) {
    need(isStr(s.sceneId), `preview.scenes[${i}].sceneId 不能为空`);
    need(s.status === 'passed', `preview.scenes[${i}] 状态必须是 passed`);
    need(existsRel(s.preview), `preview.scenes[${i}].preview 不存在：${s.preview}`);
    need(existsRel(s.contactSheet), `preview.scenes[${i}].contactSheet 不存在：${s.contactSheet}`);
    need(isArr(s.frames) && s.frames.length >= 3, `preview.scenes[${i}].frames 至少 3 帧`);
    for (const f of s.frames ?? []) need(existsRel(f), `preview.scenes[${i}] 帧不存在：${f}`);
  }
  need(existsRel(preview.fullPreview), 'preview-report.fullPreview 不存在');
  need(isStr(preview.specHash), 'preview-report.specHash 不能为空');
  need(isStr(preview.configHash), 'preview-report.configHash 不能为空');
  need(isStr(preview.buildHash) && preview.buildHash === buildHash, 'preview-report.buildHash 必须与当前 build manifest 一致');
  need(preview.specHash === preflight?.hashes?.specHash, 'preview.specHash 必须与 preflight 的当前 spec 一致');
  need(preview.configHash === preflight?.hashes?.configHash, 'preview.configHash 必须与 preflight 的当前 config 一致');
  const requiredScenes = new Set((spec?.scenes ?? []).map((x) => x.sceneId));
  const previewed = new Set((preview.scenes ?? []).map((x) => x.sceneId));
  for (const id of requiredScenes) need(previewed.has(id), `preview-report 缺少场景 ${id} 的预览`);
}

const manifest = readJson('qa/render-manifest.json');
need(!!manifest, '缺少 qa/render-manifest.json');
if (manifest) {
  need(manifest.type === 'render-manifest', 'render-manifest.type 非法');
  need(manifest.status === 'passed', 'render-manifest.status 必须是 passed');
  need(manifest.mode === 'final', '正式 render-manifest.mode 必须是 final');
  need(manifest.composition === out.composition, 'render-manifest.composition 与 execution.config 不一致');
  need(manifest.fps === out.fps && manifest.width === out.width && manifest.height === out.height && manifest.durationInFrames === out.durationInFrames, 'render-manifest 媒体规格与 execution.config 不一致');
  need(existsRel(manifest.output), `render-manifest.output 不存在：${manifest.output}`);
  for (const k of ['codeVersion', 'specHash', 'assetManifestHash', 'configHash', 'buildHash', 'renderHash']) {
    need(isStr(manifest[k]), `render-manifest.${k} 不能为空（可追溯）`);
  }
  need(manifest.specHash === preflight?.hashes?.specHash, '正式渲染的 specHash 必须与当前 spec 一致');
  need(manifest.configHash === preflight?.hashes?.configHash, '正式渲染的 configHash 必须与当前 config 一致');
  need(manifest.buildHash === buildHash, '正式渲染的 buildHash 必须与当前 build manifest 一致');
  if (preview) {
    need(manifest.specHash === preview.specHash, '正式渲染与预览的 specHash 不一致（不是同一份规格）');
    need(manifest.configHash === preview.configHash, '正式渲染与预览的 configHash 不一致（不是同一套配置）');
  }
}

const acceptance = readJson('qa/acceptance-report.json');
need(!!acceptance, '缺少 qa/acceptance-report.json');
if (acceptance) {
  need(acceptance.type === 'acceptance-report', 'acceptance-report.type 非法');
  need(acceptance.status === 'passed', 'acceptance-report.status 必须是 passed');
  if (manifest) need(acceptance.renderId === manifest.renderId, 'acceptance-report.renderId 与 render-manifest 不一致');
  for (const k of ['media', 'audio', 'frames', 'determinism']) {
    need(acceptance.checks?.[k]?.status === 'passed', `acceptance.checks.${k} 必须是 passed`);
  }
  need(isArr(acceptance.issues) && acceptance.issues.length === 0, 'acceptance-report.issues 必须为空');
}

const review = readJson('qa/visual-review.json');
need(!!review, '缺少 qa/visual-review.json');
if (review) {
  need(review.type === 'visual-review', 'visual-review.type 非法');
  need(['approved', 'needs-revision'].includes(review.status), 'visual-review.status 非法');
  need(isStr(review.reviewId), 'visual-review.reviewId 不能为空');
  need(review.renderId === manifest?.renderId, 'visual-review.renderId 必须与当前 render-manifest 一致');
  need(isStr(review.renderHash) && review.renderHash === manifest?.renderHash, 'visual-review.renderHash 必须与当前渲染输出一致');
  need(review.buildHash === buildHash, 'visual-review.buildHash 必须与当前 build manifest 一致（否则审片已过期）');
  need(isArr(review.reviewedRanges) && review.reviewedRanges.length >= 1, 'visual-review.reviewedRanges 不能为空');
  need(typeof review.fullPlaybackReviewed === 'boolean', 'visual-review.fullPlaybackReviewed 必须是布尔值');
  need(isObj(review.reviewer) && ['model', 'human'].includes(review.reviewer.type), 'visual-review.reviewer.type 必须是 model/human');
  need(isArr(review.findings), 'visual-review.findings 必须是数组');
  for (const [i, f] of (review.findings ?? []).entries()) {
    need(isStr(f.id), `findings[${i}].id 不能为空`);
    need(['blocker', 'major', 'minor'].includes(f.severity), `findings[${i}].severity 非法`);
    const holistic = f.scope === 'holistic' || f.category === 'holistic' || f.sceneId === 'film';
    if (!holistic) {
      need(isStr(f.sceneId), `findings[${i}].sceneId 不能为空（holistic finding 请标 scope=holistic）`);
      need(isArr(f.frameRange) && f.frameRange.length === 2, `findings[${i}].frameRange 必须是 [start,end]`);
      need(isStr(f.expected) && f.expected.length >= 6, `findings[${i}].expected 不能为空`);
    } else {
      need((isArr(f.frameRange) && f.frameRange.length === 2) || (isArr(f.timeRangeSec) && f.timeRangeSec.length === 2), `holistic findings[${i}] 需要 frameRange 或 timeRangeSec`);
    }
    need(isStr(f.observation) && f.observation.length >= 6, `findings[${i}].observation 不能为空`);
    need(['creative-direction', 'animation-design', 'visual-system', 'asset-workflow', 'component-contract', 'remotion-execution', 'render-delivery'].includes(f.likelyOwner), `findings[${i}].likelyOwner 非法`);
    need(isStr(f.recommendedAction) && f.recommendedAction.length >= 4, `findings[${i}].recommendedAction 不能为空`);
    need(isArr(f.evidence) && f.evidence.length >= 1, `findings[${i}].evidence 至少 1 项`);
    for (const e of f.evidence ?? []) need(existsRel(e), `findings[${i}] 证据不存在：${e}`);
    need(['pending', 'accepted', 'rejected'].includes(f.humanDecision), `findings[${i}].humanDecision 非法`);
  }
  if (review.status === 'approved') {
    need(review.fullPlaybackReviewed === true, 'visual-review approved 前必须完整播放审查（fullPlaybackReviewed=true）');
    const open = (review.findings ?? []).filter((f) => f.humanDecision === 'pending' && f.severity !== 'minor');
    need(open.length === 0, 'visual-review approved 时不能有未处理的 blocker/major');
  }
  if (review.status === 'needs-revision') {
    const delivery = readJson('qa/delivery-manifest.json');
    if (delivery) need(delivery.status !== 'delivered', 'visual-review needs-revision 时不能 delivered');
  }
}

const delivery = readJson('qa/delivery-manifest.json');
need(!!delivery, '缺少 qa/delivery-manifest.json');
if (delivery) {
  need(delivery.type === 'delivery-manifest', 'delivery-manifest.type 非法');
  need(['delivered', 'blocked'].includes(delivery.status), 'delivery-manifest.status 非法');
  if (delivery.status === 'delivered') {
    need(manifest?.status === 'passed', 'delivery delivered 前必须有 passed 的 render-manifest');
    need(acceptance?.status === 'passed', 'delivery delivered 前必须有 passed 的 acceptance-report');
    need(review?.status === 'approved', 'delivery delivered 前必须有 approved 的 visual-review');
    need(isStr(delivery.output) && delivery.output === manifest?.output, 'delivery.output 必须与 render-manifest 一致');
    need(['user', 'autopilot'].includes(delivery.approvedBy), 'delivery.approvedBy 非法');
    if (delivery.approvedBy === 'autopilot') {
      need(config?.allowAutopilotDelivery === true, 'autopilot 不能单独解锁正式交付；需项目明确 allowAutopilotDelivery=true');
      need(delivery.approvalType === 'auto', 'autopilot 交付必须标 approvalType=auto，不能伪装用户批准');
    }
  }
}

if (errors.length) {
  console.error(`✗ 执行与验收链未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('✓ 执行与验收链通过：preflight → component test → preview → final render → acceptance → visual review → delivery');

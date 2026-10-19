#!/usr/bin/env node
/**
 * 关键画面门校验器（v5，无依赖）
 *
 * 用法：node tools/validate-gates.mjs examples/<film>
 *
 * 只回答：
 * - Gate A：方向样稿是否存在、是否真的不同、是否已确认；
 * - Gate B：场景布局是否在写动画之前确认，确认范围是否写清；
 * - 确认记录是否绑定版本、是否有 validFor/notApproved。
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('用法：node tools/validate-gates.mjs <film-dir>');
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

const read = (name) => {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) {
    errors.push(`缺少 ${name}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    errors.push(`${name} 不是合法 JSON：${e.message}`);
    return null;
  }
};

const STAGE_RULES = {
  direction: {
    validFor: ['visual-language', 'direction-fit', 'distinctiveness', 'sample-look'],
    notApproved: ['animation-timing', 'final-assets', 'final-duration', 'scene-layout', 'component-contracts'],
  },
  'scene-layout': {
    validFor: ['composition', 'visual-hierarchy', 'focus', 'text-placement', 'scene-intent'],
    notApproved: ['animation-timing', 'final-assets', 'final-duration', 'motion-quality'],
  },
};

function checkApproval(a, label) {
  need(isObj(a), `${label} 必须是对象`);
  if (!isObj(a)) return;
  need(isStr(a.artifactId), `${label}.artifactId 不能为空`);
  need(['direction', 'scene-layout'].includes(a.stage), `${label}.stage 必须是 direction/scene-layout`);
  need(['pending', 'approved', 'approved-with-changes', 'rejected'].includes(a.status), `${label}.status 非法`);
  need(Number.isInteger(a.version) && a.version >= 1, `${label}.version 必须是 >=1 的整数`);
  need(isArr(a.sourceUnits) && a.sourceUnits.length >= 1, `${label}.sourceUnits 至少 1 个`);
  need(isArr(a.validFor) && a.validFor.length >= 1, `${label}.validFor 不能为空`);
  need(isArr(a.notApproved) && a.notApproved.length >= 1, `${label}.notApproved 不能为空（确认必须有范围）`);

  const rule = STAGE_RULES[a.stage];
  if (rule) {
    for (const [i, x] of (a.validFor ?? []).entries()) need(rule.validFor.includes(x), `${label}.validFor[${i}] 非法：${x}`);
    for (const [i, x] of (a.notApproved ?? []).entries()) need(rule.notApproved.includes(x), `${label}.notApproved[${i}] 非法：${x}`);
    for (const x of a.validFor ?? []) need(!(a.notApproved ?? []).includes(x), `${label}.validFor 与 notApproved 不能重叠：${x}`);
  }

  if (a.status === 'approved' || a.status === 'approved-with-changes') {
    need(['user', 'autopilot'].includes(a.confirmedBy), `${label}.confirmedBy 必须是 user/autopilot`);
    need(isStr(a.confirmedAt), `${label}.confirmedAt 不能为空`);
  }
  if (a.status === 'approved-with-changes') {
    need(isStr(a.userFeedback?.quote) && a.userFeedback.quote.length >= 5, `${label}.userFeedback.quote 必须记录用户原话`);
    need(isArr(a.userFeedback?.changes) && a.userFeedback.changes.length >= 1, `${label}.userFeedback.changes 至少 1 条`);
    for (const [i, c] of (a.userFeedback?.changes ?? []).entries()) {
      need(isStr(c.target), `${label}.userFeedback.changes[${i}].target 不能为空`);
      need(isStr(c.instruction) && c.instruction.length >= 4, `${label}.userFeedback.changes[${i}].instruction 不能为空`);
    }
  }
  if (a.status === 'pending') {
    need(!isStr(a.confirmedAt), `${label} 状态为 pending 时不能写 confirmedAt`);
  }
}

// ---------------- Gate A ----------------
const gate = read('direction-gate.json');
let directions = null;
if (gate) {
  need(gate.schemaVersion === '1.0', 'direction-gate.schemaVersion 必须是 "1.0"');
  need(gate.type === 'direction-gate', 'direction-gate.type 必须是 direction-gate');
  need(['recommended', 'confirmed', 'rejected'].includes(gate.status), 'direction-gate.status 非法');

  const cdPath = gate.basedOn?.creativeDirections;
  if (isStr(cdPath)) {
    const p = path.resolve(dir, cdPath);
    need(fs.existsSync(p), `basedOn.creativeDirections 不存在：${cdPath}`);
    if (fs.existsSync(p)) {
      try {
        directions = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (e) {
        errors.push(`creative-directions.json 不是合法 JSON：${e.message}`);
      }
    }
  } else errors.push('direction-gate.basedOn.creativeDirections 缺失');
  if (isStr(gate.basedOn?.referenceDecision)) {
    need(fs.existsSync(path.resolve(dir, gate.basedOn.referenceDecision)), `basedOn.referenceDecision 不存在：${gate.basedOn.referenceDecision}`);
  } else errors.push('direction-gate.basedOn.referenceDecision 缺失');

  const dirIds = (directions?.directions ?? []).map((d) => d.id);
  need(isArr(gate.samples) && gate.samples.length >= 2 && gate.samples.length <= 3, 'direction-gate.samples 需要 2–3 个方向样稿');
  const sampleIds = new Set();
  for (const [i, s] of (gate.samples ?? []).entries()) {
    need(isStr(s.directionId), `samples[${i}].directionId 不能为空`);
    if (isStr(s.directionId)) {
      need(dirIds.includes(s.directionId), `samples[${i}].directionId 不在 creative-directions：${s.directionId}`);
      need(!sampleIds.has(s.directionId), `samples[${i}].directionId 重复`);
      sampleIds.add(s.directionId);
    }
    need(isStr(s.file), `samples[${i}].file 不能为空`);
    if (isStr(s.file)) need(fs.existsSync(path.resolve(dir, s.file)), `samples[${i}].file 不存在：${s.file}`);
    need(isStr(s.designNotes) && s.designNotes.length >= 8, `samples[${i}].designNotes 不能为空`);
    need(typeof s.provisionalAssets === 'boolean', `samples[${i}].provisionalAssets 必须是布尔值`);
  }
  need(isStr(gate.selectedDirectionId) && sampleIds.has(gate.selectedDirectionId), 'selectedDirectionId 必须在 samples 里');
  need(isStr(gate.recommendation) && gate.recommendation.length >= 10, 'recommendation 不能为空');

  if (gate.status === 'confirmed') {
    need(isObj(gate.confirmation), 'status=confirmed 时必须写 confirmation');
    checkApproval(gate.confirmation, 'direction-gate.confirmation');
    if (isObj(gate.confirmation)) {
      need(gate.confirmation.stage === 'direction', 'direction-gate.confirmation.stage 必须是 direction');
      need(['approved', 'approved-with-changes'].includes(gate.confirmation.status), '方向确认状态必须是 approved/approved-with-changes');
      need((gate.confirmation.validFor ?? []).includes('visual-language'), '方向确认的 validFor 必须包含 visual-language');
    }
  } else {
    need(gate.confirmation === null || gate.confirmation === undefined, 'status!=confirmed 时不能写 confirmation（推荐/拒绝不等于确认）');
  }
}

// ---------------- Gate B ----------------
const scene = read('scene-intent.json');
const intentPath = scene?.basedOn?.intentBrief;
let intent = null;
if (isStr(intentPath)) {
  const p = path.resolve(dir, intentPath);
  need(fs.existsSync(p), `basedOn.intentBrief 不存在：${intentPath}`);
  if (fs.existsSync(p)) intent = JSON.parse(fs.readFileSync(p, 'utf8'));
}
if (scene) {
  need(scene.schemaVersion === '1.0', 'scene-intent.schemaVersion 必须是 "1.0"');
  need(scene.type === 'scene-intent', 'scene-intent.type 必须是 scene-intent');
  need(isStr(scene.filmId), 'scene-intent.filmId 不能为空');
  need(isStr(scene.sceneId), 'scene-intent.sceneId 不能为空');
  need(isArr(scene.sourceUnitIds) && scene.sourceUnitIds.length >= 1, 'scene-intent.sourceUnitIds 至少 1 个');
  const unitIds = new Set((intent?.content?.units ?? []).map((u) => u.id));
  for (const [i, u] of (scene.sourceUnitIds ?? []).entries()) {
    need(unitIds.has(u), `sourceUnitIds[${i}] 不在 intent-brief：${u}`);
  }
  for (const k of ['intent', 'event', 'attention', 'motionIntent']) {
    need(isStr(scene[k]) && scene[k].length >= 4, `scene-intent.${k} 不能为空`);
  }
  need(typeof scene.staticIntent === 'boolean', 'scene-intent.staticIntent 必须是布尔值');
  need(isArr(scene.assets) && scene.assets.length >= 1, 'scene-intent.assets 至少 1 条');
  for (const [i, a] of (scene.assets ?? []).entries()) {
    need(isStr(a.id), `assets[${i}].id 不能为空`);
    need(['final', 'placeholder', 'to-acquire'].includes(a.status), `assets[${i}].status 非法`);
    need(isStr(a.note), `assets[${i}].note 不能为空`);
  }
  need(isArr(scene.notThis) && scene.notThis.length >= 1, 'scene-intent.notThis 至少 1 条（明确不做什么）');
}

// 布局文件：scene-layouts/<sceneId>-v<version>.(svg|png|jpg|jpeg|webp)
const layoutDir = path.join(dir, 'scene-layouts');
const layoutFiles = fs.existsSync(layoutDir) ? fs.readdirSync(layoutDir) : [];
let sceneLayoutVersion = 0;
if (scene) {
  const re = new RegExp(`^${scene.sceneId}-v(\\d+)\\.(svg|png|jpe?g|webp)$`, 'i');
  for (const f of layoutFiles) {
    const m = f.match(re);
    if (m) sceneLayoutVersion = Math.max(sceneLayoutVersion, Number(m[1]));
  }
  need(sceneLayoutVersion >= 1, `scene-layouts/ 缺少 ${scene.sceneId}-v<版本>.(svg|png|jpg|webp)`);
}

// ---------------- approvals ----------------
const approvals = read('approvals.json');
let sceneLayoutApproved = false;
if (approvals) {
  need(approvals.schemaVersion === '1.0', 'approvals.schemaVersion 必须是 "1.0"');
  need(approvals.type === 'approvals', 'approvals.type 必须是 approvals');
  need(isArr(approvals.records), 'approvals.records 必须是数组');
  for (const [i, a] of (approvals.records ?? []).entries()) {
    checkApproval(a, `approvals.records[${i}]`);
    if (a.stage === 'scene-layout' && ['approved', 'approved-with-changes'].includes(a.status)) {
      sceneLayoutApproved = true;
      if (gate?.status !== 'confirmed') errors.push('Gate B 已批准，但 Gate A 方向未确认；不能跳过方向门');
      if (a.version !== sceneLayoutVersion) errors.push(`scene-layout 确认版本 ${a.version} 与现有布局版本 v${sceneLayoutVersion} 不一致`);
      for (const u of scene?.sourceUnitIds ?? []) need((a.sourceUnits ?? []).includes(u), `scene-layout 确认缺少 sourceUnit：${u}`);
    }
  }
}

// 动画不能在 Gate B 前开始
const animationFiles = [
  'scene.spec.json',
  '02-scene.spec.json',
  path.join('components', 'index.tsx'),
];
const hasAnimation = animationFiles.some((f) => fs.existsSync(path.join(dir, f)));
if (hasAnimation && !sceneLayoutApproved) {
  errors.push('Gate B 未通过就出现了 scene.spec / 组件文件；先确认场景布局，再写动画');
}

const text = JSON.stringify({ gate, scene, approvals });
need(!/TODO|TBD|占位符|待填写/i.test(text), '还有占位符/待填写');
need(!/<[^>]+>/.test(text.replace(/https?:\/\/[^\s"]+/g, '')), '还有尖括号占位');

if (errors.length) {
  console.error(`✗ 关键画面门未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ 关键画面门通过：Gate A=${gate?.status ?? '?'}（${gate?.samples?.length ?? 0} 个方向样稿），Gate B=${sceneLayoutApproved ? 'approved' : 'pending'}（布局 v${sceneLayoutVersion}）`);
console.log('  提示：Gate A 回答“视觉语言成立吗”，Gate B 回答“场景布局成立吗”；确认必须带 validFor/notApproved。');

#!/usr/bin/env node
/**
 * 关键画面门校验器（v5，无依赖）
 *
 * 用法：node tools/validate-gates.mjs examples/<film>
 *
 * 规则：
 * - Gate A 确认必须绑定 direction-gate.version；approved-with-changes 不算确认；
 * - Gate B 按场景逐个检查：最新布局版本 + 当前版本 approved；
 * - approved-with-changes 必须生成更新版本，旧版本不能当最终批准；
 * - 所有蓝图场景都有当前版本 approved，Gate B 才算通过。
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
const isInt = (v) => Number.isInteger(v);

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
  need(isInt(a.version) && a.version >= 1, `${label}.version 必须是 >=1 的整数`);
  need(isArr(a.sourceUnits) && a.sourceUnits.length >= 1, `${label}.sourceUnits 至少 1 个`);
  need(isArr(a.validFor) && a.validFor.length >= 1, `${label}.validFor 不能为空`);
  need(isArr(a.notApproved) && a.notApproved.length >= 1, `${label}.notApproved 不能为空`);
  const rule = STAGE_RULES[a.stage];
  if (rule) {
    for (const [i, x] of (a.validFor ?? []).entries()) need(rule.validFor.includes(x), `${label}.validFor[${i}] 非法：${x}`);
    for (const [i, x] of (a.notApproved ?? []).entries()) need(rule.notApproved.includes(x), `${label}.notApproved[${i}] 非法：${x}`);
    for (const x of a.validFor ?? []) need(!(a.notApproved ?? []).includes(x), `${label}.validFor 与 notApproved 不能重叠：${x}`);
  }
  if (['approved', 'approved-with-changes'].includes(a.status)) {
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
  if (a.status === 'pending') need(!isStr(a.confirmedAt), `${label} 状态为 pending 时不能写 confirmedAt`);
}

// ---------------- Gate A ----------------
const gate = read('direction-gate.json');
let directions = null;
let gateAApproved = false;
if (gate) {
  need(gate.schemaVersion === '1.0', 'direction-gate.schemaVersion 必须是 "1.0"');
  need(gate.type === 'direction-gate', 'direction-gate.type 必须是 direction-gate');
  need(isInt(gate.version) && gate.version >= 1, 'direction-gate.version 必须是 >=1 的整数');
  need(['recommended', 'confirmed', 'rejected'].includes(gate.status), 'direction-gate.status 非法');

  const cdPath = gate.basedOn?.creativeDirections;
  if (isStr(cdPath)) {
    const p = path.resolve(dir, cdPath);
    need(fs.existsSync(p), `basedOn.creativeDirections 不存在：${cdPath}`);
    if (fs.existsSync(p)) directions = JSON.parse(fs.readFileSync(p, 'utf8'));
  } else errors.push('direction-gate.basedOn.creativeDirections 缺失');
  if (isStr(gate.basedOn?.referenceDecision)) {
    need(fs.existsSync(path.resolve(dir, gate.basedOn.referenceDecision)), `basedOn.referenceDecision 不存在：${gate.basedOn.referenceDecision}`);
  } else errors.push('direction-gate.basedOn.referenceDecision 缺失');

  const dirIds = (directions?.directions ?? []).map((d) => d.id);
  const dirMode = directions?.mode ?? 'exploration';
  const minSamples = dirMode === 'direct' ? 1 : 2;
  const maxSamples = dirMode === 'direct' ? 2 : 3;
  need(isArr(gate.samples) && gate.samples.length >= minSamples && gate.samples.length <= maxSamples, `direction-gate.samples 在 ${dirMode} 模式需要 ${minSamples}–${maxSamples} 个样稿`);
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
    need(['structure', 'look-dev'].includes(s.sampleType), `samples[${i}].sampleType 必须是 structure/look-dev`);
  }
  const lookDev = gate.lookDev;
  need(isObj(lookDev), 'direction-gate.lookDev 必须存在（结构示意与 Look-dev 分开）');
  if (isObj(lookDev)) {
    need(typeof lookDev.required === 'boolean', 'direction-gate.lookDev.required 必须是布尔值');
    need(['missing', 'passed'].includes(lookDev.status), 'direction-gate.lookDev.status 必须是 missing/passed');
    if (lookDev.required && lookDev.status === 'passed') {
      need(isArr(lookDev.evidence) && lookDev.evidence.length >= 1, 'lookDev.required 且 passed 时必须有证据文件');
      for (const [i, e] of (lookDev.evidence ?? []).entries()) need(fs.existsSync(path.resolve(dir, e)), `lookDev.evidence[${i}] 不存在：${e}`);
    }
  }
  need(isStr(gate.selectedDirectionId) && sampleIds.has(gate.selectedDirectionId), 'selectedDirectionId 必须在 samples 里');
  need(isStr(gate.recommendation) && gate.recommendation.length >= 10, 'recommendation 不能为空');

  if (gate.status === 'confirmed') {
    need(isObj(gate.confirmation), 'status=confirmed 时必须写 confirmation');
    checkApproval(gate.confirmation, 'direction-gate.confirmation');
    if (isObj(gate.confirmation)) {
      need(gate.confirmation.stage === 'direction', 'direction-gate.confirmation.stage 必须是 direction');
      need(gate.confirmation.status === 'approved', '方向确认必须是 approved；approved-with-changes 需新版本重新确认');
      need(gate.confirmation.version === gate.version, `方向确认版本 ${gate.confirmation.version} 与 direction-gate.version ${gate.version} 不一致`);
      need((gate.confirmation.validFor ?? []).includes('visual-language'), '方向确认的 validFor 必须包含 visual-language');
      const lookDevOk = !gate.lookDev?.required || gate.lookDev?.status === 'passed';
      gateAApproved = gate.confirmation.status === 'approved' && gate.confirmation.version === gate.version && lookDevOk;
    }
  } else {
    need(gate.confirmation === null || gate.confirmation === undefined, 'status!=confirmed 时不能写 confirmation（推荐/拒绝不等于确认）');
  }
}

// ---------------- 场景意图 ----------------
const intentsDoc = read('scene-intents.json');
let blueprint = null;
let intentUnits = [];
let sceneIntents = [];
if (intentsDoc) {
  need(intentsDoc.schemaVersion === '1.0', 'scene-intents.schemaVersion 必须是 "1.0"');
  need(intentsDoc.type === 'scene-intents', 'scene-intents.type 必须是 scene-intents');
  need(isStr(intentsDoc.filmId), 'scene-intents.filmId 不能为空');
  if (isStr(intentsDoc.basedOn?.animationBlueprint)) {
    const p = path.resolve(dir, intentsDoc.basedOn.animationBlueprint);
    need(fs.existsSync(p), `basedOn.animationBlueprint 不存在：${intentsDoc.basedOn.animationBlueprint}`);
    if (fs.existsSync(p)) blueprint = JSON.parse(fs.readFileSync(p, 'utf8'));
  } else errors.push('scene-intents.basedOn.animationBlueprint 缺失');
  if (isStr(intentsDoc.basedOn?.intentBrief)) {
    const p = path.resolve(dir, intentsDoc.basedOn.intentBrief);
    need(fs.existsSync(p), `basedOn.intentBrief 不存在：${intentsDoc.basedOn.intentBrief}`);
    if (fs.existsSync(p)) {
      const ib = JSON.parse(fs.readFileSync(p, 'utf8'));
      intentUnits = (ib.content?.units ?? []).map((u) => u.id);
    }
  } else errors.push('scene-intents.basedOn.intentBrief 缺失');

  sceneIntents = intentsDoc.scenes ?? [];
  const blueprintIds = (blueprint?.scenes ?? []).map((s) => s.sceneId);
  need(isArr(sceneIntents) && sceneIntents.length === blueprintIds.length, 'scene-intents.scenes 数量必须与 animation-blueprint 一致');
  const seen = new Set();
  for (const [i, s] of sceneIntents.entries()) {
    const p = `scene-intents[${i}](${s.sceneId ?? '?'})`;
    need(isStr(s.sceneId) && blueprintIds.includes(s.sceneId), `${p}.sceneId 不在 animation-blueprint`);
    if (isStr(s.sceneId)) {
      need(!seen.has(s.sceneId), `${p}.sceneId 重复`);
      seen.add(s.sceneId);
    }
    need(isArr(s.sourceUnitIds) && s.sourceUnitIds.length >= 1, `${p}.sourceUnitIds 至少 1 个`);
    for (const [j, u] of (s.sourceUnitIds ?? []).entries()) {
      if (intentUnits.length) need(intentUnits.includes(u), `${p}.sourceUnitIds[${j}] 不在 intent-brief：${u}`);
    }
    for (const k of ['intent', 'event', 'attention', 'motionIntent']) {
      need(isStr(s[k]) && s[k].length >= 4, `${p}.${k} 不能为空`);
    }
    need(typeof s.staticIntent === 'boolean', `${p}.staticIntent 必须是布尔值`);
    need(isArr(s.assets) && s.assets.length >= 1, `${p}.assets 至少 1 条`);
    for (const [j, a] of (s.assets ?? []).entries()) {
      need(isStr(a.id), `${p}.assets[${j}].id 不能为空`);
      need(['final', 'placeholder', 'to-acquire'].includes(a.status), `${p}.assets[${j}].status 非法`);
      need(isStr(a.note), `${p}.assets[${j}].note 不能为空`);
    }
    need(isArr(s.notThis) && s.notThis.length >= 1, `${p}.notThis 至少 1 条`);
  }
  for (const id of blueprintIds) need(seen.has(id), `scene-intents 缺少场景 ${id}`);
}

// ---------------- Gate B：逐场景布局 + 当前版本批准 ----------------
const approvals = read('approvals.json');
const layoutDir = path.join(dir, 'scene-layouts');
const layoutFiles = fs.existsSync(layoutDir) ? fs.readdirSync(layoutDir) : [];
const latestLayout = new Map();
for (const f of layoutFiles) {
  const m = f.match(/^(.+)-v(\d+)\.(svg|png|jpe?g|webp)$/i);
  if (!m) continue;
  const sceneId = m[1];
  const version = Number(m[2]);
  if (!latestLayout.has(sceneId) || latestLayout.get(sceneId).version < version) {
    latestLayout.set(sceneId, { version, file: f });
  }
}

let gateBApproved = false;
const sceneStatus = [];
const records = approvals?.records ?? [];
if (approvals) {
  need(approvals.schemaVersion === '1.0', 'approvals.schemaVersion 必须是 "1.0"');
  need(approvals.type === 'approvals', 'approvals.type 必须是 approvals');
  need(isArr(approvals.records), 'approvals.records 必须是数组');
  for (const [i, a] of records.entries()) {
    checkApproval(a, `approvals.records[${i}]`);
    if (a.stage === 'scene-layout') {
      need(isStr(a.sceneId), `approvals.records[${i}].sceneId 不能为空`);
      need(a.sceneId === undefined || latestLayout.has(a.sceneId) || sceneStatus.some((x) => x.sceneId === a.sceneId), `approvals.records[${i}] 对应场景没有布局文件`);
    }
  }
}

const blueprintIds = (blueprint?.scenes ?? []).map((s) => s.sceneId);
for (const sceneId of blueprintIds) {
  const layout = latestLayout.get(sceneId);
  const recs = records.filter((r) => r.stage === 'scene-layout' && r.sceneId === sceneId);
  const latest = recs.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
  if (!layout) {
    sceneStatus.push({ sceneId, status: 'pending', detail: '缺少布局文件' });
    continue;
  }
  if (!latest) {
    sceneStatus.push({ sceneId, status: 'pending', detail: `布局 v${layout.version} 未确认` });
    continue;
  }
  if (latest.version < layout.version) {
    errors.push(`${sceneId} 的确认版本 v${latest.version} 早于当前布局 v${layout.version}（旧版批准不能用于新布局）`);
    sceneStatus.push({ sceneId, status: 'blocked', detail: '确认版本过期' });
    continue;
  }
  if (latest.status === 'approved' && latest.version === layout.version) {
    sceneStatus.push({ sceneId, status: 'approved', detail: `布局 v${layout.version} 已确认` });
  } else if (latest.status === 'approved-with-changes') {
    if (!(layout.version > latest.version)) {
      errors.push(`${sceneId} 状态为 approved-with-changes，但没有生成新布局版本（旧版不能当最终批准）`);
    }
    sceneStatus.push({ sceneId, status: 'blocked', detail: '要求修改，待新版本重新确认' });
  } else {
    sceneStatus.push({ sceneId, status: 'blocked', detail: `布局 v${layout.version} 状态为 ${latest.status}` });
  }
}
gateBApproved = sceneStatus.length > 0 && sceneStatus.every((s) => s.status === 'approved');
if (gateBApproved && !gateAApproved) errors.push('Gate B 已全部通过，但 Gate A 方向未确认；不能跳过方向门');

// 动画不能在 Gate B 前开始
const hasAnimation = ['scene.spec.json', '02-scene.spec.json', path.join('components', 'index.tsx')].some((f) => fs.existsSync(path.join(dir, f)));
if (hasAnimation && !gateBApproved) errors.push('Gate B 未全部通过就出现了 scene.spec / 组件文件；先逐场景确认布局，再写动画');

const text = JSON.stringify({ gate, intentsDoc, approvals });
need(!/TODO|TBD|占位符|待填写/i.test(text), '还有占位符/待填写');
need(!/<[^>]+>/.test(text.replace(/https?:\/\/[^\s"]+/g, '')), '还有尖括号占位');

if (errors.length) {
  console.error(`✗ 关键画面门未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
const approvedCount = sceneStatus.filter((s) => s.status === 'approved').length;
console.log(`✓ 关键画面门结构通过：Gate A=${gateAApproved ? 'approved' : gate?.status ?? '?'}，Gate B=${gateBApproved ? 'approved' : 'blocked'}（${approvedCount}/${blueprintIds.length} 场景当前版本已确认）`);
if (gate?.lookDev?.required && gate.lookDev.status !== 'passed') console.log('  - Gate A: 写实方向缺少 Look-dev 样稿（结构示意不能证明最终质感）');
for (const s of sceneStatus.filter((x) => x.status !== 'approved')) console.log(`  - ${s.sceneId}: ${s.detail}`);
console.log('  提示：只有“当前布局版本 + approved”才算 Gate B 通过；approved-with-changes 必须出新版本重新确认。');

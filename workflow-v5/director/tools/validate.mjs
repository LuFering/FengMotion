#!/usr/bin/env node
/**
 * 导演与视觉方向层校验器（v5，无依赖）
 *
 * 用法：
 *   node tools/validate.mjs path/to/one.json
 *   node tools/validate.mjs path/to/film-dir   # 自动校验四个产物
 *
 * 只回答：这一步有没有越权、有没有把“提案”伪装成“已确认”、有没有提前写场景规格。
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('用法：node tools/validate.mjs <file.json | film-dir>');
  process.exit(2);
}

const errors = [];
const need = (cond, msg) => {
  if (!cond) errors.push(msg);
};
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isArr = (v) => Array.isArray(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isBool = (v) => typeof v === 'boolean';

const SCENE_KEYS = ['sceneSpec', 'shotList', 'storyboard', 'componentProps', 'frames'];
const VISUAL_SPEC_KEYS = [
  'palette',
  'typography',
  'camera',
  'lens',
  'lighting',
  'shotPlan',
  'mechanism',
  'procedural',
  'acceptance',
  'durationSec',
  'aspectRatio',
  'fps',
];

function scanKeys(obj, banned, p = '$') {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => scanKeys(v, banned, `${p}[${i}]`));
    return;
  }
  if (isObj(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (banned.has(k)) errors.push(`出现越权字段：${p}.${k}`);
      scanKeys(v, banned, `${p}.${k}`);
    }
  }
}

function readJson(dir, rel, label) {
  if (!isStr(rel)) {
    errors.push(`${label} 路径缺失`);
    return null;
  }
  const fp = path.resolve(dir, rel);
  if (!fs.existsSync(fp)) {
    errors.push(`${label} 文件不存在：${rel}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    errors.push(`${label} 不是合法 JSON：${e.message}`);
    return null;
  }
}

function intentUnits(dir, rel, label) {
  const j = readJson(dir, rel, label);
  return j?.content?.units?.map((u) => u.id) ?? [];
}

function checkTopKeys(doc, allowed, type) {
  for (const k of Object.keys(doc)) {
    if (!allowed.has(k)) errors.push(`${type} 不允许的顶层字段：${k}`);
  }
}

const DECISION_KEYS = ['visualDirection', 'visualMedium', 'durationSec', 'aspectRatio', 'fps', 'audio', 'references'];

// ---------------- creative-diagnosis ----------------
function checkDiagnosis(doc, dir) {
  const allowed = new Set([
    'schemaVersion',
    'type',
    'basedOn',
    'coreExpression',
    'audienceExperience',
    'attentionHierarchy',
    'narrativeMechanism',
    'creativeProblem',
    'userConstraints',
    'unresolvedFromIntent',
    'notes',
  ]);
  checkTopKeys(doc, allowed, 'creative-diagnosis');
  scanKeys(doc, new Set([...SCENE_KEYS, ...VISUAL_SPEC_KEYS]));

  need(doc.schemaVersion === '1.0', 'diagnosis.schemaVersion 必须是 "1.0"');
  need(isStr(doc.coreExpression) && doc.coreExpression.length >= 20, 'coreExpression 必须写清核心表达（≥20 字）');
  need(isArr(doc.audienceExperience) && doc.audienceExperience.length >= 2 && doc.audienceExperience.length <= 4, 'audienceExperience 需要 2–4 条体验变化');
  for (const [i, x] of (doc.audienceExperience ?? []).entries()) need(isStr(x), `audienceExperience[${i}] 不能为空`);
  need(isArr(doc.attentionHierarchy) && doc.attentionHierarchy.length >= 2 && doc.attentionHierarchy.length <= 4, 'attentionHierarchy 需要 2–4 层注意力');
  for (const [i, x] of (doc.attentionHierarchy ?? []).entries()) need(isStr(x), `attentionHierarchy[${i}] 不能为空`);
  need(isStr(doc.narrativeMechanism) && doc.narrativeMechanism.length >= 8, 'narrativeMechanism 必须写清叙事机制');
  need(isStr(doc.creativeProblem) && doc.creativeProblem.length >= 8, 'creativeProblem 必须写清“只按字面呈现会失败在哪”');
  need(isArr(doc.userConstraints) && doc.userConstraints.length >= 1, 'userConstraints 至少 1 条（用户明确约束）');
  for (const [i, x] of (doc.userConstraints ?? []).entries()) need(isStr(x), `userConstraints[${i}] 不能为空`);
  need(isArr(doc.unresolvedFromIntent) && doc.unresolvedFromIntent.length >= 1, 'unresolvedFromIntent 至少 1 项');
  for (const [i, x] of (doc.unresolvedFromIntent ?? []).entries()) {
    need(DECISION_KEYS.includes(x), `unresolvedFromIntent[${i}] 必须是已知制作决策：${x}`);
  }

  const intent = readJson(dir, doc.basedOn?.intentBrief, 'basedOn.intentBrief');
  if (intent) {
    const unresolved = Object.entries(intent.productionDecisions ?? {})
      .filter(([, v]) => ['unresolved', 'not-provided'].includes(v?.status))
      .map(([k]) => k);
    for (const k of unresolved) {
      need((doc.unresolvedFromIntent ?? []).includes(k), `intent 中未决的 ${k} 没有进入 unresolvedFromIntent（不能在本层假装已决）`);
    }
  }
}

// ---------------- creative-directions ----------------
function checkDirections(doc, dir) {
  const allowed = new Set(['schemaVersion', 'type', 'basedOn', 'directions', 'comparison', 'notes']);
  checkTopKeys(doc, allowed, 'creative-directions');
  scanKeys(doc, new Set([...SCENE_KEYS, ...VISUAL_SPEC_KEYS]));

  need(doc.schemaVersion === '1.0', 'directions.schemaVersion 必须是 "1.0"');
  need(isArr(doc.directions) && doc.directions.length >= 2 && doc.directions.length <= 3, 'directions 需要 2–3 个方向');
  const ids = new Set();
  for (const [i, d] of (doc.directions ?? []).entries()) {
    const p = `directions[${i}]`;
    need(isStr(d.id), `${p}.id 不能为空`);
    if (isStr(d.id)) {
      need(!ids.has(d.id), `${p}.id 重复：${d.id}`);
      ids.add(d.id);
    }
    need(d.status === 'candidate', `${p}.status 必须是 candidate（选择结果在 direction-decision 里）`);
    for (const k of ['title', 'creativeThesis', 'firstImpression', 'method', 'spaceModel', 'primaryFocus', 'textRole', 'materialDirection', 'whyDistinct']) {
      need(isStr(d[k]), `${p}.${k} 不能为空`);
    }
    need(isArr(d.motionGrammar) && d.motionGrammar.length >= 2, `${p}.motionGrammar 至少 2 条`);
    need(isArr(d.contentMapping) && d.contentMapping.length >= 1, `${p}.contentMapping 至少 1 条`);
    for (const [j, m] of (d.contentMapping ?? []).entries()) {
      need(isStr(m.sourceUnitId), `${p}.contentMapping[${j}].sourceUnitId 不能为空`);
      need(isStr(m.visualPurpose) && m.visualPurpose.length >= 4, `${p}.contentMapping[${j}].visualPurpose 不能为空`);
    }
    need(isArr(d.candidateMediums) && d.candidateMediums.length >= 1, `${p}.candidateMediums 至少 1 个候选`);
    need(isBool(d.requiresAssetValidation), `${p}.requiresAssetValidation 必须是布尔值`);
    need(isArr(d.knownRisks) && d.knownRisks.length >= 1, `${p}.knownRisks 至少 1 条`);
    need(isArr(d.avoidTemplates) && d.avoidTemplates.length >= 1, `${p}.avoidTemplates 至少 1 条`);
  }

  // 内容映射必须覆盖 intent 的所有 unit，且每个 unit 只出现一次
  const units = intentUnits(dir, doc.basedOn?.intentBrief, 'basedOn.intentBrief');
  if (units.length) {
    for (const [i, d] of (doc.directions ?? []).entries()) {
      const mapped = (d.contentMapping ?? []).map((m) => m.sourceUnitId);
      for (const u of units) need(mapped.includes(u), `directions[${i}] 没有映射 ${u}`);
      need(new Set(mapped).size === mapped.length, `directions[${i}].contentMapping 有重复 unit`);
    }
  }

  // 差异规则：5 个维度里至少 3 个不同（不能只换颜色/字体/形容词）
  const dims = ['method', 'spaceModel', 'primaryFocus', 'textRole', 'materialDirection'];
  const motion = (d) => (d.motionGrammar ?? []).map(String).sort().join('|');
  for (let i = 0; i < (doc.directions ?? []).length; i++) {
    for (let j = i + 1; j < (doc.directions ?? []).length; j++) {
      const a = doc.directions[i];
      const b = doc.directions[j];
      let diff = dims.filter((k) => a[k] !== b[k]).length;
      if (motion(a) !== motion(b)) diff += 1;
      need(diff >= 3, `${a.id} 与 ${b.id} 差异不足（5 维中仅 ${diff} 维不同）；不能只靠颜色/字体/形容词制造方向差异`);
    }
  }

  need(isArr(doc.comparison) && doc.comparison.length >= 4, 'comparison 至少 4 个比较维度');
  for (const [i, row] of (doc.comparison ?? []).entries()) {
    need(isStr(row.dimension), `comparison[${i}].dimension 不能为空`);
    need(isObj(row.values), `comparison[${i}].values 必须是对象`);
    for (const id of ids) need(isStr(row.values?.[id]), `comparison[${i}] 缺少方向 ${id} 的值`);
  }
}

// ---------------- direction-decision ----------------
function checkDecision(doc, dir) {
  const allowed = new Set([
    'schemaVersion',
    'type',
    'basedOn',
    'mode',
    'status',
    'recommendedDirectionId',
    'rationale',
    'criteria',
    'alternatives',
    'unselectedReasons',
    'confirmation',
    'notes',
  ]);
  checkTopKeys(doc, allowed, 'direction-decision');
  scanKeys(doc, new Set([...SCENE_KEYS, ...VISUAL_SPEC_KEYS, 'score', 'scores', 'points', 'percentage']));

  need(doc.schemaVersion === '1.0', 'decision.schemaVersion 必须是 "1.0"');
  need(['collaborative', 'autopilot'].includes(doc.mode), 'mode 必须是 collaborative/autopilot');
  need(['recommended', 'confirmed'].includes(doc.status), 'status 必须是 recommended/confirmed');

  const directions = readJson(dir, doc.basedOn?.directions, 'basedOn.directions');
  const ids = (directions?.directions ?? []).map((d) => d.id);
  need(isStr(doc.recommendedDirectionId) && ids.includes(doc.recommendedDirectionId), 'recommendedDirectionId 必须指向已有方向');

  need(isArr(doc.rationale) && doc.rationale.length >= 2, 'rationale 至少 2 条理由');
  for (const [i, x] of (doc.rationale ?? []).entries()) need(isStr(x), `rationale[${i}] 不能为空`);

  const requiredCriteria = ['contentFit', 'distinctiveness', 'implementability', 'assetRisk', 'recognizability'];
  need(isArr(doc.criteria) && doc.criteria.length >= 5, 'criteria 至少 5 个维度');
  for (const [i, c] of (doc.criteria ?? []).entries()) {
    need(requiredCriteria.includes(c.dimension), `criteria[${i}].dimension 非法：${c.dimension}`);
    need(isObj(c.assessments), `criteria[${i}].assessments 必须是对象`);
    for (const id of ids) {
      const a = c.assessments?.[id];
      need(isObj(a), `criteria[${i}] 缺少 ${id} 的评估`);
      if (isObj(a)) {
        need(['strong', 'workable', 'weak'].includes(a.level), `criteria[${i}].${id}.level 必须是 strong/workable/weak`);
        need(isStr(a.evidence) && a.evidence.length >= 4, `criteria[${i}].${id}.evidence 必须写理由`);
      }
    }
  }
  const rec = (doc.criteria ?? []).filter((c) => c.assessments?.[doc.recommendedDirectionId]?.level === 'strong').length;
  need(rec >= 3, `推荐方向至少要有 3 个维度评为 strong（当前 ${rec}）`);

  need(isArr(doc.alternatives), 'alternatives 必须是数组');
  for (const [i, id] of (doc.alternatives ?? []).entries()) {
    need(ids.includes(id), `alternatives[${i}] 指向不存在的方向：${id}`);
    need(id !== doc.recommendedDirectionId, `alternatives[${i}] 不能是推荐方向`);
    need(isStr(doc.unselectedReasons?.[id]), `unselectedReasons 缺少 ${id} 的理由`);
  }

  if (doc.status === 'recommended') {
    need(doc.confirmation === null || doc.confirmation === undefined, 'status=recommended 时不能写 confirmation（推荐不等于确认）');
  } else {
    need(isObj(doc.confirmation), 'status=confirmed 时必须写 confirmation');
    need(['user', 'autopilot'].includes(doc.confirmation?.by), 'confirmation.by 必须是 user/autopilot');
    need(isStr(doc.confirmation?.note), 'confirmation.note 不能为空');
    if (doc.mode === 'collaborative') need(doc.confirmation?.by === 'user', '协作模式必须由 user 确认');
    if (doc.mode === 'autopilot') need(doc.confirmation?.by === 'autopilot', '自动模式由 autopilot 记录确认');
  }
}

// ---------------- visual-direction ----------------
function checkVisual(doc, dir) {
  const allowed = new Set([
    'schemaVersion',
    'type',
    'directionId',
    'status',
    'basedOn',
    'creativeThesis',
    'visualGrammar',
    'contentMapping',
    'feasibility',
    'visualSystem',
    'decisions',
    'heroFrameBrief',
    'handoff',
    'confirmation',
    'notes',
  ]);
  checkTopKeys(doc, allowed, 'visual-direction');
  scanKeys(doc, new Set([...SCENE_KEYS]));

  need(doc.schemaVersion === '1.0', 'visual.schemaVersion 必须是 "1.0"');
  need(['proposed', 'approved'].includes(doc.status), 'visual.status 必须是 proposed/approved');

  const decision = readJson(dir, doc.basedOn?.decision, 'basedOn.decision');
  const directions = readJson(dir, doc.basedOn?.directions, 'basedOn.directions');
  const ids = (directions?.directions ?? []).map((d) => d.id);
  need(ids.includes(doc.directionId), 'directionId 必须指向已有方向');
  if (decision) {
    need(doc.directionId === decision.recommendedDirectionId, 'directionId 必须等于 direction-decision.recommendedDirectionId');
  }

  const thesis = doc.creativeThesis ?? {};
  need(isStr(thesis.premise) && thesis.premise.length >= 10, 'creativeThesis.premise 必须写清创作命题');
  need(isArr(thesis.viewerExperience) && thesis.viewerExperience.length >= 2, 'creativeThesis.viewerExperience 至少 2 条');
  for (const [i, x] of (thesis.viewerExperience ?? []).entries()) need(isStr(x), `creativeThesis.viewerExperience[${i}] 不能为空`);

  const vg = doc.visualGrammar ?? {};
  for (const k of ['spaceModel', 'primaryFocus', 'depthModel', 'textRole', 'materialDirection', 'transitionPrinciple']) {
    need(isStr(vg[k]), `visualGrammar.${k} 不能为空`);
  }
  need(isArr(vg.paletteLogic) && vg.paletteLogic.length >= 1, 'visualGrammar.paletteLogic 至少 1 条（方向，不是最终色值）');
  need(isArr(vg.motionPrinciples) && vg.motionPrinciples.length >= 2, 'visualGrammar.motionPrinciples 至少 2 条');

  const units = intentUnits(dir, doc.basedOn?.intentBrief, 'basedOn.intentBrief');
  const mapped = (doc.contentMapping ?? []).map((m) => m.sourceUnitId);
  for (const u of units) need(mapped.includes(u), `contentMapping 缺少 ${u}`);
  need(new Set(mapped).size === mapped.length, 'contentMapping 有重复 unit');
  for (const [i, m] of (doc.contentMapping ?? []).entries()) {
    need(isStr(m.sourceUnitId), `contentMapping[${i}].sourceUnitId 不能为空`);
    need(isStr(m.visualPurpose) && m.visualPurpose.length >= 4, `contentMapping[${i}].visualPurpose 不能为空`);
  }

  const feas = doc.feasibility ?? {};
  need(isArr(feas.candidateMediums) && feas.candidateMediums.length >= 1, 'feasibility.candidateMediums 至少 1 个候选媒介');
  need(isBool(feas.requiresAssetValidation), 'feasibility.requiresAssetValidation 必须是布尔值');
  need(isArr(feas.knownRisks) && feas.knownRisks.length >= 1, 'feasibility.knownRisks 至少 1 条');

  const systemKeys = ['composition', 'palette', 'typography', 'materiality', 'depth', 'motionGrammar', 'transitions'];
  const vs = doc.visualSystem ?? {};
  for (const k of systemKeys) {
    const item = vs[k];
    need(isObj(item), `visualSystem.${k} 必须是对象`);
    if (isObj(item)) {
      need(isStr(item.principle) && item.principle.length >= 6, `visualSystem.${k}.principle 不能为空`);
      need(isBool(item.holdsDuringMotion), `visualSystem.${k}.holdsDuringMotion 必须是布尔值`);
    }
  }

  const decisions = doc.decisions ?? {};
  for (const k of ['durationSec', 'aspectRatio', 'fps', 'audio', 'sceneTimeline', 'componentContracts']) {
    const v = decisions[k];
    need(v === 'unresolved' || v === 'not-designed', `decisions.${k} 只能是 unresolved/not-designed（不能在方向层写死）`);
  }

  need(isStr(doc.heroFrameBrief), 'heroFrameBrief 必须写关键画面 brief 的路径');
  if (isStr(doc.heroFrameBrief)) {
    need(fs.existsSync(path.resolve(dir, doc.heroFrameBrief)), `heroFrameBrief 文件不存在：${doc.heroFrameBrief}`);
  }

  const h = doc.handoff ?? {};
  need(isStr(h.nextStage), 'handoff.nextStage 不能为空');
  need(isStr(h.instruction) && h.instruction.length >= 10, 'handoff.instruction 不能为空');
  need(isArr(h.requiredOutput) && h.requiredOutput.length >= 1, 'handoff.requiredOutput 至少 1 项');

  if (doc.status === 'proposed') {
    need(h.nextStage === 'hero-frame', 'status=proposed 时 handoff.nextStage 必须是 hero-frame（不能直接进动画设计）');
    need(doc.confirmation === null || doc.confirmation === undefined, 'status=proposed 时不能写 confirmation');
  } else {
    need(isObj(doc.confirmation), 'status=approved 时必须写 confirmation');
    need(['user', 'autopilot'].includes(doc.confirmation?.by), 'visual confirmation.by 必须是 user/autopilot');
    need(isStr(doc.confirmation?.note), 'visual confirmation.note 不能为空');
    need(h.nextStage === 'animation-design', 'status=approved 时 handoff.nextStage 必须是 animation-design');
    if (decision) {
      need(decision.status === 'confirmed', '视觉方向 approved 之前，direction-decision 必须已 confirmed');
      if (decision.mode === 'collaborative') need(doc.confirmation?.by === 'user', '协作模式视觉确认必须由 user 确认');
      if (decision.mode === 'autopilot') need(doc.confirmation?.by === 'autopilot', '自动模式视觉确认由 autopilot 记录');
    }
  }
}

// ---------------- run ----------------
function validateOne(file) {
  const before = errors.length;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`${path.basename(file)} 不是合法 JSON：${e.message}`);
    return;
  }
  const dir = path.dirname(file);
  if (doc.type === 'creative-diagnosis') checkDiagnosis(doc, dir);
  else if (doc.type === 'creative-directions') checkDirections(doc, dir);
  else if (doc.type === 'direction-decision') checkDecision(doc, dir);
  else if (doc.type === 'visual-direction') checkVisual(doc, dir);
  else errors.push(`${path.basename(file)} 未知 type：${doc.type}`);
  const n = errors.length - before;
  console.log(`${n === 0 ? '✓' : '✗'} ${path.basename(file)}${n ? `（${n} 项）` : ''}`);
}

const abs = path.resolve(process.cwd(), target);
if (!fs.existsSync(abs)) {
  console.error(`路径不存在：${target}`);
  process.exit(2);
}
const st = fs.statSync(abs);
if (st.isDirectory()) {
  const names = ['creative-diagnosis.json', 'creative-directions.json', 'direction-decision.json', 'visual-direction.json'];
  for (const n of names) {
    const f = path.join(abs, n);
    if (!fs.existsSync(f)) errors.push(`目录缺少 ${n}`);
    else validateOne(f);
  }
} else {
  validateOne(abs);
}

const text = JSON.stringify(errors);
need(!/TODO|TBD|占位符|待补充/i.test(text), '输出里还有占位符/待定');

if (errors.length) {
  console.error(`\n✗ 导演/视觉方向层未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\n✓ 导演/视觉方向层通过：方向差异、决策状态、关键画面交接均符合边界。');

#!/usr/bin/env node
/**
 * 动画设计层校验器（v5，无依赖）
 *
 * 用法：node tools/validate-animation.mjs examples/<film>
 *
 * 回答四道门：
 * 1 创意完整性：每场有目的、事件、原文来源；
 * 2 运动完整性：有初始/触发/进程/结束与依赖；
 * 3 实现可行性：组件/资产状态真实，candidate 不能当 available；
 * 4 交接验收：scene.spec 与蓝图、实现计划、设计审查一致，未确认不得进执行层。
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('用法：node tools/validate-animation.mjs <film-dir> [--profile creative|strict]');
  process.exit(2);
}
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
const profile = profileArg ? profileArg.split('=')[1] : 'creative';
if (!['creative', 'strict'].includes(profile)) {
  console.error('--profile 必须是 creative 或 strict');
  process.exit(2);
}
const strict = profile === 'strict';
const dir = path.resolve(process.cwd(), target);
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`目录不存在：${target}`);
  process.exit(2);
}

const errors = [];
const warnings = [];
const need = (cond, msg) => {
  if (!cond) errors.push(msg);
};
// 创作配额默认只警告；strict 才失败。技术错误仍走 need()
const soft = (cond, msg) => {
  if (!cond) (strict ? errors : warnings).push(msg);
};
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isArr = (v) => Array.isArray(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);

const readJson = (name) => {
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

const blueprint = readJson('animation-blueprint.json');
const implementation = readJson('implementation-plan.json');
const specFile = fs.existsSync(path.join(dir, 'scene.spec.json')) ? 'scene.spec.json' : 'scene.spec.draft.json';
const spec = fs.existsSync(path.join(dir, specFile)) ? readJson(specFile) : null;
if (!spec) errors.push('缺少 scene.spec.json / scene.spec.draft.json');
const review = readJson('design-review.json');

const BLUEPRINT_SCENE_KEYS = new Set([
  'sceneId',
  'sourceUnitIds',
  'intent',
  'event',
  'motionIntent',
  'timing',
  'layers',
  'dependencies',
  'assetRequirements',
  'acceptance',
  'staticIntent',
]);
const SPEC_KEYS = ['sceneId', 'component', 'props', 'from', 'durationInFrames', 'eventFrames', 'heroFrame', 'motion', 'motionPlan', 'motionCheckFrames', 'acceptanceFrames', 'assetStrategy', 'layers', 'eventWindows', 'shotId', 'eventIds', 'stateIn', 'stateOut', 'continuityIn', 'continuityOut'];

// ---------------- 蓝图 ----------------
let directionConfirmed = false;
let blueprintScenes = [];
let intentUnits = [];
if (blueprint) {
  need(blueprint.schemaVersion === '1.0', 'blueprint.schemaVersion 必须是 "1.0"');
  need(blueprint.type === 'animation-blueprint', 'blueprint.type 必须是 animation-blueprint');
  need(['draft', 'approved'].includes(blueprint.status), 'blueprint.status 必须是 draft/approved');
  need(isStr(blueprint.filmId), 'blueprint.filmId 不能为空');
  need(isStr(blueprint.directionId), 'blueprint.directionId 不能为空');
  for (const k of ['intentBrief', 'visualDirection', 'referenceDecision', 'directionGate']) {
    const p = blueprint.basedOn?.[k];
    need(isStr(p), `blueprint.basedOn.${k} 不能为空`);
    if (isStr(p)) need(fs.existsSync(path.resolve(dir, p)), `blueprint.basedOn.${k} 不存在：${p}`);
  }
  intentUnits = [];
  if (isStr(blueprint.basedOn?.intentBrief)) {
    const ip = path.resolve(dir, blueprint.basedOn.intentBrief);
    if (fs.existsSync(ip)) {
      try {
        const ib = JSON.parse(fs.readFileSync(ip, 'utf8'));
        intentUnits = (ib.content?.units ?? []).map((u) => u.id);
      } catch {}
    }
  }
  if (isStr(blueprint.basedOn?.directionGate)) {
    const p = path.resolve(dir, blueprint.basedOn.directionGate);
    if (fs.existsSync(p)) {
      try {
        const gate = JSON.parse(fs.readFileSync(p, 'utf8'));
        directionConfirmed = gate.status === 'confirmed';
      } catch {}
    }
  }
  if (!directionConfirmed) need(blueprint.status === 'draft', 'Gate A 方向未确认时，blueprint.status 必须是 draft');
  else need(blueprint.status === 'approved', 'Gate A 已确认时，blueprint.status 应为 approved');

  const tp = blueprint.timingPolicy ?? {};
  need(typeof tp.durationCandidateSec === 'number' && tp.durationCandidateSec > 0, 'timingPolicy.durationCandidateSec 必须是正数');
  need(['proposed', 'confirmed'].includes(tp.status), 'timingPolicy.status 必须是 proposed/confirmed');
  need(['sequential', 'overlapping'].includes(tp.overlapPolicy ?? 'sequential'), 'timingPolicy.overlapPolicy 必须是 sequential/overlapping');
  need(tp.fps === null || isInt(tp.fps), 'timingPolicy.fps 必须是 null 或整数（蓝图不写死帧率）');
  if (tp.status === 'confirmed') need(isInt(tp.fps), 'timingPolicy.status=confirmed 时必须确认 fps');
  need(isStr(tp.note), 'timingPolicy.note 不能为空');

  blueprintScenes = blueprint.scenes ?? [];
  need(isArr(blueprintScenes) && blueprintScenes.length >= 1, 'blueprint.scenes 至少 1 场');
  soft(blueprintScenes.length <= 12, '场景数量超过 12；这是建议不是硬门禁，可用 --profile=strict 检查');
  const sceneIds = new Set();
  let sumDur = 0;
  for (const [i, s] of blueprintScenes.entries()) {
    const p = `scenes[${i}](${s.sceneId ?? '?'})`;
    need(isStr(s.sceneId), `${p}.sceneId 不能为空`);
    if (isStr(s.sceneId)) {
      need(!sceneIds.has(s.sceneId), `${p}.sceneId 重复`);
      sceneIds.add(s.sceneId);
    }
    need(isArr(s.sourceUnitIds) && s.sourceUnitIds.length >= 1, `${p}.sourceUnitIds 至少 1 个`);
    need(typeof s.staticIntent === 'boolean', `${p}.staticIntent 必须是布尔值（静止/阅读场景显式声明）`);
    const isStatic = s.staticIntent === true;
    for (const [j, u] of (s.sourceUnitIds ?? []).entries()) {
      if (intentUnits.length) need(intentUnits.includes(u), `${p}.sourceUnitIds[${j}] 不在 intent-brief：${u}`);
    }
    need(isStr(s.intent) && s.intent.length >= 8, `${p}.intent 必须写清这一场为什么存在`);
    const e = s.event ?? {};
    need(isStr(e.type), `${p}.event.type 不能为空`);
    need(isStr(e.target), `${p}.event.target 不能为空`);
    need(isStr(e.initialState) && e.initialState.length >= 4, `${p}.event.initialState 不能为空`);
    need(isStr(e.trigger) && e.trigger.length >= 4, `${p}.event.trigger 不能为空`);
    if (isStatic) need(isArr(e.progression) && e.progression.length >= 1, `${p}.event.progression 静止场景至少 1 条说明`);
    else {
      need(isArr(e.progression) && e.progression.length >= 1, `${p}.event.progression 必须是数组`);
      soft(e.progression.length >= 2 && e.progression.length <= 4, `${p}.event.progression 建议 2–4 个可观察阶段（动态事件，非硬门禁）`);
    }
    for (const [j, x] of (e.progression ?? []).entries()) need(isStr(x), `${p}.event.progression[${j}] 不能为空`);
    need(isStr(e.finalState) && e.finalState.length >= 4, `${p}.event.finalState 不能为空`);
    if (!isStatic) need(e.initialState !== e.finalState, `${p}.event.initialState 与 finalState 不能相同（动态事件必须有变化）`);
    need(isArr(e.failureConditions) && e.failureConditions.length >= 1, `${p}.event.failureConditions 至少 1 条（什么算没实现）`);
    const mi = s.motionIntent ?? {};
    need(isStr(mi.purpose) && mi.purpose.length >= 4, `${p}.motionIntent.purpose 不能为空`);
    need(['primary', 'secondary'].includes(mi.priority), `${p}.motionIntent.priority 非法`);
    if (!isStatic) {
      need(isArr(mi.motionCandidates), `${p}.motionIntent.motionCandidates 必须是数组`);
      soft(mi.motionCandidates.length >= 1, `${p}.motionIntent.motionCandidates 建议至少 1 个候选机制（动态事件，非硬门禁）`);
    }
    else need(isArr(mi.motionCandidates), `${p}.motionIntent.motionCandidates 必须是数组`);
    need(['pending-implementation-review', 'not-applicable'].includes(mi.selectionStatus), `${p}.motionIntent.selectionStatus 非法`);
    if (!isStatic) need(mi.selectionStatus === 'pending-implementation-review', `${p}.motionIntent.selectionStatus 必须是 pending-implementation-review（蓝图不锁实现）`);

    const tm = s.timing ?? {};
    need(isInt(tm.relativeOrder) && tm.relativeOrder >= 1, `${p}.timing.relativeOrder 必须是 >=1 的整数`);
    for (const k of ['durationCandidateSec', 'eventDurationCandidateSec', 'holdDurationCandidateSec']) {
      need(typeof tm[k] === 'number' && tm[k] >= 0, `${p}.timing.${k} 必须是非负数`);
    }
    need(tm.status === 'proposed', `${p}.timing.status 必须是 proposed（蓝图只给候选时间）`);
    if (typeof tm.eventDurationCandidateSec === 'number' && typeof tm.holdDurationCandidateSec === 'number' && typeof tm.durationCandidateSec === 'number') {
      need(tm.eventDurationCandidateSec + tm.holdDurationCandidateSec <= tm.durationCandidateSec + 0.01, `${p}.timing 事件+停留不能超过场景时长`);
      sumDur += tm.durationCandidateSec;
    }
    need(isArr(s.layers) && s.layers.length >= 1, `${p}.layers 至少 1 层`);
    need(isArr(s.dependencies), `${p}.dependencies 必须是数组`);
    for (const [j, d] of (s.dependencies ?? []).entries()) {
      need(isStr(d.type), `${p}.dependencies[${j}].type 不能为空`);
      need(isStr(d.from) && sceneIds.has(d.from), `${p}.dependencies[${j}].from 必须指向已有场景`);
      need(d.from !== s.sceneId, `${p}.dependencies[${j}] 不能依赖自己`);
      need(isStr(d.note) && d.note.length >= 4, `${p}.dependencies[${j}].note 不能为空`);
    }
    need(isArr(s.assetRequirements) && s.assetRequirements.length >= 1, `${p}.assetRequirements 至少 1 条`);
    for (const [j, a] of (s.assetRequirements ?? []).entries()) {
      need(isStr(a.role), `${p}.assetRequirements[${j}].role 不能为空`);
      need(['available', 'candidate', 'missing'].includes(a.status), `${p}.assetRequirements[${j}].status 非法`);
      need(isStr(a.note), `${p}.assetRequirements[${j}].note 不能为空`);
    }
    need(isArr(s.acceptance) && s.acceptance.length >= 1, `${p}.acceptance 至少 1 条可观察条件`);
    soft(s.acceptance.length >= 2 && s.acceptance.length <= 4, `${p}.acceptance 建议 2–4 条（非硬门禁）`);
    for (const [j, a] of (s.acceptance ?? []).entries()) {
      need(isStr(a) && a.length >= 6, `${p}.acceptance[${j}] 不能为空`);
      need(!/高级感|沉浸感|氛围感|电影感|好看/.test(a), `${p}.acceptance[${j}] 是不可验证的形容词，改成可观察状态`);
    }
    for (const k of Object.keys(s)) {
      if (!BLUEPRINT_SCENE_KEYS.has(k)) errors.push(`${p} 不允许的字段：${k}（蓝图不写组件/帧数/执行规格）`);
    }
  }
  if ((tp.overlapPolicy ?? 'sequential') === 'sequential' && typeof tp.durationCandidateSec === 'number' && Math.abs(sumDur - tp.durationCandidateSec) > 0.51) {
    soft(false, `顺序模式下各场候选时长合计 ${sumDur}s 与 timingPolicy ${tp.durationCandidateSec}s 不一致；重叠/并行模式请声明 overlapPolicy（默认只警告）`);
  }
}

// ---------------- 实现计划 ----------------
let implementationBlocked = false;
let componentStatus = new Map();
let assetStatus = new Map();
if (implementation) {
  need(implementation.schemaVersion === '1.0', 'implementation.schemaVersion 必须是 "1.0"');
  need(implementation.type === 'implementation-plan', 'implementation.type 必须是 implementation-plan');
  need(['draft', 'approved'].includes(implementation.status), 'implementation.status 必须是 draft/approved');
  need(implementation.basedOn === 'animation-blueprint.json', 'implementation.basedOn 必须指向 animation-blueprint.json');
  const tc = implementation.timingCompile ?? {};
  need(isInt(tc.fps) && tc.fps > 0, 'timingCompile.fps 必须是正整数');
  need(typeof tc.durationSec === 'number' && tc.durationSec > 0, 'timingCompile.durationSec 必须是正数');
  need(isInt(tc.totalFrames), 'timingCompile.totalFrames 必须是整数');
  if (isInt(tc.fps) && typeof tc.durationSec === 'number' && isInt(tc.totalFrames)) {
    need(tc.totalFrames === Math.round(tc.durationSec * tc.fps), 'totalFrames 必须等于 round(durationSec*fps)');
  }
  need(['proposed', 'confirmed'].includes(tc.status), 'timingCompile.status 非法');

  need(isArr(implementation.assets), 'implementation.assets 必须是数组');
  for (const [i, a] of (implementation.assets ?? []).entries()) {
    need(isStr(a.id), `assets[${i}].id 不能为空`);
    need(['available', 'candidate', 'missing'].includes(a.status), `assets[${i}].status 非法`);
    need(isStr(a.note), `assets[${i}].note 不能为空`);
    if (isStr(a.id)) assetStatus.set(a.id, a.status);
  }
  need(isArr(implementation.components), 'implementation.components 必须是数组');
  for (const [i, c] of (implementation.components ?? []).entries()) {
    need(isStr(c.id), `components[${i}].id 不能为空`);
    need(['available', 'candidate', 'missing'].includes(c.status), `components[${i}].status 非法`);
    need(isStr(c.purpose) && c.purpose.length >= 4, `components[${i}].purpose 不能为空`);
    need(isStr(c.source), `components[${i}].source 不能为空`);
    need(isStr(c.verification) && c.verification.length >= 4, `components[${i}].verification 不能为空`);
    if (isStr(c.id)) componentStatus.set(c.id, c.status);
  }
  need(isArr(implementation.mechanisms), 'implementation.mechanisms 必须是数组');
  for (const [i, m] of (implementation.mechanisms ?? []).entries()) {
    need(isStr(m.sceneId), `mechanisms[${i}].sceneId 不能为空`);
    need(isStr(m.selected), `mechanisms[${i}].selected 不能为空`);
    need(isArr(m.candidates) && m.candidates.length >= 1, `mechanisms[${i}].candidates 至少 1 个`);
    need(isStr(m.reason) && m.reason.length >= 4, `mechanisms[${i}].reason 不能为空`);
    need(isStr(m.risk) && m.risk.length >= 4, `mechanisms[${i}].risk 不能为空`);
  }
  need(isArr(implementation.sceneMap), 'implementation.sceneMap 必须是数组');
  const mapped = new Set();
  for (const [i, m] of (implementation.sceneMap ?? []).entries()) {
    need(isStr(m.sceneId) && blueprintScenes.some((s) => s.sceneId === m.sceneId), `sceneMap[${i}].sceneId 不在 blueprint`);
    mapped.add(m.sceneId);
    need(isStr(m.component) && componentStatus.has(m.component), `sceneMap[${i}].component 不在 components`);
    need(isStr(m.mechanism), `sceneMap[${i}].mechanism 不能为空`);
    for (const a of m.assetIds ?? []) need(assetStatus.has(a), `sceneMap[${i}].assetIds 含未知资产：${a}`);
  }
  for (const s of blueprintScenes) need(mapped.has(s.sceneId), `sceneMap 缺少场景 ${s.sceneId}`);

  const mappedComponents = (implementation.sceneMap ?? []).map((m) => componentStatus.get(m.component));
  const mappedAssets = (implementation.sceneMap ?? []).flatMap((m) => (m.assetIds ?? []).map((a) => assetStatus.get(a)));
  implementationBlocked = mappedComponents.some((s) => s !== 'available') || mappedAssets.some((s) => s !== 'available');
  need(fs.existsSync(path.join(dir, 'component-contracts.md')), '缺少 component-contracts.md（组件合同）');
}

// ---------------- scene.spec ----------------
if (spec) {
  need(spec.schemaVersion === 1, 'scene.spec.schemaVersion 必须是数字 1（与 v3 执行契约一致）');
  need(spec.type === 'scene-spec', 'scene.spec.type 必须是 scene-spec');
  need(['draft', 'approved'].includes(spec.status), 'scene.spec.status 必须是 draft/approved');
  need(isStr(spec.filmId), 'scene.spec.filmId 不能为空');
  need(isInt(spec.fps) && spec.fps > 0, 'scene.spec.fps 必须是正整数');
  need(isInt(spec.width) && spec.width > 0, 'scene.spec.width 必须是正整数');
  need(isInt(spec.height) && spec.height > 0, 'scene.spec.height 必须是正整数');
  need(isInt(spec.durationInFrames) && spec.durationInFrames > 0, 'scene.spec.durationInFrames 必须是正整数');
  need(isArr(spec.scenes) && spec.scenes.length === blueprintScenes.length, 'scene.spec.scenes 数量必须与 blueprint 一致');
  const timelinePolicy = spec.timelinePolicy ?? 'contiguous';
  need(['contiguous', 'explicit'].includes(timelinePolicy), 'scene.spec.timelinePolicy 必须是 contiguous/explicit');

  const ids = new Set(blueprintScenes.map((s) => s.sceneId));
  const seen = new Set();
  let prevEnd = 0;
  for (const [i, s] of (spec.scenes ?? []).entries()) {
    const p = `scene.spec.scenes[${i}](${s.sceneId ?? '?'})`;
    need(isStr(s.sceneId) && ids.has(s.sceneId), `${p}.sceneId 不在 blueprint`);
    if (isStr(s.sceneId)) {
      need(!seen.has(s.sceneId), `${p}.sceneId 重复`);
      seen.add(s.sceneId);
    }
    need(isInt(s.from) && s.from >= 0, `${p}.from 必须是 >=0 的整数`);
    need(isInt(s.durationInFrames) && s.durationInFrames > 0, `${p}.durationInFrames 必须是正整数`);
    const bpScene = blueprintScenes.find((x) => x.sceneId === s.sceneId);
    const isStatic = bpScene?.staticIntent === true;
    if (isInt(s.from)) {
      if (timelinePolicy === 'contiguous') need(s.from === prevEnd, `${p}.from 必须等于上一场结束帧（contiguous 不能留空白或重叠；重叠请声明 timelinePolicy=explicit）`);
      if (isInt(s.durationInFrames)) prevEnd = Math.max(prevEnd, s.from + s.durationInFrames);
    }
    const windows = [];
    if (isArr(s.eventFrames)) windows.push(s.eventFrames);
    if (isArr(s.eventWindows)) windows.push(...s.eventWindows);
    if (!isStatic) need(windows.length >= 1, `${p} 动态场景需要 eventFrames 或 eventWindows`);
    for (const [j, w] of windows.entries()) {
      need(isArr(w) && w.length === 2 && isInt(w[0]) && isInt(w[1]) && w[0] <= w[1], `${p}.eventWindows[${j}] 必须是 [start,end]`);
      if (isArr(w) && isInt(s.from) && isInt(s.durationInFrames)) {
        need(w[0] >= s.from && w[1] <= s.from + s.durationInFrames - 1, `${p}.eventWindows[${j}] 必须落在场景可见帧内`);
      }
    }
    const inAnyWindow = (a, b) => windows.some(([x, y]) => a >= x && b <= y);
    need(isInt(s.heroFrame) && isInt(s.from) && isInt(s.durationInFrames) && s.heroFrame >= s.from && s.heroFrame < s.from + s.durationInFrames, `${p}.heroFrame 必须落在场景可见区间`);
    need(isStr(s.component) && componentStatus.has(s.component), `${p}.component 不在 implementation.components`);
    need(isObj(s.props), `${p}.props 必须是对象`);
    if (isStatic) need(s.motion === undefined || isArr(s.motion), `${p}.motion 必须是数组（静止场景可为空/省略）`);
    else need(isArr(s.motion) && s.motion.length >= 1, `${p}.motion 至少 1 项（动态场景）`);
    if (isStatic) {
      need(s.motionPlan === undefined || isArr(s.motionPlan), `${p}.motionPlan 必须是数组（静止场景可为空/省略）`);
    } else {
      need(isArr(s.motionPlan) && s.motionPlan.length >= 1, `${p}.motionPlan 至少 1 条（动态场景要写清状态变化）`);
    }
    for (const [j, m] of (s.motionPlan ?? []).entries()) {
      need(isObj(m), `${p}.motionPlan[${j}] 必须是对象`);
      if (!isObj(m)) continue;
      need(isStr(m.target) && (s.layers ?? []).includes(m.target), `${p}.motionPlan[${j}].target 必须在 layers 中`);
      need(isStr(m.from) && isStr(m.to), `${p}.motionPlan[${j}] 必须写 from/to 状态`);
      need(isInt(m.start) && isInt(m.end) && m.start <= m.end, `${p}.motionPlan[${j}] start/end 必须是整数且 start<=end`);
      if (isInt(m.start) && isInt(m.end) && windows.length > 0) {
        need(inAnyWindow(m.start, m.end), `${p}.motionPlan[${j}] 必须落在某个 eventFrames/eventWindows 内`);
      }
      need(isStr(m.easing), `${p}.motionPlan[${j}].easing 不能为空`);
      need(isArr(m.dependsOn), `${p}.motionPlan[${j}].dependsOn 必须是数组`);
    }
    if (isStatic) need(s.motionCheckFrames === undefined || isArr(s.motionCheckFrames), `${p}.motionCheckFrames 必须是数组（静止场景可为空/省略）`);
    else need(isArr(s.motionCheckFrames) && s.motionCheckFrames.length >= 2, `${p}.motionCheckFrames 至少 2 帧（动态场景）`);
    if (isArr(s.motionCheckFrames)) {
      for (const [j, f] of s.motionCheckFrames.entries()) {
        if (windows.length > 0) need(isInt(f) && windows.some(([a, b]) => f >= a && f <= b), `${p}.motionCheckFrames[${j}] 必须在 eventFrames/eventWindows 内`);
      }
    }
    need(isArr(s.acceptanceFrames) && s.acceptanceFrames.length >= (isStatic ? 1 : 2), `${p}.acceptanceFrames 至少 ${isStatic ? 1 : 2} 帧`);
    if (isArr(s.acceptanceFrames) && isInt(s.from) && isInt(s.durationInFrames)) {
      for (const [j, f] of s.acceptanceFrames.entries()) {
        need(isInt(f) && f >= s.from && f < s.from + s.durationInFrames, `${p}.acceptanceFrames[${j}] 必须在场景可见区间内（含保持段）`);
      }
    }
    if (s.shotId !== undefined) need(isStr(s.shotId), `${p}.shotId 必须是非空字符串`);
    if (s.eventIds !== undefined) need(isArr(s.eventIds) && s.eventIds.every(isStr), `${p}.eventIds 必须是字符串数组`);
    if (s.stateIn !== undefined) need(isObj(s.stateIn), `${p}.stateIn 必须是对象`);
    if (s.stateOut !== undefined) need(isObj(s.stateOut), `${p}.stateOut 必须是对象`);
    if (s.continuityIn !== undefined) need(isObj(s.continuityIn), `${p}.continuityIn 必须是对象`);
    if (s.continuityOut !== undefined) need(isObj(s.continuityOut), `${p}.continuityOut 必须是对象`);
    const strategies = Array.isArray(s.assetStrategy) ? s.assetStrategy : [s.assetStrategy];
    need(strategies.length >= 1 && strategies.every((x) => ['procedural', 'svg-asset', 'generated-image', 'video-footage', '3d-scene'].includes(x)), `${p}.assetStrategy 必须是 v3 枚举（字符串或数组，支持混合素材）`);
    for (const k of Object.keys(s)) {
      if (!SPEC_KEYS.includes(k)) errors.push(`${p} 不允许的字段：${k}`);
    }
  }
  const sceneById = new Map((spec.scenes ?? []).map((s) => [s.sceneId, s]));
  const textPolicy = blueprint.textPolicy ?? { captions: 'required', verbatimRequired: true };
  need(['required', 'optional', 'none'].includes(textPolicy.captions), 'blueprint.textPolicy.captions 必须是 required/optional/none');
  const captionsRequired = textPolicy.captions === 'required';
  const cap = spec.captionTrack;
  need(isArr(cap), 'scene.spec.captionTrack 必须是数组');
  if (captionsRequired) need((cap ?? []).length >= 1, 'textPolicy.captions=required 时 captionTrack 至少 1 条');
  const capIds = new Set();
  const capUnits = new Set();
  for (const [i, c] of (cap ?? []).entries()) {
    need(isStr(c.id), `captionTrack[${i}].id 不能为空`);
    if (isStr(c.id)) {
      need(!capIds.has(c.id), `captionTrack[${i}].id 重复`);
      capIds.add(c.id);
    }
    need(isStr(c.sourceUnitId), `captionTrack[${i}].sourceUnitId 不能为空`);
    if (isStr(c.sourceUnitId)) {
      capUnits.add(c.sourceUnitId);
      if (intentUnits.length) need(intentUnits.includes(c.sourceUnitId), `captionTrack[${i}].sourceUnitId 不在 intent-brief`);
    }
    need(isStr(c.text), `captionTrack[${i}].text 不能为空`);
    if (isStr(c.sourceUnitId) && isStr(c.text) && intentUnits.length && textPolicy.verbatimRequired !== false) {
      const ip = path.resolve(dir, blueprint.basedOn.intentBrief);
      if (fs.existsSync(ip)) {
        try {
          const ib = JSON.parse(fs.readFileSync(ip, 'utf8'));
          const u = (ib.content?.units ?? []).find((x) => x.id === c.sourceUnitId);
          if (u) need(u.text.replace(/\s+/g, '') === c.text.replace(/\s+/g, ''), `captionTrack[${i}].text 必须与原文逐字一致`);
        } catch {}
      }
    }
    const sc = sceneById.get(c.sceneId);
    need(!!sc, `captionTrack[${i}].sceneId 不在 scene.spec`);
    if (sc && isInt(c.from) && isInt(c.durationInFrames)) {
      need(c.from >= sc.from && c.from + c.durationInFrames <= sc.from + sc.durationInFrames, `captionTrack[${i}] 必须落在对应场景内`);
    }
    need(typeof c.readingTimeSec === 'number' && c.readingTimeSec > 0, `captionTrack[${i}].readingTimeSec 必须是正数`);
    if (isStr(c.text) && typeof c.readingTimeSec === 'number') {
      need(c.readingTimeSec >= c.text.length / 10, `captionTrack[${i}] 阅读时间不足（至少 ${(c.text.length / 10).toFixed(1)}s）`);
    }
  }
  if (intentUnits.length && captionsRequired) {
    for (const u of intentUnits) need(capUnits.has(u), `captionTrack 缺少原文单元 ${u}（用户要求完整字幕时不能漏）`);
  }

  if (timelinePolicy === 'contiguous') need(prevEnd === spec.durationInFrames, `contiguous 场景必须连续覆盖到 durationInFrames（当前覆盖到 ${prevEnd} / ${spec.durationInFrames}）`);
  else need(prevEnd <= spec.durationInFrames, 'explicit 时间线的场景范围不能超过 durationInFrames');
  if (implementationBlocked) need(spec.status === 'draft', '实现可行性未通过时，scene.spec 必须是 draft');
  if (spec.status === 'approved') {
    need(!implementationBlocked, 'scene.spec 不能在与 implementation 未通过时标记 approved');
  }
}

// ---------------- 设计审查 ----------------
if (review) {
  need(review.schemaVersion === '1.0', 'design-review.schemaVersion 必须是 "1.0"');
  need(review.type === 'design-review', 'design-review.type 必须是 design-review');
  need(['approved', 'blocked'].includes(review.status), 'design-review.status 必须是 approved/blocked');
  const gateKeys = ['creativeCompleteness', 'motionCompleteness', 'implementationFeasibility', 'handoff'];
  for (const k of gateKeys) {
    need(isObj(review.gates?.[k]), `design-review.gates.${k} 缺失`);
    need(['pass', 'blocked'].includes(review.gates?.[k]?.status), `design-review.gates.${k}.status 非法`);
  }
  const anyBlocked = gateKeys.some((k) => review.gates?.[k]?.status === 'blocked');
  need(review.status === (anyBlocked ? 'blocked' : 'approved'), 'design-review.status 必须与四道门一致');
  if (implementationBlocked) {
    need(review.gates?.implementationFeasibility?.status === 'blocked', '实现可行性未通过时，design-review.implementationFeasibility 必须 blocked');
    need(review.gates?.handoff?.status === 'blocked', '实现可行性未通过时，handoff 必须 blocked');
  }
  if (!directionConfirmed) need(review.gates?.handoff?.status === 'blocked', 'Gate A 未确认时，handoff 必须 blocked');
}

const text = JSON.stringify({ blueprint, implementation, spec, review });
need(!/TODO|TBD|占位符|待补充|待填写/i.test(text), '还有占位符/待填写');
need(!/<[^>]+>/.test(text.replace(/https?:\/\/[^\s"]+/g, '')), '还有尖括号占位');

if (errors.length) {
  console.error(`✗ 动画设计层未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
const gate3 = implementationBlocked ? 'blocked' : 'pass';
console.log(`✓ 动画设计层通过：${blueprintScenes.length} 场；Gate1/2=pass，Gate3=${gate3}，Gate4=${review?.gates?.handoff?.status ?? '?'}，scene.spec=${spec?.status}`);
console.log('  提示：蓝图先过创意/运动检查；组件/资产 candidate 不得当 available；Gate C 未过不得进执行层。');

#!/usr/bin/env node
/**
 * intent-brief.json 校验器（v5 stage 0，无依赖）
 *
 * 只回答一件事：这份创作意图简报有没有越权、有没有把“未决定”伪装成“已决定”。
 *
 * 用法：node tools/validate-intent.mjs path/to/intent-brief.json
 *
 * 关键规则：
 * - 原文必须逐字可核对（verbatim 源文件）；
 * - 推断必须有 evidence + confidence；
 * - 创作线索 binding 必须为 false；
 * - 未决/未提供决策不能带 value；locked 必须带 value + sourceRef；
 * - 时长/画幅/fps/声音只能出现在 productionDecisions，不能混进内容层；
 * - 故事时间必须与播放时间分开（有“七点”类文本时要求 guardrail）。
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('用法：node tools/validate-intent.mjs <intent-brief.json>');
  process.exit(2);
}

const abs = path.resolve(process.cwd(), file);
const dir = path.dirname(abs);
let doc;
try {
  doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
} catch (e) {
  console.error(`✗ 不是合法 JSON：${e.message}`);
  process.exit(1);
}

const errors = [];
const need = (cond, msg) => {
  if (!cond) errors.push(msg);
};
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isArr = (v) => Array.isArray(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

const ALLOWED_TOP = new Set([
  'schemaVersion',
  'type',
  'sources',
  'request',
  'content',
  'productionDecisions',
  'handoff',
  'openQuestions',
]);

// 这些键出现在任何层级都视为“越权替导演做视觉/制作决定”
const BANNED_KEYS = new Set([
  'visual',
  'mechanism',
  'palette',
  'typography',
  'production',
  'shotPlan',
  'shotPlanMode',
  'styleFrames',
  'styleFrame',
  'camera',
  'lighting',
  'procedural',
  'acceptance',
  'format',
  'tone',
  'audience',
  'visualProblem',
  'lines',
  'beats',
]);

function scanKeys(obj, p = '$') {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => scanKeys(v, `${p}[${i}]`));
    return;
  }
  if (isObj(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (BANNED_KEYS.has(k)) {
        errors.push(`出现越权字段：${p}.${k}（视觉/制作决定属于下游阶段；未决项放 productionDecisions）`);
      }
      scanKeys(v, `${p}.${k}`);
    }
  }
}
scanKeys(doc);

for (const k of Object.keys(doc)) {
  if (!ALLOWED_TOP.has(k)) errors.push(`不允许的顶层字段：${k}`);
}

need(doc.schemaVersion === '2.0', 'schemaVersion 必须是 "2.0"');
need(doc.type === 'creative-intent-brief', 'type 必须是 "creative-intent-brief"');

// ---------- sources ----------
const sources = doc.sources ?? [];
need(isArr(sources) && sources.length >= 1, 'sources 至少 1 条');
const sourceIds = new Set();
const verbatimTexts = new Map(); // id -> normalized file text
for (const [i, s] of sources.entries()) {
  need(isStr(s.id), `sources[${i}].id 不能为空`);
  if (isStr(s.id)) {
    need(!sourceIds.has(s.id), `sources[${i}].id 重复：${s.id}`);
    sourceIds.add(s.id);
  }
  need(
    ['poem', 'script', 'prompt', 'doc', 'image', 'video', 'audio', 'reference', 'mixed'].includes(s.kind),
    `sources[${i}].kind 非法`,
  );
  need(isStr(s.role), `sources[${i}].role 不能为空`);
  need(['user', 'asset-analysis', 'inferred'].includes(s.origin), `sources[${i}].origin 非法`);
  need(
    ['verbatim', 'paraphrase', 'summary', 'not-applicable'].includes(s.textIntegrity),
    `sources[${i}].textIntegrity 非法`,
  );
  if (s.file !== undefined) {
    need(isStr(s.file), `sources[${i}].file 必须是路径`);
    if (isStr(s.file)) {
      const fp = path.resolve(dir, s.file);
      need(fs.existsSync(fp), `sources[${i}].file 不存在：${s.file}`);
      if (fs.existsSync(fp) && s.textIntegrity === 'verbatim') {
        const text = fs.readFileSync(fp, 'utf8').replace(/\s+/g, '');
        verbatimTexts.set(s.id, text);
      }
    }
  }
}

// ---------- request ----------
const req = doc.request ?? {};
need(isStr(req.deliverable) && req.deliverable.length >= 6, 'request.deliverable 必须写清交付物');
need(isStr(req.decisionPolicy) && req.decisionPolicy.length >= 10, 'request.decisionPolicy 必须写清“未指定参数由谁/如何决定”');
for (const [i, c] of (req.constraints ?? []).entries()) need(isStr(c), `request.constraints[${i}] 不能为空`);

// ---------- content ----------
const content = doc.content ?? {};
const units = content.units ?? [];
need(isArr(units) && units.length >= 1, 'content.units 至少 1 个');
const unitIds = new Set();
let lastOrder = 0;
for (const [i, u] of units.entries()) {
  need(isStr(u.id), `content.units[${i}].id 不能为空`);
  if (isStr(u.id)) {
    need(!unitIds.has(u.id), `content.units[${i}].id 重复：${u.id}`);
    unitIds.add(u.id);
  }
  need(Number.isInteger(u.order) && u.order >= 1, `content.units[${i}].order 必须是 >=1 的整数`);
  if (Number.isInteger(u.order)) {
    need(u.order > lastOrder, `content.units[${i}].order 必须递增（当前 ${u.order}，上一条 ${lastOrder}）`);
    lastOrder = u.order;
  }
  need(isStr(u.text), `content.units[${i}].text 不能为空（原文必须保留）`);
  need(isStr(u.event) && u.event.length >= 4, `content.units[${i}].event 必须写这一单元发生了什么`);
  need(isArr(u.relations) && u.relations.length >= 1, `content.units[${i}].relations 至少 1 条关系`);
  for (const [j, r] of (u.relations ?? []).entries()) need(isStr(r), `content.units[${i}].relations[${j}] 不能为空`);
  need(isStr(u.sourceRef) && sourceIds.has(u.sourceRef), `content.units[${i}].sourceRef 必须指向存在的 source`);

  if (isStr(u.sourceRef) && verbatimTexts.has(u.sourceRef) && isStr(u.text)) {
    const t = u.text.replace(/\s+/g, '');
    need(
      verbatimTexts.get(u.sourceRef).includes(t),
      `content.units[${i}].text 与 verbatim 源文件不一致（不能改写/润色）：${u.text}`,
    );
  }
}

const invariants = content.invariants ?? [];
need(isArr(invariants) && invariants.length >= 1, 'content.invariants 至少 1 条');
const invariantIds = new Set();
let hasLocked = false;
for (const [i, inv] of invariants.entries()) {
  need(isStr(inv.id), `content.invariants[${i}].id 不能为空`);
  if (isStr(inv.id)) {
    need(!invariantIds.has(inv.id), `content.invariants[${i}].id 重复`);
    invariantIds.add(inv.id);
  }
  need(isStr(inv.rule) && inv.rule.length >= 4, `content.invariants[${i}].rule 不能为空`);
  need(['locked', 'interpretive-guardrail'].includes(inv.status), `content.invariants[${i}].status 非法`);
  if (inv.status === 'locked') hasLocked = true;
  need(isStr(inv.sourceRef), `content.invariants[${i}].sourceRef 必须写来源`);
  if (isStr(inv.sourceRef)) {
    need(
      inv.sourceRef === 'user-request' || sourceIds.has(inv.sourceRef),
      `content.invariants[${i}].sourceRef 必须指向 source 或 user-request`,
    );
  }
}
need(hasLocked, 'content.invariants 至少要有 1 条 locked（哪些不能改必须说清）');

// 故事时间 vs 播放时间
const hasStoryTime = units.some((u) => isStr(u.text) && /[零一二三四五六七八九十百两\d]+点/.test(u.text));
if (hasStoryTime) {
  need(
    invariants.some((x) => isStr(x.rule) && /(故事时间|播放时间|story\s*time)/i.test(x.rule)),
    '文本含“几点”类故事时间，invariants 必须有一条 guardrail 区分故事时间与播放时间码',
  );
}

const interpretations = content.interpretations ?? [];
need(isArr(interpretations), 'content.interpretations 必须是数组');
const interpIds = new Set();
for (const [i, it] of interpretations.entries()) {
  need(isStr(it.id), `content.interpretations[${i}].id 不能为空`);
  if (isStr(it.id)) {
    need(!interpIds.has(it.id), `content.interpretations[${i}].id 重复`);
    interpIds.add(it.id);
  }
  need(isStr(it.claim) && it.claim.length >= 6, `content.interpretations[${i}].claim 不能为空`);
  need(it.status === 'inferred', `content.interpretations[${i}].status 必须是 inferred（推断不能冒充事实）`);
  need(isArr(it.evidence) && it.evidence.length >= 1, `content.interpretations[${i}].evidence 至少 1 条`);
  for (const [j, e] of (it.evidence ?? []).entries()) {
    need(isStr(e), `content.interpretations[${i}].evidence[${j}] 不能为空`);
    if (isStr(e)) {
      need(
        unitIds.has(e) || sourceIds.has(e),
        `content.interpretations[${i}].evidence[${j}] 必须指向 unit/source：${e}`,
      );
    }
  }
  need(['low', 'medium', 'high'].includes(it.confidence), `content.interpretations[${i}].confidence 非法`);
}

const cues = content.creativeCues ?? [];
need(isArr(cues), 'content.creativeCues 必须是数组');
for (const [i, cue] of cues.entries()) {
  need(isStr(cue.id), `content.creativeCues[${i}].id 不能为空`);
  need(isStr(cue.cue) && cue.cue.length >= 6, `content.creativeCues[${i}].cue 不能为空`);
  need(isStr(cue.purpose) && cue.purpose.length >= 4, `content.creativeCues[${i}].purpose 不能为空`);
  need(['suggestion', 'directional-guidance'].includes(cue.status), `content.creativeCues[${i}].status 非法`);
  need(cue.binding === false, `content.creativeCues[${i}].binding 必须为 false（线索不能变成硬约束）`);
}

// ---------- productionDecisions ----------
const REQUIRED_DECISIONS = ['visualDirection', 'visualMedium', 'durationSec', 'aspectRatio', 'fps', 'audio', 'references'];
const decisions = doc.productionDecisions ?? {};
need(isObj(decisions), 'productionDecisions 必须是对象');
for (const key of Object.keys(decisions)) {
  need(REQUIRED_DECISIONS.includes(key), `productionDecisions 不允许的键：${key}`);
}
for (const key of REQUIRED_DECISIONS) {
  const d = decisions[key];
  need(isObj(d), `productionDecisions.${key} 缺失`);
  if (!isObj(d)) continue;
  need(
    ['locked', 'inferred', 'proposed', 'unresolved', 'not-provided'].includes(d.status),
    `productionDecisions.${key}.status 非法`,
  );
  need(isStr(d.decisionOwner), `productionDecisions.${key}.decisionOwner 必须写清由谁决定`);
  const hasValue = d.value !== undefined && d.value !== null;
  if (d.status === 'unresolved' || d.status === 'not-provided') {
    need(!hasValue, `productionDecisions.${key} 状态为 ${d.status} 时不能带 value（不能把未决项伪装成已决定）`);
  }
  if (d.status === 'locked') {
    need(hasValue, `productionDecisions.${key} 状态为 locked 时必须带 value`);
    need(isStr(d.sourceRef), `productionDecisions.${key} 状态为 locked 时必须带 sourceRef`);
  }
  if (d.status === 'inferred' || d.status === 'proposed') {
    need(hasValue, `productionDecisions.${key} 状态为 ${d.status} 时必须带 value（候选/推断要有具体值）`);
    need(isStr(d.rationale), `productionDecisions.${key} 状态为 ${d.status} 时必须写 rationale`);
  }
}

// ---------- handoff ----------
const h = doc.handoff ?? {};
need(isStr(h.nextStage) && h.nextStage.length >= 2, 'handoff.nextStage 必须写清下一阶段');
need(isStr(h.instruction) && h.instruction.length >= 10, 'handoff.instruction 必须写清交接要求');
need(isArr(h.requiredOutput) && h.requiredOutput.length >= 1, 'handoff.requiredOutput 至少 1 项');
for (const [i, x] of (h.requiredOutput ?? []).entries()) need(isStr(x), `handoff.requiredOutput[${i}] 不能为空`);

// ---------- openQuestions ----------
for (const [i, q] of (doc.openQuestions ?? []).entries()) {
  need(isStr(q.question) && q.question.length >= 4, `openQuestions[${i}].question 不能为空`);
}

// ---------- 占位/空话 ----------
const text = JSON.stringify(doc);
need(!/待定|TODO|TBD|占位符|xxx|待补充/i.test(text), '还有占位符/待定');
need(!/<[^>]+>/.test(text.replace(/https?:\/\/[^\s"]+/g, '')), '还有尖括号占位');

if (errors.length) {
  console.error(`✗ intent-brief 未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `✓ intent-brief 通过：${path.basename(file)}（${units.length} 个原文单元，${interpretations.length} 条推断，${cues.length} 条线索，${REQUIRED_DECISIONS.length} 项制作决策状态）`,
);
console.log('  提示：本层只确认“意图与权责清楚”；视觉方向/时长/画幅/声音由下游阶段提出并决定。');

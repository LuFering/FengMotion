#!/usr/bin/env node
/**
 * 参考分析门校验器（v5，无依赖）
 *
 * 用法：node tools/validate-reference.mjs examples/<film>
 *
 * 只回答：参考证据是否可追溯、观察/解释是否分开、模式与记录是否匹配。
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('用法：node tools/validate-reference.mjs <film-dir>');
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

const log = read('reference-log.json');
const analysis = read('reference-analysis.json');
const decision = read('reference-decision.json');
const MODES = ['user-provided', 'library-assisted', 'reference-free'];
const CONF = ['low', 'medium', 'high'];

let mode = null;
if (log) {
  need(log.schemaVersion === '1.0', 'reference-log.schemaVersion 必须是 "1.0"');
  need(log.type === 'reference-log', 'reference-log.type 必须是 reference-log');
  need(MODES.includes(log.mode), 'reference-log.mode 必须是 user-provided/library-assisted/reference-free');
  mode = log.mode;
  need(isArr(log.queries) && log.queries.length >= 1, 'reference-log.queries 至少 1 条（搜过什么）');
  for (const [i, q] of (log.queries ?? []).entries()) {
    need(isStr(q.tool), `queries[${i}].tool 不能为空`);
    need(isStr(q.args), `queries[${i}].args 不能为空`);
    need(['found', 'partial', 'none'].includes(q.outcome), `queries[${i}].outcome 必须是 found/partial/none`);
    if (q.outcome !== 'found') need(isStr(q.why) && q.why.length >= 8, `queries[${i}].why 必须说明为什么没有合适参考`);
  }
  need(isArr(log.cards), 'reference-log.cards 必须是数组');
  need(isArr(log.refs), 'reference-log.refs 必须是数组');
  const cardIds = new Set();
  for (const [i, c] of (log.cards ?? []).entries()) {
    need(isStr(c.referenceId), `cards[${i}].referenceId 不能为空`);
    if (isStr(c.referenceId)) {
      need(!cardIds.has(c.referenceId), `cards[${i}].referenceId 重复`);
      cardIds.add(c.referenceId);
    }
    need(isStr(c.scope), `cards[${i}].scope 不能为空（这份卡解释什么）`);
  }
  const refIds = new Set();
  for (const [i, r] of (log.refs ?? []).entries()) {
    need(isStr(r.referenceId), `refs[${i}].referenceId 不能为空`);
    if (isStr(r.referenceId)) {
      need(!refIds.has(r.referenceId), `refs[${i}].referenceId 重复`);
      refIds.add(r.referenceId);
    }
    need(isStr(r.file), `refs[${i}].file 不能为空`);
    need(r.timecode !== undefined && r.timecode !== '', `refs[${i}].timecode 不能为空`);
    if (isStr(r.file)) {
      need(fs.existsSync(path.resolve(dir, r.file)), `refs[${i}].file 不存在：${r.file}`);
    }
    for (const [j, f] of (r.frames ?? []).entries()) {
      need(isStr(f) && fs.existsSync(path.resolve(dir, f)), `refs[${i}].frames[${j}] 不存在：${f}`);
    }
  }
  need(isArr(log.directions) && log.directions.length >= 1, 'reference-log.directions 至少 1 个方向');
  need(isStr(log.selected), 'reference-log.selected 不能为空');
  if (isStr(log.selected)) need((log.directions ?? []).includes(log.selected), 'selected 必须是 directions 之一');

  if (mode === 'user-provided') {
    need((log.refs ?? []).length >= 1, 'user-provided 模式至少 1 条用户参考（refs）');
  } else if (mode === 'library-assisted') {
    need((log.cards ?? []).length + (log.refs ?? []).length >= 3, 'library-assisted 至少 3 条卡/参考记录');
  } else if (mode === 'reference-free') {
    need((log.refs ?? []).length === 0, 'reference-free 不应有 refs（有合适参考就应改用 user-provided/library-assisted）');
    need((log.cards ?? []).length === 0, 'reference-free 不应有 cards（有匹配卡就应改用 library-assisted）');
    need((log.queries ?? []).some((q) => q.outcome === 'none' || q.outcome === 'partial'), 'reference-free 至少要有一次 none/partial 检索结果');
  }
}

if (analysis) {
  need(analysis.schemaVersion === '1.0', 'reference-analysis.schemaVersion 必须是 "1.0"');
  need(analysis.type === 'reference-analysis', 'reference-analysis.type 必须是 reference-analysis');
  need(analysis.mode === mode, 'reference-analysis.mode 必须与 reference-log 一致');
  need(isArr(analysis.references), 'reference-analysis.references 必须是数组');
  need(isArr(analysis.designHypotheses), 'reference-analysis.designHypotheses 必须是数组');

  const refs = analysis.references ?? [];
  const hyps = analysis.designHypotheses ?? [];
  const hypIds = new Set();
  for (const [i, h] of hyps.entries()) {
    need(isStr(h.id), `designHypotheses[${i}].id 不能为空`);
    if (isStr(h.id)) {
      need(!hypIds.has(h.id), `designHypotheses[${i}].id 重复`);
      hypIds.add(h.id);
    }
    need(isStr(h.hypothesis) && h.hypothesis.length >= 6, `designHypotheses[${i}].hypothesis 不能为空`);
    need(isStr(h.basis) && h.basis.length >= 6, `designHypotheses[${i}].basis 必须说明依据（不能是“感觉”）`);
    need(isStr(h.risk) && h.risk.length >= 4, `designHypotheses[${i}].risk 不能为空`);
    need(CONF.includes(h.confidence), `designHypotheses[${i}].confidence 非法`);
  }

  if (mode === 'reference-free') {
    need(refs.length === 0, 'reference-free 的 references 必须为空（改用 designHypotheses）');
    need(hyps.length >= 1, 'reference-free 至少 1 条设计假设');
  } else {
    need(refs.length >= 1, '非 reference-free 模式至少 1 条参考分析');
    const refIds = new Set([...(log?.refs ?? []), ...(log?.cards ?? [])].map((x) => x.referenceId));
    for (const [i, r] of refs.entries()) {
      need(isStr(r.referenceId), `references[${i}].referenceId 不能为空`);
      if (isStr(r.referenceId)) need(refIds.has(r.referenceId), `references[${i}].referenceId 不在 reference-log：${r.referenceId}`);
      need(isStr(r.referenceScope), `references[${i}].referenceScope 不能为空`);
      need(isArr(r.observations) && r.observations.length >= 1, `references[${i}].observations 至少 1 条`);
      for (const [j, o] of (r.observations ?? []).entries()) {
        need(isStr(o), `references[${i}].observations[${j}] 不能为空`);
        need(!/喜欢|高级感|电影感|氛围感/.test(o), `references[${i}].observations[${j}] 是主观判断，不是观察证据`);
      }
      need(isStr(r.designPrinciple) && r.designPrinciple.length >= 4, `references[${i}].designPrinciple 不能为空`);
      need(isStr(r.transferableTechnique) && r.transferableTechnique.length >= 4, `references[${i}].transferableTechnique 不能为空`);
      need(isArr(r.doNotCopy) && r.doNotCopy.length >= 1, `references[${i}].doNotCopy 至少 1 条`);
      need(isStr(r.adaptationNotes) && r.adaptationNotes.length >= 4, `references[${i}].adaptationNotes 不能为空`);
      need(isStr(r.feasibility) && r.feasibility.length >= 4, `references[${i}].feasibility 不能为空`);
      need(CONF.includes(r.confidence), `references[${i}].confidence 非法`);
    }
  }
}

if (decision) {
  need(decision.schemaVersion === '1.0', 'reference-decision.schemaVersion 必须是 "1.0"');
  need(decision.type === 'reference-decision', 'reference-decision.type 必须是 reference-decision');
  need(decision.mode === mode, 'reference-decision.mode 必须与 reference-log 一致');
  need(isArr(decision.selected), 'reference-decision.selected 必须是数组');
  need(isArr(decision.excluded), 'reference-decision.excluded 必须是数组');
  need(isArr(decision.selectedHypotheses), 'reference-decision.selectedHypotheses 必须是数组');
  need(isStr(decision.rationale) && decision.rationale.length >= 10, 'reference-decision.rationale 不能为空');
  need(isArr(decision.affects) && decision.affects.length >= 1, 'reference-decision.affects 至少 1 项');

  const analysisRefIds = new Set((analysis?.references ?? []).map((r) => r.referenceId));
  const analysisHypIds = new Set((analysis?.designHypotheses ?? []).map((h) => h.id));
  if (mode === 'reference-free') {
    need((decision.selected ?? []).length === 0, 'reference-free 的 selected 必须为空（改用 selectedHypotheses）');
    need((decision.selectedHypotheses ?? []).length >= 1, 'reference-free 至少选择 1 条设计假设');
    for (const [i, id] of (decision.selectedHypotheses ?? []).entries()) {
      need(analysisHypIds.has(id), `selectedHypotheses[${i}] 不在 reference-analysis：${id}`);
    }
  } else {
    need((decision.selected ?? []).length >= 1, '非 reference-free 模式至少选择 1 条参考结论');
    for (const [i, s] of (decision.selected ?? []).entries()) {
      need(isStr(s.referenceId) && analysisRefIds.has(s.referenceId), `selected[${i}].referenceId 不在 reference-analysis`);
      need(isStr(s.usedFor) && s.usedFor.length >= 4, `selected[${i}].usedFor 不能为空`);
    }
  }
  for (const [i, e] of (decision.excluded ?? []).entries()) {
    need(isStr(e.referenceId), `excluded[${i}].referenceId 不能为空`);
    need(isStr(e.reason) && e.reason.length >= 4, `excluded[${i}].reason 不能为空`);
  }
}

const text = JSON.stringify({ log, analysis, decision });
need(!/TODO|TBD|占位符|待补充|待填写/i.test(text), '还有占位符/待填写');
need(!/<[^>]+>/.test(text.replace(/https?:\/\/[^\s"]+/g, '')), '还有尖括号占位');

if (errors.length) {
  console.error(`✗ 参考门未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ 参考门通过：mode=${mode}，queries=${log.queries.length}，refs=${log.refs.length}，cards=${log.cards.length}`);
console.log('  提示：参考只证明哪些手法可借鉴；视觉语言由方向层决定，不把参考整体风格当整片要求。');

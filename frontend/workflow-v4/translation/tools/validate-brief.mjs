import fs from 'node:fs';
import path from 'node:path';

/**
 * brief.json 校验器（无依赖）
 *
 * 用法：node tools/validate-brief.mjs path/to/brief.ready.json
 *
 * 只回答：这份 brief 能不能让 Builder 开工。
 */

const file = process.argv[2];
if (!file) {
  console.error('用法：node tools/validate-brief.mjs <brief.json>');
  process.exit(2);
}

const abs = path.resolve(process.cwd(), file);
const brief = JSON.parse(fs.readFileSync(abs, 'utf8'));
const dir = path.dirname(abs);
const errors = [];
const need = (cond, msg) => {
  if (!cond) errors.push(msg);
};
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

// 顶层
need(brief.version === 1, 'version 必须是 1');
need(['ready', 'needs_decision', 'needs_input'].includes(brief.status), 'status 必须是 ready/needs_decision/needs_input');
need(isStr(brief.goal) && brief.goal.length >= 10, 'goal 太短');
need(isStr(brief.builderMandate) && brief.builderMandate.length >= 20, 'builderMandate 必须写清 Builder 的创作责任');
const t = brief.timing ?? {};
need(isNum(t.totalSec) && t.totalSec > 0, 'timing.totalSec 必须是正数');
need(['user','audio','estimate'].includes(t.totalSource), 'timing.totalSource 必须是 user/audio/estimate');
need(Array.isArray(t.hardAnchors), 'timing.hardAnchors 必须是数组');
const estimatedScriptTimes = (brief.content?.script ?? [])
  .filter((sc) => sc.atSource === 'estimate' && isNum(sc.at))
  .map((sc) => sc.at);
for (const [i, h] of (t.hardAnchors ?? []).entries()) {
  need(isNum(h.at) && h.at >= 0, `timing.hardAnchors[${i}].at 必须是 >=0 的数`);
  need(isStr(h.what), `timing.hardAnchors[${i}] 缺 what`);
  if (h.source !== undefined) need(['user', 'audio'].includes(h.source), `timing.hardAnchors[${i}].source 只能是 user/audio`);
  if (h.source === 'user' && estimatedScriptTimes.some((at) => Math.abs(at - h.at) <= 0.01)) {
    need(false, `timing.hardAnchors[${i}] 在 ${h.at}s 标成 user，但同一时间点的字幕 atSource=estimate；不能把估算时间伪装成用户硬约束`);
  }
}
need(Array.isArray(t.softTargets), 'timing.softTargets 必须是数组');
for (const [i, st] of (t.softTargets ?? []).entries()) need(isStr(st.what), `timing.softTargets[${i}] 缺 what`);
need(isStr(t.owner), 'timing.owner 必须写清');
need(isStr(t.rule) && t.rule.length >= 10, 'timing.rule 必须写清');
need(Array.isArray(brief.acceptance) && brief.acceptance.length >= 1, 'acceptance 至少 1 条');
const cr = brief.creativeRoom ?? {};
for (const k of ['builderOwns','mustSolve','mayInvent','notPrescribed']) {
  need(Array.isArray(cr[k]) && cr[k].length >= (k === 'mayInvent' || k === 'notPrescribed' ? 0 : 1), `creativeRoom.${k} 必须是数组`);
}
if (brief.audience !== undefined) need(typeof brief.audience === 'string', 'audience 必须是字符串');

// 落地
const b = brief.build ?? {};
need(isStr(b.projectDir), 'build.projectDir 必须写清');
need(isStr(b.compositionId), 'build.compositionId 必须写清');
need(isStr(b.outPath), 'build.outPath 必须写清');
if (b.entry !== undefined) need(isStr(b.entry), 'build.entry 必须是字符串');

// 画幅
const f = brief.format ?? {};
need(isNum(f.durationSec) && f.durationSec > 0, 'format.durationSec 必须是正数');
need(isInt(f.fps) && f.fps >= 12, 'format.fps 必须是 >=12 的整数');
need(isInt(f.width) && f.width >= 320, 'format.width 必须是 >=320 的整数');
need(isInt(f.height) && f.height >= 240, 'format.height 必须是 >=240 的整数');

// 内容
const c = brief.content ?? {};
need(Array.isArray(c.facts), 'content.facts 必须是数组');
need(Array.isArray(c.script), 'content.script 必须是数组（无旁白也要写 []）');
for (const [i, sc] of (c.script ?? []).entries()) {
  need(isStr(sc.id), `content.script[${i}] 缺 id`);
  need(isStr(sc.text), `content.script[${i}] 缺 text`);
  if (sc.atSource !== undefined) need(['user','audio','estimate'].includes(sc.atSource), `content.script[${i}].atSource 非法`);
}
need(Array.isArray(c.copy), 'content.copy 必须是数组（没有文字也要写 []）');
for (const [i, cp] of (c.copy ?? []).entries()) {
  need(isStr(cp.id), `content.copy[${i}] 缺 id`);
  need(isStr(cp.text), `content.copy[${i}] 缺 text`);
  if (cp.role !== undefined) need(['title','subtitle','label','credit','cta'].includes(cp.role), `content.copy[${i}].role 非法`);
  if (cp.atSource !== undefined) need(['user','audio','estimate'].includes(cp.atSource), `content.copy[${i}].atSource 非法`);
  if (cp.timeLock !== undefined) need(['hard','soft'].includes(cp.timeLock), `content.copy[${i}].timeLock 非法`);
  if (cp.until !== undefined) {
    need(isNum(cp.until) && cp.until > (cp.at ?? 0), `content.copy[${i}].until 必须大于 at`);
  }
}
need(Array.isArray(c.milestones), 'content.milestones 必须是数组（没有时间线也要写 []）');
for (const [i, m] of (c.milestones ?? []).entries()) {
  need(isStr(m.name), `content.milestones[${i}] 缺 name`);
  need(isStr(m.fact) && m.fact.length >= 2, `content.milestones[${i}] 缺 fact`);
}
for (const [i, fact] of (c.facts ?? []).entries()) {
  need(isStr(fact.claim), `content.facts[${i}] 缺 claim`);
  need(isStr(fact.source), `content.facts[${i}] 缺 source（数字必须有来源）`);
  if (fact.usage !== undefined) need(['duel','ending','context','hero'].includes(fact.usage), `content.facts[${i}].usage 非法`);
}
need(Array.isArray(c.beats) && c.beats.length >= 2, 'content.beats 至少 2 拍');
const orders = new Set();
for (const [i, b] of (c.beats ?? []).entries()) {
  need(isInt(b.order) && b.order >= 1, `content.beats[${i}].order 必须是 >=1 的整数`);
  if (isInt(b.order)) {
    need(!orders.has(b.order), `content.beats[${i}].order 重复`);
    orders.add(b.order);
  }
  need(['hard','soft'].includes(b.timeLock), `content.beats[${i}].timeLock 必须是 hard/soft`);
  if (b.at !== undefined) need(isNum(b.at) && b.at >= 0, `content.beats[${i}].at 必须是 >=0 的数`);
  if (b.target !== undefined) need(isStr(b.target), `content.beats[${i}].target 必须是字符串`);
  need(isStr(b.what) && b.what.length >= 4, `content.beats[${i}].what 太短`);
  need(isStr(b.visual) && b.visual.length >= 4, `content.beats[${i}].visual 太短（观众看到什么）`);
  need(isStr(b.mustAchieve) && b.mustAchieve.length >= 4, `content.beats[${i}].mustAchieve 太短（这一拍必须做到什么）`);
}
need(isStr(c.tone) && c.tone.length >= 4, 'content.tone 太短');

// 视觉
const v = brief.visual ?? {};
need(['ready', 'needs_decision'].includes(v.status), 'visual.status 必须是 ready/needs_decision');
need(isStr(v.visualProblem) && v.visualProblem.length >= 10, 'visual.visualProblem 必须写清要解决什么问题');
need(Array.isArray(v.references), 'visual.references 必须是数组');
if (v.candidateDirections !== undefined) {
  need(Array.isArray(v.candidateDirections), 'visual.candidateDirections 必须是数组');
  for (const [i, cd] of (v.candidateDirections ?? []).entries()) {
    need(isStr(cd.name), `visual.candidateDirections[${i}] 缺 name`);
    need(isStr(cd.description), `visual.candidateDirections[${i}] 缺 description`);
    need(['user','candidate','reference'].includes(cd.source), `visual.candidateDirections[${i}].source 非法`);
    if (cd.reference !== undefined) need(isStr(cd.reference), `visual.candidateDirections[${i}].reference 必须是字符串`);
  }
}
need(v.typography && isStr(v.typography.title) && isStr(v.typography.body), 'visual.typography 必须有 title/body');
need(['on-object','corner','none','mixed'].includes(v.textMode), 'visual.textMode 必须是 on-object/corner/none/mixed');
if (v.production !== undefined) need(['procedural','asset-based','hybrid'].includes(v.production), 'visual.production 必须是 procedural/asset-based/hybrid');
if (v.shotPlan !== undefined) {
  need(['reference','mandatory'].includes(v.shotPlanMode), '有 shotPlan 时 shotPlanMode 必须是 reference/mandatory');
  need(Array.isArray(v.shotPlan), 'visual.shotPlan 必须是数组');
  for (const [i, sh] of (v.shotPlan ?? []).entries()) {
    need(isNum(sh.at) && isNum(sh.until) && sh.until > sh.at, `visual.shotPlan[${i}] at/until 非法`);
    need(isStr(sh.shot), `visual.shotPlan[${i}] 缺 shot`);
    need(isStr(sh.camera), `visual.shotPlan[${i}] 缺 camera`);
    if (sh.transition !== undefined) need(isStr(sh.transition), `visual.shotPlan[${i}].transition 必须是字符串`);
  }
}
if (v.fontFiles !== undefined) {
  for (const [k, fp] of Object.entries(v.fontFiles)) {
    need(isStr(fp), `visual.fontFiles.${k} 必须是路径`);
    if (isStr(fp)) need(fs.existsSync(path.resolve(dir, fp)), `visual.fontFiles.${k} 字体不存在：${fp}`);
  }
}
if (isStr(v.selectedOption)) need((v.options ?? []).some(o => o.id === v.selectedOption), 'visual.selectedOption 必须匹配某个 option id');
need(Array.isArray(v.antiPatterns) && v.antiPatterns.length >= 1, 'visual.antiPatterns 至少 1 条');
need(Array.isArray(v.options) && v.options.length <= 3, 'visual.options 最多 3 条');

if (v.status === 'ready') {
  if (v.mechanismSource !== undefined) need(['user','candidate','reference','translator'].includes(v.mechanismSource), 'visual.mechanismSource 非法');
  if (v.mechanismSource !== 'user') {
    need(Array.isArray(v.options) && v.options.length >= 2, 'ready 且 mechanismSource != user 时，必须给至少 2 个候选方向（不能自己定一个 mechanism 就 ready）');
    need(isStr(v.selectedOption) && (v.options ?? []).some((o) => o.id === v.selectedOption), 'ready 且 mechanismSource != user 时，selectedOption 必须匹配某个 option id');
  }
  if (v.cameraSource !== undefined) need(['user','candidate','reference','translator'].includes(v.cameraSource), 'visual.cameraSource 非法');
  if (v.mechanismSource === 'user') need(isStr(v.mechanism) && v.mechanism.length >= 6, 'mechanismSource=user 时 mechanism 必须写清');
  if (v.cameraSource === 'user') need(isStr(v.camera) && v.camera.length >= 4, 'cameraSource=user 时 camera 必须写清');
  need(v.palette && isStr(v.palette.bg) && isStr(v.palette.fg) && isStr(v.palette.accent), 'ready 时 visual.palette 必须有 bg/fg/accent');
  need(!brief.openQuestions || brief.openQuestions.length === 0, 'ready 时 openQuestions 必须为空');
  if (v.mechanismSource !== 'user') {
    const acc = (brief.acceptance ?? []).join(' ');
    need(!/(一镜到底|全片只有一次|不切|升角|俯拍|机位|镜头)/.test(acc), '非 user 机制时 acceptance 不能规定镜头/机位/一镜到底');
    const mandate = brief.builderMandate ?? '';
    need(!/(不要换掉|不换掉|保持.*载体|锁定.*载体)/.test(mandate), '非 user 机制时 builderMandate 不能锁死载体');
  }
}

if (v.status === 'needs_decision') {
  need(Array.isArray(v.options) && v.options.length >= 2, 'needs_decision 时至少给 2 个方向');
  for (const [i, o] of (v.options ?? []).entries()) {
    need(isStr(o.id), `visual.options[${i}] 缺 id`);
    need(isStr(o.mechanism) && o.mechanism.length >= 6, `visual.options[${i}] 缺 mechanism`);
    need(isStr(o.camera) && o.camera.length >= 4, `visual.options[${i}] 缺 camera`);
    need(o.palette && isStr(o.palette.bg) && isStr(o.palette.fg) && isStr(o.palette.accent), `visual.options[${i}] 缺 palette`);
    need(isStr(o.styleFrame), `visual.options[${i}] 缺 styleFrame`);
    if (isStr(o.styleFrame)) {
      need(fs.existsSync(path.join(dir, o.styleFrame)), `visual.options[${i}] 风格帧不存在：${o.styleFrame}`);
    }
  }
  need(Array.isArray(brief.openQuestions) && brief.openQuestions.length >= 1, 'needs_decision 时 openQuestions 至少 1 条');
}

// 音频
const a = brief.audio ?? {};
need(isNum(a.bpm) && a.bpm >= 30 && a.bpm <= 240, 'audio.bpm 必须在 30–240');
need(typeof a.vo === 'boolean', 'audio.vo 必须是布尔');
need(isStr(a.musicSource), 'audio.musicSource 必须写清音乐来源');
if (a.score !== undefined) need(isStr(a.score), 'audio.score 必须是字符串');
if (a.file !== undefined) need(typeof a.file === 'string', 'audio.file 必须是字符串');
if (a.voFile !== undefined) need(typeof a.voFile === 'string', 'audio.voFile 必须是字符串');
if (a.generator !== undefined) need(isStr(a.generator), 'audio.generator 必须是字符串');
if (a.vo === true) {
  need(isStr(a.voSource), 'audio.vo=true 时 voSource 必须写清人声来源/音色');
  need(isNum(a.voRate) && a.voRate >= 2 && a.voRate <= 8, 'audio.vo=true 时 voRate 必须是 2–8 字/秒');
  if (a.voRateUnit !== undefined) need(isStr(a.voRateUnit), 'audio.voRateUnit 必须是字符串');
}
need(Array.isArray(a.syncPoints), 'audio.syncPoints 必须是数组');
for (const [i, s] of (a.syncPoints ?? []).entries()) {
  need(isNum(s) && s >= 0, `audio.syncPoints[${i}] 必须是 >=0 的数`);
}

// 元信息
need(Array.isArray(brief.assumptions), 'assumptions 必须是数组');
need(Array.isArray(brief.openQuestions), 'openQuestions 必须是数组');
need(Array.isArray(brief.sources) && brief.sources.length >= 1, 'sources 至少 1 条');
for (const [i, s] of (brief.sources ?? []).entries()) {
  need(isStr(s.type), `sources[${i}] 缺 type`);
  need(isStr(s.path), `sources[${i}] 缺 path`);
}

// ready 的字段里不许留占位
if (brief.status === 'ready') {
  const text = JSON.stringify(brief);
  need(!/待定|TODO|TBD|<.*?>/.test(text), 'ready 的 brief 里还有占位符/待定');
}

if (errors.length) {
  console.error(`✗ brief 未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(`✓ brief 通过：${path.basename(file)}（status=${brief.status}）`);

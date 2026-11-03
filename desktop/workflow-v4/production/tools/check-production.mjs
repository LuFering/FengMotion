import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * production.json 校验器（无依赖）
 *
 * 用法：
 *   node tools/check-production.mjs path/to/production.json
 *   node tools/check-production.mjs path/to/production.json --director
 *   node tools/check-production.mjs path/to/production.json --build
 *   node tools/check-production.mjs path/to/production.json --final
 *
 * --director：只允许 carrier/beats/timing，必须有 director 块，不许有 scenes/qa；
 * --build：要求 timing.status = measured + scenes；
 * --final：--build 的要求 + qa.frames / qa.motionClips。
 */

const file = process.argv[2];
const final = process.argv.includes('--final');
const directorPhase = process.argv.includes('--director');
const buildPhase = process.argv.includes('--build');
if (!file) {
  console.error('用法：node tools/check-production.mjs <production.json> [--director|--build|--final]');
  process.exit(2);
}

const abs = path.resolve(process.cwd(), file);
const dir = path.dirname(abs);
const p = JSON.parse(fs.readFileSync(abs, 'utf8'));
const errors = [];
const need = (cond, msg) => { if (!cond) errors.push(msg); };
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

// 顶层
need(p.version === 1, 'version 必须是 1');
need(isStr(p.film), 'film 必须写清');
need(['directed', 'open'].includes(p.mode), 'mode 必须是 directed/open');
need(isStr(p.brief), 'brief 必须是相对路径');
const briefPath = path.resolve(dir, p.brief ?? '');
need(fs.existsSync(briefPath), `brief 不存在：${p.brief}`);
let brief = null;
if (fs.existsSync(briefPath)) {
  brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
  need(brief.status === 'ready', `brief 状态必须是 ready，当前 ${brief.status}`);
}

// 模式
if (brief && p.mode === 'directed') {
  const ms = brief.visual?.mechanismSource;
  need(['user', 'candidate'].includes(ms), 'directed 模式要求 brief.visual.mechanismSource = user/candidate');
  if (ms === 'candidate') need(isStr(brief.visual?.selectedOption), 'mechanismSource=candidate 时必须有 selectedOption');
}
if (brief && p.mode === 'open') {
  need(isStr(brief.visual?.visualProblem), 'open 模式要求 brief.visual.visualProblem');
}

// 载体
const carrier = p.carrier ?? {};
const carrierOptions = carrier.options ?? [];
need(Array.isArray(carrierOptions) && carrierOptions.length >= 1, 'carrier.options 至少 1 个');
for (const [i, o] of carrierOptions.entries()) {
  need(isStr(o.name), `carrier.options[${i}] 缺 name`);
  need(isStr(o.oneLine), `carrier.options[${i}] 缺 oneLine`);
  need(isStr(o.why), `carrier.options[${i}] 缺 why`);
  need(isStr(o.risk), `carrier.options[${i}] 缺 risk`);
}
need(isStr(carrier.chosen) && carrierOptions.some((o) => o.name === carrier.chosen), 'carrier.chosen 必须匹配某个 option');
need(isStr(carrier.whyChosen), 'carrier.whyChosen 必须写清');
need(isStr(carrier.risk), 'carrier.risk 必须写清');

if (brief && p.mode === 'open') {
  const briefNames = (brief.visual?.candidateDirections ?? []).map((c) => c.name);
  need(!briefNames.includes(carrier.chosen), 'open 模式 chosen 不能直接用 brief candidateDirections 里的载体；必须自己提一个');
}

// pushback：不能只记录，必须有导演/用户批准才能继续
if (p.pushback !== undefined) {
  const pb = p.pushback ?? {};
  need(isStr(pb.from), 'pushback.from 必须写清');
  need(isStr(pb.what), 'pushback.what 必须写清');
  need(isStr(pb.evidence), 'pushback.evidence 必须写清');
  need(isStr(pb.replacement), 'pushback.replacement 必须写清');
  need(['pending', 'applied', 'rejected'].includes(pb.status), 'pushback.status 必须是 pending/applied/rejected');
  if (pb.status === 'applied') {
    need(isStr(pb.resolution), 'pushback applied 必须有 resolution（改了什么）');
    need(isStr(pb.approvedBy), 'pushback applied 必须有 approvedBy（user/director）');
  }
}

// beatboard
const beats = p.beats ?? [];
need(Array.isArray(beats) && beats.length >= 2, 'beats 至少 2 个');
const orders = new Set();
for (const [i, b] of beats.entries()) {
  need(isInt(b.order) && b.order >= 1, `beats[${i}].order 必须是 >=1 的整数`);
  if (isInt(b.order)) {
    need(!orders.has(b.order), `beats[${i}].order 重复`);
    orders.add(b.order);
  }
  need(isStr(b.mustAchieve), `beats[${i}] 缺 mustAchieve`);
  const opts = b.options ?? [];
  need(Array.isArray(opts) && opts.length >= 1, `beats[${i}] 至少 1 种解法`);
  for (const [j, o] of opts.entries()) {
    need(isStr(o.name), `beats[${i}].options[${j}] 缺 name`);
    need(isStr(o.how), `beats[${i}].options[${j}] 缺 how`);
    need(isStr(o.why), `beats[${i}].options[${j}] 缺 why`);
  }
  need(isStr(b.chosen) && opts.some((o) => o.name === b.chosen), `beats[${i}].chosen 必须匹配某个 option`);
  need(isStr(b.whyChosen), `beats[${i}] 缺 whyChosen`);
}

// timing
const t = p.timing ?? {};
need(['plan', 'measured'].includes(t.status), 'timing.status 必须是 plan/measured');
const sections = t.sections ?? [];
need(Array.isArray(sections) && sections.length >= 2, 'timing.sections 至少 2 段');
let sum = 0;
for (const [i, s] of sections.entries()) {
  need(isStr(s.name), `timing.sections[${i}] 缺 name`);
  need(isNum(s.seconds) && s.seconds > 0, `timing.sections[${i}].seconds 必须 >0`);
  if (isNum(s.seconds)) sum += s.seconds;
  need(isStr(s.why), `timing.sections[${i}] 缺 why`);
}
need(isNum(t.totalSeconds) && t.totalSeconds > 0, 'timing.totalSeconds 必须 >0');
if (isNum(t.totalSeconds) && sum > 0) {
  need(Math.abs(sum - t.totalSeconds) <= 0.02, `sections 合计 ${sum.toFixed(3)}s 与 totalSeconds ${t.totalSeconds}s 不一致`);
}
if (brief) {
  const briefTotal = brief.format?.durationSec;
  need(isNum(briefTotal) && Math.abs(briefTotal - t.totalSeconds) <= 0.02, `totalSeconds ${t.totalSeconds} 与 brief.format.durationSec ${briefTotal} 不一致`);
  const anchors = brief.timing?.hardAnchors ?? [];
  for (const [i, h] of anchors.entries()) {
    need((t.hardAnchors ?? []).some((x) => Math.abs(x.at - h.at) <= 0.01), `缺 hardAnchor：${h.at}s（${h.what}）`);
  }
}
need(isStr(t.paddingCheck), 'timing.paddingCheck 必须写清');

const toPascal = (name) => name.split(/[-_]/).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('');

function checkLibrary(requireCode = false) {
  const lib = p.library ?? {};
  need(Array.isArray(lib.searched) && lib.searched.length >= 1, 'library.searched 至少 1 条（先搜库）');
  need(['used', 'rejected'].includes(lib.decision), 'library.decision 必须是 used/rejected');
  need(isStr(lib.reason), 'library.reason 必须写清：用了哪个，或为什么不用');
  if (lib.decision === 'rejected') return;

  need(Array.isArray(lib.used) && lib.used.length >= 1, 'library.used 至少 1 条：decision=used 时必须真的选一个库内容');
  let concrete = 0;
  for (const [i, u] of (lib.used ?? []).entries()) {
    need(['template', 'card', 'scene'].includes(u.type), `library.used[${i}].type 非法`);
    need(isStr(u.name), `library.used[${i}] 缺 name`);
    need(isStr(u.path), `library.used[${i}] 缺 path`);
    need(isStr(u.how), `library.used[${i}] 缺 how（准备怎么改）`);
    if (isStr(u.path)) {
      need(fs.existsSync(path.resolve(dir, u.path)), `library.used[${i}] 文件不存在：${u.path}`);
    }
    if (u.type === 'template' || u.type === 'scene') concrete++;
  }
  need(concrete >= 1, 'library.used 至少要有 1 个 template/scene，不能只引用卡片');

  if (requireCode) {
    const scenes = p.scenes ?? [];
    const withLib = scenes.filter((s) => Array.isArray(s.library) && s.library.length > 0);
    need(withLib.length >= 1, 'decision=used 时，scenes[] 至少 1 个 scene 记录 library');
    for (const s of withLib) {
      need(isStr(s.file), `scene ${s.id} 缺 file，无法核对是否真的 import 了模板`);
      const templates = (s.library ?? []).filter((u) => u.type === 'template');
      need(templates.length >= 1, `scene ${s.id}.library 至少要有 1 个 template`);
      for (const u of s.library ?? []) {
        need(isStr(u.path) && fs.existsSync(path.resolve(dir, u.path)), `scene ${s.id}.library 文件不存在：${u.path}`);
      }
      if (isStr(s.file)) {
        const fp = path.resolve(dir, s.file);
        need(fs.existsSync(fp), `scene ${s.id} 的 file 不存在：${s.file}`);
        if (fs.existsSync(fp)) {
          const code = fs.readFileSync(fp, 'utf8');
          for (const t of templates) {
            const pascal = toPascal(t.name);
            need(code.includes(`<${pascal}`), `scene ${s.id} 没有真正渲染 <${pascal}>（只 import 不算）`);
          }
        }
      }
    }
  }
}

// director 阶段：只允许前半部分；director 块可选
function checkDirector(requirePlan = true) {
  if (p.director !== undefined) {
    const dr = p.director ?? {};
    if (dr.buildabilityRisks !== undefined) need(Array.isArray(dr.buildabilityRisks), 'director.buildabilityRisks 必须是数组');
    if (dr.questionsForBuilder !== undefined) need(Array.isArray(dr.questionsForBuilder), 'director.questionsForBuilder 必须是数组');
    if (dr.pushbackRule !== undefined) need(isStr(dr.pushbackRule), 'director.pushbackRule 必须是字符串');
  }
  if (requirePlan) {
    need(t.status === 'plan', '--director 阶段 timing.status 必须是 plan（还没跑 animatic）');
    need(!Array.isArray(p.scenes) || p.scenes.length === 0, '--director 阶段不允许写最终 scenes/代码');
    need(!p.qa || Object.keys(p.qa).length === 0, '--director 阶段不允许 QA');
  }
}

function checkProbes() {
  const probes = p.probes ?? [];
  need(Array.isArray(probes) && probes.length >= 1, '至少 1 个 visual probe（still 或 2s clip）');
  for (const [i, pr] of probes.entries()) {
    need(isStr(pr.name), `probes[${i}] 缺 name`);
    need(isStr(pr.path), `probes[${i}] 缺 path`);
    need(isStr(pr.what), `probes[${i}] 缺 what`);
    if (isStr(pr.path)) need(fs.existsSync(path.resolve(dir, pr.path)), `probe 不存在：${pr.path}`);
  }
}

function checkAnimatic() {
  need(isStr(t.animatic), 'timing.animatic 必须指向真实 animatic 文件');
  if (!isStr(t.animatic)) return;
  const fp = path.resolve(dir, t.animatic);
  need(fs.existsSync(fp), `animatic 不存在：${t.animatic}`);
  if (!fs.existsSync(fp)) return;
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fp], { encoding: 'utf8' }).trim();
    const dur = Number(out);
    need(Number.isFinite(dur) && Math.abs(dur - t.totalSeconds) <= 0.25, `animatic 时长 ${dur}s 与 totalSeconds ${t.totalSeconds}s 不一致`);
  } catch {
    need(false, 'ffprobe 读不了 animatic 时长');
  }
}

function checkScenes() {
  const scenes = p.scenes ?? [];
  need(Array.isArray(scenes) && scenes.length >= 1, 'scenes 至少 1 个');
  if (!Array.isArray(scenes) || !scenes.length) return;
  const fps = brief?.format?.fps ?? 30;
  const totalFrames = Math.round((t.totalSeconds ?? 0) * fps);
  const sorted = [...scenes].sort((a, b) => a.from - b.from);
  let covered = 0;
  for (const [i, s] of sorted.entries()) {
    need(isInt(s.from) && s.from >= 0, `scenes[${i}].from 必须是 >=0 的整数`);
    need(isInt(s.duration) && s.duration > 0, `scenes[${i}].duration 必须是 >0 的整数`);
    if (isInt(s.from) && isInt(s.duration)) {
      need(s.from <= covered + 1, `scenes[${i}] 与前一 scene 之间有未覆盖帧（from ${s.from} > covered ${covered}）`);
      covered = Math.max(covered, s.from + s.duration);
    }
  }
  need(covered >= totalFrames - 1, `scenes 只覆盖到 ${covered} 帧，总长 ${totalFrames} 帧`);
}

if (directorPhase) { checkDirector(); checkLibrary(false); }
if (buildPhase || final) { checkDirector(false); checkLibrary(buildPhase || final); }
if (buildPhase) {
  if (p.pushback !== undefined) {
    need(p.pushback.status === 'applied' && isStr(p.pushback.approvedBy), 'pushback 未批准：先回 Director/用户，不能直接 build');
  }
  need(t.status === 'measured', '--build 要求 timing.status = measured（先跑 animatic 量段长）');
  checkScenes();
  checkProbes();
  checkAnimatic();
}

// final 要求
if (final) {
  need(t.status === 'measured', '--final 要求 timing.status = measured（先跑 animatic 量段长）');
  checkScenes();
  need(Array.isArray(p.qa?.frames) && p.qa.frames.length >= 1, '--final 要求 qa.frames 至少 1 个');
  need(Array.isArray(p.qa?.motionClips) && p.qa.motionClips.length >= 1, '--final 要求 qa.motionClips 至少 1 个');
  for (const [i, f] of (p.qa?.frames ?? []).entries()) {
    need(isStr(f) && fs.existsSync(path.resolve(dir, f)), `qa.frames[${i}] 文件不存在：${f}`);
  }
  for (const [i, f] of (p.qa?.motionClips ?? []).entries()) {
    need(isStr(f) && fs.existsSync(path.resolve(dir, f)), `qa.motionClips[${i}] 文件不存在：${f}`);
  }
  need(isStr(p.qa?.finalVideo), '--final 要求 qa.finalVideo 指向成片');
  if (isStr(p.qa?.finalVideo)) {
    const fv = path.resolve(dir, p.qa.finalVideo);
    need(fs.existsSync(fv), `finalVideo 不存在：${p.qa.finalVideo}`);
    if (fs.existsSync(fv)) {
      try {
        const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fv], { encoding: 'utf8' }).trim();
        const dur = Number(out);
        need(Number.isFinite(dur) && Math.abs(dur - t.totalSeconds) <= 0.25, `finalVideo 时长 ${dur}s 与 totalSeconds ${t.totalSeconds}s 不一致`);
      } catch {
        need(false, 'ffprobe 读不了 finalVideo 时长');
      }
    }
  }
}

// 占位
const text = JSON.stringify(p);
need(!/待定|TODO|TBD|<.*?>/.test(text), '还有占位符/待定');

if (errors.length) {
  console.error(`✗ production 未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ production 通过：${path.basename(file)}（${p.mode} / ${directorPhase ? 'director' : buildPhase ? 'build' : final ? 'final' : 'plan'}）`);

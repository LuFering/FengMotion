#!/usr/bin/env node
/**
 * animatic-review.json 校验（无依赖）
 *
 * 用法：
 *   node tools/validate-animatic-review.mjs <animatic-review.json> [--shot-plan <shot-plan.json>]
 *   node tools/validate-animatic-review.mjs --hash <shot-plan.json>
 *
 * 校验重点：
 * - review 绑定当前 shot-plan 的 sha256；
 * - 覆盖全片时长的完整播放范围；
 * - status=passed 时不能有未处理 blocker/major，rework.required=false；
 * - status=needs-revision 时必须给出返工目标。
 * 不评价镜头是否好看；只验证“animatic 是否真的被完整审查过、结论是否可执行”。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateShotPlan } from './validate-shot-plan.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isInt = (v) => Number.isInteger(v);
const isArr = Array.isArray;
const isHex64 = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

export function shotPlanHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function coversTimeline(ranges, total) {
  if (!isArr(ranges) || ranges.length === 0 || !isInt(total) || total <= 0) return false;
  const rs = ranges
    .filter((r) => isArr(r) && r.length === 2 && isInt(r[0]) && isInt(r[1]))
    .map((r) => [Math.max(0, r[0]), Math.min(total - 1, r[1])])
    .sort((a, b) => a[0] - b[0]);
  if (rs.length === 0 || rs[0][0] > 0) return false;
  let end = rs[0][1];
  for (const [a, b] of rs.slice(1)) {
    if (a > end + 1) return false;
    end = Math.max(end, b);
  }
  return end >= total - 1;
}

export function validateAnimaticReview(review, opts) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  const shotPlan = opts.shotPlanDoc ?? JSON.parse(fs.readFileSync(opts.shotPlanPath, 'utf8'));
  const shotPlanErrors = validateShotPlan(shotPlan);
  for (const e of shotPlanErrors) errors.push(`shot-plan：${e}`);

  need(isObj(review), 'animatic-review 必须是 JSON 对象');
  if (!isObj(review)) return errors;
  need(review.schemaVersion === '1.0', 'schemaVersion 必须是 "1.0"');
  need(review.type === 'animatic-review', 'type 必须是 "animatic-review"');
  need(isStr(review.filmId), 'filmId 不能为空');
  need(isHex64(review.shotPlanHash), 'shotPlanHash 必须是 sha256（64 位小写 hex）');

  const currentHash = opts.shotPlanPath ? shotPlanHash(opts.shotPlanPath) : null;
  if (currentHash) need(review.shotPlanHash === currentHash, 'shotPlanHash 与当前 shot-plan 不一致（animatic 已过期）');

  const total = isInt(review.durationInFrames) ? review.durationInFrames : 0;
  need(isInt(review.durationInFrames) && review.durationInFrames > 0, 'durationInFrames 必须是正整数');
  if (isInt(shotPlan?.durationInFrames) && total > 0) {
    need(total === shotPlan.durationInFrames, `durationInFrames 必须与 shot-plan 一致（${shotPlan.durationInFrames}）`);
  }

  need(isStr(review.animatic), 'animatic 路径不能为空');
  const reviewDir = opts.reviewDir ?? (opts.reviewPath ? path.dirname(path.resolve(opts.reviewPath)) : process.cwd());
  const animaticPath = isStr(review.animatic)
    ? (path.isAbsolute(review.animatic) ? review.animatic : path.resolve(reviewDir, review.animatic))
    : null;
  if (animaticPath) {
    need(fs.existsSync(animaticPath), `animatic 文件不存在：${animaticPath}`);
    if (fs.existsSync(animaticPath)) need(fs.statSync(animaticPath).size > 0, 'animatic 文件为空');
  }

  need(isObj(review.reviewer) && ['model', 'human'].includes(review.reviewer.type), 'reviewer.type 必须是 model/human');
  need(review.fullPlaybackReviewed === true, 'fullPlaybackReviewed 必须为 true（animatic 必须完整播放）');
  need(isArr(review.reviewedRanges) && coversTimeline(review.reviewedRanges, total), 'reviewedRanges 必须无缺口覆盖整片 animatic');

  need(isObj(review.noSubtitleTest), 'noSubtitleTest 必须是对象');
  if (isObj(review.noSubtitleTest)) {
    need(typeof review.noSubtitleTest.reviewed === 'boolean', 'noSubtitleTest.reviewed 必须是布尔值');
    need(['pass', 'fail'].includes(review.noSubtitleTest.result), 'noSubtitleTest.result 必须是 pass/fail');
    need(typeof review.noSubtitleTest.notes === 'string', 'noSubtitleTest.notes 必须是字符串');
    if (review.status === 'passed') {
      need(review.noSubtitleTest.reviewed === true, 'status=passed 时 noSubtitleTest.reviewed 必须为 true');
      need(review.noSubtitleTest.result === 'pass', 'status=passed 时 noSubtitleTest.result 必须为 pass（遮住字幕也能看懂事件）');
    }
  }

  need(['passed', 'needs-revision'].includes(review.status), 'status 必须是 passed/needs-revision');
  need(isArr(review.findings), 'findings 必须是数组');

  const findings = isArr(review.findings) ? review.findings : [];
  for (const [i, f] of findings.entries()) {
    need(isObj(f), `findings[${i}] 必须是对象`);
    if (!isObj(f)) continue;
    need(isStr(f.id), `findings[${i}].id 不能为空`);
    need(['blocker', 'major', 'minor'].includes(f.severity), `findings[${i}].severity 必须是 blocker/major/minor`);
    need(isStr(f.observation), `findings[${i}].observation 不能为空`);
    need(isStr(f.expected), `findings[${i}].expected 不能为空`);
    need(isStr(f.likelyOwner), `findings[${i}].likelyOwner 不能为空`);
    need(isArr(f.evidence) && f.evidence.length >= 1, `findings[${i}].evidence 至少 1 条`);
    need((isArr(f.timeRangeSec) && f.timeRangeSec.length === 2) || (isArr(f.frameRange) && f.frameRange.length === 2), `findings[${i}] 需要 timeRangeSec 或 frameRange`);
  }

  need(isObj(review.rework), 'rework 必须是对象');
  if (isObj(review.rework)) {
    need(typeof review.rework.required === 'boolean', 'rework.required 必须是布尔值');
    need(isArr(review.rework.targets), 'rework.targets 必须是数组');
    const allowed = ['shot-plan', 'animation', 'execution', 'visual', 'sound'];
    for (const t of (isArr(review.rework.targets) ? review.rework.targets : [])) {
      need(allowed.includes(t), `rework.targets 含未知目标：${t}`);
    }
  }

  if (review.status === 'passed') {
    need(!findings.some((f) => isObj(f) && ['blocker', 'major'].includes(f.severity)), 'status=passed 时不能有 blocker/major finding');
    need(isObj(review.rework) && review.rework.required === false, 'status=passed 时 rework.required 必须为 false');
    need(isObj(review.rework) && isArr(review.rework.targets) && review.rework.targets.length === 0, 'status=passed 时 rework.targets 必须为空');
  }
  if (review.status === 'needs-revision') {
    need(isObj(review.rework) && review.rework.required === true, 'status=needs-revision 时 rework.required 必须为 true');
    need(isObj(review.rework) && isArr(review.rework.targets) && review.rework.targets.length >= 1, 'status=needs-revision 时必须给出 rework.targets');
  }

  return errors;
}

function main() {
  const args = process.argv.slice(2);
  const hashIdx = args.indexOf('--hash');
  if (hashIdx >= 0) {
    const file = args[hashIdx + 1];
    if (!file) {
      console.error('用法：node tools/validate-animatic-review.mjs --hash <shot-plan.json>');
      process.exit(2);
    }
    console.log(shotPlanHash(path.resolve(file)));
    process.exit(0);
  }

  const reviewPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--shot-plan');
  if (!reviewPath) {
    console.error('用法：node tools/validate-animatic-review.mjs <animatic-review.json> [--shot-plan <shot-plan.json>]');
    process.exit(2);
  }
  const shotPlanArg = args[args.indexOf('--shot-plan') + 1];
  const reviewAbs = path.resolve(reviewPath);
  const shotPlanPath = shotPlanArg ? path.resolve(shotPlanArg) : path.join(path.dirname(reviewAbs), 'shot-plan.json');

  let review;
  try {
    review = JSON.parse(fs.readFileSync(reviewAbs, 'utf8'));
  } catch (e) {
    console.error(`✗ animatic-review 读取/解析失败：${e.message}`);
    process.exit(1);
  }
  if (!fs.existsSync(shotPlanPath)) {
    console.error(`✗ shot-plan 不存在：${shotPlanPath}`);
    process.exit(1);
  }

  const errors = validateAnimaticReview(review, { shotPlanPath, reviewPath: reviewAbs, reviewDir: path.dirname(reviewAbs) });
  if (errors.length) {
    console.error(`✗ animatic-review 未通过（${errors.length} 项）：`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ animatic-review 通过：${review.status} · ${review.shotPlanHash.slice(0, 12)}… · ${review.reviewedRanges.length} 个审片区间`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();

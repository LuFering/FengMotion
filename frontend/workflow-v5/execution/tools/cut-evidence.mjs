#!/usr/bin/env node
/**
 * 切点证据生成（无依赖，需要系统 ffmpeg）
 *
 * 用法：
 *   node tools/cut-evidence.mjs --video <mp4> --shot-plan <shot-plan.json> --out <dir>
 *
 * 为 shot-plan 中每个切点生成 before/at/after 三帧，运行 freeze/black 检测，并写 cut-evidence.json。
 * 这些帧和检测报告只用于审片定位，不替代导演判断，也不使用固定帧差阈值判定好坏。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateShotPlan } from '../../prompt-first/tools/validate-shot-plan.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const video = arg('--video');
const shotPlanPath = arg('--shot-plan');
const outDir = arg('--out');

if (!video || !shotPlanPath || !outDir) {
  console.error('用法：node tools/cut-evidence.mjs --video <mp4> --shot-plan <shot-plan.json> --out <dir>');
  process.exit(2);
}
if (!fs.existsSync(video)) {
  console.error(`✗ 视频不存在：${video}`);
  process.exit(1);
}

let plan;
try {
  plan = JSON.parse(fs.readFileSync(path.resolve(shotPlanPath), 'utf8'));
} catch (e) {
  console.error(`✗ shot-plan 读取/解析失败：${e.message}`);
  process.exit(1);
}
const errors = validateShotPlan(plan);
if (errors.length) {
  console.error(`✗ shot-plan 未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const fps = plan.fps;
const cuts = [];
const freezeMin = Number(arg('--freeze-min', '1.0'));
const freezeNoise = arg('--freeze-noise', '0.0015');
const blackMin = Number(arg('--black-min', '0.2'));

function detect(args, label) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', video, ...args, '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.error) return { ok: false, error: r.error.message, stderr: '' };
  return { ok: r.status === 0, error: r.status === 0 ? null : `ffmpeg exit ${r.status}`, stderr: r.stderr || '' };
}

const freezeRun = detect(['-vf', `freezedetect=n=${freezeNoise}:d=${freezeMin}`], 'freeze');
const blackRun = detect(['-vf', `blackdetect=d=${blackMin}:pix_th=0.10`], 'black');

function parseFreezes(stderr) {
  const starts = [...stderr.matchAll(/freeze_start:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
  const durations = [...stderr.matchAll(/freeze_duration:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/freeze_end:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
  return starts.map((start, i) => ({ start, duration: durations[i] ?? null, end: ends[i] ?? null }));
}
function parseBlacks(stderr) {
  return [...stderr.matchAll(/black_start:\s*([0-9.]+)\s+black_end:\s*([0-9.]+)\s+black_duration:\s*([0-9.]+)/g)]
    .map((m) => ({ start: Number(m[1]), end: Number(m[2]), duration: Number(m[3]) }));
}
const freezes = parseFreezes(freezeRun.stderr);
const blacks = parseBlacks(blackRun.stderr);
const freezeReport = path.join(outDir, 'freeze-report.txt');
const blackReport = path.join(outDir, 'black-report.txt');
fs.writeFileSync(freezeReport, freezeRun.stderr.split('\n').filter((l) => /freeze_|freezedetect/.test(l)).join('\n') + '\n');
fs.writeFileSync(blackReport, blackRun.stderr.split('\n').filter((l) => /black_|blackdetect/.test(l)).join('\n') + '\n');

function grab(frame, name) {
  const file = path.join(outDir, name);
  const sec = Math.max(0, frame / fps);
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-ss', String(sec), '-i', video, '-frames:v', '1', '-y', file], { stdio: 'ignore' });
  } catch (e) {
    console.error(`✗ ffmpeg 抽帧失败（frame ${frame}）：${e.message}`);
    process.exit(1);
  }
  return file;
}

for (const shot of plan.shots) {
  if (!Number.isInteger(shot.from) || shot.from <= 0) continue;
  const id = shot.id;
  const before = grab(shot.from - 1, `cut-${id}-before.png`);
  const at = grab(shot.from, `cut-${id}-at.png`);
  const after = grab(shot.from + 1, `cut-${id}-after.png`);
  cuts.push({ shotId: id, frame: shot.from, timeSec: Number((shot.from / fps).toFixed(3)), before, at, after, transitionIntent: shot.transitionIntent });
}

const report = {
  schemaVersion: '1.0',
  type: 'cut-evidence',
  video: path.resolve(video),
  shotPlan: path.resolve(shotPlanPath),
  fps,
  durationInFrames: plan.durationInFrames,
  cuts,
  detection: {
    freezeMinSec: freezeMin,
    freezeNoise,
    blackMinSec: blackMin,
    freezeOk: freezeRun.ok,
    freezeError: freezeRun.error,
    blackOk: blackRun.ok,
    blackError: blackRun.error,
    freezes,
    blacks,
    freezeReport: path.basename(freezeReport),
    blackReport: path.basename(blackReport),
  },
  note: 'before/at/after 与 freeze/black 报告仅用于定位；不要用固定帧差阈值替代审片判断。',
};
fs.writeFileSync(path.join(outDir, 'cut-evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`✓ 切点证据已生成：${cuts.length} 个切点 → ${outDir}`);
console.log('  审片时检查：前一镜的 stateOut 是否等于后一镜的 stateIn；动作是否被截断；切点是否有 transitionIntent。');
console.log(`  freeze 报告：${freezes.length} 段；black 报告：${blacks.length} 段；详情见 ${outDir}`);

#!/usr/bin/env node
/**
 * 切点证据生成（无依赖，需要系统 ffmpeg）
 *
 * 用法：
 *   node tools/cut-evidence.mjs --video <mp4> --shot-plan <shot-plan.json> --out <dir>
 *
 * 为 shot-plan 中每个切点生成 before/at/after 三帧，并写 cut-evidence.json。
 * 这些帧只用于审片定位，不替代导演判断，也不使用固定帧差阈值判定好坏。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
  note: 'before/at/after 仅用于定位切点状态变化；不要用固定帧差阈值替代审片判断。',
};
fs.writeFileSync(path.join(outDir, 'cut-evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`✓ 切点证据已生成：${cuts.length} 个切点 → ${outDir}`);
console.log('  审片时检查：前一镜的 stateOut 是否等于后一镜的 stateIn；动作是否被截断；切点是否有 transitionIntent。');

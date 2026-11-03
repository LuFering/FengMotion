import fs from 'node:fs';
import path from 'node:path';

/**
 * 按逐句旁白估时长，并给每句写 at。
 *
 * 用法：
 *   node tools/estimate-duration.mjs path/to/brief.json
 *   node tools/estimate-duration.mjs path/to/brief.json --write
 *
 * 默认语速 4.5 字/秒（中文慢速 VO），句间停顿 0.35s。
 * 只处理 content.script；没有 script 的 brief 直接退出。
 */

const file = process.argv[2];
const write = process.argv.includes('--write');
if (!file) {
  console.error('用法：node tools/estimate-duration.mjs <brief.json> [--write]');
  process.exit(2);
}

const abs = path.resolve(process.cwd(), file);
const brief = JSON.parse(fs.readFileSync(abs, 'utf8'));
const script = brief.content?.script ?? [];
if (!script.length) {
  console.log('没有 content.script，跳过时长估算。');
  process.exit(0);
}

const RATE = 4.5; // 字/秒
const PAUSE = 0.35; // 句间停顿

const chars = (s) => (s.match(/[\u4e00-\u9fffA-Za-z0-9]/g) ?? []).length;

let t = 0;
const rows = [];
for (const line of script) {
  const n = chars(line.text);
  const dur = n / RATE;
  rows.push({ id: line.id, at: +t.toFixed(2), chars: n, dur: +dur.toFixed(2) });
  t += dur + PAUSE;
}
const total = +(t - PAUSE).toFixed(2);
const recommended = Math.ceil(total / 5) * 5;

console.log(`逐句估算（${RATE} 字/秒，停顿 ${PAUSE}s）：`);
for (const r of rows) console.log(`  ${r.id}  at=${r.at}s  ${r.chars} 字  ${r.dur}s`);
console.log(`总时长约 ${total}s；建议 format.durationSec = ${recommended}`);

if (write) {
  brief.content.script = brief.content.script.map((line, i) => ({ ...line, at: rows[i].at }));
  brief.format.durationSec = recommended;
  fs.writeFileSync(abs, JSON.stringify(brief, null, 2) + '\n');
  console.log(`已写入 ${file}（script[].at + durationSec=${recommended}）`);
}

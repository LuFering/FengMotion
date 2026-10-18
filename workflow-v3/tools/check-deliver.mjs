import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * 交付门：成片真的存在、规格对得上、视觉审片不是“待确认”。
 *
 * 用法：
 *   node workflow-v3/tools/check-deliver.mjs --film workflow-v3/films/<id>
 */

const args = process.argv.slice(2);
const filmArg = args.includes('--film') ? args[args.indexOf('--film') + 1] : null;
if (!filmArg) {
  console.error('用法：node workflow-v3/tools/check-deliver.mjs --film <片目录>');
  process.exit(2);
}

const film = path.resolve(process.cwd(), filmArg);
const errors = [];
const need = (cond, msg) => {
  if (!cond) errors.push(msg);
};
const exists = (p) => fs.existsSync(p);
const read = (p) => fs.readFileSync(p, 'utf8');

const specPath = ['02-scene.spec.json', 'scene.spec.json']
  .map((f) => path.join(film, f))
  .find((p) => exists(p));
need(!!specPath, '找不到 02-scene.spec.json / scene.spec.json');
const spec = specPath ? JSON.parse(read(specPath)) : null;

// 1. 必需文件
for (const f of ['04-acceptance.md', '05-visual-review.md', 'deliver.json']) {
  need(exists(path.join(film, f)) && fs.statSync(path.join(film, f)).size > 0, `缺少或为空：${f}`);
}

// 2. 自动验收记录
if (exists(path.join(film, '04-acceptance.md'))) {
  const s = read(path.join(film, '04-acceptance.md'));
  need(/tsc/i.test(s), '04-acceptance 没写 tsc 结果');
  need(/validate-scene|场景规格/i.test(s), '04-acceptance 没写场景规格校验结果');
  need(/确定性|同帧/i.test(s), '04-acceptance 没写确定性检查');
}

// 3. 视觉审片
if (exists(path.join(film, '05-visual-review.md'))) {
  const s = read(path.join(film, '05-visual-review.md'));
  need(/- \[x\]\s*通过/.test(s) || /结论[:：]\s*通过/.test(s), '05-visual-review 没有勾选“通过”');
  need(!/待确认|待审|TODO/i.test(s), '05-visual-review 还是“待确认”');
  need(!/<原话/.test(s), '05-visual-review 的用户原话还是占位符');
  need(/用户原话/.test(s), '05-visual-review 没写用户原话');
}

// 4. 成片文件 + 规格
if (exists(path.join(film, 'deliver.json')) && spec) {
  const d = JSON.parse(read(path.join(film, 'deliver.json')));
  need(typeof d.video === 'string' && d.video.length > 0, 'deliver.json 缺 video');
  if (typeof d.video === 'string' && d.video.length > 0) {
    const video = path.isAbsolute(d.video)
      ? d.video
      : [path.resolve(process.cwd(), d.video), path.resolve(film, d.video)].find((p) => exists(p));
    need(!!video && exists(video), `成片不存在：${d.video}`);
    if (video && exists(video)) {
      try {
        const probe = JSON.parse(
          execFileSync(
            'ffprobe',
            ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', video],
            { encoding: 'utf8' },
          ),
        );
        const v = (probe.streams ?? []).find((s) => s.codec_type === 'video');
        const a = (probe.streams ?? []).find((s) => s.codec_type === 'audio');
        need(!!v, '成片没有视频流');
        if (v) {
          need(v.width === spec.width, `成片宽 ${v.width} ≠ spec ${spec.width}`);
          need(v.height === spec.height, `成片高 ${v.height} ≠ spec ${spec.height}`);
          const [num, den] = String(v.r_frame_rate).split('/').map(Number);
          const fps = den ? Math.round(num / den) : Math.round(num);
          need(fps === spec.fps, `成片帧率 ${fps} ≠ spec ${spec.fps}`);
        }
        const dur = Number(probe.format?.duration ?? 0);
        const expected = spec.durationInFrames / spec.fps;
        need(Math.abs(dur - expected) <= 0.25, `成片时长 ${dur.toFixed(2)}s ≠ 预期 ${expected.toFixed(2)}s`);
        if (d.audio === true) need(!!a, 'deliver.json 写了 audio=true，但成片没有音轨');
      } catch (e) {
        errors.push(`ffprobe 读不了成片：${e.message}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`✗ 交付门未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(`✓ 交付门通过：${path.basename(film)} 可以交付`);

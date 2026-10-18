import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * 门 0：写任何组件之前跑。
 *
 * 用法：
 *   node workflow-v3/tools/check-precode.mjs --film workflow-v3/films/<id>
 *
 * 它只回答一件事：现在能不能开始写代码。
 * 不能，就列出缺什么；不要靠 AI 自觉。
 */

const args = process.argv.slice(2);
const filmArg = args.includes('--film') ? args[args.indexOf('--film') + 1] : null;
if (!filmArg) {
  console.error('用法：node workflow-v3/tools/check-precode.mjs --film <片目录>');
  process.exit(2);
}

const film = path.resolve(process.cwd(), filmArg);
const errors = [];
let referenceLog = null;
const expand = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const need = (cond, msg) => {
  if (!cond) errors.push(msg);
};
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

if (!exists(film)) {
  console.error(`✗ 片目录不存在：${film}`);
  process.exit(1);
}

// 1. 必需文件
const specFile = exists(path.join(film, '02-scene.spec.json'))
  ? '02-scene.spec.json'
  : exists(path.join(film, 'scene.spec.json'))
    ? 'scene.spec.json'
    : '02-scene.spec.json';
const contractFile = exists(path.join(film, '03-component-contracts.md'))
  ? '03-component-contracts.md'
  : exists(path.join(film, '02-组件合同.md'))
    ? '02-组件合同.md'
    : '03-component-contracts.md';

const required = [
  '00-开工.md',
  '01-reference.md',
  specFile,
  contractFile,
  'reference-log.json',
  'style-fingerprint.json',
  'approved.md',
];
for (const f of required) {
  const p = path.join(film, f);
  need(exists(p) && fs.statSync(p).size > 0, `缺少或为空：${f}`);
}

// 2. 关键画面：至少 2 张
const keyframesDir = path.join(film, 'keyframes');
const images = exists(keyframesDir)
  ? fs.readdirSync(keyframesDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
  : [];
need(images.length >= 2, `keyframes/ 至少 2 张关键画面，现在 ${images.length} 张`);

// 3. 先写代码 = 直接失败
const componentsDir = path.join(film, 'components');
const codeFiles = exists(componentsDir)
  ? fs.readdirSync(componentsDir).filter((f) => f.endsWith('.tsx'))
  : [];
need(codeFiles.length === 0, `components/ 已有 ${codeFiles.length} 个 .tsx；先写代码了，退回`);

// 4. 参考日志
if (exists(path.join(film, 'reference-log.json'))) {
  try {
    const log = JSON.parse(read(path.join(film, 'reference-log.json')));
    referenceLog = log;
    need(Array.isArray(log.cards) && log.cards.length >= 3, `reference-log.cards 至少 3 张，现在 ${log.cards?.length ?? 0}`);
    need(Array.isArray(log.refs) && log.refs.length >= 1, `reference-log.refs 至少 1 个参考时间码，现在 ${log.refs?.length ?? 0}`);
    need(typeof log.selected === 'string' && log.selected.trim().length > 0, 'reference-log.selected 为空（还没选方向）');
    for (const [i, c] of (log.cards ?? []).entries()) {
      need(typeof c.name === 'string' && c.name.length > 0, `reference-log.cards[${i}] 缺 name`);
      need(typeof c.openedAt === 'string' && c.openedAt.length > 0, `reference-log.cards[${i}] 缺 openedAt`);
    }
    const cardDir = path.join(os.homedir(), 'AIremotion-skill/02-镜头卡库/video-shotcraft/gallery/source');
    for (const [i, c] of (log.cards ?? []).entries()) {
      if (typeof c.name === 'string' && c.name.length > 0) {
        need(fs.existsSync(path.join(cardDir, `${c.name}.md`)), `reference-log.cards[${i}] 卡名不存在：${c.name}`);
      }
    }
    for (const [i, r] of (log.refs ?? []).entries()) {
      need(typeof r.file === 'string' && r.file.length > 0, `reference-log.refs[${i}] 缺 file`);
      need(r.timecode !== undefined && r.timecode !== '', `reference-log.refs[${i}] 缺 timecode`);
      if (typeof r.file === 'string' && r.file.length > 0) {
        const refPath = r.file.includes('/') ? expand(r.file) : path.join(os.homedir(), 'Videos', r.file);
        need(fs.existsSync(refPath), `reference-log.refs[${i}] 文件不存在：${refPath}`);
        if (fs.existsSync(refPath) && r.timecode !== undefined) {
          try {
            const dur = Number(
              execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', refPath], {
                encoding: 'utf8',
              }).trim(),
            );
            need(Number(r.timecode) <= dur + 0.05, `reference-log.refs[${i}] 时间码 ${r.timecode} 超出视频时长 ${dur.toFixed(2)}s`);
          } catch {
            errors.push(`reference-log.refs[${i}] ffprobe 读不了：${refPath}`);
          }
        }
        if (typeof r.frame === 'string' && r.frame.length > 0) {
          need(fs.existsSync(path.join(film, r.frame)), `reference-log.refs[${i}] 抽帧不存在：${r.frame}`);
        }
      }
    }
  } catch (e) {
    errors.push(`reference-log.json 不是合法 JSON：${e.message}`);
  }
}

// 4.5 顺序：参考分析不能晚于场景规格
if (exists(path.join(film, '01-reference.md')) && exists(path.join(film, '02-scene.spec.json'))) {
  const refM = fs.statSync(path.join(film, '01-reference.md')).mtimeMs;
  const specM = fs.statSync(path.join(film, '02-scene.spec.json')).mtimeMs;
  need(refM <= specM, '01-reference.md 比 02-scene.spec.json 新：先写规格后补参考，顺序不对');
}

// 5. 参考分析：必须有选定方向
if (exists(path.join(film, '01-reference.md'))) {
  const s = read(path.join(film, '01-reference.md'));
  need(s.includes('选定'), '01-reference.md 没有“选定”方向');
  need((s.match(/方向/g) ?? []).length >= 2, '01-reference.md 至少写 2 个方向');
}

// 6. 开工记录：模型 + 读过什么
if (exists(path.join(film, '00-开工.md'))) {
  const s = read(path.join(film, '00-开工.md'));
  need(/模型|model/i.test(s), '00-开工.md 没写模型');
  need(/已读|读完|read/i.test(s), '00-开工.md 没写读过哪些文档');
}

// 7. 场景规格：schemaVersion + source + assetStrategy
if (exists(path.join(film, specFile))) {
  try {
    const spec = JSON.parse(read(path.join(film, specFile)));
    need(Array.isArray(spec.scenes) && spec.scenes.length > 0, 'scene.spec.scenes 不能为空');
    for (const [i, s] of (spec.scenes ?? []).entries()) {
      const tag = `scenes[${i}](${s.sceneId ?? '?'})`;
      if (referenceLog) {
        const cards = (referenceLog.cards ?? []).map((c) => c.name).filter(Boolean);
        const refs = referenceLog.refs ?? [];
        if (s.source?.type === 'self') {
          const hits = cards.filter((n) => s.source.proof.includes(n));
          need(hits.length >= 2, `${tag} self 举证不足：proof 里至少写 2 个 reference-log.cards 的卡名（现在 ${hits.length} 个）`);
        }
        if (s.source?.type === 'card') {
          need(cards.includes(s.source.id), `${tag} source.card=${s.source.id} 不在 reference-log.cards 里`);
        }
        if (s.source?.type === 'ref') {
          const id = String(s.source.id);
          need(refs.some((r) => id.includes(String(r.file)) && id.includes(String(r.timecode))), `${tag} source.ref=${id} 不在 reference-log.refs 里`);
        }
      }
    }
    // 每个组件都要在 03-component-contracts.md 里出现
    if (exists(path.join(film, contractFile))) {
      const contracts = read(path.join(film, contractFile));
      for (const s of spec.scenes ?? []) {
        if (typeof s.component === 'string') {
          need(contracts.includes(s.component), `组件合同里没有 ${s.component}`);
        }
      }
    }
  } catch (e) {
    errors.push(`02-scene.spec.json 不是合法 JSON：${e.message}`);
  }
}

// 8. 用户确认关键画面
if (exists(path.join(film, 'approved.md'))) {
  const s = read(path.join(film, 'approved.md')).trim();
  need(s.length >= 10, 'approved.md 太短：要写用户对关键画面的原话');
  need(!/待确认|待用户|TODO/i.test(s), 'approved.md 还是“待确认”：用户还没看关键画面');
}

// 8.5 风格指纹：和已有片子重合 ≥3 项，必须写差异说明
const stylePath = path.join(film, 'style-fingerprint.json');
if (exists(stylePath)) {
  try {
    const cur = JSON.parse(read(stylePath));
    const allowed = {
      palette: ['dark', 'light', 'warm', 'cool', 'mono', 'mixed'],
      composition: ['centered', 'off-center', 'layered', 'minimal', 'grid'],
      subject: ['city', 'people', 'nature', 'object', 'abstract', 'data', 'text'],
      density: ['sparse', 'medium', 'dense'],
    };
    for (const [k, vals] of Object.entries(allowed)) {
      need(vals.includes(cur[k]), `style-fingerprint.${k}=${cur[k]} 不合法（${vals.join('/')}）`);
    }
    need(Array.isArray(cur.motion) && cur.motion.length > 0, 'style-fingerprint.motion 不能为空');

    const filmsDir = path.dirname(film);
    const prev = fs
      .readdirSync(filmsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== '_template' && path.join(filmsDir, d.name) !== film)
      .map((d) => path.join(filmsDir, d.name))
      .filter((d) => exists(path.join(d, 'style-fingerprint.json')));

    const overlaps = [];
    for (const dir of prev) {
      const p = JSON.parse(read(path.join(dir, 'style-fingerprint.json')));
      let match = ['palette', 'composition', 'subject', 'density'].filter((k) => p[k] === cur[k]).length;
      const inter = (cur.motion ?? []).filter((m) => (p.motion ?? []).includes(m)).length;
      if (inter >= 2) match += 1;
      if (match >= 3) overlaps.push(`${path.basename(dir)}（${match}/5）`);
    }

    if (overlaps.length) {
      const divPath = path.join(film, 'style-diversity.md');
      const div = exists(divPath) ? read(divPath).trim() : '';
      need(
        div.length >= 20 && !/待填写|TODO/i.test(div),
        `与 ${overlaps.join('、')} 风格重合 ≥3 项；要写 style-diversity.md 说明为什么还要同一套语法`,
      );
    }
  } catch (e) {
    errors.push(`style-fingerprint.json 不是合法 JSON：${e.message}`);
  }
}

// 9. 用唯一校验器做完整 spec 检查（跳过组件存在性）
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
try {
  execFileSync(process.execPath, [path.join(toolsDir, 'validate-scene.mjs'), '--film', film, '--spec-only'], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
} catch (e) {
  const out = (e.stdout || '') + (e.stderr || '');
  errors.push(`scene.spec 未通过：\n${out.trim()}`);
}

if (errors.length) {
  console.error(`✗ 门 0 未通过（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(`✓ 门 0 通过：${path.basename(film)} 可以开始写组件`);

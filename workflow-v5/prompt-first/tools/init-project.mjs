#!/usr/bin/env node
/**
 * Prompt-first 项目初始化/检查（v5，无依赖）
 *
 * 用法：
 *   node tools/init-project.mjs <project-dir> --film-id <id> [--prompt-file <path>] [--force]
 *   node tools/init-project.mjs --check <project-dir>
 *
 * 只做两件事：保存原始创作上下文；建立 qa/passes 目录。
 * 不生成 intent/方向/门禁/规格，不伪造任何批准或渲染记录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateShotPlan } from './validate-shot-plan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(__dirname, '../templates');
const args = process.argv.slice(2);
const errors = [];
const fail = (msg) => { errors.push(msg); };

const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const has = (name) => args.includes(name);

const valueFlags = new Set(['--film-id', '--prompt-file']);
const projectArg = args.find((a, i) => !a.startsWith('--') && !(i > 0 && valueFlags.has(args[i - 1])));
const checkMode = has('--check');
if (!projectArg) {
  console.error('用法：node tools/init-project.mjs <project-dir> --film-id <id> [--prompt-file <path>] [--force]');
  console.error('      node tools/init-project.mjs --check <project-dir>');
  process.exit(2);
}
const projectDir = path.resolve(process.cwd(), projectArg);

const readTemplate = (name) => fs.readFileSync(path.join(templateDir, name), 'utf8');

if (checkMode) {
  const required = ['prompt.original.md', 'corrections.md', 'decisions.md', 'lookdev-brief.md', 'quality-bar.md', 'film-plan.md', 'shot-plan.json', 'project.json'];
  for (const f of required) {
    const p = path.join(projectDir, f);
    if (!fs.existsSync(p)) fail(`缺少 ${f}`);
    else if (f.endsWith('.md') && fs.readFileSync(p, 'utf8').trim().length < 20) fail(`${f} 内容过短`);
  }
  const shotPlanPath = path.join(projectDir, 'shot-plan.json');
  if (fs.existsSync(shotPlanPath)) {
    try {
      const shotPlan = JSON.parse(fs.readFileSync(shotPlanPath, 'utf8'));
      for (const e of validateShotPlan(shotPlan)) fail(`shot-plan.json：${e}`);
    } catch (e) {
      fail(`shot-plan.json 读取/解析失败：${e.message}`);
    }
  }
  if (errors.length) {
    console.error(`✗ Prompt-first 项目检查未通过（${errors.length} 项）：`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ Prompt-first 项目检查通过：${projectDir}`);
  console.log('  提示：prompt.original.md 必须是用户原文；后续纠正追加到 corrections.md。');
  process.exit(0);
}

const filmId = flag('--film-id') ?? path.basename(projectDir);
const promptFile = flag('--prompt-file');
const force = has('--force');

if (!filmId) fail('缺少 --film-id');
if (promptFile && !fs.existsSync(path.resolve(process.cwd(), promptFile))) fail(`原始提示词不存在：${promptFile}`);

if (errors.length) {
  console.error(`✗ 初始化失败（${errors.length} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

fs.mkdirSync(projectDir, { recursive: true });
fs.mkdirSync(path.join(projectDir, 'references'), { recursive: true });
fs.mkdirSync(path.join(projectDir, 'qa', 'passes'), { recursive: true });

const writeIfMissing = (name, content) => {
  const p = path.join(projectDir, name);
  if (fs.existsSync(p) && !force) {
    console.log(`skip ${name}（已存在，不覆盖）`);
    return;
  }
  fs.writeFileSync(p, content);
  console.log(`wrote ${name}`);
};

if (promptFile) {
  const original = fs.readFileSync(path.resolve(process.cwd(), promptFile), 'utf8');
  writeIfMissing('prompt.original.md', original);
} else {
  writeIfMissing('prompt.original.md', readTemplate('prompt.original.md'));
}
writeIfMissing('corrections.md', readTemplate('corrections.md'));
writeIfMissing('decisions.md', readTemplate('decisions.md'));
writeIfMissing('lookdev-brief.md', readTemplate('lookdev-brief.md'));
writeIfMissing('quality-bar.md', readTemplate('quality-bar.md'));
writeIfMissing('film-plan.md', readTemplate('film-plan.md'));
writeIfMissing('shot-plan.json', readTemplate('shot-plan.json'));

const projectJson = path.join(projectDir, 'project.json');
if (!fs.existsSync(projectJson) || force) {
  fs.writeFileSync(projectJson, JSON.stringify({
    schemaVersion: '1.0',
    filmId,
    mode: 'prompt-first',
    createdAt: new Date().toISOString(),
    note: 'prompt.original.md 是用户原文；不要用摘要覆盖。',
  }, null, 2) + '\n');
  console.log('wrote project.json');
}

console.log(`✓ Prompt-first 项目就绪：${projectDir}`);
console.log('  下一步：把用户原始提示词逐字放入 prompt.original.md；先填 lookdev-brief.md / quality-bar.md、film-plan.md、shot-plan.json，再按 prompts/creator.md 开始。');

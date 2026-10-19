import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 搜索本地动效库。
 *
 * 用法：
 *   node tools/search-library.mjs "comparison"
 *   node tools/search-library.mjs "camera shake" --limit 5
 */

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 10 : 10;
const query = args
  .filter((a, i) => a !== '--limit' && (limitIdx < 0 || i !== limitIdx + 1))
  .join(' ')
  .trim();

if (!query) {
  console.error('用法：node tools/search-library.mjs "<关键词>" [--limit N]');
  process.exit(2);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(__dirname, '..', '..', 'library');
const TEMPLATES = path.join(LIB, 'templates');
const CARDS = path.join(LIB, 'cards');

const q = query.toLowerCase();
const results = [];

function firstMatch(text) {
  const lines = text.split('\n');
  const hit = lines.find((l) => l.toLowerCase().includes(q));
  return (hit ?? lines.find((l) => l.trim()) ?? '').trim().slice(0, 180);
}

function scan(dir, kind, ext) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(ext)) continue;
    const full = path.join(dir, name);
    const text = fs.readFileSync(full, 'utf8');
    const inName = name.toLowerCase().includes(q);
    const inText = text.toLowerCase().includes(q);
    if (!inName && !inText) continue;
    results.push({
      kind,
      name: name.replace(ext, ''),
      file: path.relative(path.resolve(__dirname, '..', '..'), full),
      match: inName ? '(文件名匹配)' : firstMatch(text),
      score: inName ? 2 : 1,
    });
  }
}

scan(TEMPLATES, 'TEMPLATE', '.tsx');
scan(CARDS, 'CARD', '.md');

results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

if (!results.length) {
  console.log(`没有匹配 "${query}" 的模板/卡片。`);
  console.log('可用模板示例：');
  const names = fs.readdirSync(TEMPLATES).filter((n) => n.endsWith('.tsx')).slice(0, 12);
  for (const n of names) console.log('  - ' + n.replace('.tsx', ''));
  process.exit(0);
}

console.log(`找到 ${results.length} 条，显示前 ${Math.min(limit, results.length)} 条：`);
for (const r of results.slice(0, limit)) {
  console.log(`\n[${r.kind}] ${r.name}`);
  console.log(`  ${r.file}`);
  console.log(`  ${r.match}`);
  if (r.kind === 'TEMPLATE') {
    console.log(`  import: import ${toPascal(r.name)} from '../library/templates/${r.name}';`);
  }
}

function toPascal(s) {
  return s
    .split(/[-_]/)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
    .join('');
}

#!/usr/bin/env node
/**
 * 生成确定性 build manifest / buildHash（v5，无依赖）
 *
 * 用法：
 *   node tools/build-manifest.mjs <execution.config.json> [--out qa/build-manifest.json] [--root <dir>]
 *
 * buildHash 覆盖：config、动画 spec/蓝图/合同、组件源码、素材、package/lockfile。
 * 不覆盖：qa/out/缓存/无关文档，避免审片报告或输出反向改变 buildHash。
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeBuildManifest } from './lib/build.mjs';

const args = process.argv.slice(2);
const configArg = args.find((a) => !a.startsWith('--'));
if (!configArg) {
  console.error('用法：node tools/build-manifest.mjs <execution.config.json> [--out qa/build-manifest.json] [--root <dir>]');
  process.exit(2);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const configPath = path.resolve(process.cwd(), configArg);
if (!fs.existsSync(configPath)) {
  console.error(`config 不存在：${configArg}`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const baseDir = path.dirname(configPath);
const root = flag('--root') ? path.resolve(process.cwd(), flag('--root')) : baseDir;
const outArg = flag('--out') ?? 'qa/build-manifest.json';
const outPath = path.resolve(baseDir, outArg);

const manifest = computeBuildManifest({ root, configPath, config });
const report = {
  schemaVersion: '1.0',
  type: 'build-manifest',
  filmId: config.filmId,
  createdAt: new Date().toISOString(),
  root: path.relative(process.cwd(), root) || '.',
  fileCount: manifest.fileCount,
  buildHash: manifest.buildHash,
  files: manifest.files,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(`buildHash=${report.buildHash}`);
console.log(`files=${report.fileCount} wrote=${path.relative(baseDir, outPath)}`);

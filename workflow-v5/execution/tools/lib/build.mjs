import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', 'qa', 'out', '.remotion']);

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function walk(dir, out, root) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out, root);
    else if (st.isFile()) out.push(p);
  }
}

function addFile(out, p) {
  if (p && fs.existsSync(p) && fs.statSync(p).isFile()) out.add(p);
}

/**
 * 计算确定性 build manifest。
 * 覆盖：执行配置、动画 spec/蓝图/合同、组件源码、素材、package/lockfile。
 * 不覆盖：qa/out/缓存/无关文档（避免审片报告或输出文件反过来改变 buildHash）。
 */
export function computeBuildManifest({ root, configPath, config }) {
  const base = path.resolve(root);
  const files = new Set();
  addFile(files, path.resolve(configPath));

  const P = config?.paths ?? {};
  const abs = (p) => (p ? path.resolve(base, p) : null);

  // 动画/规格输入
  const animDir = abs(P.animation);
  if (animDir) {
    for (const n of ['animation-blueprint.json', 'implementation-plan.json', 'scene.spec.json', 'scene.spec.draft.json', 'component-contracts.md']) {
      addFile(files, path.join(animDir, n));
    }
  }

  // 组件与素材
  const compDir = abs(P.components ?? 'components');
  const assetDir = abs(P.assets ?? 'assets');
  const collected = [];
  if (compDir) walk(compDir, collected, base);
  if (assetDir) walk(assetDir, collected, base);
  for (const p of collected) files.add(p);

  // 工程版本输入
  for (const n of ['prompt.original.md', 'corrections.md', 'decisions.md', 'package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'remotion.config.ts', 'remotion.config.js']) {
    addFile(files, path.join(base, n));
  }

  const list = [...files]
    .map((p) => ({
      path: path.relative(base, p).split(path.sep).join('/'),
      sha256: sha256File(p),
      size: fs.statSync(p).size,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const aggregate = sha256Text(list.map((f) => `${f.path}:${f.sha256}`).join('\n'));
  return { root: base, files: list, fileCount: list.length, buildHash: aggregate };
}

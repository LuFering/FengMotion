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
  const configDir = path.dirname(path.resolve(configPath));
  const files = new Set();
  addFile(files, path.resolve(configPath));

  const P = config?.paths ?? {};
  // config 里的 paths 相对 config 文件目录；build root 只用于 manifest 相对路径与默认运行时目录
  const abs = (p) => (p ? path.resolve(configDir, p) : null);

  // 动画/规格输入
  const animDir = abs(P.animation);
  if (animDir) {
    for (const n of ['animation-blueprint.json', 'implementation-plan.json', 'scene.spec.json', 'scene.spec.draft.json', 'component-contracts.md']) {
      addFile(files, path.join(animDir, n));
    }
  }

  // 组件/素材按 config 目录解析；默认运行时目录与 build.include 按 build root 解析
  const runtimeRoots = new Set();
  runtimeRoots.add(P.components ? abs(P.components) : path.resolve(base, 'components'));
  runtimeRoots.add(P.assets ? abs(P.assets) : path.resolve(base, 'assets'));
  for (const rel of ['src', 'public', 'styles', 'fonts', 'shared', 'lib', 'remotion']) {
    runtimeRoots.add(path.resolve(base, rel));
  }
  for (const rel of (Array.isArray(config?.build?.include) ? config.build.include : [])) {
    runtimeRoots.add(path.resolve(base, rel));
  }
  const collected = [];
  for (const dir of runtimeRoots) {
    if (dir) walk(dir, collected, base);
  }
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

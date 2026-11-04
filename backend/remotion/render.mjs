/**
 * Remotion 渲染脚本（统一工程）。
 *
 * <p>由后端以子进程方式调用：`node render.mjs --props <文件> --out <文件>`。
 * 输出固定的 JSON 到 stdout，供后端解析结果。</p>
 *
 * <p><strong>依赖从哪来</strong>：不在这里单独 npm install —— Remotion 全家桶
 * 有几百 MB，再装一份纯属浪费。默认复用桌面端已安装的 node_modules
 * （`FENGMOTION_NODE_MODULES` 可覆盖），这也是「统一工程」的一部分：
 * 一份依赖，多处使用。</p>
 *
 * 用法：
 *   node render.mjs --props /tmp/film.json --out /tmp/out.mp4 [--browser /path/to/chrome]
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  cleanup,
  emitResult,
  parseArgs,
  renderProject,
  resolveNodeModules,
  stageWritableCopy,
} from './render-shared.mjs'

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.props || !args.out) {
    emitResult({ ok: false, error: '缺少 --props 或 --out' })
    process.exit(2)
  }

  const nodeModules = resolveNodeModules(import.meta.dirname)
  const props = JSON.parse(await readFile(args.props, 'utf8'))

  /* 内置工程也在只读挂载点上（AppImage），统一复制到可写目录再渲染。
     细节见 render-shared.mjs 的 stageWritableCopy。 */
  const workDir = await stageWritableCopy(path.join(import.meta.dirname, 'src'))

  try {
    const result = await renderProject({
      nodeModules,
      workDir,
      entryPoint: path.join(workDir, 'index.tsx'),
      compositionId: 'Film',
      props,
      out: args.out,
      browser: args.browser,
    })
    emitResult({ ok: true, output: args.out, ...result })
  } finally {
    await cleanup(workDir)
  }
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: error?.message ?? String(error) }) + '\n')
  process.exit(1)
})

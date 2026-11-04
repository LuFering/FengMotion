/**
 * 项目工程渲染脚本。
 *
 * <p>与 {@code render.mjs}（统一工程）的分工：那个渲染的是内置 {@code Film}
 * 组件 + scenes props；这个渲染的是 <strong>agent 写在项目目录里的 Remotion 源码</strong>。</p>
 *
 * <p>用法：
 * {@code node render-project.mjs --project <项目目录> --entry <相对入口> --composition <ID> --out <文件> [--browser <路径>] [--props <文件>]}</p>
 *
 * <p><strong>依赖不装在项目里</strong>：实测项目源码{@code import 'react'} /
 * {@code import 'remotion'} 能直接用共享运行时打包成功，所以项目只需保存源码，
 * 不必每项目几百 MB 依赖。</p>
 *
 * <p><strong>入口与 composition 必须显式给</strong>：不能假设每个作品都叫
 * {@code Main}、入口都叫 {@code src/index.tsx}。两者由后端从项目配置读出并校验，
 * 找不到就明确失败，而不是猜一个。</p>
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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

  if (!args.project || !args.entry || !args.composition || !args.out) {
    emitResult({ ok: false, error: '缺少 --project / --entry / --composition / --out' })
    process.exit(2)
  }

  const projectDir = path.resolve(args.project)
  if (!existsSync(projectDir)) {
    emitResult({ ok: false, error: `项目目录不存在：${projectDir}` })
    process.exit(2)
  }

  /* 入口必须在项目目录内：否则一份被篡改的配置可以让渲染去读任意位置的文件。
     这是执行边界的一部分，不是保险丝。 */
  const entryAbs = path.resolve(projectDir, args.entry)
  if (!entryAbs.startsWith(projectDir + path.sep)) {
    emitResult({ ok: false, error: `入口越界：${args.entry} 不在项目目录内` })
    process.exit(2)
  }
  if (!existsSync(entryAbs)) {
    emitResult({ ok: false, error: `入口不存在：${args.entry}` })
    process.exit(2)
  }

  const nodeModules = resolveNodeModules(import.meta.dirname)
  const props = args.props ? JSON.parse(await readFile(args.props, 'utf8')) : {}

  /* 复制整个项目到可写目录再渲染：
     · AppImage 下项目可能在只读位置
     · Remotion 会往工程里写 .cache / .remotion
     入口路径要跟着换到副本里。 */
  const workDir = await stageWritableCopy(projectDir)
  const entryInWorkDir = path.join(workDir, path.relative(projectDir, entryAbs))

  try {
    const result = await renderProject({
      nodeModules,
      workDir,
      entryPoint: entryInWorkDir,
      compositionId: args.composition,
      props,
      out: path.resolve(args.out),
      browser: args.browser,
    })
    emitResult({ ok: true, output: args.out, ...result })
  } finally {
    await cleanup(workDir)
  }
}

main().catch((error) => {
  emitResult({ ok: false, error: error?.message ?? String(error) })
  process.exit(1)
})

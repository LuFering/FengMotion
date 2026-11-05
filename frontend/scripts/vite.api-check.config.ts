/**
 * API 层验收入口的打包配置（只服务验收，不改产品构建）。
 *
 * 为什么不复用仓库 `vite.config.ts`：那份配置是给浏览器壳用的（react/tailwind 插件、`base: './'`），
 * 而验收脚本要跑在 node 里、要能直接 `import('node:http')`。把两种目标塞进一份配置，
 * 迟早会为了验收去动产品构建 —— 所以单独一份，产品配置一行不改。
 *
 * 产物落在仓库**外**（`/tmp/fengmotion-api-check`）：验收产物不该进版本库，
 * 也不该污染 `scripts/` 目录（那里只有两个验收源文件）。
 *
 * 用法：
 *   npx vite build --config scripts/vite.api-check.config.ts
 *   node /tmp/fengmotion-api-check/api-contract-check.mjs
 */
import path from 'node:path'
import { defineConfig } from 'vite'

const repoRoot = path.resolve(import.meta.dirname, '..')
/** 仓库外产物目录；可用 FENGMOTION_API_CHECK_OUT 覆盖。 */
const outDir = process.env.FENGMOTION_API_CHECK_OUT || '/tmp/fengmotion-api-check'

export default defineConfig({
  resolve: {
    // 与产品配置同一套别名，验收脚本因此走的是真实源码引用路径（能顺带验证别名可用）
    alias: { '@': path.resolve(repoRoot, 'src') },
  },
  build: {
    // ssr 模式：node 内建模块与依赖保持 external，产物是一个可直接 node 跑的 ESM
    ssr: path.resolve(repoRoot, 'scripts/api-contract-check.ts'),
    outDir,
    emptyOutDir: true,
    // 验收产物只应有那一个 bundle：默认会把 public/（52MB 素材）复制进产物目录，纯属浪费
    copyPublicDir: false,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: { entryFileNames: 'api-contract-check.mjs', format: 'es' },
    },
  },
})

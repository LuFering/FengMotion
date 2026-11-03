/**
 * 「DSH 接入判据」联调自检的打包配置（只服务这个自检，不改产品构建）。
 *
 * 为什么单独一份配置：自检要跑在 node 里并直接打真实后端，而仓库的 `vite.config.ts`
 * 是给浏览器壳用的（react/tailwind 插件、`base: './'`）。把两种目标塞进一份配置，
 * 迟早会为了自检去动产品构建 —— 所以单独一份。
 *
 * 产物落在**项目内**的 node_modules/.cache 下（不是 /tmp）：
 * 自检会 import 到 React（useHarnesses 是 hook），产物必须在能解析 node_modules 的位置，
 * 否则 node 报 "Cannot find package 'react'"。
 *
 * 用法：
 *   npx vite build --config scripts/vite.harness-check.config.ts
 *   FENGMOTION_API_BASE=http://127.0.0.1:18099/api node /tmp/fengmotion-harness-check/check-harness-access.mjs
 */
import path from 'node:path'
import { defineConfig } from 'vite'

const repoRoot = path.resolve(import.meta.dirname, '..')
const outDir = process.env.FENGMOTION_HARNESS_CHECK_OUT || path.resolve(repoRoot, 'node_modules/.cache/fengmotion-harness-check')

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(repoRoot, 'src') },
  },
  // ssr 目标：产物要能在 node 里 import（自检脚本用 top-level await + ESM）
  build: {
    ssr: path.resolve(repoRoot, process.env.HARNESS_CHECK_ENTRY || 'scripts/check-harness-access.ts'),
    outDir,
    emptyOutDir: true,
    copyPublicDir: false,
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: process.env.HARNESS_CHECK_ENTRY_NAME || 'check-harness-access.mjs',
        format: 'esm',
      },
    },
  },
})

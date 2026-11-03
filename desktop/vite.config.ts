import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/**
 * Vite 配置。
 *
 * <p><strong>为什么显式 define 环境变量</strong>：Vite 8 只在构建产物里（`isBundled`）
 * 把 `import.meta.env.VITE_*` 静态替换成字面量；dev 模式下这条替换路径不执行，
 * 浏览器拿到的 `import.meta.env` 是空对象。结果就是同一个变量
 * 「npm run build 生效、npm run dev 不生效」——实测确认过：
 * shell 里设了 VITE_TEST_PROBE，dev 下浏览器读不到，Node 侧 loadEnv 却能读到。</p>
 *
 * <p>项目里只有 `src/services/api/config.ts` 读环境变量（后端地址），
 * 所以这里只注入这一个。用 `loadEnv` 取值而不是 `process.env` 直读，
 * 是为了让 `desktop/.env*` 文件也能生效（loadEnv 会合并两者）。</p>
 *
 * <p>注意：桌面壳运行时会通过 IPC 注入后端地址（`initDesktopApiBase`），
 * 优先级高于这里 —— 打包应用不受本配置影响。</p>
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_')
  const apiBase = env.VITE_FENGMOTION_API_BASE

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    define: apiBase
      ? { 'import.meta.env.VITE_FENGMOTION_API_BASE': JSON.stringify(apiBase) }
      : {},
    // 桌面版：构建产物用相对路径，便于 Electron 以 file:// 加载
    base: './',
  }
})

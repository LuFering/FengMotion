/**
 * 把组件演示页的构建产物同步到 public/replica/ 下，并改写资源路径。
 *
 * 为什么需要它：演示页要能在 fengmotion:// 下直接打开，而 Vite 默认把
 * 资源写成绝对路径 /assets/...，在自定义协议里会指到根目录而加载不到。
 * 这里统一改成相对路径。
 *
 * 用法：npm run build:demo
 * 产物：public/replica/<name>/<name>.html + assets/
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const dir = import.meta.dirname
const root = path.resolve(dir, '..')
const out = path.join(root, 'demo-out')
const DEST = path.join(root, 'public', 'replica', 'agent-progress')
const NAME = 'agent-progress-demo.html'

if (!existsSync(out)) {
  console.error(`✗ 没有构建产物：${out}\n  先运行 vite build --config vite.demo.config.ts`)
  process.exit(1)
}

/* 只复制演示页和它自己的资源。demo-out 里还有整个 public/ 的副本
   （Vite 会把它一并拷进去），那些不要带进来。 */
rmSync(DEST, { recursive: true, force: true })
mkdirSync(DEST, { recursive: true })

cpSync(path.join(out, NAME), path.join(DEST, NAME))
const assets = path.join(out, 'assets')
if (existsSync(assets)) {
  cpSync(assets, path.join(DEST, 'assets'), { recursive: true })
}

/* 绝对路径 → 相对路径：fengmotion:// 下 /assets 会指到协议根，加载不到 */
const target = path.join(DEST, NAME)
const html = readFileSync(target, 'utf8')
  .replaceAll('src="/assets/', 'src="./assets/')
  .replaceAll('href="/assets/', 'href="./assets/')
writeFileSync(target, html)

console.log(`✓ 演示页 → ${path.relative(root, DEST)}/`)

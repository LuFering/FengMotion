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
const OUT = path.join(root, 'demo-out-components')

/* 一个演示页一条：源文件名 → 目标目录名 */
const PAGES = [['ai-components-demo.html', 'ai-components']]

if (!existsSync(OUT)) {
  console.error(`✗ 没有构建产物：${OUT}\n  先运行 vite build --config vite.components.config.ts`)
  process.exit(1)
}

for (const [name, destName] of PAGES) {
  const src = path.join(OUT, name)
  if (!existsSync(src)) {
    console.error(`✗ 缺少演示页：${src}`)
    process.exitCode = 1
    continue
  }

  const dest = path.join(root, 'public', 'replica', destName)
  /* 只复制演示页和它自己的资源。构建目录里还有整个 public/ 的副本
     （Vite 会把它一并拷进去），那些不要带进来。 */
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  cpSync(src, path.join(dest, name))

  /* 只复制这个页面真正引用的资源。
     Vite 会把整个 public/ 也拷进 assets/（品牌图、图标、字体…），
     那些不属于演示页，进仓库只会变成垃圾。 */
  const assets = path.join(OUT, 'assets')
  const destAssets = path.join(dest, 'assets')
  if (existsSync(assets)) {
    mkdirSync(destAssets, { recursive: true })
    const htmlSrc = readFileSync(src, 'utf8')
    /* 从 HTML 里抓 ./assets/xxx 形式的引用，只拷这些 */
    const used = new Set([...htmlSrc.matchAll(/[."]\/(assets\/[^"')\s]+)/g)].map((m) => m[1]))
    for (const rel of used) {
      const from = path.join(OUT, rel)
      if (!existsSync(from)) continue
      const to = path.join(dest, rel)
      mkdirSync(path.dirname(to), { recursive: true })
      cpSync(from, to)
    }
    /* CSS 里的 url(...) 也要跟着拷：字体就在里面引用 */
    for (const rel of [...used].filter((r) => r.endsWith('.css'))) {
      const css = readFileSync(path.join(OUT, rel), 'utf8')
      for (const m of css.matchAll(/url\(\s*[."']?(\/?assets\/[^)"']+)/g)) {
        const assetRel = m[1].replace(/^\//, '')
        const from = path.join(OUT, assetRel)
        if (!existsSync(from)) continue
        const to = path.join(dest, assetRel)
        mkdirSync(path.dirname(to), { recursive: true })
        cpSync(from, to)
      }
    }
  }

  /* 绝对路径 → 相对路径：fengmotion:// 下 /assets 会指到协议根，加载不到 */
  const target = path.join(dest, name)
  const html = readFileSync(target, 'utf8')
    .replaceAll('src="/assets/', 'src="./assets/')
    .replaceAll('href="/assets/', 'href="./assets/')
  writeFileSync(target, html)

  console.log(`✓ ${name} → ${path.relative(root, dest)}/`)
}

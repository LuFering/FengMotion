/** Generate stills from the checked-in original scenes, never execute arbitrary imports. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { resolve, dirname, relative, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer'
import jpeg from 'jpeg-js'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(frontend, 'src/fx-original/remotion-scenes')
const sceneRoot = join(sourceRoot, 'src/scenes')
const outputRoot = join(frontend, 'public/fx-original-posters')
const browserExecutable = process.env.FX_POSTER_BROWSER || undefined
const limit = Number(process.env.FX_POSTER_LIMIT || '0')
const hash = (value) => createHash('sha256').update(value).digest('hex')

// 比较画面中的明暗变化，避免入场或退场时接近纯色的帧；不声称能理解画面语义。
function visibleDetail(bytes) {
  const { data, width, height } = jpeg.decode(bytes, { useTArray: true })
  let score = 0, count = 0
  for (let y = 4; y < height - 4; y += 3) for (let x = 4; x < width - 4; x += 3) {
    const i = (y * width + x) * 4, j = i + 12
    for (let c = 0; c < 3; c++) score += Math.abs(data[i + c] - data[j + c])
    count++
  }
  return score / Math.max(count, 1)
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true })
  return (await Promise.all(entries.map((e) => e.isDirectory() ? walk(join(root, e.name)) : [join(root, e.name)]))).flat()
}
const files = (await walk(sceneRoot)).filter((f) => f.endsWith('.tsx') && !f.endsWith('index.tsx')).sort()
let config = {}
try { config = JSON.parse(await readFile(join(sourceRoot, 'preview-frames.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const commons = await Promise.all((await walk(join(sourceRoot, 'src/common'))).sort().map((file) => readFile(file)))
const scriptHash = hash(await readFile(fileURLToPath(import.meta.url)))
const lockHash = hash(await readFile(join(frontend, 'package-lock.json')))
await mkdir(outputRoot, { recursive: true })
let manifest = {}
try { manifest = JSON.parse(await readFile(join(outputRoot, 'manifest.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const selected = limit > 0 ? files.slice(0, limit) : files
const temp = await mkdtemp(join(frontend, '.fx-poster-'))
let browser
try {
  const entry = join(temp, 'entry.tsx')
  const loader = join(temp, 'font-loader.cjs')
  await writeFile(loader, `module.exports = function(source) { if (!source.includes('loadInter()')) throw new Error('Font entry changed'); return source.replace('loadInter()', "loadInter('normal', { subsets: ['latin', 'latin-ext'] })"); }`)
  const imports = files.map((f, i) => `import { ${f.split('/').pop().replace(/\.tsx$/, '')} as S${i} } from ${JSON.stringify(f)};`).join('\n')
  const compositions = files.map((_, i) => `<Composition id="S${i}" component={S${i}} width={1280} height={720} fps={30} durationInFrames={90} />`).join('\n')
  await writeFile(entry, `import React from 'react'; import {registerRoot, Composition} from 'remotion';\n${imports}\nconst Root = () => <>${compositions}</>; registerRoot(Root);`)
  const serveUrl = await bundle({ entryPoint: entry, webpackOverride: (current) => ({ ...current,
    resolve: { ...current.resolve, alias: {
      ...current.resolve?.alias,
      react: join(frontend, 'node_modules/react'),
      'react-dom': join(frontend, 'node_modules/react-dom'),
      remotion: join(frontend, 'node_modules/remotion'),
      '@remotion/three': join(frontend, 'src/remotion/shims/three-mock.tsx'),
      '@react-three/fiber': join(frontend, 'src/remotion/shims/three-mock.tsx'),
      '@react-three/drei': join(frontend, 'src/remotion/shims/three-mock.tsx'),
      three: join(frontend, 'src/remotion/shims/three-mock.tsx'),
    } },
    module: { ...current.module, rules: [...(current.module?.rules ?? []), { test: /fx-original\/remotion-scenes\/src\/common\/fonts\.ts$/, enforce: 'pre', use: [{ loader }] }] },
  }) })
  browser = await openBrowser('chrome', { browserExecutable, logLevel: 'error' })
  let rendered = 0, cached = 0, failed = 0
  for (const file of selected) {
    const path = `src/scenes/${relative(sceneRoot, file).replaceAll('\\', '/')}`
    const configuredFrame = config[path]
    if (configuredFrame != null && (!Number.isInteger(configuredFrame) || configuredFrame < 0 || configuredFrame >= 90)) { console.error(`Invalid frame: ${path}`); delete manifest[path]; failed++; continue }
    const frames = configuredFrame == null ? [30, 60, 89] : [configuredFrame]
    const key = hash(path).slice(0, 20)
    const fingerprint = hash(Buffer.concat([await readFile(file), ...commons, Buffer.from(`${frames.join(',')}:${scriptHash}:${lockHash}`)]))
    const destination = join(outputRoot, `${key}.jpg`)
    try {
      const existing = manifest[path]
      if (existing?.fingerprint === fingerprint && existing?.checksum === hash(await readFile(destination))) { cached++; continue }
    } catch { /* Cache is missing or damaged. */ }
    const tempOutput = join(outputRoot, `.${key}.tmp.jpg`)
    try {
      const composition = await selectComposition({ serveUrl, id: `S${files.indexOf(file)}`, puppeteerInstance: browser, logLevel: 'error' })
      let best = null
      for (const frame of frames) {
        await renderStill({ composition, serveUrl, output: tempOutput, frame, imageFormat: 'jpeg', jpegQuality: 80, scale: 0.3, puppeteerInstance: browser, logLevel: 'error', timeoutInMilliseconds: 30000 })
        const bytes = await readFile(tempOutput)
        const score = visibleDetail(bytes)
        if (!best || score >= best.score) best = { frame, score, bytes }
      }
      await writeFile(tempOutput, best.bytes)
      const checksum = hash(best.bytes)
      await rename(tempOutput, destination)
      manifest[path] = { file: `${key}.jpg`, frame: best.frame, frameSource: configuredFrame == null ? 'automatic' : 'configured', fingerprint, checksum }
      rendered++
    } catch (error) {
      await rm(tempOutput, { force: true }); delete manifest[path]; failed++; console.error(`Failed ${path}: ${error.message}`)
    }
    if ((rendered + failed) % 20 === 0) {
      const checkpoint = join(outputRoot, '.manifest.tmp.json')
      await writeFile(checkpoint, JSON.stringify(manifest, null, 2))
      await rename(checkpoint, join(outputRoot, 'manifest.json'))
      console.log(`processed ${rendered + failed}/${selected.length}`)
    }
  }
  const temporaryManifest = join(outputRoot, '.manifest.tmp.json')
  await writeFile(temporaryManifest, JSON.stringify(manifest, null, 2))
  await rename(temporaryManifest, join(outputRoot, 'manifest.json'))
  console.log(JSON.stringify({ rendered, cached, failed, total: selected.length }))
  if (failed) process.exitCode = 1
} finally {
  if (browser) await browser.close({ silent: true })
  await rm(temp, { recursive: true, force: true })
}

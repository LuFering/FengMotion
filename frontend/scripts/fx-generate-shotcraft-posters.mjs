/** Render stills for the explicitly mapped, checked-in Shotcraft demos. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer'
import jpeg from 'jpeg-js'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = join(frontend, 'src/fx-original/video-shotcraft')
const outputRoot = join(frontend, 'public/fx-original-posters')
const browserExecutable = process.env.FX_POSTER_BROWSER || undefined
const limit = Number(process.env.FX_POSTER_LIMIT || '0')
const offset = Number(process.env.FX_POSTER_OFFSET || '0')
const hash = (value) => createHash('sha256').update(value).digest('hex')
async function bounded(promise, ms, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}超时`)), ms) })]) }
  finally { clearTimeout(timer) }
}
const map = JSON.parse(await readFile(join(root, 'scene-map.json'), 'utf8'))
const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
const chosen = limit > 0 ? entries.slice(offset, offset + limit) : entries.slice(offset)
const fixtures = await Promise.all((await readdir(join(root, 'demos/_fixtures'))).sort().map((file) => readFile(join(root, 'demos/_fixtures', file))))
const scriptHash = hash(await readFile(fileURLToPath(import.meta.url)))
const lockHash = hash(await readFile(join(frontend, 'package-lock.json')))
let config = {}
try { config = JSON.parse(await readFile(join(root, 'preview-frames.json'), 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
await mkdir(outputRoot, { recursive: true })
let manifest = {}
try { manifest = JSON.parse(await readFile(join(outputRoot, 'manifest.json'), 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
function score(bytes) {
  const { data, width, height } = jpeg.decode(bytes, { useTArray: true })
  let result = 0, count = 0
  for (let y = 4; y < height - 4; y += 3) for (let x = 4; x < width - 4; x += 3) {
    const i = (y * width + x) * 4, j = i + 12
    for (let c = 0; c < 3; c++) result += Math.abs(data[i + c] - data[j + c])
    count++
  }
  return result / Math.max(count, 1)
}
const temp = await mkdtemp(join(tmpdir(), 'fx-shotcraft-'))
let browser
try {
  const entry = join(temp, 'entry.tsx')
  const imports = entries.map(([, info], i) => {
    const durImport = info.durationExport ? `, ${info.durationExport} as D${i}` : ''
    return `import { ${info.export} as S${i}${durImport} } from ${JSON.stringify(join(root, info.module))};`
  }).join('\n')
  const compositions = entries.map(([, info], i) => `<Composition id="S${i}" component={S${i}} width={1920} height={1080} fps={30} durationInFrames={${info.durationExport ? `D${i}` : '90'}} />`).join('\n')
  await writeFile(entry, `import React from 'react'; import {registerRoot, Composition} from 'remotion';\n${imports}\nconst Root=()=> <>${compositions}</>; registerRoot(Root);`)
  const serveUrl = await bundle({ entryPoint: entry, webpackOverride: (current) => ({ ...current,
    resolve: { ...current.resolve, alias: {
      ...current.resolve?.alias,
      react: join(frontend, 'node_modules/react'),
      'react-dom': join(frontend, 'node_modules/react-dom'),
      remotion: join(frontend, 'node_modules/remotion'),
      '@remotion/motion-blur': join(frontend, 'src/remotion/shims/motion-blur-mock.tsx'),
    } },
  }) })
  browser = await openBrowser('chrome', { browserExecutable, logLevel: 'error' })
  let rendered = 0, cached = 0, failed = 0
  for (const [path, info] of chosen) {
    const key = hash(`video-shotcraft\n${path}`).slice(0, 20)
    const destination = join(outputRoot, `${key}.jpg`)
    const configuredFrame = config[path]
    const fingerprint = hash(Buffer.concat([await readFile(join(root, info.module)), ...fixtures, Buffer.from(`${configuredFrame ?? 'automatic'}:${scriptHash}:${lockHash}`)]))
    try { if (manifest[path]?.fingerprint === fingerprint && manifest[path]?.checksum === hash(await readFile(destination))) { cached++; continue } } catch { /* missing cache */ }
    const tmp = join(outputRoot, `.${key}.tmp.jpg`)
    try {
      const composition = await bounded(selectComposition({ serveUrl, id: `S${entries.findIndex(([key]) => key === path)}`, puppeteerInstance: browser, logLevel: 'error' }), 20000, '读取场景')
      const duration = composition.durationInFrames
      if (!Number.isInteger(duration) || duration < 1 || duration > 3600) throw new Error('时长无效')
      if (configuredFrame != null && (!Number.isInteger(configuredFrame) || configuredFrame < 0 || configuredFrame >= duration)) throw new Error('配置帧超出时长')
      const frames = configuredFrame == null ? [...new Set([0.3, 0.6, 0.9].map((part) => Math.floor((duration - 1) * part)))] : [configuredFrame]
      let best = null
      for (const frame of frames) {
        await bounded(renderStill({ composition, serveUrl, output: tmp, frame, imageFormat: 'jpeg', jpegQuality: 80, scale: 0.2, puppeteerInstance: browser, logLevel: 'error', timeoutInMilliseconds: 20000 }), 25000, '渲染静态帧')
        const bytes = await readFile(tmp), detail = score(bytes)
        if (!best || detail >= best.detail) best = { bytes, detail, frame }
      }
      await writeFile(tmp, best.bytes); await rename(tmp, destination)
      manifest[path] = { file: `${key}.jpg`, frame: best.frame, frameSource: configuredFrame == null ? 'automatic' : 'configured', fingerprint, checksum: hash(best.bytes) }
      rendered++
    } catch (error) {
      await rm(tmp, { force: true }); delete manifest[path]; failed++; console.error(`Failed ${path}: ${error.message}`)
      try { await bounded(browser.close({ silent: true }), 3000, '关闭预览进程') } catch { /* 旧浏览器不可用 */ }
      browser = await openBrowser('chrome', { browserExecutable, logLevel: 'error' })
    }
    if ((rendered + failed) % 10 === 0) {
      const checkpoint = join(outputRoot, '.shotcraft-manifest.tmp.json')
      await writeFile(checkpoint, JSON.stringify(manifest, null, 2)); await rename(checkpoint, join(outputRoot, 'manifest.json'))
      console.log(`processed ${rendered + failed}/${chosen.length}`)
    }
  }
  const checkpoint = join(outputRoot, '.shotcraft-manifest.tmp.json')
  await writeFile(checkpoint, JSON.stringify(manifest, null, 2)); await rename(checkpoint, join(outputRoot, 'manifest.json'))
  console.log(JSON.stringify({ rendered, cached, failed, total: chosen.length }))
  if (failed) process.exitCode = 1
} finally { if (browser) await browser.close({ silent: true }); await rm(temp, { recursive: true, force: true }) }

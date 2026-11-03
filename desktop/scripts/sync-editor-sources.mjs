import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
const source = process.argv[2]
if (!source) throw new Error('Usage: node scripts/sync-editor-sources.mjs /absolute/path/to/film')
const target = path.resolve('public/editor-sources/token')
await fs.mkdir(path.join(target, 'scenes'), { recursive: true })
await fs.cp(path.join(source, 'assets'), path.join(target, 'assets'), { recursive: true })
await fs.copyFile('node_modules/gsap/dist/gsap.min.js', path.join(target, 'gsap.min.js'))
await fs.writeFile(
  path.join(target, 'GSAP-LICENSE.txt'),
  'GSAP 3.14.2. License reference: https://gsap.com/standard-license . See copyright notice in gsap.min.js.\n',
)
const entries = []
for (const name of (await fs.readdir(path.join(source, 'compositions')))
  .filter((n) => /^s\d+\.html$/.test(n))
  .sort()) {
  const original = await fs.readFile(path.join(source, 'compositions', name), 'utf8')
  const html = original
    .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^"']+\/dist\/gsap\.min\.js/g, '../gsap.min.js')
    .replace(/(?<!\.\.\/)assets\//g, '../assets/')
  await fs.writeFile(path.join(target, 'scenes', name), html)
  entries.push({
    id: name.replace('.html', ''),
    name: original.match(/<title>(.*?)<\/title>/s)?.[1] ?? name,
    engine: 'html-gsap',
    file: `editor-sources/token/scenes/${name}`,
    source: `film/compositions/${name}`,
    sourceHash: createHash('sha256').update(original).digest('hex'),
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: Number(
      original.match(/data-composition-id="[^"]+"[^>]*?data-duration="([\d.]+)"/s)?.[1] ?? 5,
    ),
  })
}
const assets = (await fs.readdir(path.join(target, 'assets'), { recursive: true, withFileTypes: true }))
  .filter((f) => f.isFile())
  .map((f) => path.relative(target, path.join(f.parentPath, f.name)))
await fs.writeFile(
  path.join(target, 'manifest.json'),
  JSON.stringify(
    {
      projectId: 'token',
      provenance:
        'Snapshot of the existing Token HTML + GSAP source; not a newly generated video. Original source files are not modified.',
      scenes: entries,
      assets: [...assets, 'gsap.min.js', 'GSAP-LICENSE.txt'],
    },
    null,
    2,
  ),
)
console.log(`Imported ${entries.length} actual scene sources and ${assets.length} assets`)

import { getFileURL, importFiles } from '@/services/assetService'
import type { EditorManifest, SceneDocument } from './types'
import { validateDocument, documentFromSource } from './document'
const key = (projectId: string) => `fengmotion:scene-documents:v1:${projectId}`
export async function loadManifest(projectId: string): Promise<EditorManifest> {
  if (projectId !== 'token') return { projectId, scenes: [], assets: [] }
  const response = await fetch('./editor-sources/token/manifest.json')
  if (!response.ok) throw new Error('源工程清单加载失败。')
  return response.json()
}
export function readDocuments(projectId: string): SceneDocument[] {
  try {
    const docs = JSON.parse(localStorage.getItem(key(projectId)) ?? '[]')
    return Array.isArray(docs)
      ? docs.filter((d) => d?.schemaVersion === 1 && d.projectId === projectId && Array.isArray(d.layers))
      : []
  } catch {
    return []
  }
}
export function saveDocument(doc: SceneDocument) {
  const docs = readDocuments(doc.projectId)
  localStorage.setItem(
    key(doc.projectId),
    JSON.stringify([structuredClone(doc), ...docs.filter((d) => d.id !== doc.id)]),
  )
  localStorage.setItem(`fengmotion:editor-last:${doc.projectId}`, doc.id)
}
export async function resolveDocument(doc: SceneDocument): Promise<SceneDocument> {
  const result = structuredClone(doc)
  for (const layer of result.layers)
    if (layer.assetId) {
      const url = await getFileURL(layer.assetId)
      if (!url) throw new Error(`素材“${layer.name}”不可用，请重新选择。`)
      layer.src = url
    }
  for (const patch of Object.values(result.patches))
    if (patch.assetId) {
      const url = await getFileURL(patch.assetId)
      if (!url) throw new Error('替换图片已不可用，请重新选择素材。')
      patch.src = url
    }
  return result
}
function validateKnownDocument(input: unknown, projectId: string, manifest: EditorManifest): SceneDocument {
  const doc = input as SceneDocument
  if (doc?.engine !== 'html-gsap') return validateDocument(input, projectId)
  const source = manifest.scenes.find(
    (s) => s.id === doc.source?.id && s.sourceHash === doc.source?.sourceHash,
  )
  if (
    !source ||
    typeof doc.name !== 'string' ||
    !Number.isFinite(doc.durationSeconds) ||
    doc.durationSeconds < 0.5 ||
    doc.durationSeconds > 600 ||
    !doc.patches ||
    Array.isArray(doc.patches) ||
    Object.keys(doc.patches).length > 200
  )
    throw Error('此 HTML 文档没有匹配的受信任源工程。')
  for (const [key, patch] of Object.entries(doc.patches)) {
    if (!/^(#[a-zA-Z0-9_-]+|element-\d+)$/.test(key) || !patch || typeof patch !== 'object')
      throw Error('源元素引用无效。')
    for (const [name, value] of Object.entries(patch)) {
      if (
        ['x', 'y', 'scale', 'rotation', 'opacity', 'fontSize', 'width', 'height', 'radius'].includes(name) &&
        (!(typeof value === 'number') || !Number.isFinite(value) || Math.abs(value) > 8192)
      )
        throw Error('元素数值参数无效。')
      if (
        ['text', 'src', 'assetId', 'color', 'backgroundColor'].includes(name) &&
        (typeof value !== 'string' || value.length > 10000)
      )
        throw Error('元素内容参数无效。')
      if (name === 'visible' && typeof value !== 'boolean') throw Error('元素可见性无效。')
    }
  }
  return {
    ...documentFromSource(projectId, source),
    name: doc.name,
    durationSeconds: doc.durationSeconds,
    patches: structuredClone(doc.patches),
  }
}
export async function importDocument(
  file: File,
  projectId: string,
  manifest: EditorManifest,
): Promise<SceneDocument> {
  if (file.size > 100_000_000) throw Error('工程包超过 100 MB。')
  if (!file.name.toLowerCase().endsWith('.zip') && file.size > 5_000_000) throw Error('场景 JSON 超过 5 MB。')
  if (!file.name.toLowerCase().endsWith('.zip'))
    return validateKnownDocument(JSON.parse(await file.text()), projectId, manifest)
  const { unzipSync, strFromU8 } = await import('fflate')
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (item) => item.originalSize < 100_000_000,
  })
  if (!entries['scene.json'] || Object.values(entries).reduce((sum, b) => sum + b.length, 0) > 200_000_000)
    throw Error('工程包内容不完整或过大。')
  const doc = validateKnownDocument(JSON.parse(strFromU8(entries['scene.json'])), projectId, manifest)
  const media: Record<string, string> = entries['assets.json']
    ? JSON.parse(strFromU8(entries['assets.json']))
    : {}
  const bind = async (item: { src?: string; assetId?: string }) => {
    if (!item.src) return
    const path = item.src.replace(/^\.\.\//, '').replace(/^\.\//, '')
    if (!entries[path]) return
    const mime =
      media[path] ??
      (path.endsWith('.png')
        ? 'image/png'
        : path.endsWith('.jpg')
          ? 'image/jpeg'
          : path.endsWith('.mp4')
            ? 'video/mp4'
            : path.endsWith('.webm')
              ? 'video/webm'
              : path.endsWith('.wav')
                ? 'audio/wav'
                : 'application/octet-stream')
    const [asset] = await importFiles(
      [new File([entries[path] as Uint8Array<ArrayBuffer>], path.split('/').at(-1)!, { type: mime })],
      () => {},
    )
    if (!asset) throw Error('工程素材导入失败。')
    item.assetId = asset.id
    delete item.src
  }
  for (const layer of doc.layers) await bind(layer)
  for (const patch of Object.values(doc.patches)) await bind(patch)
  return doc
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function exportProject(doc: SceneDocument, manifest: EditorManifest) {
  const { zipSync, strToU8 } = await import('fflate')
  const media: Record<string, string> = {}
  const files: Record<string, Uint8Array> = { 'scene.json': strToU8(JSON.stringify(doc, null, 2)) }
  if (doc.engine === 'html-gsap' && doc.source) {
    /* structuredClone 之后 TS 会丢掉上一行对 doc.source 的非空收窄，先把文件名存下来 */
    const sourceFile = doc.source.file
    doc = structuredClone(doc)
    const resolved = await resolveDocument(doc)
    for (const [id, patch] of Object.entries(resolved.patches))
      if (patch.assetId && patch.src) {
        const response = await fetch(patch.src)
        if (!response.ok) throw Error('替换图片不可用。')
        const mime = response.headers.get('content-type') ?? 'image/png'
        const path = `assets/user-${Object.keys(media).length}.${mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'}`
        files[path] = new Uint8Array(await response.arrayBuffer())
        media[path] = mime
        doc.patches[id].src = `../${path}`
        delete doc.patches[id].assetId
      }
    files['scene.json'] = strToU8(JSON.stringify(doc, null, 2))
    const html = await fetch(`./${sourceFile}`).then((r) => {
      if (!r.ok) throw Error('源文件不可用')
      return r.text()
    })
    files['scenes/scene.html'] = strToU8(html)
    for (const asset of manifest.assets) {
      const response = await fetch(`./editor-sources/token/${asset}`)
      if (!response.ok) throw Error(`工程依赖不可用：${asset}`)
      files[asset] = new Uint8Array(await response.arrayBuffer())
    }
    const bridge = await fetch('./editor-engine/html-bridge.js').then((r) => r.text())
    files['bridge.js'] = strToU8(bridge)
    const json = JSON.stringify(doc).replace(/</g, '\\u003c')
    files['index.html'] = strToU8(
      `<!doctype html><meta charset="utf-8"><title>${doc.name.replace(/[<>&"']/g, '')}</title><style>body{margin:0;background:#111;color:white;font:13px sans-serif}iframe{border:0;width:100vw;height:calc(100vh - 48px)}footer{height:40px;display:flex;align-items:center;gap:10px;padding:0 15px}input{flex:1}</style><iframe id="preview" src="scenes/scene.html"></iframe><footer><button id="play">播放 / 暂停</button><input id="seek" type="range" min="0" max="${doc.durationSeconds}" step="0.01"><span id="time">0s</span></footer><script>const doc=${json};const frame=document.getElementById('preview');let playing=false,time=0,last=0;frame.onload=()=>{const s=frame.contentDocument.createElement('script');s.src='../bridge.js';s.onload=()=>send();frame.contentDocument.body.append(s)};function send(){frame.contentWindow.postMessage({channel:'feng-editor',type:'update',time,duration:doc.durationSeconds,patches:doc.patches,selected:null},'*')}document.getElementById('play').onclick=()=>playing=!playing;document.getElementById('seek').oninput=e=>{time=Number(e.target.value);send()};function tick(now){if(playing){time=Math.min(doc.durationSeconds,time+(now-last)/1000);if(time>=doc.durationSeconds)playing=false;send();document.getElementById('seek').value=time;document.getElementById('time').textContent=time.toFixed(2)+'s'}last=now;requestAnimationFrame(tick)}requestAnimationFrame(tick);</script>`,
    )
    files['README.txt'] = strToU8(
      '这是原 HTML + GSAP 源工程的可编辑副本，未修改原始工程。请通过本地 HTTP 服务打开 index.html，保持 scenes、assets、gsap.min.js、bridge.js 的目录结构。scene.json 为本次修改。视频导出需由 HTML 渲染器执行。',
    )
  } else {
    const resolved = await resolveDocument(doc)
    for (let i = 0; i < resolved.layers.length; i++) {
      const layer = resolved.layers[i]
      if (layer.src) {
        const r = await fetch(layer.src)
        if (!r.ok) throw Error(`无法打包素材：${layer.name}`)
        const type = r.headers.get('content-type') ?? ''
        const ext = type.includes('png')
          ? 'png'
          : type.includes('jpeg')
            ? 'jpg'
            : type.includes('mp4')
              ? 'mp4'
              : type.includes('audio')
                ? 'audio'
                : 'bin'
        const file = `assets/${i}.${ext}`
        files[file] = new Uint8Array(await r.arrayBuffer())
        media[file] = type
        doc = structuredClone(doc)
        doc.layers[i].src = `./${file}`
        delete doc.layers[i].assetId
      }
    }
    files['scene.json'] = strToU8(JSON.stringify(doc, null, 2))
    files['README.txt'] = strToU8(
      'FengMotion 原生 Remotion 场景文档与素材备份。scene.json 可导回编辑器。视频导出由同一 SceneComposition 与文档生成；这不是官方 Remotion Studio 的完整源代码工程。',
    )
  }
  files['assets.json'] = strToU8(JSON.stringify(media))
  download(
    new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    `${doc.name.replace(/[\\/:*?"<>|]/g, '-')}.zip`,
  )
}

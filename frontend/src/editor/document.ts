import type { EditorLayer, SceneDocument, SourceScene } from './types'
export const editorTheme = {
  background: '#0b0d11',
  text: '#f4f1ec',
  accent: '#3b8cf8',
  muted: '#a4a7b1',
  font: 'FengEditorCJK, FengEditorDisplay, sans-serif',
}
export function makeLayer(kind: EditorLayer['kind'], duration: number, index = 0): EditorLayer {
  return {
    id: crypto.randomUUID(),
    kind,
    name: { text: '文字', image: '图片', video: '视频', audio: '声音', shape: '形状' }[kind],
    visible: true,
    locked: false,
    x: 160 + index * 30,
    y: 180 + index * 30,
    width: kind === 'text' ? 1200 : 640,
    height: kind === 'text' ? 200 : 360,
    rotation: 0,
    opacity: 1,
    start: 0,
    end: duration,
    text: '新的文字',
    fontSize: 110,
    fontWeight: 700,
    color: editorTheme.text,
    align: 'left',
    fill: editorTheme.accent,
    radius: 0,
    fit: 'contain',
    trimStart: 0,
    volume: 1,
    motion: kind === 'text' ? 'rise' : 'none',
    entrance: 0.6,
    exit: 0.25,
    travel: 36,
    zoom: kind === 'image' ? 1.03 : 1,
  }
}
export function createNativeDocument(projectId: string): SceneDocument {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    projectId,
    name: '新的 Remotion 场景',
    engine: 'remotion',
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: 5,
    background: editorTheme.background,
    layers: [makeLayer('text', 5)],
    patches: {},
    updatedAt: new Date().toISOString(),
  }
}
export function documentFromSource(projectId: string, source: SourceScene): SceneDocument {
  return {
    schemaVersion: 1,
    id: `source:${source.id}:${source.sourceHash.slice(0, 12)}`,
    projectId,
    name: source.name,
    engine: source.engine,
    width: source.width,
    height: source.height,
    fps: source.fps,
    durationSeconds: source.durationSeconds,
    background: editorTheme.background,
    layers: [],
    patches: {},
    source,
    updatedAt: new Date().toISOString(),
  }
}
const finite = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
export function validateDocument(input: unknown, projectId: string): SceneDocument {
  const doc = input as SceneDocument
  if (
    !doc ||
    doc.schemaVersion !== 1 ||
    !['remotion', 'html-gsap'].includes(doc.engine) ||
    typeof doc.id !== 'string' ||
    !doc.id ||
    typeof doc.background !== 'string' ||
    typeof doc.name !== 'string' ||
    !finite(doc.width, 64, 4096) ||
    !finite(doc.height, 64, 4096) ||
    !finite(doc.fps, 1, 60) ||
    !finite(doc.durationSeconds, 0.1, 600) ||
    !Array.isArray(doc.layers) ||
    doc.layers.length > 100 ||
    !doc.patches ||
    typeof doc.patches !== 'object' ||
    Array.isArray(doc.patches)
  )
    throw new Error('场景文档格式或画面规格不正确。')
  if (doc.engine === 'html-gsap')
    throw new Error('HTML 场景请从已绑定的源工程打开，不能通过 JSON 导入执行脚本。')
  const ids = new Set<string>()
  for (const l of doc.layers) {
    if (
      !l ||
      !['text', 'image', 'video', 'audio', 'shape'].includes(l.kind) ||
      typeof l.id !== 'string' ||
      !l.id ||
      ids.has(l.id) ||
      typeof l.name !== 'string' ||
      typeof l.text !== 'string' ||
      typeof l.visible !== 'boolean' ||
      typeof l.locked !== 'boolean' ||
      typeof l.color !== 'string' ||
      typeof l.fill !== 'string' ||
      !['left', 'center', 'right'].includes(l.align) ||
      !['contain', 'cover'].includes(l.fit) ||
      !finite(l.fontWeight, 100, 1000) ||
      !finite(l.radius, 0, 4096) ||
      !finite(l.travel, -8192, 8192) ||
      (l.assetId !== undefined && typeof l.assetId !== 'string') ||
      (l.src !== undefined && typeof l.src !== 'string') ||
      !finite(l.x, -8192, 8192) ||
      !finite(l.y, -8192, 8192) ||
      !finite(l.width, 1, 8192) ||
      !finite(l.height, 1, 8192) ||
      !finite(l.opacity, 0, 1) ||
      !finite(l.start, 0, doc.durationSeconds) ||
      !finite(l.end, l.start + 0.001, doc.durationSeconds) ||
      !finite(l.fontSize, 1, 1000) ||
      !finite(l.rotation, -360, 360) ||
      !finite(l.volume, 0, 2) ||
      !finite(l.trimStart, 0, 36000) ||
      !['none', 'rise', 'scale'].includes(l.motion) ||
      !finite(l.entrance, 0, 10) ||
      !finite(l.exit, 0, 10) ||
      !finite(l.zoom, 0.1, 3)
    )
      throw new Error('有图层参数超出范围，请检查位置、时间或透明度。')
    ids.add(l.id)
    if (l.src && !/^(\.\/|\/|https:\/\/|blob:|data:image\/)/.test(l.src))
      throw new Error('素材地址格式不受支持。')
  }
  return structuredClone({ ...doc, projectId })
}

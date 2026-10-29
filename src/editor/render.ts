import { SceneComposition } from './SceneComposition'
import { resolveDocument } from './service'
import { importFiles, updateAsset, getFileURL } from '@/services/assetService'
import type { SceneDocument } from './types'
export interface EditorRenderRecord {
  id: string
  projectId: string
  sceneId: string
  sceneName: string
  createdAt: string
  assetId: string
  revision: number
  document?: SceneDocument
}
export function readEditorRenders(projectId: string): EditorRenderRecord[] {
  try {
    const rows = JSON.parse(localStorage.getItem(`fengmotion:editor-renders:${projectId}`) ?? '[]')
    return Array.isArray(rows)
      ? rows.filter(
          (r) =>
            r?.projectId === projectId && typeof r.assetId === 'string' && typeof r.createdAt === 'string',
        )
      : []
  } catch {
    return []
  }
}
export async function renderScene(
  document: SceneDocument,
  kind: 'still' | 'video',
  time: number,
  signal: AbortSignal,
  onProgress: (p: number) => void,
) {
  if (document.engine !== 'remotion') throw Error('HTML 源场景尚未接入视频渲染器，请导出工程包。')
  const doc = await resolveDocument(document)
  const missing = doc.layers.find((l) => l.visible && ['image', 'video', 'audio'].includes(l.kind) && !l.src)
  if (missing) throw Error(`图层“${missing.name}”还没有绑定素材。`)
  const renderer = await import('@remotion/web-renderer')
  await Promise.all([
    window.document.fonts.load('800 24px FengEditorDisplay'),
    window.document.fonts.load('900 24px FengEditorCJK'),
  ])
  const composition = {
    id: doc.id.replace(/[^a-zA-Z0-9-]/g, '-'),
    component: SceneComposition,
    defaultProps: { document: doc },
    width: doc.width,
    height: doc.height,
    fps: doc.fps,
    durationInFrames: Math.max(1, Math.round(doc.durationSeconds * doc.fps)),
  }
  if (kind === 'still') {
    const result = await renderer.renderStillOnWeb({
      composition,
      inputProps: { document: doc },
      frame: Math.min(composition.durationInFrames - 1, Math.round(time * doc.fps)),
      signal,
    })
    return { blob: await result.blob({ format: 'png' }), name: `${doc.name}.png`, record: null }
  }
  const support = await renderer.canRenderMediaOnWeb({
    width: doc.width,
    height: doc.height,
    container: 'mp4',
    videoCodec: 'h264',
  })
  if (!support.canRender) throw Error(support.issues.map((i) => i.message).join('；'))
  const result = await renderer.renderMediaOnWeb({
    composition,
    inputProps: { document: doc },
    container: 'mp4',
    videoCodec: 'h264',
    signal,
    onProgress: (p) => onProgress(p.progress),
    pageResponsiveness: 'high',
  })
  const blob = await result.getBlob()
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  const name = `${doc.name}.mp4`
  const assets = await importFiles([new File([blob], name, { type: 'video/mp4' })], () => {})
  if (!assets[0]) throw Error('视频已编码，但未能保存到素材库。')
  await updateAsset(assets[0].id, {
    sourceType: 'generated',
    refs: [{ kind: 'project', id: doc.projectId, label: doc.name }],
    tags: ['编辑器导出'],
  })
  const old = readEditorRenders(doc.projectId)
  const record: EditorRenderRecord = {
    id: crypto.randomUUID(),
    projectId: doc.projectId,
    sceneId: doc.id,
    sceneName: doc.name,
    assetId: assets[0].id,
    createdAt: new Date().toISOString(),
    revision: old.filter((r) => r.sceneId === doc.id).length + 1,
    document: structuredClone(document),
  }
  localStorage.setItem(`fengmotion:editor-renders:${doc.projectId}`, JSON.stringify([record, ...old]))
  return { blob, name, record }
}
export async function editorRenderVisuals(projectId: string) {
  const rows = readEditorRenders(projectId)
  return Promise.all(
    rows.map(async (r) => ({
      id: `editor:${r.id}`,
      tier: 'proof' as const,
      tierLabel: '编辑器试片',
      name: `${r.sceneName} · 导出 ${r.revision}`,
      media: 'video' as const,
      file: (await getFileURL(r.assetId)) ?? '',
      assetId: r.assetId,
      runId: r.id,
      artifactId: r.sceneId,
      workflowId: '',
      revision: r.revision,
      createdAt: r.createdAt,
      artifactKind: 'editor-render',
      stale: false,
      origin: 'editor' as const,
    })),
  ).then((items) => items.filter((i) => i.file))
}

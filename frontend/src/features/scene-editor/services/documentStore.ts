import { persistLocalDocument } from '@/shared/local-documents/localDocuments'
/**
 * 场景文档的本地存储读写。
 *
 * <p>单独拆出来的原因：这份存储要被两处使用 —— 编辑器本身，以及工作台里
 * 「这份文档还是渲染时那份吗」的判定。判定要能在纯 Node 环境下被测试，
 * 而编辑器服务还牵着素材上传等重依赖；把纯 localStorage 的部分留在这里，
 * 判定逻辑就能脱离浏览器依赖验证。</p>
 */
import type { SceneDocument } from '@/features/scene-editor/model/types'

const key = (projectId: string) => `fengmotion:scene-documents:v1:${projectId}`

/**
 * 本地文档的变更计数：每保存一次就 +1。
 *
 * <p>为什么需要它：工作台用 useMemo 缓存「这份文档还是渲染时那份吗」的判定，
 * 而文档存在 localStorage 里 —— localStorage 的写入不会触发 React 重渲染，
 * 于是「进编辑器改完保存 → 返回同一试片 → 再进编辑器」这条路径会继续用旧判定，
 * 把已经变了的内容当成仍然一致。把保存次数做成可读信号，才能让缓存正确失效。</p>
 */
const versionKey = (projectId: string) => `fengmotion:scene-documents-version:${projectId}`

/** 读当前文档变更计数；没有记录时返回 0。 */
export function readDocumentsVersion(projectId: string): number {
  const raw = localStorage.getItem(versionKey(projectId))
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function bumpDocumentsVersion(projectId: string) {
  try {
    localStorage.setItem(versionKey(projectId), String(readDocumentsVersion(projectId) + 1))
  } catch {
    /* 存储不可用时不影响保存本身：版本号只用于让界面判定失效。 */
  }
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
  /* 内容可能变了：让工作台那份「文档与画面是否一致」的缓存作废。 */
  persistLocalDocument(key(doc.projectId), readDocuments(doc.projectId))
  bumpDocumentsVersion(doc.projectId)
}

/** 编辑器导出的试片记录：把画面反查回「渲染时用的那份文档」。 */
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

const rendersKey = (projectId: string) => `fengmotion:editor-renders:${projectId}`

export function readEditorRenders(projectId: string): EditorRenderRecord[] {
  try {
    const rows = JSON.parse(localStorage.getItem(rendersKey(projectId)) ?? '[]')
    return Array.isArray(rows)
      ? rows.filter(
          (r) => r?.projectId === projectId && typeof r.assetId === 'string' && typeof r.createdAt === 'string',
        )
      : []
  } catch {
    return []
  }
}

export function writeEditorRender(record: EditorRenderRecord) {
  const rows = readEditorRenders(record.projectId)
  localStorage.setItem(rendersKey(record.projectId), JSON.stringify([record, ...rows]))
  persistLocalDocument(rendersKey(record.projectId), [record,...rows])
}

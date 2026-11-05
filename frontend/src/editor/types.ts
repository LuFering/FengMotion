export type EditorEngine = 'remotion' | 'html-gsap'
export type LayerKind = 'text' | 'image' | 'video' | 'audio' | 'shape'
export interface EditorLayer {
  id: string
  kind: LayerKind
  name: string
  visible: boolean
  locked: boolean
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  start: number
  end: number
  text: string
  fontSize: number
  fontWeight: number
  color: string
  align: 'left' | 'center' | 'right'
  fill: string
  radius: number
  assetId?: string
  src?: string
  fit: 'cover' | 'contain'
  trimStart: number
  volume: number
  motion: 'none' | 'rise' | 'scale'
  entrance: number
  exit: number
  travel: number
  zoom: number
}
export interface ElementPatch {
  assetId?: string
  text?: string
  src?: string
  x?: number
  y?: number
  scale?: number
  rotation?: number
  opacity?: number
  fontSize?: number
  color?: string
  backgroundColor?: string
  width?: number
  height?: number
  radius?: number
  visible?: boolean
}
export interface SourceScene {
  id: string
  name: string
  engine: 'html-gsap'
  file: string
  source: string
  sourceHash: string
  width: number
  height: number
  fps: number
  durationSeconds: number
}
export interface SceneDocument {
  schemaVersion: 1
  id: string
  projectId: string
  name: string
  engine: EditorEngine
  width: number
  height: number
  fps: number
  durationSeconds: number
  background: string
  layers: EditorLayer[]
  patches: Record<string, ElementPatch>
  source?: SourceScene
  updatedAt: string
}
export interface HtmlElementInfo {
  id: string
  name: string
  kind: 'text' | 'image' | 'group'
  text?: string
  src?: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  color: string
  gradientText?: boolean
  opacity: number
}
export type EditorManifest = { projectId: string; scenes: SourceScene[]; assets: string[] }

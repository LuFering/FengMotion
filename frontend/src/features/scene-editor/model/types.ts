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
  /** 变换原点，百分比：50/50 是中心。旋转和缩放围绕这一点发生。 */
  transformOriginX: number
  transformOriginY: number
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
  /** 该图层的关键帧。为空时图层按静态属性渲染。 */
  keyframes?: LayerKeyframe[]
}
/** 一个属性关键帧：在某个秒数上把某个数值属性设成某个值。 */
export interface LayerKeyframe {
  id: string
  /** 相对图层入点的秒数，避免整体移动图层时关键帧跟着错位。 */
  time: number
  property: 'x' | 'y' | 'rotation' | 'opacity' | 'scale'
  value: number
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

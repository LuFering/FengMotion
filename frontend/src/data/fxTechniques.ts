/**
 * 特效技法库数据 —— 从既有 FX 源库（workflow-gallery 的 fx 注册表）抽出，16 条，
 * 字段保持源库语义：能力标签 execType 是**源库元数据**，不代表本页可以执行。
 * 媒体已从 15.7MB 内嵌页抽出并压缩到 public/fx/（poster 960px webp / motion 640px mp4）。
 *
 * ⚠️ 不要在这里编造能力：runnable / composable / reference 的原值必须保留；
 *    本页不提供执行器，执行与工作流插入均未接入（详见 FxLibrary 底部说明）。
 */

export type FxCategory = 'camera' | 'transition' | 'lighting' | 'particles' | 'compositing' | 'stylize' | 'typography'
export type FxExecType = 'runnable' | 'composable' | 'reference'
export type FxImpl = 'realtime' | 'offline' | 'ai' | 'composite'
export type FxInputKind = 'image' | 'video' | 'audio' | 'text'

export interface FxParam {
  key: string
  label: string
  /** 源库默认值，已带单位 */
  value: string
  hint: string
}

export interface FxTechnique {
  id: string
  name: string
  nameEn: string
  aliases: string[]
  keywords: string[]
  intent: string
  category: FxCategory
  categoryLabel: string
  scenes: string[]
  antiScenes: string[]
  execType: FxExecType
  execLabel: string
  impl: FxImpl
  implLabel: string
  /** 1–5，源库口径 */
  complexity: number
  inputKinds: FxInputKind[]
  inputLabels: string[]
  /** 主输入要求（视频 / 图像 …，含 accepts） */
  inputRequirement: string
  output: string
  dependencies: string[]
  steps: string[]
  compatibility: string[]
  limitations: string[]
  failures: string[]
  params: FxParam[]
  previewImage: string
  previewVideo: string | null
  previewCaption: string
  related: string[]
  alternatives: string[]
  featured: boolean
  version: string
  updatedAt: string
  /* ── 来源与许可 ──
     外部导入的条目必须能回答「从哪来、能不能商用」。
     留空表示「不知道」，界面不要补默认文案。 */
  /** builtin / lemo / shotcraft / scene */
  sourceKind?: string
  sourceProject?: string
  sourceUrl?: string
  sourceVersion?: string
  licenseCode?: string
  licensePreview?: string
  attribution?: string
  sourcePath?: string
  importedAt?: string
}

export const FX_CATEGORIES: Array<{ id: FxCategory; label: string }> = [
  { id: 'camera', label: '运镜' },
  { id: 'transition', label: '转场' },
  { id: 'lighting', label: '光影' },
  { id: 'particles', label: '粒子' },
  { id: 'compositing', label: '合成' },
  { id: 'stylize', label: '风格化' },
  { id: 'typography', label: '文字动画' },
]

/** 能力标签逐字保留源库文案；hint 说明它只是来源库元数据。 */
export const FX_EXEC_TYPES: Record<FxExecType, { label: string; hint: string }> = {
  runnable: { label: '可直接执行', hint: '源库标记为有执行实现' },
  composable: { label: '可组合', hint: '源库标记为与其他节点组合使用' },
  reference: { label: '知识参考', hint: '源库标记为仅供学习参考，无执行实现' },
}

export const FX_IMPLS: Record<FxImpl, string> = {
  realtime: '实时',
  offline: '离线渲染',
  ai: 'AI 生成',
  composite: '合成',
}

export const FX_INPUT_TYPES: Record<FxInputKind, string> = {
  image: '图像',
  video: '视频',
  audio: '音频',
  text: '文本',
}

export const FX_TECHNIQUES: FxTechnique[] = []

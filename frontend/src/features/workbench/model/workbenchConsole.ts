import { ArrowUpRight, Check, Clock, Plus, RefreshCcw01, Settings01, SwitchHorizontal01 } from '@untitledui/icons'

/* 控制台的全部视图：五大常驻入口（对话 / 创作要求 / 执行记录 / 版本 / 修改审阅）
   兼容历史枚举：scene 映射至对话目标摘要，settings 映射至创作要求，edit 映射至场景编辑器。 */
export type SideTab = 'chat' | 'brief' | 'task' | 'versions' | 'review' | 'scene' | 'settings' | 'edit'

export type ConstraintKey = 'preserveCamera' | 'preserveCaptions' | 'limitToSelection' | 'reuseExistingComponents' | 'preserveOutsideSelection'

export const CONSTRAINT_LABELS: Array<[ConstraintKey, string]> = [
  ['preserveCamera', '保留当前机位运动'],
  ['preserveCaptions', '保留字幕与配音'],
  ['limitToSelection', '不修改其他场景'],
  ['reuseExistingComponents', '尽量复用现有组件'],
  /* 「背景不要动」是文档第 7 节的原话要求。它和「不修改其他场景」不是一回事：
     前者是框选区域之外不动，后者是别的场景不动。只写自由文本没法被程序核对。 */
  ['preserveOutsideSelection', '框选区域外保持不动（背景不要动）'],
]

export const quickActions = [
  { id: 'undo', label: '撤销', icon: RefreshCcw01, prompt: '撤销上一次修改。' },
  { id: 'redo', label: '重做', icon: RefreshCcw01, prompt: '重做上一次修改。' },
  { id: 'compare', label: '对比版本', icon: SwitchHorizontal01, compare: true },
  { id: 'camera', label: '锁定机位', icon: Settings01, constraint: 'preserveCamera' as const },
  { id: 'captions', label: '保留字幕', icon: Check, constraint: 'preserveCaptions' as const },
  { id: 'assets', label: '替换素材', icon: Plus, constraint: 'attachment' as const },
  { id: 'duration', label: '调整时长', icon: Clock, prompt: '调整当前场景时长。请先询问目标时长。' },
  { id: 'resolution', label: '修改分辨率', icon: Settings01, prompt: '调整项目分辨率。请先询问目标分辨率。' },
  { id: 'regenerate', label: '重新制作预览', icon: ArrowUpRight, prompt: '请重新制作当前修改目标，保留已指定的内容和约束。' },
]

/** 左栏的四个页签：概览（要你决定的事）/ 产物 / 内容（这部片有哪些画面）/ 资料。 */
export type RailTab = 'overview' | 'artifacts' | 'content' | 'materials'

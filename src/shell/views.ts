/**
 * 导航结构 —— 扁平，按用户视角命名。
 *
 * 与 paba 的区别：paba 是扁平的（4 主项 + 一个「创作工具」标签）。
 * 本产品导航对齐产品三层定位（工作流 / 创作知识 / 普通素材）+ 创作动线：
 *   首页 —— 起活儿（想法入口、画面库）
 *   我的创作 —— 视频任务列表，进任务后切编排/时序/交付等子视图
 *   工作流 —— 制作方案的定义与复用（怎么做）
 *   特效库 / 参考片库 —— 创作知识（实现方法 / 创作依据）
 *   我的素材 —— 普通素材的导入与整理
 * 设置在侧栏底部；纠错记录先嵌入 AI 执行过程，不占一级导航。
 */

export type ViewId =
  | 'home'
  | 'production'
  | 'project'
  | 'assets'
  | 'script'
  | 'audio'
  | 'render'
  | 'knowledge'
  | 'sources'
  | 'reference'
  | 'rules'
  | 'methods'

export interface NavLeaf {
  id: ViewId
  label: string
  /** paba 雪碧图符号名 */
  icon: string
}

export interface NavNode {
  /** 有 children = 可展开的分组；没有 = 直接跳转的叶子 */
  id?: ViewId
  label: string
  icon: string
  children?: NavLeaf[]
}

/**
 * 导航结构 —— 按用户视角命名，对应产品的三层定位：
 *   工作流（怎么做）· 创作知识（特效库/参考片库：依据与方法）· 普通素材（我的素材）
 * 项目内子视图（编排/时序/交付）不占全局导航，从「我的创作」进入任务后切换。
 */
export const NAV: NavNode[] = [
  { id: 'home',       label: '首页',   icon: 'house' },
  { id: 'project',    label: '我的创作', icon: 'clapperboard' },
  { id: 'methods',    label: '工作流',   icon: 'workflow' },
  { id: 'knowledge',  label: '特效库',   icon: 'panels-top-left' },
  { id: 'reference',  label: '参考片库', icon: 'film' },
  { id: 'assets',     label: '我的素材', icon: 'image' },
]

/** 扁平导航，无可展开分组 */
export const DEFAULT_EXPANDED: string[] = []

/** 「创作资产」在哪个组里也有入口（同一个 ViewId，项目内是过滤视图） */
export const CONTEXT_VIEWS: ViewId[] = ['assets']

export const VIEW_META: Record<ViewId, { title: string; hint: string }> = {
  home:       { title: '首页', hint: '从一句话开始' },
  production: { title: '制作工作台', hint: '场景列表 + 监看器 + AI 对话' },
  project:    { title: '我的创作', hint: '视频任务：正在制作、等待处理、已完成' },
  assets:     { title: '我的素材', hint: '自己的图片/视频/音频/生成文件，导入与复用' },
  script:     { title: '内容编排', hint: '脚本段落、版本差异、时长与口播估算' },
  audio:      { title: '时序校验', hint: '脚本与成片之间哪里对不上' },
  render:     { title: '发布与验收', hint: '能交付什么、缺什么、验收结果' },
  sources:    { title: '资源接入', hint: '外部资源从哪进来、解析到哪一步、产物审没审' },
  knowledge:  { title: '特效库', hint: '特效/场景设计/转场/动画的实现方法，供工作流检索调用' },
  reference:  { title: '参考片库', hint: '参考视频的画面段、机位运动、节奏与风格知识' },
  rules:      { title: '反馈与规则', hint: '纠错记录 → 规则候选 → 生效规则' },
  methods:    { title: '工作流', hint: '制作方案：步骤、节点、提示词与检查要求' },
}

/**
 * 导航结构 —— 树形，一级项可点击展开/收缩。
 *
 * 与 paba 的区别：paba 是扁平的（4 主项 + 一个「创作工具」标签）。
 * 本产品的导航项更多，用**可展开的树**。
 *
 * ⚠️ 分组原则（页面职责合同 §三）：**一级分组代表用户要处理的工作领域，
 *    不是"系统里存了什么数据"**。所以不再有「项目管理 / 知识与方法」这种
 *    按数据类型划分的组，而改成：
 *      项目与交付 —— 推进当前作品（需要项目上下文）
 *      创作资源   —— 跨项目发现、调用、复用的资源（不需要项目上下文）
 *      规则与质量 —— 系统如何验收、约束、改进创作行为
 *
 * 「创作资产」在两个领域都出现：全局入口是统一入口，项目内是带当前项目过滤的
 * 上下文视图 —— 同一个 ViewId、同一套组件与数据，不是两套页面。
 */

export type ViewId =
  | 'overview'
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

export const NAV: NavNode[] = [
  // 一级叶子：直接跳转
  { id: 'overview',   label: '首页',       icon: 'house' },
  { id: 'production', label: '制作工作台', icon: 'clapperboard' },

  // 可展开分组 —— 按工作领域，不按数据类型
  {
    label: '项目与交付', icon: 'folder-open',
    children: [
      { id: 'project', label: '项目指挥中心', icon: 'folder-open' },
      { id: 'script',  label: '内容编排',     icon: 'file-text' },
      { id: 'assets',  label: '创作资产',     icon: 'image' },
      { id: 'audio',   label: '时序校验',     icon: 'audio-lines' },
      { id: 'render',  label: '发布与验收',   icon: 'upload' },
    ],
  },
  {
    label: '创作资源', icon: 'panels-top-left',
    children: [
      { id: 'sources',   label: '资源接入',   icon: 'import' },
      { id: 'knowledge', label: '创作技法库', icon: 'panels-top-left' },
      { id: 'reference', label: '参考片库',   icon: 'film' },
      // 与「项目与交付」里那一项是同一个视图：这里是不带项目过滤的全局入口
      { id: 'assets',    label: '创作资产 · 全局', icon: 'image' },
    ],
  },
  {
    label: '规则与质量', icon: 'square-check',
    children: [
      { id: 'rules',   label: '反馈与规则',     icon: 'square-check' },
      { id: 'methods', label: '流程与质量保障', icon: 'workflow' },
    ],
  },
]

/** 一级分组默认展开哪几个 */
export const DEFAULT_EXPANDED = ['项目与交付', '创作资源', '规则与质量']

/** 「创作资产」在哪个组里也有入口（同一个 ViewId，项目内是过滤视图） */
export const CONTEXT_VIEWS: ViewId[] = ['assets']

export const VIEW_META: Record<ViewId, { title: string; hint: string }> = {
  overview:   { title: '首页',         hint: '项目入口、最近项目、常用工具' },
  production: { title: '制作工作台',   hint: '制作单元列表 + 监看器 + AI 对话' },
  project:    { title: '项目指挥中心', hint: '现在能不能往下走、不能的话卡在哪' },
  assets:     { title: '创作资产',     hint: '有哪些可用资源、适合用在哪、还缺什么' },
  script:     { title: '内容编排',     hint: '脚本段落、版本差异、时长与口播估算' },
  audio:      { title: '时序校验',     hint: '脚本与成片之间哪里对不上' },
  render:     { title: '发布与验收',   hint: '能交付什么、缺什么、验收结果' },
  sources:    { title: '资源接入',     hint: '外部资源从哪进来、解析到哪一步、产物审没审' },
  knowledge:  { title: '创作技法库',   hint: '157 张技法卡 · 效果 / 适用 / 执行 / 应用' },
  reference:  { title: '参考片库',     hint: '从参考作品里提取可复用的做法' },
  rules:      { title: '反馈与规则',   hint: '反馈事件 → 规则候选 → 生效规则' },
  methods:    { title: '流程与质量保障', hint: '阶段、门槛、验收标准与阻塞原因' },
}

/**
 * 节点类别：卡片顶部色条、缩略图色条、节点库分组都按这个分。
 * 颜色变量 --cat-* 按主题定义在 styles/workflow.css；这里只给类别名和中文标签。
 */
export type NodeCategory = 'input' | 'make' | 'review' | 'deliver' | 'doc' | 'gate'

const BY_TYPE: Record<string, NodeCategory> = {
  prompt: 'input',
  refs: 'input',
  capability: 'input',
  create: 'make',
  review: 'review',
  delivery: 'deliver',
  artifact: 'doc',
  gate: 'gate',
}

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  input: '输入',
  make: '制作',
  review: '审片',
  deliver: '交付',
  doc: '阶段产物',
  gate: '检查点',
}

export const nodeCategory = (type: string): NodeCategory => BY_TYPE[type] ?? 'doc'

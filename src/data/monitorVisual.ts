/** 监看区视觉项的类型标签 —— 放数据文件，不进组件文件（fast refresh 规则）。 */
export type MonitorVisualKind = 'film' | 'ref' | 'sample' | 'testfilm'

export const VISUAL_KIND_LABEL: Record<MonitorVisualKind, string> = {
  film: '当前预览',
  ref: '参考素材',
  sample: '方向样稿',
  testfilm: '试片',
}

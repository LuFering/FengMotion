/** 预览壳与探针共用的小工具：发消息给工作台、画布标记。单独成文件，避免 entry ⇄ probe 互相引用。 */
import type { LiveEvent } from '../../src/features/workbench/model/livePreviewProtocol'

type EventBody = LiveEvent extends infer E ? (E extends { fm: 'live' } ? Omit<E, 'fm'> : never) : never

/** 只发给嵌入它的工作台窗口 */
export const post = (event: EventBody) => window.parent.postMessage({ fm: 'live', ...event }, '*')

/** 包在 composition 外面的那层 div 带这个属性：探针以它的矩形为整个画面 */
export const CANVAS_ATTR = 'data-fm-canvas'

/** 后台逐帧采集元素出现时间用的隐藏画面（见 layers.tsx）：和真画面分开，探针不会把它当成画面 */
export const SAMPLE_ATTR = 'data-fm-sample'

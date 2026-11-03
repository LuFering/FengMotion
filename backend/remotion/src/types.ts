/**
 * 影片数据结构：AI 产出的就是这一份 JSON。
 *
 * <p>刻意保持扁平与自解释：字段名直接描述视觉意图（text / backgroundColor /
 * transition），不用 Remotion 的术语 —— AI 不需要知道 Remotion 才能出片，
 * 而换渲染器时这份数据仍然成立。</p>
 */

/** 一个场景（一段连续画面）。 */
export interface Scene {
  /** 场景标识，用于日志与排错 */
  id: string
  /** 屏幕上的主文字；空字符串表示纯画面 */
  text?: string
  /** 副标题或说明文字 */
  subtitle?: string
  /** 背景色，CSS 颜色值 */
  backgroundColor?: string
  /** 文字颜色 */
  color?: string
  /** 背景图 URL（相对项目目录或 http）；与 backgroundColor 同时给时图片优先 */
  backgroundImage?: string
  /** 本场景持续秒数 */
  durationSeconds: number
  /** 文字出现的动画：fade（淡入）/ none（直接出现） */
  textAnimation?: 'fade' | 'slide' | 'none'
  /** 进入本场景的转场；第一个场景忽略 */
  transition?: 'cut' | 'fade'
}

/** 整部片的渲染参数与场景列表。 */
export interface FilmProps {
  /** 画面尺寸 */
  width: number
  height: number
  /** 帧率 */
  fps: number
  /** 场景列表，按播放顺序 */
  scenes: Scene[]
  /** 全局背景色（场景未指定时使用） */
  backgroundColor?: string
  /** 全局文字颜色 */
  color?: string
}

export type { FilmProps as default }

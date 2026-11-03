/**
 * 默认影片数据。
 *
 * <p>用于 Remotion Studio 预览与「渲染参数缺失时的兜底」。真实渲染总是由
 * 渲染请求传入完整 props，所以这里的值只需要保证能渲染出一个合理画面。</p>
 */

import type { FilmProps } from './types'

export const DEFAULT_FILM: FilmProps = {
  width: 1920,
  height: 1080,
  fps: 30,
  backgroundColor: '#0f172a',
  color: '#f8fafc',
  scenes: [
    {
      id: 'demo-1',
      text: 'FengMotion',
      subtitle: '示例画面',
      durationSeconds: 2,
      textAnimation: 'fade',
    },
  ],
}

/**
 * Remotion 渲染入口（统一工程）。
 *
 * <p><strong>为什么只有一个工程</strong>：每个项目各自装一份 Remotion 依赖，
 * 会让磁盘和安装时间随项目数线性增长，版本也容易漂移。这里所有项目共用一份
 * 依赖与渲染管线，项目之间的差异全部通过「props」表达 —— AI 只需要产出一份
 * 场景数据，不需要碰工程配置。</p>
 *
 * <p><strong>AI 写什么、不写什么</strong>：AI 产出的是 `ScenesDocument`
 * （一组场景）。渲染参数（分辨率、帧率、时长）由请求方给，组件树由
 * {@link Film} 按数据装配。这样 AI 不需要理解 Remotion 的 API 也能出片，
 * 同时保留 Remotion 的动画能力（组件内部可以用 useCurrentFrame 等）。</p>
 */

import React from 'react'
import { Composition, registerRoot } from 'remotion'
import { Film, type FilmProps } from './Film'
import { DEFAULT_FILM } from './defaults'

/**
 * 计算总帧数：以最长场景为准，至少 1 帧。
 *
 * @param props 影片数据
 * @returns 总帧数
 */
function totalFrames(props: FilmProps): number {
  const fps = props.fps || 30
  const seconds = props.scenes.reduce((sum, scene) => sum + (scene.durationSeconds || 0), 0)
  return Math.max(1, Math.round(seconds * fps))
}

const Root: React.FC = () => (
  <Composition
    id="Film"
    component={Film}
    // 默认值只用于 Remotion Studio 预览；真实渲染时由 calculateMetadata 覆盖
    durationInFrames={totalFrames(DEFAULT_FILM)}
    fps={DEFAULT_FILM.fps}
    width={DEFAULT_FILM.width}
    height={DEFAULT_FILM.height}
    defaultProps={DEFAULT_FILM}
    calculateMetadata={({ props }) => ({
      durationInFrames: totalFrames(props as FilmProps),
      fps: (props as FilmProps).fps,
      width: (props as FilmProps).width,
      height: (props as FilmProps).height,
    })}
  />
)

registerRoot(Root)

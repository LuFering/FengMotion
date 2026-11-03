/**
 * 影片组件：把场景数据渲染成画面。
 *
 * <p>每个场景是一个 Sequence，按 durationSeconds 换算成帧数依次拼接。
 * 转场在场景内部用透明度做（fade），不需要额外的合成层 —— 简单可靠，
 * 且不依赖 Remotion 的 TransitionSeries（那是额外依赖）。</p>
 */

import React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate, Img, staticFile } from 'remotion'
import type { FilmProps, Scene } from './types'

/** 默认配色：深色底 + 高对比文字，适合视频观看。 */
const FALLBACK_BG = '#0f172a'
const FALLBACK_FG = '#f8fafc'

/**
 * 一个场景的画面。
 *
 * @param scene 场景数据
 * @param fps 帧率，用于把秒换算成帧
 * @param index 场景序号，用于决定动画相位
 */
const SceneView: React.FC<{ scene: Scene; fps: number; index: number }> = ({ scene, fps, index }) => {
  const frame = useCurrentFrame()
  const totalFrames = Math.max(1, Math.round(scene.durationSeconds * fps))
  const animation = scene.textAnimation ?? 'fade'

  /* 文字动画：前 0.5 秒（或总时长的 1/3，取小）内完成进场。
     用 interpolate 而不是 CSS transition —— Remotion 是逐帧渲染，
     CSS 动画在渲染进程里不一定按帧推进。 */
  const enterFrames = Math.max(1, Math.min(Math.round(fps * 0.5), Math.round(totalFrames / 3)))
  const progress = interpolate(frame, [0, enterFrames], [0, 1], { extrapolateRight: 'clamp' })

  const textOpacity = animation === 'none' ? 1 : progress
  const textOffset = animation === 'slide' ? interpolate(progress, [0, 1], [24, 0]) : 0

  /* 转场：fade 在该场景的最后 0.3 秒淡出；首个场景不做入场淡入 */
  const fadeOutFrames = Math.max(1, Math.round(fps * 0.3))
  const fadeOut = scene.transition === 'fade' && index > 0
    ? interpolate(frame, [totalFrames - fadeOutFrames, totalFrames], [1, 0], { extrapolateLeft: 'clamp' })
    : 1

  const background = scene.backgroundColor ?? FALLBACK_BG
  const color = scene.color ?? FALLBACK_FG

  return (
    <AbsoluteFill style={{ backgroundColor: background, opacity: fadeOut }}>
      {scene.backgroundImage && (
        <AbsoluteFill>
          {/* 背景图铺满并裁切，不拉伸变形 */}
          <Img
            src={scene.backgroundImage.startsWith('http') ? scene.backgroundImage : staticFile(scene.backgroundImage)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </AbsoluteFill>
      )}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: '8%',
          textAlign: 'center',
          opacity: textOpacity,
          transform: textOffset ? `translateY(${textOffset}px)` : undefined,
        }}
      >
        {scene.text ? (
          <div
            style={{
              color,
              fontSize: Math.round(Math.min(120, totalFrames > 0 ? 72 : 72)),
              fontWeight: 700,
              lineHeight: 1.25,
              fontFamily: '"Noto Sans CJK SC", "Source Han Sans SC", sans-serif',
              textShadow: scene.backgroundImage ? '0 2px 12px rgba(0,0,0,.6)' : undefined,
            }}
          >
            {scene.text}
          </div>
        ) : null}
        {scene.subtitle ? (
          <div
            style={{
              marginTop: 18,
              color,
              opacity: 0.82,
              fontSize: 30,
              fontWeight: 400,
              lineHeight: 1.5,
              fontFamily: '"Noto Sans CJK SC", "Source Han Sans SC", sans-serif',
            }}
          >
            {scene.subtitle}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

/**
 * 整部影片：把场景按顺序拼成时间轴。
 *
 * @param props 影片数据
 */
export const Film: React.FC<FilmProps> = ({ scenes, fps, backgroundColor, color }) => {
  let cursor = 0
  return (
    <AbsoluteFill style={{ backgroundColor: backgroundColor ?? FALLBACK_BG }}>
      {scenes.map((scene, index) => {
        const from = cursor
        const frames = Math.max(1, Math.round(scene.durationSeconds * fps))
        cursor += frames
        return (
          <Sequence key={scene.id || index} from={from} durationInFrames={frames}>
            <SceneView
              scene={{ color: scene.color ?? color, ...scene }}
              fps={fps}
              index={index}
            />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

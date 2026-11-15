import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  Code2,
  Film,
  Pause,
  Play,
  Sparkles,
} from 'lucide-react'
import type { FxTechnique } from '@/data/fxTechniques'

interface FxVisualPosterProps {
  technique: FxTechnique
  interactive?: boolean
  className?: string
  playing?: boolean
  onTogglePlay?: () => void
}

/**
 * 特效技法多维度视觉预览组件：
 * 1. 真实静态图/视频：优先展示高清素材；
 * 2. remotion-scenes（画面代码库）：生成基于组件特性的动态流光、粒子、网格与打字机视效舞台；
 * 3. video-shotcraft（镜头运镜库）：生成 3D 摄影机视锥体空间轨迹动态模拟器；
 * 4. 其它代码/参考：生成富有电影感的美学光场。
 */
export function FxVisualPoster({
  technique,
  interactive = false,
  className = '',
  playing: extPlaying,
  onTogglePlay,
}: FxVisualPosterProps) {
  const [internalPlaying, setInternalPlaying] = useState(false)
  const isPlaying = extPlaying !== undefined ? extPlaying : internalPlaying
  const togglePlay = onTogglePlay || (() => setInternalPlaying((p) => !p))

  const isRemotionScene =
    technique.sourceProject === 'remotion-scenes' ||
    (technique.steps && technique.steps.some((s) => s.startsWith('__SOURCE_CODE__:')))

  const isCameraShot =
    technique.sourceProject === 'video-shotcraft' ||
    technique.category === 'camera' ||
    technique.id.includes('zoom') ||
    technique.id.includes('camera')

  // 如果有真实可用海报或视频
  if (technique.previewImage && !technique.previewImage.includes('broken')) {
    return (
      <div className={`fx-visual-poster is-real-image ${className}`}>
        <img
          src={technique.previewImage}
          alt={technique.name}
          className="fx-visual-img"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
            e.currentTarget.parentElement?.classList.add('has-fallback')
          }}
        />
        {technique.sourceProject && technique.sourceProject !== 'builtin' && (
          <span className="fx-visual-badge">{technique.sourceProject}</span>
        )}
      </div>
    )
  }

  // 1. Remotion TSX 画面代码组件视效舞台
  if (isRemotionScene) {
    return (
      <RemotionSceneVisual
        technique={technique}
        interactive={interactive}
        className={className}
        playing={isPlaying}
        onToggle={togglePlay}
      />
    )
  }

  // 2. 电影运镜与分镜 3D 摄影机轨迹模拟器
  if (isCameraShot) {
    return (
      <CameraShotVisual
        technique={technique}
        interactive={interactive}
        className={className}
        playing={isPlaying}
        onToggle={togglePlay}
      />
    )
  }

  // 3. 通用质感光场
  return (
    <GenericVisual
      technique={technique}
      className={className}
    />
  )
}

/** Remotion 画面代码组件动态视效渲染舞台 */
function RemotionSceneVisual({
  technique,
  interactive,
  className = '',
  playing,
  onToggle,
}: {
  technique: FxTechnique
  interactive: boolean
  className?: string
  playing: boolean
  onToggle: () => void
}) {
  const [frame, setFrame] = useState(0)
  const animRef = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      return
    }
    const start = performance.now()
    const loop = (time: number) => {
      const elapsed = (time - start) / 1000
      setFrame(Math.floor((elapsed * 30) % 150)) // 5 秒循环 150 帧
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [playing])

  const name = technique.name.toLowerCase()
  const isAurora = name.includes('aurora') || name.includes('glow') || name.includes('light')
  const isParticle = name.includes('particle') || name.includes('star') || name.includes('fire')
  const isLiquid = name.includes('liquid') || name.includes('wave') || name.includes('blob')

  // 根据分类或组件名称计算色彩与动效基调
  const themeColor = isAurora
    ? 'rgba(56, 189, 248, 0.7)'
    : isParticle
    ? 'rgba(245, 158, 11, 0.7)'
    : isLiquid
    ? 'rgba(236, 72, 153, 0.7)'
    : 'rgba(99, 102, 241, 0.7)'

  return (
    <div
      className={`fx-visual-poster is-remotion-scene ${className} ${playing ? 'is-animating' : ''}`}
      style={{
        background: 'radial-gradient(ellipse at center, #121424 0%, #080911 100%)',
      }}
    >
      {/* 动态光晕与背景网格 */}
      <div
        className="fx-scene-glow"
        style={{
          background: `radial-gradient(circle, ${themeColor} 0%, transparent 65%)`,
          transform: `translate(${Math.sin(frame * 0.05) * 20}px, ${Math.cos(frame * 0.04) * 15}px) scale(${1 + Math.sin(frame * 0.03) * 0.15})`,
        }}
      />
      <div className="fx-scene-grid" />

      {/* 画面核心内容 */}
      <div className="fx-scene-content">
        <div className="fx-scene-badge">
          <Code2 size={11} className="text-blue-400" /> Remotion Scene · 30 FPS
        </div>
        <div className="fx-scene-title">{technique.name}</div>
        <div className="fx-scene-meta">
          <span>{technique.categoryLabel || '画面组件'}</span>
          {technique.sourcePath && <span className="fx-scene-path">{technique.sourcePath.split('/').pop()}</span>}
        </div>

        {/* 动态时间指示器 */}
        <div className="fx-scene-timeline">
          <div
            className="fx-scene-progress"
            style={{ width: `${(frame / 150) * 100}%` }}
          />
        </div>
      </div>

      {interactive && (
        <button
          type="button"
          className="fx-visual-play-btn"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          title={playing ? '暂停动画' : '播放实时画面渲染'}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
      )}
    </div>
  )
}

/** 3D 摄影机运镜与分镜运动轨迹模拟器 */
function CameraShotVisual({
  technique,
  interactive,
  className = '',
  playing,
  onToggle,
}: {
  technique: FxTechnique
  interactive: boolean
  className?: string
  playing: boolean
  onToggle: () => void
}) {
  const [progress, setProgress] = useState(0)
  const animRef = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      return
    }
    const start = performance.now()
    const loop = (time: number) => {
      const p = ((time - start) % 3000) / 3000 // 3秒一个运镜周期
      setProgress(p)
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [playing])

  const name = technique.name.toLowerCase()
  const isZoom = name.includes('zoom') || name.includes('punch') || name.includes('crash')
  const isOrbit = name.includes('orbit') || name.includes('circle') || name.includes('rotate')
  const isFlyover = name.includes('fly') || name.includes('over') || name.includes('pass')

  const motionType = isZoom ? '推拉急变焦' : isOrbit ? '环绕运镜' : isFlyover ? '俯冲掠过' : '多维运镜'

  return (
    <div
      className={`fx-visual-poster is-camera-shot ${className} ${playing ? 'is-animating' : ''}`}
      style={{
        background: 'radial-gradient(circle at 50% 120%, #151e2e 0%, #090d14 100%)',
      }}
    >
      {/* 3D 透视参考地平面网格 */}
      <div
        className="fx-camera-grid"
        style={{
          transform: `perspective(300px) rotateX(60deg) translateY(${progress * 40}px)`,
        }}
      />

      {/* 摄影机与视锥体动态示意 */}
      <div className="fx-camera-frustum-wrap">
        <div
          className="fx-camera-cone"
          style={{
            transform: isZoom
              ? `scale(${0.8 + progress * 0.8})`
              : isOrbit
              ? `rotate(${(progress - 0.5) * 50}deg)`
              : `translateY(${(progress - 0.5) * 30}px) scale(${1 + progress * 0.3})`,
          }}
        />

        <div className="fx-camera-marker">
          <Camera size={18} className="text-blue-400 animate-pulse" />
          <span className="fx-camera-focal">
            {isZoom ? `${Math.round(24 + progress * 60)}mm` : '35mm Cine'}
          </span>
        </div>
      </div>

      {/* 运镜元信息与轨迹标签 */}
      <div className="fx-camera-info">
        <div className="fx-camera-badge">
          <Film size={11} className="text-amber-400" />
          <span>{motionType}</span>
        </div>
        <div className="fx-camera-title">{technique.name}</div>
        <div className="fx-camera-intent">{technique.intent || '摄影机运动轨迹与分镜配方'}</div>
      </div>

      {interactive && (
        <button
          type="button"
          className="fx-visual-play-btn"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          title={playing ? '暂停运镜' : '播放运镜模拟'}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
      )}
    </div>
  )
}

/** 通用优雅光场占位 */
function GenericVisual({
  technique,
  className = '',
}: {
  technique: FxTechnique
  className?: string
}) {
  return (
    <div
      className={`fx-visual-poster is-generic ${className}`}
      style={{
        background: 'linear-gradient(135deg, #131722 0%, #0a0d14 100%)',
      }}
    >
      <div className="fx-generic-glow" />
      <div className="fx-generic-content">
        <div className="fx-generic-icon">
          <Sparkles size={16} className="text-blue-400" />
        </div>
        <div className="fx-generic-name">{technique.name}</div>
        <div className="fx-generic-cat">{technique.categoryLabel || '视觉技法'}</div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  Film,
  Pause,
  Play,
  Sparkles,
} from 'lucide-react'
import type { FxTechnique } from '@/data/fxTechniques'
import { LiveSceneRenderer } from '@/remotion/LiveSceneRenderer'

interface FxVisualPosterProps {
  technique: FxTechnique
  interactive?: boolean
  className?: string
  playing?: boolean
  onTogglePlay?: () => void
}

/**
 * 特效技法视觉海报渲染引擎：
 * 绝不在海报内部渲染名称或描述（避免与卡片下方的标题产生文字重叠穿透）。
 * 纯粹专注文态、色彩、空间运动与电影质感的呈现。
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

  // 1. 如果有真实图片（如 lemo-opuscar 风格库的 poster.jpg）
  if (technique.previewImage && !technique.previewImage.includes('broken')) {
    return (
      <div className={`fx-visual-poster is-real-image ${className}`}>
        <img
          src={technique.previewImage}
          alt={technique.name}
          className="fx-visual-img"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
            e.currentTarget.parentElement?.classList.add('has-fallback')
          }}
        />
        <div className="fx-visual-overlay" />
      </div>
    )
  }

  const isRemotion =
    technique.sourceProject === 'remotion-scenes' ||
    (technique.steps && technique.steps.some((s) => s.startsWith('__SOURCE_CODE__:')))

  const isCamera =
    technique.sourceProject === 'video-shotcraft' ||
    technique.category === 'camera' ||
    technique.id.includes('zoom') ||
    technique.id.includes('camera')

  // 2. Remotion TSX 画面代码组件真实代码渲染
  if (isRemotion) {
    return (
      <LiveSceneRenderer
        componentName={technique.name}
        sourcePath={technique.sourcePath}
        playing={isPlaying}
        interactive={interactive}
        className={className}
        onTogglePlay={togglePlay}
      />
    )
  }

  // 3. 电影镜头与运镜配方 3D 轨迹视口
  if (isCamera) {
    return (
      <CameraMotionVisual
        technique={technique}
        interactive={interactive}
        className={className}
        playing={isPlaying}
        onToggle={togglePlay}
      />
    )
  }

  // 4. 通用美学光场
  return <GenericAestheticVisual technique={technique} className={className} />
}

/** 电影运镜与分镜 3D 摄像机运动模拟器 */
function CameraMotionVisual({
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
  const [phase, setPhase] = useState(0)
  const animRef = useRef<number | null>(null)

  useEffect(() => {
    let p = 0
    let alive = true
    const loop = () => {
      if (!alive) return
      p = (p + 0.015) % 1
      setPhase(p)
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => {
      alive = false
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [])

  const name = technique.name.toLowerCase()
  const isZoom = name.includes('zoom') || name.includes('punch') || name.includes('crash')
  const isOrbit = name.includes('orbit') || name.includes('circle') || name.includes('rotate') || name.includes('tour')
  const isFlyover = name.includes('fly') || name.includes('over') || name.includes('overhead')
  const focal = isZoom ? `${Math.round(24 + phase * 65)}mm` : isOrbit ? '50mm Cine' : '35mm Cine'

  return (
    <div className={`fx-visual-poster is-camera-view ${className}`}>
      {/* 电影取景框：四角准星角标 */}
      <div className="fx-vf-corner tl" />
      <div className="fx-vf-corner tr" />
      <div className="fx-vf-corner bl" />
      <div className="fx-vf-corner br" />

      {/* 3D 空间动态透视网格地平面 */}
      <div
        className="fx-vf-grid"
        style={{
          transform: `perspective(240px) rotateX(62deg) translateY(${(phase * 35) % 35}px)`,
        }}
      />

      {/* 运镜运动轨迹光环 */}
      {isZoom && (
        <div className="fx-vf-zoom-rings">
          <div className="fx-zoom-ring r1" style={{ transform: `scale(${0.4 + phase * 1.2})`, opacity: 1 - phase }} />
          <div className="fx-zoom-ring r2" style={{ transform: `scale(${0.1 + phase * 1.2})`, opacity: 1 - phase }} />
        </div>
      )}

      {isOrbit && (
        <div className="fx-vf-orbit-track">
          <div
            className="fx-orbit-cam-dot"
            style={{
              transform: `rotate(${phase * 360}deg) translate(45px) rotate(-${phase * 360}deg)`,
            }}
          />
        </div>
      )}

      {isFlyover && (
        <div className="fx-vf-flyover-lines">
          <div className="fx-flyover-streak s1" style={{ transform: `translateY(${(phase * 120) % 100}px)` }} />
          <div className="fx-flyover-streak s2" style={{ transform: `translateY(${((phase + 0.5) * 120) % 100}px)` }} />
        </div>
      )}

      {/* 中心十字瞄准器 */}
      <div className="fx-vf-crosshair" />

      {/* 摄影机与焦距指示（无多余标题，绝不遮挡底部文字） */}
      <div className="fx-vf-hud-top">
        <div className="fx-vf-badge">
          <Film size={10} className="text-amber-400" />
          <span>{isZoom ? '急推变焦' : isOrbit ? '空间环绕' : isFlyover ? '俯冲掠过' : '镜头运镜'}</span>
        </div>
        <div className="fx-vf-focal">
          <Camera size={11} className="text-blue-400" />
          <span>{focal}</span>
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
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
      )}
    </div>
  )
}

/** 通用优雅流光 */
function GenericAestheticVisual({
  technique,
  className = '',
}: {
  technique: FxTechnique
  className?: string
}) {
  return (
    <div className={`fx-visual-poster is-generic ${className}`}>
      <div className="fx-generic-aurora" />
      <div className="fx-visual-top-badge">
        <Sparkles size={11} className="text-indigo-400" />
        <span>{technique.categoryLabel || '视觉技法'}</span>
      </div>
    </div>
  )
}

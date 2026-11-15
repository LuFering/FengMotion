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
      p = (p + 0.016) % 1
      setPhase(p)
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => {
      alive = false
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [])

  const name = (technique.name + ' ' + technique.id + ' ' + (technique.intent || '')).toLowerCase()
  const isZoom = name.includes('zoom') || name.includes('punch') || name.includes('crash')
  const isOrbit = name.includes('orbit') || name.includes('circle') || name.includes('rotate') || name.includes('tour')
  const isFlyover = name.includes('fly') || name.includes('over') || name.includes('overhead') || name.includes('tilt') || name.includes('glide')
  const isDepth = name.includes('depth') || name.includes('layer') || name.includes('parallax')
  const is3D = name.includes('3d') || name.includes('scene') || name.includes('space') || name.includes('terminal') || (!isZoom && !isOrbit && !isFlyover && !isDepth)

  const focal = isZoom
    ? `${Math.round(24 + phase * 65)}mm`
    : isOrbit
    ? '50mm Cine'
    : isDepth
    ? '85mm Prime'
    : isFlyover
    ? '28mm Ultra'
    : '35mm Cine'

  const motionLabel = isZoom
    ? '急推撞屏变焦'
    : isOrbit
    ? '空间环绕运镜'
    : isDepth
    ? '分层视差滑轨'
    : isFlyover
    ? '俯冲掠过特写'
    : '3D 空间轨迹演示'

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
          transform: `perspective(240px) rotateX(64deg) translateY(${(phase * 32) % 32}px)`,
        }}
      />

      {/* 1. 急推变焦：多重动态收缩光环与冲击波 */}
      {isZoom && (
        <div className="fx-vf-zoom-rings">
          <div className="fx-zoom-ring r1" style={{ transform: `scale(${0.3 + phase * 1.4})`, opacity: 1 - phase }} />
          <div className="fx-zoom-ring r2" style={{ transform: `scale(${0.08 + phase * 1.3})`, opacity: 1 - phase }} />
          <div className="fx-zoom-punch-box" style={{ transform: `scale(${0.85 + Math.sin(phase * Math.PI) * 0.3})` }} />
        </div>
      )}

      {/* 2. 环绕运镜：360° 旋转光球与环状轨道 */}
      {isOrbit && (
        <div className="fx-vf-orbit-track">
          <div
            className="fx-orbit-cam-dot"
            style={{
              transform: `rotate(${phase * 360}deg) translate(50px) rotate(-${phase * 360}deg)`,
            }}
          />
          <div
            className="fx-orbit-cam-dot inner"
            style={{
              transform: `rotate(${-phase * 360}deg) translate(28px) rotate(${phase * 360}deg)`,
            }}
          />
        </div>
      )}

      {/* 3. 俯冲掠过：高速景深划线与倾角光束 */}
      {isFlyover && (
        <div className="fx-vf-flyover-lines">
          <div className="fx-flyover-streak s1" style={{ transform: `translateY(${(phase * 140) % 110}px)` }} />
          <div className="fx-flyover-streak s2" style={{ transform: `translateY(${((phase + 0.5) * 140) % 110}px)` }} />
          <div className="fx-flyover-streak s3" style={{ transform: `translateY(${((phase + 0.25) * 140) % 110}px)` }} />
        </div>
      )}

      {/* 4. 分层视差滑轨：前、中、后景三层不同速度相对位移 */}
      {isDepth && (
        <div className="fx-vf-depth-layers">
          <div className="fx-depth-card bg" style={{ transform: `translateX(${Math.sin(phase * Math.PI * 2) * 12}px) scale(0.75)` }} />
          <div className="fx-depth-card mid" style={{ transform: `translateX(${Math.sin(phase * Math.PI * 2) * 28}px) scale(0.9)` }} />
          <div className="fx-depth-card fg" style={{ transform: `translateX(${Math.sin(phase * Math.PI * 2) * 45}px) scale(1.05)` }} />
        </div>
      )}

      {/* 5. 3D 空间演示：悬浮卡片姿态飞行 */}
      {is3D && (
        <div className="fx-vf-3d-cards">
          <div
            className="fx-3d-node n1"
            style={{
              transform: `perspective(300px) rotateY(${Math.sin(phase * Math.PI * 2) * 25}deg) rotateX(${Math.cos(phase * Math.PI * 2) * 15}deg) translateZ(${Math.sin(phase * Math.PI * 2) * 20}px)`,
            }}
          />
          <div
            className="fx-3d-node n2"
            style={{
              transform: `perspective(300px) rotateY(${-Math.sin(phase * Math.PI * 2) * 30}deg) rotateZ(${Math.sin(phase * Math.PI * 2) * 12}deg) translateZ(10px)`,
            }}
          />
        </div>
      )}

      {/* 中心十字准星 */}
      <div className="fx-vf-crosshair" />

      {/* 左上角：运镜类型徽章（安全区域，绝不遮挡右上角收藏按钮） */}
      <div className="fx-vf-hud-left">
        <Film size={10} className="text-amber-400" />
        <span>{motionLabel}</span>
      </div>

      {/* 左下角：摄影机机位与焦距 HUD（完全避开任何操作热区） */}
      <div className="fx-vf-hud-bottom">
        <Camera size={11} className="text-blue-400" />
        <span>{focal}</span>
        <span className="fx-vf-sep">/</span>
        <span className="fx-vf-angle">Tilt {Math.round(15 + Math.sin(phase * Math.PI * 2) * 18)}°</span>
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

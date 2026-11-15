import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { Code2 } from 'lucide-react'

// 利用 Vite 原生 glob 动态索引 204 个场景代码模块
const sceneModules = import.meta.glob('../remotion-scenes-src/scenes/**/*.tsx')

interface LiveSceneRendererProps {
  componentName: string
  sourcePath?: string
  playing?: boolean
  interactive?: boolean
  className?: string
  onTogglePlay?: () => void
}

export function LiveSceneRenderer({
  componentName,
  sourcePath,
  playing = true,
  interactive = false,
  className = '',
  onTogglePlay,
}: LiveSceneRendererProps) {
  const [Comp, setComp] = useState<React.ComponentType<any> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hovered, setHovered] = useState(false)
  const playerRef = useRef<PlayerRef>(null)

  // 根据组件名或 sourcePath 匹配对应的模块导入函数
  const moduleImporter = useMemo(() => {
    const keys = Object.keys(sceneModules)
    if (sourcePath) {
      const normalized = sourcePath.replace(/\\/g, '/').toLowerCase()
      const hit = keys.find((k) => k.toLowerCase().endsWith(normalized.replace(/^src\//, '')))
      if (hit) return sceneModules[hit]
    }
    const hit = keys.find((k) => {
      const fileName = k.split('/').pop()?.replace(/\.tsx$/i, '')
      return fileName === componentName
    })
    return hit ? sceneModules[hit] : null
  }, [componentName, sourcePath])

  useEffect(() => {
    let active = true
    if (!moduleImporter) {
      setLoadError('未找到组件模块')
      return
    }

    moduleImporter()
      .then((mod: any) => {
        if (!active) return
        const component = mod[componentName] || mod.default || Object.values(mod).find((v) => typeof v === 'function')
        if (component) {
          setComp(() => component)
          setLoadError(null)
        } else {
          setLoadError('模块内未导出该组件')
        }
      })
      .catch((err) => {
        if (active) {
          setLoadError(err instanceof Error ? err.message : '加载失败')
        }
      })

    return () => {
      active = false
    }
  }, [moduleImporter, componentName])

  // 控制播放状态
  const shouldPlay = playing !== false || hovered
  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    if (shouldPlay) {
      void p.play()
    } else {
      p.pause()
    }
  }, [shouldPlay])

  if (loadError || !Comp) {
    return (
      <div className={`fx-live-fallback ${className}`}>
        <div className="fx-live-fallback-inner">
          <Code2 size={18} className="text-blue-400" />
          <span className="fx-live-fallback-name">{componentName}</span>
          <span className="fx-live-fallback-hint">Remotion TSX 代码</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`fx-live-container ${className} ${shouldPlay ? 'is-playing' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Player
        ref={playerRef}
        component={Comp}
        durationInFrames={150}
        fps={30}
        compositionWidth={1280}
        compositionHeight={720}
        initialFrame={40}
        loop
        autoPlay
        acknowledgeRemotionLicense
        style={{
          width: '100%',
          height: '100%',
        }}
      />
      {interactive && onTogglePlay && (
        <button
          type="button"
          className="fx-visual-play-btn"
          onClick={(e) => {
            e.stopPropagation()
            onTogglePlay()
          }}
        >
          {shouldPlay ? '⏸' : '▶'}
        </button>
      )}
    </div>
  )
}

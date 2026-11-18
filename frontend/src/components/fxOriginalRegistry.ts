// 这些文件是本地已知仓库的固定快照，不接受任意仓库源码执行。
const files: Record<string, (() => Promise<unknown>) | undefined> = import.meta.glob('../fx-original/remotion-scenes/src/scenes/**/*.tsx')
const shotcraftFiles: Record<string, (() => Promise<unknown>) | undefined> = import.meta.glob('../fx-original/video-shotcraft/demos/**/*.tsx')
import shotcraftMap from '../fx-original/video-shotcraft/scene-map.json'

type SceneDescriptor = { loader: () => Promise<unknown>; exportName: string; durationExport?: string; width: number; height: number }

export function originalSceneLoader(sourceProject?: string, sourcePath?: string): SceneDescriptor | null {
  if (!sourcePath) return null
  if (sourceProject === 'remotion-scenes' && sourcePath.startsWith('src/scenes/')) {
    const loader = files[`../fx-original/remotion-scenes/${sourcePath}`]
    return loader ? { loader, exportName: sourcePath.split('/').pop()!.replace(/\.tsx$/i, ''), width: 1280, height: 720 } : null
  }
  if (sourceProject === 'video-shotcraft') {
    const info = (shotcraftMap as Record<string, {module: string; export: string; durationExport?: string}>)[sourcePath]
    const loader = info && shotcraftFiles[`../fx-original/video-shotcraft/${info.module}`]
    return loader ? { loader, exportName: info.export, durationExport: info.durationExport, width: 1920, height: 1080 } : null
  }
  return null
}

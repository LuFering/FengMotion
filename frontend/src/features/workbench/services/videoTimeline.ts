import { studioHttpApi } from '@/api'
import type { StageVisual } from '../model/stageVisual'

const pending = new Map<string, Promise<unknown>>()

export function timelineArtifactPath(projectId: string, visual: StageVisual | null): string | null {
  if (!visual || visual.media !== 'video') return null
  if (visual.artifactPath) return visual.artifactPath
  try {
    const expected = new URL(studioHttpApi().artifacts.contentUrl(projectId, '_'))
    const file = new URL(visual.file, expected)
    return file.origin === expected.origin && file.pathname === expected.pathname
      ? file.searchParams.get('path') : null
  } catch {
    return null
  }
}

export function loadVideoTimeline(projectId: string, artifactPath: string): Promise<unknown> {
  const api = studioHttpApi()
  const key = JSON.stringify([api.config.baseUrl, projectId, artifactPath])
  const running = pending.get(key)
  if (running) return running
  const request = api.artifacts.timeline(projectId, artifactPath).catch((error: unknown) => {
    const failure = error as { code?: string; details?: { rawCode?: string } }
    if ((failure?.details?.rawCode ?? failure?.code) !== 'timeline_missing') throw error
    return api.artifacts.recoverTimeline(projectId, artifactPath)
  }).finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

import type { Unit, StoryboardEntry } from '@/data/productionData'
import { PRODUCTION_FACTS, STORYBOARD, UNITS, WORKFLOW_STEPS } from '@/data/productionData'
import { ACTIVE_TIMELINE, ACTIVE_DURATION } from '@/data/timeline'
import type { Asset } from '@/data/mock'
import { ASSETS } from '@/data/mock'

export type Project = {
  id: string
  name: string
  width: number
  height: number
  fps: number
  activeDuration: number
  targetDuration: number
  assemblySource: string
  storyboardSource: string
  progress: { done: number; tracked: number; compositions: number; activeClips: number }
}

export interface Scene extends Unit {
  storyboard: StoryboardEntry | null
}

export const PROJECT: Project = {
  id: 'token-film',
  name: 'Token 科普视频',
  width: 1920,
  height: 1080,
  fps: 30,
  activeDuration: ACTIVE_DURATION,
  targetDuration: PRODUCTION_FACTS.v3TargetDuration,
  assemblySource: '/home/lufering/video-cut/token/film/index.html',
  storyboardSource: PRODUCTION_FACTS.scriptPath,
  progress: {
    done: PRODUCTION_FACTS.progressDone,
    tracked: PRODUCTION_FACTS.progressRecorded,
    compositions: PRODUCTION_FACTS.compositions,
    activeClips: ACTIVE_TIMELINE.length,
  },
}

const storyboardMap = new Map(STORYBOARD.map((entry) => [entry.段, entry]))

export const SCENES: Scene[] = UNITS.map((unit) => ({
  ...unit,
  storyboard: unit.storyboardId ? storyboardMap.get(unit.storyboardId) ?? null : null,
}))

export const ACTIVE_SCENES = ACTIVE_TIMELINE.map((clip) => {
  const scene = SCENES.find((s) => s.id === clip.id)
  return {
    ...clip,
    scene,
    /** Stills are selected for the active movie time; do not invent V3 stills. */
    frame: scene?.frame ?? null,
  }
})

export const ASSET_LIBRARY: Asset[] = ASSETS
export const PROJECT_WORKFLOW = WORKFLOW_STEPS

export type { Unit, StoryboardEntry }

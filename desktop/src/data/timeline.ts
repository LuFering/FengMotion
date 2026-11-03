import { ACTIVE_FILM_CLIPS } from '@/data/activeFilm'
import { UNITS } from '@/data/productionData'

const unitById = new Map(UNITS.map((unit) => [unit.id, unit]))

export const ACTIVE_TIMELINE = ACTIVE_FILM_CLIPS.map((clip) => {
  const unit = unitById.get(clip.id)
  return {
    ...clip,
    frame: unit?.frame ?? null,
    status: unit?.status ?? 'untracked',
    storyboardId: unit?.storyboardId ?? null,
    durationFrames: Math.round(clip.duration * 30),
    startFrame: Math.round(clip.start * 30),
  }
})

export const ACTIVE_DURATION = Math.max(...ACTIVE_TIMELINE.map((clip) => clip.start + clip.duration))
export const FILM_FPS = 30
export const FILM_WIDTH = 1920
export const FILM_HEIGHT = 1080

export type ActiveTimelineClip = (typeof ACTIVE_TIMELINE)[number]

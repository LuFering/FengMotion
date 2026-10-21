import type { EditableShotSettings } from '@/remotion/EditableShot'

/** Per-project local shot overrides. Demo persistence only; replace with API storage later. */
export type ShotOverrideMap = Record<string, EditableShotSettings>

const keyFor = (projectId: string) => `fengmotion:shot-overrides:${projectId}`

export function defaultShotSettings(scene: Pick<{ label: string; note: string; duration: number }, 'label' | 'note' | 'duration'>): EditableShotSettings {
  return {
    title: scene.label,
    subtitle: scene.note,
    accent: '#8ef0c8',
    fontScale: 1,
    motion: 'rise',
    align: 'left',
    durationSeconds: Math.max(2, Math.min(12, scene.duration)),
  }
}

export function loadShotOverrides(projectId: string): ShotOverrideMap {
  try {
    const raw = window.localStorage.getItem(keyFor(projectId))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as ShotOverrideMap
  } catch {
    return {}
  }
}

export function saveShotOverrides(projectId: string, overrides: ShotOverrideMap): boolean {
  try {
    window.localStorage.setItem(keyFor(projectId), JSON.stringify(overrides))
    return true
  } catch {
    return false
  }
}

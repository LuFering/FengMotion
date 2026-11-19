import { useSyncExternalStore } from 'react'
import { loadSettings } from '@/features/settings/model/settings-model'
export interface HarnessSelection { harness: string; model?: string; reasoningEffort?: string }
let current: HarnessSelection | undefined
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function snapshot(): HarnessSelection {
  if (!current) {
    const s = loadSettings()
    current = { harness: s.harness, model: s.model }
    try {
      const saved = JSON.parse(localStorage.getItem('fengmotion:engine-selection') ?? 'null')
      if (saved && ['deepseek', 'dsh-sdk', 'codex', 'claude'].includes(saved.harness)) current = {
        harness: saved.harness, model: typeof saved.model === 'string' ? saved.model : undefined,
        reasoningEffort: typeof saved.reasoningEffort === 'string' ? saved.reasoningEffort : undefined,
      }
    } catch { /* use settings defaults */ }
  }
  return current
}
export function setHarnessSelection(next: Partial<HarnessSelection>) {
  const value = { ...snapshot(), ...next }
  if (JSON.stringify(value) === JSON.stringify(current)) return
  current = value
  try { localStorage.setItem('fengmotion:engine-selection', JSON.stringify(value)) } catch { /* memory remains usable */ }
  for (const listener of listeners) listener()
}
export function useHarnessSelection() {
  return useSyncExternalStore(subscribe, snapshot)
}

export const readHarnessSelection=()=>({...snapshot()})

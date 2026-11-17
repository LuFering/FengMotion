import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import { NavigationGuard, type UnsavedEditor } from './navigationGuard'

export const NavigationGuardContext = createContext<NavigationGuard | null>(null)
export function useNavigationGuard() {
  const guard = useContext(NavigationGuardContext)
  if (!guard) throw new Error('NavigationGuardProvider is required')
  return guard
}

export function useUnsavedEditor(editor: UnsavedEditor) {
  const guard = useNavigationGuard()
  const latest = useRef(editor)
  useLayoutEffect(() => { latest.current = editor; guard.refreshEditor() })
  useLayoutEffect(() => guard.register(() => latest.current), [guard])
}


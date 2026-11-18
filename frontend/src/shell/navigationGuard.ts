export type UnsavedEditor = { name: string; dirty: boolean; canSave: boolean; save: () => boolean | Promise<boolean> }
export type LeavePrompt = { name: string; canSave: boolean; saving: boolean; error: string }

/** One guard for local editor navigation and application navigation. */
export class NavigationGuard {
  private editor: (() => UnsavedEditor) | null = null
  private next: (() => void) | null = null
  private state: LeavePrompt | null = null
  private listeners = new Set<() => void>()
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.state
  private emit(state: LeavePrompt | null) { this.state = state; this.listeners.forEach((fn) => fn()) }
  register = (editor: () => UnsavedEditor) => {
    this.editor = editor
    return () => {
      if (this.editor !== editor) return
      this.editor = null
      this.next = null
      this.emit(null)
    }
  }
  hasUnsaved = () => Boolean(this.editor?.().dirty)
  refreshEditor = () => {
    const editor = this.editor?.()
    if (!this.state || !editor || this.state.saving) return
    if (this.state.name !== editor.name || this.state.canSave !== editor.canSave) {
      this.emit({ ...this.state, name: editor.name, canSave: editor.canSave })
    }
  }
  request = (next: () => void) => {
    if (this.next) return // Keep the original destination while the decision is pending.
    const editor = this.editor?.()
    if (!editor?.dirty) { next(); return }
    this.next = next
    this.emit({ name: editor.name, canSave: editor.canSave, saving: false, error: '' })
  }
  stay = () => { if (!this.state?.saving) { this.next = null; this.emit(null) } }
  discard = () => { if (!this.state?.saving) this.leave() }
  private leave() { const next = this.next; this.next = null; this.emit(null); next?.() }
  saveAndLeave = async () => {
    if (!this.state || this.state.saving || !this.next) return
    const owner = this.editor
    const editor = owner?.()
    if (!editor || !editor.canSave) return
    this.emit({ ...this.state, saving: true, error: '' })
    try {
      const saved = await editor.save()
      if (this.editor !== owner || !this.state) return
      if (!saved) throw new Error('保存没有完成，请重试。你的修改仍保留在画布中。')
      this.leave()
    } catch (error) {
      if (this.editor === owner && this.state) this.emit({ ...this.state, saving: false, error: error instanceof Error ? error.message : '保存失败，请重试。' })
    }
  }
}

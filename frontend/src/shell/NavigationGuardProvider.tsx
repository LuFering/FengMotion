import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { NavigationGuard } from './navigationGuard'
import { NavigationGuardContext } from './navigationGuardContext'

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const [guard] = useState(() => new NavigationGuard())
  const prompt = useSyncExternalStore(guard.subscribe, guard.getSnapshot, guard.getSnapshot)
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!guard.hasUnsaved()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [guard])
  return <NavigationGuardContext.Provider value={guard}>
    {children}
    <Dialog open={Boolean(prompt)} onOpenChange={(open) => { if (!open) guard.stay() }}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => { if (prompt?.saving) e.preventDefault() }} onInteractOutside={(e) => e.preventDefault()}>
        <DialogTitle>保存工作流的更改？</DialogTitle>
        <DialogDescription>「{prompt?.name || '未命名工作流'}」有未保存的更改。保存后再离开，或放弃这次更改。</DialogDescription>
        {prompt && !prompt.canSave && <p role="status">运行中暂时不能保存，可以留在画布等待完成。</p>}
        {prompt?.error && <p role="alert" className="text-destructive">{prompt.error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={prompt?.saving} onClick={guard.stay}>留在画布</Button>
          <Button variant="outline" disabled={prompt?.saving} onClick={guard.discard}>放弃更改并离开</Button>
          <Button disabled={!prompt?.canSave || prompt?.saving} onClick={() => void guard.saveAndLeave()}>{prompt?.saving ? '正在保存…' : '保存并离开'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </NavigationGuardContext.Provider>
}

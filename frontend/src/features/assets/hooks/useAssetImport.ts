import type * as React from 'react'
import { useCallback, useEffect } from 'react'
import { importFiles } from '@/features/assets/services/assetApiService'
import { toast as emitToast } from '@/shared/lib/toast'
import { isAssetDrag } from '@/features/assets/hooks/usePendingAssets'
import type { MyAsset } from '@/features/assets/model/myAssets'

export interface UseAssetImportArgs {
  dragDepth: React.RefObject<number>
  ownDrag: React.RefObject<boolean>
  setAssets: React.Dispatch<React.SetStateAction<MyAsset[]>>
}

/** 我的素材的文件导入：处理文件选择框和从系统拖入的文件，导入后把新素材加进列表并用 toast 汇报结果。 */
export function useAssetImport({ dragDepth, ownDrag, setAssets }: UseAssetImportArgs) {
  /* 导入：不再弹「导入队列」面板（作者要求删掉）。但过程不能一声不响 ——
     逐个文件导入要读尺寸/时长/抽缩略图，十个文件可能等好几秒。
     所以用已有的全局 toast 汇报结果：成功入库 N 个，失败的指出名字。 */
  const runImport = useCallback(async (files: File[]) => {
    if (!files.length) return
    const failed: string[] = []
    const outcome = await importFiles(files, (e) => {
      if (e.phase === 'error') failed.push(e.name)
    })
    const ok = outcome.created
    if (ok.length) setAssets((prev) => [...ok, ...prev])
    if (ok.length > 0 && failed.length === 0) {
      emitToast(ok.length === 1 ? `已导入「${ok[0].name}」` : `已导入 ${ok.length} 个素材`)
    } else if (ok.length > 0) {
      emitToast(`导入 ${ok.length} 个，${failed.length} 个失败：${failed.slice(0, 2).join('、')}${failed.length > 2 ? ' 等' : ''}`)
    } else if (failed.length > 0) {
      emitToast(`导入失败：${failed.slice(0, 2).join('、')}${failed.length > 2 ? ' 等' : ''}`)
    }
  }, [])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    void runImport(files)
  }

  useEffect(() => {
    /* 只负责「把系统文件拖进来就导入」这个行为本身。原来那个铺满画布的
       「松手导入到我的素材」浮层已按作者要求删掉 —— 导入不需要这么大的提示，
       而那个浮层还会和「待发送」的拖拽提示混淆。

       ⚠️ 判定「是不是外部文件」不能只看 dataTransfer.files ——
       应用内拖一张**真实路径**的图片（内置素材缩略图就是 ./frames/film/s06.jpg）
       时，Chrome 按原生图片拖拽处理，照样往 files 里塞一个名字为 s06.jpg 的 File。
       于是用户只是想拖进待发送，松手却成了「导入」，还多出一张重复卡片。

       可靠判据是**拖拽起点**：系统拖入不会在本页触发 dragstart，
       应用内任何拖拽（卡片、缩略图、详情大图）都会冒泡到 window。
       所以：本页起手的拖拽一律不导入，只有真正的系统文件才走导入。 */
    const enter = (e: DragEvent) => {
      if (ownDrag.current || isAssetDrag(e.dataTransfer)) return
      if (e.dataTransfer?.types.includes('Files')) { dragDepth.current++ }
    }
    const over = (e: DragEvent) => {
      if (ownDrag.current || isAssetDrag(e.dataTransfer)) return
      e.preventDefault()
    }
    const leave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1) }
    const drop = (e: DragEvent) => {
      const mine = ownDrag.current || isAssetDrag(e.dataTransfer)
      ownDrag.current = false          // 兜底复位：某些路径下 dragend 可能不到
      if (mine) return
      e.preventDefault()
      dragDepth.current = 0
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) void runImport(files)
    }
    /* 记录拖拽起点。dragstart 只在「拖拽源在本页」时触发 —— 这正是我们要的判据。 */
    const markOwn = () => { ownDrag.current = true }
    const clearOwn = () => { ownDrag.current = false }
    window.addEventListener('dragstart', markOwn, true)
    window.addEventListener('dragend', clearOwn, true)
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragstart', markOwn, true)
      window.removeEventListener('dragend', clearOwn, true)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [runImport])
  return { onPick }
}

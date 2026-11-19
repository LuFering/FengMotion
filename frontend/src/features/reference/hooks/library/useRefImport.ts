import type * as React from 'react'
import { uploadReferenceVideo, listReferenceVideos, listSegments, type LocalSegment, type ServerVideo } from '@/features/reference/services/referenceApiService'

export interface UseRefImportArgs {
  setImporting: React.Dispatch<React.SetStateAction<{ name: string; total: number; done: number } | null>>
  setSegments: React.Dispatch<React.SetStateAction<LocalSegment[]>>
  setVideos: React.Dispatch<React.SetStateAction<ServerVideo[]>>
  showToast: (msg: string) => void
}

/** 从 RefLibrary.tsx 的 RefLibrary 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useRefImport({ setImporting, setSegments, setVideos, showToast }: UseRefImportArgs) {
  /* 导入视频：复用素材库的 importFiles（它负责读尺寸/时长/抽海报并入库）。
     之后把文件交给后端切分+分析 —— 现在没有后端，所以停在"等待分析"这一步，
     并如实告诉用户"切分与分析由后端完成"，不假装已经分析好了。 */
  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    const videos = files.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(f.name))
    if (videos.length === 0) {
      showToast('请选择视频文件')
      return
    }
    setImporting({ name: videos[0].name, total: videos.length, done: 0 })
    try {
      /* 走参考片端点：后端会把文件存成素材再登记参考片，
         同一文件不在素材库与参考片库各存一份。 */
      let imported = 0
      const failures: string[] = []
      for (let i = 0; i < videos.length; i += 1) {
        try {
          await uploadReferenceVideo(videos[i])
          imported += 1
        } catch (error) {
          failures.push(error instanceof Error ? error.message : '导入失败')
        }
        setImporting((p) => (p ? { ...p, done: p.done + 1 } : p))
      }
      if (imported > 0) {
        const [vs, segs] = await Promise.all([listReferenceVideos(), listSegments()])
        setVideos(vs)
        setSegments(segs)
        showToast(`已导入 ${imported} 个视频，可手工标记片段`)
      } else {
        showToast(`导入失败：${failures[0] ?? '文件格式不支持或读取失败'}`)
      }
    } catch {
      showToast('导入失败，请重试')
    } finally {
      setImporting(null)
    }
  }
  return { onPickFiles }
}

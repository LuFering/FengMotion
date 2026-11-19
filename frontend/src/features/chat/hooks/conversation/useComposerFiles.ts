import type * as React from 'react'
import { studioHttpApi } from '@/api'
import type { ComposerAttachment } from '@/features/chat/model/composerAttachment'

export interface UseComposerFilesArgs {
  mountedRef: React.RefObject<boolean>
  setAttachments: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
}

/** 从 Conversation.tsx 的 Conversation 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useComposerFiles({ mountedRef, setAttachments }: UseComposerFilesArgs) {
  const addFiles = (files: File[], forced?: 'file' | 'image' | 'video', done?: () => void) => {
    if (files.length > 0) {
      const picked = files.slice(0, 6).map((f) => {
        const kind = (forced ?? (f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'file')) as 'file' | 'image' | 'video'
        return {
          file: f,
          uploadId: crypto.randomUUID(),
          name: f.name,
          size: f.size,
          kind,
          mimeType: f.type,
          uploading: true,
          /* 图片直接给本地 object URL 做缩略图：卡片上显示真实画面，
             用户才能确认「选的是不是这张」。
             其他类型不需要，不创建以免多占内存。 */
          previewUrl: kind === 'image' ? URL.createObjectURL(f) : undefined,
        }
      })
      /* 先在界面里占位（显示「上传中」），再逐个上传。
         选完就传、而不是等发送时再传：用户能看到进度，发送时也不用等。 */
      setAttachments((prev) => [...prev, ...picked].slice(0, 6))

      for (const item of picked) {
        // 走真实后端的 /api/uploads（studioHttpApi），不是演示适配器 chatApi ——
        // 后者是本地 mock，没有上传能力。
        void studioHttpApi().chat.uploadAttachment(item.file, {
          /* 真实进度：图块上的环按它走动，角落显示百分比。
             到 100 就不再传 —— 后面等服务器回 201 的那一小段
             环已经画满，不会出现「满格却还在转」的怪状态。 */
          onProgress: (percent: number) => {
            if (!mountedRef.current) return
            setAttachments((prev) => prev.map((a) => (
              a.uploadId === item.uploadId ? { ...a, progress: percent } : a
            )))
          },
        })
          .then((uploaded: { fileId: string; mimeType: string }) => {
            if (!mountedRef.current) return
            setAttachments((prev) => prev.map((a) => (
              a.uploadId === item.uploadId && a.uploading
                ? { ...a, fileId: uploaded.fileId, mimeType: uploaded.mimeType, uploading: false, uploadError: undefined, progress: undefined }
                : a
            )))
          })
          .catch((cause: unknown) => {
            if (!mountedRef.current) return
            const reason = cause instanceof Error ? (cause.message.trim() || '上传失败') : '上传失败'
            setAttachments((prev) => prev.map((a) => (
              a.uploadId === item.uploadId && a.uploading
                ? { ...a, uploading: false, uploadError: reason }
                : a
            )))
          })
      }
    }
    done?.()
  }
  return { addFiles }
}

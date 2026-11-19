

/** 输入区里的一个附件：文件、素材、参考片段或技法，以及它的上传状态。 */
export interface ComposerAttachment {
    name: string; size: number; kind: 'file' | 'image' | 'video' | 'technique'
    /* 资源类型：素材 / 参考片段 / 技法。参考片段与技法没有可上传的文件，
       但仍要随消息带给 agent —— 它们的价值在于「借鉴什么」，不是文件本身。 */
    source?: 'asset' | 'ref' | 'fx'
    refVideoId?: string; refStart?: number; refEnd?: number; refWants?: string
    fxId?: string; fxVersion?: string
    uploadId?: string
    /* 来自「待发送」的附件带着用途与备注：界面要显示「logo.png · 用于画面」，
       而不只是塞一串文件名 —— 用途是用户特意选的，丢在这里等于白选。 */
    purpose?: string; note?: string; assetId?: string
    /* 上传结果。选文件后立刻上传，发送时只带 fileId ——
       契约要求「附件先上传、消息只引用 fileId」，不在这里带路径或原始字节。 */
    fileId?: string
    mimeType?: string
    /* 上传中 / 失败。失败时仍然显示这个附件（带着原因），
       而不是静默消失让用户以为选上了。 */
    uploading?: boolean
    uploadError?: string
    /* 真实上传进度 0–100。上传中才有值；落地后置 undefined，
       图块据此判断「环该不该画、角落要不要显示百分比」。 */
    progress?: number
    /* 本地预览地址（object URL）。图片附件在卡片里直接显示缩略图，
       而不是一个「图片」图标 —— 用户选了两张图，必须能看出是哪两张。
       生命周期：随附件一起移除时回收，见 removeAttachment。 */
    previewUrl?: string
}

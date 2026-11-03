package com.fengmotion.server.upload.domain;

import java.time.Instant;

/**
 * 一个已上传的附件。
 *
 * <p>附件与素材（Asset）不是一回事：素材是项目里的资产，有归属与版本；
 * 附件只是「用户为了这一条消息暂时带上的文件」，上传后由消息以 {@code fileId} 引用。
 * 因此这里不存项目归属，也不出现在资源台账里。</p>
 *
 * @param id        附件标识（即对外暴露的 {@code fileId}）
 * @param name      原始文件名（仅用于展示，不参与路径拼接）
 * @param sizeBytes 字节数
 * @param mimeType  声明的 MIME 类型
 * @param kind      归类：image / video / audio / file，由 MIME 推导
 * @param sha256    内容摘要，用于去重与完整性核对
 * @param storedAt  落盘时间
 */
public record UploadedFile(
        String id,
        String name,
        long sizeBytes,
        String mimeType,
        String kind,
        String sha256,
        Instant storedAt) {
}

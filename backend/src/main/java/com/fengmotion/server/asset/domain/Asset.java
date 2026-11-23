package com.fengmotion.server.asset.domain;

import java.time.Instant;
import java.util.List;

/**
 * 素材（契约 asset.md §2）。
 *
 * <p>字段顺序与契约表格一致，便于逐项核对。所有枚举都在 {@link AssetStates} 里，
 * 不在这里重复定义取值。</p>
 *
 * @param id                 稳定 ID
 * @param name               展示名（默认文件名，可改）
 * @param mediaType          媒体类型
 * @param mimeType           MIME
 * @param sizeBytes          字节数（服务端实测，不信前端）
 * @param sourceType         来源类型
 * @param processingStatus   处理状态
 * @param processingError    仅 failed 存在，写人话原因
 * @param reviewStatus       审核状态
 * @param availability       可用状态
 * @param licenseStatus      授权状态（独立于审核）
 * @param licenseDetails     授权说明 / 署名要求
 * @param width              图像 / 视频宽
 * @param height             图像 / 视频高
 * @param durationMs         音视频时长
 * @param tags               标签
 * @param folderId           文件夹；根为 null
 * @param fileUrl            原文件访问地址
 * @param thumbnailUrl       缩略图地址
 * @param contentHash        内容 SHA-256，用于去重（同一文件本体只存一份）
 * @param createdAt          创建时间
 * @param updatedAt          更新时间
 * @param lastUsedAt         最近使用时间
 * @param etag               条件更新用
 * @param demo               演示数据标记；与 sourceType 正交
 * @param projectId          归属项目；null 表示未归属。归属只有一个，「被哪些项目用到」仍记在引用里
 */
public record Asset(
        String id,
        String name,
        AssetStates.MediaType mediaType,
        String mimeType,
        long sizeBytes,
        AssetStates.SourceType sourceType,
        AssetStates.ProcessingStatus processingStatus,
        String processingError,
        AssetStates.ReviewStatus reviewStatus,
        AssetStates.Availability availability,
        AssetStates.LicenseStatus licenseStatus,
        String licenseDetails,
        Integer width,
        Integer height,
        Long durationMs,
        List<String> tags,
        String folderId,
        String fileUrl,
        String thumbnailUrl,
        String contentHash,
        Instant createdAt,
        Instant updatedAt,
        Instant lastUsedAt,
        String etag,
        boolean demo,
        String projectId) {

    /** 未归属项目的素材。保留旧的 25 参数写法，调用方不必为新字段逐处补 null。 */
    public Asset(String id, String name, AssetStates.MediaType mediaType, String mimeType, long sizeBytes,
            AssetStates.SourceType sourceType, AssetStates.ProcessingStatus processingStatus,
            String processingError, AssetStates.ReviewStatus reviewStatus, AssetStates.Availability availability,
            AssetStates.LicenseStatus licenseStatus, String licenseDetails, Integer width, Integer height,
            Long durationMs, List<String> tags, String folderId, String fileUrl, String thumbnailUrl,
            String contentHash, Instant createdAt, Instant updatedAt, Instant lastUsedAt, String etag,
            boolean demo) {
        this(id, name, mediaType, mimeType, sizeBytes, sourceType, processingStatus, processingError,
                reviewStatus, availability, licenseStatus, licenseDetails, width, height, durationMs, tags,
                folderId, fileUrl, thumbnailUrl, contentHash, createdAt, updatedAt, lastUsedAt, etag, demo, null);
    }
}

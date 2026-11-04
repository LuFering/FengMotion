package com.fengmotion.server.asset.api.dto;

import java.util.List;

/**
 * 素材响应（契约 asset.md §2）。
 *
 * <p>完整字段一次返回：素材详情体量很小，省略字段只会让前端到处补默认值，
 * 而补出来的默认值（0、空串、"未知"）会和真实数据混在一起。</p>
 *
 * @param id               稳定 ID
 * @param name             展示名
 * @param mediaType        媒体类型
 * @param mimeType         MIME
 * @param sizeBytes        服务端实测字节数
 * @param sourceType       来源类型
 * @param processingStatus 处理状态
 * @param processingError  仅 failed 存在
 * @param reviewStatus     审核状态
 * @param availability     可用状态
 * @param licenseStatus    授权状态（独立于审核）
 * @param licenseDetails   授权说明
 * @param width            宽
 * @param height           高
 * @param durationMs       时长
 * @param tags             标签
 * @param folderId         文件夹
 * @param fileUrl          文件访问地址（相对本服务）
 * @param thumbnailUrl     缩略图地址
 * @param createdAt        ISO 8601
 * @param updatedAt        ISO 8601
 * @param lastUsedAt       ISO 8601
 * @param etag             条件更新用
 * @param refs             引用方
 * @param demo             演示数据标记
 */
public record AssetResponse(
        String id,
        String name,
        String mediaType,
        String mimeType,
        long sizeBytes,
        String sourceType,
        String processingStatus,
        String processingError,
        String reviewStatus,
        String availability,
        String licenseStatus,
        String licenseDetails,
        Integer width,
        Integer height,
        Long durationMs,
        List<String> tags,
        String folderId,
        String fileUrl,
        String thumbnailUrl,
        String createdAt,
        String updatedAt,
        String lastUsedAt,
        String etag,
        List<RefResponse> refs,
        boolean demo) {

    /** 引用方。 */
    public record RefResponse(String kind, String id, String label) {
    }
}

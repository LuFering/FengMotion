package com.fengmotion.server.asset.store.mapper;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * assets 表的持久化行。
 *
 * <p>枚举以 wire 字符串存放（小写下划线），时间以 ISO-8601 文本存放，
 * 与库中其他表保持一致。转换在仓储层完成，Mapper 只管读写。</p>
 */
@Data
@NoArgsConstructor
public class AssetRow {
    private String id;
    private String name;
    private String mediaType;
    private String mimeType;
    private Long sizeBytes;
    private String sourceType;
    private String processingStatus;
    private String processingError;
    private String reviewStatus;
    private String availability;
    private String licenseStatus;
    private String licenseDetails;
    private Integer width;
    private Integer height;
    private Long durationMs;
    private String tagsJson;
    private String folderId;
    /** 相对应用管理目录的路径；DB 不存绝对路径，便于整目录搬迁。 */
    private String storagePath;
    private String thumbnailPath;
    private String contentHash;
    private String createdAt;
    private String updatedAt;
    private String lastUsedAt;
    private String etag;
    private Integer demo;
}

package com.fengmotion.server.project.store.mapper;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * projects 表的持久化行。
 *
 * <p>列名通过 {@code mapUnderscoreToCamelCase} 映射为驼峰字段；时间列在 SQLite 中是
 * TEXT，因此先按字符串读取，再由仓储转换为 {@link java.time.Instant}。这样既不依赖
 * JDBC 驱动的 timestamp 解析，也能保留原先写入的 ISO-8601 文本格式。</p>
 *
 * <p>{@code targetDurationMs} 使用包装类型，数据库中的 NULL 会保持为 null，不会变成 0。</p>
 */
@Data
@NoArgsConstructor
public class ProjectRow {
    private String id;
    private String name;
    private String tagline;
    private String stage;
    private String genomeId;
    private Long targetDurationMs;
    private String rootPath;
    private String createdAt;
    private String updatedAt;
    private String etag;
}

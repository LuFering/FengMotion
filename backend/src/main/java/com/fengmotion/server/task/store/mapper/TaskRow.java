package com.fengmotion.server.task.store.mapper;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * tasks 表的一行原始数据。
 *
 * <p>时间与 JSON 列在 SQLite 中都是 TEXT，这里原样映射为 String，
 * 由仓储层转换成 {@code Instant} 与 {@code JsonNode}。</p>
 */
@Data
@NoArgsConstructor
public class TaskRow {
    private String id;
    private String projectId;
    private String kind;
    private String status;
    private String prompt;
    /** 原始请求体的 JSON 文本；没有时为 null。 */
    private String requestJson;
    private Integer progress;
    private String message;
    private String artifactPath;
    private String errorCode;
    private String createdAt;
    private String updatedAt;
    private String finishedAt;
    /** 任务开始时的场景版本；与场景版本无关时为 null。 */
    private Long baseVersion;
    /** 本次产出并被提交的场景版本；未提交时为 null。 */
    private Long resultVersion;
}

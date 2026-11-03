package com.fengmotion.server.project.store.mapper;

import lombok.Data;
import lombok.NoArgsConstructor;

/** project_idempotency 表的持久化行；时间列按 SQLite 中的 TEXT 读取。 */
@Data
@NoArgsConstructor
public class IdempotencyRow {
    private String requestHash;
    private String projectId;
    private String createdAt;
}

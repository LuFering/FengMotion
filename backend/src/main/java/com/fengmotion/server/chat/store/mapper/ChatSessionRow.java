package com.fengmotion.server.chat.store.mapper;

/**
 * chat_sessions 表的一行原始数据。
 *
 * <p>时间列在 SQLite 中是 TEXT（ISO 8601 字符串），这里保持 String 原样映射，
 * 由仓储层负责转换成领域对象中的 {@code Instant}。这样做避免了 MyBatis 默认的
 * Instant 类型处理器按 TIMESTAMP 读取 TEXT 列时的不匹配问题。</p>
 *
 * @param id           会话 ID
 * @param projectId    所属项目 ID
 * @param title        会话标题
 * @param createdAt    创建时间（ISO 8601 文本）
 * @param updatedAt    最后更新时间（ISO 8601 文本）
 * @param messageCount 查询时派生的消息数量
 * @param harnessSessionId 对应的 DSH 会话标识；从未调用过引擎时为 null
 */
public record ChatSessionRow(
        String id,
        String projectId,
        String title,
        String createdAt,
        String updatedAt,
        int messageCount,
        String harnessSessionId) {
}

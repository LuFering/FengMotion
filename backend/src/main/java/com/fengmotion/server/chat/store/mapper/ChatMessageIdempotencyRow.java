package com.fengmotion.server.chat.store.mapper;

/**
 * chat_message_idempotency 表的一行。
 *
 * @param requestHash 请求摘要
 * @param sessionId   发送到的会话
 * @param messageId   已写入的消息 ID
 * @param createdAt   创建时间（ISO 8601 文本）
 */
public record ChatMessageIdempotencyRow(
        String requestHash,
        String sessionId,
        String messageId,
        String createdAt) {
}

package com.fengmotion.server.chat.api.dto;

import java.time.Instant;

import com.fengmotion.server.chat.domain.ChatSession;

/**
 * 返回给前端的会话信息。
 *
 * @param id           会话 ID
 * @param projectId    所属项目 ID
 * @param title        会话标题
 * @param createdAt    创建时间
 * @param updatedAt    最后更新时间
 * @param messageCount 消息数量；由消息表实时派生
 */
public record ChatSessionResponse(
        String id,
        String projectId,
        String title,
        Instant createdAt,
        Instant updatedAt,
        int messageCount) {
    /**
     * 将领域对象转换为 API 响应对象。
     */
    public static ChatSessionResponse from(ChatSession session) {
        return new ChatSessionResponse(
                session.id(),
                session.projectId(),
                session.title(),
                session.createdAt(),
                session.updatedAt(),
                session.messageCount());
    }
}

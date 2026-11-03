package com.fengmotion.server.chat.api.dto;

/**
 * 创建会话的请求体。
 *
 * @param projectId 所属项目 ID，必须与请求路径中的项目 ID 一致
 * @param title     会话标题；不传或为空时使用默认标题
 */
public record CreateChatSessionRequest(
        String projectId,
        String title) {

}

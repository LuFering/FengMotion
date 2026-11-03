package com.fengmotion.server.chat.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 发送消息的成功响应（agent.md §3）：{@code 202 + { message, taskId? }}。
 *
 * <p>{@code taskId} 表示「这条消息同时触发了一个任务」，目前任务域尚未接入，
 * 因此总是缺席；字段保留是为了契约形状稳定，接入后不必再改前端。</p>
 *
 * @param message 已保存的消息
 * @param taskId  触发的任务 ID；没有触发任务时不出现
 */
public record SendChatMessageResponse(
        ChatMessageResponse message,
        @JsonInclude(JsonInclude.Include.NON_NULL) String taskId) {
}

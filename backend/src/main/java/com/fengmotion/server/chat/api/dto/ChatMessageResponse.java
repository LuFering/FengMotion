package com.fengmotion.server.chat.api.dto;

import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.chat.domain.ChatMessage;

/**
 * 返回给前端的一条会话消息（agent.md §3）。
 *
 * <p>字段与契约一致：{@code references} 与 {@code attachments} 没有内容时不出现，
 * {@code taskId} 只在消息确实触发了任务时出现。系统角色消息不下发展示，
 * 因此 {@code system} 消息在服务层就被过滤掉了。</p>
 *
 * @param id          消息 ID
 * @param sessionId   所属会话 ID
 * @param role        角色：user / assistant
 * @param text        正文
 * @param taskId      该消息触发的任务；没有时不出现
 * @param references  结构化引用；没有时不出现
 * @param attachments 附件元信息；没有时不出现
 * @param toolCalls   这条助手回复执行过的工具调用；没有时不出现。
 *                    有了它，用户切走会话再回来仍能查到「这条回复当时跑了什么」。
 * @param reasoning   这条助手回复的思考过程正文；没有时不出现。
 *                    与 toolCalls 同理：思考也是这条回复的一部分，切走会话再回来要能看到。
 * @param todos       模型排的任务清单；没有时不出现。同样要能回看。
 * @param usage       这条回复的 token 用量；没有时不出现。
 *                    带上它，刷新后上下文占用条还在，而不是只在「刚发完」时可见。
 * @param createdAt   创建时间
 */
public record ChatMessageResponse(
        String id,
        String sessionId,
        String role,
        String text,
        @JsonInclude(JsonInclude.Include.NON_NULL) String taskId,
        @JsonInclude(JsonInclude.Include.NON_NULL) JsonNode references,
        @JsonInclude(JsonInclude.Include.NON_NULL) JsonNode attachments,
        @JsonInclude(JsonInclude.Include.NON_NULL) JsonNode toolCalls,
        @JsonInclude(JsonInclude.Include.NON_NULL) String reasoning,
        @JsonInclude(JsonInclude.Include.NON_NULL) JsonNode todos,
        @JsonInclude(JsonInclude.Include.NON_NULL) JsonNode usage,
        Instant createdAt) {

    /** 将领域对象转换为 API 响应对象。 */
    public static ChatMessageResponse from(ChatMessage message) {
        return new ChatMessageResponse(
                message.id(),
                message.sessionId(),
                message.role(),
                message.text(),
                message.taskId(),
                message.references(),
                message.attachments(),
                message.toolCalls(),
                message.reasoning(),
                message.todos(),
                message.usage(),
                message.createdAt());
    }
}

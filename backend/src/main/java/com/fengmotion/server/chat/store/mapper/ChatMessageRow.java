package com.fengmotion.server.chat.store.mapper;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * chat_messages 表的一行原始数据。
 *
 * <p>时间列与 JSON 列在 SQLite 中都是 TEXT，这里保持 String 原样映射：
 * 时间由仓储层转成 {@code Instant}，JSON 由服务层解析回结构化引用/附件。</p>
 *
 * @see ChatSessionRow 为什么时间不用 MyBatis 的 Instant 类型处理器
 */
@Data
@NoArgsConstructor
public class ChatMessageRow {
    private String id;
    private String sessionId;
    private Long seq;
    private String role;
    private String text;
    private String taskId;
    /** 结构化引用的 JSON 文本；没有引用时为 null。 */
    private String referencesJson;
    /** 附件元信息的 JSON 文本；没有附件时为 null。 */
    private String attachmentsJson;
    /** 这条助手回复执行过的工具调用（JSON 数组）文本；没有调用时为 null。 */
    private String toolCallsJson;
    /** 这条助手回复的思考过程正文；没有推理（或历史消息）时为 null。 */
    private String reasoning;
    /** 这条助手回复的任务清单（JSON 数组）；没有清单时为 null。 */
    private String todosJson;
    /** 这条助手回复的 token 用量（JSON 对象）；没有用量记录时为 null。 */
    private String usageJson;
    /** 这条助手回复交付的文件（JSON 数组）；没有交付时为 null。 */
    private String deliverablesJson;
    private String createdAt;
}

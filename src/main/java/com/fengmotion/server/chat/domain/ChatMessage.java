package com.fengmotion.server.chat.domain;

import java.time.Instant;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 一条会话消息。
 *
 * <p>消息是只追加的记录：写入后不再修改正文。{@code seq} 在所属会话内严格递增，
 * 既是消息的稳定次序，也是历史翻页的键；它不对外暴露，客户端用不透明游标翻页。</p>
 *
 * <p>参考 {@code dsh-session-persistence} 的会话日志设计：连续序号、只追加、
 * 读取方只看到已提交前缀。区别在于本项目的存储是 SQLite 表而不是 JSONL 文件，
 * 事件粒度为「一条完整消息」，暂不支持把流式增量逐步落盘。</p>
 *
 * <p>{@code references} 与 {@code attachments} 是前端提交的结构化引用和附件元信息，
 * 形状由契约（agent.md §3）决定，服务端只负责原样保存与返回，不解释其中字段。</p>
 *
 * @param id          消息 ID
 * @param sessionId   所属会话 ID
 * @param seq         会话内递增序号，从 1 开始
 * @param role        角色：user / assistant / system
 * @param text        正文
 * @param taskId      该消息触发的任务；只聊天时为 null
 * @param references  结构化引用；没有时为 null
 * @param attachments 附件元信息；没有时为 null
 * @param toolCalls   这条助手回复执行过的工具调用（JSON 数组）；没有调用时为 null
 * @param createdAt   创建时间
 */
public record ChatMessage(
        String id,
        String sessionId,
        long seq,
        String role,
        String text,
        String taskId,
        JsonNode references,
        JsonNode attachments,
        JsonNode toolCalls,
        Instant createdAt) {

    /** 系统角色只供内部使用，不下发展示；判断时集中在这里，避免各处散写字符串。 */
    public static final String ROLE_USER = "user";
    public static final String ROLE_ASSISTANT = "assistant";
    public static final String ROLE_SYSTEM = "system";
}

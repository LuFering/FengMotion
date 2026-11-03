package com.fengmotion.server.chat.domain;

import java.time.Instant;

/**
 * 一条属于项目的对话会话。
 *
 * <p>{@code messageCount} 是查询时从消息表派生的展示字段，不是会话表里的列：
 * 它随消息写入实时变化，单独存一份只会带来同步问题。创建会话时自然为 0，
 * 因此保留五参数构造方法，调用方不必关心这个派生值。</p>
 *
 * @param id           会话 ID
 * @param projectId    所属项目 ID
 * @param title        会话标题
 * @param createdAt    创建时间
 * @param updatedAt    最后更新时间（新消息写入时同步刷新）
 * @param messageCount 消息数量
 * @param harnessSessionId 对应的 DSH 会话标识；从未调用过引擎时为 null。
 *        这一列把本项目的会话与 DSH 的持久会话绑定起来，使多轮对话能续接上下文：
 *        不回写的话每次调用都是全新 DSH 会话，历史会丢失。
 */
public record ChatSession(
        String id,
        String projectId,
        String title,
        Instant createdAt,
        Instant updatedAt,
        int messageCount,
        String harnessSessionId) {

    /** 新建会话时消息数为 0、尚未绑定引擎会话。 */
    public ChatSession(String id, String projectId, String title, Instant createdAt, Instant updatedAt) {
        this(id, projectId, title, createdAt, updatedAt, 0, null);
    }
}

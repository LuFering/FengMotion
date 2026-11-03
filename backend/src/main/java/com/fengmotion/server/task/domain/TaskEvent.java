package com.fengmotion.server.task.domain;

import java.time.Instant;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 任务事件：状态迁移的唯一可观察出口。
 *
 * <p>前端不轮询任务状态，而是订阅事件流。这样「正在做什么」和「为什么失败」
 * 都只有一份来源，不会出现状态与事件说两套话。</p>
 *
 * @param id      事件 ID
 * @param taskId  所属任务
 * @param seq     任务内严格递增序号；客户端断线重连据此补发
 * @param kind    事件种类：accepted / progress / build / complete / error / cancelled / warning
 * @param status  事件发生后任务的状态
 * @param message 给人看的一句话
 * @param data    机器可读的附加信息（进度、产物路径等）；没有时为 null
 * @param at      事件时间
 */
public record TaskEvent(
        String id,
        String taskId,
        long seq,
        String kind,
        String status,
        String message,
        JsonNode data,
        Instant at) {

    /** 已接受（任务建立）。 */
    public static final String KIND_ACCEPTED = "accepted";
    /** 进度推进。 */
    public static final String KIND_PROGRESS = "progress";
    /** 进入构建/渲染阶段。 */
    public static final String KIND_BUILD = "build";
    /** 成功完成。 */
    public static final String KIND_COMPLETE = "complete";
    /** 失败。 */
    public static final String KIND_ERROR = "error";
    /** 已取消。 */
    public static final String KIND_CANCELLED = "cancelled";
    /**
     * 警告：任务照常执行，但有信息必须先告诉用户。
     *
     * <p>目前唯一用途是「用户设置了本版不会生效的约束」。
     * 单独成一种而不是塞进 progress，是为了让前端能把它显示成需要留意的提示，
     * 而不是混在进度文案里被刷过去。</p>
     */
    public static final String KIND_WARNING = "warning";
}

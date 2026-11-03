package com.fengmotion.server.task.domain;

import java.time.Instant;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 一次制作任务。
 *
 * <p>任务是一次「用户提交要求 → 执行 → 产出」的完整记录，必须落库：
 * 服务重启后用户还要能看到历史与失败原因，只在内存里就全丢了。</p>
 *
 * <p>{@code request} 保留原始要求（JSON）：请求字段随后续演进会加，
 * 逐字段建列会让每加一个字段都要改表；而这里从不需要按子字段查询。</p>
 *
 * @param id         任务 ID
 * @param projectId  所属项目
 * @param kind       任务类型：render / modify / check …
 * @param status     当前状态
 * @param prompt     用户的原始要求（人可读）
 * @param request    完整请求体；不需要时为 null
 * @param progress   进度百分比 0~100
 * @param message    给用户看的一句话说明（当前在做什么 / 为什么失败）
 * @param artifactPath 产物相对项目目录的路径；还没产出时为空
 * @param errorCode  失败时的机器可读错误码
 * @param createdAt  创建时间
 * @param updatedAt  最后更新时间
 * @param finishedAt 结束时间；未结束时为 null
 * @param baseVersion   任务开始时的场景版本；与场景版本无关时为 null
 * @param resultVersion 本次产出并被提交为当前场景的版本；未提交时为 null
 */
public record Task(
        String id,
        String projectId,
        String kind,
        String status,
        String prompt,
        JsonNode request,
        int progress,
        String message,
        String artifactPath,
        String errorCode,
        Instant createdAt,
        Instant updatedAt,
        Instant finishedAt,
        Long baseVersion,
        Long resultVersion) {

    /** 排队中：已接受，尚未开始执行。 */
    public static final String STATUS_QUEUED = "queued";
    /** 执行中。 */
    public static final String STATUS_RUNNING = "running";
    /** 构建/渲染中（对外可见的细分阶段）。 */
    public static final String STATUS_BUILDING = "building";
    /** 成功完成。 */
    public static final String STATUS_COMPLETED = "completed";
    /** 执行失败。 */
    public static final String STATUS_FAILED = "failed";
    /** 用户取消。 */
    public static final String STATUS_CANCELLED = "cancelled";

    /**
     * 是否为终态。
     *
     * <p>终态之后不再接受状态迁移 —— 取消一个已完成的任务不该把它改成「已取消」，
     * 那会让用户以为白做了。</p>
     *
     * @return 是否已结束
     */
    public boolean isTerminal() {
        return STATUS_COMPLETED.equals(status)
                || STATUS_FAILED.equals(status)
                || STATUS_CANCELLED.equals(status);
    }
}

package com.fengmotion.server.project.domain;

import java.time.Instant;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 一个项目的某一历史场景版本。
 *
 * <p><strong>为什么需要它</strong>：项目的当前场景只留最新一版（{@link ProjectScene}），
 * 旧内容会被覆盖。没有历史快照就无法回答「上一版是什么样」，
 * 更无法回退 —— 只把旧 MP4 换回来是不够的，场景数据不还原，
 * 下一次修改就会基于错误的基线。</p>
 *
 * <p><strong>为什么整份存 film 而不存 diff</strong>：回退必须能把场景还原成
 * 某一版的完整内容。存 diff 需要顺序重放，任一环节缺失都会还原出错误结果；
 * 而这里的数据量很小，整份存的代价远低于它带来的确定性。</p>
 *
 * @param projectId    所属项目
 * @param version      版本号，与该版本在 {@code project_scenes} 中的号一致
 * @param film         该版本的场景数据（完整）
 * @param taskId       产生该版本的任务；回退产生的版本为回退任务 ID
 * @param prompt       触发这次变更的用户要求；非任务产生时为空串
 * @param editSummary  变更摘要，便于用户在列表里认出这是哪一版
 * @param artifactPath 该版本对应视频相对项目目录的路径；可能为空（未渲染或已清理）
 * @param source       {@code task} 表示由任务产生，{@code restore} 表示由回退产生
 * @param fromVersion  回退时的来源版本；非回退版本为 null
 * @param createdAt    写入时间
 */
public record ProjectSceneVersion(String projectId, long version, JsonNode film, String taskId,
                                  String prompt, String editSummary, String artifactPath,
                                  String source, Long fromVersion, Instant createdAt) {

    /** 由任务产生的版本。 */
    public static final String SOURCE_TASK = "task";

    /** 由回退产生的版本。 */
    public static final String SOURCE_RESTORE = "restore";

    /**
     * 是否由回退产生。
     *
     * @return 回退产生的版本为 true
     */
    public boolean restored() {
        return SOURCE_RESTORE.equals(source);
    }
}

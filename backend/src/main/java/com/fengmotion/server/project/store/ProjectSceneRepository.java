package com.fengmotion.server.project.store;

import java.util.Optional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.project.domain.ProjectScene;

/**
 * 项目当前场景的持久化。
 *
 * <p>写入只有一条路径：<strong>带期望版本号的条件更新</strong>。
 * 没有「无条件覆盖」的口子 —— 那是并发下静默丢改动的入口。</p>
 */
public interface ProjectSceneRepository {

    /**
     * 读取项目当前场景。
     *
     * @param projectId 项目 ID
     * @return 当前场景；从未写入过时为空
     */
    Optional<ProjectScene> find(String projectId);

    /**
     * 条件写入新场景。
     *
     * <p>只有当库中版本号等于 {@code expectedVersion} 时才写入并把版本号 +1。
     * {@code expectedVersion=0} 表示「期望还没有任何场景」。</p>
     *
     * @param projectId       项目 ID
     * @param expectedVersion 任务开始时读到的版本号
     * @param film            新场景
     * @param taskId          产生该版本的任务
     * @return 写入成功返回新版本号；版本已变化返回空（调用方据此报冲突）
     */
    Optional<Long> updateIfVersionMatches(String projectId, long expectedVersion, JsonNode film, String taskId);
}

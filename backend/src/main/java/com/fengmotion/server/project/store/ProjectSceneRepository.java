package com.fengmotion.server.project.store;

import java.util.List;
import java.util.Optional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.domain.ProjectSceneVersion;

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

    /**
     * 条件写入新场景<strong>并同时留下该版本的历史快照</strong>。
     *
     * <p>两件事必须在同一事务里完成：只写当前场景不写快照，
     * 会出现「版本号推进了但那一版查不到」的破洞，回退时无从还原；
     * 只写快照不写当前场景，则会留下一份从未生效的历史。</p>
     *
     * <p>这是修改与回退两条路径共用的写入口，调用方不必自己拼两个仓储调用。</p>
     *
     * @param projectId       项目 ID
     * @param expectedVersion 任务开始时读到的版本号
     * @param film            新场景
     * @param taskId          产生该版本的任务
     * @param prompt          触发这次变更的用户要求；可为 null
     * @param editSummary     变更摘要；可为 null
     * @param artifactPath    该版本视频相对项目目录的路径；可为 null
     * @param source          {@link ProjectSceneVersion#SOURCE_TASK} 或 {@link ProjectSceneVersion#SOURCE_RESTORE}
     * @param fromVersion     回退时的来源版本；非回退传 null
     * @return 写入成功返回新版本号；版本已变化返回空
     */
    Optional<Long> commitWithSnapshot(String projectId, long expectedVersion, JsonNode film, String taskId,
                                      String prompt, String editSummary, String artifactPath,
                                      String source, Long fromVersion);

    /**
     * 列出项目的全部历史版本，新版本在前。
     *
     * @param projectId 项目 ID
     * @return 历史版本列表；没有则返回空列表
     */
    List<ProjectSceneVersion> listVersions(String projectId);

    /**
     * 读取某个历史版本。
     *
     * @param projectId 项目 ID
     * @param version   版本号
     * @return 该版本；不存在时为空
     */
    Optional<ProjectSceneVersion> findVersion(String projectId, long version);
}

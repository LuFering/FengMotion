package com.fengmotion.server.project.service;

import java.util.List;
import java.util.Optional;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 场景版本历史与回退。
 *
 * <p><strong>回退是「提交一个新版本」，不是「把指针移回去」</strong>。
 * 这一点是整个设计的核心：{@code project_scenes.version} 是条件更新的比较依据，
 * 如果回退直接把 version 改小，那么一个正在执行的、基于旧版本号的任务
 * 就会意外匹配成功并把回退结果覆盖掉 —— 版本号必须单调递增才能当基线用。
 * 所以回退写成「版本 N+1，内容等于版本 K」，历史因此完整可追。</p>
 *
 * <p><strong>回退只还原场景数据，不还原视频文件</strong>。
 * 旧版本的 MP4 可能已被清理，而且场景与产物不一定一一对应。
 * 接口返回的场景数据才是权威恢复内容；产物路径只作为参考带给前端。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SceneVersionService {

    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;

    /**
     * 列出项目的版本历史。
     *
     * <p>还没接快照的旧项目会返回空列表 —— 这是真实状态，不编造历史。
     * 调用方应据此显示「还没有可回退的版本」，而不是「加载失败」。</p>
     *
     * @param projectId 项目 ID
     * @return 版本列表，新版本在前
     */
    public List<ProjectSceneVersion> list(String projectId) {
        requireProject(projectId);
        return scenes.listVersions(projectId);
    }

    /**
     * 读取某一历史版本。
     *
     * @param projectId 项目 ID
     * @param version   版本号
     * @return 该版本
     */
    public ProjectSceneVersion get(String projectId, long version) {
        requireProject(projectId);
        return scenes.findVersion(projectId, version).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found",
                        "版本 " + version + " 不存在"));
    }

    /**
     * 把场景回退到某个历史版本。
     *
     * <p>流程：确认目标版本存在 → 读当前版本作为条件基线 → 以目标版本的 film
     * 提交一个新版本。新版本的 {@code source=restore}、{@code fromVersion=目标版本}，
     * 这样在历史里能看出「这一版是回退来的、从哪一版回退的」。</p>
     *
     * @param projectId    项目 ID
     * @param targetVersion 要回退到的版本号
     * @param expectedVersion 调用方看到的当前版本；与库中不符时拒绝，避免覆盖别人的改动
     * @return 新版本
     */
    public ProjectSceneVersion restore(String projectId, long targetVersion, Long expectedVersion) {
        requireProject(projectId);

        ProjectSceneVersion target = scenes.findVersion(projectId, targetVersion).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found",
                        "版本 " + targetVersion + " 不存在，无法回退"));

        Optional<ProjectScene> current = scenes.find(projectId);
        if (current.isEmpty() || !current.get().present()) {
            throw new ApiException(HttpStatus.CONFLICT, "scene_not_initialized",
                    "项目还没有当前场景，无需回退");
        }
        long baseVersion = current.get().version();

        /* 调用方可以带上它看到的当前版本。带了就必须对上 ——
           对不上说明这期间别人改过，用户看到的历史已经过期，
           此时静默继续会让「回退」变成「把别人的新改动也一起丢掉」。 */
        if (expectedVersion != null && expectedVersion != baseVersion) {
            throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict",
                    "场景已被更新到版本 " + baseVersion + "，你看到的是版本 "
                            + expectedVersion + "，请刷新后再回退");
        }

        if (targetVersion == baseVersion) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "noop_restore",
                    "版本 " + targetVersion + " 就是当前版本，无需回退");
        }

        JsonNode film = target.film();
        if (film == null || !film.path("scenes").isArray()) {
            /* 快照里的 film 坏了（手工改库、磁盘损坏）：不能拿坏数据去覆盖当前场景。 */
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt",
                    "版本 " + targetVersion + " 的快照数据不可用，未能回退");
        }

        Optional<Long> committed = scenes.commitWithSnapshot(
                projectId, baseVersion, film, null,
                "回退到版本 " + targetVersion,
                "回退到版本 " + targetVersion,
                target.artifactPath(),
                ProjectSceneVersion.SOURCE_RESTORE, targetVersion);

        if (committed.isEmpty()) {
            // 走到这里说明在读到 baseVersion 之后、写入之前，有人提交了新版本
            throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict",
                    "场景在你回退期间被更新了，请刷新后重试");
        }

        long newVersion = committed.get();
        log.info("回退场景：project={} 从版本 {} 回退到 {} 的内容，新版本 {}",
                projectId, baseVersion, targetVersion, newVersion);
        return scenes.findVersion(projectId, newVersion).orElseThrow(() ->
                new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error",
                        "回退已提交但读取新版本失败"));
    }

    /**
     * 确认项目存在，区分「项目不存在」与「项目没有版本」。
     *
     * @param projectId 项目 ID
     */
    private void requireProject(String projectId) {
        if (projects.findById(projectId).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在");
        }
    }
}

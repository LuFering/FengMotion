package com.fengmotion.server.project.api;

import java.time.Instant;
import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.service.SceneVersionService;

import lombok.RequiredArgsConstructor;

/**
 * 场景版本历史与回退接口。
 *
 * <p><strong>为什么要带 version 字段给前端</strong>：只给一个列表，
 * 前端无法判断哪一版是「当前」，用户点回退时也不知道自己会从哪一版退到哪一版。
 * 响应里显式给出每版序号与回退来源，界面才能把「当前版本」标出来。</p>
 *
 * <p><strong>回退不返回视频而是返回场景</strong>：回退的权威结果是被还原的场景数据。
 * 视频文件可能已被清理，且场景与产物不一定一一对应，把它当回退结果会让用户
 * 误以为「视频回来了就等于回退成功」。{@code restoredFrom} 明确写出从哪一版回退。</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/scene/versions")
@RequiredArgsConstructor
public class SceneVersionController {

    private final SceneVersionService versions;

    /**
     * 列出项目的全部场景版本，新版本在前。
     *
     * @param projectId 项目 ID
     * @return 版本列表；还没产生过快照时为空数组（正常状态，不是错误）
     */
    @GetMapping
    public VersionListResponse list(@PathVariable String projectId) {
        List<VersionItem> items = versions.list(projectId).stream()
                .map(SceneVersionController::toItem)
                .toList();
        return new VersionListResponse(projectId, items);
    }

    /**
     * 读取单个历史版本（含完整场景数据）。
     *
     * @param projectId 项目 ID
     * @param version   版本号
     * @return 该版本
     */
    @GetMapping("/{version}")
    public VersionItem get(@PathVariable String projectId, @PathVariable long version) {
        return toItem(versions.get(projectId, version));
    }

    /**
     * 回退到指定历史版本。
     *
     * <p>回退会<strong>新增</strong>一个版本（内容等于目标版本），不会删除或改写历史。
     * 因此回退之后仍然可以「回退掉这次回退」。</p>
     *
     * @param projectId 项目 ID
     * @param version   要回退到的版本号
     * @param request   可选的当前版本校验
     * @return 新产生的版本
     */
    @PostMapping("/{version}/restore")
    public VersionItem restore(@PathVariable String projectId, @PathVariable long version,
                               @RequestBody(required = false) RestoreRequest request) {
        Long expected = request == null ? null : request.expectedVersion();
        return toItem(versions.restore(projectId, version, expected));
    }

    /**
     * 把领域对象转成响应项。
     *
     * @param version 历史版本
     * @return 响应项
     */
    private static VersionItem toItem(ProjectSceneVersion version) {
        return new VersionItem(
                version.version(),
                version.film(),
                version.taskId(),
                version.prompt(),
                version.editSummary(),
                version.artifactPath(),
                version.source(),
                version.fromVersion(),
                version.createdAt());
    }

    /**
     * 版本列表响应。
     *
     * @param projectId 项目 ID
     * @param items     版本列表，新版本在前
     */
    public record VersionListResponse(String projectId, List<VersionItem> items) {
    }

    /**
     * 单个版本。
     *
     * @param version      版本号
     * @param film         该版本的完整场景数据
     * @param taskId       产生该版本的任务；回退产生的版本为 null
     * @param prompt       触发该版本的用户要求
     * @param editSummary  变更摘要
     * @param artifactPath 该版本视频路径；可能为空
     * @param source       {@code task} 或 {@code restore}
     * @param fromVersion  回退来源版本；非回退为 null
     * @param createdAt    产生时间
     */
    public record VersionItem(long version, com.fasterxml.jackson.databind.JsonNode film,
                              String taskId, String prompt, String editSummary,
                              String artifactPath, String source, Long fromVersion,
                              Instant createdAt) {
    }

    /**
     * 回退请求。
     *
     * @param expectedVersion 调用方看到的当前版本；提供则做乐观并发校验
     */
    public record RestoreRequest(Long expectedVersion) {
    }
}

package com.fengmotion.server.creation.service;

import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.service.ProjectWorktreeService;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.workflow.service.StoryboardService;

import lombok.RequiredArgsConstructor;

/**
 * 项目内容读模型的轻量统计聚合。
 *
 * <p>与 {@link ProjectContentService} 的逐项详情不同，本服务只回答
 * 「当前版本有多少条已绑定时间线的片段 / 当前工程声明了几段分镜 /
 * 当前版本里已定稿的镜头数」。详情页只关心数量，不需要为每个项目
 * 把完整时间线和分镜记录反序列化一遍。</p>
 *
 * <ul>
 *   <li>{@code timelineClips} 与 {@code GET /timeline} 的 clips 总数一致；
 *       版本缺失、产物缺失或轨道清单未生成时为 0。</li>
 *   <li>{@code storyboardSegments} 与 {@code GET /storyboard} 的条目数一致；
 *       分镜文件缺失、损坏或字段超限时为 0。</li>
 *   <li>{@code doneScenes} 不推测：版本级审阅无法拆到镜头粒度，
 *       保持 0 并交由版本审阅接口单独回答。</li>
 * </ul>
 *
 * <p>本接口只在项目详情场景调用，不提供批量形式；
 * 批量项目列表不应为读取统计引入 N+1 文件 IO。</p>
 */
@Service
@RequiredArgsConstructor
public class ProjectContentCountsService {
    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectOperationLock operations;
    private final ProjectTimelineService timelines;
    private final StoryboardService storyboards;

    public Counts read(String projectId) {
        try (var activity = operations.participate(projectId)) {
            var project = projects.findById(projectId)
                    .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
            int timelineClips = timelineClips(projectId);
            int storyboardSegments = storyboardSegments(project);
            int scenes = currentSceneCount(projectId);
            int compositions = compositionCount(projectId);
            return new Counts(projectId, scenes, 0, storyboardSegments, compositions, timelineClips);
        }
    }

    private int timelineClips(String projectId) {
        var current = scenes.find(projectId).orElse(null);
        if (current == null) return 0;
        var saved = scenes.findVersion(projectId, current.version()).orElse(null);
        if (saved == null || saved.artifactPath() == null || saved.artifactPath().isBlank()) return 0;
        JsonNode manifest;
        try {
            manifest = timelines.read(projectId, saved.artifactPath());
        } catch (ApiException unavailable) {
            return 0;
        }
        int total = 0;
        for (JsonNode track : manifest.path("tracks")) total += track.path("clips").size();
        return total;
    }

    private int storyboardSegments(Project project) {
        Path root = ProjectWorktreeService.root(project);
        boolean hasStoryboard = Files.exists(root.resolve("storyboard.json"), LinkOption.NOFOLLOW_LINKS);
        boolean hasShotPlan = Files.exists(root.resolve("shot-plan.json"), LinkOption.NOFOLLOW_LINKS);
        if (!hasStoryboard && !hasShotPlan) return 0;
        try {
            return storyboards.read(project.id()).items().size();
        } catch (ApiException invalid) {
            return 0;
        }
    }

    private int currentSceneCount(String projectId) {
        var current = scenes.find(projectId).orElse(null);
        if (current == null || current.film() == null || !current.film().isObject()) return 0;
        boolean rendered = "project-render".equals(current.film().path("kind").asText());
        JsonNode items = rendered ? current.film().path("shotTimeline").path("shots") : current.film().path("scenes");
        return items.isArray() ? items.size() : 0;
    }

    private int compositionCount(String projectId) {
        var current = scenes.find(projectId).orElse(null);
        if (current == null || current.film() == null || !current.film().isObject()) return 0;
        boolean rendered = "project-render".equals(current.film().path("kind").asText());
        return rendered && current.film().path("compositionId").isTextual()
                && !current.film().path("compositionId").asText().isBlank() ? 1 : 0;
    }

    /**
     * @param projectId          项目稳定标识
     * @param scenes             当前版本镜头条目数（来自 film.scenes / film.shotTimeline.shots）
     * @param doneScenes         已定稿镜头数；版本级审阅无法拆到镜头，保持 0
     * @param storyboardSegments 磁盘上分镜文件声明的条目数；文件缺失或损坏为 0
     * @param compositions       已生成合成数；渲染版本 compositionId 非空时为 1
     * @param timelineClips      当前版本成片时间线片段总数；轨道缺失为 0
     */
    public record Counts(String projectId, int scenes, int doneScenes, int storyboardSegments,
                         int compositions, int timelineClips) { }
}

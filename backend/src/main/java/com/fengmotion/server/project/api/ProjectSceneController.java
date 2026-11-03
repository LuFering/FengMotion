package com.fengmotion.server.project.api;

import java.time.Instant;
import java.util.Optional;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

import lombok.RequiredArgsConstructor;

/**
 * 项目当前场景的读取端点。
 *
 * <p><strong>为什么需要它</strong>：场景已经由后端持有（修改任务的权威基线），
 * 前端要显示「现在这条片子是什么样」就必须能读。没有这个端点，
 * 前端只能拿自己手里的旧副本，又回到「两边各一份、不知谁对」的老问题。</p>
 *
 * <p><strong>「尚未初始化」必须是明确状态，不能编一份默认场景</strong>：
 * 编造一个空片子当当前内容，会让用户以为项目里已经有片子了，
 * 后续修改也会基于这个凭空产生的基线。所以这里返回 {@code initialized=false}
 * 与 {@code film=null}，让调用方明确知道「还没有」。</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/scene")
@RequiredArgsConstructor
public class ProjectSceneController {

    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;

    /**
     * 读取项目当前场景。
     *
     * @param projectId 项目 ID
     * @return 当前场景；尚未初始化时 {@code initialized=false} 且 {@code film=null}
     */
    @GetMapping
    public SceneResponse get(@PathVariable String projectId) {
        // 项目不存在与「场景尚未初始化」是两回事，必须区分：
        // 前者是调用方拿错了 ID，后者是正常状态
        if (projects.findById(projectId).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在");
        }
        Optional<ProjectScene> stored = scenes.find(projectId);
        if (stored.isEmpty() || !stored.get().present()) {
            return new SceneResponse(projectId, false, 0, null, null, null);
        }
        ProjectScene scene = stored.get();
        return new SceneResponse(projectId, true, scene.version(), scene.film(),
                scene.taskId(), scene.updatedAt());
    }

    /**
     * 当前场景响应。
     *
     * @param projectId   项目 ID
     * @param initialized 是否已有当前场景；false 时其余字段无意义
     * @param version     当前版本号；未初始化时为 0
     * @param film        场景数据；未初始化时为 null
     * @param taskId      产生当前版本的任务；外部导入或未初始化时为 null
     * @param updatedAt   最后更新时间；未初始化时为 null
     */
    public record SceneResponse(String projectId, boolean initialized, long version,
                                JsonNode film, String taskId, Instant updatedAt) {
    }
}

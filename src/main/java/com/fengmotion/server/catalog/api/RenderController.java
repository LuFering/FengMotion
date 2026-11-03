package com.fengmotion.server.catalog.api;

import java.nio.file.Path;
import java.time.Instant;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.catalog.service.RemotionRenderer;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

import lombok.RequiredArgsConstructor;

/**
 * 渲染端点：把 AI 产出的场景数据渲染成项目里的 mp4。
 *
 * <p>同步返回：渲染通常几十秒到几分钟。当前没有任务队列，用 HTTP 超时兜底；
 * 后续接入任务域后应改成「提交即返回 taskId，进度走事件流」。</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/renders")
@RequiredArgsConstructor
public class RenderController {

    private final ProjectRepository projects;
    private final RemotionRenderer renderer;
    private final ObjectMapper json;

    /**
     * 渲染一部影片。
     *
     * <p>请求体就是 Remotion 工程接受的 props：{@code {width, height, fps, scenes: [...]}}。
     * 不在这里做字段级别的强校验 —— 渲染脚本会如实报错，比后端再维护一份
     * 与前端重复的 schema 更不容易走样。</p>
     *
     * @param projectId 项目 ID
     * @param film      影片数据
     * @return 产物信息
     */
    @PostMapping
    public RenderResponse render(@PathVariable String projectId, @RequestBody JsonNode film) {
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));

        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目还没有目录，不能渲染");
        }
        if (film == null || !film.hasNonNull("scenes") || !film.path("scenes").isArray()
                || film.path("scenes").isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "请求体需要非空的 scenes 数组");
        }

        Path root = Path.of(rootPath).toAbsolutePath().normalize();
        // 产物落在项目的 renders/ 子目录：与用户素材分开，也方便整体清理
        String fileName = "render-" + Instant.now().toEpochMilli() + ".mp4";
        Path output = root.resolve("renders").resolve(fileName);

        RemotionRenderer.RenderResult result = renderer.render(film, output);

        ObjectNode data = json.createObjectNode();
        data.put("path", "renders/" + fileName);
        data.put("name", fileName);
        data.put("sizeBytes", output.toFile().length());
        data.put("durationInFrames", result.durationInFrames());
        data.put("width", result.width());
        data.put("height", result.height());
        data.put("fps", result.fps());
        return new RenderResponse(data);
    }

    /**
     * 渲染结果。
     *
     * @param artifact 产物描述（与产物列表的字段保持一致，前端可直接复用展示逻辑）
     */
    public record RenderResponse(JsonNode artifact) {
    }
}

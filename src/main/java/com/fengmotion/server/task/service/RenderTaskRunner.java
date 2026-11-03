package com.fengmotion.server.task.service;

import java.nio.file.Path;
import java.time.Instant;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.catalog.service.RemotionRenderer;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.task.domain.Task;

import lombok.RequiredArgsConstructor;

/**
 * 渲染任务执行器：把任务里的场景数据交给 Remotion 渲染成 mp4。
 *
 * <p>这是第一阶段唯一接通的真实产出路径。选它而不是新做一条，是因为
 * Remotion 渲染已经实测能出片（1280x720 / 15 秒左右），把它包进任务模型
 * 比重新发明一条链路更划算。</p>
 */
@Component
@RequiredArgsConstructor
public class RenderTaskRunner {

    private final RemotionRenderer renderer;
    private final ProjectRepository projects;

    /**
     * 执行渲染任务。
     *
     * @param task     任务快照
     * @param progress 进度通道
     * @return 产物相对项目目录的路径
     * @throws Exception 渲染失败时抛出
     */
    public String run(Task task, TaskService.Progress progress) throws Exception {
        Project project = projects.findById(task.projectId())
                .orElseThrow(() -> new ApiException(org.springframework.http.HttpStatus.NOT_FOUND,
                        "not_found", "项目不存在"));

        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    "validation_error", "项目还没有目录，不能渲染");
        }

        JsonNode request = task.request();
        JsonNode film = request == null ? null : request.get("film");
        if (film == null || !film.hasNonNull("scenes")) {
            throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    "validation_error", "任务缺少 film.scenes");
        }

        if (progress.isCancelled()) {
            return null;
        }
        progress.report(10, "准备渲染");

        Path root = Path.of(rootPath).toAbsolutePath().normalize();
        String fileName = "render-" + Instant.now().toEpochMilli() + ".mp4";
        Path output = root.resolve("renders").resolve(fileName);

        progress.report(30, "正在渲染画面");
        RemotionRenderer.RenderResult result = renderer.render(film, output);

        if (progress.isCancelled()) {
            // 已经渲染完了但用户不要了：删掉产物，别留一个用户没要的文件
            try {
                java.nio.file.Files.deleteIfExists(output);
            } catch (java.io.IOException ignored) {
                // 删不掉也不影响取消语义
            }
            return null;
        }

        progress.report(95, "渲染完成，正在登记产物");
        return "renders/" + fileName;
    }
}

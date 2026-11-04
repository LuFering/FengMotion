package com.fengmotion.server.task.service;

import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.catalog.service.RemotionRenderer;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.store.TaskRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 创建任务执行器：一句需求 → 生成分镜 → 渲染 → 提交为项目第一个版本。
 *
 * <p><strong>这是「从零创作」的第一条真实路径</strong>。在此之前，真实渲染
 * 只能渲染调用方自己给的 {@code film.scenes}；用户说「做一条关于 XX 的片子」
 * 是没有任何接口能接住的。</p>
 *
 * <p><strong>能力边界必须说清，不能假装是完整创作</strong>：这里做的是
 * 「需求 → 文字分镜 + 配色 + 时长 → 出片」。不包含画面素材、动画、转场、
 * 配音、音乐 —— 那条链路所需的能力远超当前范围。产出是一条文字驱动的短片，
 * 而不是 AI 生成的画面，界面上也要这样讲。</p>
 *
 * <p><strong>为什么生成完还要渲染并提交版本</strong>：只生成分镜不落库，
 * 用户刷新一下就没了，也没法继续修改。提交为版本 1 之后，
 * 它就和「修改」「版本历史」接上了 —— 创建出来的片子能立刻被改、能回退。</p>
 *
 * <p><strong>项目已有场景时拒绝</strong>：创建是给空项目用的。
 * 已有场景还允许创建会覆盖用户的内容，那应该用修改或回退，而不是创建。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CreateTaskRunner {

    private final SceneDraftGenerator generator;
    private final RemotionRenderer renderer;
    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final TaskRepository tasks;

    /** 默认画布与帧率，与前端预览一致。 */
    private static final int DEFAULT_WIDTH = 1280;
    private static final int DEFAULT_HEIGHT = 720;
    private static final int DEFAULT_FPS = 30;

    /**
     * 执行创建任务。
     *
     * @param task     任务快照
     * @param progress 进度通道
     * @return 产物相对项目目录的路径
     * @throws Exception 失败
     */
    public String run(Task task, TaskService.Progress progress) throws Exception {
        Project project = projects.findById(task.projectId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));

        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目还没有目录，不能创建");
        }

        JsonNode request = task.request();
        if (request == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "任务缺少请求体");
        }

        /* 已有场景就不该走创建：那会覆盖用户已经做出来的内容。
           这里如实拒绝，并指出应该用修改或回退 —— 静默覆盖是最糟的选择。 */
        Optional<ProjectScene> existing = scenes.find(task.projectId());
        if (existing.isPresent() && existing.get().present()) {
            throw new ApiException(HttpStatus.CONFLICT, "scene_already_exists",
                    "项目已经有场景（版本 " + existing.get().version()
                            + "），请用修改或回退，而不是重新创建");
        }

        int width = request.path("width").asInt(DEFAULT_WIDTH);
        int height = request.path("height").asInt(DEFAULT_HEIGHT);
        int fps = request.path("fps").asInt(DEFAULT_FPS);
        if (width <= 0 || height <= 0 || fps <= 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "画布尺寸或帧率不合法");
        }

        // ① 生成分镜
        progress.report(10, "正在根据需求设计分镜");
        JsonNode film = generator.generate(task.prompt(), width, height, fps);
        int sceneCount = film.path("scenes").size();
        progress.report(40, "已生成 " + sceneCount + " 个场景，开始渲染");
        if (progress.isCancelled()) {
            return null;
        }

        // ② 渲染
        Path root = Path.of(rootPath).toAbsolutePath().normalize();
        String fileName = "create-" + Instant.now().toEpochMilli() + ".mp4";
        Path output = root.resolve("renders").resolve(fileName);
        progress.report(50, "正在渲染画面");
        renderer.render(film, output);

        if (progress.isCancelled()) {
            try {
                java.nio.file.Files.deleteIfExists(output);
            } catch (java.io.IOException ignored) {
                // 删不掉不影响取消语义
            }
            return null;
        }

        // ③ 提交为版本 1（或当前版本 +1，与并发写入走同一套条件更新）
        progress.report(90, "渲染完成，正在提交场景版本");
        long baseVersion = existing.map(ProjectScene::version).orElse(0L);
        String summary = summarize(film);
        Optional<Long> committed = scenes.commitWithSnapshot(
                task.projectId(), baseVersion, film, task.id(),
                task.prompt(), summary, "renders/" + fileName,
                ProjectSceneVersion.SOURCE_TASK, null);
        if (committed.isEmpty()) {
            /* 生成与渲染期间有别人写入了场景：本次产物保留但不当成当前版本。 */
            tasks.updateVersions(task.id(), baseVersion, null);
            taskServiceArtifact(task, "renders/" + fileName);
            throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict",
                    "项目在你创建期间被写入了新场景，本次结果未提交；视频保留在 renders/" + fileName);
        }

        tasks.updateVersions(task.id(), baseVersion, committed.get());
        progress.report(95, "已提交为版本 " + committed.get());
        return "renders/" + fileName;
    }

    /**
     * 登记产物路径。
     *
     * <p>冲突时任务会是 failed，但视频真实存在。不登记前端就拿不到它，
     * 用户会以为白跑了一次渲染。这里通过 TaskRepository 直接写，
     * 避免为一个失败收尾再注入整个 TaskService。</p>
     *
     * @param task 任务
     * @param path 产物路径
     */
    private void taskServiceArtifact(Task task, String path) {
        tasks.updateProgress(task.id(), "running", 90, "内容已生成但未提交", path, null, false);
    }

    /**
     * 生成一行摘要，写进历史版本列表。
     *
     * <p>「版本 1」本身说明不了内容；用户要看到的是「3 个场景 · 第一条讲了什么」。</p>
     *
     * @param film 场景
     * @return 摘要
     */
    private String summarize(JsonNode film) {
        JsonNode scenesNode = film.path("scenes");
        StringBuilder sb = new StringBuilder("生成 ").append(scenesNode.size()).append(" 个场景");
        if (!scenesNode.isEmpty()) {
            String first = scenesNode.get(0).path("text").asText("");
            sb.append("：").append(first.length() <= 20 ? first : first.substring(0, 20) + "…");
        }
        return sb.toString();
    }
}

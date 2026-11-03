package com.fengmotion.server.task.service;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.catalog.service.RemotionRenderer;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.domain.TaskScope;
import com.fengmotion.server.task.store.TaskRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 修改任务执行器：解析范围 → 读当前场景 → 生成方案 → 校验 → 渲染 → 条件提交。
 *
 * <p><strong>为什么基线来自服务端而不是请求</strong>：如果每次都拿前端带来的
 * 旧场景当基线，连续修改会互相覆盖 —— 第二次改背景色时用的是第一次改文字之前
 * 的快照，于是第一次的文字改动被抹掉。项目当前场景由后端持有，
 * 每次修改都基于<strong>库里最新的一版</strong>。</p>
 *
 * <p><strong>为什么「渲染」与「提交」分开</strong>：渲染可能失败、可能被取消。
 * 只有渲染成功之后才把新场景提交为当前版本，否则用户会看到一条
 * 「场景已更新」但产物根本不存在的记录。</p>
 *
 * <p><strong>为什么提交要带版本条件</strong>：任务执行期间可能有别人也改了场景。
 * 提交时以任务开始读到的版本为准，版本已变就报冲突而不覆盖 ——
 * 静默覆盖别人（或自己另一个任务）的修改，是最难排查的那类 bug。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ModifyTaskRunner {

    private final RemotionRenderer renderer;
    private final MockModifyExecutor generator;
    private final ModifyPlanApplier applier;
    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final TaskRepository tasks;
    private final TaskService taskService;
    private final com.fasterxml.jackson.databind.ObjectMapper json;

    /**
     * 执行修改任务。
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
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目还没有目录，不能修改");
        }

        JsonNode request = task.request();
        if (request == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "任务缺少请求体");
        }

        // ① 读取当前场景（服务端权威）
        progress.report(5, "正在读取当前场景");
        Optional<ProjectScene> stored = scenes.find(task.projectId());
        JsonNode film;
        long baseVersion;
        if (stored.isPresent() && stored.get().present()) {
            film = stored.get().film();
            baseVersion = stored.get().version();
        } else {
            /* 库里还没有场景：兼容「请求携带基线」的旧用法，把它作为版本 0 的起点。
               注意这只能发生一次 —— 提交之后库里就有版本了，之后一律以库为准。 */
            JsonNode fromRequest = request.get("film");
            if (fromRequest == null || !fromRequest.path("scenes").isArray()
                    || fromRequest.path("scenes").isEmpty()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                        "项目还没有场景数据，请求需要携带 film.scenes 作为起点");
            }
            film = fromRequest;
            baseVersion = 0;
        }
        // 记录「这次基于哪一版」，便于事后追溯
        tasks.updateVersions(task.id(), baseVersion, null);
        if (progress.isCancelled()) {
            return null;
        }

        // ② 解析可修改范围
        progress.report(15, "正在解析修改范围");
        TaskScope scope = TaskScope.fromWire(request.path("scope").asText(null));
        if (scope == null || !scope.supported()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "unsupported_field", "该修改范围本版不支持");
        }
        List<String> sceneIds = new java.util.ArrayList<>();
        request.path("sceneIds").forEach(node -> sceneIds.add(node.asText()));
        List<String> editable = ModifyPlanApplier.editableScenes(scope, sceneIds, film, List.of());
        List<String> preserved = ModifyPlanApplier.preservedScenes(film, editable);
        if (progress.isCancelled()) {
            return null;
        }

        // ③ 生成方案
        progress.report(25, "正在生成修改方案（基于版本 " + baseVersion + "）");
        ModifyPlan plan = generator.generate(task.prompt(), film, editable);
        progress.report(50, "已生成 " + plan.edits().size() + " 条修改");

        // ④ 校验并应用
        progress.report(60, "正在校验修改方案");
        JsonNode modified = applier.apply(plan, film, editable, preserved);
        progress.report(70, "校验通过，开始渲染");

        if (progress.isCancelled()) {
            return null;
        }

        // 渲染：交给统一工程
        Path root = Path.of(rootPath).toAbsolutePath().normalize();
        String fileName = "modify-" + Instant.now().toEpochMilli() + ".mp4";
        Path output = root.resolve("renders").resolve(fileName);
        renderer.render(modified, output);

        if (progress.isCancelled()) {
            try {
                java.nio.file.Files.deleteIfExists(output);
            } catch (java.io.IOException ignored) {
                // 删不掉不影响取消语义
            }
            return null;
        }

        // ⑤ 条件提交：渲染成功之后才更新当前场景
        progress.report(90, "渲染完成，正在提交场景版本");
        Optional<Long> committed = scenes.updateIfVersionMatches(
                task.projectId(), baseVersion, modified, task.id());
        if (committed.isEmpty()) {
            /* 版本已变：说明期间有别的修改提交了。
               本次产物保留（用户可能要），但明确标记未成为当前版本，
               绝不覆盖别人已经提交的内容。 */
            tasks.updateVersions(task.id(), baseVersion, null);
            // 先登记产物路径：任务会是 failed，但这个视频真实存在，
            // 不登记前端就拿不到它，用户会以为白跑了
            taskService.registerArtifact(task.id(), "renders/" + fileName);
            throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict",
                    "场景已被其他修改更新到版本 " + currentVersion(task.projectId())
                            + "，本次修改基于版本 " + baseVersion
                            + "，已放弃提交；视频文件保留在 renders/" + fileName + "，但未成为当前场景");
        }

        tasks.updateVersions(task.id(), baseVersion, committed.get());
        progress.report(95, "已提交为版本 " + committed.get());
        return "renders/" + fileName;
    }

    /**
     * 读当前版本号，用于冲突提示。
     *
     * @param projectId 项目 ID
     * @return 版本号；读不到时返回 -1
     */
    private long currentVersion(String projectId) {
        return scenes.find(projectId).map(ProjectScene::version).orElse(-1L);
    }

    /**
     * 把修改结果写进任务事件，便于前端展示「改了什么」。
     *
     * @param plan 方案
     * @return 可落库的 JSON
     */
    public JsonNode describePlan(ModifyPlan plan) {
        ObjectNode data = json.createObjectNode();
        var edits = data.putArray("edits");
        for (ModifyPlan.Edit edit : plan.edits()) {
            edits.addObject()
                    .put("sceneId", edit.sceneId())
                    .put("field", edit.field())
                    .put("from", edit.from())
                    .put("to", edit.to())
                    .put("reason", edit.reason());
        }
        return data;
    }
}

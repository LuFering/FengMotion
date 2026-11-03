package com.fengmotion.server.task.service;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.catalog.service.RemotionRenderer;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.domain.TaskScope;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 修改任务执行器：解析范围 → 读基线 → 生成方案 → 校验应用 → 渲染。
 *
 * <p><strong>为什么不复用 {@link RenderTaskRunner}</strong>：渲染器要的是「确定的
 * film.scenes」，而修改任务拿到的是「用户意图」。两者之间必须有一次
 * 生成与校验，这是本类存在的理由。生成校验之后，渲染仍然交给
 * {@link RemotionRenderer}，不另写一条出片链路。</p>
 *
 * <p><strong>失败时原片必须保持可用</strong>：校验通过之前不写回任何东西，
 * 也不产出半成品文件。用户看到「修改失败」时，手里的片子应该还是原来那条。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ModifyTaskRunner {

    private final RemotionRenderer renderer;
    private final MockModifyExecutor generator;
    private final ModifyPlanApplier applier;
    private final ProjectRepository projects;
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
        JsonNode film = request.get("film");
        if (film == null || !film.path("scenes").isArray() || film.path("scenes").isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "修改任务需要携带当前场景作为基线（film.scenes）");
        }

        // ① 解析可修改范围
        progress.report(5, "正在解析修改范围");
        TaskScope scope = TaskScope.fromWire(request.path("scope").asText(null));
        if (scope == null || !scope.supported()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "unsupported_field",
                    "该修改范围本版不支持");
        }
        List<String> sceneIds = new java.util.ArrayList<>();
        request.path("sceneIds").forEach(node -> sceneIds.add(node.asText()));
        List<String> editable = ModifyPlanApplier.editableScenes(scope, sceneIds, film, List.of());
        List<String> preserved = ModifyPlanApplier.preservedScenes(film, editable);
        if (progress.isCancelled()) {
            return null;
        }

        // ② 读取基线（第一版基线由请求携带，见设计文档 §5）
        progress.report(15, "正在读取当前场景");
        JsonNode baseline = film.deepCopy();
        if (progress.isCancelled()) {
            return null;
        }

        // ③ 生成方案
        progress.report(25, "正在生成修改方案");
        ModifyPlan plan = generator.generate(task.prompt(), baseline, editable);
        progress.report(50, "已生成 " + plan.edits().size() + " 条修改");

        // ④ 校验并应用
        progress.report(60, "正在校验修改方案");
        JsonNode modified = applier.apply(plan, baseline, editable, preserved);
        progress.report(70, "校验通过，开始渲染");

        if (progress.isCancelled()) {
            return null;
        }

        // 渲染：交给统一工程，不另写链路
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

        progress.report(95, "渲染完成，正在登记产物");
        return "renders/" + fileName;
    }

    /**
     * 把修改结果写进任务事件，便于前端展示「改了什么」。
     *
     * @param plan 方案
     * @return 可落库的 JSON
     */
    public JsonNode describePlan(ModifyPlan plan) {
        ObjectNode data = json.createObjectNode();
        ArrayNode edits = data.putArray("edits");
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

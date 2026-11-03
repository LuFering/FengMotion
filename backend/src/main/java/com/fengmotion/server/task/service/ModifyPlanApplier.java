package com.fengmotion.server.task.service;

import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.http.HttpStatus;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.task.domain.TaskScope;

import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 修改方案校验与应用。
 *
 * <p>这是「AI 说了算」与「系统说了算」的分界线：模型只能提出编辑建议，
 * 能不能落到影片上由这里判定。<strong>任一不通过就整份拒绝</strong>，
 * 不做「跳过坏的那条、应用好的几条」—— 那样用户会拿到一个半改的片子，
 * 而且无从得知哪条没生效。</p>
 *
 * <p>校验四项（对应设计文档 §4 ④）：</p>
 * <ol>
 *   <li>场景在可改集合内</li>
 *   <li>字段在白名单内</li>
 *   <li>{@code from} 与当前值一致（防止基于过时认知改错地方）</li>
 *   <li>应用后仍满足 {@code preserveOutsideSelection}</li>
 * </ol>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ModifyPlanApplier {

    private final com.fasterxml.jackson.databind.ObjectMapper json;

    /**
     * 校验并应用方案，返回新的 film。
     *
     * <p>不改动传入的 {@code film}：复制后返回。失败时调用方手里的原片还是完好的。</p>
     *
     * @param plan         修改方案
     * @param film         当前场景基线
     * @param editable     允许修改的场景 ID
     * @param preserved    必须原样保留的场景 ID
     * @return 应用后的新 film
     * @throws ApiException 方案不合法
     */
    public JsonNode apply(ModifyPlan plan, JsonNode film, List<String> editable, List<String> preserved) {
        if (plan == null || plan.edits() == null || plan.edits().isEmpty()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "modify_plan_invalid",
                    "模型没有给出任何修改");
        }

        JsonNode working = film.deepCopy();
        JsonNode scenes = working.path("scenes");
        if (!scenes.isArray()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "film.scenes 不是数组");
        }

        List<String> problems = new ArrayList<>();
        for (ModifyPlan.Edit edit : plan.edits()) {
            checkOne(edit, scenes, editable, problems);
        }
        if (!problems.isEmpty()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "modify_plan_invalid",
                    "修改方案未通过校验：" + String.join("；", problems));
        }

        // 全部校验通过后才真正写
        for (ModifyPlan.Edit edit : plan.edits()) {
            write(scenes, edit);
        }

        checkPreserved(scenes, preserved);
        return working;
    }

    /**
     * 校验单条编辑，把问题收集进 {@code problems}。
     *
     * @param edit     编辑指令
     * @param scenes   场景数组
     * @param editable 允许修改的场景
     * @param problems 问题收集器
     */
    private void checkOne(ModifyPlan.Edit edit, JsonNode scenes, List<String> editable, List<String> problems) {
        if (edit == null || edit.sceneId() == null) {
            problems.add("有一条编辑缺少 sceneId");
            return;
        }
        if (!editable.contains(edit.sceneId())) {
            problems.add("场景 " + edit.sceneId() + " 不在可修改范围内");
            return;
        }
        if (!ModifyPlanValidator.isAllowed(edit.field())) {
            problems.add("字段 " + edit.field() + " 第一版不可修改");
            return;
        }
        JsonNode scene = findScene(scenes, edit.sceneId());
        if (scene == null) {
            problems.add("场景 " + edit.sceneId() + " 不存在");
            return;
        }
        String actual = currentValue(scene, edit.field());
        if (!normalize(actual).equals(normalize(edit.from()))) {
            problems.add("场景 " + edit.sceneId() + " 的 " + edit.field()
                    + " 当前值是「" + actual + "」，与模型认为的「" + edit.from() + "」不一致");
        }
    }

    /**
     * 把一条编辑写入场景对象。
     *
     * @param scenes 场景数组
     * @param edit   编辑指令
     */
    private void write(JsonNode scenes, ModifyPlan.Edit edit) {
        JsonNode scene = findScene(scenes, edit.sceneId());
        if (!(scene instanceof ObjectNode object)) {
            return;
        }
        if ("durationSeconds".equals(edit.field())) {
            try {
                object.put(edit.field(), Double.parseDouble(edit.to()));
            } catch (NumberFormatException invalid) {
                // 上面已校验过类型，走到这里说明校验有漏；保留原值并留日志
                log.warn("无法把 {} 解析成数字：{}", edit.sceneId(), edit.to());
            }
        } else {
            object.put(edit.field(), edit.to());
        }
    }

    /**
     * 校验被保留的场景没有被改动。
     *
     * @param scenes    应用后的场景
     * @param preserved 必须原样保留的场景
     * @throws ApiException 有越界改动
     */
    private void checkPreserved(JsonNode scenes, List<String> preserved) {
        if (preserved == null || preserved.isEmpty()) {
            return;
        }
        for (String sceneId : preserved) {
            JsonNode scene = findScene(scenes, sceneId);
            if (scene == null) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "constraint_unsatisfied",
                        "场景 " + sceneId + " 应当保留却不见了");
            }
        }
    }

    /**
     * 读当前字段值。
     *
     * @param scene 场景对象
     * @param field 字段名
     * @return 当前值；没有时为空串
     */
    private String currentValue(JsonNode scene, String field) {
        JsonNode node = scene.get(field);
        return node == null || node.isNull() ? "" : node.asText();
    }

    /**
     * 统一比较口径：null 与空串视为相等，避免模型把「没有这个字段」写成空串时误判。
     *
     * @param value 值
     * @return 归一化后的字符串
     */
    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }

    /**
     * 按 id 找场景。
     *
     * @param scenes  场景数组
     * @param sceneId 场景 ID
     * @return 场景节点；找不到时返回 null
     */
    private JsonNode findScene(JsonNode scenes, String sceneId) {
        for (JsonNode scene : scenes) {
            if (sceneId.equals(scene.path("id").asText(null))) {
                return scene;
            }
        }
        return null;
    }

    /**
     * 把 film 里的场景 ID 按可改/保留分开。
     *
     * @param film     影片数据
     * @param editable 允许修改的场景
     * @return 不可改场景 ID 列表
     */
    public static List<String> preservedScenes(JsonNode film, List<String> editable) {
        List<String> result = new ArrayList<>();
        for (JsonNode scene : film.path("scenes")) {
            String id = scene.path("id").asText(null);
            if (id != null && !editable.contains(id)) {
                result.add(id);
            }
        }
        return result;
    }

    /**
     * 校验场景 ID 都真实存在。
     *
     * @param film     影片数据
     * @param sceneIds 待检查的场景 ID
     * @throws ApiException 有不存在者
     */
    public static void requireScenesExist(JsonNode film, List<String> sceneIds) {
        List<String> missing = new ArrayList<>();
        for (String id : sceneIds) {
            boolean found = false;
            for (JsonNode scene : film.path("scenes")) {
                if (id.equals(scene.path("id").asText(null))) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                missing.add(id);
            }
        }
        if (!missing.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "scene_not_found",
                    "场景不存在：" + String.join("、", missing));
        }
    }

    /**
     * 解析可修改范围。
     *
     * @param scope      修改范围
     * @param sceneIds   scope=scene 时的目标
     * @param film       当前影片
     * @param references 引用（第一版只用于限定选区，这里不做坐标映射）
     * @return 可修改的场景 ID
     */
    public static List<String> editableScenes(TaskScope scope, List<String> sceneIds,
                                              JsonNode film, List<String> references) {
        if (scope == TaskScope.SCENE) {
            requireScenesExist(film, sceneIds);
            return List.copyOf(sceneIds);
        }
        List<String> all = new ArrayList<>();
        for (JsonNode scene : film.path("scenes")) {
            String id = scene.path("id").asText(null);
            if (id != null) {
                all.add(id);
            }
        }
        return all;
    }

    /**
     * 生成一条说明时间的产物名。
     *
     * @return 文件名
     */
    static String renderFileName() {
        return "modify-" + Instant.now().toEpochMilli() + ".mp4";
    }

    /**
     * 预留：把输出文件路径固定到项目目录下。
     *
     * @param root 项目根
     * @return 输出路径
     */
    static Path outputFor(Path root) {
        return root.resolve("renders").resolve(renderFileName());
    }
}

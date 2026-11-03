package com.fengmotion.server.task.service;

import java.util.List;
import java.util.Set;

import org.springframework.http.HttpStatus;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.task.domain.TaskKind;
import com.fengmotion.server.task.domain.TaskRequest;
import com.fengmotion.server.task.domain.TaskScope;

/**
 * 创建任务前的支持矩阵校验。
 *
 * <p>核心原则：<strong>不支持的东西必须在创建阶段报错，不能静默丢弃。</strong>
 * 静默丢弃有两种坏结果 —— 用户勾了「保持镜头」而系统其实没管，
 * 比直接告诉他「这个字段还没做」更糟；任务先入队再失败，则让用户白等。</p>
 *
 * <p>本类只做判定与报错，不改请求、不碰数据库。
 * 范围定义见 {@code docs/任务请求契约与修改执行流程.md} §3。</p>
 */
public final class TaskRequestGuard {

    private TaskRequestGuard() {
    }

    /**
     * 判断一次请求该走哪条执行路径。
     *
     * <p>判定规则（顺序敏感）：</p>
     * <ol>
     *   <li>有 {@code film.scenes} 且没有 {@code kind} 或 {@code kind=render}
     *       → {@link Route#RENDER}（兼容已验收的旧路径，形状不变）</li>
     *   <li>{@code kind=modify} → {@link Route#MODIFY}</li>
     *   <li>{@code kind} 存在但不受支持 → {@code 400 unsupported_task_kind}</li>
     *   <li>其余（既没有 film.scenes 也没有可识别的 kind）→ {@code validation_error}</li>
     * </ol>
     *
     * @param body 请求体
     * @return 执行路径
     * @throws ApiException 形状或类型不受支持
     */
    public static Route route(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "请求体必须是 JSON 对象");
        }
        JsonNode kindNode = body.get("kind");
        boolean hasKind = kindNode != null && !kindNode.isNull();

        JsonNode film = body.get("film");
        boolean hasScenes = film != null && film.hasNonNull("scenes")
                && film.path("scenes").isArray() && !film.path("scenes").isEmpty();

        if (!hasKind) {
            // 旧路径：只带 film.scenes。必须保持兼容 —— 这条链路已验收。
            if (hasScenes) {
                return Route.RENDER;
            }
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "请求体需要非空的 film.scenes 数组，或带 kind 的修改请求");
        }

        String wire = kindNode.asText("");
        TaskKind kind = TaskKind.fromWire(wire);
        if (kind == null || !kind.supported()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "unsupported_task_kind",
                    "不支持的任务类型：" + (wire.isBlank() ? "(空)" : wire)
                            + "；当前支持 render、modify");
        }
        if (kind == TaskKind.RENDER) {
            if (!hasScenes) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                        "kind=render 时请求体需要非空的 film.scenes 数组");
            }
            return Route.RENDER;
        }
        // MODIFY
        checkModifyBody(body);
        return Route.MODIFY;
    }

    /**
     * 校验 modify 请求的必填项与范围。
     *
     * @param body 请求体
     * @throws ApiException 不满足
     */
    private static void checkModifyBody(JsonNode body) {
        TaskScope scope = TaskScope.fromWire(body.path("scope").asText(null));
        if (scope == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "modify 请求需要 scope（project / scene / selection）");
        }
        if (!scope.supported()) {
            // 降级为报错而不是按 project 处理：否则用户以为只改了选区，实际改了全片
            throw new ApiException(HttpStatus.BAD_REQUEST, "unsupported_field",
                    "scope=selection 第一版不支持：选区到场景的映射尚未实现。请改用 scope=scene 或 scope=project");
        }
        if (scope == TaskScope.SCENE) {
            JsonNode ids = body.get("sceneIds");
            if (ids == null || !ids.isArray() || ids.isEmpty()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                        "scope=scene 时必须给出至少一个 sceneIds");
            }
        }
        JsonNode prompt = body.get("prompt");
        if (prompt == null || prompt.asText("").isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "modify 请求需要非空的 prompt");
        }
        /* film 现在只是「初次导入」的起点，不是每次都要带：
           项目一旦有当前场景，基线一律由服务端提供。
           因此这里不再强制要求，只做存在性校验（带了就必须合法）。 */
        JsonNode film = body.get("film");
        if (film != null && film.hasNonNull("scenes") && !film.path("scenes").isArray()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "film.scenes 必须是数组");
        }
        // sceneIds 指向的场景必须真实存在。这一项在创建阶段就能判定，
        // 不该让用户看到「已接受」再在后台失败。
        if (scope == TaskScope.SCENE && film != null && film.hasNonNull("scenes")) {
            List<String> missing = new java.util.ArrayList<>();
            for (JsonNode idNode : body.get("sceneIds")) {
                String id = idNode.asText(null);
                boolean found = false;
                for (JsonNode scene : film.path("scenes")) {
                    if (id != null && id.equals(scene.path("id").asText(null))) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    missing.add(String.valueOf(id));
                }
            }
            if (!missing.isEmpty()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "scene_not_found",
                        "基线里没有这些场景：" + String.join("、", missing));
            }
        }
    }

    /**
     * 校验请求体里的约束，返回需要告知用户的「未生效」项。
     *
     * <p>不抛异常 —— 这些约束不影响执行正确性，只是本版做不到。
     * 但它们必须以事件形式出现在任务里，不能静默。</p>
     *
     * @param body 请求体
     * @return 未生效约束名；没有时为空列表
     */
    public static List<String> unenforcedConstraints(JsonNode body) {
        if (body == null) {
            return List.of();
        }
        JsonNode node = body.get("constraints");
        if (node == null || !node.isObject()) {
            return List.of();
        }
        List<String> names = new java.util.ArrayList<>();
        for (String name : List.of("preserveCamera", "preserveCaptions", "reuseExistingComponents")) {
            if (node.path(name).asBoolean(false)) {
                names.add(name);
            }
        }
        return List.copyOf(names);
    }

    /**
     * 执行路径。
     */
    public enum Route {
        /** 直接渲染给定的 film.scenes。 */
        RENDER,
        /** 走修改执行流程。 */
        MODIFY
    }
}

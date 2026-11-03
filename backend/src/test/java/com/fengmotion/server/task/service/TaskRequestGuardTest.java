package com.fengmotion.server.task.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.task.service.TaskRequestGuard.Route;

/**
 * 创建阶段的支持矩阵校验。
 *
 * <p>要验的是「不支持的东西会不会被静默放过」——
 * 每一种不受支持的形状都必须抛错，且错误码稳定。</p>
 */
@DisplayName("任务请求分流与支持矩阵")
class TaskRequestGuardTest {

    private final ObjectMapper json = new ObjectMapper();

    private JsonNode body(String raw) {
        try {
            return json.readTree(raw);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** 一份最小可用的 film。 */
    private static final String FILM = """
            "film": {"width": 1280, "height": 720, "fps": 30,
                     "scenes": [{"id": "s1", "text": "你好", "durationSeconds": 3}]}
            """;

    @Test
    @DisplayName("无 kind 且带 film.scenes：走渲染，兼容已验收路径")
    void renderWithoutKind() {
        assertEquals(Route.RENDER, TaskRequestGuard.route(body("{" + FILM + "}")));
    }

    @Test
    @DisplayName("kind=render：走渲染")
    void renderWithKind() {
        assertEquals(Route.RENDER, TaskRequestGuard.route(body("{\"kind\":\"render\"," + FILM + "}")));
    }

    @Test
    @DisplayName("kind=modify 且 scope=project：走修改")
    void modifyProject() {
        JsonNode b = body("{\"kind\":\"modify\",\"prompt\":\"改成红色\",\"scope\":\"project\"," + FILM + "}");
        assertEquals(Route.MODIFY, TaskRequestGuard.route(b));
    }

    @Test
    @DisplayName("kind=modify 且 scope=scene 带 sceneIds：走修改")
    void modifyScene() {
        JsonNode b = body("{\"kind\":\"modify\",\"prompt\":\"改\",\"scope\":\"scene\","
                + "\"sceneIds\":[\"s1\"]," + FILM + "}");
        assertEquals(Route.MODIFY, TaskRequestGuard.route(b));
    }

    @Test
    @DisplayName("scope=selection 第一版报错，不静默按 project 处理")
    void selectionRejected() {
        JsonNode b = body("{\"kind\":\"modify\",\"prompt\":\"改\",\"scope\":\"selection\"," + FILM + "}");
        ApiException e = assertThrows(ApiException.class, () -> TaskRequestGuard.route(b));
        assertEquals("unsupported_field", e.getCode());
    }

    @Test
    @DisplayName("scope=scene 缺 sceneIds 报错")
    void sceneWithoutIds() {
        JsonNode b = body("{\"kind\":\"modify\",\"prompt\":\"改\",\"scope\":\"scene\"," + FILM + "}");
        ApiException e = assertThrows(ApiException.class, () -> TaskRequestGuard.route(b));
        assertEquals("validation_error", e.getCode());
    }

    @Test
    @DisplayName("modify 缺 prompt 报错")
    void modifyWithoutPrompt() {
        JsonNode b = body("{\"kind\":\"modify\",\"scope\":\"project\"," + FILM + "}");
        ApiException e = assertThrows(ApiException.class, () -> TaskRequestGuard.route(b));
        assertEquals("validation_error", e.getCode());
    }

    @Test
    @DisplayName("modify 缺基线 film 报错，不静默拿空场景跑")
    void modifyWithoutFilm() {
        JsonNode b = body("{\"kind\":\"modify\",\"prompt\":\"改\",\"scope\":\"project\"}");
        ApiException e = assertThrows(ApiException.class, () -> TaskRequestGuard.route(b));
        assertEquals("validation_error", e.getCode());
    }

    @Test
    @DisplayName("不支持的 kind 在创建阶段就报 unsupported_task_kind")
    void unsupportedKind() {
        for (String kind : List.of("check", "analyze", "restore", "nonsense")) {
            JsonNode b = body("{\"kind\":\"" + kind + "\"," + FILM + "}");
            ApiException e = assertThrows(ApiException.class, () -> TaskRequestGuard.route(b), kind);
            assertEquals("unsupported_task_kind", e.getCode(), kind);
        }
    }

    @Test
    @DisplayName("既无 kind 也无 film.scenes：validation_error")
    void emptyBody() {
        ApiException e = assertThrows(ApiException.class, () -> TaskRequestGuard.route(body("{\"prompt\":\"x\"}")));
        assertEquals("validation_error", e.getCode());
    }

    @Test
    @DisplayName("未生效约束被识别出来，不会静默")
    void unenforcedConstraints() {
        JsonNode b = body("{\"kind\":\"modify\",\"prompt\":\"改\",\"scope\":\"project\","
                + "\"constraints\":{\"preserveCamera\":true,\"preserveCaptions\":false,"
                + "\"reuseExistingComponents\":true}," + FILM + "}");
        assertEquals(List.of("preserveCamera", "reuseExistingComponents"),
                TaskRequestGuard.unenforcedConstraints(b));
    }

    @Test
    @DisplayName("没设置约束时不产生警告")
    void noConstraintsMeansNoWarning() {
        JsonNode b = body("{\"kind\":\"modify\",\"prompt\":\"改\",\"scope\":\"project\"," + FILM + "}");
        assertTrue(TaskRequestGuard.unenforcedConstraints(b).isEmpty());
    }

    @Test
    @DisplayName("能真正执行的约束不算未生效")
    void enforcedConstraintsAreNotWarned() {
        JsonNode b = body("{\"kind\":\"modify\",\"prompt\":\"改\",\"scope\":\"project\","
                + "\"constraints\":{\"limitToSelection\":true,\"preserveOutsideSelection\":true},"
                + FILM + "}");
        assertTrue(TaskRequestGuard.unenforcedConstraints(b).isEmpty());
    }
}

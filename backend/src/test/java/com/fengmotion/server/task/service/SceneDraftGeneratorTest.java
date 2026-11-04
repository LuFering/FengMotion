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
 * create 请求的受理校验与分镜校验。
 *
 * <p>创建出来的是项目的第一个版本，后续所有修改都基于它 ——
 * 起点错了后面全错。所以这里对「模型返回什么算合法」要求比修改更严：
 * 任何一项不合法都整份拒绝，不挑好的用。</p>
 */
@DisplayName("创建任务")
class SceneDraftGeneratorTest {

    private final ObjectMapper json = new ObjectMapper();
    private final SceneDraftGenerator generator = new SceneDraftGenerator(null, null, json);

    /**
     * 用反射调用私有 assemble，避免为测试放宽生产可见性。
     *
     * @param raw 模型输出的 JSON
     * @return 组装出的 film
     */
    private JsonNode assemble(String raw) {
        try {
            JsonNode draft = json.readTree(raw);
            var method = SceneDraftGenerator.class.getDeclaredMethod(
                    "assemble", JsonNode.class, int.class, int.class, int.class);
            method.setAccessible(true);
            return (JsonNode) method.invoke(generator, draft, 1280, 720, 30);
        } catch (java.lang.reflect.InvocationTargetException e) {
            if (e.getCause() instanceof RuntimeException runtime) throw runtime;
            throw new IllegalStateException(e.getCause());
        } catch (ReflectiveOperationException | java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /* ── 路由 ────────────────────────────────────────────── */

    @Test
    @DisplayName("kind=create 走 CREATE 路径，不需要 film")
    void routesCreateWithoutFilm() {
        JsonNode body = json.createObjectNode().put("kind", "create").put("prompt", "做一条咖啡店宣传");
        assertEquals(Route.CREATE, TaskRequestGuard.route(body));
    }

    @Test
    @DisplayName("create 缺少 prompt 时明确报错")
    void createRequiresPrompt() {
        JsonNode body = json.createObjectNode().put("kind", "create").put("prompt", "  ");
        ApiException e = assertThrows(ApiException.class, () -> TaskRequestGuard.route(body));
        assertEquals("validation_error", e.getCode());
    }

    @Test
    @DisplayName("create 带 film.scenes 时拒绝，而不是默默忽略")
    void createRejectsFilm() {
        var body = json.createObjectNode().put("kind", "create").put("prompt", "x");
        body.putObject("film").putArray("scenes").addObject().put("id", "s1");
        ApiException e = assertThrows(ApiException.class, () -> TaskRequestGuard.route(body));
        assertEquals("unsupported_field", e.getCode());
        assertTrue(e.getMessage().contains("kind=render"), "要指出该用哪个 kind：" + e.getMessage());
    }

    /* ── 分镜组装 ────────────────────────────────────────── */

    @Test
    @DisplayName("合法分镜被组装成 film，场景 id 由后端生成")
    void assemblesValidDraft() {
        JsonNode film = assemble("""
                {"title":"咖啡店","scenes":[
                  {"text":"早晨的第一杯","subtitle":"现磨手冲","color":"#ffffff","backgroundColor":"#1a1a2e","durationSeconds":3},
                  {"text":"欢迎光临","subtitle":"","color":"#ffe08a","backgroundColor":"#101010","durationSeconds":2.5}
                ]}
                """);

        assertEquals(1280, film.path("width").asInt());
        assertEquals(720, film.path("height").asInt());
        assertEquals(30, film.path("fps").asInt());
        JsonNode scenes = film.path("scenes");
        assertEquals(2, scenes.size());
        assertEquals("s1", scenes.get(0).path("id").asText());
        assertEquals("s2", scenes.get(1).path("id").asText());
        assertEquals("早晨的第一杯", scenes.get(0).path("text").asText());
        assertEquals(2.5, scenes.get(1).path("durationSeconds").asDouble(), 0.001);
    }

    @Test
    @DisplayName("模型给的额外字段被丢弃，只保留受支持的五个")
    void dropsUnknownFields() {
        JsonNode film = assemble("""
                {"scenes":[{"text":"标题","subtitle":"","color":"#ffffff","backgroundColor":"#000000",
                  "durationSeconds":3,"backgroundImage":"x.png","animation":"fade","transition":"wipe"}]}
                """);

        JsonNode scene = film.path("scenes").get(0);
        assertTrue(scene.path("backgroundImage").isMissingNode(), "不支持字段不能进 film");
        assertTrue(scene.path("animation").isMissingNode());
        assertTrue(scene.path("transition").isMissingNode());
        // 受支持的字段都在
        assertEquals("标题", scene.path("text").asText());
        assertEquals("#ffffff", scene.path("color").asText());
    }

    @Test
    @DisplayName("没有 scenes 时整份拒绝")
    void rejectsMissingScenes() {
        ApiException e = assertThrows(ApiException.class, () -> assemble("{\"title\":\"空\"}"));
        assertEquals("create_draft_invalid", e.getCode());
    }

    @Test
    @DisplayName("scenes 为空时整份拒绝")
    void rejectsEmptyScenes() {
        ApiException e = assertThrows(ApiException.class, () -> assemble("{\"scenes\":[]}"));
        assertEquals("create_draft_invalid", e.getCode());
    }

    @Test
    @DisplayName("超过场景数上限时整份拒绝")
    void rejectsTooManyScenes() {
        StringBuilder sb = new StringBuilder("{\"scenes\":[");
        for (int i = 0; i < SceneDraftGenerator.MAX_SCENES + 1; i++) {
            if (i > 0) sb.append(',');
            sb.append("{\"text\":\"T").append(i)
              .append("\",\"subtitle\":\"\",\"color\":\"#ffffff\",\"backgroundColor\":\"#000000\",\"durationSeconds\":2}");
        }
        sb.append("]}");

        ApiException e = assertThrows(ApiException.class, () -> assemble(sb.toString()));
        assertEquals("create_draft_invalid", e.getCode());
        assertTrue(e.getMessage().contains("超过上限"), e.getMessage());
    }

    @Test
    @DisplayName("缺主文字时整份拒绝")
    void rejectsBlankText() {
        ApiException e = assertThrows(ApiException.class, () -> assemble("""
                {"scenes":[{"text":"","subtitle":"x","color":"#ffffff","backgroundColor":"#000000","durationSeconds":2}]}
                """));
        assertEquals("create_draft_invalid", e.getCode());
        assertTrue(e.getMessage().contains("主文字"), e.getMessage());
    }

    @Test
    @DisplayName("颜色不是 #rrggbb 时整份拒绝")
    void rejectsBadColor() {
        ApiException e = assertThrows(ApiException.class, () -> assemble("""
                {"scenes":[{"text":"标题","subtitle":"","color":"white","backgroundColor":"#000000","durationSeconds":2}]}
                """));
        assertEquals("create_draft_invalid", e.getCode());
        assertTrue(e.getMessage().contains("color"), e.getMessage());
    }

    @Test
    @DisplayName("时长超出单场景范围时整份拒绝")
    void rejectsSceneDurationOutOfRange() {
        ApiException e = assertThrows(ApiException.class, () -> assemble("""
                {"scenes":[{"text":"标题","subtitle":"","color":"#ffffff","backgroundColor":"#000000","durationSeconds":99}]}
                """));
        assertEquals("create_draft_invalid", e.getCode());
        assertTrue(e.getMessage().contains("超出范围"), e.getMessage());
    }

    @Test
    @DisplayName("总时长超上限时整份拒绝")
    void rejectsTotalDurationTooLong() {
        StringBuilder sb = new StringBuilder("{\"scenes\":[");
        for (int i = 0; i < 6; i++) {
            if (i > 0) sb.append(',');
            sb.append("{\"text\":\"T").append(i)
              .append("\",\"subtitle\":\"\",\"color\":\"#ffffff\",\"backgroundColor\":\"#000000\",\"durationSeconds\":15}");
        }
        sb.append("]}");

        ApiException e = assertThrows(ApiException.class, () -> assemble(sb.toString()));
        assertEquals("create_draft_invalid", e.getCode());
        assertTrue(e.getMessage().contains("总时长"), e.getMessage());
    }

    @Test
    @DisplayName("一条不合法就整份拒绝，不挑好的用")
    void rejectsWholeDraftOnOneBadScene() {
        ApiException e = assertThrows(ApiException.class, () -> assemble("""
                {"scenes":[
                  {"text":"没问题","subtitle":"","color":"#ffffff","backgroundColor":"#000000","durationSeconds":2},
                  {"text":"颜色错了","subtitle":"","color":"rgb(0,0,0)","backgroundColor":"#000000","durationSeconds":2}
                ]}
                """));
        assertEquals("create_draft_invalid", e.getCode());
        assertTrue(e.getMessage().contains("第 2 个场景"), "要指出是哪一幕：" + e.getMessage());
    }

    @Test
    @DisplayName("缺 durationSeconds 时整份拒绝")
    void rejectsMissingDuration() {
        ApiException e = assertThrows(ApiException.class, () -> assemble("""
                {"scenes":[{"text":"标题","subtitle":"","color":"#ffffff","backgroundColor":"#000000"}]}
                """));
        assertEquals("create_draft_invalid", e.getCode());
    }

    @Test
    @DisplayName("六条视频字段以外的结构不构成 film：scenes 不是数组就拒绝")
    void rejectsNonArrayScenes() {
        ApiException e = assertThrows(ApiException.class, () -> assemble("{\"scenes\":\"none\"}"));
        assertEquals("create_draft_invalid", e.getCode());
    }

    @Test
    @DisplayName("受支持字段清单与修改白名单一致，创建出的场景后续可改")
    void createdFieldsAreEditable() {
        JsonNode film = assemble("""
                {"scenes":[{"text":"标题","subtitle":"副标题","color":"#ffffff","backgroundColor":"#000000","durationSeconds":3}]}
                """);
        List<String> keys = new java.util.ArrayList<>();
        film.path("scenes").get(0).fieldNames().forEachRemaining(keys::add);

        for (String key : keys) {
            if ("id".equals(key)) continue;
            assertTrue(ModifyPlanValidator.isAllowed(key),
                    "创建时能写的字段必须也在修改白名单里，否则用户下一步改不了：" + key);
        }
    }
}

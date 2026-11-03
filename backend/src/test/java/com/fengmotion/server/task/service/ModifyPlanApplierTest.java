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
import com.fengmotion.server.task.domain.TaskScope;

/**
 * 修改方案校验与应用。
 *
 * <p>要验的核心是「模型说了不算」：任何一条不合规的编辑都必须让整份方案被拒，
 * 而不是被跳过。所以这里的用例大多是「应当失败」的。</p>
 */
@DisplayName("修改方案校验")
class ModifyPlanApplierTest {

    private final ObjectMapper json = new ObjectMapper();
    private final ModifyPlanApplier applier = new ModifyPlanApplier(json);

    private JsonNode film(String... texts) {
        StringBuilder scenes = new StringBuilder("[");
        for (int i = 0; i < texts.length; i++) {
            if (i > 0) {
                scenes.append(',');
            }
            scenes.append("{\"id\":\"s").append(i + 1).append("\",\"text\":\"")
                    .append(texts[i]).append("\",\"durationSeconds\":3}");
        }
        scenes.append(']');
        try {
            return json.readTree("{\"width\":1280,\"height\":720,\"fps\":30,\"scenes\":" + scenes + "}");
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("合法方案被应用到指定场景")
    void appliesValidEdit() {
        JsonNode film = film("旧一", "旧二");
        ModifyPlan plan = new ModifyPlan(List.of(
                new ModifyPlan.Edit("s1", "text", "旧一", "新一", "测试")));

        JsonNode result = applier.apply(plan, film, List.of("s1", "s2"), List.of());

        assertEquals("新一", result.path("scenes").get(0).path("text").asText());
        // 原对象不被改动：失败时调用方手里的原片必须完好
        assertEquals("旧一", film.path("scenes").get(0).path("text").asText());
    }

    @Test
    @DisplayName("改不在可改范围内的场景：整份拒绝")
    void rejectsEditOutsideScope() {
        JsonNode film = film("旧一", "旧二");
        ModifyPlan plan = new ModifyPlan(List.of(
                new ModifyPlan.Edit("s2", "text", "旧二", "新二", "越界")));

        ApiException e = assertThrows(ApiException.class,
                () -> applier.apply(plan, film, List.of("s1"), List.of("s2")));
        assertEquals("modify_plan_invalid", e.getCode());
        assertTrue(e.getMessage().contains("不在可修改范围内"));
    }

    @Test
    @DisplayName("改白名单外字段：拒绝")
    void rejectsFieldOutsideWhitelist() {
        JsonNode film = film("旧一");
        ModifyPlan plan = new ModifyPlan(List.of(
                new ModifyPlan.Edit("s1", "backgroundImage", "", "http://x/a.png", "换图")));

        ApiException e = assertThrows(ApiException.class,
                () -> applier.apply(plan, film, List.of("s1"), List.of()));
        assertEquals("modify_plan_invalid", e.getCode());
        assertTrue(e.getMessage().contains("第一版不可修改"));
    }

    @Test
    @DisplayName("from 与当前值不一致：拒绝，防止基于过时认知改错地方")
    void rejectsStaleFrom() {
        JsonNode film = film("实际值");
        ModifyPlan plan = new ModifyPlan(List.of(
                new ModifyPlan.Edit("s1", "text", "模型以为的值", "新值", "测试")));

        ApiException e = assertThrows(ApiException.class,
                () -> applier.apply(plan, film, List.of("s1"), List.of()));
        assertEquals("modify_plan_invalid", e.getCode());
        assertTrue(e.getMessage().contains("不一致"));
    }

    @Test
    @DisplayName("一条坏编辑就整份拒绝，不做「跳过坏的用好的」")
    void oneBadEditRejectsWholePlan() {
        JsonNode film = film("旧一", "旧二");
        ModifyPlan plan = new ModifyPlan(List.of(
                new ModifyPlan.Edit("s1", "text", "旧一", "新一", "好的"),
                new ModifyPlan.Edit("s2", "text", "错的", "新二", "坏的")));

        assertThrows(ApiException.class,
                () -> applier.apply(plan, film, List.of("s1", "s2"), List.of()));
        // 整份拒绝意味着一条都不写
        assertEquals("旧一", film.path("scenes").get(0).path("text").asText());
    }

    @Test
    @DisplayName("空方案被拒绝：模型什么都没给不算成功")
    void rejectsEmptyPlan() {
        JsonNode film = film("旧一");
        ApiException e = assertThrows(ApiException.class,
                () -> applier.apply(new ModifyPlan(List.of()), film, List.of("s1"), List.of()));
        assertEquals("modify_plan_invalid", e.getCode());
    }

    @Test
    @DisplayName("durationSeconds 按数字写入")
    void durationIsNumeric() {
        JsonNode film = film("旧一");
        ModifyPlan plan = new ModifyPlan(List.of(
                new ModifyPlan.Edit("s1", "durationSeconds", "3", "5", "加长")));

        JsonNode result = applier.apply(plan, film, List.of("s1"), List.of());
        assertTrue(result.path("scenes").get(0).path("durationSeconds").isNumber());
        assertEquals(5.0, result.path("scenes").get(0).path("durationSeconds").asDouble());
    }

    @Test
    @DisplayName("scope=scene 时只有指定场景可改，其余被保留")
    void sceneScopeLimitsEditable() {
        JsonNode film = film("一", "二", "三");
        List<String> editable = ModifyPlanApplier.editableScenes(
                TaskScope.SCENE, List.of("s2"), film, List.of());

        assertEquals(List.of("s2"), editable);
        assertEquals(List.of("s1", "s3"), ModifyPlanApplier.preservedScenes(film, editable));
    }

    @Test
    @DisplayName("scope=project 时全部场景可改")
    void projectScopeAllowsAll() {
        JsonNode film = film("一", "二");
        List<String> editable = ModifyPlanApplier.editableScenes(
                TaskScope.PROJECT, List.of(), film, List.of());

        assertEquals(List.of("s1", "s2"), editable);
        assertTrue(ModifyPlanApplier.preservedScenes(film, editable).isEmpty());
    }

    @Test
    @DisplayName("指向不存在的场景：scene_not_found")
    void unknownSceneId() {
        JsonNode film = film("一");
        ApiException e = assertThrows(ApiException.class,
                () -> ModifyPlanApplier.editableScenes(TaskScope.SCENE, List.of("s9"), film, List.of()));
        assertEquals("scene_not_found", e.getCode());
    }
}

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

/**
 * 第一版方案生成器（确定性规则代替模型）。
 *
 * <p>要验的是「解析不出要求时必须报错」—— 瞎猜一个值写进用户片子，
 * 比明确说「我没听懂」糟得多。</p>
 */
@DisplayName("修改方案生成")
class MockModifyExecutorTest {

    private final ObjectMapper json = new ObjectMapper();
    private final MockModifyExecutor generator = new MockModifyExecutor();

    private JsonNode film(String text, String color) {
        try {
            return json.readTree("{\"width\":1280,\"height\":720,\"fps\":30,\"scenes\":["
                    + "{\"id\":\"s1\",\"text\":\"" + text + "\",\"color\":\"" + color
                    + "\",\"durationSeconds\":3}]}");
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("「把文字改成 X」解析为改 text")
    void parsesTextChange() {
        ModifyPlan plan = generator.generate("把文字改成 你好世界", film("旧字幕", "#fff"), List.of("s1"));

        assertEquals(1, plan.edits().size());
        assertEquals("text", plan.edits().get(0).field());
        assertEquals("旧字幕", plan.edits().get(0).from());
        assertEquals("你好世界", plan.edits().get(0).to());
    }

    @Test
    @DisplayName("「文字颜色改成 X」解析为改 color")
    void parsesColorChange() {
        ModifyPlan plan = generator.generate("文字颜色改成 #ff0000", film("旧", "#fff"), List.of("s1"));

        assertEquals("color", plan.edits().get(0).field());
        assertEquals("#ff0000", plan.edits().get(0).to());
    }

    @Test
    @DisplayName("「背景颜色改成 X」解析为改 backgroundColor")
    void parsesBackgroundColor() {
        ModifyPlan plan = generator.generate("背景颜色改成 #000000", film("旧", "#fff"), List.of("s1"));

        assertEquals("backgroundColor", plan.edits().get(0).field());
    }

    @Test
    @DisplayName("收尾标点不写进字幕")
    void stripsTrailingPunctuation() {
        ModifyPlan plan = generator.generate("把文字改成 新字幕。", film("旧", "#fff"), List.of("s1"));

        assertEquals("新字幕", plan.edits().get(0).to());
    }

    @Test
    @DisplayName("解析不出目标值时明确报错，不瞎猜")
    void rejectsUnparseablePrompt() {
        ApiException e = assertThrows(ApiException.class,
                () -> generator.generate("让这条片子更有感染力", film("旧", "#fff"), List.of("s1")));
        assertEquals("modify_plan_invalid", e.getCode());
    }

    @Test
    @DisplayName("空要求报错")
    void rejectsBlankPrompt() {
        ApiException e = assertThrows(ApiException.class,
                () -> generator.generate("  ", film("旧", "#fff"), List.of("s1")));
        assertEquals("validation_error", e.getCode());
    }

    @Test
    @DisplayName("没有可改场景时报错")
    void rejectsNoEditableScenes() {
        ApiException e = assertThrows(ApiException.class,
                () -> generator.generate("把文字改成 X", film("旧", "#fff"), List.of()));
        assertEquals("validation_error", e.getCode());
    }

    @Test
    @DisplayName("多个可改场景时每个都生成一条编辑")
    void generatesForEveryEditableScene() {
        try {
            JsonNode two = json.readTree("{\"scenes\":["
                    + "{\"id\":\"s1\",\"text\":\"一\"},{\"id\":\"s2\",\"text\":\"二\"}]}");
            ModifyPlan plan = generator.generate("把文字改成 新", two, List.of("s1", "s2"));
            assertEquals(2, plan.edits().size());
            assertTrue(plan.edits().stream().anyMatch(e -> "s1".equals(e.sceneId())));
            assertTrue(plan.edits().stream().anyMatch(e -> "s2".equals(e.sceneId())));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}

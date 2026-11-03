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
 * 模型输出的解析。
 *
 * <p>不启动真实模型：这里要验的是「拿到一段文本之后，什么算合法方案」。
 * 模型不可控，解析层必须足够严格 —— 宁可明确失败，也不要凑一个方案出来。</p>
 *
 * <p>用反射调用私有 parse，避免为了测试把它改成 public 而污染生产接口。</p>
 */
@DisplayName("模型方案解析")
class ModelModifyPlannerParseTest {

    private final ObjectMapper json = new ObjectMapper();
    private final ModelModifyPlanner planner = new ModelModifyPlanner(null, null, json);

    private ModifyPlan parse(String raw) {
        try {
            var method = ModelModifyPlanner.class.getDeclaredMethod("parse", String.class, List.class);
            method.setAccessible(true);
            return (ModifyPlan) method.invoke(planner, raw, List.of("s1"));
        } catch (java.lang.reflect.InvocationTargetException e) {
            if (e.getCause() instanceof RuntimeException runtime) throw runtime;
            throw new IllegalStateException(e.getCause());
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("标准 JSON 被解析成编辑条目")
    void parsesPlainJson() {
        ModifyPlan plan = parse("""
                {"edits":[{"sceneId":"s1","field":"text","from":"旧","to":"新","reason":"按要求"}]}
                """);

        assertEquals(1, plan.edits().size());
        ModifyPlan.Edit edit = plan.edits().get(0);
        assertEquals("s1", edit.sceneId());
        assertEquals("text", edit.field());
        assertEquals("旧", edit.from());
        assertEquals("新", edit.to());
    }

    @Test
    @DisplayName("包在 ```json 代码块里也能解析")
    void parsesFencedJson() {
        ModifyPlan plan = parse("""
                好的，方案如下：
                ```json
                {"edits":[{"sceneId":"s1","field":"color","from":"#fff","to":"#f00","reason":"改色"}]}
                ```
                以上。
                """);

        assertEquals(1, plan.edits().size());
        assertEquals("color", plan.edits().get(0).field());
    }

    @Test
    @DisplayName("白名单外字段被丢弃而不是整份失败")
    void dropsUnsupportedFields() {
        ModifyPlan plan = parse("""
                {"edits":[
                  {"sceneId":"s1","field":"text","from":"a","to":"b","reason":"改字"},
                  {"sceneId":"s1","field":"backgroundImage","from":"","to":"x.png","reason":"换图"}
                ]}
                """);

        assertEquals(1, plan.edits().size(), "只保留白名单内的字段");
        assertEquals("text", plan.edits().get(0).field());
    }

    @Test
    @DisplayName("没有任何合法编辑时明确失败，不返回空方案")
    void rejectsWhenNoLegalEdits() {
        ApiException e = assertThrows(ApiException.class, () -> parse("""
                {"edits":[{"sceneId":"s1","field":"transition","from":"cut","to":"fade","reason":"x"}]}
                """));
        assertEquals("modify_plan_invalid", e.getCode());
        assertTrue(e.getMessage().contains("文字与颜色"));
    }

    @Test
    @DisplayName("模型说「不需要改」时明确失败，而不是当作成功")
    void rejectsEmptyEdits() {
        ApiException e = assertThrows(ApiException.class, () -> parse("{\"edits\":[]}"));
        assertEquals("modify_plan_invalid", e.getCode());
    }

    @Test
    @DisplayName("没有 JSON 时明确失败")
    void rejectsNoJson() {
        ApiException e = assertThrows(ApiException.class, () -> parse("我觉得这条片子需要更明亮一些。"));
        assertEquals("modify_plan_invalid", e.getCode());
    }

    @Test
    @DisplayName("JSON 结构不对（缺少 edits 数组）时明确失败")
    void rejectsWrongShape() {
        ApiException e = assertThrows(ApiException.class, () -> parse("{\"edits\":\"none\"}"));
        assertEquals("modify_plan_invalid", e.getCode());
    }

    @Test
    @DisplayName("非法 JSON 时明确失败")
    void rejectsMalformedJson() {
        ApiException e = assertThrows(ApiException.class, () -> parse("{edits: ["));
        assertEquals("modify_plan_invalid", e.getCode());
    }

}

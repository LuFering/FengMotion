package com.fengmotion.server.task.service;

import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.task.domain.TaskScope;

/**
 * 修改方案生成器：第一版用确定性规则代替模型。
 *
 * <p><strong>为什么先接 Mock</strong>：这一版要验证的是「链路能不能串起来」——
 * 解析范围、读基线、校验方案、应用、交给渲染器。如果同时接真实模型，
 * 一旦链路有问题就无法区分「契约设计错了」还是「模型输出不稳」。
 * 先把变量减少到一个。</p>
 *
 * <p>它认两种要求，其余一律明确报错而不是瞎猜：</p>
 * <ul>
 *   <li>「把文字改成 X」/「文本改成 X」 → 改 {@code text}</li>
 *   <li>「文字颜色改成 X」/「改成 X 色」 → 改 {@code color}</li>
 * </ul>
 *
 * <p>第一版不调用模型，因此也不会「读懂」复杂要求。这是刻意的：
 * {@code generate} 的接口与测试已经按真实模型设计，换成真实实现时
 * 调用方不用改。</p>
 */
@Component
public class MockModifyExecutor {

    /**
     * 根据要求生成方案。
     *
     * @param prompt     用户原话
     * @param film       当前场景基线
     * @param editable   可修改的场景
     * @return 修改方案
     * @throws com.fengmotion.server.common.ApiException 要求无法解析
     */
    public ModifyPlan generate(String prompt, JsonNode film, List<String> editable) {
        if (prompt == null || prompt.isBlank()) {
            throw new com.fengmotion.server.common.ApiException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, "validation_error",
                    "修改要求是空的");
        }
        if (editable.isEmpty()) {
            throw new com.fengmotion.server.common.ApiException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, "validation_error",
                    "没有可修改的场景");
        }

        String field = pickField(prompt);
        String value = pickValue(prompt, field);
        if (value == null) {
            throw new com.fengmotion.server.common.ApiException(
                    org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY, "modify_plan_invalid",
                    "本版只能理解「把文字改成…」「文字颜色改成…」这类要求；"
                            + "没从要求里解析出要改成什么");
        }

        List<ModifyPlan.Edit> edits = new ArrayList<>();
        for (String sceneId : editable) {
            JsonNode scene = findScene(film, sceneId);
            if (scene == null) {
                continue;
            }
            String current = scene.path(field).asText("");
            edits.add(new ModifyPlan.Edit(sceneId, field, current, value,
                    "按用户要求把 " + field + " 改为「" + value + "」"));
        }
        return new ModifyPlan(edits);
    }

    /**
     * 判断要改哪个字段。
     *
     * @param prompt 要求
     * @return 字段名
     */
    private String pickField(String prompt) {
        if (prompt.contains("颜色") || prompt.contains("color")) {
            return prompt.contains("背景") ? "backgroundColor" : "color";
        }
        return "text";
    }

    /**
     * 从要求里取出目标值。
     *
     * @param prompt 要求
     * @param field  字段
     * @return 目标值；解析不出时为 null
     */
    private String pickValue(String prompt, String field) {
        String[] anchors = {"改成", "改为", "换成", "换为", "变成"};
        for (String anchor : anchors) {
            int at = prompt.indexOf(anchor);
            if (at >= 0) {
                String value = prompt.substring(at + anchor.length()).trim();
                // 去掉常见的收尾标点，避免把句号写进字幕
                value = value.replaceAll("[。．.！!？?]+$", "").trim();
                if (!value.isEmpty()) {
                    return value;
                }
            }
        }
        return null;
    }

    /**
     * 按 id 找场景。
     *
     * @param film    影片
     * @param sceneId 场景 ID
     * @return 场景；找不到时为 null
     */
    private JsonNode findScene(JsonNode film, String sceneId) {
        for (JsonNode scene : film.path("scenes")) {
            if (sceneId.equals(scene.path("id").asText(null))) {
                return scene;
            }
        }
        return null;
    }
}

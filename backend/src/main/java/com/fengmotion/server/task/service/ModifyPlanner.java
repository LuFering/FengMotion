package com.fengmotion.server.task.service;

import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 修改方案生成器：把用户要求翻成可校验的编辑指令。
 *
 * <p>抽成接口是因为这里正好是「能力边界」所在：
 * 规则式实现只认几种固定说法，模型实现能理解更自由的要求。
 * 上层的解析、校验、应用、渲染完全一样，换实现不该动它们。</p>
 *
 * <p><strong>实现者必须遵守</strong>：只返回方案，不要自己改动 {@code film}，
 * 也不要直接落盘。应用与否由 {@link ModifyPlanApplier} 统一判定 ——
 * 生成器一旦能改数据，「校验通过才生效」这条保证就破了。</p>
 */
public interface ModifyPlanner {

    /**
     * 生成修改方案。
     *
     * @param prompt   用户原话
     * @param film     当前场景（只读，不得修改）
     * @param editable 允许修改的场景 ID
     * @return 修改方案
     * @throws com.fengmotion.server.common.ApiException 无法生成合法方案时抛出，
     *         消息会原样展示给用户
     */
    ModifyPlan plan(String prompt, JsonNode film, List<String> editable);

    /**
     * 本实现的名称，用于日志与界面提示。
     *
     * @return 如 {@code rule} / {@code model}
     */
    String name();
}

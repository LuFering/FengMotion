package com.fengmotion.server.task.service;

import java.util.List;

/**
 * 修改方案：AI 产出的、可校验的中间产物。
 *
 * <p>为什么不让模型直接产出整份 {@code film.scenes}：那样出错时无法判断
 * 它多改了哪里，也就无法保证「只改选区内」「不改其它场景」这类约束。
 * 方案是一串逐条的编辑指令，每一条都能检查、能展示、能整条拒绝。</p>
 *
 * <p>详见 {@code docs/任务请求契约与修改执行流程.md} §4 ③④。</p>
 *
 * @param edits 编辑指令
 */
public record ModifyPlan(List<Edit> edits) {

    /**
     * 一条编辑指令。
     *
     * @param sceneId 要改的场景
     * @param field   要改的字段，必须在 {@link ModifyPlanValidator#ALLOWED_FIELDS} 内
     * @param from    模型认为的当前值；应用前要与实际值比对，不一致就整条拒绝
     *                （防止模型基于过时认知改错地方）
     * @param to      改成的值
     * @param reason  一句话说明为什么这样改，展示给用户
     */
    public record Edit(String sceneId, String field, String from, String to, String reason) {
    }
}

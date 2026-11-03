package com.fengmotion.server.task.service;

/**
 * 修改方案校验器的第一版范围声明。
 *
 * <p>这里只放<strong>范围常量</strong>，不放校验逻辑 —— 本步只定接口与范围，
 * 逻辑留到实施第 4 步。写在这里是为了让「第一版能改什么」成为可被代码检查的事实，
 * 而不是只写在文档里的一句话。</p>
 *
 * <p>范围来源：{@code docs/任务请求契约与修改执行流程.md} §6。</p>
 */
public final class ModifyPlanValidator {

    private ModifyPlanValidator() {
    }

    /**
     * 第一版允许修改的字段（{@link ModifyPlan.Edit#field()} 的白名单）。
     *
     * <p>刻意不放 {@code backgroundImage}、动画、转场、增删场景：
     * 这些改动会影响其它场景或需要重新排布时间轴，
     * 第一版保证不了「只改选区内」，所以不接收。</p>
     */
    public static final java.util.Set<String> ALLOWED_FIELDS = java.util.Set.of(
            "text",
            "subtitle",
            "color",
            "backgroundColor",
            "durationSeconds");

    /**
     * 明确不支持的字段：收到就报 {@code unsupported_field}，不静默忽略。
     */
    public static final java.util.Set<String> REJECTED_FIELDS = java.util.Set.of(
            "backgroundImage",
            "textAnimation",
            "transition",
            "id");

    /**
     * 是否可改。
     *
     * @param field 字段名
     * @return 在允许集合内为 true
     */
    public static boolean isAllowed(String field) {
        return field != null && ALLOWED_FIELDS.contains(field);
    }
}

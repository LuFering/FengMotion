package com.fengmotion.server.task.domain;

/**
 * 修改范围。
 *
 * <p>它描述「改到多大一片」，不是渲染参数。第一版支持情况见
 * {@code docs/任务请求契约与修改执行流程.md} §6：</p>
 *
 * <ul>
 *   <li>{@link #PROJECT}、{@link #SCENE}：支持</li>
 *   <li>{@link #SELECTION}：<strong>第一版报错降级</strong>。选区需要
 *       「画面坐标 → 场景」的映射表，当前不存在。降级为报错而不是
 *       静默按 PROJECT 处理 —— 后者会让用户以为只改了选区，实际改了全片。</li>
 * </ul>
 */
public enum TaskScope {

    /** 全片。 */
    PROJECT("project"),

    /** 指定场景。 */
    SCENE("scene"),

    /** 画面选区。第一版不支持，创建时拒绝。 */
    SELECTION("selection");

    private final String wireName;

    TaskScope(String wireName) {
        this.wireName = wireName;
    }

    /**
     * 契约上的字符串值。
     *
     * @return 如 {@code "project"}
     */
    public String wireName() {
        return wireName;
    }

    /**
     * 第一版是否可用。
     *
     * @return SELECTION 为 false
     */
    public boolean supported() {
        return this != SELECTION;
    }

    /**
     * 解析契约字符串。
     *
     * @param wire 契约值，可为 null
     * @return 对应枚举；无法识别时为 null
     */
    public static TaskScope fromWire(String wire) {
        if (wire == null) {
            return null;
        }
        for (TaskScope scope : values()) {
            if (scope.wireName.equals(wire)) {
                return scope;
            }
        }
        return null;
    }
}

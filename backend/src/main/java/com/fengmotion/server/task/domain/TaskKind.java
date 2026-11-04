package com.fengmotion.server.task.domain;

/**
 * 任务类型。
 *
 * <p>枚举在这里的作用不是「允许任意类型」，而是让**支持矩阵**能写成代码：
 * {@link #supported()} 明确哪些类型第一版真的实现了。
 * 不支持的类型必须在创建阶段报错，不能先入队再失败 ——
 * 否则用户会看到一条「已接受」然后无意义地等。</p>
 */
public enum TaskKind {

    /** 按给定的 scene 数据出片。已接通并验收。 */
    RENDER("render"),

    /** 按用户的修改意图改动现有场景后再出片。第一版部分支持。 */
    MODIFY("modify"),

    /**
     * 从一句自然语言需求生成初始视频场景并出片。
     *
     * <p>与 {@link #MODIFY} 的区别是「有没有基线」：修改需要已有场景并做版本预检，
     * 创建是从零生成，产物是项目的第一个版本。两者的模型提示与校验规则完全不同，
     * 所以必须是两种任务，不能用一个 kind 加分支糊过去。</p>
     */
    CREATE("create"),

    /** 检查产物质量。未实现。 */
    CHECK("check"),

    /** 解析参考片。未实现。 */
    ANALYZE("analyze"),

    /** 回退到历史版本。未实现。 */
    RESTORE("restore");

    private final String wireName;

    TaskKind(String wireName) {
        this.wireName = wireName;
    }

    /**
     * 契约上的字符串值。
     *
     * @return 如 {@code "render"}
     */
    public String wireName() {
        return wireName;
    }

    /**
     * 第一版是否真的实现了。
     *
     * @return render/modify/create 为 true，其余为 false
     */
    public boolean supported() {
        return this == RENDER || this == MODIFY || this == CREATE;
    }

    /**
     * 解析契约字符串。
     *
     * <p>认不出就返回 null 交给调用方报 {@code unsupported_task_kind}，
     * 而不是抛异常或默认成 render —— 猜错种类会执行错的东西。</p>
     *
     * @param wire 契约值，可为 null
     * @return 对应枚举；无法识别时为 null
     */
    public static TaskKind fromWire(String wire) {
        if (wire == null) {
            return null;
        }
        for (TaskKind kind : values()) {
            if (kind.wireName.equals(wire)) {
                return kind;
            }
        }
        return null;
    }
}

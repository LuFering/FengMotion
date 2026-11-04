package com.fengmotion.server.reference.domain;

/**
 * 单维分析值（契约 library.md §4.2.3）。
 *
 * <p><strong>这个类型的意义在于「不许撒谎」</strong>：</p>
 * <ul>
 *   <li>{@code pending=true} 表示这一维**还没解析**。此时 {@code value} 必须是空串，
 *       不能填「无」「未知」或者默认值 —— 一旦填了，界面就无法区分
 *       「解析了，结论是无」和「根本没解析」。</li>
 *   <li>{@code source} 记录结论从哪来。把 {@code MODEL} 显示成实测事实，
 *       用户会据此做错误的创作判断。</li>
 *   <li>{@code evidence} 只在真的有时才写。没有依据就留空，
 *       不要编「关键帧 00:02」这种看起来专业但无出处的佐证。</li>
 * </ul>
 *
 * @param value      结论；{@code pending} 时必须为空串
 * @param source     来源；{@code pending} 时为 null
 * @param confidence 0–1；无置信度时 null（不用 0 冒充「不确定」）
 * @param evidence   可追溯依据（时间范围、帧号、人工标注原文）；没有就空串
 * @param pending    是否尚未解析
 */
public record AnalysisValue(
        String value,
        ReferenceStates.AnalysisSource source,
        Double confidence,
        String evidence,
        boolean pending) {

    /** 未解析的占位值。**所有维度初始都是这个**，不是空对象。 */
    public static AnalysisValue unparsed() {
        return new AnalysisValue("", null, null, "", true);
    }

    /**
     * 构造一个已解析的值。
     *
     * <p>会校验「已解析必须有 value」：解析完了却什么都不说，等于没解析，
     * 那种情况应该用 {@link #unparsed()}。</p>
     */
    public static AnalysisValue parsed(String value, ReferenceStates.AnalysisSource source,
            Double confidence, String evidence) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("已解析的分析值必须有内容；没有结论请用 unparsed()");
        }
        if (source == null) {
            throw new IllegalArgumentException("已解析的分析值必须标注来源");
        }
        return new AnalysisValue(value, source, confidence, evidence == null ? "" : evidence, false);
    }

    /** 是否符合「pending 时不带内容」的约束。 */
    public boolean isConsistent() {
        if (pending) {
            return (value == null || value.isEmpty()) && source == null;
        }
        return value != null && !value.isBlank() && source != null;
    }
}

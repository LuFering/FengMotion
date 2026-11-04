package com.fengmotion.server.reference.api.dto;

import java.util.List;
import java.util.Map;

/**
 * 片段响应（契约 library.md §4.2）。
 *
 * <p>三个字段必须**分开**返回，不能合成一段文字：
 * {@code observation}（看得到的）/ {@code inference}（模型推断）/ {@code suggestion}（怎么用）。
 * 合并之后界面无法按契约要求分区块呈现，用户会把推断当事实。</p>
 */
public record ReferenceSegmentResponse(
        String id,
        String videoId,
        int index,
        long startMs,
        long endMs,
        long durationMs,
        String status,
        List<String> tags,
        String observation,
        String inference,
        String suggestion,
        Map<String, AnalysisValueResponse> analysis,
        Map<String, AnalysisValueResponse> extraAnalysis,
        String createdAt,
        String updatedAt) {

    /**
     * 单维分析值。
     *
     * @param value      结论；{@code pending=true} 时为空串
     * @param source     来源 measured / model / user；{@code pending} 时为 null
     * @param confidence 0–1；无置信度时为 null
     * @param evidence   可追溯依据；没有则为空串
     * @param pending    是否尚未解析
     */
    public record AnalysisValueResponse(
            String value,
            String source,
            Double confidence,
            String evidence,
            boolean pending) {
    }
}

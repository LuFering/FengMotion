package com.fengmotion.server.reference.domain;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * 参考片段（契约 library.md §4.2）。
 *
 * <p>一段连续时间范围 + 对它的观察与分析。{@code observation} 与 {@code inference}
 * 是两个独立字段，**不能合并**：前者只写看得到的，后者是模型推断。
 * 合并之后界面就无法按契约要求分区块呈现，用户会把推断当事实。</p>
 *
 * @param id            稳定 ID
 * @param videoId       所属参考片
 * @param index         在片内的序号（从 0 开始）
 * @param startMs       起始毫秒
 * @param endMs         结束毫秒
 * @param status        该段解析状态
 * @param tags          标签
 * @param observation   观察事实（只写看得到的）
 * @param inference     模型推断（必须与观察分开呈现）
 * @param suggestion    对当前创作的具体用法建议
 * @param analysis      界面默认展示的六维
 * @param extraAnalysis 后端可额外保存、界面默认不展示的技术维度
 * @param createdAt     创建时间
 * @param updatedAt     更新时间
 */
public record ReferenceSegment(
        String id,
        String videoId,
        int index,
        long startMs,
        long endMs,
        ReferenceStates.Status status,
        List<String> tags,
        String observation,
        String inference,
        String suggestion,
        Map<ReferenceStates.AnalysisKey, AnalysisValue> analysis,
        Map<String, AnalysisValue> extraAnalysis,
        Instant createdAt,
        Instant updatedAt) {

    /**
     * 构造一个「还没解析」的片段：六个维度全部 pending，观察/推断/建议都为空。
     *
     * <p>为什么要有这个工厂：新切出来的片段不该带着任何结论。
     * 如果图省事填「无」，界面就无法区分「分析过，没有可借鉴的」和「还没分析」。</p>
     */
    public static ReferenceSegment unparsed(String id, String videoId, int index, long startMs, long endMs,
            List<String> tags) {
        Instant now = Instant.now();
        Map<ReferenceStates.AnalysisKey, AnalysisValue> emptyAnalysis = new java.util.LinkedHashMap<>();
        for (ReferenceStates.AnalysisKey key : ReferenceStates.AnalysisKey.ordered()) {
            emptyAnalysis.put(key, AnalysisValue.unparsed());
        }
        return new ReferenceSegment(id, videoId, index, startMs, endMs, ReferenceStates.Status.PENDING,
                tags == null ? List.of() : tags, "", "", "", emptyAnalysis, Map.of(), now, now);
    }

    /** 时间范围是否合法：起点小于终点，且都不为负。 */
    public boolean hasValidRange() {
        return startMs >= 0 && endMs > startMs;
    }

    /** 时长（毫秒）。 */
    public long durationMs() {
        return endMs - startMs;
    }
}

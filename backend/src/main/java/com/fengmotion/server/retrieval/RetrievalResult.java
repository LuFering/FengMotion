package com.fengmotion.server.retrieval;

import java.util.List;

/**
 * 一次检索的完整结果：<strong>状态、查询、命中</strong>必须一起传出去。
 *
 * <p><strong>为什么不能只返回 List</strong>：空列表至少有三种完全不同的含义 ——
 * 「服务调用失败」「索引还没建好」「检索成功但确实没有相近的内容」。
 * 只返回空列表，这三件事在下游就无法区分，调用方只能猜；
 * 猜成「已检索，无匹配」就等于对 agent 谎报了一件没发生的事。</p>
 *
 * @param status 本次检索的状态
 * @param query  实际用于检索的查询文本
 * @param kinds  检索范围；空表示全部
 * @param hits   命中条目；非 SUCCESS 时必为空
 */
public record RetrievalResult(Status status, String query, List<String> kinds, List<SemanticIndex.Hit> hits) {

    /**
     * 检索状态。
     *
     * <p>各种状态互斥，且都有各自的处置方式，不能合并：</p>
     */
    public enum Status {

        /** 语义检索成功，且有命中。 */
        SUCCESS_WITH_HITS,

        /** 语义检索成功，但没有相近内容 —— 这才是「查过，确实没有」。 */
        SUCCESS_NO_MATCH,

        /** 索引为空或尚未建立：系统还没准备好，不是「没有匹配」。 */
        INDEX_NOT_READY,

        /**
         * 语义检索不可用，改用索引原文做字面匹配，且有命中。
         *
         * <p>为什么单列、而不是并进 SERVICE_FAILED 或算作成功：索引里存着当初写入的
         * 原文，向量服务不可用时这些原文仍能按字面搜到。说成「失败」用户会以为整个
         * 检索坏了；说成「成功」用户又会把字面命中当成语义命中。
         * 两者都会误导，所以单独一个状态：<strong>结果可用，但能力已降级</strong>。</p>
         */
        DEGRADED_LITERAL_WITH_HITS,

        /**
         * 语义检索不可用，字面兜底也跑过了，但没有命中。
         *
         * <p>与 {@link #SERVICE_FAILED} 的区别在处置方式：这个状态表示两种检索都试过，
         * 应对办法是换关键词或补内容；SERVICE_FAILED 表示连字面都没查成。</p>
         */
        DEGRADED_LITERAL_NO_MATCH,

        /** 调不通 embedding 服务，且没有可用的字面兜底（索引为空或查询为空）。 */
        SERVICE_FAILED
    }

    /**
     * 是否成功执行了「语义」检索（无论有无命中）。
     *
     * <p>降级状态不算语义成功：调用方据此判断能不能把结果称为「语义匹配」。</p>
     *
     * @return 语义检索真的跑通了返回 true
     */
    public boolean succeeded() {
        return status == Status.SUCCESS_WITH_HITS || status == Status.SUCCESS_NO_MATCH;
    }

    /**
     * 是否给出了可用结果（语义或字面）。
     *
     * <p>界面用这个决定要不要渲染列表：降级命中同样应该展示，
     * 只是必须同时标出「字面匹配，非语义」。</p>
     *
     * @return 有可展示的结果返回 true
     */
    public boolean usable() {
        return status == Status.SUCCESS_WITH_HITS || status == Status.DEGRADED_LITERAL_WITH_HITS;
    }

    /**
     * 结果是否为降级（字面匹配）产出。
     *
     * @return 降级返回 true
     */
    public boolean degraded() {
        return status == Status.DEGRADED_LITERAL_WITH_HITS
                || status == Status.DEGRADED_LITERAL_NO_MATCH;
    }

    /**
     * 空结果。
     *
     * @param status 失败原因
     * @param query  查询文本
     * @param kinds  检索范围
     * @return 无命中的结果
     */
    public static RetrievalResult empty(Status status, String query, List<String> kinds) {
        return new RetrievalResult(status, query, kinds, List.of());
    }
}

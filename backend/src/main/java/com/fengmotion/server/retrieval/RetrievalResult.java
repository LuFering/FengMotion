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
     * <p>四种状态互斥，且都有各自的处置方式，不能合并：</p>
     */
    public enum Status {

        /** 检索成功，且有命中。 */
        SUCCESS_WITH_HITS,

        /** 检索成功，但没有相近内容 —— 这才是「查过，确实没有」。 */
        SUCCESS_NO_MATCH,

        /** 索引为空或尚未建立：系统还没准备好，不是「没有匹配」。 */
        INDEX_NOT_READY,

        /** 调不通 embedding 服务（没配 key、网络异常、超时）。 */
        SERVICE_FAILED
    }

    /**
     * 是否成功执行了检索（无论有无命中）。
     *
     * @return 检索真的跑通了返回 true
     */
    public boolean succeeded() {
        return status == Status.SUCCESS_WITH_HITS || status == Status.SUCCESS_NO_MATCH;
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

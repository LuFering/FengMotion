package com.fengmotion.server.retrieval;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 检索状态必须能区分「失败」与「查过但没有」。
 *
 * <p>这组测试防的是一个会误导 agent 的具体错误：把服务失败、索引未就绪、
 * 确实没有匹配这三种情况都表现成空列表，下游就会统一说成「已检索，无匹配」。
 * agent 于是以为自己查过库，用户也以为检索起作用了 —— 实际上一次比对都没发生。</p>
 */
@DisplayName("检索状态区分")
class RetrievalStatusTest {

    /** 查询文本。 */
    private static final String QUERY = "镜头快速推近、背景被拉开的眩晕感";

    /** 检索范围。 */
    private static final List<String> KINDS = List.of("technique", "capability");

    @Test
    @DisplayName("服务失败不算检索成功")
    void serviceFailureIsNotSuccess() {
        RetrievalResult failed = RetrievalResult.empty(RetrievalResult.Status.SERVICE_FAILED, QUERY, KINDS);

        assertFalse(failed.succeeded(), "向量服务失败时不能报告为检索成功");
        assertTrue(failed.hits().isEmpty());
    }

    @Test
    @DisplayName("索引未就绪与服务失败互相独立")
    void indexNotReadyDiffersFromServiceFailure() {
        RetrievalResult notReady = RetrievalResult.empty(RetrievalResult.Status.INDEX_NOT_READY, QUERY, KINDS);

        assertEquals(RetrievalResult.Status.INDEX_NOT_READY, notReady.status());
        assertFalse(notReady.succeeded());
        assertFalse(notReady.status() == RetrievalResult.Status.SERVICE_FAILED,
                "索引未就绪说明还没比对过，不能和服务失败混为一谈");
    }

    @Test
    @DisplayName("没有匹配也算检索成功")
    void noMatchStillCountsAsSucceeded() {
        RetrievalResult noMatch = RetrievalResult.empty(RetrievalResult.Status.SUCCESS_NO_MATCH, QUERY, KINDS);

        assertTrue(noMatch.succeeded(), "确实查过且没有相近内容，属于成功检索");
        assertTrue(noMatch.hits().isEmpty());
    }

    @Test
    @DisplayName("降级命中可用，但不能称为语义成功")
    void degradedHitsAreUsableButNotSemantic() {
        var hit = new SemanticIndex.Hit("capability", "lemo:art-deco", 0,
                "Black lacquer, engraved gold line", 0.5);
        RetrievalResult degraded = new RetrievalResult(
                RetrievalResult.Status.DEGRADED_LITERAL_WITH_HITS, QUERY, KINDS, List.of(hit));

        assertTrue(degraded.usable(), "降级命中仍应展示给用户");
        assertFalse(degraded.succeeded(), "字面匹配不能算作语义检索成功");
        assertTrue(degraded.degraded());
    }

    @Test
    @DisplayName("降级无命中与向量服务失败是两回事")
    void degradedNoMatchDiffersFromServiceFailed() {
        RetrievalResult degraded = RetrievalResult.empty(
                RetrievalResult.Status.DEGRADED_LITERAL_NO_MATCH, QUERY, KINDS);
        RetrievalResult failed = RetrievalResult.empty(
                RetrievalResult.Status.SERVICE_FAILED, QUERY, KINDS);

        assertTrue(degraded.degraded(), "字面兜底跑过但没有结果，属于降级");
        assertFalse(failed.degraded(), "连字面都没查成，不是降级");
        assertFalse(degraded.usable());
        assertFalse(failed.usable());
        assertFalse(degraded.succeeded());
        assertFalse(failed.succeeded());
    }

    @Test
    @DisplayName("正常语义成功不算降级")
    void semanticSuccessIsNotDegraded() {
        var hit = new SemanticIndex.Hit("technique", "fx-dolly-zoom", 0, "推近同时拉开背景", 0.81);
        RetrievalResult found = new RetrievalResult(
                RetrievalResult.Status.SUCCESS_WITH_HITS, QUERY, KINDS, List.of(hit));

        assertFalse(found.degraded());
        assertTrue(found.usable());
        assertTrue(found.succeeded());
    }

    @Test
    @DisplayName("有命中时保留查询与范围，便于事后追溯")
    void hitsKeepQueryAndKinds() {
        var hit = new SemanticIndex.Hit("technique", "fx-dolly-zoom", 0, "推近同时拉开背景", 0.67);
        RetrievalResult found = new RetrievalResult(
                RetrievalResult.Status.SUCCESS_WITH_HITS, QUERY, KINDS, List.of(hit));

        assertTrue(found.succeeded());
        assertEquals(1, found.hits().size());
        assertEquals(QUERY, found.query());
        assertEquals(KINDS, found.kinds());
        assertEquals("fx-dolly-zoom", found.hits().get(0).id());
    }
}

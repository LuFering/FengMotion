package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fengmotion.server.retrieval.RetrievalResult;
import com.fengmotion.server.retrieval.SemanticIndex;

class CreationReferenceServiceTest {
    @TempDir Path root;

    @Test
    void queriesWithIntentAndLogsSuccessfulCandidates() throws Exception {
        var index = mock(SemanticIndex.class);
        var hit = new SemanticIndex.Hit("technique", "dolly-zoom", 2, "前景尺度稳定，背景连续变化", 0.82);
        when(index.search("背景眩晕", List.of("technique", "capability"), 6))
                .thenReturn(new RetrievalResult(RetrievalResult.Status.SUCCESS_WITH_HITS,
                        "背景眩晕", List.of("technique", "capability"), List.of(hit)));

        String candidates = new CreationReferenceService(index).resolveCandidates(root, "背景眩晕");

        assertTrue(candidates.contains("dolly-zoom"));
        assertTrue(candidates.contains("相似度 0.82"));
        String log = Files.readString(root.resolve(CreationReferenceService.RETRIEVAL_LOG));
        assertTrue(log.startsWith("# 检索记录"));
        assertTrue(log.contains("SUCCESS_WITH_HITS"));
        assertTrue(log.contains("dolly-zoom"));
        verify(index).search("背景眩晕", List.of("technique", "capability"), 6);
    }

    @Test
    void fallsBackToOriginalPromptAndAppendsInsteadOfReplacingEvidence() throws Exception {
        Files.writeString(root.resolve("prompt.original.md"), "做一段品牌片头\n");
        var index = mock(SemanticIndex.class);
        when(index.search("做一段品牌片头\n", List.of("technique", "capability"), 6))
                .thenReturn(RetrievalResult.empty(RetrievalResult.Status.SUCCESS_NO_MATCH,
                        "做一段品牌片头\n", List.of("technique", "capability")));
        var service = new CreationReferenceService(index);

        String first = service.resolveCandidates(root, null);
        String second = service.resolveCandidates(root, "   ");

        assertTrue(first.contains("确实没有相近条目"));
        assertEquals(first, second);
        String log = Files.readString(root.resolve(CreationReferenceService.RETRIEVAL_LOG));
        assertEquals(2, log.split("## ", -1).length - 1);
        assertTrue(log.contains("SUCCESS_NO_MATCH"));
        verify(index, org.mockito.Mockito.times(2))
                .search("做一段品牌片头\n", List.of("technique", "capability"), 6);
    }

    @Test
    void distinguishesServiceFailureFromIndexNotReadyAndRealNoMatch() throws Exception {
        var index = mock(SemanticIndex.class);
        when(index.search("task", List.of("technique", "capability"), 6))
                .thenReturn(RetrievalResult.empty(RetrievalResult.Status.INDEX_NOT_READY,
                                "task", List.of("technique", "capability")),
                        RetrievalResult.empty(RetrievalResult.Status.DEGRADED_LITERAL_NO_MATCH,
                                "task", List.of("technique", "capability")));
        when(index.search("failure", List.of("technique", "capability"), 6))
                .thenThrow(new IllegalStateException("offline"));
        var service = new CreationReferenceService(index);

        String notReady = service.resolveCandidates(root, "task");
        String degraded = service.resolveCandidates(root, "task");
        String failed = service.resolveCandidates(root, "failure");

        assertTrue(notReady.contains("索引尚未建立"));
        assertFalse(notReady.contains("确实没有相近条目"));
        assertTrue(degraded.contains("字面匹配不懂同义词"));
        assertTrue(failed.contains("向量服务调用失败"));
        assertTrue(Files.readString(root.resolve(CreationReferenceService.RETRIEVAL_LOG))
                .contains("SERVICE_FAILED"));
    }

    @Test
    void clearlyMarksLiteralMatchesAsDegraded() throws Exception {
        var index = mock(SemanticIndex.class);
        var hit = new SemanticIndex.Hit("capability", "motion", 1, " motion camera move ", 0.61);
        when(index.search("camera", List.of("technique", "capability"), 6))
                .thenReturn(new RetrievalResult(RetrievalResult.Status.DEGRADED_LITERAL_WITH_HITS,
                        "camera", List.of("technique", "capability"), List.of(hit)));

        String candidates = new CreationReferenceService(index).resolveCandidates(root, "camera");

        assertTrue(candidates.contains("字面匹配条目"));
        assertTrue(candidates.contains("本轮语义检索不可用"));
        assertTrue(candidates.contains("motion"));
        assertTrue(Files.readString(root.resolve(CreationReferenceService.RETRIEVAL_LOG))
                .contains("DEGRADED_LITERAL_WITH_HITS"));
    }

    @Test
    void blankIntentWithoutProjectPromptDoesNotSearchOrCreateLog() {
        var index = mock(SemanticIndex.class);

        assertEquals("", new CreationReferenceService(index).resolveCandidates(root, " "));

        assertFalse(Files.exists(root.resolve(CreationReferenceService.RETRIEVAL_LOG)));
        org.mockito.Mockito.verifyNoInteractions(index);
    }
}

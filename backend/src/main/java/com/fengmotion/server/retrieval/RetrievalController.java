package com.fengmotion.server.retrieval;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import lombok.RequiredArgsConstructor;

/**
 * 语义检索接口。
 *
 * <p>给 agent 用：它按自然语言查「我想要那种镜头快速推近的眩晕感」，
 * 这里同时从三库与 capabilities 里召回候选。</p>
 */
@RestController
@RequestMapping("/api/retrieval")
@RequiredArgsConstructor
public class RetrievalController {

    private final SemanticIndex index;

    /**
     * 语义检索。
     *
     * @param q     自然语言查询
     * @param kinds 限定来源（asset/reference/technique/capability），可逗号分隔
     * @param limit 返回条数
     * @return 命中列表
     */
    @GetMapping("/search")
    public SearchResponse search(@RequestParam String q,
                                 @RequestParam(required = false) String kinds,
                                 @RequestParam(defaultValue = "10") int limit) {
        List<String> kindList = (kinds == null || kinds.isBlank()) ? List.of() : List.of(kinds.split(","));
        RetrievalResult result = index.search(q, kindList, Math.min(Math.max(limit, 1), 50));
        return new SearchResponse(result.status().name(), index.size(), result.hits().stream()
                .map(h -> new HitItem(h.kind(), h.id(), h.chunk(), h.text(), h.score()))
                .toList());
    }

    /**
     * 一条命中。
     *
     * @param kind  来源
     * @param id    资源 ID
     * @param chunk 段号
     * @param text  命中文本
     * @param score 相似度
     */
    public record HitItem(String kind, String id, int chunk, String text, double score) {
    }

    /**
     * 检索结果。
     *
     * @param status  检索状态（SUCCESS_WITH_HITS / SUCCESS_NO_MATCH / INDEX_NOT_READY / SERVICE_FAILED）
     * @param indexed 索引总段数
     * @param hits    命中
     */
    public record SearchResponse(String status, int indexed, List<HitItem> hits) {
    }
}

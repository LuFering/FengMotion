package com.fengmotion.server.retrieval;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.annotation.JsonInclude;

import lombok.RequiredArgsConstructor;

/**
 * 语义检索接口。
 *
 * <p>给 agent 用：它按自然语言查「我想要那种镜头快速推近的眩晕感」，
 * 这里同时从三库与 capabilities 里召回候选。</p>
 *
 * <p><strong>HTTP 状态码的约定</strong>：检索失败一律仍然返回 200，
 * 因为「没查到」和「查不了」都是这个接口的<em>正常业务结果</em>，
 * 用 5xx 表示会让前端把可展示的降级结果也当成异常吞掉。
 * 成败写在响应体的 {@code status} / {@code usable} / {@code degraded} 里，
 * 调用方必须读响应体，不能只看状态码。</p>
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
     * @return 带状态、降级标记与命中的结果
     */
    @GetMapping("/search")
    public SearchResponse search(@RequestParam String q,
                                 @RequestParam(required = false) String kinds,
                                 @RequestParam(defaultValue = "10") int limit) {
        List<String> kindList = (kinds == null || kinds.isBlank()) ? List.of() : List.of(kinds.split(","));
        RetrievalResult result = index.search(q, kindList, Math.min(Math.max(limit, 1), 50));
        return new SearchResponse(result.status().name(), result.degraded(), result.usable(),
                reasonOf(result),
                index.size(), result.hits().stream()
                        .map(h -> new HitItem(h.kind(), h.id(), h.chunk(), h.text(), h.score()))
                        .toList());
    }

    /**
     * 把状态翻译成人话，供界面直接显示。
     *
     * <p>只对「降级」和「失败」给说明；正常命中不需要解释，
     * 强行加一句会让界面多一行噪音。</p>
     */
    private static String reasonOf(RetrievalResult result) {
        return switch (result.status()) {
            case DEGRADED_LITERAL_WITH_HITS ->
                    "语义检索不可用，以下为索引原文的字面匹配，不是语义命中";
            case DEGRADED_LITERAL_NO_MATCH -> "语义检索不可用，字面匹配也没有结果";
            case INDEX_NOT_READY -> "索引尚未建立，暂时无法检索";
            case SERVICE_FAILED -> "向量服务不可用，且索引中没有可做字面匹配的原文";
            case SUCCESS_WITH_HITS, SUCCESS_NO_MATCH -> null;
        };
    }

    /**
     * 一条命中。
     *
     * @param kind  来源
     * @param id    资源 ID
     * @param chunk 段号
     * @param text  命中文本
     * @param score 相似度（语义）或命中词块占比（降级）；含义由响应的 status 决定
     */
    public record HitItem(String kind, String id, int chunk, String text, double score) {
    }

    /**
     * 检索结果。
     *
     * <p>两个布尔字段是为了让调用方<strong>不必自己解析 status 字符串</strong>：
     * 前端渲染和 agent 提示词都只需回答「有没有结果可展示」「这次算不算语义匹配」。
     * 让每处各自 switch 状态名，新增状态时一定会有人漏掉。</p>
     *
     * @param status   检索状态
     * @param degraded 是否降级为字面匹配（true 表示结果不能称为「语义命中」）
     * @param usable   是否有可展示的结果
     * @param reason   人类可读说明；仅降级/失败时出现
     * @param indexed  索引总段数
     * @param hits     命中
     */
    public record SearchResponse(String status, boolean degraded, boolean usable,
            @JsonInclude(JsonInclude.Include.NON_NULL) String reason,
            int indexed, List<HitItem> hits) {
    }
}

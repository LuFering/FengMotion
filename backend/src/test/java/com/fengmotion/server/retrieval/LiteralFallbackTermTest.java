package com.fengmotion.server.retrieval;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 字面兜底的切词规则。
 *
 * <p>为什么这些断言值得写：兜底本身价值不大，<strong>兜底返回错东西才最糟</strong>。
 * 如果切词切得太碎（单字也参与），「眩晕感」会命中一切带「感」字的条目，
 * 用户看到一个像模像样的列表，实际上全是噪音 —— 比空列表更能骗人。</p>
 */
@DisplayName("字面兜底切词")
class LiteralFallbackTermTest {

    @Test
    @DisplayName("中文切成二元组：整句能命中原文里的短词")
    void splitsCjkIntoBigrams() {
        List<String> terms = SemanticIndex.splitTerms("镜头快速推近、背景被拉开的眩晕感");

        /* 关键断言：必须切出「眩晕」，否则原文写「多莉变焦…眩晕镜头」时命中不了。
           按标点切成整块是错的 —— 实测过，整句零命中。 */
        assertTrue(terms.contains("眩晕"), "必须切出「眩晕」这个二元组：" + terms);
        assertTrue(terms.contains("推近"), "必须切出「推近」：" + terms);
        assertTrue(terms.size() > 4, "长句应切成多个二元组，而不是两个整块：" + terms);
        for (String term : terms) {
            assertTrue(term.length() == 2, "中文词块应为二元组：" + term);
        }
    }

    @Test
    @DisplayName("拉丁词按词切，中文按二元组切，二者可混用")
    void splitsMixedQuery() {
        List<String> terms = SemanticIndex.splitTerms("art deco 遮罩揭示");

        assertTrue(terms.contains("art"));
        assertTrue(terms.contains("deco"));
        assertTrue(terms.contains("遮罩"), "中文部分仍按二元组切：" + terms);
    }

    @Test
    @DisplayName("单字词块被丢弃：否则必然误命中")
    void dropsSingleCharacterTerms() {
        List<String> terms = SemanticIndex.splitTerms("感 的 a 镜头");

        assertEquals(List.of("镜头"), terms, "单字与单字母不应参与字面匹配");
    }

    @Test
    @DisplayName("重复词块只保留一次，避免同一词把分数抬高")
    void deduplicatesTerms() {
        List<String> terms = SemanticIndex.splitTerms("推近推近推近");

        assertEquals(List.of("推近", "近推"), terms, "重复二元组应去重");
    }

    @Test
    @DisplayName("空查询与纯标点切不出词块")
    void emptyQueryYieldsNoTerms() {
        assertTrue(SemanticIndex.splitTerms("").isEmpty());
        assertTrue(SemanticIndex.splitTerms("、、。").isEmpty());
        assertTrue(SemanticIndex.splitTerms(null).isEmpty());
        assertFalse(SemanticIndex.splitTerms("镜头").isEmpty());
    }
}

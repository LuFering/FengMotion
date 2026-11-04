package com.fengmotion.server.reference.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.fengmotion.server.reference.domain.ReferenceStates.AnalysisSource;

/**
 * 分析值与片段的口径约束。
 *
 * <p>这批断言守的是「界面不撒谎」：</p>
 * <ol>
 *   <li>pending 的维度不能带内容 —— 否则界面无法区分「解析过，结论是无」和「还没解析」；</li>
 *   <li>已解析的值必须标来源 —— 模型判断不能显示成实测事实；</li>
 *   <li>新片段六个维度全部 pending，不带任何预设结论。</li>
 * </ol>
 */
class AnalysisValueTest {

    @Test
    @DisplayName("未解析的值不带内容也不带来源")
    void unparsedHasNoContent() {
        AnalysisValue value = AnalysisValue.unparsed();
        assertTrue(value.pending());
        assertEquals("", value.value());
        assertNull(value.source());
        assertNull(value.confidence());
        assertEquals("", value.evidence());
        assertTrue(value.isConsistent());
    }

    @Test
    @DisplayName("已解析的值必须同时有内容与来源")
    void parsedRequiresValueAndSource() {
        AnalysisValue value = AnalysisValue.parsed("缓慢推进", AnalysisSource.MODEL, 0.7, "00:02-00:05");
        assertFalse(value.pending());
        assertEquals("缓慢推进", value.value());
        assertEquals(AnalysisSource.MODEL, value.source());
        assertEquals("00:02-00:05", value.evidence());
        assertTrue(value.isConsistent());
    }

    @Test
    @DisplayName("空内容不能算「已解析」——那等于没说")
    void parsedRejectsBlankValue() {
        assertThrows(IllegalArgumentException.class,
                () -> AnalysisValue.parsed("", AnalysisSource.MODEL, null, ""));
        assertThrows(IllegalArgumentException.class,
                () -> AnalysisValue.parsed("  ", AnalysisSource.MODEL, null, ""));
    }

    @Test
    @DisplayName("已解析却没有来源被拒绝：模型判断不能伪装成实测")
    void parsedRejectsNullSource() {
        assertThrows(IllegalArgumentException.class,
                () -> AnalysisValue.parsed("有内容", null, null, ""));
    }

    @Test
    @DisplayName("不一致的组合能被识别（pending 却带内容）")
    void inconsistentCombinationDetected() {
        AnalysisValue bad = new AnalysisValue("有内容", AnalysisSource.MODEL, null, "", true);
        assertFalse(bad.isConsistent(), "pending 带内容应当被判定为不一致");
    }

    @Test
    @DisplayName("新片段六维全部 pending，观察与推断都是空串")
    void newSegmentHasAllDimensionsPending() {
        ReferenceSegment segment = ReferenceSegment.unparsed("seg_1", "ref_1", 0, 0, 5000, List.of("暖光"));

        assertEquals(6, segment.analysis().size(), "六维必须齐全");
        for (var entry : segment.analysis().entrySet()) {
            assertTrue(entry.getValue().pending(), entry.getKey() + " 应当处于 pending");
            assertEquals("", entry.getValue().value(), entry.getKey() + " 不得预填默认值");
        }
        // 观察与推断是分开的两个字段，初始都为空，不是「无」之类的占位文本。
        assertEquals("", segment.observation());
        assertEquals("", segment.inference());
        assertEquals("", segment.suggestion());
        assertTrue(segment.extraAnalysis().isEmpty());
        assertEquals(ReferenceStates.Status.PENDING, segment.status());
    }

    @Test
    @DisplayName("时间范围校验：起点必须小于终点")
    void rangeValidation() {
        assertTrue(ReferenceSegment.unparsed("s", "v", 0, 0, 1000, List.of()).hasValidRange());
        assertFalse(ReferenceSegment.unparsed("s", "v", 0, 1000, 1000, List.of()).hasValidRange());
        assertFalse(ReferenceSegment.unparsed("s", "v", 0, 2000, 1000, List.of()).hasValidRange());
        assertFalse(ReferenceSegment.unparsed("s", "v", 0, -1, 1000, List.of()).hasValidRange());
    }

    @Test
    @DisplayName("六维包含「可借鉴点」，顺序稳定")
    void analysisKeysIncludeReusable() {
        List<ReferenceStates.AnalysisKey> keys = ReferenceStates.AnalysisKey.ordered();
        assertEquals(6, keys.size());
        assertTrue(keys.stream().anyMatch(k -> k == ReferenceStates.AnalysisKey.REUSABLE),
                "「可借鉴点」是能不能拿来创作的决策字段，不能被砍掉");
    }
}

package com.fengmotion.server.workflow.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 原文污染检测。
 *
 * <p>污染样本按旧版前端的真实拼接方式构造：lookdev 输出 = 提示词 + 自己的参数，
 * filmplan 输出 = 提示词 + lookdev 输出 + 自己的参数，create 的 intent = 三者再拼一次，
 * 段落之间用空行连接。</p>
 */
class OriginalPromptIntegrityTest {

    private static String join(String... parts) {
        return Stream.of(parts).filter(Objects::nonNull).collect(Collectors.joining("\n\n"));
    }

    /** 复现旧版 executeWorkflow 的拼接结果。 */
    private static String legacyIntent(String prompt, String lookSummary, String planSummary) {
        String look = join(prompt, lookSummary + "\ndraft");
        String plan = join(prompt, look, planSummary + "\ndraft");
        return join(prompt, look, plan);
    }

    @Test
    @DisplayName("正常需求判为 ok")
    void cleanPromptIsOk() {
        var result = OriginalPromptIntegrity.check("""
                做一条 30 秒的咖啡店短片。

                画面温暖，结尾出现店名「晨光」。
                """);
        assertEquals("ok", result.status());
        assertEquals(List.of(), result.reasons());
    }

    @Test
    @DisplayName("旧版拼接的原文判为 suspect，并指出重复与 draft")
    void legacyConcatenationIsSuspect() {
        String polluted = legacyIntent("做一条 30 秒的咖啡店短片，结尾出现店名", "暖色调，晨光斜射", "三段：进门、手冲、出门");
        var result = OriginalPromptIntegrity.check(polluted);
        assertEquals("suspect", result.status());
        assertTrue(result.reasons().stream().anyMatch(r -> r.contains("出现了 4 次")), result.reasons().toString());
        assertTrue(result.reasons().stream().anyMatch(r -> r.contains("draft")), result.reasons().toString());
    }

    @Test
    @DisplayName("很短的需求被重复拼接也能认出来")
    void shortRepeatedFirstParagraphIsSuspect() {
        var result = OriginalPromptIntegrity.check(join("咖啡短片", "咖啡短片", "补充说明写在这里"));
        assertEquals("suspect", result.status());
    }

    @Test
    @DisplayName("非首段的短重复（如「无」）不算污染")
    void shortRepeatedLaterParagraphIsOk() {
        var result = OriginalPromptIntegrity.check(join("做一条咖啡店短片", "参考：", "无", "素材：", "无"));
        assertEquals("ok", result.status(), result.reasons().toString());
    }

    @Test
    @DisplayName("段内空白差异不影响重复判断")
    void whitespaceIsNormalized() {
        var result = OriginalPromptIntegrity.check("做一条咖啡店的短片  画面温暖\n\n做一条咖啡店的短片 画面温暖\r\n");
        assertEquals("suspect", result.status());
    }
}

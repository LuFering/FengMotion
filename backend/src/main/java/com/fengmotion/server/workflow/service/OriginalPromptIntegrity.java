package com.fengmotion.server.workflow.service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 检查 {@code prompt.original.md} 是否像被工作稿污染过。
 *
 * <p><strong>背景</strong>：旧版前端在首次运行工作流时，把「提示词 + 视觉构想 + 导演处理」
 * 逐层拼接后的文字当成原文写入。拼接结果的特征是：提示词段落重复出现，
 * 以及工作稿状态值 {@code draft} 单独成行。</p>
 *
 * <p><strong>只报告，不修改</strong>：原文是创作依据，判断错了去改它比不改更糟。
 * 这里给出可疑原因，由用户决定怎么处理。规则刻意保守：正常的需求很少会整段重复。</p>
 */
public final class OriginalPromptIntegrity {

    /** 重复段落的最小长度（去空白后的字符数）。短于此的重复（如「无」「---」）不算。 */
    static final int MIN_REPEATED_CHARS = 8;

    private OriginalPromptIntegrity() {
    }

    /**
     * 检查结果。
     *
     * @param status  {@code ok} / {@code suspect}
     * @param reasons 可疑原因，{@code ok} 时为空
     */
    public record Result(String status, List<String> reasons) {
        static Result ok() {
            return new Result("ok", List.of());
        }
    }

    /**
     * 检查原文。
     *
     * @param content 原文全文
     * @return 结果
     */
    public static Result check(String content) {
        List<String> reasons = new ArrayList<>();
        List<String> paragraphs = paragraphs(content);

        Map<String, Integer> counts = new LinkedHashMap<>();
        for (String paragraph : paragraphs) counts.merge(paragraph, 1, Integer::sum);
        String first = paragraphs.isEmpty() ? null : paragraphs.get(0);
        for (var entry : counts.entrySet()) {
            if (entry.getValue() < 2) continue;
            /* 污染总是从提示词本身开始重复，所以首段放宽长度限制：
               一句很短的需求被拼了 4 次，也要能认出来。 */
            boolean longEnough = compact(entry.getKey()).length() >= MIN_REPEATED_CHARS;
            if (longEnough || entry.getKey().equals(first)) {
                reasons.add("同一段落出现了 " + entry.getValue() + " 次：「" + preview(entry.getKey()) + "」");
            }
        }

        Set<String> lines = new HashSet<>();
        for (String line : content.replace("\r\n", "\n").split("\n")) lines.add(line.strip());
        if (lines.contains("draft")) {
            reasons.add("含有单独成行的「draft」，这是旧版视觉构想节点的状态值");
        }
        return reasons.isEmpty() ? Result.ok() : new Result("suspect", List.copyOf(reasons));
    }

    /** 按空行切段，段内空白归一，丢掉空段。 */
    private static List<String> paragraphs(String content) {
        List<String> out = new ArrayList<>();
        for (String block : content.replace("\r\n", "\n").split("\\n\\s*\\n")) {
            String normalized = block.strip().replaceAll("[ \\t]+", " ");
            if (!normalized.isEmpty()) out.add(normalized);
        }
        return out;
    }

    private static String compact(String text) {
        return text.replaceAll("\\s+", "");
    }

    private static String preview(String paragraph) {
        String flat = paragraph.replaceAll("\\s+", " ");
        return flat.length() <= 24 ? flat : flat.substring(0, 24) + "…";
    }
}

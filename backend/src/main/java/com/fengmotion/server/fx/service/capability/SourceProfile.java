package com.fengmotion.server.fx.service.capability;

import java.nio.file.Path;
import java.util.List;

/**
 * 一个来源库的导入配置。
 *
 * <p><strong>为什么排除规则要变成配置</strong>：之前把
 * 「references/ 下只收 shots/」这类规则写死在 {@link CapabilitySource#isNoise} 里，
 * 结果每接入一个新库就要补一次代码 —— 实测已经补了四轮
 * （demo 目录、仓库说明、模板目录、流程文档）。
 * 规则属于「这个库长什么样」，属于数据，不属于代码。</p>
 *
 * <p><strong>为什么包含/排除用 glob 而不是目录判断</strong>：目录判断能表达的
 * 太有限（要么整目录收，要么整目录不收），而真实库往往是
 * 「references/ 下只收 shots/ 子目录」这种部分收。glob 能直接表达。</p>
 *
 * @param name          来源库名，写进 {@code source_project}
 * @param root          相对 capabilities 根的路径；不填表示用目录名
 * @param include       包含的 glob；为空表示「全部」
 * @param exclude       排除的 glob；优先级高于 include
 * @param categoryFrom  分类从哪来：top（顶层目录）/ parent（上一级目录）/ none
 * @param parsers       使用哪些解析器名；空表示全部
 * @param needsModel    是否需要模型补充语义（本阶段不使用，只为将来留位）
 */
public record SourceProfile(
        String name,
        String root,
        List<String> include,
        List<String> exclude,
        String categoryFrom,
        List<String> parsers,
        boolean needsModel) {

    /** 默认配置：包含全部、不排除、分类取上一级目录。 */
    public static SourceProfile defaults(String name) {
        return new SourceProfile(name, name, List.of(), List.of(), "parent", List.of(), false);
    }

    /** 解析相对 capabilities 根的扫描路径。 */
    public Path resolveRoot(Path capabilitiesRoot) {
        String rel = root == null || root.isBlank() ? name : root;
        return capabilitiesRoot.resolve(rel);
    }

    /**
     * 判断一个相对路径是否被本来源收录。
     *
     * <p>顺序固定：先看排除，再看包含。反过来的话，一条同时命中
     * include 与 exclude 的路径会被收进来 —— 排除的本意就是「哪怕你符合包含，
     * 只要命中排除就不要」，所以必须先排除。</p>
     *
     * @param relativePosix 相对扫描根的 POSIX 路径（用 {@code /} 分隔）
     * @return 应收录时 true
     */
    public boolean accepts(String relativePosix) {
        if (matchesAny(exclude, relativePosix)) {
            return false;
        }
        if (include == null || include.isEmpty()) {
            return true;
        }
        return matchesAny(include, relativePosix);
    }

    private static boolean matchesAny(List<String> patterns, String path) {
        if (patterns == null) {
            return false;
        }
        for (String pattern : patterns) {
            if (globMatch(pattern, path)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 极简 glob：支持 {@code **}（任意层目录）、{@code *}（同层任意字符）、{@code ?}。
     *
     * <p>刻意不引入完整的 glob 库：这里只需要「包含某个目录」「排除某类文件名」
     * 两种用法，引入第三方库会让规则语法变得没人敢改。
     * 语法简单到能在一屏内看懂，比功能齐全更重要。</p>
     *
     * @param pattern glob 模式
     * @param path    待匹配路径
     * @return 匹配时 true
     */
    static boolean globMatch(String pattern, String path) {
        if (pattern == null || pattern.isBlank()) {
            return false;
        }
        StringBuilder regex = new StringBuilder("^");
        int i = 0;
        while (i < pattern.length()) {
            char c = pattern.charAt(i);
            if (c == '*') {
                if (i + 1 < pattern.length() && pattern.charAt(i + 1) == '*') {
                    // 「双星号 + 斜杠」表示任意层目录；双星号在末尾表示任意字符。
                    if (i + 2 < pattern.length() && pattern.charAt(i + 2) == '/') {
                        regex.append("(?:.*/)?");
                        i += 3;
                        continue;
                    }
                    regex.append(".*");
                    i += 2;
                    continue;
                }
                regex.append("[^/]*");
                i++;
                continue;
            }
            if (c == '?') {
                regex.append("[^/]");
                i++;
                continue;
            }
            regex.append(java.util.regex.Pattern.quote(String.valueOf(c)));
            i++;
        }
        regex.append("$");
        return path.matches(regex.toString());
    }
}
